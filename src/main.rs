#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(any(windows, target_os = "macos")))]
compile_error!("leaftext builds for Windows and macOS only");

mod app;
mod journal;
mod pipe;
mod platform;
mod single_instance;

use leaftext::remote::remove_vault_mirror;
use leaftext::store::{
    active_vault_id, add_vault, default_vault_name, find_vault, list_vaults, open_db, remove_vault,
    rename_vault, set_active_vault_id, set_vault_account, set_vault_root, vault_containing,
    vault_holds, DocumentGraph, GraphRequest, SearchResults, Vault, VaultKind,
};
use leaftext::{
    age_link_previews_script, all_document_extensions, app_data_dir, app_shell_html_with_front_end,
    blocks_resynced_script, bundled_asset_response, clone_into_vault, cloud_folders,
    cloud_folders_script, cloud_folders_to_register, code_intel_headings_script,
    code_intel_hover_script, code_intel_lint_script, code_intel_notes_script,
    code_view_fetch_script, code_view_payload, config_file_path, corpus_note_items,
    create_repo_on_github, diagram_path_picked_script, document_headings, document_pager_html,
    drawable_image_extensions, edit_answered_script, edit_refused_script, edit_refused_words,
    edit_unsaved_words, encode_rgba, encode_rgba_paletted, error_toast_script, exported_page_css,
    exported_page_document, exported_page_minimap_script, exported_page_stylesheet,
    exported_picture_url, failure_message, favorites_missing_script, file_deleted_script,
    file_written_notice_script, filter_hints_script, find_note, folder_note_items,
    folder_note_names, fragment_scroll_script, git_tooling, glossary_failed_script,
    glossary_sheet_script, graph_script, image_picked_script, image_refresh_script,
    init_vault_repo, initial_document_exts_script, initial_document_formats_script,
    initial_settings_script, initial_state_script, initial_update_script, initial_vaults_script,
    initial_version_script, inspect_vault_repo, is_local_image_path, is_supported_document_path,
    known_note_names, library_folder_script, library_refresh_script, line_count_script,
    link_preview_script, link_vault_remote, lint_links, load_favorites, load_recent_files,
    load_settings, local_image_protocol_path, local_image_protocol_response,
    local_image_source_dir, markdown_image_insert_destination, markup_has_math,
    navigation_state_script, nearest_glossary_file, normalize_document_path, note_preview,
    open_error_state_script, opened_document_for_path_with_host,
    opened_document_from_buffer_with_host, opened_document_from_source_with_host,
    page_html_export_script, pager_loaded_script, picture_path_picked_script,
    read_document_for_editing, read_document_source, read_folder_listing, read_folder_note,
    read_source, read_source_head, reading_mode_css, render_markdown_document, repo_name_for_vault,
    rgba_from_bmp, save_editable_document, save_favorites, save_recent_files, save_result_script,
    scroll_anchor_script, scrollbars_always_script, search_results_script, set_git_identity,
    settings_file_path, settings_unreadable_script, source_payload_url, source_updated_script,
    sync_vault_repo, task_entries, task_marker_offsets, today_or_utc, unexpected_close_script,
    unlock_reading_script, update_failed_script, update_progress_script, update_state_script,
    vaults_script, webview_user_data_dir, workspace_cached_switch_message, workspace_only_script,
    workspace_reload_message, workspace_state_message, workspace_state_script,
    workspace_switch_message, write_gitignore, CloudFolder, CloudRoots, CorpusChange,
    CorpusDocument, DesktopHost, DocumentFormat, DocumentSource, EditableDocument, Favorite,
    FavoriteKind, Favorites, FileRecord, FilterHints, FolderListing, GitTooling, GraphScope,
    LeafHost, NestedScan, OpenedDocument, Query, RecentFiles, ScrollAnchor, Session, SessionTab,
    Settings, SettingsLoad, SourceEncoding, SourceSpelling, SourceText, TabSummary, TaskEntry,
    UpdateDownload, VaultCorpus, VaultRepo, WorkspacePayloadMessage, CORPUS_SLICE_DOCUMENTS,
    EXPORTED_PAGE_ASSETS_FOLDER, EXPORTED_PAGE_MATH_FONTS_FOLDER, EXPORTED_PAGE_MATH_STYLESHEET,
    EXPORTED_PAGE_MINIMAP_SCRIPT, KATEX_CSS, KATEX_FONTS, LOCAL_ASSET_PROTOCOL,
    LOCAL_IMAGE_PROTOCOL, MARKDOWN_EXPORT_EXTENSIONS, SITE_PROTOCOL,
};
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, DebouncedEvent, DebouncedEventKind, Debouncer,
};
use rfd::FileDialog;
use rusqlite::Connection;
use serde::Deserialize;
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    env,
    error::Error,
    fs,
    hash::{Hash, Hasher},
    io,
    path::{Path, PathBuf},
    process::Command,
    rc::Rc,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
#[cfg(not(windows))]
use tao::window::Icon;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, DeviceEventFilter, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::{
    http::{Request, Response},
    DragDropEvent, WebContext, WebView, WebViewBuilder,
};

use app::*;

fn main() {
    // A detached copy of this binary, spawned by the app to install a staged update after the app exits. It opens no window and touches no settings.
    if let Some(request) = platform::parse_apply_request(env::args()) {
        if let Err(error) = platform::run_update_apply(&request) {
            eprintln!("Update failed: {error}");
        }
        return;
    }

    // Behind `just squeeze-png`: documentation images go out through the same encoder the diagram export uses, never a second one. Opens no window.
    let argv: Vec<String> = env::args().collect();
    if argv.len() >= 4 && argv[1] == "--squeeze-png" {
        // Cuts to 256 colors first — half the file on a screenshot, and the one step that moves a pixel, so no export asks for it.
        let palette = argv.iter().any(|arg| arg == "--palette");
        match squeeze_png(unquote_path(&argv[2]), unquote_path(&argv[3]), palette) {
            Ok(report) => println!("{report}"),
            Err(error) => {
                eprintln!("squeeze-png failed: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    // Behind `just bundle-gallery`: the compiled stylesheet, so the gallery page in the repo is painted by the same CSS the app paints itself with. Only the app can produce it — the theme compiler is Rust — and a node script must not grow a second one. Opens no window.
    if argv.len() >= 2 && argv[1] == "--dump-css" {
        print!("{}", reading_mode_css());
        return;
    }

    if let Err(error) = run_app() {
        let message = startup_failure_message(error.as_ref());
        eprintln!("{message}");
        show_startup_error(&message);
    }
}

/// Decode the bundled leaf logo into a window icon. Used on non-Windows platforms; on Windows the taskbar rides the executable's embedded icon and the caption is left icon-free, so no window icon is set there. Compiled out entirely there, which is what keeps the PNG decoder off the Windows dependency tree.
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

/// How far the app is held off the window on every side so the shadow band has room, mirroring `--lt-shadow-spread` in `design/tokens.md`: the page cannot read a custom property, so the one number is written on both sides of the boundary and a test holds them to each other.
pub(crate) const SHADOW_SPREAD: f64 = 12.0;

/// The smallest readable page, plus the band on both sides of it: the page inside stays the size it was pinned at rather than losing the band out of it. Named because a resize the host drives itself sets the size directly and goes around the limit the platform holds, so it has to clamp to the same pair.
///
/// Applied when the window grows rather than when it is built, because the launch window below is smaller than it and the platform would clamp that away. See `finish_startup` in `src/app/window_cmds.rs`.
pub(crate) const MIN_INNER_SIZE: (f64, f64) =
    (380.0 + SHADOW_SPREAD * 2.0, 480.0 + SHADOW_SPREAD * 2.0);

/// The window a launch puts up while the page is still coming: small, square, and holding the startup card. The window exists a few hundred milliseconds before the web view has drawn a pixel, so this is the whole of what a reader meets in the meantime — a small deliberate box rather than a full-size empty one. It grows into the window they left the moment the page says it has drawn something.
pub(crate) const STARTUP_INNER_SIZE: (f64, f64) = (256.0, 256.0);

/// Paint the native Windows frame to the page background, reported by the webview on theme change. The border is told to draw nothing: the app carries its own edge now, and with the window's client area running out to its own edge a frame line would trace the outside of the shadow band rather than the app. Caption/border/text colors need Windows 11 (build 22000+); older builds ignore the error, so it's a no-op there (dark mode still applies).
#[cfg(windows)]
fn apply_window_chrome(window: &tao::window::Window, r: u8, g: u8, b: u8, dark: bool) {
    use std::ffi::c_void;
    use tao::platform::windows::WindowExtWindows;

    // Attribute ids from dwmapi.h.
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;
    /// Draw no border at all, from dwmapi.h.
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

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

    // Paint the caption the exact page color so the title bar reads as part of the background in every theme; the window's border color (below) still traces its outer edge, and the reader's own app bar carries a divider. COLORREF packs as 0x00BBGGRR.
    let caption = u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16);
    // Choose caption text by background luminance so the title stays legible whatever the theme paints behind it.
    let luminance = 0.299 * f32::from(r) + 0.587 * f32::from(g) + 0.114 * f32::from(b);
    let text: u32 = if luminance < 140.0 {
        0x00ff_ffff
    } else {
        0x0020_2020
    };
    let border = DWMWA_COLOR_NONE;
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

/// Other platforms keep their native chrome; the system already follows the OS light/dark preference there.
#[cfg(not(windows))]
fn apply_window_chrome(_window: &tao::window::Window, _r: u8, _g: u8, _b: u8, _dark: bool) {}

/// `just` runs a recipe through cmd.exe, which hands the quotes around an argument through rather than stripping them — so a path quoted in a recipe arrives wrapped in them, and Windows refuses every path with a quote in it. `scripts/drive.mjs` does the same for the driver. The quotes protect nothing on the way in: a value with a space is split at it whatever they do.
pub(crate) fn unquote_path(path: &str) -> &str {
    path.strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(path)
}

/// A BMP in, the smallest PNG we can write out. BMP because the screenshot tool can save one without an encoder of its own, which keeps this the only encoder in the project.
fn squeeze_png(source: &str, target: &str, palette: bool) -> Result<String, Box<dyn Error>> {
    let bmp = std::fs::read(source)?;
    let before = bmp.len();
    let (rgba, width, height) =
        rgba_from_bmp(&bmp).ok_or("not a 24- or 32-bit uncompressed BMP")?;
    let png = if palette {
        encode_rgba_paletted(&rgba, width, height)
    } else {
        encode_rgba(&rgba, width, height)
    }
    .ok_or("those pixels could not be encoded")?;
    std::fs::write(target, &png)?;
    Ok(format!("{width}x{height}  {before} -> {} bytes", png.len()))
}

/// Which of the two front-end assets this launch is served. `just probe-evaluation` sets the variable on the copy it starts and nothing else does, so every reader's window is served the ordinary join exactly as it always was. The read is here rather than in the library because the library renders in a browser too, where there is no environment to ask.
fn front_end_asset() -> &'static str {
    front_end_asset_for(std::env::var(FRONT_END_EVALUATION_ENV).ok().as_deref())
}

/// The choice on its own, so it can be read back without a test setting a variable on the whole process. Only the exact word asks for the measured front end: a variable left behind empty, or holding anything else, is a reader's ordinary launch.
fn front_end_asset_for(asked: Option<&str>) -> &'static str {
    match asked == Some("1") {
        true => leaftext::APP_SHELL_EVALUATION_SCRIPT_ASSET,
        false => leaftext::APP_SHELL_SCRIPT_ASSET,
    }
}

/// The variable that asks for the measured front end. Named here and in `scripts/probe-launch.ps1`, which is the only thing that sets it.
const FRONT_END_EVALUATION_ENV: &str = "LEAFTEXT_FRONT_END_EVALUATION";

fn run_app() -> Result<(), Box<dyn Error>> {
    // First, so everything below has somewhere to print. Not in the tool modes above (`--squeeze-png`, `--dump-css`): those are run from a terminal that is already watching stderr.
    journal::start();

    // A file passed on the command line. Used to hand off to a running instance, or to open on boot if we're the first instance.
    let arg_path = env::args_os().nth(1).map(PathBuf::from);

    // Claim the single-instance slot. If another instance is running, the path was forwarded to it — exit without building UI. Held for the process lifetime (a bare `_` would drop it immediately, freeing the slot).
    let _instance_guard = match single_instance::acquire(arg_path.as_deref()) {
        single_instance::Acquire::Primary(guard) => guard,
        single_instance::Acquire::Forwarded => return Ok(()),
    };

    // Load settings before building the window so it reopens at the size and maximized state the user left it. The rest ride to the webview below.
    let settings_path = settings_file_path();
    let SettingsLoad {
        mut settings,
        unreadable: settings_unreadable,
    } = settings_path
        .as_ref()
        .map(load_settings)
        .unwrap_or_default();

    // Before the page can ask about updates, settle what happened to the last one: clear a record the running version already satisfies, and sweep away installers (and the helper copy) that are no longer needed. Nothing here removes a copy left by an older per-machine build: both attempts at that (v0.1.363, v0.1.364) ended with the wrong copy running. The release notes ask people to uninstall the old version instead.
    let settings_dirty = reconcile_staged_update(&mut settings);

    if settings_dirty {
        persist_settings(&settings, settings_path.as_ref());
    }

    // An update downloaded last session installs itself now, before any window exists — Windows cannot replace a running executable, so this is the only click-free moment. Quit and reopen, and the app that comes up is the new one.
    if auto_apply_staged_update(&mut settings, settings_path.as_ref()) {
        return Ok(());
    }

    // What the detached applier had to say about the last install, if it ran. Read once and deleted, then both printed and carried to the page below: the journal line is what a bug report quotes, and the growl is the only thing the person who lost the update ever sees.
    let apply_outcome = app_data_dir().and_then(|data_dir| leaftext::take_apply_outcome(&data_dir));
    if let Some(outcome) = apply_outcome.as_ref().filter(|outcome| !outcome.ok) {
        eprintln!(
            "Installing v{} failed: {}",
            outcome.version, outcome.message
        );
    }

    // The last thing before the window exists, and after both returns above: a forwarded copy and a copy handing off an update never own the window, so neither may leave the marker. What comes back is whether the previous primary copy skipped the close that saves — carried to the page below, because there is nothing else on the next launch that can tell a kill from a quit.
    let closed_unexpectedly = journal::arm_run();
    if closed_unexpectedly {
        // Into the journal as well as to the page: the journal is what a bug report quotes, and this line is the one thing in it that the run which vanished could not have written itself.
        eprintln!("the previous run ended without reaching the close that saves");
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    // The window library registers every mouse and keyboard for raw input and hands the loop one device event per hardware packet while focused — up to a thousand a second on a gaming mouse, and no arm reads one. Windows-only by tao's own doc, so the skip in `could_have_changed_anything` stays: it is the half a Mac runs.
    event_loop.set_device_event_filter(DeviceEventFilter::Always);
    // `mut` is used only by the non-Windows icon block below.
    #[allow(unused_mut)]
    // Built at the launch size, and neither the saved size, the saved maximized state nor the smallest size is asked for here: all three are applied together the moment the page says it has drawn something, by `finish_startup`. The limit especially cannot be set here — it is larger than the launch size, so the platform would clamp the small window straight back up to it.
    let mut window_builder = WindowBuilder::new()
        .with_title("Leaftext")
        .with_inner_size(LogicalSize::new(STARTUP_INNER_SIZE.0, STARTUP_INNER_SIZE.1));
    // On Windows we drop the native title bar (removing just its icon falls back to a placeholder) for a custom one: the app bar is the drag region and carries our own window controls (wired via IPC); the taskbar leaf rides the exe icon. Others: native.
    //
    // The platform shadow goes with it, because the app draws its own — the dot lattice every floating surface inside it throws, over the outer strip of the page, which is why the window and the web view are see-through. `false` rather than left out: tao's flag is on unless something says otherwise, so omitting the call keeps the smooth halo, keeps the frame insets that make the window bigger than the page, and keeps a hit test that only finds the top edge. Clearing it hands back all four resize edges and makes the window exactly the page it holds.
    #[cfg(windows)]
    {
        use tao::platform::windows::WindowBuilderExtWindows;
        window_builder = window_builder
            .with_decorations(false)
            .with_undecorated_shadow(false)
            .with_transparent(true);
    }
    // On macOS the strip goes empty and see-through with the page running up underneath it, and the app bar is what fills it. Apple's three dots go off and the page draws its own in the same place: theirs are pinned to the window and cannot fold, so the bar had to reserve 86px for them whether it had the room or not, which cost the tab strip a quarter of its width on a narrow window. The price of drawing them is the green one's tiling menu, and Apple's own hover and disabled states.
    //
    // The window's own shadow goes here too, for the reason it goes on Windows: the app draws it. `false` rather than left out, because AppKit's is on unless something says otherwise. Dropping the decorations still stays out of this arm — tao overwrites every title-bar property when it is told to, and the see-through strip goes with them.
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::WindowBuilderExtMacOS;
        window_builder = window_builder
            .with_fullsize_content_view(true)
            .with_titlebar_transparent(true)
            .with_title_hidden(true)
            .with_titlebar_buttons_hidden(true)
            .with_has_shadow(false);
    }
    // See-through on both platforms, so the strip of page the app is held off the window by shows what is behind the window rather than a page color.
    #[cfg(target_os = "macos")]
    {
        window_builder = window_builder.with_transparent(true);
    }
    // The icon here is the dock's and the app switcher's, not the strip's, so macOS wants it as much as any other non-Windows build.
    #[cfg(not(windows))]
    {
        window_builder = window_builder.with_window_icon(load_window_icon());
    }
    // A copy a build launched to watch something is started at a place off every monitor, and Windows hands that place to this window because nothing above asks for a position. Such a window must not hold the keyboard: the owner would go on typing into a window they cannot find. So it is shown without taking focus, which tao does with `SW_SHOWNOACTIVATE` — and unlike a position, that flag is never checked against a monitor. The web view is built without focus for the same reason, further down: it takes focus on creation unless told otherwise, and that activates the window the window flag just kept quiet. An ordinary launch carries no startup place, so nothing about it changes.
    #[cfg(windows)]
    let comes_up_unseen =
        started_off_every_monitor(&monitor_rects(event_loop.available_monitors()));
    #[cfg(windows)]
    if comes_up_unseen {
        window_builder = window_builder.with_focused(false);
    }
    let window = window_builder.build(&event_loop)?;

    let proxy = event_loop.create_proxy();

    // Later launches forward their request here over the single-instance pipe: open the file they carried, or just focus when they carried none.
    single_instance::serve({
        let proxy = proxy.clone();
        move |maybe_path| {
            let _ = proxy.send_event(match maybe_path {
                Some(path) => UserEvent::OpenPaths(vec![path]),
                None => UserEvent::FocusWindow,
            });
        }
    });

    // Answers questions about this running app on a local channel, and takes two orders — run a line of JavaScript in the page, and close. See src/pipe.rs.
    pipe::serve(proxy.clone());

    let handler = ipc_handler(proxy.clone());
    let drag_drop_handler = drag_drop_handler(proxy.clone());
    let local_image_source_dir = Arc::new(Mutex::new(None::<PathBuf>));
    let (mut web_context, webview_data_dir) = create_webview_context()?;
    if let Some(path) = &webview_data_dir {
        eprintln!("Using WebView2 user data folder: {}", path.display());
    }

    // The persisted toggles and recent files are handed to the webview as initialization scripts (run before any page script), so theme and library render from saved state on the first paint. Loaded here to ride in on the same scripts rather than being injected post-build, which raced the load.
    let config_path = config_file_path();
    let recent = config_path
        .as_ref()
        .map(load_recent_files)
        .unwrap_or_default();
    // The kept paths ride in the same file, so one read answers both.
    let favorites = config_path.as_ref().map(load_favorites).unwrap_or_default();

    // The strip can paint from this without reading a document. The front document waits for the page's own boot word, just like a file passed on the command line.
    let workspace = Workspace::from_session(&settings.session);
    if workspace.session() != settings.session {
        settings.session = workspace.session();
        persist_settings(&settings, settings_path.as_ref());
    }
    let tabs = workspace.tab_summaries();

    // The vault registry, so the leftmost crumb reads the active vault's name on the first paint. Opening the manifest here is also what applies its migrations, before anything else reads it.
    let data_dir = app_data_dir();
    let vault_state = VaultState::load(data_dir.as_deref());

    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        // See-through, so the strip of page the app is held off the window by shows what is behind the window and the app's own shadow can fall on it. Both halves are needed: a transparent window over an opaque web view shows nothing.
        .with_transparent(true)
        .with_html(app_shell_html_with_front_end(front_end_asset()))
        .with_initialization_script(initial_settings_script(&settings))
        .with_initialization_script(settings_unreadable_script(settings_unreadable))
        // The operating system's own accessibility answer, not one of the app's switches, so it is read here at launch rather than persisted.
        .with_initialization_script(scrollbars_always_script(platform::scrollbars_always_shown()))
        .with_initialization_script(update_failed_script(apply_outcome.as_ref()))
        .with_initialization_script(unexpected_close_script(closed_unexpectedly))
        .with_initialization_script(initial_vaults_script(
            &vault_state.vaults(),
            vault_state.active,
        ))
        .with_initialization_script(initial_state_script(
            &recent.files,
            &favorites,
            &tabs,
            workspace.active,
        ))
        .with_initialization_script(initial_document_exts_script())
        .with_initialization_script(initial_document_formats_script())
        .with_initialization_script(initial_page_exports_script())
        .with_initialization_script(initial_version_script())
        .with_initialization_script(initial_update_script(
            platform::platform_update_asset_suffix(),
        ))
        // Whether we draw the window buttons ourselves (Windows), so the frontend shows its own title-bar chrome — drag region + minimize/maximize/close buttons.
        .with_initialization_script(format!("window.__leafFrameless = {};", cfg!(windows)))
        // The other kind of frameless: the app bar is the title bar, but Apple's own three dots are inset into it, so the page leaves room for them and draws no buttons of its own.
        .with_initialization_script(format!(
            "window.__leafMacFrame = {};",
            cfg!(target_os = "macos")
        ))
        // Initial maximized state, so the maximize button shows the restore-down icon from the first paint when the window opens maximized.
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
        .with_custom_protocol(SITE_PROTOCOL.to_string(), site_protocol_handler())
        .with_ipc_handler(handler)
        .with_drag_drop_handler(drag_drop_handler);

    // Trim WebView2's footprint for a single-window offline reader. This replaces wry's default arg string, so its defaults (msWebOOUI/msPdfOOUI/SmartScreen off, autoplay policy) are folded back in. Site isolation is off (Leaf has no cross-origin content), GPU stays on for smooth scroll, and the renderer is un-backgrounded so it stays responsive when occluded.
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

    // The other half of a copy that comes up where nobody can see it. The web view moves focus into itself as it is created unless told not to, and that activates the window — so a window shown without the keyboard would take it back the moment the page existed.
    #[cfg(windows)]
    let builder = if comes_up_unseen {
        builder.with_focused(false)
    } else {
        builder
    };

    // Windows and macOS both host the web view in the window directly, so this builds against the window itself rather than a container widget.
    let webview = builder.build(&window)?;

    update_active_navigation(Some(&webview), &workspace);

    // A command-line file waits here until the page says every front-end fragment has run; rendering it before the page's hooks exist lands silently on the home screen. The page's `frontEndReady` releases it, and every other route into a document waits in the same queue.
    let launch_open = LaunchOpenQueue::with_launch_path(arg_path);

    let webview = Some(webview);
    let _web_context = web_context;
    let file_watch = FileWatch::new(proxy.clone());

    // Size to restore next launch: the inner size the last time it was *not* maximized, in logical px, so a maximized-at-close window still returns to its windowed dimensions.
    let last_windowed_size =
        LogicalSize::new(settings.window_width as f64, settings.window_height as f64);

    // Last maximized state pushed to the webview, so the custom title bar's maximize/restore icon tracks maximize changes from any source (the button, a double-click, snap, or Win+Up), not just the button.
    let last_maximized = settings.window_maximized;
    // Read before `settings` is moved into the context below, and the same value: the window is built windowed whatever this says, and it is applied when the window grows.
    let settings_window_maximized = settings.window_maximized;

    let ctx = AppCtx {
        reader: Reader {
            window,
            webview,
            workspace,
            recent,
            favorites,
            config_path,
            image_dir: local_image_source_dir,
        },
        settings,
        settings_path,
        launch_open,
        proxy,
        file_watch,
        vault_state,
        last_windowed_size,
        // Where the window is heading, applied in one step once the page says it has drawn something.
        startup: StartupWindow {
            size: last_windowed_size,
            maximized: settings_window_maximized,
            grown: false,
        },
        last_maximized,
        // Nothing persists a full-screen state, so the window is built windowed; macOS restoring a full-screen space arrives as a resize, which corrects this.
        last_fullscreen: false,
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
        let mut answer = Response::builder()
            .status(image.status)
            .header("Content-Type", image.content_type)
            .header("Cache-Control", "no-store");
        // Sent for one of the eleven kinds of picture the reading view draws and left off everything else, which is what keeps the page's read to pictures rather than to whatever file an address happens to name.
        if !image.allow_origin.is_empty() {
            answer = answer.header("Access-Control-Allow-Origin", image.allow_origin);
        }
        answer
            .body(Cow::Owned(image.body))
            .expect("local image protocol response builds")
    }
}

// Serves the binary's bundled mermaid/KaTeX assets so diagrams and math render offline — no CDN.
fn bundled_asset_protocol_handler(
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_webview_id, request| {
        let asset = bundled_asset_response(request.uri().to_string().as_str());
        Response::builder()
            .status(asset.status)
            .header("Content-Type", asset.content_type)
            // The scripts fetch in anonymous cross-origin mode; without this half of the pair the browser masks every throw inside one as `Script error.` with no place.
            .header("Access-Control-Allow-Origin", asset.allow_origin)
            .header("Cache-Control", "max-age=31536000, immutable")
            .body(asset.body)
            .expect("bundled asset protocol response builds")
    }
}

// The open HTML page's own folder: its stylesheet, its pictures, its fonts and its media, one requested file at a time. No `Access-Control-Allow-Origin`: a contained page draws these and never reads their bytes back, and the app page around it is on an origin of its own that this must not hand anything to.
fn site_protocol_handler(
) -> impl Fn(wry::WebViewId, Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    move |_webview_id, request| {
        let asset = leaftext::site_protocol_response(request.uri().to_string().as_str());
        Response::builder()
            .status(asset.status)
            .header("Content-Type", asset.content_type)
            // A stylesheet edited on disk is a live reload away, and a cached copy would draw the page the reader just changed.
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(asset.body))
            .expect("site protocol response builds")
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

/// The Open dialog. What it offers is `open_window_filters`, which holds the reasoning.
fn pick_document_file() -> Option<PathBuf> {
    let mut dialog = FileDialog::new().set_title("Open Document");
    for (label, extensions) in open_window_filters(cfg!(target_os = "macos")) {
        dialog = dialog.add_filter(label, &extensions);
    }
    dialog.pick_file()
}

/// Where a document that has never had a file goes: every readable format off the one table, with the stem it has been wearing as the suggestion — so the first save of a new document is a Save As and nothing is written until someone has said where. With a format named the window carries that one alone, because a Mac panel shows none of them and the page has already asked. `save_window_filters` decides the rows.
fn pick_save_path(current: &Path, format: Option<&str>) -> Option<PathBuf> {
    let readable: Vec<(&'static str, &'static [&'static str])> = DocumentFormat::ALL
        .iter()
        .filter(|format| **format != DocumentFormat::Code)
        .map(|format| (format.display_name(), format.extensions()))
        .collect();
    let stem = current
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(UNTITLED_STEM);
    let offer = save_window_offer(&readable, format, stem);
    let mut dialog = FileDialog::new()
        .set_title("Save Document As")
        .set_file_name(&offer.name);
    for (label, extensions) in save_window_filters(&offer, cfg!(target_os = "macos")) {
        dialog = dialog.add_filter(label, &extensions);
    }
    dialog.save_file()
}

/// Where an exported diagram goes. With no format named the window carries every row the table holds and the page encodes whatever the chosen name ends in; with one, it carries that one alone, because a Mac panel shows no format at all and the page has already asked.
fn pick_diagram_path(stem: &str, format: Option<&str>) -> Option<PathBuf> {
    let offer = save_window_offer(DIAGRAM_EXPORT_FORMATS, format, stem);
    pick_export_path_titled("Export Diagram", &offer.name, &offer.filters)
}

/// Where an exported picture goes. The rows work the way the diagram window's do: with no format named the window carries every row the table holds and the page reads whatever the chosen name ends in, and with one it carries that row alone, because a Mac panel shows no format at all and the page has already asked.
fn pick_picture_path(stem: &str, format: Option<&str>) -> Option<PathBuf> {
    let offer = save_window_offer(PICTURE_EXPORT_FORMATS, format, stem);
    pick_export_path_titled("Export Picture", &offer.name, &offer.filters)
}

/// A save window under the caller's own title, offering the formats it is handed. A reader saving the page as a PDF is not exporting a diagram, and the title bar is the only thing in that window that says which.
fn pick_export_path_titled(
    title: &str,
    name: &str,
    filters: &[(&str, &[&str])],
) -> Option<PathBuf> {
    let mut dialog = FileDialog::new().set_title(title).set_file_name(name);
    for (label, extensions) in filters {
        dialog = dialog.add_filter(*label, extensions);
    }
    dialog.save_file()
}

/// The Insert image dialog. Filtered off the same table the reading view draws from, since a document can only show what the page can. `image_window_filters` decides the rows.
fn pick_image_file() -> Option<PathBuf> {
    let mut dialog = FileDialog::new().set_title("Choose an image");
    for (label, extensions) in image_window_filters(cfg!(target_os = "macos")) {
        dialog = dialog.add_filter(label, &extensions);
    }
    dialog.pick_file()
}

/// The New vault dialog: a folder, since a vault is a folder. Nothing is written into it — the app records the choice itself.
fn pick_vault_folder() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Choose a vault folder")
        .pick_folder()
}

/// Where a clone should land. The folder picked is the *parent*: git makes the repository's own folder inside it, named after the repository, and removes it again if the clone fails.
fn pick_clone_parent_folder() -> Option<PathBuf> {
    FileDialog::new()
        .set_title("Choose where the clone should go")
        .pick_folder()
}

/// Open each dropped document as a tab. Returns `true` to block the webview's default drop behavior (a useless "copy" cursor).
///
/// Always reports the drag as handled, which is also what keeps the web view from doing anything of its own with one — including its own drag and drop. Anything in the page built on HTML drag events would need this to answer per drag instead.
fn drag_drop_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(DragDropEvent) -> bool {
    move |event| {
        if let DragDropEvent::Drop { paths, .. } = event {
            // One delivery for the whole drop, so twenty files dropped together are drawn once rather than twenty times on the way to the last of them.
            let paths: Vec<PathBuf> = paths
                .into_iter()
                .filter(|path| is_supported_document_path(path))
                .collect();
            if !paths.is_empty() {
                let _ = proxy.send_event(UserEvent::OpenPaths(paths));
            }
        }
        true
    }
}

// The binary's tests live under app/, beside the code they cover. Both crate roots share src/, so a bare `mod tests;` here would find the library's test tree.
