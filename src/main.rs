#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::{
    borrow::Cow,
    collections::HashMap,
    env,
    error::Error,
    fs,
    hash::{Hash, Hasher},
    io,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use leaftext::indexer::{event_script, IndexerEvent, IndexerWorker};
use leaftext::{
    app_data_dir, app_shell_html, bundled_asset_response, config_file_path, document_pager_html,
    fragment_scroll_script, glossary_sheet_script, initial_settings_script, initial_state_script,
    load_recent_files, load_settings, local_image_protocol_response, local_image_source_dir,
    navigation_state_script, open_document_with_recent, open_error_state_script,
    opened_document_from_markdown, pager_loaded_script, render_markdown_document,
    save_recent_files, save_settings, scroll_anchor_script, settings_file_path,
    webview_user_data_dir, workspace_reload_script, workspace_state_script,
    workspace_switch_script, LibraryView, RecentFiles, ScrollAnchor, Settings,
    LOCAL_ASSET_PROTOCOL, LOCAL_IMAGE_PROTOCOL,
};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use rfd::FileDialog;
use serde::Deserialize;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Icon, WindowBuilder},
};
use wry::{
    http::{Request, Response},
    DragDropEvent, PageLoadEvent, WebContext, WebView, WebViewBuilder,
};

#[derive(Debug)]
enum UserEvent {
    OpenPicker,
    OpenPath(PathBuf),
    /// The webview finished its first page load, so its JS document-render hooks
    /// now exist. Sent once on boot to flush a file passed on the command line
    /// (e.g. Explorer "Open with"), whose render would otherwise race the load.
    WebviewReady,
    RevealPath(PathBuf),
    CopyFileToClipboard {
        path: PathBuf,
        cut: bool,
    },
    CopyPathToClipboard(PathBuf),
    RenamePath {
        path: PathBuf,
        new_name: String,
    },
    DeletePath(PathBuf),
    ShowProperties(PathBuf),
    CloseTab {
        index: usize,
    },
    SwitchTab {
        index: usize,
        scroll_anchor: ScrollAnchor,
    },
    MoveTab {
        from: usize,
        to: usize,
    },
    GoHome,
    OpenLink {
        href: String,
        scroll_anchor: ScrollAnchor,
    },
    /// A glossary link was clicked: show the term in a bottom sheet over the
    /// current document instead of opening it as a tab. `href` points at the
    /// glossary file plus the term's `#anchor`, relative to the active document.
    OpenGlossary {
        href: String,
    },
    GoBack {
        scroll_anchor: ScrollAnchor,
    },
    GoForward {
        scroll_anchor: ScrollAnchor,
    },
    /// The file backing some tab changed on disk; the live-reload watcher sends
    /// this with the changed path. Only acted on when it is the active document.
    FileChanged(PathBuf),
    /// Turn the background library indexer on or off.
    SetIndexingEnabled {
        enabled: bool,
    },
    /// Persist the minimap-visibility toggle.
    SetMinimapEnabled {
        enabled: bool,
    },
    /// Persist the Previous/Next pager toggle.
    SetPagerEnabled {
        enabled: bool,
    },
    /// Persist the Speed Reader toggle.
    SetSpeedReaderEnabled {
        enabled: bool,
    },
    /// Persist the selected theme mode (`system`/`light`/`dark`/`dracula`).
    SetThemeMode {
        mode: String,
    },
    /// Paint the native title bar to match the page and the window border to the
    /// theme's divider color. The webview reports both resolved colors whenever
    /// the theme changes.
    SetWindowChrome {
        r: u8,
        g: u8,
        b: u8,
        border_r: u8,
        border_g: u8,
        border_b: u8,
        dark: bool,
    },
    /// Persist the library view choice plus its restorable state: the Tree
    /// view's expanded folders and the Project view's current folder.
    SetLibraryState {
        view: String,
        expanded: Vec<String>,
        project_path: String,
    },
    /// Persist the library pane's open/closed state and last open width.
    SetLibraryLayout {
        closed: bool,
        width: u32,
    },
    /// Request the current library tree from the indexer's read connection.
    GetFileTree,
    /// Run a full-text search on the indexer's read connection.
    Search {
        query: String,
    },
    /// Compute Previous/Next pager links without blocking the initial document
    /// render.
    LoadPager {
        path: PathBuf,
    },
    /// The background pager scan completed for a document path.
    PagerLoaded {
        path: PathBuf,
        html: String,
    },
    /// A result/progress event from the background indexer worker, delivered to
    /// the webview through its library callbacks.
    Indexer(IndexerEvent),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command")]
enum IpcCommand {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "openRecent")]
    OpenRecent { path: PathBuf },
    #[serde(rename = "revealFile")]
    RevealFile { path: PathBuf },
    #[serde(rename = "copyFile")]
    CopyFile { path: PathBuf, cut: bool },
    #[serde(rename = "copyPath")]
    CopyPath { path: PathBuf },
    #[serde(rename = "renameFile")]
    RenameFile {
        path: PathBuf,
        #[serde(rename = "newName")]
        new_name: String,
    },
    #[serde(rename = "deleteFile")]
    DeleteFile { path: PathBuf },
    #[serde(rename = "showProperties")]
    ShowProperties { path: PathBuf },
    #[serde(rename = "closeTab")]
    CloseTab { index: usize },
    #[serde(rename = "switchTab")]
    SwitchTab {
        index: usize,
        scroll_anchor: ScrollAnchor,
    },
    #[serde(rename = "moveTab")]
    MoveTab { from: usize, to: usize },
    #[serde(rename = "goHome")]
    GoHome,
    #[serde(rename = "openLink")]
    OpenLink {
        href: String,
        scroll_anchor: ScrollAnchor,
    },
    #[serde(rename = "openGlossary")]
    OpenGlossary { href: String },
    #[serde(rename = "goBack")]
    GoBack { scroll_anchor: ScrollAnchor },
    #[serde(rename = "goForward")]
    GoForward { scroll_anchor: ScrollAnchor },
    #[serde(rename = "setIndexingEnabled")]
    SetIndexingEnabled { enabled: bool },
    #[serde(rename = "setMinimapEnabled")]
    SetMinimapEnabled { enabled: bool },
    #[serde(rename = "setPagerEnabled")]
    SetPagerEnabled { enabled: bool },
    #[serde(rename = "setSpeedReaderEnabled")]
    SetSpeedReaderEnabled { enabled: bool },
    #[serde(rename = "setThemeMode")]
    SetThemeMode { mode: String },
    #[serde(rename = "setWindowChrome")]
    SetWindowChrome {
        r: u8,
        g: u8,
        b: u8,
        #[serde(rename = "borderR")]
        border_r: u8,
        #[serde(rename = "borderG")]
        border_g: u8,
        #[serde(rename = "borderB")]
        border_b: u8,
        dark: bool,
    },
    #[serde(rename = "setLibraryState")]
    SetLibraryState {
        view: String,
        expanded: Vec<String>,
        #[serde(rename = "projectPath")]
        project_path: String,
    },
    #[serde(rename = "setLibraryLayout")]
    SetLibraryLayout { closed: bool, width: u32 },
    #[serde(rename = "getFileTree")]
    GetFileTree,
    #[serde(rename = "search")]
    Search { query: String },
    #[serde(rename = "loadPager")]
    LoadPager { path: PathBuf },
}

fn main() {
    if let Err(error) = run_app() {
        let message = startup_failure_message(error.as_ref());
        eprintln!("{message}");
        show_startup_error(&message);
    }
}

/// Decode the bundled leaf logo into a window icon (taskbar and title bar).
/// Returns `None` if decoding fails so the window still opens icon-free.
fn load_window_icon() -> Option<Icon> {
    const ICON_PNG: &[u8] = include_bytes!("assets/leaf-256.png");
    let decoder = png::Decoder::new(ICON_PNG);
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).ok()?;
    if info.color_type != png::ColorType::Rgba {
        return None;
    }
    buffer.truncate(info.buffer_size());
    Icon::from_rgba(buffer, info.width, info.height).ok()
}

/// Paint the native Windows title bar to match the in-app page background and the
/// window border to the theme's divider color. `r`/`g`/`b` are the page's
/// resolved background color, `border_r`/`border_g`/`border_b` the resolved
/// divider color, and `dark` the resolved light/dark state — all reported by the
/// webview on every theme change. Caption/border/text colors require Windows 11
/// (build 22000+); on older builds `DwmSetWindowAttribute` returns an error we
/// ignore, so the call is a harmless no-op there (immersive dark mode still
/// applies on Windows 10 1809+).
#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn apply_window_chrome(
    window: &tao::window::Window,
    r: u8,
    g: u8,
    b: u8,
    border_r: u8,
    border_g: u8,
    border_b: u8,
    dark: bool,
) {
    use std::ffi::c_void;
    use tao::platform::windows::WindowExtWindows;

    // Attribute ids from dwmapi.h.
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    let hwnd = window.hwnd() as *mut c_void;
    if hwnd.is_null() {
        return;
    }

    // Nudge the caption only a little off the page color so the drag bar is
    // findable — just a touch lighter than the page on dark themes (including
    // Dracula), a touch darker on light ones — and bias the nudge toward blue so
    // the bar reads cooler and a bit more saturated than the page. Blend the red
    // and green channels by a small amount and the blue channel by more, toward
    // white on dark themes or black on light ones.
    let tint = |channel: u8, t: f32| -> u32 {
        let target = if dark { 255.0 } else { 0.0 };
        let value = f32::from(channel);
        (value + (target - value) * t).round().clamp(0.0, 255.0) as u32
    };
    // Lift red/green only slightly (keep the bar close to the page and darker
    // than a flat tint) while pushing blue further for the saturated-blue cast.
    let (rg_t, b_t) = if dark { (0.06, 0.18) } else { (0.10, 0.02) };
    let (cap_r, cap_g, cap_b) = (tint(r, rg_t), tint(g, rg_t), tint(b, b_t));
    // COLORREF packs as 0x00BBGGRR.
    let caption = cap_r | (cap_g << 8) | (cap_b << 16);
    // Choose caption text by background luminance so the title stays legible
    // whatever the theme paints behind it.
    let luminance = 0.299 * f32::from(r) + 0.587 * f32::from(g) + 0.114 * f32::from(b);
    let text: u32 = if luminance < 140.0 {
        0x00ff_ffff
    } else {
        0x0020_2020
    };
    // The window border takes the theme's divider color so the app reads as a
    // distinct surface against the desktop — a darker line on light themes, the
    // blue rule on Dracula. The caption/title bar stays the page color.
    let border = (border_r as u32) | ((border_g as u32) << 8) | ((border_b as u32) << 16);
    let dark_flag: i32 = i32::from(dark);

    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            std::ptr::addr_of!(dark_flag).cast(),
            4,
        );
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            std::ptr::addr_of!(caption).cast(),
            4,
        );
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            std::ptr::addr_of!(border).cast(),
            4,
        );
        DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, std::ptr::addr_of!(text).cast(), 4);
    }
}

/// Other platforms keep their native chrome; the system already follows the OS
/// light/dark preference there.
#[cfg(not(windows))]
#[allow(clippy::too_many_arguments)]
fn apply_window_chrome(
    _window: &tao::window::Window,
    _r: u8,
    _g: u8,
    _b: u8,
    _border_r: u8,
    _border_g: u8,
    _border_b: u8,
    _dark: bool,
) {
}

/// Write the UI toggles to disk, logging (but not propagating) any I/O error —
/// a failed save must not take down the event loop.
fn persist_settings(settings: &Settings, settings_path: Option<&PathBuf>) {
    if let Some(path) = settings_path {
        if let Err(error) = save_settings(path, settings) {
            eprintln!("Failed to save settings to {}: {error}", path.display());
        }
    }
}

fn run_app() -> Result<(), Box<dyn Error>> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("Leaf Text")
        .with_window_icon(load_window_icon())
        .with_inner_size(LogicalSize::new(1080.0, 820.0))
        .with_min_inner_size(LogicalSize::new(380.0, 480.0))
        .build(&event_loop)?;

    let proxy = event_loop.create_proxy();
    let handler = ipc_handler(proxy.clone());
    let drag_drop_handler = drag_drop_handler(proxy.clone());
    let local_image_source_dir = Arc::new(Mutex::new(None::<PathBuf>));
    let (mut web_context, webview_data_dir) = create_webview_context()?;
    if let Some(path) = &webview_data_dir {
        eprintln!("Using WebView2 user data folder: {}", path.display());
    }

    // Load the persisted UI toggles and hand them to the webview as an
    // initialization script, which runs before any page script. That lets the
    // theme bootstrap and library pane render from the saved state on the first
    // paint — no flash of defaults, no post-load re-apply.
    let settings_path = settings_file_path();
    let mut settings = settings_path
        .as_ref()
        .map(load_settings)
        .unwrap_or_default();

    // Load the recent files now so they can ride in on the same initialization
    // script as the settings. Injecting them after the build (via
    // evaluate_script) raced the async page load and the recent list could come
    // up empty when the page bootstrap ran last.
    let config_path = config_file_path();
    let mut recent = config_path
        .as_ref()
        .map(load_recent_files)
        .unwrap_or_default();

    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_html(app_shell_html())
        .with_initialization_script(initial_settings_script(&settings))
        .with_initialization_script(initial_state_script(&recent.files))
        .with_custom_protocol(
            LOCAL_IMAGE_PROTOCOL.to_string(),
            local_image_protocol_handler(Arc::clone(&local_image_source_dir)),
        )
        .with_custom_protocol(
            LOCAL_ASSET_PROTOCOL.to_string(),
            bundled_asset_protocol_handler(),
        )
        .with_ipc_handler(handler)
        .with_drag_drop_handler(drag_drop_handler)
        .with_on_page_load_handler({
            let proxy = proxy.clone();
            move |event, _url| {
                if matches!(event, PageLoadEvent::Finished) {
                    let _ = proxy.send_event(UserEvent::WebviewReady);
                }
            }
        });

    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let webview = builder.build(&window)?;

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;

        let vbox = window.default_vbox().expect("GTK window vbox");
        builder.build_gtk(vbox)?
    };

    let mut workspace = Workspace::default();

    update_active_navigation(Some(&webview), &workspace);

    // A file passed on the command line (Explorer "Open with", double-click, or a
    // shell invocation) waits here until the webview reports its first page load
    // finished. Sending OpenPath now would render the document via evaluate_script
    // before the page's JS hooks exist, so it would silently land on the home
    // screen. WebviewReady flushes it once the page is ready.
    let mut pending_open_path = env::args_os().nth(1).map(PathBuf::from);

    let mut webview = Some(webview);
    let _web_context = web_context;
    let mut file_watch = FileWatch::new(proxy.clone());

    // The background library indexer. It owns its own SQLite connections and
    // threads; the worker posts results back as `UserEvent::Indexer`. The
    // frontend requests the existing tree on boot; the host starts the launch
    // rescan below when the persisted setting has indexing enabled.
    let indexer = app_data_dir().and_then(|data_dir| {
        let proxy = proxy.clone();
        match IndexerWorker::new(data_dir, move |event: IndexerEvent| {
            let _ = proxy.send_event(UserEvent::Indexer(event));
        }) {
            Ok(worker) => Some(worker),
            Err(error) => {
                eprintln!("Library indexer unavailable: {error}");
                None
            }
        }
    });

    // Start the launch rescan now if the user left indexing on. The host owns
    // this setting, so it no longer waits for a JS round-trip on boot.
    if settings.indexing_enabled {
        if let Some(indexer) = indexer.as_ref() {
            indexer.set_indexing_enabled(true);
        }
    }

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let _ = webview.take();
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(UserEvent::OpenPicker) => {
                if let Some(path) = pick_markdown_file() {
                    index_opened_path(indexer.as_ref(), &path);
                    workspace.open_path(path);
                    render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Reset,
                    );
                }
            }
            Event::UserEvent(UserEvent::OpenPath(path)) => {
                index_opened_path(indexer.as_ref(), &path);
                workspace.open_path(path);
                render_active(
                    &window,
                    webview.as_ref(),
                    &mut workspace,
                    &mut recent,
                    config_path.as_ref(),
                    &local_image_source_dir,
                    ScrollIntent::Reset,
                );
            }
            Event::UserEvent(UserEvent::WebviewReady) => {
                if let Some(path) = pending_open_path.take() {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
            }
            Event::UserEvent(UserEvent::RevealPath(path)) => {
                if let Err(error) = reveal_in_file_manager(&path) {
                    eprintln!(
                        "Failed to reveal {} in the file manager: {error}",
                        path.display()
                    );
                }
            }
            Event::UserEvent(UserEvent::CopyFileToClipboard { path, cut }) => {
                if let Err(error) = copy_file_to_clipboard(&path, cut) {
                    eprintln!(
                        "Failed to copy {} to the clipboard: {error}",
                        path.display()
                    );
                }
            }
            Event::UserEvent(UserEvent::CopyPathToClipboard(path)) => {
                if let Err(error) = copy_path_to_clipboard(&path) {
                    eprintln!(
                        "Failed to copy the path {} to the clipboard: {error}",
                        path.display()
                    );
                }
            }
            Event::UserEvent(UserEvent::RenamePath { path, new_name }) => {
                match rename_file(&path, &new_name) {
                    Ok(renamed) => {
                        // Drop the old entry and index the new one so the pane
                        // updates without waiting for a crawl.
                        if let Some(indexer) = indexer.as_ref() {
                            indexer.sync_path(path.clone());
                            indexer.sync_path(renamed);
                        }
                    }
                    Err(error) => {
                        eprintln!("Failed to rename {}: {error}", path.display());
                    }
                }
            }
            Event::UserEvent(UserEvent::DeletePath(path)) => match delete_to_trash(&path) {
                Ok(()) => {
                    // The file is gone; forget it so it leaves the pane at once.
                    if let Some(indexer) = indexer.as_ref() {
                        indexer.sync_path(path);
                    }
                }
                Err(error) => {
                    eprintln!("Failed to move {} to the trash: {error}", path.display());
                }
            },
            Event::UserEvent(UserEvent::ShowProperties(path)) => {
                if let Err(error) = show_properties(&path) {
                    eprintln!("Failed to show properties for {}: {error}", path.display());
                }
            }
            Event::UserEvent(UserEvent::CloseTab { index }) => {
                workspace.close_tab(index);
                render_active(
                    &window,
                    webview.as_ref(),
                    &mut workspace,
                    &mut recent,
                    config_path.as_ref(),
                    &local_image_source_dir,
                    ScrollIntent::Reset,
                );
            }
            Event::UserEvent(UserEvent::SwitchTab {
                index,
                scroll_anchor,
            }) => {
                // Clicking the tab that is already active must be a no-op: no
                // re-render, no scroll restore. Re-rendering the same document
                // jumps the reader, which is exactly what the click shouldn't do.
                if workspace.active == Some(index) {
                    return;
                }
                if let Some(active) = workspace.active {
                    if let Some(tab) = workspace.tabs.get_mut(active) {
                        tab.saved_scroll_anchor = Some(scroll_anchor);
                    }
                }
                if workspace.set_active(index) {
                    // Reopen the tab where the reader last left it. `None` the
                    // first time we visit, which starts at the top. Restoring as
                    // part of the render avoids racing a reset-to-top in a
                    // separate frame.
                    let saved = workspace
                        .tabs
                        .get(index)
                        .and_then(|t| t.saved_scroll_anchor.clone());
                    render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Restore(saved),
                    );
                }
            }
            Event::UserEvent(UserEvent::MoveTab { from, to }) => {
                if workspace.move_tab(from, to) {
                    // Only the tab order changed; keep the reader in place
                    // rather than snapping the active document back to the top.
                    render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Preserve,
                    );
                }
            }
            Event::UserEvent(UserEvent::GoHome) => {
                workspace.go_home();
                render_active(
                    &window,
                    webview.as_ref(),
                    &mut workspace,
                    &mut recent,
                    config_path.as_ref(),
                    &local_image_source_dir,
                    ScrollIntent::Reset,
                );
            }
            Event::UserEvent(UserEvent::OpenLink {
                href,
                scroll_anchor,
            }) => {
                let Some(active) = workspace.active else {
                    return;
                };
                let Some(current_path) = workspace.tabs[active].history.current().cloned() else {
                    return;
                };
                // "Open the full glossary" sends a bare `glossary:` link; resolve it
                // to the nearest GLOSSARY.md and open that file as an ordinary tab.
                if glossary_scheme_slug(&href).is_some() {
                    match nearest_glossary_file(&current_path) {
                        Some(path) if !paths_refer_to_same_document(&path, &current_path) => {
                            index_opened_path(indexer.as_ref(), &path);
                            workspace.tabs[active].scroll_history.clear();
                            workspace.tabs[active].history.record(path);
                            render_active(
                                &window,
                                webview.as_ref(),
                                &mut workspace,
                                &mut recent,
                                config_path.as_ref(),
                                &local_image_source_dir,
                                ScrollIntent::Reset,
                            );
                        }
                        Some(_) => {}
                        None => {
                            eprintln!("No GLOSSARY.md found above {}", current_path.display());
                        }
                    }
                    return;
                }
                match classify_link_target(&href) {
                    LinkTarget::AnchorOnly => {
                        if let Some(fragment) = fragment_from_href(&href) {
                            workspace.tabs[active].scroll_history.record(scroll_anchor);
                            update_active_navigation(webview.as_ref(), &workspace);
                            scroll_to_fragment(webview.as_ref(), &fragment);
                        }
                    }
                    LinkTarget::External(target) | LinkTarget::LocalNonMarkdown(target) => {
                        if let Err(error) = open_with_os(&target) {
                            eprintln!("Failed to open {target} with the OS: {error}");
                        }
                    }
                    LinkTarget::LocalMarkdown(target) => {
                        let path = path_from_local_link(&target, &current_path);
                        if paths_refer_to_same_document(&path, &current_path) {
                            if let Some(fragment) = fragment_from_href(&target) {
                                workspace.tabs[active].scroll_history.record(scroll_anchor);
                                update_active_navigation(webview.as_ref(), &workspace);
                                scroll_to_fragment(webview.as_ref(), &fragment);
                            }
                            return;
                        }
                        index_opened_path(indexer.as_ref(), &path);
                        workspace.tabs[active].scroll_history.clear();
                        workspace.tabs[active].history.record(path);
                        render_active(
                            &window,
                            webview.as_ref(),
                            &mut workspace,
                            &mut recent,
                            config_path.as_ref(),
                            &local_image_source_dir,
                            ScrollIntent::Reset,
                        );
                        if let Some(fragment) = fragment_from_href(&target) {
                            scroll_to_fragment(webview.as_ref(), &fragment);
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::OpenGlossary { href }) => {
                let Some(active) = workspace.active else {
                    return;
                };
                let Some(current_path) = workspace.tabs[active].history.current().cloned() else {
                    return;
                };
                show_glossary_entry(webview.as_ref(), &href, &current_path);
            }
            Event::UserEvent(UserEvent::GoBack { scroll_anchor }) => {
                let Some(active) = workspace.active else {
                    return;
                };
                let restored = {
                    let tab = &mut workspace.tabs[active];
                    if let Some(scroll_position) = tab.scroll_history.back(scroll_anchor) {
                        Some(scroll_position)
                    } else if tab.history.can_go_back() {
                        tab.history.go_back();
                        None
                    } else {
                        return;
                    }
                };
                match restored {
                    Some(scroll_position) => {
                        restore_scroll_anchor(webview.as_ref(), &scroll_position);
                        update_active_navigation(webview.as_ref(), &workspace);
                    }
                    None => render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Reset,
                    ),
                }
            }
            Event::UserEvent(UserEvent::GoForward { scroll_anchor }) => {
                let Some(active) = workspace.active else {
                    return;
                };
                let restored = {
                    let tab = &mut workspace.tabs[active];
                    if let Some(scroll_position) = tab.scroll_history.forward(scroll_anchor) {
                        Some(scroll_position)
                    } else if tab.history.can_go_forward() {
                        tab.history.go_forward();
                        None
                    } else {
                        return;
                    }
                };
                match restored {
                    Some(scroll_position) => {
                        restore_scroll_anchor(webview.as_ref(), &scroll_position);
                        update_active_navigation(webview.as_ref(), &workspace);
                    }
                    None => render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Reset,
                    ),
                }
            }
            Event::UserEvent(UserEvent::FileChanged(changed)) => {
                // A directory watch reports the active document and its siblings.
                // The active document live-reloads its rendered view; a sibling
                // change instead (re)indexes that path so the library pane stays
                // in sync — this is how a file newly created in the folder shows
                // up without waiting for a full device rescan.
                let is_active_document = workspace
                    .active
                    .and_then(|index| workspace.tabs.get(index))
                    .and_then(|tab| tab.history.current())
                    .is_some_and(|current| paths_refer_to_same_document(&changed, current));
                if is_active_document {
                    reload_active_document(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &recent,
                        &mut file_watch,
                        &local_image_source_dir,
                    );
                } else {
                    index_opened_path(indexer.as_ref(), &changed);
                }
            }
            Event::UserEvent(UserEvent::SetIndexingEnabled { enabled }) => {
                if let Some(indexer) = indexer.as_ref() {
                    indexer.set_indexing_enabled(enabled);
                }
                settings.indexing_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetMinimapEnabled { enabled }) => {
                settings.minimap_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetPagerEnabled { enabled }) => {
                settings.pager_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetSpeedReaderEnabled { enabled }) => {
                settings.speed_reader_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetThemeMode { mode }) => {
                settings.theme_mode = mode;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetWindowChrome {
                r,
                g,
                b,
                border_r,
                border_g,
                border_b,
                dark,
            }) => {
                apply_window_chrome(&window, r, g, b, border_r, border_g, border_b, dark);
            }
            Event::UserEvent(UserEvent::SetLibraryState {
                view,
                expanded,
                project_path,
            }) => {
                if let Some(view) = LibraryView::from_client(&view) {
                    settings.library_view = view;
                }
                settings.library_expanded = expanded;
                settings.library_project_path = project_path;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetLibraryLayout { closed, width }) => {
                settings.library_closed = closed;
                settings.library_width = width;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::GetFileTree) => {
                if let Some(indexer) = indexer.as_ref() {
                    indexer.request_tree();
                }
            }
            Event::UserEvent(UserEvent::Search { query }) => {
                if let Some(indexer) = indexer.as_ref() {
                    indexer.search(query);
                }
            }
            Event::UserEvent(UserEvent::LoadPager { path }) => {
                let proxy = proxy.clone();
                thread::spawn(move || {
                    let html = document_pager_html(&path);
                    let _ = proxy.send_event(UserEvent::PagerLoaded { path, html });
                });
            }
            Event::UserEvent(UserEvent::PagerLoaded { path, html }) => {
                let is_active_document = workspace
                    .active
                    .and_then(|index| workspace.tabs.get(index))
                    .and_then(|tab| tab.history.current())
                    .is_some_and(|current| paths_refer_to_same_document(&path, current));
                if is_active_document {
                    if let Some(webview) = webview.as_ref() {
                        if let Err(error) =
                            webview.evaluate_script(&pager_loaded_script(&path, &html))
                        {
                            eprintln!("Failed to update document pager: {error}");
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::Indexer(indexer_event)) => {
                if let Some(webview) = webview.as_ref() {
                    if let Err(error) = webview.evaluate_script(&event_script(&indexer_event)) {
                        eprintln!("Failed to update library view: {error}");
                    }
                }
            }
            _ => {}
        }

        // Keep the watcher pointed at whatever document is now active and at the
        // folder Project view is browsing, so the open file live-reloads and
        // files added to the browsed folder appear without a relaunch. Cheap on
        // every event: a no-op unless one of those changed since the last sync.
        let active_path = workspace
            .active
            .and_then(|index| workspace.tabs.get(index))
            .and_then(|tab| tab.history.current())
            .map(PathBuf::as_path);
        let project_dir = (settings.library_view == LibraryView::Project
            && !settings.library_project_path.is_empty())
        .then(|| Path::new(&settings.library_project_path));
        file_watch.sync(active_path, project_dir);
    });
}

fn startup_failure_message(error: &dyn Error) -> String {
    let error_text = error.to_string();
    if error_text.contains("0x80070005") || error_text.contains("Access is denied") {
        let webview_data_dir = webview_user_data_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "the per-user Leaf Text data folder".to_string());
        return format!(
            "Leaf Text could not start.\n\n{error}\n\nWebView2 could not access its per-user browser data folder:\n{webview_data_dir}\n\nMake sure your Windows account can write to that folder, then try launching Leaf Text again."
        );
    }

    format!(
        "Leaf Text could not start.\n\n{error}\n\nIf this happens on Windows, make sure the Microsoft Edge WebView2 Runtime is installed and try launching Leaf Text again."
    )
}

fn create_webview_context() -> Result<(WebContext, Option<PathBuf>), Box<dyn Error>> {
    let data_dir = webview_user_data_dir();
    if let Some(path) = &data_dir {
        fs::create_dir_all(path)?;
    }
    Ok((WebContext::new(data_dir.clone()), data_dir))
}

fn local_image_protocol_handler(
    source_dir: Arc<Mutex<Option<PathBuf>>>,
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_webview_id, request| {
        let source_dir = source_dir.lock().ok().and_then(|guard| guard.clone());
        let image = local_image_protocol_response(
            request.uri().to_string().as_str(),
            source_dir.as_deref(),
        );
        Response::builder()
            .status(image.status)
            .header("Content-Type", image.content_type)
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(image.body))
            .expect("local image protocol response builds")
    }
}

// Serves the binary's bundled mermaid/KaTeX assets so diagrams and math render
// offline — no CDN.
fn bundled_asset_protocol_handler(
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_webview_id, request| {
        let asset = bundled_asset_response(request.uri().to_string().as_str());
        Response::builder()
            .status(asset.status)
            .header("Content-Type", asset.content_type)
            .header("Cache-Control", "max-age=31536000, immutable")
            .body(asset.body)
            .expect("bundled asset protocol response builds")
    }
}

fn update_local_image_source_dir(state: &Arc<Mutex<Option<PathBuf>>>, source_dir: Option<PathBuf>) {
    if let Ok(mut current) = state.lock() {
        *current = source_dir;
    }
}

fn show_startup_error(message: &str) {
    let _ = rfd::MessageDialog::new()
        .set_title("Leaf Text could not start")
        .set_description(message)
        .set_level(rfd::MessageLevel::Error)
        .show();
}

fn ipc_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(Request<String>) {
    move |request| {
        let Ok(command) = serde_json::from_str::<IpcCommand>(request.body()) else {
            return;
        };

        match command {
            IpcCommand::Open => {
                let _ = proxy.send_event(UserEvent::OpenPicker);
            }
            IpcCommand::OpenRecent { path } => {
                let _ = proxy.send_event(UserEvent::OpenPath(path));
            }
            IpcCommand::RevealFile { path } => {
                let _ = proxy.send_event(UserEvent::RevealPath(path));
            }
            IpcCommand::CopyFile { path, cut } => {
                let _ = proxy.send_event(UserEvent::CopyFileToClipboard { path, cut });
            }
            IpcCommand::CopyPath { path } => {
                let _ = proxy.send_event(UserEvent::CopyPathToClipboard(path));
            }
            IpcCommand::RenameFile { path, new_name } => {
                let _ = proxy.send_event(UserEvent::RenamePath { path, new_name });
            }
            IpcCommand::DeleteFile { path } => {
                let _ = proxy.send_event(UserEvent::DeletePath(path));
            }
            IpcCommand::ShowProperties { path } => {
                let _ = proxy.send_event(UserEvent::ShowProperties(path));
            }
            IpcCommand::CloseTab { index } => {
                let _ = proxy.send_event(UserEvent::CloseTab { index });
            }
            IpcCommand::SwitchTab {
                index,
                scroll_anchor,
            } => {
                let _ = proxy.send_event(UserEvent::SwitchTab {
                    index,
                    scroll_anchor,
                });
            }
            IpcCommand::MoveTab { from, to } => {
                let _ = proxy.send_event(UserEvent::MoveTab { from, to });
            }
            IpcCommand::GoHome => {
                let _ = proxy.send_event(UserEvent::GoHome);
            }
            IpcCommand::OpenLink {
                href,
                scroll_anchor,
            } => {
                let _ = proxy.send_event(UserEvent::OpenLink {
                    href,
                    scroll_anchor,
                });
            }
            IpcCommand::OpenGlossary { href } => {
                let _ = proxy.send_event(UserEvent::OpenGlossary { href });
            }
            IpcCommand::GoBack { scroll_anchor } => {
                let _ = proxy.send_event(UserEvent::GoBack { scroll_anchor });
            }
            IpcCommand::GoForward { scroll_anchor } => {
                let _ = proxy.send_event(UserEvent::GoForward { scroll_anchor });
            }
            IpcCommand::SetIndexingEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetIndexingEnabled { enabled });
            }
            IpcCommand::SetMinimapEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetMinimapEnabled { enabled });
            }
            IpcCommand::SetPagerEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetPagerEnabled { enabled });
            }
            IpcCommand::SetSpeedReaderEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetSpeedReaderEnabled { enabled });
            }
            IpcCommand::SetThemeMode { mode } => {
                let _ = proxy.send_event(UserEvent::SetThemeMode { mode });
            }
            IpcCommand::SetWindowChrome {
                r,
                g,
                b,
                border_r,
                border_g,
                border_b,
                dark,
            } => {
                let _ = proxy.send_event(UserEvent::SetWindowChrome {
                    r,
                    g,
                    b,
                    border_r,
                    border_g,
                    border_b,
                    dark,
                });
            }
            IpcCommand::SetLibraryState {
                view,
                expanded,
                project_path,
            } => {
                let _ = proxy.send_event(UserEvent::SetLibraryState {
                    view,
                    expanded,
                    project_path,
                });
            }
            IpcCommand::SetLibraryLayout { closed, width } => {
                let _ = proxy.send_event(UserEvent::SetLibraryLayout { closed, width });
            }
            IpcCommand::GetFileTree => {
                let _ = proxy.send_event(UserEvent::GetFileTree);
            }
            IpcCommand::Search { query } => {
                let _ = proxy.send_event(UserEvent::Search { query });
            }
            IpcCommand::LoadPager { path } => {
                let _ = proxy.send_event(UserEvent::LoadPager { path });
            }
        }
    }
}

fn pick_markdown_file() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Open Document")
        .add_filter("Documents", &["md", "markdown", "mdown", "xml"])
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .add_filter("TEI XML", &["xml"])
        .add_filter("All files", &["*"])
        .pick_file()
}

/// Handle files dragged from the OS onto the window: open each Markdown file as
/// a tab. We always return `true` to block the webview's default drop behavior,
/// which otherwise shows a "copy" cursor and does nothing useful.
fn drag_drop_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(DragDropEvent) -> bool {
    move |event| {
        if let DragDropEvent::Drop { paths, .. } = event {
            for path in paths {
                if is_markdown_path(&path) {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
            }
        }
        true
    }
}

/// True when `path` has an extension we know how to open. Matches the
/// extensions offered by the file picker so drag-and-drop and Open agree.
fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "xml"
            )
        })
}

/// One open document tab: its own back/forward history, scroll history, and a
/// cached title used to label the tab even while it is not the active tab.
#[derive(Debug, Default)]
struct Tab {
    history: DocumentHistory,
    scroll_history: ScrollHistory,
    title: String,
    saved_scroll_anchor: Option<ScrollAnchor>,
}

/// The set of open tabs plus which one is active. `active` is `None` when the
/// home screen is showing; the tabs stay open so the user can return to them.
#[derive(Debug, Default)]
struct Workspace {
    tabs: Vec<Tab>,
    active: Option<usize>,
}

impl Workspace {
    /// Open `path` as a tab. If a tab is already showing that document, just
    /// activate it; otherwise append a new tab seeded with that document.
    fn open_path(&mut self, path: PathBuf) {
        if let Some(index) = self.tabs.iter().position(|tab| {
            tab.history
                .current()
                .is_some_and(|current| paths_refer_to_same_document(current, &path))
        }) {
            self.active = Some(index);
            return;
        }

        let mut tab = Tab {
            title: tab_title_from_path(&path),
            ..Tab::default()
        };
        tab.history.record(path);
        self.tabs.push(tab);
        self.active = Some(self.tabs.len() - 1);
    }

    /// Close the tab at `index`, then pick a sensible neighbour as active (or
    /// the home screen when no tabs remain).
    fn close_tab(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        self.tabs.remove(index);
        if self.tabs.is_empty() {
            self.active = None;
            return;
        }
        self.active = match self.active {
            Some(active) if active == index => Some(index.min(self.tabs.len() - 1)),
            Some(active) if active > index => Some(active - 1),
            other => other,
        };
    }

    /// Reorder tabs by pulling the tab at `from` out and inserting it at `to`.
    /// The active document follows its slot so the same tab stays selected.
    /// Returns `false` when either index is out of range or nothing moves.
    fn move_tab(&mut self, from: usize, to: usize) -> bool {
        if from >= self.tabs.len() || to >= self.tabs.len() || from == to {
            return false;
        }
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
        if let Some(active) = self.active {
            // Track where the previously active slot lands after remove + insert.
            let after_remove = if active > from { active - 1 } else { active };
            self.active = Some(if active == from {
                to
            } else if after_remove >= to {
                after_remove + 1
            } else {
                after_remove
            });
        }
        true
    }

    /// Make tab `index` active. Returns `false` when the index is out of range.
    fn set_active(&mut self, index: usize) -> bool {
        if index < self.tabs.len() {
            self.active = Some(index);
            true
        } else {
            false
        }
    }

    /// Show the home screen without closing any tabs.
    fn go_home(&mut self) {
        self.active = None;
    }

    /// `(title, path)` for each tab, in tab-bar order, for the webview state.
    fn tab_summaries(&self) -> Vec<(String, String)> {
        self.tabs
            .iter()
            .map(|tab| {
                let path = tab
                    .history
                    .current()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default();
                (tab.title.clone(), path)
            })
            .collect()
    }
}

/// Fallback tab label (file stem) used until the document title is known.
fn tab_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

/// Watches the folders whose changes matter and turns filesystem changes into
/// `UserEvent::FileChanged`: the active document's directory (so the open file
/// live-reloads) and, in Project view, the folder being browsed (so files added
/// or removed there appear without waiting for the next launch crawl). Watching
/// the parent directory rather than the file itself survives editors that save
/// by writing a temp file and renaming over the original (the original file
/// handle would otherwise go stale).
///
/// `active_hash` is the hash of the contents last rendered for the active
/// document; it lets the reload path skip redundant work when a duplicate or
/// spurious event arrives for contents that did not actually change.
struct FileWatch {
    debouncer: Option<Debouncer<RecommendedWatcher>>,
    last_active: Option<PathBuf>,
    /// Directories currently registered with the watcher, each mapped to the
    /// recursive mode it was registered under. Recomputed on every `sync`; the
    /// diff against the freshly desired set is what gets (un)watched.
    watched: HashMap<PathBuf, RecursiveMode>,
    active_hash: Option<u64>,
}

impl FileWatch {
    fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        // A short debounce coalesces the burst of events most editors emit for a
        // single save into one reload. It is a coalescing window, not a throttle,
        // so keep it small enough that the reload still feels immediate.
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    for event in events {
                        let _ = proxy.send_event(UserEvent::FileChanged(event.path));
                    }
                }
            },
        );
        let debouncer = match debouncer {
            Ok(debouncer) => Some(debouncer),
            Err(error) => {
                eprintln!("Live reload disabled: could not start file watcher: {error}");
                None
            }
        };
        Self {
            debouncer,
            last_active: None,
            watched: HashMap::new(),
            active_hash: None,
        }
    }

    /// Point the watcher at the directories whose changes matter: the active
    /// document's folder and, when given, the Project view's current folder
    /// (watched recursively so files added in any subfolder surface too). Cheap
    /// to call after every event: it diffs the desired set against what is
    /// already watched and returns without touching the watcher when nothing
    /// changed.
    fn sync(&mut self, active_path: Option<&Path>, project_dir: Option<&Path>) {
        if active_path != self.last_active.as_deref() {
            // The active document changed, so the stored hash no longer describes
            // what is on screen; force the next reload to render.
            self.active_hash = None;
            self.last_active = active_path.map(Path::to_path_buf);
        }

        let desired = desired_watches(active_path, project_dir);
        if desired == self.watched {
            return;
        }

        // Collect the changes before borrowing the debouncer so the watcher's
        // mutable borrow does not overlap the immutable borrow of `watched`.
        let to_unwatch: Vec<PathBuf> = self
            .watched
            .iter()
            .filter(|(path, mode)| desired.get(*path) != Some(*mode))
            .map(|(path, _)| path.clone())
            .collect();
        let to_watch: Vec<(PathBuf, RecursiveMode)> = desired
            .iter()
            .filter(|(path, mode)| self.watched.get(*path) != Some(*mode))
            .map(|(path, mode)| (path.clone(), *mode))
            .collect();

        if let Some(debouncer) = self.debouncer.as_mut() {
            for path in &to_unwatch {
                let _ = debouncer.watcher().unwatch(path);
            }
            for (path, mode) in &to_watch {
                if let Err(error) = debouncer.watcher().watch(path, *mode) {
                    eprintln!("Live reload: failed to watch {}: {error}", path.display());
                }
            }
        }
        self.watched = desired;
    }
}

/// The set of directories to watch and the recursive mode for each: the Project
/// view's folder recursively (so a file added anywhere under it surfaces), plus
/// the active document's own folder when a recursive watch does not already
/// cover it. Returning a map lets [`FileWatch::sync`] diff against what is
/// currently watched and only touch what changed.
fn desired_watches(
    active_path: Option<&Path>,
    project_dir: Option<&Path>,
) -> HashMap<PathBuf, RecursiveMode> {
    let mut desired = HashMap::new();
    if let Some(dir) = project_dir.and_then(watch_folder) {
        desired.insert(dir, RecursiveMode::Recursive);
    }
    if let Some(dir) = active_path.and_then(watch_dir_for) {
        let covered = desired.iter().any(|(watched, mode)| {
            matches!(mode, RecursiveMode::Recursive) && dir.starts_with(watched)
        });
        if !covered {
            desired.entry(dir).or_insert(RecursiveMode::NonRecursive);
        }
    }
    desired
}

/// The directory to watch for a document: its parent, canonicalized so repeated
/// spellings of the same folder compare equal. `None` when the path has no
/// usable parent (so we never fall back to watching a huge ancestor like root).
fn watch_dir_for(path: &Path) -> Option<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())?;
    Some(fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()))
}

/// Canonicalize a folder to watch directly (not its parent). `None` for an empty
/// path or one that is not a directory — e.g. the empty Project root or a stale
/// folder that has since been removed — so a doomed watch is never attempted.
fn watch_folder(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return None;
    }
    Some(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// Stable-within-a-run hash of file contents, used only to detect whether a
/// changed-on-disk document actually differs from what is already rendered.
/// Not cryptographic and not persisted, so the standard hasher is sufficient.
fn content_hash(contents: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    contents.hash(&mut hasher);
    hasher.finish()
}

/// Re-render the active document from its current on-disk contents while
/// preserving the reader's scroll position. Reads the file once and hash-gates:
/// if the contents match what was last rendered (a duplicate or spurious
/// filesystem event), nothing is re-rendered.
fn reload_active_document(
    window: &tao::window::Window,
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    recent: &RecentFiles,
    file_watch: &mut FileWatch,
    local_image_source_dir_state: &Arc<Mutex<Option<PathBuf>>>,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(path) = workspace
        .tabs
        .get(index)
        .and_then(|tab| tab.history.current().cloned())
    else {
        return;
    };

    let markdown = match fs::read_to_string(&path) {
        Ok(markdown) => markdown,
        // The file may be mid-save or briefly absent during an atomic rename; a
        // later event will deliver the settled contents, so skip this one.
        Err(error) => {
            eprintln!("Live reload: failed to read {}: {error}", path.display());
            return;
        }
    };

    let hash = content_hash(&markdown);
    if file_watch.active_hash == Some(hash) {
        return;
    }
    file_watch.active_hash = Some(hash);

    let document = opened_document_from_markdown(&markdown, &path);
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.title = document.title.clone();
    }
    window.set_title(&format!("{} - Leaf Text", document.title));

    let image_source_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
    update_local_image_source_dir(
        local_image_source_dir_state,
        local_image_source_dir(&image_source_path),
    );

    let tabs = workspace.tab_summaries();
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&workspace_reload_script(
            &recent.files,
            &tabs,
            Some(index),
            Some(&document),
        )) {
            eprintln!("Live reload: failed to update document view: {error}");
        }
    }
}

/// How the reader's scroll position should behave when a render replaces the
/// document view.
#[derive(Clone)]
enum ScrollIntent {
    /// Jump to the top of the freshly rendered document (opening a new file,
    /// navigating history, returning home).
    Reset,
    /// Keep the reader exactly where it is. Used when the active document does
    /// not change, only its surroundings (e.g. reordering tabs).
    Preserve,
    /// Restore a saved anchor after rendering. Used when switching to a tab so
    /// it reopens where the reader last left it; `None` lands at the top, used
    /// the first time a tab is visited.
    Restore(Option<ScrollAnchor>),
}

/// Render the active tab's document (or the home screen) into the webview and
/// refresh the tab bar, window title, image source dir, and navigation buttons.
fn render_active(
    window: &tao::window::Window,
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    recent: &mut RecentFiles,
    config_path: Option<&PathBuf>,
    local_image_source_dir_state: &Arc<Mutex<Option<PathBuf>>>,
    scroll: ScrollIntent,
) {
    match workspace.active {
        Some(index) => {
            let Some(path) = workspace
                .tabs
                .get(index)
                .and_then(|tab| tab.history.current().cloned())
            else {
                workspace.active = None;
                return render_active(
                    window,
                    webview,
                    workspace,
                    recent,
                    config_path,
                    local_image_source_dir_state,
                    scroll,
                );
            };
            match open_document_with_recent(&path, recent, config_path.map(PathBuf::as_path)) {
                Ok(success) => {
                    if let Some(tab) = workspace.tabs.get_mut(index) {
                        tab.title = success.document.title.clone();
                    }
                    window.set_title(&format!("{} - Leaf Text", success.document.title));
                    if let Some(error) = success.recent_save_error {
                        eprintln!("Failed to save recent files: {}", error.source);
                    }
                    let image_source_path =
                        fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                    update_local_image_source_dir(
                        local_image_source_dir_state,
                        local_image_source_dir(&image_source_path),
                    );
                    let tabs = workspace.tab_summaries();
                    if let Some(webview) = webview {
                        let script = match scroll {
                            ScrollIntent::Preserve => workspace_reload_script(
                                &recent.files,
                                &tabs,
                                Some(index),
                                Some(&success.document),
                            ),
                            ScrollIntent::Restore(anchor) => workspace_switch_script(
                                &recent.files,
                                &tabs,
                                Some(index),
                                Some(&success.document),
                                anchor.as_ref(),
                            ),
                            ScrollIntent::Reset => workspace_state_script(
                                &recent.files,
                                &tabs,
                                Some(index),
                                Some(&success.document),
                            ),
                        };
                        if let Err(error) = webview.evaluate_script(&script) {
                            eprintln!("Failed to update document view: {error}");
                        }
                    }
                }
                Err(error) => {
                    let failed_path = error.path().to_path_buf();
                    let reason = error.reason().to_string();
                    let missing = error.reason().kind() == io::ErrorKind::NotFound;
                    eprintln!("Failed to open {}: {}", failed_path.display(), reason);

                    // A file that no longer exists should stop being offered in
                    // Recent so the user can't keep re-triggering the same error.
                    if missing && recent.forget(&failed_path) {
                        if let Some(config_path) = config_path {
                            if let Err(save_error) = save_recent_files(config_path, recent) {
                                eprintln!("Failed to save recent files: {save_error}");
                            }
                        }
                    }

                    // Don't strand the user on a tab that can't render: drop the
                    // failed entry and fall back to the previous document, or close
                    // the tab (then a neighbour or the home screen) if it had none.
                    let recovered = workspace
                        .tabs
                        .get_mut(index)
                        .map(|tab| {
                            tab.scroll_history.clear();
                            tab.history.forget_current()
                        })
                        .unwrap_or(false);
                    if !recovered {
                        workspace.close_tab(index);
                    }

                    render_active(
                        window,
                        webview,
                        workspace,
                        recent,
                        config_path,
                        local_image_source_dir_state,
                        ScrollIntent::Reset,
                    );
                    show_open_error(webview, &failed_path, &reason);
                }
            }
        }
        None => {
            window.set_title("Leaf Text");
            update_local_image_source_dir(local_image_source_dir_state, None);
            let tabs = workspace.tab_summaries();
            if let Some(webview) = webview {
                if let Err(error) = webview.evaluate_script(&workspace_state_script(
                    &recent.files,
                    &tabs,
                    None,
                    None,
                )) {
                    eprintln!("Failed to update view: {error}");
                }
            }
        }
    }
    update_active_navigation(webview, workspace);
}

fn update_navigation(
    webview: Option<&WebView>,
    history: &DocumentHistory,
    scroll_history: &ScrollHistory,
) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&navigation_state_script(
            scroll_history.can_go_back() || history.can_go_back(),
            scroll_history.can_go_forward() || history.can_go_forward(),
        )) {
            eprintln!("Failed to update navigation state: {error}");
        }
    }
}

/// Refresh the back/forward buttons from the active tab's histories, or disable
/// them when the home screen is showing.
fn update_active_navigation(webview: Option<&WebView>, workspace: &Workspace) {
    match workspace.active.and_then(|index| workspace.tabs.get(index)) {
        Some(tab) => update_navigation(webview, &tab.history, &tab.scroll_history),
        None => {
            if let Some(webview) = webview {
                if let Err(error) = webview.evaluate_script(&navigation_state_script(false, false))
                {
                    eprintln!("Failed to update navigation state: {error}");
                }
            }
        }
    }
}

fn scroll_to_fragment(webview: Option<&WebView>, fragment: &str) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&fragment_scroll_script(fragment)) {
            eprintln!("Failed to scroll to document fragment: {error}");
        }
    }
}

/// If `href` uses the `glossary:slug` scheme, return the part after the colon
/// (the slug), with any leading `#` stripped. The slug names a glossary term and
/// carries no file path, so the file is found separately by walking up folders.
fn glossary_scheme_slug(href: &str) -> Option<String> {
    let href = href.trim();
    let rest = href
        .get(..9)
        .and_then(|prefix| prefix.eq_ignore_ascii_case("glossary:").then(|| &href[9..]))?;
    Some(percent_decode_path(rest.trim_start_matches('#')))
}

/// Find the glossary file for `current_path` by walking up its folders to the
/// nearest `GLOSSARY.md`. This lets a `glossary:` link bind to the glossary of
/// whatever project the open document lives in, with no path written in the link.
/// `GLOSSARY.md` is the convention (like `README.md`); a lowercase `glossary.md`
/// is still accepted so older trees keep working on case-sensitive filesystems.
fn nearest_glossary_file(current_path: &Path) -> Option<PathBuf> {
    let mut dir = current_path.parent();
    while let Some(folder) = dir {
        for name in ["GLOSSARY.md", "glossary.md"] {
            let candidate = folder.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        dir = folder.parent();
    }
    None
}

/// Read the glossary file for `href` (the nearest `GLOSSARY.md` for a `glossary:`
/// link, or the path of a real `…/GLOSSARY.md#slug` link resolved against the
/// active document) and show the matching term in the bottom sheet. Reading or
/// render failures are logged and leave the sheet untouched, so a broken glossary
/// link never disrupts the open document.
fn show_glossary_entry(webview: Option<&WebView>, href: &str, current_path: &Path) {
    let Some(webview) = webview else {
        return;
    };
    let (path, anchor) = if let Some(slug) = glossary_scheme_slug(href) {
        match nearest_glossary_file(current_path) {
            Some(path) => (path, slug),
            None => {
                eprintln!("No GLOSSARY.md found above {}", current_path.display());
                return;
            }
        }
    } else {
        (
            path_from_local_link(href, current_path),
            fragment_from_href(href).unwrap_or_default(),
        )
    };
    let markdown = match fs::read_to_string(&path) {
        Ok(markdown) => markdown,
        Err(error) => {
            eprintln!("Failed to read glossary {}: {error}", path.display());
            return;
        }
    };
    let rendered = render_markdown_document(&markdown, &path);
    if let Err(error) = webview.evaluate_script(&glossary_sheet_script(&rendered.html, &anchor)) {
        eprintln!("Failed to show glossary entry: {error}");
    }
}

fn restore_scroll_anchor(webview: Option<&WebView>, anchor: &ScrollAnchor) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&scroll_anchor_script(anchor)) {
            eprintln!("Failed to restore document scroll position: {error}");
        }
    }
}

#[derive(Debug, Default)]
struct DocumentHistory {
    entries: Vec<PathBuf>,
    index: Option<usize>,
}

#[derive(Debug, Default)]
struct ScrollHistory {
    back_entries: Vec<ScrollAnchor>,
    forward_entries: Vec<ScrollAnchor>,
}

impl ScrollHistory {
    fn record(&mut self, anchor: ScrollAnchor) {
        self.back_entries.push(anchor);
        self.forward_entries.clear();
    }

    fn back(&mut self, current: ScrollAnchor) -> Option<ScrollAnchor> {
        let previous = self.back_entries.pop()?;
        self.forward_entries.push(current);
        Some(previous)
    }

    fn forward(&mut self, current: ScrollAnchor) -> Option<ScrollAnchor> {
        let next = self.forward_entries.pop()?;
        self.back_entries.push(current);
        Some(next)
    }

    fn clear(&mut self) {
        self.back_entries.clear();
        self.forward_entries.clear();
    }

    fn can_go_back(&self) -> bool {
        !self.back_entries.is_empty()
    }

    fn can_go_forward(&self) -> bool {
        !self.forward_entries.is_empty()
    }
}

impl DocumentHistory {
    fn current(&self) -> Option<&PathBuf> {
        self.index.and_then(|index| self.entries.get(index))
    }

    fn record(&mut self, path: PathBuf) {
        if self.current() == Some(&path) {
            return;
        }

        if let Some(index) = self.index {
            self.entries.truncate(index + 1);
        }
        self.entries.push(path);
        self.index = Some(self.entries.len() - 1);
    }

    fn back_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        index
            .checked_sub(1)
            .and_then(|previous| self.entries.get(previous))
    }

    fn forward_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        self.entries.get(index + 1)
    }

    fn go_back(&mut self) {
        if let Some(index) = self.index.and_then(|index| index.checked_sub(1)) {
            self.index = Some(index);
        }
    }

    /// Remove the current entry (e.g. it failed to open) and fall back to the
    /// previous document. Returns whether an entry remains to show; `false`
    /// means the history is now empty and the tab should be closed.
    fn forget_current(&mut self) -> bool {
        let Some(index) = self.index else {
            return false;
        };
        self.entries.remove(index);
        if self.entries.is_empty() {
            self.index = None;
            false
        } else {
            self.index = Some(index.saturating_sub(1).min(self.entries.len() - 1));
            true
        }
    }

    fn go_forward(&mut self) {
        if let Some(index) = self.index.filter(|index| index + 1 < self.entries.len()) {
            self.index = Some(index + 1);
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    fn clear(&mut self) {
        self.entries.clear();
        self.index = None;
    }

    fn can_go_back(&self) -> bool {
        self.back_target().is_some()
    }

    fn can_go_forward(&self) -> bool {
        self.forward_target().is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LinkTarget {
    AnchorOnly,
    External(String),
    LocalMarkdown(String),
    LocalNonMarkdown(String),
}

fn classify_link_target(href: &str) -> LinkTarget {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') || is_relative_same_document_fragment(href) {
        return LinkTarget::AnchorOnly;
    }

    if is_external_link(href) {
        return LinkTarget::External(href.to_string());
    }

    if is_markdown_link(href) {
        LinkTarget::LocalMarkdown(href.to_string())
    } else {
        LinkTarget::LocalNonMarkdown(href.to_string())
    }
}

fn is_relative_same_document_fragment(href: &str) -> bool {
    if !href.contains('#') {
        return false;
    }

    matches!(strip_query_and_fragment(href), "." | "./")
}

fn is_external_link(href: &str) -> bool {
    href.get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("http://"))
        || href
            .get(..8)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
        || href
            .get(..7)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("mailto:"))
        || href
            .get(..4)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("tel:"))
}

fn is_markdown_link(href: &str) -> bool {
    let path = local_path_from_href(href).unwrap_or_else(|| PathBuf::from(href));
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown" | "mdown")
    )
}

fn path_from_local_link(href: &str, current_path: &Path) -> PathBuf {
    let path =
        local_path_from_href(href).unwrap_or_else(|| PathBuf::from(strip_query_and_fragment(href)));
    if path.is_absolute() {
        normalize_path_lexically(path)
    } else {
        normalize_path_lexically(
            current_path
                .parent()
                .map_or(path.clone(), |parent| parent.join(path)),
        )
    }
}

fn strip_query_and_fragment(href: &str) -> &str {
    href.split(['#', '?']).next().unwrap_or(href)
}

fn fragment_from_href(href: &str) -> Option<String> {
    let fragment = href
        .split_once('#')?
        .1
        .split('?')
        .next()
        .unwrap_or_default();
    (!fragment.is_empty()).then(|| percent_decode_path(fragment))
}

fn local_path_from_href(href: &str) -> Option<PathBuf> {
    let path_text = strip_query_and_fragment(href);

    if let Ok(url) = url::Url::parse(path_text) {
        if url.scheme().eq_ignore_ascii_case("file") {
            return url.to_file_path().ok();
        }
    }

    Some(PathBuf::from(percent_decode_path(path_text)))
}

fn normalize_path_lexically(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn paths_refer_to_same_document(left: &Path, right: &Path) -> bool {
    let left =
        fs::canonicalize(left).unwrap_or_else(|_| normalize_path_lexically(left.to_path_buf()));
    let right =
        fs::canonicalize(right).unwrap_or_else(|_| normalize_path_lexically(right.to_path_buf()));
    left == right
}

fn percent_decode_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(value) = hex_pair(bytes[index + 1], bytes[index + 2]) {
                decoded.push(value);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

fn hex_pair(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn open_with_os(target: &str) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(target)
        .status()?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(target).status()?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(target).status()?;

    if status.success() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("OS opener exited with status {status}"),
        ))
    }
}

/// Open the OS file manager with `path` selected: Explorer on Windows, Finder
/// on macOS, and the freedesktop file manager (falling back to the parent
/// folder) on other Unix systems.
fn reveal_in_file_manager(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` highlights the file in a new window. Explorer
        // reports a non-zero exit code even on success, so spawning (rather than
        // waiting on the status) is the reliable way to treat it as done.
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open").arg("-R").arg(path).status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("Finder reveal exited with status {status}"),
            ))
        };
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // The freedesktop file manager interface selects the file inside its
        // folder. Many environments provide it; when it is missing or fails,
        // fall back to opening the containing folder with xdg-open.
        if let Some(uri) = url::Url::from_file_path(path)
            .ok()
            .map(|url| url.to_string())
        {
            let dbus = Command::new("dbus-send")
                .args([
                    "--session",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                ])
                .arg(format!("array:string:{uri}"))
                .arg("string:")
                .status();
            if matches!(dbus, Ok(status) if status.success()) {
                return Ok(());
            }
        }

        let folder = path.parent().unwrap_or(path);
        let status = Command::new("xdg-open").arg(folder).status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("xdg-open exited with status {status}"),
            ))
        };
    }
}

/// Put the file itself on the system clipboard so it can be pasted into the OS
/// file manager. `cut` requests move semantics (paste relocates the file) versus
/// copy. Implemented with the platform's own tooling; best-effort on Linux, whose
/// clipboard story varies by desktop.
fn copy_file_to_clipboard(path: &Path, cut: bool) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // 2 = move (cut), 5 = copy, written as the "Preferred DropEffect" the shell
        // reads on paste. `SetDataObject($_, $true)` flushes the data so it survives
        // this short-lived PowerShell exiting; clipboard access needs an STA thread.
        // Path and effect pass through env vars to avoid command-string quoting.
        const SCRIPT: &str = "Add-Type -AssemblyName System.Windows.Forms;\
            $files = New-Object System.Collections.Specialized.StringCollection;\
            [void]$files.Add($env:LEAF_CLIP_PATH);\
            $data = New-Object System.Windows.Forms.DataObject;\
            $data.SetFileDropList($files);\
            $ms = New-Object System.IO.MemoryStream;\
            $bytes = [System.BitConverter]::GetBytes([int]$env:LEAF_CLIP_EFFECT);\
            $ms.Write($bytes, 0, 4);\
            $data.SetData('Preferred DropEffect', $ms);\
            [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)";
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the helper from flashing a console window.
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_CLIP_PATH", path)
            .env("LEAF_CLIP_EFFECT", if cut { "2" } else { "5" })
            .creation_flags(0x0800_0000)
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // macOS has no clipboard "cut"; both put the file on the pasteboard (a move
        // is the user's Cmd+Opt+V on paste). Set the clipboard to the POSIX file.
        let _ = cut;
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let status = Command::new("osascript")
            .arg("-e")
            .arg(format!("set the clipboard to POSIX file \"{escaped}\""))
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("osascript exited with status {status}"),
            ))
        };
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Best-effort: many file managers read `x-special/gnome-copied-files`, a
        // leading `copy`/`cut` line followed by file URIs, via xclip.
        use std::io::Write;
        use std::process::Stdio;
        let uri = url::Url::from_file_path(path)
            .map(|url| url.to_string())
            .unwrap_or_default();
        let verb = if cut { "cut" } else { "copy" };
        let payload = format!("{verb}\n{uri}");
        let mut child = Command::new("xclip")
            .args([
                "-i",
                "-selection",
                "clipboard",
                "-t",
                "x-special/gnome-copied-files",
            ])
            .stdin(Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(payload.as_bytes())?;
        }
        child.wait()?;
        return Ok(());
    }
}

/// Copy a file's path (as text) to the clipboard.
fn copy_path_to_clipboard(path: &Path) -> io::Result<()> {
    let text = path.display().to_string();
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))
}

/// Rename a file in place. The new name must be a bare file name: empty names,
/// path separators, and the dot entries are rejected so the action can never move
/// the file or escape its folder. Returns the new path.
fn rename_file(path: &Path, new_name: &str) -> io::Result<PathBuf> {
    let trimmed = new_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "rename needs a non-empty file name with no path separators",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "the file has no parent folder")
    })?;
    let target = parent.join(trimmed);
    if target == path {
        return Ok(target);
    }
    if target.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "a file with that name already exists",
        ));
    }
    fs::rename(path, &target)?;
    Ok(target)
}

/// Move a file to the OS trash / Recycle Bin (reversible), via the `trash` crate.
fn delete_to_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|error| error.to_string())
}

/// Open the OS file-properties view: the Properties dialog on Windows, Finder's
/// Get Info on macOS, and a Reveal fallback on other Unix (no universal dialog).
fn show_properties(path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // The shell Properties verb is modal to the calling process, so the helper
        // must linger for the dialog to appear; best-effort. Path via env var.
        const SCRIPT: &str = "$p = $env:LEAF_TARGET;\
            $shell = New-Object -ComObject Shell.Application;\
            $folder = $shell.Namespace((Split-Path $p));\
            $item = $folder.ParseName((Split-Path $p -Leaf));\
            $item.InvokeVerb('Properties');\
            Start-Sleep -Seconds 3";
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps the helper from flashing a console window.
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
            .env("LEAF_TARGET", path)
            .creation_flags(0x0800_0000)
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let escaped = path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let status = Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "tell application \"Finder\" to open information window of (POSIX file \"{escaped}\")"
            ))
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::Other,
                format!("osascript exited with status {status}"),
            ))
        };
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return reveal_in_file_manager(path);
    }
}

/// Add a manually opened file to the library index, regardless of the
/// "Index entire device" toggle. The worker filters non-Markdown and unreadable
/// files itself, so this is safe to call for every open attempt.
fn index_opened_path(indexer: Option<&IndexerWorker>, path: &Path) {
    if let Some(indexer) = indexer {
        indexer.sync_path(path.to_path_buf());
    }
}

fn show_open_error(webview: Option<&WebView>, path: &std::path::Path, reason: &str) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&open_error_state_script(path, reason)) {
            eprintln!("Failed to show localized open error message: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    fn fixture_source_path(relative_path: &str) -> PathBuf {
        std::env::temp_dir()
            .join("leaf-link-fixtures")
            .join(relative_path)
    }

    fn file_url_for_fixture(relative_path: &str) -> String {
        url::Url::from_file_path(fixture_source_path(relative_path))
            .expect("fixture path has a file URL")
            .to_string()
    }

    #[test]
    fn rename_file_renames_within_the_same_folder() {
        let dir = std::env::temp_dir().join(format!(
            "leaf-rename-ok-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let original = dir.join("before.md");
        std::fs::write(&original, "# Note\n").expect("write");

        let renamed = rename_file(&original, "after.md").expect("rename succeeds");
        assert_eq!(renamed, dir.join("after.md"));
        assert!(!original.exists());
        assert!(renamed.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_file_rejects_path_traversal_and_empty_names() {
        let dir = std::env::temp_dir().join(format!(
            "leaf-rename-bad-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let original = dir.join("keep.md");
        std::fs::write(&original, "# Keep\n").expect("write");

        // Empty, dot entries, and any path separator are refused so a rename can
        // never move the file or escape its folder.
        for bad in [
            "",
            "   ",
            ".",
            "..",
            "../evil.md",
            "sub/evil.md",
            "sub\\evil.md",
        ] {
            assert!(
                rename_file(&original, bad).is_err(),
                "rename should reject {bad:?}"
            );
        }
        // The original is untouched after every rejected attempt.
        assert!(original.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn startup_failure_message_includes_recovery_hint() {
        let error = io::Error::new(io::ErrorKind::NotFound, "webview runtime missing");
        let message = startup_failure_message(&error);

        assert!(message.contains("Leaf Text could not start."));
        assert!(message.contains("webview runtime missing"));
        assert!(message.contains("Microsoft Edge WebView2 Runtime"));
    }

    #[test]
    fn startup_failure_message_identifies_webview_access_denied() {
        let error = io::Error::new(io::ErrorKind::PermissionDenied, "Access is denied.");
        let message = startup_failure_message(&error);

        assert!(message.contains("Leaf Text could not start."));
        assert!(message.contains("Access is denied."));
        assert!(message.contains("per-user browser data folder"));
        assert!(message.contains("webview2"));
        assert!(!message.contains("Microsoft Edge WebView2 Runtime"));
    }

    #[test]
    fn content_hash_distinguishes_changed_documents() {
        // Same contents hash equal (so the live-reload path skips a no-op
        // re-render); a single-character edit changes the hash (so a real save
        // is not mistaken for a duplicate event).
        assert_eq!(
            content_hash("# Title\n\nBody"),
            content_hash("# Title\n\nBody")
        );
        assert_ne!(
            content_hash("# Title\n\nBody"),
            content_hash("# Title\n\nBody!")
        );
    }

    #[test]
    fn watch_dir_for_uses_the_documents_parent_directory() {
        let dir = std::env::temp_dir().join("leaf-watch-dir-fixture");
        fs::create_dir_all(&dir).expect("fixture directory is created");
        let document = dir.join("notes.md");
        fs::write(&document, "# Notes").expect("fixture document is written");

        let watched = watch_dir_for(&document).expect("a document with a parent yields a dir");
        let expected = fs::canonicalize(&dir).unwrap_or(dir.clone());
        assert_eq!(watched, expected);

        // A bare filename has no usable parent, so nothing is watched (we never
        // fall back to watching a huge ancestor directory).
        assert_eq!(watch_dir_for(Path::new("loose.md")), None);

        fs::remove_file(&document).expect("fixture document is removed");
        fs::remove_dir_all(&dir).expect("fixture directory is removed");
    }

    #[test]
    fn desired_watches_cover_the_project_folder_and_the_open_document() {
        let root = std::env::temp_dir().join("leaf-desired-watches-fixture");
        let project = root.join("project");
        let outside = root.join("outside");
        fs::create_dir_all(&project).expect("project directory is created");
        fs::create_dir_all(&outside).expect("outside directory is created");

        let canon = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

        // A document inside the project folder is already covered by the recursive
        // watch, so the project folder is the only directory watched.
        let inside_doc = project.join("notes.md");
        let watches = desired_watches(Some(&inside_doc), Some(&project));
        assert_eq!(watches.len(), 1);
        assert_eq!(
            watches.get(&canon(&project)),
            Some(&RecursiveMode::Recursive)
        );

        // A document outside the project folder adds its own non-recursive watch.
        let outside_doc = outside.join("loose.md");
        let watches = desired_watches(Some(&outside_doc), Some(&project));
        assert_eq!(
            watches.get(&canon(&project)),
            Some(&RecursiveMode::Recursive)
        );
        assert_eq!(
            watches.get(&canon(&outside)),
            Some(&RecursiveMode::NonRecursive)
        );

        // No project folder: only the document's folder is watched, non-recursively.
        let watches = desired_watches(Some(&outside_doc), None);
        assert_eq!(watches.len(), 1);
        assert_eq!(
            watches.get(&canon(&outside)),
            Some(&RecursiveMode::NonRecursive)
        );

        // A stale (nonexistent) project path is not watched.
        let missing = root.join("does-not-exist");
        assert!(desired_watches(None, Some(&missing)).is_empty());

        fs::remove_dir_all(&root).expect("fixture directory is removed");
    }

    #[test]
    fn classifies_link_targets_for_native_opening() {
        assert_eq!(
            classify_link_target("https://example.com"),
            LinkTarget::External("https://example.com".to_string())
        );
        assert_eq!(
            classify_link_target("HTTPS://example.com"),
            LinkTarget::External("HTTPS://example.com".to_string())
        );
        assert_eq!(
            classify_link_target("file:///C:/docs/Guide.md#install"),
            LinkTarget::LocalMarkdown("file:///C:/docs/Guide.md#install".to_string())
        );
        assert_eq!(
            classify_link_target("file:///C:/docs/Nested%20Guide.MDOWN#heading"),
            LinkTarget::LocalMarkdown("file:///C:/docs/Nested%20Guide.MDOWN#heading".to_string())
        );
        assert_eq!(
            classify_link_target("../README.md#overview"),
            LinkTarget::LocalMarkdown("../README.md#overview".to_string())
        );
        assert_eq!(
            classify_link_target("file:///C:/docs/logo.png"),
            LinkTarget::LocalNonMarkdown("file:///C:/docs/logo.png".to_string())
        );
        assert_eq!(
            classify_link_target("./assets/Release%20Notes.pdf"),
            LinkTarget::LocalNonMarkdown("./assets/Release%20Notes.pdf".to_string())
        );
        assert_eq!(classify_link_target("#section"), LinkTarget::AnchorOnly);
        assert_eq!(classify_link_target("./#section"), LinkTarget::AnchorOnly);
        assert_eq!(classify_link_target(".#section"), LinkTarget::AnchorOnly);
    }

    #[test]
    fn resolves_local_markdown_links_against_current_document() {
        let current = fixture_source_path("guide/chapter/README.md");

        assert_eq!(
            path_from_local_link("./other.md#top", &current),
            fixture_source_path("guide/chapter/other.md")
        );
        assert_eq!(
            path_from_local_link("../README.md#overview", &current),
            fixture_source_path("guide/README.md")
        );
        assert_eq!(
            path_from_local_link("../Nested%20Guide.md#install", &current),
            fixture_source_path("guide/Nested Guide.md")
        );
        let nested_file_url = file_url_for_fixture("guide/Nested Guide.md");
        assert_eq!(
            path_from_local_link(&format!("{nested_file_url}#top"), &current),
            fixture_source_path("guide/Nested Guide.md")
        );
    }

    #[test]
    fn reads_the_slug_out_of_a_glossary_scheme_link() {
        assert_eq!(
            glossary_scheme_slug("glossary:karma").as_deref(),
            Some("karma")
        );
        // A leading '#' (from a within-sheet jump like `glossary:#karma`) is dropped.
        assert_eq!(
            glossary_scheme_slug("glossary:#karma").as_deref(),
            Some("karma")
        );
        // The scheme name is case-insensitive and the slug is percent-decoded.
        assert_eq!(
            glossary_scheme_slug("GLOSSARY:t%C4%ABrthikas").as_deref(),
            Some("tīrthikas")
        );
        // A bare scheme (the "open full glossary" link) yields an empty slug.
        assert_eq!(glossary_scheme_slug("glossary:").as_deref(), Some(""));
        // Ordinary links are not glossary-scheme links.
        assert_eq!(glossary_scheme_slug("../glossary.md#karma"), None);
        assert_eq!(glossary_scheme_slug("https://example.com"), None);
    }

    #[test]
    fn detects_same_document_paths_after_canonicalization() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("leaf-same-document-{unique}"));
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).expect("test directory is created");
        let document = nested.join("guide.md");
        fs::write(&document, "# Guide").expect("test document is written");

        let equivalent = nested.join("..").join("nested").join("guide.md");

        assert!(paths_refer_to_same_document(&document, &equivalent));

        fs::remove_file(&document).expect("test document is removed");
        fs::remove_dir_all(&dir).expect("test directory is removed");
    }

    #[test]
    fn extracts_decoded_link_fragments_for_webview_scrolling() {
        assert_eq!(fragment_from_href("#section"), Some("section".to_string()));
        assert_eq!(
            fragment_from_href("file.md#space%20section"),
            Some("space section".to_string())
        );
        assert_eq!(
            fragment_from_href("file:///C:/docs/Nested%20Guide.md#install"),
            Some("install".to_string())
        );
        assert_eq!(fragment_from_href("https://example.com"), None);
        assert_eq!(fragment_from_href("file.md#"), None);
    }

    #[test]
    fn document_history_tracks_back_forward_and_truncates_forward_entries() {
        let mut history = DocumentHistory::default();

        history.record(PathBuf::from("one.md"));
        history.record(PathBuf::from("two.md"));
        history.record(PathBuf::from("three.md"));

        assert!(history.can_go_back());
        assert!(!history.can_go_forward());
        assert_eq!(history.back_target(), Some(&PathBuf::from("two.md")));

        history.go_back();
        assert_eq!(history.current(), Some(&PathBuf::from("two.md")));
        assert_eq!(history.forward_target(), Some(&PathBuf::from("three.md")));

        history.record(PathBuf::from("branch.md"));
        assert_eq!(history.current(), Some(&PathBuf::from("branch.md")));
        assert_eq!(
            history.entries,
            vec![
                PathBuf::from("one.md"),
                PathBuf::from("two.md"),
                PathBuf::from("branch.md")
            ]
        );
        assert!(!history.can_go_forward());

        history.clear();
        assert_eq!(history.current(), None);
        assert!(!history.can_go_back());
        assert!(!history.can_go_forward());
        assert!(history.entries.is_empty());
    }

    #[test]
    fn forget_current_drops_failed_entry_and_falls_back_to_previous() {
        let mut history = DocumentHistory::default();
        history.record(PathBuf::from("good.md"));
        history.record(PathBuf::from("missing.md"));

        // The failed entry is removed entirely, not left in forward history, so
        // the user can't step forward back onto it.
        assert!(history.forget_current());
        assert_eq!(history.current(), Some(&PathBuf::from("good.md")));
        assert_eq!(history.entries, vec![PathBuf::from("good.md")]);
        assert!(!history.can_go_forward());
        assert!(!history.can_go_back());
    }

    #[test]
    fn forget_current_reports_empty_when_tab_had_only_the_failed_document() {
        let mut history = DocumentHistory::default();
        history.record(PathBuf::from("missing.md"));

        assert!(!history.forget_current());
        assert_eq!(history.current(), None);
        assert!(history.entries.is_empty());
    }

    /// Build a distinct anchor for scroll-history tests; the block ordinal keeps
    /// the entries identifiable.
    fn test_anchor(block: u32) -> ScrollAnchor {
        ScrollAnchor {
            section: None,
            block,
            offset_y: 0.0,
        }
    }

    #[test]
    fn scroll_history_restores_repeated_internal_jumps() {
        let mut history = ScrollHistory::default();

        history.record(test_anchor(120));
        history.record(test_anchor(640));

        assert!(history.can_go_back());
        assert!(!history.can_go_forward());
        assert_eq!(history.back(test_anchor(980)), Some(test_anchor(640)));
        assert_eq!(history.back(test_anchor(640)), Some(test_anchor(120)));
        assert!(!history.can_go_back());
        assert!(history.can_go_forward());

        assert_eq!(history.forward(test_anchor(120)), Some(test_anchor(640)));
        assert_eq!(history.forward(test_anchor(640)), Some(test_anchor(980)));
        assert!(!history.can_go_forward());
        assert!(history.can_go_back());
    }

    #[test]
    fn scroll_history_clears_forward_entries_after_new_internal_jump() {
        let mut history = ScrollHistory::default();

        history.record(test_anchor(10));
        assert_eq!(history.back(test_anchor(500)), Some(test_anchor(10)));
        assert!(history.can_go_forward());

        history.record(test_anchor(200));

        assert!(history.can_go_back());
        assert!(!history.can_go_forward());
        assert_eq!(history.back(test_anchor(900)), Some(test_anchor(200)));
    }

    #[test]
    fn move_tab_reorders_and_keeps_active_document_selected() {
        let mut workspace = Workspace::default();
        workspace.open_path(PathBuf::from("/docs/a.md"));
        workspace.open_path(PathBuf::from("/docs/b.md"));
        workspace.open_path(PathBuf::from("/docs/c.md"));
        assert_eq!(workspace.active, Some(2));

        // Drag the first tab to the last slot: [b, c, a].
        assert!(workspace.move_tab(0, 2));
        let paths: Vec<String> = workspace
            .tab_summaries()
            .into_iter()
            .map(|(_, path)| path)
            .collect();
        assert_eq!(
            paths,
            vec![
                PathBuf::from("/docs/b.md").display().to_string(),
                PathBuf::from("/docs/c.md").display().to_string(),
                PathBuf::from("/docs/a.md").display().to_string(),
            ]
        );
        // The active document (c) followed its slot from index 2 to index 1.
        assert_eq!(workspace.active, Some(1));

        // Dragging the active tab tracks it to the drop slot.
        assert!(workspace.move_tab(1, 0));
        assert_eq!(workspace.active, Some(0));

        // No-op and out-of-range moves leave the workspace untouched.
        assert!(!workspace.move_tab(0, 0));
        assert!(!workspace.move_tab(1, 9));
        assert_eq!(workspace.active, Some(0));
    }
}
