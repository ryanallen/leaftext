//! The event loop: one arm for each thing the window, the page, the watcher or the workers can report.

use super::*;

use tao::event_loop::EventLoop;

/// Everything the loop owns between events, assembled by `run_app` at startup. It exists so the loop takes one argument instead of ten.
pub(crate) struct AppCtx {
    /// The window, the page, and what is on screen in them.
    pub(crate) reader: Reader,
    pub(crate) settings: Settings,
    pub(crate) settings_path: Option<PathBuf>,
    pub(crate) pending_open_path: Option<PathBuf>,
    pub(crate) proxy: EventLoopProxy<UserEvent>,
    pub(crate) file_watch: FileWatch,
    pub(crate) vault_state: VaultState,
    pub(crate) last_windowed_size: LogicalSize<f64>,
    pub(crate) last_maximized: bool,
    pub(crate) last_fullscreen: bool,
}

/// The compass point the page grabbed, as the window library names it. Anything else is dropped rather than guessed at.
pub(crate) fn resize_direction(direction: &str) -> Option<tao::window::ResizeDirection> {
    use tao::window::ResizeDirection::*;
    Some(match direction {
        "n" => North,
        "ne" => NorthEast,
        "e" => East,
        "se" => SouthEast,
        "s" => South,
        "sw" => SouthWest,
        "w" => West,
        "nw" => NorthWest,
        _ => return None,
    })
}

/// Apply a page command that records a setting; the one caller persists when this returns true. A new persisted toggle is its command plus an arm here.
fn apply_setting_command(settings: &mut Settings, command: IpcCommand) -> bool {
    match command {
        IpcCommand::SetSpeedReaderEnabled { enabled } => settings.speed_reader_enabled = enabled,
        IpcCommand::SetCodeIntelEnabled { enabled } => settings.code_intel_enabled = enabled,
        IpcCommand::SetReadingUnlocked { enabled } => settings.reading_unlocked = enabled,
        IpcCommand::SetCodeUnlocked { enabled } => settings.code_unlocked = enabled,
        IpcCommand::SetThemeFamily { family } => settings.theme_family = family,
        IpcCommand::SetThemeMode { mode } => settings.theme_mode = mode,
        IpcCommand::SetThemeRandomBag { used } => settings.theme_random_used = used,
        IpcCommand::SetHintState {
            launches,
            seen,
            last_launch,
        } => {
            settings.hint_launches = launches;
            settings.hints_seen = seen;
            settings.hint_last_launch = last_launch;
        }
        IpcCommand::SetLibraryState { project_path } => {
            settings.library_project_path = project_path
        }
        IpcCommand::SetLibraryLayout { closed, width } => {
            settings.library_closed = closed;
            settings.library_width = width;
        }
        // Anything unrecognized is ignored rather than persisted.
        IpcCommand::SetGraphScope { scope } => match GraphScope::from_client(&scope) {
            Some(scope) => settings.graph_scope = scope,
            None => return false,
        },
        _ => return false,
    }
    true
}

/// The one way out: remember the geometry, save it, drop the page, stop the loop. The close button, the page's own close, and applying an update all end here — the update helper waits for this process to exit before installing.
fn shut_down(
    reader: &mut Reader,
    settings: &mut Settings,
    settings_path: Option<&PathBuf>,
    windowed_size: LogicalSize<f64>,
    control_flow: &mut ControlFlow,
) {
    settings.window_width = windowed_size.width.round() as u32;
    settings.window_height = windowed_size.height.round() as u32;
    settings.window_maximized = reader.window.is_maximized();
    persist_settings(settings, settings_path);
    let _ = reader.webview.take();
    *control_flow = ControlFlow::Exit;
}

/// Runs until the window closes, which ends the process — hence the `!`.
pub(crate) fn run_event_loop(event_loop: EventLoop<UserEvent>, ctx: AppCtx) -> ! {
    // Unpacked straight back into locals: the arms mutate most of these and read them constantly, and `ctx.` at every use would bury the event handling.
    let AppCtx {
        mut reader,
        mut settings,
        settings_path,
        mut pending_open_path,
        proxy,
        mut file_watch,
        mut vault_state,
        mut last_windowed_size,
        mut last_maximized,
        mut last_fullscreen,
    } = ctx;

    // The last file sent to the bin and where it landed, so Undo has something to act on. One deep on purpose: the offer lives only as long as its message, so a second delete has already retired the first.
    let mut last_delete: Option<(PathBuf, Option<PathBuf>)> = None;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                // Remember the size only while windowed; convert the physical event size to the logical size the next launch expects.
                if !reader.window.is_maximized()
                    && !reader.window.is_minimized()
                    && size.width > 0
                    && size.height > 0
                {
                    last_windowed_size = size.to_logical(reader.window.scale_factor());
                }
                // Keep the custom title bar's maximize/restore icon in sync with the real window state whenever it changes.
                let maximized = reader.window.is_maximized();
                if maximized != last_maximized {
                    last_maximized = maximized;
                    run_page_script(
                        reader.page(),
                        &format!("window.leafSetWindowMaximized({maximized});"),
                        "Failed to sync the maximize button",
                    );
                }
                // Full screen takes Apple's three dots away with the rest of the chrome, so the room the app bar leaves for them goes too. Read off the window, not off a gesture: the green button, the menu item and the shortcut all reach us as a resize and nothing else.
                let fullscreen = reader.window.fullscreen().is_some();
                if fullscreen != last_fullscreen {
                    last_fullscreen = fullscreen;
                    run_page_script(
                        reader.page(),
                        &format!("window.leafSetFullscreen({fullscreen});"),
                        "Failed to sync the full-screen inset",
                    );
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => shut_down(
                &mut reader,
                &mut settings,
                settings_path.as_ref(),
                last_windowed_size,
                control_flow,
            ),
            // macOS delivers a double-clicked document as an Apple Event, not an argument, so file associations there are inert without this. Before the page is up the path waits with the command-line one.
            Event::Opened { urls } => {
                for path in urls.iter().filter_map(|url| url.to_file_path().ok()) {
                    if reader.webview.is_some() && pending_open_path.is_none() {
                        let _ = proxy.send_event(UserEvent::OpenPath(path));
                    } else {
                        pending_open_path = Some(path);
                    }
                }
            }
            Event::UserEvent(UserEvent::WebviewReady) => {
                if let Some(path) = pending_open_path.take() {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
                // Once there is a page to tell: any cloud folder on this machine becomes a vault, and the page learns which folders they are. Off the loop, so a slow disk never delays the first paint.
                request_cloud_folders(&proxy);
            }
            Event::UserEvent(UserEvent::FocusWindow) => {
                reader.window.set_minimized(false);
                reader.window.set_focus();
            }
            Event::UserEvent(UserEvent::OpenPath(path)) => {
                reader.workspace.open_path(path);
                reader.render(ScrollIntent::Reset);
                // A forwarded open from a second launch should surface the window.
                reader.window.set_minimized(false);
                reader.window.set_focus();
            }
            Event::UserEvent(UserEvent::FileChanged(changed)) => {
                // The active document live-reloads; a sibling change instead refreshes the pane and the corpus so both stay in sync without a full rescan.
                let is_active_document = reader
                    .workspace
                    .active_path()
                    .is_some_and(|current| paths_refer_to_same_document(&changed, current));
                // Above the split, or it misses the commonest change of all — saving the document you are reading takes the other branch. Unfiltered on purpose: a containment check here compares the watcher's canonicalised path against the registry's plain one and so discards every event. One `git status`, off the loop, on an already-debounced event, is cheaper than being wrong.
                if vault_state.active != 0 {
                    refresh_vault_status(&vault_state, &proxy, vault_state.active);
                }
                if is_active_document {
                    reload_active_document(&mut reader, &mut file_watch);
                } else {
                    // The pane lists one folder off the disk, so a file added, renamed or removed in that folder changes what it shows.
                    if change_affects_pane(&vault_state, &changed) {
                        let folder = vault_state.folder.clone();
                        request_folder(&vault_state, &proxy, folder);
                    }
                    // And the vault's text is a cache of the disk, so it is patched a file at a time rather than re-read. The graph is only redrawn when the graph is the view on screen — rebuilding it for a pane nobody is looking at is what makes a burst of saves lock the window.
                    let graph_showing = vault_state.graph_open;
                    refresh_corpus_path(&mut vault_state, &proxy, &changed, graph_showing);
                    // An image, not a document: the text is unchanged, so the reload above would hash-gate itself out.
                    if is_local_image_path(&changed) {
                        run_page_script(
                            reader.page(),
                            &image_refresh_script(),
                            "Live reload: failed to refresh images",
                        );
                    }
                }
            }
            Event::UserEvent(UserEvent::VaultGitReady { json }) => {
                deliver_vault_git(reader.page(), &json);
            }
            Event::UserEvent(UserEvent::VaultStatusReady { id, json }) => {
                deliver_vault_status(reader.page(), id, &json);
            }
            Event::UserEvent(UserEvent::CloudFoldersReady { folders }) => {
                deliver_cloud_folders(&vault_state, reader.page(), &folders);
            }
            Event::UserEvent(UserEvent::VaultCloneDone { folder, error }) => {
                deliver_vault_clone(folder, error, &mut vault_state, &proxy, reader.page());
            }
            Event::UserEvent(UserEvent::FolderLoaded { scope, listing }) => {
                deliver_folder(&mut vault_state, reader.page(), scope, listing);
            }
            Event::UserEvent(UserEvent::CorpusLoaded { corpus, hints }) => {
                let root = corpus.root.clone();
                deliver_corpus(&mut vault_state, &proxy, *corpus);
                // Only for the vault still on screen: the hints name that vault's fields, and `deliver_corpus` has already thrown the read away if it is not.
                if vault_state.root.as_deref() == Some(root.as_path()) {
                    run_page_script(
                        reader.page(),
                        &filter_hints_script(&hints),
                        "Failed to seed the filter hints",
                    );
                }
            }
            Event::UserEvent(UserEvent::GraphReady { source, graph }) => {
                deliver_graph(
                    &vault_state,
                    reader.webview.as_ref(),
                    reader.workspace.active_path(),
                    source,
                    graph,
                );
            }
            Event::UserEvent(UserEvent::SearchReady {
                scope,
                query,
                results,
            }) => {
                deliver_search(&mut vault_state, reader.page(), scope, &query, results);
            }
            Event::UserEvent(UserEvent::PagerLoaded { path, html }) => {
                let is_active_document = reader
                    .workspace
                    .active_path()
                    .is_some_and(|current| paths_refer_to_same_document(&path, current));
                if is_active_document {
                    run_page_script(
                        reader.page(),
                        &pager_loaded_script(&path, &html),
                        "Failed to update document pager",
                    );
                }
            }
            Event::UserEvent(UserEvent::CodeIntelReady { script }) => {
                run_page_script(
                    reader.page(),
                    &script,
                    "Failed to answer the code view's typing help",
                );
            }
            Event::UserEvent(UserEvent::UpdateDownloadProgress { version, percent }) => {
                run_page_script(
                    reader.page(),
                    &update_progress_script(&version, percent),
                    "Failed to report download progress",
                );
            }
            Event::UserEvent(UserEvent::UpdateDownloadStaged { version }) => {
                settings.update_staged_version = version.clone();
                persist_settings(&settings, settings_path.as_ref());
                // Now that a newer one is ready, older staged installers are just disk usage.
                if let Some(data_dir) = app_data_dir() {
                    leaftext::prune_staged(&data_dir, Some(&version));
                }
                report_update_state(reader.page(), "staged", &version, None);
            }
            Event::UserEvent(UserEvent::UpdateDownloadFailed { version, message }) => {
                eprintln!("Update download failed: {message}");
                report_update_state(reader.page(), "failed", &version, Some(&message));
            }
            Event::UserEvent(UserEvent::PipeState { reply }) => {
                // try_send, not send: the asker may already have given up and gone, and the window thread must not block on a dead channel.
                let _ = reply.try_send(Ok(pipe_state(&reader.workspace, &vault_state)));
            }
            Event::UserEvent(UserEvent::PipeEval { script, reply }) => {
                // The one script the app runs for an answer rather than an effect. It arrives later and on whatever thread the web view calls back on, so the reply channel travels into the callback.
                match reader.page() {
                    Some(page) => {
                        let failed = reply.clone();
                        if let Err(error) =
                            page.evaluate_script_with_callback(&script, move |result| {
                                let value = serde_json::from_str(&result)
                                    .unwrap_or_else(|_| serde_json::json!(result));
                                let _ = reply.try_send(Ok(value));
                            })
                        {
                            let _ = failed.try_send(Err(format!("the page refused it: {error}")));
                        }
                    }
                    None => {
                        let _ = reply.try_send(Err("there is no window to run it in".to_string()));
                    }
                }
            }
            Event::UserEvent(UserEvent::FromPage(command)) => match command {
                IpcCommand::Open => {
                    if let Some(path) = pick_document_file() {
                        reader.workspace.open_path(path);
                        reader.render(ScrollIntent::Reset);
                    }
                }
                IpcCommand::NewDocument => {
                    reader.workspace.open_untitled();
                    // Before the render, so the first paint already carries the editors - there is nothing to click before typing.
                    run_page_script(
                        reader.page(),
                        &unlock_reading_script(),
                        "Failed to unlock the new document",
                    );
                    reader.render(ScrollIntent::Reset);
                }
                // The page opening a file is the same act as a forwarded open.
                IpcCommand::OpenRecent { path } => {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
                IpcCommand::PasteFile {
                    path,
                    into_folder,
                    cut,
                } => match transfer_into_folder(&path, &into_folder, cut) {
                    Ok(_) => refresh_library_folder(reader.page()),
                    Err(error) => {
                        let verb = if cut { "move" } else { "copy" };
                        eprintln!(
                            "Failed to {verb} {} into {}: {error}",
                            path.display(),
                            into_folder.display()
                        );
                        report_file_action_failure(reader.page(), &error.to_string());
                    }
                },
                IpcCommand::RevealFile { path } => {
                    if let Err(error) = reveal_in_file_manager(&path) {
                        eprintln!(
                            "Failed to reveal {} in the file manager: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::CopyFile { path, cut } => {
                    if let Err(error) = copy_file_to_clipboard(&path, cut) {
                        eprintln!(
                            "Failed to copy {} to the clipboard: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::ToggleFavorite { path, kind } => {
                    // Which vault holds it is the registry's answer, not the pane's: something opened from outside every vault belongs to none.
                    let vault_id = vault_state
                        .conn
                        .as_ref()
                        .and_then(|conn| vault_containing(conn, &path))
                        .map(|vault| vault.id);
                    reader.toggle_favorite(path, kind, vault_id);
                }
                IpcCommand::CheckFavorites => {
                    // A metadata read per favorite, and only while the start screen is up: the list is short and the user marked every path in it, so this is not a crawl. Never stored, because a stored answer is wrong the moment a file moves with the app shut.
                    let missing: Vec<String> = reader
                        .favorites
                        .entries
                        .iter()
                        .filter(|one| !one.path.exists())
                        .map(|one| one.path.display().to_string())
                        .collect();
                    // A vault whose own folder has gone is one fact, not one per row inside it: repointing a file inside a folder that is not there is not the fix.
                    let gone_vaults: Vec<i64> = vault_state
                        .conn
                        .as_ref()
                        .and_then(|conn| list_vaults(conn).ok())
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|vault| !Path::new(&vault.root_path).is_dir())
                        .map(|vault| vault.id)
                        .collect();
                    run_page_script(
                        reader.page(),
                        &favorites_missing_script(&missing, &gone_vaults),
                        "Failed to mark the favorites that have gone",
                    );
                }
                IpcCommand::RepointFavorite { path } => {
                    if let Some(chosen) = pick_document_file() {
                        let vault_id = vault_state
                            .conn
                            .as_ref()
                            .and_then(|conn| vault_containing(conn, &chosen))
                            .map(|vault| vault.id);
                        reader.repoint_favorite(&path, &chosen, vault_id);
                    }
                }
                IpcCommand::MoveFavorite { path, before } => {
                    reader.move_favorite(&path, before.as_deref());
                }
                IpcCommand::CopyPath { path } => {
                    if let Err(error) = copy_path_to_clipboard(&path) {
                        eprintln!(
                            "Failed to copy the path {} to the clipboard: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::RenameFile { path, new_name } => match rename_file(&path, &new_name) {
                    Ok(_) => refresh_library_folder(reader.page()),
                    Err(error) => {
                        eprintln!("Failed to rename {}: {error}", path.display());
                        report_file_action_failure(reader.page(), &error.to_string());
                    }
                },
                IpcCommand::DeleteFile { path } => match delete_to_trash(&path) {
                    Ok(landed) => {
                        // Where it went, kept only until the next delete or the undo that spends it. Windows answers `None` and needs nothing more than the original path.
                        last_delete = Some((path.clone(), landed));
                        refresh_library_folder(reader.page());
                        report_file_deleted(reader.page(), &path);
                    }
                    Err(error) => {
                        eprintln!("Failed to move {} to the trash: {error}", path.display());
                        report_file_action_failure(reader.page(), &error);
                    }
                },
                IpcCommand::UndoDelete { path } => {
                    // Only the delete the record is actually about: the page's offer expires with its message, and the two must not be able to drift apart.
                    let restoring = match last_delete.take() {
                        Some((original, landed)) if original == path => Some((original, landed)),
                        // Not ours to undo, and putting the record back would leave a spent offer live.
                        _ => None,
                    };
                    match restoring {
                        Some((original, landed)) => {
                            match restore_from_trash(&original, landed.as_deref()) {
                                Ok(()) => refresh_library_folder(reader.page()),
                                Err(error) => {
                                    eprintln!(
                                        "Failed to bring {} back: {error}",
                                        original.display()
                                    );
                                    report_file_action_failure(reader.page(), &error);
                                }
                            }
                        }
                        None => report_file_action_failure(
                            reader.page(),
                            "there is nothing left to put back",
                        ),
                    }
                }
                IpcCommand::ShowProperties { path } => {
                    if let Err(error) = show_properties(&path) {
                        eprintln!("Failed to show properties for {}: {error}", path.display());
                    }
                }
                IpcCommand::CloseTab { index } => {
                    reader.workspace.close_tab(index);
                    reader.render(ScrollIntent::Reset);
                }
                IpcCommand::SwitchTab {
                    index,
                    scroll_anchor,
                    code_scroll,
                } => {
                    // Clicking the active tab is a no-op; re-rendering would jump the reader.
                    if reader.workspace.active == Some(index) {
                        return;
                    }
                    if let Some(active) = reader.workspace.active {
                        if let Some(tab) = reader.workspace.tabs.get_mut(active) {
                            tab.history.stamp_current(scroll_anchor);
                            // Remember where the source editor was left; `None` for a reading-view tab, which leaves nothing to restore.
                            tab.saved_code_scroll = code_scroll;
                        }
                    }
                    if reader.workspace.set_active(index) {
                        // Reopen where the reader left it (`None` starts at the top).
                        let saved = reader
                            .workspace
                            .tabs
                            .get(index)
                            .and_then(|tab| tab.history.current_anchor());
                        let code = reader
                            .workspace
                            .tabs
                            .get(index)
                            .and_then(|tab| tab.saved_code_scroll);
                        reader.render(ScrollIntent::Restore {
                            anchor: saved,
                            code,
                        });
                    }
                }
                IpcCommand::MoveTab { from, to } => {
                    if reader.workspace.move_tab(from, to) {
                        // Only the tab order changed; keep the reader in place rather than snapping the active document back to the top.
                        reader.render(ScrollIntent::Preserve);
                    }
                }
                IpcCommand::GoHome => {
                    reader.workspace.go_home();
                    reader.render(ScrollIntent::Reset);
                }
                IpcCommand::OpenLink {
                    href,
                    scroll_anchor,
                    new_page,
                } => {
                    let Some(active) = reader.workspace.active else {
                        return;
                    };
                    let Some(current_path) =
                        reader.workspace.tabs[active].history.current().cloned()
                    else {
                        return;
                    };
                    // A bare `glossary:` link ("open the full glossary"): resolve to the nearest GLOSSARY.md and open it as a tab.
                    if glossary_scheme_slug(&href).is_some() {
                        match nearest_glossary_above(&current_path) {
                            Some(path) if !paths_refer_to_same_document(&path, &current_path) => {
                                reader.workspace.tabs[active].scroll_history.clear();
                                reader.workspace.tabs[active]
                                    .history
                                    .stamp_current(scroll_anchor);
                                reader.workspace.tabs[active].history.record(path);
                                reader.render(ScrollIntent::Reset);
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
                                reader.workspace.tabs[active]
                                    .scroll_history
                                    .record(scroll_anchor);
                                update_active_navigation(reader.page(), &reader.workspace);
                                scroll_to_fragment(reader.page(), &fragment);
                            }
                        }
                        LinkTarget::External(target) | LinkTarget::LocalOther(target) => {
                            if let Err(error) = open_with_os(&target) {
                                eprintln!("Failed to open {target} with the OS: {error}");
                            }
                        }
                        LinkTarget::LocalDocument(target) => {
                            let path = path_from_local_link(&target, &current_path);
                            if paths_refer_to_same_document(&path, &current_path) {
                                if let Some(fragment) = fragment_from_href(&target) {
                                    reader.workspace.tabs[active]
                                        .scroll_history
                                        .record(scroll_anchor);
                                    update_active_navigation(reader.page(), &reader.workspace);
                                    scroll_to_fragment(reader.page(), &fragment);
                                }
                                return;
                            }
                            // Behind the page being read, so the reader keeps their place: the strip gains an entry and the document on screen is not rendered again.
                            if new_page {
                                reader.workspace.open_path_behind(path);
                                reader.refresh_tab_strip();
                                return;
                            }
                            reader.workspace.tabs[active].scroll_history.clear();
                            reader.workspace.tabs[active]
                                .history
                                .stamp_current(scroll_anchor);
                            reader.workspace.tabs[active].history.record(path);
                            reader.render(ScrollIntent::Reset);
                            if let Some(fragment) = fragment_from_href(&target) {
                                scroll_to_fragment(reader.page(), &fragment);
                            }
                        }
                    }
                }
                IpcCommand::OpenExternal { url } => {
                    let open = |target: &str| {
                        if let Err(error) = open_with_os(target) {
                            eprintln!("Failed to open {target} with the OS: {error}");
                        }
                    };
                    DesktopHost {
                        open_with_os: Some(&open),
                        ..DesktopHost::default()
                    }
                    .open_link(&url);
                }
                IpcCommand::OpenGlossary { href } => {
                    let Some(current_path) = reader.workspace.active_path().map(Path::to_path_buf)
                    else {
                        return;
                    };
                    show_glossary_entry(reader.page(), &href, &current_path);
                }
                IpcCommand::RevealLink { href } => {
                    let Some(path) = reader
                        .workspace
                        .active_path()
                        .and_then(|current| linked_document_path(&href, current))
                    else {
                        return;
                    };
                    if let Err(error) = reveal_in_file_manager(&path) {
                        eprintln!(
                            "Failed to reveal {} in the file manager: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::CopyLinkPath { href } => {
                    let Some(path) = reader
                        .workspace
                        .active_path()
                        .and_then(|current| linked_document_path(&href, current))
                    else {
                        return;
                    };
                    if let Err(error) = copy_path_to_clipboard(&path) {
                        eprintln!(
                            "Failed to copy the path {} to the clipboard: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::CountLines { href, token } => {
                    // Count the linked document's lines for the hover tooltip. Only in-app document links resolve to a file; else -1 ("unknown").
                    let lines = reader
                        .workspace
                        .active_path()
                        .and_then(|current| linked_document_path(&href, current))
                        .and_then(|path| read_source(&path).ok())
                        .map(|source| source.text.lines().count() as i64)
                        .unwrap_or(-1);
                    run_page_script(
                        reader.page(),
                        &line_count_script(token, lines),
                        "Failed to send line count to the webview",
                    );
                }
                IpcCommand::GoBack { scroll_anchor } => {
                    let Some(active) = reader.workspace.active else {
                        return;
                    };
                    let restored = {
                        let tab = &mut reader.workspace.tabs[active];
                        if let Some(scroll_position) =
                            tab.scroll_history.back(scroll_anchor.clone())
                        {
                            Some(scroll_position)
                        } else if tab.history.can_go_back() {
                            tab.history.stamp_current(scroll_anchor);
                            tab.history.go_back();
                            None
                        } else {
                            return;
                        }
                    };
                    match restored {
                        Some(scroll_position) => {
                            restore_scroll_anchor(reader.page(), &scroll_position);
                            update_active_navigation(reader.page(), &reader.workspace);
                        }
                        // Back into the document the reader came from, at the place they left it. A tab showing source starts at the top instead.
                        None => {
                            let anchor = reader.workspace.tabs[active].history.current_anchor();
                            reader.render(ScrollIntent::Restore {
                                anchor,
                                code: Some(0.0),
                            });
                        }
                    }
                }
                IpcCommand::GoForward { scroll_anchor } => {
                    let Some(active) = reader.workspace.active else {
                        return;
                    };
                    let restored = {
                        let tab = &mut reader.workspace.tabs[active];
                        if let Some(scroll_position) =
                            tab.scroll_history.forward(scroll_anchor.clone())
                        {
                            Some(scroll_position)
                        } else if tab.history.can_go_forward() {
                            tab.history.stamp_current(scroll_anchor);
                            tab.history.go_forward();
                            None
                        } else {
                            return;
                        }
                    };
                    match restored {
                        Some(scroll_position) => {
                            restore_scroll_anchor(reader.page(), &scroll_position);
                            update_active_navigation(reader.page(), &reader.workspace);
                        }
                        None => {
                            let anchor = reader.workspace.tabs[active].history.current_anchor();
                            reader.render(ScrollIntent::Restore {
                                anchor,
                                code: Some(0.0),
                            });
                        }
                    }
                }
                IpcCommand::EnterCodeView => {
                    // A fresh toggle carries its own position: the page stashed the reading view's scroll fraction before asking to enter.
                    enter_code_view(reader.webview.as_ref(), &mut reader.workspace, None);
                }
                IpcCommand::ExitCodeView => {
                    if let Some(index) = reader.workspace.active {
                        if let Some(tab) = reader.workspace.tabs.get_mut(index) {
                            tab.code_view = false;
                        }
                    }
                    reader.render(ScrollIntent::Reset);
                }
                IpcCommand::UpdateSource { text } => {
                    update_source_buffer(reader.webview.as_ref(), &mut reader.workspace, text);
                }
                IpcCommand::SpliceSource {
                    start,
                    removed,
                    inserted,
                    length,
                } => {
                    splice_source_buffer(
                        reader.webview.as_ref(),
                        &mut reader.workspace,
                        start,
                        removed,
                        &inserted,
                        length,
                    );
                }
                IpcCommand::CodeCompleteNotes { token } => {
                    let document = reader.workspace.active_path().map(Path::to_path_buf);
                    code_complete_notes(&mut vault_state, &proxy, document.as_deref(), token);
                }
                IpcCommand::CodeCompleteHeadings { token, note } => {
                    code_complete_headings(
                        &mut vault_state,
                        &proxy,
                        &reader.workspace,
                        token,
                        note,
                    );
                }
                IpcCommand::CodeHoverNote { token, note } => {
                    let document = reader.workspace.active_path().map(Path::to_path_buf);
                    code_hover_note(&mut vault_state, &proxy, document.as_deref(), token, note);
                }
                IpcCommand::CodeLint { token } => {
                    code_lint(&mut vault_state, &proxy, &reader.workspace, token);
                }
                IpcCommand::SaveDocument => {
                    match name_untitled_document(&mut reader, pick_save_path) {
                        SaveReady::Canceled => {}
                        ready => {
                            save_active_document(
                                reader.webview.as_ref(),
                                &mut reader.workspace,
                                &mut file_watch,
                            );
                            // The tab, the title and the image folder still say Untitled. A plain save changes none of them.
                            if matches!(ready, SaveReady::Named) {
                                reader.render(ScrollIntent::Preserve);
                            }
                        }
                    }
                }
                IpcCommand::ToggleTask { index } => {
                    toggle_task_marker(
                        reader.webview.as_ref(),
                        &mut reader.workspace,
                        &mut file_watch,
                        index,
                    );
                }
                IpcCommand::EditBlock {
                    start,
                    end,
                    text,
                    autosave,
                    cell,
                } => {
                    // Splice into the source buffer, then re-render from it, keeping the reader's place. Source stays authoritative for MD and XML. A checkbox toggle (autosave) splices without an undo step and writes to disk right away.
                    if apply_block_edit(
                        &mut reader.workspace,
                        start,
                        end,
                        &text,
                        !autosave,
                        cell.as_ref(),
                    ) {
                        if autosave {
                            autosave_active_buffer(&mut reader.workspace, &mut file_watch);
                        }
                        reader.render(ScrollIntent::Preserve);
                        // Host decides the Save/Undo buttons from the real dirty and undo state, not the frontend's guess.
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                // Re-rendered rather than patched in place: a field other things read has to change everywhere it is shown, not only in the cell it was typed into.
                IpcCommand::SetField { key, value } => {
                    let edit = match value.as_deref() {
                        Some(value) => FieldEdit::Set(value),
                        None => FieldEdit::Remove,
                    };
                    if apply_field_edit(&mut reader.workspace, &key, edit) {
                        reader.render(ScrollIntent::Preserve);
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                IpcCommand::SetListField { key, items } => {
                    if apply_field_edit(&mut reader.workspace, &key, FieldEdit::SetList(&items)) {
                        reader.render(ScrollIntent::Preserve);
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                IpcCommand::RenameField { key, to } => {
                    if apply_field_edit(&mut reader.workspace, &key, FieldEdit::Rename(&to)) {
                        reader.render(ScrollIntent::Preserve);
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                IpcCommand::MoveBlock { ranges, from, to } => {
                    if apply_block_move(&mut reader.workspace, &ranges, from, to) {
                        reader.render(ScrollIntent::Preserve);
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                IpcCommand::PickImage { token } => {
                    // The dialog blocks this thread, like Open's does. What comes back is a destination for the document to hold, not a file to copy: the picture stays where the user keeps it.
                    if let Some(image) = pick_image_file() {
                        let source = reader
                            .workspace
                            .active_path()
                            .map(Path::to_path_buf)
                            .unwrap_or_default();
                        let destination = markdown_image_insert_destination(&image, &source);
                        let alt = image
                            .file_stem()
                            .map(|stem| stem.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        run_page_script(
                            reader.page(),
                            &image_picked_script(token, &destination, &alt),
                            "Failed to hand the page the picked image",
                        );
                    }
                }
                IpcCommand::ExportDiagram {
                    format,
                    data,
                    width,
                    height,
                } => {
                    // The dialog blocks this thread, like Open's does. The active document only names the file it suggests; nothing about it is read or written.
                    let document = reader.workspace.active_path().map(Path::to_path_buf);
                    export_diagram(
                        reader.page(),
                        document.as_deref(),
                        &format,
                        &data,
                        width,
                        height,
                    );
                }
                IpcCommand::UndoEdit => {
                    // Pop the buffer back one edit, re-render, and resync so undoing the only edit also clears the Save button.
                    let undone = reader
                        .workspace
                        .active_edit_mut()
                        .is_some_and(EditableDocument::undo);
                    if undone {
                        reader.render(ScrollIntent::Preserve);
                        resync_editing_state(reader.page(), &reader.workspace);
                    }
                }
                // The persisted toggles, applied in one place and saved once.
                command @ (IpcCommand::SetSpeedReaderEnabled { .. }
                | IpcCommand::SetCodeIntelEnabled { .. }
                | IpcCommand::SetReadingUnlocked { .. }
                | IpcCommand::SetCodeUnlocked { .. }
                | IpcCommand::SetThemeFamily { .. }
                | IpcCommand::SetThemeMode { .. }
                | IpcCommand::SetThemeRandomBag { .. }
                | IpcCommand::SetHintState { .. }
                | IpcCommand::SetLibraryState { .. }
                | IpcCommand::SetLibraryLayout { .. }
                | IpcCommand::SetGraphScope { .. }) => {
                    if apply_setting_command(&mut settings, command) {
                        persist_settings(&settings, settings_path.as_ref());
                    }
                }
                IpcCommand::WindowDrag => {
                    let _ = reader.window.drag_window();
                }
                IpcCommand::WindowResizeDrag { direction } => {
                    if let Some(direction) = resize_direction(&direction) {
                        let _ = reader.window.drag_resize_window(direction);
                    }
                }
                IpcCommand::WindowMinimize => {
                    reader.window.set_minimized(true);
                }
                IpcCommand::WindowToggleMaximize => {
                    let maximized = reader.window.is_maximized();
                    reader.window.set_maximized(!maximized);
                }
                IpcCommand::WindowClose => shut_down(
                    &mut reader,
                    &mut settings,
                    settings_path.as_ref(),
                    last_windowed_size,
                    control_flow,
                ),
                IpcCommand::SetWindowChrome { r, g, b, dark } => {
                    apply_window_chrome(&reader.window, r, g, b, dark);
                }
                IpcCommand::SetGraphView { open } => {
                    vault_state.graph_open = open;
                }
                IpcCommand::GetVaultGit { id } => {
                    request_vault_git(&vault_state, &proxy, reader.page(), id);
                }
                IpcCommand::GetVaultStatus { id } => {
                    refresh_vault_status(&vault_state, &proxy, id);
                }
                IpcCommand::CreateVaultRepo { id } => {
                    create_vault_repo(&vault_state, &proxy, reader.page(), id);
                }
                IpcCommand::LinkVaultRemote { id, url } => {
                    link_vault_repo(&vault_state, &proxy, reader.page(), id, url);
                }
                IpcCommand::SyncVault { id } => {
                    sync_vault(&vault_state, &proxy, reader.page(), id);
                }
                IpcCommand::CreateVault => {
                    if let Some(folder) = pick_vault_folder() {
                        create_vault(&folder, &mut vault_state, &proxy, reader.page());
                    }
                }
                IpcCommand::GetCloudFolders => {
                    request_cloud_folders(&proxy);
                }
                IpcCommand::CloneVault { url } => {
                    // The folder is picked here rather than in the worker: a dialog belongs to the window's thread, and picking it first means a canceled dialog starts nothing.
                    if let Some(parent) = pick_clone_parent_folder() {
                        clone_vault(url, parent, &proxy);
                    }
                }
                IpcCommand::SetActiveVault { id } => {
                    set_active_vault(id, &mut vault_state, &proxy, reader.page());
                    // A different vault has a different repository, and its button should be right before anyone looks at it.
                    refresh_vault_status(&vault_state, &proxy, id);
                    // Back to the whole library: its top is the drive roots, which `request_folder` returns without reading anything.
                    if vault_state.root.is_none() {
                        vault_state.folder.clear();
                        request_folder(&vault_state, &proxy, String::new());
                    }
                }
                IpcCommand::RenameVault { id, name } => {
                    rename_vault_row(id, &name, &vault_state, reader.page());
                }
                IpcCommand::ChangeVaultFolder { id } => {
                    if let Some(folder) = pick_vault_folder() {
                        change_vault_folder(id, &folder, &mut vault_state, &proxy, reader.page());
                    }
                }
                IpcCommand::RemoveVault { id } => {
                    // The registry was the only record of what that id meant, so the favorites inside it go too.
                    reader.forget_vault_favorites(id);
                    // The shorter list first, because the registry push below is what redraws the start screen. The other way round it is drawn from favorites naming a vault the registry no longer has.
                    reader.refresh_tab_strip();
                    remove_vault_row(id, &mut vault_state, reader.page());
                    // Removing the vault on screen lands back at the top of the whole library.
                    vault_state.folder.clear();
                    request_folder(&vault_state, &proxy, String::new());
                }
                IpcCommand::GetFolder { path } => {
                    request_folder(&vault_state, &proxy, path);
                }
                IpcCommand::RevealInLibrary { path } => {
                    reveal_in_library(&path, &mut vault_state, &proxy, reader.page());
                }
                IpcCommand::GetGraph { scope, seeds } => {
                    // Focus keeps the seed neighborhood; the rest cap the densest documents, up to XL (no cap).
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
                    // Off the vault's own text when the vault holds the document on screen — read once and shared with search — and off that document itself otherwise, so a file in no vault still has a map of what it links to.
                    let document = reader.workspace.active_path().map(Path::to_path_buf);
                    request_link_graph(
                        &mut vault_state,
                        &proxy,
                        reader.webview.as_ref(),
                        document,
                        request,
                    );
                }
                IpcCommand::Search { query, today } => {
                    // Search reads the active vault's text. Without a vault there is nothing bounded to read, so the page says so and never asks.
                    let typed = TypedQuery::new(query, today.as_deref());
                    request_vault_search(&mut vault_state, &proxy, typed);
                }
                IpcCommand::LoadPager { path } => {
                    off_loop(&proxy, move || {
                        let html = document_pager_html(&path);
                        UserEvent::PagerLoaded { path, html }
                    });
                }
                IpcCommand::UpdateChecked { version } => {
                    settings.update_last_checked = leaftext::now_unix();
                    persist_settings(&settings, settings_path.as_ref());
                    if !version.is_empty() {
                        eprintln!("Update available: {version}");
                    }
                }
                IpcCommand::UpdateDownload {
                    version,
                    asset,
                    size,
                    url,
                } => {
                    // Its own proxy for the progress it reports while running.
                    let progress = proxy.clone();
                    off_loop(&proxy, move || {
                        run_update_download(progress, version, asset, size, url)
                    });
                }
                IpcCommand::ApplyUpdate => {
                    let staged = app_data_dir().and_then(|data_dir| {
                        leaftext::read_staged(&data_dir, &settings.update_staged_version)
                            .map(|staged| (data_dir, staged))
                    });
                    match staged {
                        Some((data_dir, staged)) => {
                            let directory = leaftext::staging_dir(&data_dir, &staged.version);
                            match platform::spawn_update_helper(&directory) {
                                // The helper waits for this process to exit before installing, so leave the same way the button does.
                                Ok(()) => shut_down(
                                    &mut reader,
                                    &mut settings,
                                    settings_path.as_ref(),
                                    last_windowed_size,
                                    control_flow,
                                ),
                                Err(error) => {
                                    let message = format!("could not start the installer: {error}");
                                    eprintln!("{message}");
                                    report_update_state(
                                        reader.page(),
                                        "failed",
                                        &staged.version,
                                        Some(&message),
                                    );
                                }
                            }
                        }
                        None => {
                            let message = "the staged update is no longer on disk".to_string();
                            settings.update_staged_version.clear();
                            persist_settings(&settings, settings_path.as_ref());
                            report_update_state(reader.page(), "failed", "", Some(&message));
                        }
                    }
                }
                IpcCommand::LogError { message, count } => {
                    let repeats = if count > 1 {
                        format!(" (seen {count} times)")
                    } else {
                        String::new()
                    };
                    eprintln!("Page error{repeats}: {message}");
                }
            },
            _ => {}
        }

        // Keep the watcher on the active document and on the pane's root, so both live-update. A no-op unless one changed since last sync.
        let active_path = reader.workspace.active_path();
        // A vault is watched whole and recursively — the user picked that folder, and its corpus has to stay live while they edit anywhere inside it. A folder the pane merely browsed to is watched one level deep, because that is all the pane shows: browsing to `C:\` must not subscribe to every change on the drive.
        let vault_root = vault_state.root.clone();
        let (project_dir, mode) = match vault_root.as_deref() {
            Some(root) => (Some(root), RecursiveMode::Recursive),
            None => (
                (!vault_state.folder.is_empty()).then(|| Path::new(&vault_state.folder)),
                RecursiveMode::NonRecursive,
            ),
        };
        file_watch.sync(active_path, project_dir, mode);
    });
}
