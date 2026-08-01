#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(any(windows, target_os = "macos")))]
compile_error!("leaftext builds for Windows and macOS only");

mod app;
mod platform;
mod single_instance;

use leaftext::store::{
    active_vault_id, add_vault, default_vault_name, find_vault, list_vaults, open_db, remove_vault,
    rename_vault, set_active_vault_id, set_vault_root, vault_containing, vault_holds,
    DocumentGraph, GraphRequest, SearchHit, Vault,
};
use leaftext::{
    all_document_extensions, app_data_dir, app_shell_html, blocks_resynced_script,
    bundled_asset_response, code_intel_headings_script, code_intel_hover_script,
    code_intel_lint_script, code_intel_notes_script, code_view_fetch_script, code_view_payload,
    config_file_path, corpus_note_items, create_repo_on_github, document_graph, document_headings,
    document_pager_html, error_toast_script, find_note, folder_note_items, folder_note_names,
    fragment_scroll_script, git_tooling, glossary_failed_script, glossary_sheet_script,
    graph_script, image_picked_script, image_refresh_script, init_vault_repo,
    initial_apply_outcome_script, initial_document_exts_script, initial_settings_script,
    initial_state_script, initial_update_script, initial_vaults_script, initial_version_script,
    inspect_vault_repo, is_local_image_path, is_supported_document_path, known_note_names,
    library_folder_script, library_refresh_script, line_count_script, link_vault_remote,
    lint_links, load_recent_files, load_settings, local_image_protocol_response,
    local_image_source_dir, markdown_image_insert_destination, navigation_state_script,
    note_preview, open_error_state_script, opened_document_from_source, pager_loaded_script,
    read_folder_listing, read_folder_note, read_source, render_markdown_document,
    repo_name_for_vault, save_recent_files, save_result_script, save_settings,
    scroll_anchor_script, search_results_script, settings_file_path, settings_unreadable_script,
    source_payload_url, source_updated_script, sync_vault_repo, unlock_reading_script,
    update_progress_script, update_state_script, vaults_script, webview_user_data_dir,
    workspace_only_script, workspace_reload_script, workspace_state_script,
    workspace_switch_script, write_source, CorpusDocument, DocumentFormat, EditableDocument,
    FolderListing, GitTooling, GraphScope, OpenedDocument, RecentFiles, ScrollAnchor, Settings,
    SettingsLoad, SourceText, UpdateDownload, VaultCorpus, VaultRepo, LOCAL_ASSET_PROTOCOL,
    LOCAL_IMAGE_PROTOCOL,
};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use rfd::FileDialog;
use rusqlite::Connection;
use serde::Deserialize;
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
#[cfg(not(windows))]
use tao::window::Icon;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::{
    http::{Request, Response},
    DragDropEvent, PageLoadEvent, WebContext, WebView, WebViewBuilder,
};

use app::*;

fn main() {
    // A detached copy of this binary, spawned by the app to install a staged
    // update after the app exits. It opens no window and touches no settings.
    if let Some(request) = platform::parse_apply_request(env::args()) {
        if let Err(error) = platform::run_update_apply(&request) {
            eprintln!("Update failed: {error}");
        }
        return;
    }

    if let Err(error) = run_app() {
        let message = startup_failure_message(error.as_ref());
        eprintln!("{message}");
        show_startup_error(&message);
    }
}

/// Decode the bundled leaf logo into a window icon. Used on non-Windows platforms;
/// on Windows the taskbar rides the executable's embedded icon and the caption is
/// left icon-free, so no window icon is set there. Compiled out entirely there,
/// which is what keeps the PNG decoder off the Windows dependency tree.
#[cfg(not(windows))]
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
    let SettingsLoad {
        mut settings,
        unreadable: settings_unreadable,
    } = settings_path
        .as_ref()
        .map(load_settings)
        .unwrap_or_default();

    // Before the page can ask about updates, settle what happened to the last
    // one: clear a record the running version already satisfies, and sweep away
    // installers (and the helper copy) that are no longer needed.
    // Nothing here removes a copy left by an older per-machine build: both
    // attempts at that (v0.1.363, v0.1.364) ended with the wrong copy running.
    // The release notes ask people to uninstall the old version instead.
    let settings_dirty = reconcile_staged_update(&mut settings);

    if settings_dirty {
        persist_settings(&settings, settings_path.as_ref());
    }

    // An update downloaded last session installs itself now, before any window
    // exists — Windows cannot replace a running executable, so this is the only
    // click-free moment. Quit and reopen, and the app that comes up is the new one.
    if auto_apply_staged_update(&mut settings, settings_path.as_ref()) {
        return Ok(());
    }

    // What the detached applier had to say about the last install, if it ran. Read
    // once and deleted; the page reports a failure in the settings panel.
    let apply_outcome = app_data_dir().and_then(|data_dir| {
        let outcome = leaftext::take_apply_outcome(&data_dir);
        if let Some(outcome) = outcome.as_ref().filter(|outcome| !outcome.ok) {
            eprintln!(
                "Installing v{} failed: {}",
                outcome.version, outcome.message
            );
        }
        outcome
    });

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    // `mut` is used only by the non-Windows icon block below.
    #[allow(unused_mut)]
    let mut window_builder = WindowBuilder::new()
        .with_title("Leaftext")
        .with_inner_size(LogicalSize::new(
            settings.window_width as f64,
            settings.window_height as f64,
        ))
        .with_min_inner_size(LogicalSize::new(380.0, 480.0))
        .with_maximized(settings.window_maximized);
    // On Windows we drop the native title bar (removing just its icon falls back
    // to a placeholder) for a custom one: the app bar is the drag region and
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
    let recent = config_path
        .as_ref()
        .map(load_recent_files)
        .unwrap_or_default();

    // The vault registry, so the leftmost crumb reads the active vault's name on
    // the first paint. Opening the manifest here is also what applies its
    // migrations, before anything else reads it.
    let data_dir = app_data_dir();
    let vault_state = VaultState::load(data_dir.as_deref());

    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_html(app_shell_html())
        .with_initialization_script(initial_settings_script(&settings))
        .with_initialization_script(settings_unreadable_script(settings_unreadable))
        .with_initialization_script(initial_vaults_script(
            &vault_state.vaults(),
            vault_state.active,
        ))
        .with_initialization_script(initial_state_script(&recent.files))
        .with_initialization_script(initial_document_exts_script())
        .with_initialization_script(initial_version_script())
        .with_initialization_script(initial_update_script())
        .with_initialization_script(initial_apply_outcome_script(apply_outcome.as_ref()))
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
        .with_custom_protocol(
            SOURCE_PAYLOAD_PROTOCOL.to_string(),
            source_payload_protocol_handler(),
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

    // Windows and macOS both host the web view in the window directly, so this
    // builds against the window itself rather than a container widget.
    let webview = builder.build(&window)?;

    let workspace = Workspace::default();

    update_active_navigation(Some(&webview), &workspace);

    // A command-line file waits here until the webview reports its first page
    // load; rendering it before the page's JS hooks exist would silently land on
    // the home screen. WebviewReady flushes it once the page is ready.
    let pending_open_path = arg_path;

    let webview = Some(webview);
    let _web_context = web_context;
    let file_watch = FileWatch::new(proxy.clone());

    // Size to restore next launch: the inner size the last time it was *not*
    // maximized, in logical px, so a maximized-at-close window still returns to
    // its windowed dimensions.
    let last_windowed_size =
        LogicalSize::new(settings.window_width as f64, settings.window_height as f64);

    // Last maximized state pushed to the webview, so the custom title bar's
    // maximize/restore icon tracks maximize changes from any source (the button,
    // a double-click, snap, or Win+Up), not just the button.
    let last_maximized = settings.window_maximized;

    let ctx = AppCtx {
        reader: Reader {
            window,
            webview,
            workspace,
            recent,
            config_path,
            image_dir: local_image_source_dir,
        },
        settings,
        settings_path,
        pending_open_path,
        proxy,
        file_watch,
        vault_state,
        last_windowed_size,
        last_maximized,
    };

    run_event_loop(event_loop, ctx)
}

fn startup_failure_message(error: &dyn Error) -> String {
    let error_text = error.to_string();
    if error_text.contains("0x80070005") || error_text.contains("Access is denied") {
        let webview_data_dir = webview_user_data_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "the per-user Leaftext data folder".to_string());
        return format!(
            "Leaftext could not start.\n\n{error}\n\nWebView2 could not access its per-user browser data folder:\n{webview_data_dir}\n\nMake sure your Windows account can write to that folder, then try launching Leaftext again."
        );
    }

    format!(
        "Leaftext could not start.\n\n{error}\n\nIf this happens on Windows, make sure the Microsoft Edge WebView2 Runtime is installed and try launching Leaftext again."
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

fn source_payload_protocol_handler(
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_webview_id, request| {
        let payload = source_payload_response(request.uri().to_string().as_str());
        Response::builder()
            .status(payload.status)
            .header("Content-Type", payload.content_type)
            .header("Access-Control-Allow-Origin", payload.allow_origin)
            // The buffer changes as you type; a cached copy would show stale source.
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(payload.body))
            .expect("source payload protocol response builds")
    }
}

fn show_startup_error(message: &str) {
    let _ = rfd::MessageDialog::new()
        .set_title("Leaftext could not start")
        .set_description(message)
        .set_level(rfd::MessageLevel::Error)
        .show();
}

/// The Open dialog: one filter per format plus a combined one, both derived from
/// the format table so the picker can't offer or omit a format the renderer has.
fn pick_document_file() -> Option<PathBuf> {
    let mut dialog = FileDialog::new()
        .set_title("Open Document")
        .add_filter("Documents", &all_document_extensions());
    for format in DocumentFormat::ALL {
        dialog = dialog.add_filter(format.display_name(), format.extensions());
    }
    dialog.add_filter("All files", &["*"]).pick_file()
}

/// Where a document that has never had a file goes. The same filters as Open,
/// off the same table, with the name it has been wearing as the suggestion — so
/// the first save of a new document is a Save As and nothing is written until
/// someone has said where.
fn pick_save_path(current: &Path) -> Option<PathBuf> {
    let mut dialog = FileDialog::new().set_title("Save Document As");
    if let Some(name) = current.file_name().and_then(|name| name.to_str()) {
        dialog = dialog.set_file_name(name);
    }
    for format in DocumentFormat::ALL {
        dialog = dialog.add_filter(format.display_name(), format.extensions());
    }
    dialog.add_filter("All files", &["*"]).save_file()
}

/// The Insert image dialog. Filtered to what a web view can draw, since a
/// document can only show what the page can.
fn pick_image_file() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Choose an image")
        .add_filter(
            "Images",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
            ],
        )
        .add_filter("All files", &["*"])
        .pick_file()
}

/// The New vault dialog: a folder, since a vault is a folder. Nothing is written
/// into it — the app records the choice itself.
fn pick_vault_folder() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Choose a vault folder")
        .pick_folder()
}

/// Open each dropped document as a tab. Returns `true` to block the webview's
/// default drop behavior (a useless "copy" cursor).
///
/// Always reports the drag as handled, which is also what keeps the web view from
/// doing anything of its own with one — including its own drag and drop. Anything
/// in the page built on HTML drag events would need this to answer per drag instead.
fn drag_drop_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(DragDropEvent) -> bool {
    move |event| {
        if let DragDropEvent::Drop { paths, .. } = event {
            for path in paths {
                if is_supported_document_path(&path) {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
            }
        }
        true
    }
}

// The binary's tests live under app/, beside the code they cover. Both crate roots
// share src/, so a bare `mod tests;` here would find the library's test tree.
