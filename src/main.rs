#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod single_instance;

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

use leaftext::indexer::{event_script, GraphRequest, IndexerEvent, IndexerWorker};
use leaftext::{
    app_data_dir, app_shell_html, blocks_resynced_script, bundled_asset_response, code_view_script,
    config_file_path, document_pager_html, fragment_scroll_script, glossary_sheet_script,
    image_refresh_script, initial_settings_script, initial_state_script, initial_version_script,
    is_local_image_path, line_count_script, load_recent_files, load_settings,
    local_image_protocol_response, local_image_source_dir, navigation_state_script,
    open_document_with_recent, open_error_state_script, opened_document_from_markdown,
    opened_document_from_xml, pager_loaded_script, render_markdown_document, save_recent_files,
    save_result_script, save_settings, scroll_anchor_script, settings_file_path,
    source_updated_script, webview_user_data_dir, workspace_reload_script, workspace_state_script,
    workspace_switch_script, DocumentFormat, EditableDocument, GraphScope, LibraryView,
    OpenedDocument, RecentFiles, ScrollAnchor, Settings, LOCAL_ASSET_PROTOCOL,
    LOCAL_IMAGE_PROTOCOL,
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
    /// The webview finished its first page load, so its render hooks now exist.
    /// Sent once on boot to flush a file passed on the command line, whose render
    /// would otherwise race the load.
    WebviewReady,
    /// A second launch of the app forwarded a request to this (primary) instance
    /// but carried no file — bring the existing window to the front.
    FocusWindow,
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
        code_scroll: Option<f64>,
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
    /// Open a URL in the system browser, unattached to any document (the update
    /// button). Unlike `OpenLink`, it doesn't require an active tab.
    OpenExternal {
        url: String,
    },
    /// A glossary link was clicked: show the term in a bottom sheet, not a new
    /// tab. `href` is the glossary file plus `#anchor`, relative to the doc.
    OpenGlossary {
        href: String,
    },
    /// A hover tooltip wants a linked document's line count. `href` resolves
    /// against the active doc; `token` correlates the answer with the hover.
    CountLines {
        href: String,
        token: u64,
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
    /// Persist the reading-view gutter line-number toggle.
    SetLineNumbersEnabled {
        enabled: bool,
    },
    /// Persist the reading-view editing toggle.
    SetReaderEditingEnabled {
        enabled: bool,
    },
    /// Persist the selected theme family (`github`/`nightshade`/`amaranth`/…).
    SetThemeFamily {
        family: String,
    },
    /// Persist the selected appearance mode (`system`/`light`/`dark`/`daylight`).
    SetThemeMode {
        mode: String,
    },
    /// Persist the families already shown in the current random-theme cycle.
    SetThemeRandomBag {
        used: Vec<String>,
    },
    /// Custom title-bar controls (the app bar is the title bar on frameless Windows).
    WindowDrag,
    WindowMinimize,
    WindowToggleMaximize,
    WindowClose,
    /// Paint the native title bar to the page color and the window border to the
    /// theme's divider color, both reported by the webview on theme change.
    SetWindowChrome {
        r: u8,
        g: u8,
        b: u8,
        border_r: u8,
        border_g: u8,
        border_b: u8,
        dark: bool,
    },
    /// Persist the library view choice and the folder Project view is inside.
    SetLibraryState {
        view: String,
        project_path: String,
    },
    /// Persist the library pane's open/closed state and last open width.
    SetLibraryLayout {
        closed: bool,
        width: u32,
    },
    /// Request the current library tree from the indexer's read connection.
    GetFileTree,
    /// Request the library link graph. `scope` is the persisted graph size;
    /// `seeds` are the focus documents, used only by the Focus scope.
    GetGraph {
        scope: String,
        seeds: Vec<String>,
    },
    /// Persist the graph size the frontend just selected.
    SetGraphScope {
        scope: String,
    },
    /// Run a full-text search. `scope`, when present, restricts results to those
    /// document paths (the Focus search scope).
    Search {
        query: String,
        scope: Option<Vec<String>>,
    },
    /// Compute Previous/Next pager links without blocking the initial render.
    LoadPager {
        path: PathBuf,
    },
    /// The background pager scan completed for a document path.
    PagerLoaded {
        path: PathBuf,
        html: String,
    },
    /// Show the active document as raw editable source (the code view).
    EnterCodeView,
    /// Return the active document to the rendered reading view.
    ExitCodeView,
    /// The code-view textarea changed; the full buffer text (debounced).
    UpdateSource {
        text: String,
    },
    /// Write the active document's edit buffer to disk.
    SaveDocument,
    /// Toggle the `index`-th task-list checkbox (reading view) in the buffer.
    ToggleTask {
        index: usize,
    },
    /// Splice an inline reading-view edit over `[start, end)` (source byte
    /// offsets), replacing that span with `text`.
    EditBlock {
        start: usize,
        end: usize,
        text: String,
        /// Set by checkbox toggles: no undo step, written to disk immediately.
        autosave: bool,
    },
    /// Revert the most recent reading-view edit in the active document.
    UndoEdit,
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
        /// Code-view scroll fraction when the outgoing tab is showing source;
        /// `None` for a reading-view tab.
        #[serde(default)]
        code_scroll: Option<f64>,
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
    #[serde(rename = "openExternal")]
    OpenExternal { url: String },
    #[serde(rename = "openGlossary")]
    OpenGlossary { href: String },
    #[serde(rename = "countLines")]
    CountLines { href: String, token: u64 },
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
    #[serde(rename = "setLineNumbersEnabled")]
    SetLineNumbersEnabled { enabled: bool },
    #[serde(rename = "setReaderEditingEnabled")]
    SetReaderEditingEnabled { enabled: bool },
    #[serde(rename = "setThemeFamily")]
    SetThemeFamily { family: String },
    #[serde(rename = "setThemeMode")]
    SetThemeMode { mode: String },
    #[serde(rename = "setThemeRandomBag")]
    SetThemeRandomBag { used: Vec<String> },
    #[serde(rename = "windowDrag")]
    WindowDrag,
    #[serde(rename = "windowMinimize")]
    WindowMinimize,
    #[serde(rename = "windowToggleMaximize")]
    WindowToggleMaximize,
    #[serde(rename = "windowClose")]
    WindowClose,
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
        #[serde(rename = "projectPath")]
        project_path: String,
    },
    #[serde(rename = "setLibraryLayout")]
    SetLibraryLayout { closed: bool, width: u32 },
    #[serde(rename = "getFileTree")]
    GetFileTree,
    #[serde(rename = "getGraph")]
    GetGraph {
        #[serde(default)]
        scope: String,
        #[serde(default)]
        seeds: Vec<String>,
    },
    #[serde(rename = "setGraphScope")]
    SetGraphScope { scope: String },
    #[serde(rename = "search")]
    Search {
        query: String,
        #[serde(default)]
        scope: Option<Vec<String>>,
    },
    #[serde(rename = "loadPager")]
    LoadPager { path: PathBuf },
    /// Swap the active document to the raw-source code view.
    #[serde(rename = "enterCodeView")]
    EnterCodeView,
    /// Swap the active document back to the rendered reading view.
    #[serde(rename = "exitCodeView")]
    ExitCodeView,
    /// The code-view textarea changed; carries the full buffer text (debounced).
    #[serde(rename = "updateSource")]
    UpdateSource { text: String },
    /// Write the active document's buffer to disk.
    #[serde(rename = "saveDocument")]
    SaveDocument,
    /// Toggle a reading-view task checkbox, addressed by its document-order
    /// position among list checkboxes.
    #[serde(rename = "toggleTask")]
    ToggleTask { index: usize },
    /// Splice an inline reading-view edit into the buffer over a source range.
    #[serde(rename = "editBlock")]
    EditBlock {
        start: usize,
        end: usize,
        text: String,
        /// Set by checkbox toggles: splice with no undo step and write to disk
        /// immediately, rather than the normal undoable, dirty-marking edit.
        #[serde(default)]
        autosave: bool,
    },
    /// Revert the most recent reading-view edit in the active document.
    #[serde(rename = "undoEdit")]
    UndoEdit,
}

fn main() {
    if let Err(error) = run_app() {
        let message = startup_failure_message(error.as_ref());
        eprintln!("{message}");
        show_startup_error(&message);
    }
}

/// Decode the bundled leaf logo into a window icon. Used on non-Windows platforms;
/// on Windows the taskbar rides the executable's embedded icon and the caption is
/// left icon-free, so no window icon is set there (hence dead there).
#[cfg_attr(windows, allow(dead_code))]
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

/// Paint the native Windows title bar to the page background and the window
/// border to the theme's divider color, all reported by the webview on theme
/// change. Caption/border/text colors need Windows 11 (build 22000+); older
/// builds ignore the error, so it's a no-op there (dark mode still applies).
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

    // Paint the caption the exact page color so the title bar reads as part of
    // the background in every theme; the window's border color (below) still
    // traces its outer edge, and the reader's own app bar carries a divider.
    // COLORREF packs as 0x00BBGGRR.
    let caption = u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16);
    // Choose caption text by background luminance so the title stays legible
    // whatever the theme paints behind it.
    let luminance = 0.299 * f32::from(r) + 0.587 * f32::from(g) + 0.114 * f32::from(b);
    let text: u32 = if luminance < 140.0 {
        0x00ff_ffff
    } else {
        0x0020_2020
    };
    // The window border takes the theme's divider color; the caption stays the
    // page color.
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

/// Write the UI toggles to disk, logging but not propagating I/O errors.
fn persist_settings(settings: &Settings, settings_path: Option<&PathBuf>) {
    if let Some(path) = settings_path {
        if let Err(error) = save_settings(path, settings) {
            eprintln!("Failed to save settings to {}: {error}", path.display());
        }
    }
}

fn run_app() -> Result<(), Box<dyn Error>> {
    // A file passed on the command line. Used to hand off to a running instance,
    // or to open on boot if we're the first instance.
    let arg_path = env::args_os().nth(1).map(PathBuf::from);

    // Claim the single-instance slot. If another instance is running, the path
    // was forwarded to it — exit without building UI. Held for the process
    // lifetime (a bare `_` would drop it immediately, freeing the slot).
    let _instance_guard = match single_instance::acquire(arg_path.as_deref()) {
        single_instance::Acquire::Primary(guard) => guard,
        single_instance::Acquire::Forwarded => return Ok(()),
    };

    // Load settings before building the window so it reopens at the size and
    // maximized state the user left it. The rest ride to the webview below.
    let settings_path = settings_file_path();
    let mut settings = settings_path
        .as_ref()
        .map(load_settings)
        .unwrap_or_default();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    // `mut` is used only by the non-Windows icon block below.
    #[allow(unused_mut)]
    let mut window_builder = WindowBuilder::new()
        .with_title("Leaf Text")
        .with_inner_size(LogicalSize::new(
            settings.window_width as f64,
            settings.window_height as f64,
        ))
        .with_min_inner_size(LogicalSize::new(380.0, 480.0))
        .with_maximized(settings.window_maximized);
    // On Windows we drop the native title bar (removing just its icon always fell
    // back to a placeholder) for a custom one: the app bar is the drag region and
    // carries our own window controls (wired via IPC). undecorated_shadow keeps the
    // shadow and edge resize; the taskbar leaf rides the exe icon. Others: native.
    #[cfg(windows)]
    {
        use tao::platform::windows::WindowBuilderExtWindows;
        window_builder = window_builder
            .with_decorations(false)
            .with_undecorated_shadow(true);
    }
    #[cfg(not(windows))]
    {
        window_builder = window_builder.with_window_icon(load_window_icon());
    }
    let window = window_builder.build(&event_loop)?;

    let proxy = event_loop.create_proxy();

    // Later launches forward their request here over the single-instance pipe:
    // open the file they carried, or just focus when they carried none.
    single_instance::serve({
        let proxy = proxy.clone();
        move |maybe_path| {
            let _ = proxy.send_event(match maybe_path {
                Some(path) => UserEvent::OpenPath(path),
                None => UserEvent::FocusWindow,
            });
        }
    });

    let handler = ipc_handler(proxy.clone());
    let drag_drop_handler = drag_drop_handler(proxy.clone());
    let local_image_source_dir = Arc::new(Mutex::new(None::<PathBuf>));
    let (mut web_context, webview_data_dir) = create_webview_context()?;
    if let Some(path) = &webview_data_dir {
        eprintln!("Using WebView2 user data folder: {}", path.display());
    }

    // The persisted toggles and recent files are handed to the webview as
    // initialization scripts (run before any page script), so theme and library
    // render from saved state on the first paint. Loaded here to ride in on the
    // same scripts rather than being injected post-build, which raced the load.
    let config_path = config_file_path();
    let mut recent = config_path
        .as_ref()
        .map(load_recent_files)
        .unwrap_or_default();

    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_html(app_shell_html())
        .with_initialization_script(initial_settings_script(&settings))
        .with_initialization_script(initial_state_script(&recent.files))
        .with_initialization_script(initial_version_script())
        // Whether the OS window is frameless (Windows), so the frontend shows its
        // own title-bar chrome — drag region + minimize/maximize/close buttons.
        .with_initialization_script(format!("window.__leafFrameless = {};", cfg!(windows)))
        // Initial maximized state, so the maximize button shows the restore-down
        // icon from the first paint when the window opens maximized.
        .with_initialization_script(format!(
            "window.__leafMaximized = {};",
            settings.window_maximized
        ))
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

    // Trim WebView2's footprint for a single-window offline reader. This replaces
    // wry's default arg string, so its defaults (msWebOOUI/msPdfOOUI/SmartScreen
    // off, autoplay policy) are folded back in. Site isolation is off (Leaf has
    // no cross-origin content), GPU stays on for smooth scroll, and the renderer
    // is un-backgrounded so it stays responsive when occluded.
    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        builder.with_additional_browser_args(concat!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,",
            "IsolateOrigins,site-per-process",
            " --disable-site-isolation-trials",
            " --disable-background-networking",
            " --disable-component-update",
            " --disable-domain-reliability",
            " --disable-renderer-backgrounding",
            " --disable-backgrounding-occluded-windows",
            " --autoplay-policy=no-user-gesture-required",
        ))
    };

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

    // A command-line file waits here until the webview reports its first page
    // load; rendering it before the page's JS hooks exist would silently land on
    // the home screen. WebviewReady flushes it once the page is ready.
    let mut pending_open_path = arg_path;

    let mut webview = Some(webview);
    let _web_context = web_context;
    let mut file_watch = FileWatch::new(proxy.clone());

    // The background library indexer, owning its own SQLite connections and
    // threads; results come back as `UserEvent::Indexer`.
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

    // Start the launch rescan now if the user left indexing on.
    if settings.indexing_enabled {
        if let Some(indexer) = indexer.as_ref() {
            indexer.set_indexing_enabled(true);
        }
    }

    // Size to restore next launch: the inner size the last time it was *not*
    // maximized, in logical px, so a maximized-at-close window still returns to
    // its windowed dimensions.
    let mut last_windowed_size =
        LogicalSize::new(settings.window_width as f64, settings.window_height as f64);

    // Last maximized state pushed to the webview, so the custom title bar's
    // maximize/restore icon tracks maximize changes from any source (the button,
    // a double-click, snap, or Win+Up), not just the button.
    let mut last_maximized = settings.window_maximized;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                // Remember the size only while windowed; convert the physical
                // event size to the logical size the next launch expects.
                if !window.is_maximized()
                    && !window.is_minimized()
                    && size.width > 0
                    && size.height > 0
                {
                    last_windowed_size = size.to_logical(window.scale_factor());
                }
                // Keep the custom title bar's maximize/restore icon in sync with
                // the real window state whenever it changes.
                let maximized = window.is_maximized();
                if maximized != last_maximized {
                    last_maximized = maximized;
                    if let Some(view) = webview.as_ref() {
                        let _ = view.evaluate_script(&format!(
                            "window.leafSetWindowMaximized({maximized});"
                        ));
                    }
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                // Capture the final window geometry so it reopens where it left off.
                settings.window_width = last_windowed_size.width.round() as u32;
                settings.window_height = last_windowed_size.height.round() as u32;
                settings.window_maximized = window.is_maximized();
                persist_settings(&settings, settings_path.as_ref());
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
                // A forwarded open from a second launch should surface the window.
                window.set_minimized(false);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::WebviewReady) => {
                if let Some(path) = pending_open_path.take() {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
            }
            Event::UserEvent(UserEvent::FocusWindow) => {
                window.set_minimized(false);
                window.set_focus();
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
                code_scroll,
            }) => {
                // Clicking the active tab is a no-op; re-rendering would jump the
                // reader.
                if workspace.active == Some(index) {
                    return;
                }
                if let Some(active) = workspace.active {
                    if let Some(tab) = workspace.tabs.get_mut(active) {
                        tab.saved_scroll_anchor = Some(scroll_anchor);
                        // Remember where the source editor was left; `None` for a
                        // reading-view tab, which leaves nothing to restore.
                        tab.saved_code_scroll = code_scroll;
                    }
                }
                if workspace.set_active(index) {
                    // Reopen where the reader left it (`None` starts at the top).
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
                // A bare `glossary:` link ("open the full glossary"): resolve to
                // the nearest GLOSSARY.md and open it as a tab.
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
            Event::UserEvent(UserEvent::OpenExternal { url }) => {
                if let Err(error) = open_with_os(&url) {
                    eprintln!("Failed to open {url} with the OS: {error}");
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
            Event::UserEvent(UserEvent::CountLines { href, token }) => {
                // Count the linked document's lines for the hover tooltip. Only
                // in-app Markdown links resolve to a file; else -1 ("unknown").
                let lines = workspace
                    .active
                    .and_then(|active| workspace.tabs[active].history.current().cloned())
                    .and_then(|current_path| match classify_link_target(&href) {
                        LinkTarget::LocalMarkdown(target) => {
                            let path = path_from_local_link(&target, &current_path);
                            fs::read_to_string(&path)
                                .ok()
                                .map(|contents| contents.lines().count() as i64)
                        }
                        _ => None,
                    })
                    .unwrap_or(-1);
                if let Some(webview) = webview.as_ref() {
                    if let Err(error) = webview.evaluate_script(&line_count_script(token, lines)) {
                        eprintln!("Failed to send line count to the webview: {error}");
                    }
                }
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
                // The active document live-reloads; a sibling change instead
                // (re)indexes that path so the library pane stays in sync without
                // a full rescan.
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
                    // An image, not a document: the text is unchanged, so the
                    // reload above would hash-gate itself out.
                    if is_local_image_path(&changed) {
                        if let Some(webview) = webview.as_ref() {
                            if let Err(error) = webview.evaluate_script(&image_refresh_script()) {
                                eprintln!("Live reload: failed to refresh images: {error}");
                            }
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::EnterCodeView) => {
                // A fresh toggle carries its own position: the page stashed the
                // reading view's scroll fraction before asking to enter.
                enter_code_view(webview.as_ref(), &mut workspace, None);
            }
            Event::UserEvent(UserEvent::ExitCodeView) => {
                if let Some(index) = workspace.active {
                    if let Some(tab) = workspace.tabs.get_mut(index) {
                        tab.code_view = false;
                    }
                }
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
            Event::UserEvent(UserEvent::UpdateSource { text }) => {
                update_source_buffer(webview.as_ref(), &mut workspace, text);
            }
            Event::UserEvent(UserEvent::SaveDocument) => {
                save_active_document(webview.as_ref(), &mut workspace, &mut file_watch);
            }
            Event::UserEvent(UserEvent::ToggleTask { index }) => {
                toggle_task_marker(webview.as_ref(), &mut workspace, &mut file_watch, index);
            }
            Event::UserEvent(UserEvent::EditBlock {
                start,
                end,
                text,
                autosave,
            }) => {
                // Splice into the source buffer, then re-render from it, keeping
                // the reader's place. Source stays authoritative for MD and XML.
                // A checkbox toggle (autosave) splices without an undo step and
                // writes to disk right away.
                if apply_block_edit(&mut workspace, start, end, &text, !autosave) {
                    if autosave {
                        autosave_active_buffer(&mut workspace, &mut file_watch);
                    }
                    render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Preserve,
                    );
                    // Host decides the Save/Undo buttons from the real dirty and
                    // undo state, not the frontend's guess.
                    resync_editing_state(webview.as_ref(), &workspace);
                }
            }
            Event::UserEvent(UserEvent::UndoEdit) => {
                // Pop the buffer back one edit, re-render, and resync so undoing
                // the only edit also clears the Save button.
                let undone = workspace
                    .active
                    .and_then(|index| workspace.tabs.get_mut(index))
                    .and_then(|tab| tab.edit.as_mut())
                    .is_some_and(EditableDocument::undo);
                if undone {
                    render_active(
                        &window,
                        webview.as_ref(),
                        &mut workspace,
                        &mut recent,
                        config_path.as_ref(),
                        &local_image_source_dir,
                        ScrollIntent::Preserve,
                    );
                    resync_editing_state(webview.as_ref(), &workspace);
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
            Event::UserEvent(UserEvent::SetLineNumbersEnabled { enabled }) => {
                settings.line_numbers_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetReaderEditingEnabled { enabled }) => {
                settings.reader_editing_enabled = enabled;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetThemeFamily { family }) => {
                settings.theme_family = family;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetThemeMode { mode }) => {
                settings.theme_mode = mode;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::SetThemeRandomBag { used }) => {
                settings.theme_random_used = used;
                persist_settings(&settings, settings_path.as_ref());
            }
            Event::UserEvent(UserEvent::WindowDrag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::WindowMinimize) => {
                window.set_minimized(true);
            }
            Event::UserEvent(UserEvent::WindowToggleMaximize) => {
                window.set_maximized(!window.is_maximized());
            }
            Event::UserEvent(UserEvent::WindowClose) => {
                // Same teardown as the native close button.
                settings.window_width = last_windowed_size.width.round() as u32;
                settings.window_height = last_windowed_size.height.round() as u32;
                settings.window_maximized = window.is_maximized();
                persist_settings(&settings, settings_path.as_ref());
                let _ = webview.take();
                *control_flow = ControlFlow::Exit;
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
            Event::UserEvent(UserEvent::SetLibraryState { view, project_path }) => {
                if let Some(view) = LibraryView::from_client(&view) {
                    settings.library_view = view;
                }
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
            Event::UserEvent(UserEvent::GetGraph { scope, seeds }) => {
                if let Some(indexer) = indexer.as_ref() {
                    // Focus keeps the seed neighborhood; the rest cap the densest
                    // documents, up to XL (no cap).
                    let request = match GraphScope::from_client(&scope).unwrap_or_default() {
                        GraphScope::Small => GraphRequest {
                            focus: Some(seeds),
                            limit: None,
                        },
                        GraphScope::Medium => GraphRequest {
                            focus: None,
                            limit: Some(2000),
                        },
                        GraphScope::Large => GraphRequest {
                            focus: None,
                            limit: Some(5000),
                        },
                        GraphScope::Xl => GraphRequest {
                            focus: None,
                            limit: None,
                        },
                    };
                    indexer.request_graph(request);
                }
            }
            Event::UserEvent(UserEvent::SetGraphScope { scope }) => {
                if let Some(scope) = GraphScope::from_client(&scope) {
                    settings.graph_scope = scope;
                    persist_settings(&settings, settings_path.as_ref());
                }
            }
            Event::UserEvent(UserEvent::Search { query, scope }) => {
                if let Some(indexer) = indexer.as_ref() {
                    indexer.search(query, scope);
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

        // Keep the watcher on the active document and the folder Project view is
        // browsing, so both live-update. A no-op unless one changed since last sync.
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
                code_scroll,
            } => {
                let _ = proxy.send_event(UserEvent::SwitchTab {
                    index,
                    scroll_anchor,
                    code_scroll,
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
            IpcCommand::OpenExternal { url } => {
                let _ = proxy.send_event(UserEvent::OpenExternal { url });
            }
            IpcCommand::OpenGlossary { href } => {
                let _ = proxy.send_event(UserEvent::OpenGlossary { href });
            }
            IpcCommand::CountLines { href, token } => {
                let _ = proxy.send_event(UserEvent::CountLines { href, token });
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
            IpcCommand::SetLineNumbersEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetLineNumbersEnabled { enabled });
            }
            IpcCommand::SetReaderEditingEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetReaderEditingEnabled { enabled });
            }
            IpcCommand::SetThemeFamily { family } => {
                let _ = proxy.send_event(UserEvent::SetThemeFamily { family });
            }
            IpcCommand::SetThemeMode { mode } => {
                let _ = proxy.send_event(UserEvent::SetThemeMode { mode });
            }
            IpcCommand::SetThemeRandomBag { used } => {
                let _ = proxy.send_event(UserEvent::SetThemeRandomBag { used });
            }
            IpcCommand::WindowDrag => {
                let _ = proxy.send_event(UserEvent::WindowDrag);
            }
            IpcCommand::WindowMinimize => {
                let _ = proxy.send_event(UserEvent::WindowMinimize);
            }
            IpcCommand::WindowToggleMaximize => {
                let _ = proxy.send_event(UserEvent::WindowToggleMaximize);
            }
            IpcCommand::WindowClose => {
                let _ = proxy.send_event(UserEvent::WindowClose);
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
            IpcCommand::SetLibraryState { view, project_path } => {
                let _ = proxy.send_event(UserEvent::SetLibraryState { view, project_path });
            }
            IpcCommand::SetLibraryLayout { closed, width } => {
                let _ = proxy.send_event(UserEvent::SetLibraryLayout { closed, width });
            }
            IpcCommand::GetFileTree => {
                let _ = proxy.send_event(UserEvent::GetFileTree);
            }
            IpcCommand::GetGraph { scope, seeds } => {
                let _ = proxy.send_event(UserEvent::GetGraph { scope, seeds });
            }
            IpcCommand::SetGraphScope { scope } => {
                let _ = proxy.send_event(UserEvent::SetGraphScope { scope });
            }
            IpcCommand::Search { query, scope } => {
                let _ = proxy.send_event(UserEvent::Search { query, scope });
            }
            IpcCommand::LoadPager { path } => {
                let _ = proxy.send_event(UserEvent::LoadPager { path });
            }
            IpcCommand::EnterCodeView => {
                let _ = proxy.send_event(UserEvent::EnterCodeView);
            }
            IpcCommand::ExitCodeView => {
                let _ = proxy.send_event(UserEvent::ExitCodeView);
            }
            IpcCommand::UpdateSource { text } => {
                let _ = proxy.send_event(UserEvent::UpdateSource { text });
            }
            IpcCommand::SaveDocument => {
                let _ = proxy.send_event(UserEvent::SaveDocument);
            }
            IpcCommand::ToggleTask { index } => {
                let _ = proxy.send_event(UserEvent::ToggleTask { index });
            }
            IpcCommand::EditBlock {
                start,
                end,
                text,
                autosave,
            } => {
                let _ = proxy.send_event(UserEvent::EditBlock {
                    start,
                    end,
                    text,
                    autosave,
                });
            }
            IpcCommand::UndoEdit => {
                let _ = proxy.send_event(UserEvent::UndoEdit);
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

/// Open each dropped Markdown file as a tab. Returns `true` to block the
/// webview's default drop behavior (a useless "copy" cursor).
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
    /// Where the code view was scrolled when this tab was last left, as a 0..1
    /// fraction of the scrollable range. Restored on return so switching tabs
    /// keeps the source editor's place, the way `saved_scroll_anchor` does for
    /// the reading view. `None` until the tab has been left while in code view.
    saved_code_scroll: Option<f64>,
    /// The editable source buffer, created on first edit and kept so unsaved
    /// edits survive view toggles and tab switches. `None` until edited. The
    /// authoritative copy a save writes and the reading view re-renders from.
    edit: Option<EditableDocument>,
    /// Whether this tab is currently showing the raw-source code view rather
    /// than the rendered reading view.
    code_view: bool,
}

impl Tab {
    /// Whether this tab holds an edit buffer for `path` specifically. A tab
    /// navigates across documents, but its edit buffer belongs to one file.
    fn has_edit_for(&self, path: &Path) -> bool {
        self.edit
            .as_ref()
            .is_some_and(|edit| paths_refer_to_same_document(&edit.path, path))
    }

    /// Whether starting an edit of `path` needs the file read from disk first:
    /// true when there is no buffer, or the buffer is for a different document.
    fn needs_edit_seed(&self, path: &Path) -> bool {
        !self.has_edit_for(path)
    }

    /// The edit buffer for `path`, seeded from `contents` when there's no buffer
    /// yet. Re-editing the same document reuses it; a different document replaces it.
    fn edit_buffer(&mut self, path: &Path, contents: String) -> &mut EditableDocument {
        if self.needs_edit_seed(path) {
            self.edit = Some(EditableDocument::new(path.to_path_buf(), contents));
        }
        self.edit.as_mut().expect("edit buffer just ensured")
    }
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

    /// Move the tab at `from` to `to`, keeping the active tab selected. Returns
    /// `false` when an index is out of range or nothing moves.
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

/// Turns filesystem changes into `UserEvent::FileChanged` for the active
/// document's directory (live-reload) and, in Project view, the browsed folder.
/// Watches the parent directory, not the file, to survive editors that save by
/// renaming a temp file over the original.
struct FileWatch {
    debouncer: Option<Debouncer<RecommendedWatcher>>,
    last_active: Option<PathBuf>,
    /// Directories currently registered with the watcher and their recursive
    /// mode; the diff against the desired set on each `sync` is (un)watched.
    watched: HashMap<PathBuf, RecursiveMode>,
    /// Hash of the contents last rendered for the active document, so a reload
    /// skips redundant work when a spurious event arrives for unchanged content.
    active_hash: Option<u64>,
}

impl FileWatch {
    fn new(proxy: EventLoopProxy<UserEvent>) -> Self {
        // A short debounce coalesces a save's burst of events into one reload;
        // kept small so the reload still feels immediate.
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

    /// Point the watcher at the active document's folder and, when given, the
    /// Project view's folder (recursively). Cheap after every event: diffs the
    /// desired set against what's watched and no-ops when nothing changed.
    fn sync(&mut self, active_path: Option<&Path>, project_dir: Option<&Path>) {
        if active_path != self.last_active.as_deref() {
            // Active document changed, so the stored hash is stale; force a render.
            self.active_hash = None;
            self.last_active = active_path.map(Path::to_path_buf);
        }

        let desired = desired_watches(active_path, project_dir);
        if desired == self.watched {
            return;
        }

        // Collect changes before borrowing the debouncer, so its mutable borrow
        // doesn't overlap the immutable borrow of `watched`.
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

/// The directories to watch and each one's recursive mode: the Project folder
/// recursively, plus the active document's folder when not already covered.
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

/// The directory to watch for a document: its parent, canonicalized. `None`
/// when the path has no usable parent (never falls back to a huge ancestor).
fn watch_dir_for(path: &Path) -> Option<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())?;
    Some(fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf()))
}

/// Canonicalize a folder to watch directly (not its parent). `None` for an
/// empty path or a non-directory, so a doomed watch is never attempted.
fn watch_folder(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return None;
    }
    Some(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// Hash of file contents, to detect whether a changed-on-disk document actually
/// differs from what's rendered. Not cryptographic or persisted.
fn content_hash(contents: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    contents.hash(&mut hasher);
    hasher.finish()
}

/// Re-render the active document from disk, preserving scroll position. Reads
/// the file once and hash-gates, so a spurious event with unchanged contents
/// re-renders nothing.
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

    // An external change must not clobber unsaved edits: if this document's edit
    // buffer is dirty, leave it and the view alone.
    let has_dirty_buffer = workspace.tabs.get(index).is_some_and(|tab| {
        tab.has_edit_for(&path) && tab.edit.as_ref().is_some_and(EditableDocument::is_dirty)
    });
    if has_dirty_buffer {
        return;
    }

    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        // May be mid-save or briefly absent during an atomic rename; a later
        // event delivers the settled contents.
        Err(error) => {
            eprintln!("Live reload: failed to read {}: {error}", path.display());
            return;
        }
    };

    let hash = content_hash(&contents);
    if file_watch.active_hash == Some(hash) {
        return;
    }
    file_watch.active_hash = Some(hash);

    // Keep this document's clean edit buffer in step with the file. If the code
    // view is open, refresh its source in place rather than reverting to reading.
    let in_code_view = workspace.tabs.get(index).is_some_and(|tab| tab.code_view);
    let buffer_is_current = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.has_edit_for(&path));
    if let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
        .filter(|_| buffer_is_current)
    {
        edit.adopt_external(contents.clone());
        if in_code_view {
            let highlighted = edit.source_view_html();
            let text = edit.text().to_string();
            let language = edit.format.language_token().to_string();
            let display = edit.format.display_name().to_string();
            if let Some(webview) = webview {
                if let Err(error) = webview.evaluate_script(&code_view_script(
                    &highlighted,
                    &text,
                    &language,
                    &display,
                    false,
                    // Live reload refreshes in place; the page keeps its scroll.
                    None,
                )) {
                    eprintln!("Live reload: failed to refresh code view: {error}");
                }
            }
            return;
        }
    }

    // Render through the same path as an initial open (XML or Markdown by extension),
    // reusing the content already read for the hash-gate.
    let is_xml = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("xml"));
    let document = if is_xml {
        opened_document_from_xml(&contents, &path)
    } else {
        opened_document_from_markdown(&contents, &path)
    };
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
    /// Restore a saved anchor after rendering (switching tabs). `None` lands at
    /// the top, used the first time a tab is visited.
    Restore(Option<ScrollAnchor>),
}

/// The active tab's index and its current document path, when a document is open.
fn active_tab_path(workspace: &Workspace) -> Option<(usize, PathBuf)> {
    let index = workspace.active?;
    let path = workspace.tabs.get(index)?.history.current()?.clone();
    Some((index, path))
}

/// Render a tab's reading view from its edit buffer, so unsaved edits show.
/// Picks the XML or Markdown renderer by the buffer's format.
fn reading_document_from_buffer(edit: &EditableDocument, path: &Path) -> OpenedDocument {
    match edit.format {
        DocumentFormat::Xml => opened_document_from_xml(edit.text(), path),
        DocumentFormat::Markdown => opened_document_from_markdown(edit.text(), path),
    }
}

/// Swap the active document to the code view. Seeds the edit buffer from disk
/// the first time, then hands the webview the highlighted source, buffer text,
/// language, and dirty state.
fn enter_code_view(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    scroll_fraction: Option<f64>,
) {
    let Some((index, path)) = active_tab_path(workspace) else {
        return;
    };

    // Read the file only when there's no buffer for this document yet; re-entry
    // reuses the buffer so unsaved edits survive.
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Code view: failed to read {}: {error}", path.display());
                return;
            }
        }
    } else {
        String::new()
    };

    let Some(tab) = workspace.tabs.get_mut(index) else {
        return;
    };
    // Highlighting a big source takes a while; the code-view script clears it.
    begin_reader_loading(webview);
    let edit = tab.edit_buffer(&path, contents);
    let highlighted = edit.source_view_html();
    let text = edit.text().to_string();
    let language = edit.format.language_token().to_string();
    let display = edit.format.display_name().to_string();
    let dirty = edit.is_dirty();
    tab.code_view = true;

    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&code_view_script(
            &highlighted,
            &text,
            &language,
            &display,
            dirty,
            scroll_fraction,
        )) {
            eprintln!("Code view: failed to show source: {error}");
        }
    }
}

/// Apply a debounced code-view edit to the buffer, then re-highlight and refresh
/// the code view's colour layer and dirty state.
fn update_source_buffer(webview: Option<&WebView>, workspace: &mut Workspace, text: String) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    edit.set_text(text);
    let highlighted = edit.source_view_html();
    let dirty = edit.is_dirty();
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&source_updated_script(&highlighted, dirty)) {
            eprintln!("Code view: failed to refresh source: {error}");
        }
    }
}

/// Write the active tab's edit buffer to disk. Sets the watcher's content hash
/// to the written text so its own FileChanged for this save is a no-op.
fn save_active_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    let path = edit.path.clone();
    let text = edit.text().to_string();
    let path_str = path.display().to_string();

    let script = match fs::write(&path, &text) {
        Ok(()) => {
            edit.mark_saved();
            // Self-save suppression: reload_active_document skips when the hash
            // matches, so our own write-back FileChanged won't clobber the buffer.
            file_watch.active_hash = Some(content_hash(&text));
            save_result_script(&path_str, true, None)
        }
        Err(error) => {
            let message = error.to_string();
            eprintln!("Save failed for {}: {message}", path.display());
            save_result_script(&path_str, false, Some(&message))
        }
    };

    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("Save: failed to report result: {error}");
        }
    }
}

/// Seed the edit buffer from disk on the first edit, then splice a reading-view
/// inline edit over `[start, end)`. Returns whether a buffer was available (the
/// caller re-renders from the now-authoritative buffer when so).
fn apply_block_edit(
    workspace: &mut Workspace,
    start: usize,
    end: usize,
    text: &str,
    record_undo: bool,
) -> bool {
    let Some((tab_index, path)) = active_tab_path(workspace) else {
        return false;
    };
    let needs_seed = workspace
        .tabs
        .get(tab_index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Edit block: failed to read {}: {error}", path.display());
                return false;
            }
        }
    } else {
        String::new()
    };
    let Some(tab) = workspace.tabs.get_mut(tab_index) else {
        return false;
    };
    let edit = tab.edit_buffer(&path, contents);
    if record_undo {
        edit.replace_range(start, end, text);
    } else {
        edit.replace_range_without_undo(start, end, text);
    }
    true
}

/// Write the active buffer to disk for an auto-saving edit (a checkbox toggle):
/// no Save-button round-trip. The version bump plus watcher-hash update keep our
/// own write from bouncing back through the file watcher as an external change.
fn autosave_active_buffer(workspace: &mut Workspace, file_watch: &mut FileWatch) {
    let Some(edit) = workspace
        .active
        .and_then(|index| workspace.tabs.get_mut(index))
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    let text = edit.text().to_string();
    match fs::write(&edit.path, &text) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        Err(error) => eprintln!("Auto-save failed for {}: {error}", edit.path.display()),
    }
}

/// Toggle a task-list checkbox from the reading view. Seeds the tab's edit buffer
/// from disk on the first edit, flips the marker, writes it straight to disk, then
/// reports the refreshed task offsets and dirty state so the reading view stays in
/// sync without a full re-render — the checkbox's own checked state is already
/// flipped in the DOM by the frontend. A checkbox toggle auto-saves and records no
/// undo step, so it works even with reading-view editing turned off.
fn toggle_task_marker(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
) {
    let Some((tab_index, path)) = active_tab_path(workspace) else {
        return;
    };
    let needs_seed = workspace
        .tabs
        .get(tab_index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Toggle task: failed to read {}: {error}", path.display());
                return;
            }
        }
    } else {
        String::new()
    };
    let Some(tab) = workspace.tabs.get_mut(tab_index) else {
        return;
    };
    let edit = tab.edit_buffer(&path, contents);
    edit.toggle_task_without_undo(index);
    let text = edit.text().to_string();
    match fs::write(&edit.path, &text) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        Err(error) => eprintln!(
            "Toggle task: auto-save failed for {}: {error}",
            edit.path.display()
        ),
    }
    let tasks = edit.task_offsets();
    let dirty = edit.is_dirty();
    let can_undo = edit.can_undo();

    if let Some(webview) = webview {
        // A toggle doesn't re-render, so carry the toggled source for the
        // reader's raw-source editors to slice from.
        let script = blocks_resynced_script(&tasks, dirty, can_undo, Some(&text));
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("Toggle task: failed to resync reading view: {error}");
        }
    }
}

/// Push the buffer's editing state (task offsets, dirty, undo availability) back
/// to the reading view. The source is omitted since the caller's re-render
/// already delivered it.
fn resync_editing_state(webview: Option<&WebView>, workspace: &Workspace) {
    let Some(webview) = webview else {
        return;
    };
    let Some(edit) = workspace
        .active
        .and_then(|index| workspace.tabs.get(index))
        .and_then(|tab| tab.edit.as_ref())
    else {
        return;
    };
    let script =
        blocks_resynced_script(&edit.task_offsets(), edit.is_dirty(), edit.can_undo(), None);
    if let Err(error) = webview.evaluate_script(&script) {
        eprintln!("Editing: failed to resync reading view: {error}");
    }
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
    // Pop the spinner for navigations (open, back/forward, tab switch), where
    // the load below can be slow; the state script clears it. In-place
    // re-renders (Preserve: edits, reorders) and the home screen skip it, so a
    // checkbox click doesn't flash an overlay.
    if workspace.active.is_some() && !matches!(scroll, ScrollIntent::Preserve) {
        begin_reader_loading(webview);
    }
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
            // A tab left in code view must stay in code view when it is
            // re-rendered (switching tabs away and back, reordering tabs). The
            // reading-view render below would silently drop out of the source
            // editor, so restore the code view from the tab's buffer instead.
            if workspace.tabs.get(index).is_some_and(|tab| tab.code_view) {
                if let Some(title) = workspace.tabs.get(index).map(|tab| tab.title.clone()) {
                    window.set_title(&format!("{title} - Leaf Text"));
                }
                // Restoring a tab (switching back) lands at its saved code-view
                // position; a reorder preserves the page's current scroll (None,
                // handled page-side), and a reset starts at the top.
                let scroll_fraction = match &scroll {
                    ScrollIntent::Restore(_) => workspace
                        .tabs
                        .get(index)
                        .and_then(|tab| tab.saved_code_scroll),
                    ScrollIntent::Preserve => None,
                    ScrollIntent::Reset => Some(0.0),
                };
                enter_code_view(webview, workspace, scroll_fraction);
                return;
            }

            // Prefer this document's edit buffer so unsaved edits show — but only
            // when the buffer is for THIS document, or a leftover buffer would
            // shadow a page opened by a link click.
            let has_edit = workspace
                .tabs
                .get(index)
                .is_some_and(|tab| tab.has_edit_for(&path));
            let document = if has_edit {
                let edit = workspace
                    .tabs
                    .get(index)
                    .and_then(|tab| tab.edit.as_ref())
                    .expect("edit buffer present");
                reading_document_from_buffer(edit, &path)
            } else {
                match open_document_with_recent(&path, recent, config_path.map(PathBuf::as_path)) {
                    Ok(success) => {
                        if let Some(error) = success.recent_save_error {
                            eprintln!("Failed to save recent files: {}", error.source);
                        }
                        success.document
                    }
                    Err(error) => {
                        let failed_path = error.path().to_path_buf();
                        let reason = error.reason().to_string();
                        let missing = error.reason().kind() == io::ErrorKind::NotFound;
                        eprintln!("Failed to open {}: {}", failed_path.display(), reason);

                        // Drop a missing file from Recent so it can't re-trigger.
                        if missing && recent.forget(&failed_path) {
                            if let Some(config_path) = config_path {
                                if let Err(save_error) = save_recent_files(config_path, recent) {
                                    eprintln!("Failed to save recent files: {save_error}");
                                }
                            }
                        }

                        // Don't strand the user on a tab that can't render: fall
                        // back to the previous document, or close the tab.
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
                        return;
                    }
                }
            };

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
                let script = match scroll {
                    ScrollIntent::Preserve => {
                        workspace_reload_script(&recent.files, &tabs, Some(index), Some(&document))
                    }
                    ScrollIntent::Restore(anchor) => workspace_switch_script(
                        &recent.files,
                        &tabs,
                        Some(index),
                        Some(&document),
                        anchor.as_ref(),
                    ),
                    ScrollIntent::Reset => {
                        workspace_state_script(&recent.files, &tabs, Some(index), Some(&document))
                    }
                };
                if let Err(error) = webview.evaluate_script(&script) {
                    eprintln!("Failed to update document view: {error}");
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

/// Pop the reader loading spinner before a view renders on this thread. The
/// state script the render sends back clears it; a page-side safety timeout
/// covers anything that slips through.
fn begin_reader_loading(webview: Option<&WebView>) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script("beginReaderLoading();") {
            eprintln!("Failed to arm the reader loading spinner: {error}");
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

/// For a `glossary:slug` href, return the slug (leading `#` stripped). It names
/// a term with no file path; the file is found separately by walking up folders.
fn glossary_scheme_slug(href: &str) -> Option<String> {
    let href = href.trim();
    let rest = href
        .get(..9)
        .and_then(|prefix| prefix.eq_ignore_ascii_case("glossary:").then(|| &href[9..]))?;
    Some(percent_decode_path(rest.trim_start_matches('#')))
}

/// Find the nearest `GLOSSARY.md` by walking up from `current_path`, so a
/// `glossary:` link binds to the open document's project. A lowercase
/// `glossary.md` is also accepted for case-sensitive trees.
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

/// Read the glossary file for `href` (nearest `GLOSSARY.md` for a `glossary:`
/// link, or a real `…/GLOSSARY.md#slug` path) and show the term in the bottom
/// sheet. Failures are logged and leave the sheet untouched.
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
    // Glossary terms are browsed from the same (often large) file, so reuse the
    // last render when the file is unchanged; the mtime check reloads after edits.
    let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok();
    let cached = GLOSSARY_RENDER_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .filter(|entry| entry.path == path && entry.modified == modified)
            .map(|entry| entry.html.clone())
    });
    let html = match cached {
        Some(html) => html,
        None => {
            let markdown = match fs::read_to_string(&path) {
                Ok(markdown) => markdown,
                Err(error) => {
                    eprintln!("Failed to read glossary {}: {error}", path.display());
                    return;
                }
            };
            let html = render_markdown_document(&markdown, &path).html;
            GLOSSARY_RENDER_CACHE.with(|cache| {
                *cache.borrow_mut() = Some(GlossaryRender {
                    path: path.clone(),
                    modified,
                    html: html.clone(),
                });
            });
            html
        }
    };
    if let Err(error) = webview.evaluate_script(&glossary_sheet_script(&html, &anchor)) {
        eprintln!("Failed to show glossary entry: {error}");
    }
}

// The last rendered glossary, reused across lookups of the same unchanged file.
// Keyed by path + mtime; a newer mtime forces a fresh render.
struct GlossaryRender {
    path: PathBuf,
    modified: Option<std::time::SystemTime>,
    html: String,
}

thread_local! {
    static GLOSSARY_RENDER_CACHE: std::cell::RefCell<Option<GlossaryRender>> =
        std::cell::RefCell::new(None);
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
        use std::os::windows::process::CommandExt;

        // `explorer /select,<path>` highlights the file. Spawn rather than wait
        // (Explorer returns non-zero even on success). Explorer needs `/select,`
        // outside the quotes with only the path quoted, so build the arg verbatim
        // with `raw_arg`; the std escaper would quote the whole token and break it.
        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
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
        // The freedesktop FileManager1 interface selects the file; fall back to
        // opening the folder with xdg-open when it's missing or fails.
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

/// Put the file on the system clipboard for pasting into the OS file manager.
/// `cut` requests move semantics. Uses platform tooling; best-effort on Linux.
fn copy_file_to_clipboard(path: &Path, cut: bool) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // "Preferred DropEffect" 2 = move (cut), 5 = copy, read by the shell on
        // paste. SetDataObject(_, $true) flushes so it survives PowerShell
        // exiting; clipboard needs STA. Path/effect via env to avoid quoting.
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
        // macOS has no clipboard "cut"; both put the file on the pasteboard (the
        // move is the user's Cmd+Opt+V on paste).
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
        // Best-effort: many file managers read `x-special/gnome-copied-files`
        // (a `copy`/`cut` line plus file URIs) via xclip.
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
        // The shell Properties verb is modal to the caller, so the helper must
        // linger for the dialog; best-effort. Path via env var.
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

/// Add a manually opened file to the library index, regardless of the "Index
/// entire device" toggle. The worker filters what it can't index, so this is
/// safe for every open.
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
    fn edit_buffer_belongs_to_one_document_and_reseeds_after_navigation() {
        let mut tab = Tab::default();
        let first = PathBuf::from("/docs/a.md");
        let second = PathBuf::from("/docs/b.md");

        // Editing the first document creates its buffer.
        assert!(tab.needs_edit_seed(&first));
        tab.edit_buffer(&first, "# A\n".to_string()).toggle_task(0);
        assert!(tab.has_edit_for(&first));
        assert!(!tab.needs_edit_seed(&first));

        // The buffer is NOT the second document's: rendering b.md must not use
        // it (the stale-buffer bug that made link navigation re-render the old
        // page), and editing b.md must re-seed from b's contents.
        assert!(!tab.has_edit_for(&second));
        assert!(tab.needs_edit_seed(&second));
        let edit = tab.edit_buffer(&second, "# B\n".to_string());
        assert_eq!(edit.text(), "# B\n");
        assert!(tab.has_edit_for(&second));
        assert!(!tab.has_edit_for(&first));

        // Re-editing the same document reuses the buffer (unsaved edits kept).
        let edit = tab.edit_buffer(&second, String::new());
        edit.replace_range(2, 3, "Bee");
        assert_eq!(edit.text(), "# Bee\n");
        let edit = tab.edit_buffer(&second, String::new());
        assert_eq!(edit.text(), "# Bee\n");
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
