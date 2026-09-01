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
    /// The window the launch is heading for, until the page says it can have it.
    pub(crate) startup: StartupWindow,
    pub(crate) last_maximized: bool,
    pub(crate) last_fullscreen: bool,
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
    // The close is the one save that carries the unsaved buffers, so edits nobody saved are there at the next launch.
    settings.session = reader.workspace.closing_session();
    settings.window_width = windowed_size.width.round() as u32;
    settings.window_height = windowed_size.height.round() as u32;
    settings.window_maximized = reader.window.is_maximized();
    persist_settings(settings, settings_path);
    let _ = reader.webview.take();
    *control_flow = ControlFlow::Exit;
}

/// Keep the saved session in step with the workspace without rewriting settings for events that did not change it.
fn persist_workspace_session(
    workspace: &Workspace,
    settings: &mut Settings,
    settings_path: Option<&PathBuf>,
) {
    let session = workspace.session();
    if settings.session != session {
        settings.session = session;
        persist_settings(settings, settings_path);
    }
}

/// Put the reader back where the tab at the front was left. The one question a tab switch, a startup and a close of the tab being read all ask, so the answer is built once: a close has already moved `active` to the neighbor by the time it asks.
pub(crate) fn restore_front_tab_intent(workspace: &Workspace) -> Option<ScrollIntent> {
    workspace
        .active
        .and_then(|index| workspace.tabs.get(index))
        .map(|tab| ScrollIntent::Restore {
            anchor: tab.history.current_anchor(),
            code: tab.saved_code_scroll,
        })
}

/// A command-line document replaces the saved front tab; otherwise the saved front tab loads through the ordinary restore path.
pub(crate) fn startup_restore_intent(
    workspace: &Workspace,
    has_pending_path: bool,
) -> Option<ScrollIntent> {
    (!has_pending_path)
        .then(|| restore_front_tab_intent(workspace))
        .flatten()
}

/// Whether an arm below could have answered this event, which is what says whether the tail after the match has anything left to do. A skip list rather than a list of what counts, so an event this does not recognize still runs the tail and nothing new is quietly dropped.
///
/// It is here because a window drag hands the loop four events per mouse move and no arm answers one of them, while the tail rebuilds the saved session out of every open tab: 1,015 rebuilds across a two-second drag, four fifths of what that gesture costs with ten tabs open.
///
/// A device event is one raw input packet — up to a thousand a second on a gaming mouse, delivered per hardware report while focused. It carries raw pointer deltas no arm reads, and letting it run the tail froze a twenty-tab window solid under a fast hand: 4 landed positions across a throw where skipping lands 204.
pub(crate) fn could_have_changed_anything(event: &Event<UserEvent>) -> bool {
    match event {
        Event::NewEvents(_)
        | Event::MainEventsCleared
        | Event::RedrawRequested(_)
        | Event::RedrawEventsCleared => false,
        Event::DeviceEvent { event, .. } => device_event_could_have_changed_anything(event),
        Event::WindowEvent { event, .. } => window_event_could_have_changed_anything(event),
        _ => true,
    }
}

/// See `could_have_changed_anything`. Its own function because a `WindowEvent` can be built in a test and the event that wraps it cannot.
pub(crate) fn window_event_could_have_changed_anything(event: &WindowEvent) -> bool {
    !matches!(event, WindowEvent::Moved(_))
}

/// See `could_have_changed_anything`. Its own function for the same reason as the window half: a `DeviceEvent` can be built in a test and the event that wraps it cannot. Always the skip — whatever the packet carries, no arm reads it.
pub(crate) fn device_event_could_have_changed_anything(_event: &tao::event::DeviceEvent) -> bool {
    false
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
        mut startup,
        mut last_maximized,
        mut last_fullscreen,
    } = ctx;

    // The last file sent to the bin and where it landed, so Undo has something to act on. One deep on purpose: the offer lives only as long as its message, so a second delete has already retired the first.
    let mut last_delete: Option<(PathBuf, Option<PathBuf>)> = None;

    // Only ever set on a platform the window library refuses `drag_resize_window`, where the host has to drive the resize itself.
    let mut resize_drag: Option<ResizeDrag> = None;

    // What the refresh remembers between passes: the token to ask with, how many refusals in a row, and which mirrors are being written into right now.
    let mut refresh_book = RefreshBook::default();
    start_refresh_timer(&proxy);
    // The launch window grows on this even where the page never speaks, so a front end that threw as it loaded cannot leave a reader in a box with nothing in it.
    start_startup_timer(&proxy);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        // Read here because the match below takes the event by value.
        let anything_to_persist = could_have_changed_anything(&event);

        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                // Remember the size only while windowed; convert the physical event size to the logical size the next launch expects. Whether this resize is a size the reader chose is `remembers_windowed_size`'s to say.
                if remembers_windowed_size(
                    startup.grown,
                    reader.window.is_maximized(),
                    reader.window.is_minimized(),
                    size.width,
                    size.height,
                ) {
                    last_windowed_size = size.to_logical(reader.window.scale_factor());
                }
                let was = WindowState {
                    maximized: last_maximized,
                    fullscreen: last_fullscreen,
                };
                let now = WindowState {
                    maximized: reader.window.is_maximized(),
                    fullscreen: reader.window.fullscreen().is_some(),
                };
                for line in window_state_lines(was, now) {
                    run_page_script(reader.page(), &line, "Failed to sync the window state");
                }
                last_maximized = now.maximized;
                last_fullscreen = now.fullscreen;
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
            Event::WindowEvent {
                event: WindowEvent::Focused(true),
                ..
            } => {
                if let Some(id) = vault_to_reread(&vault_state) {
                    refresh_vault_status(&mut vault_state, &proxy, id);
                }
            }
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
                } else if let Some(scroll) = startup_restore_intent(&reader.workspace, false) {
                    reader.render(scroll);
                }
                // Once there is a page to tell: any cloud folder on this machine becomes a vault, and the page learns which folders they are. Off the loop, so a slow disk never delays the first paint.
                request_cloud_folders(&proxy);
            }
            Event::UserEvent(UserEvent::StartupGrowDue) => {
                if window_cmds::finish_startup(&reader, &mut startup) {
                    // The page has just been told which window it has, so the next resize diffs against that rather than against the launch window's answer.
                    last_maximized = startup.maximized;
                }
            }
            Event::UserEvent(UserEvent::FocusWindow) => {
                surface_window(&reader.window);
            }
            Event::UserEvent(UserEvent::OpenPath(path)) => {
                reader.workspace.open_path(path);
                reader.render(ScrollIntent::Reset);
                // A forwarded open from a second launch should surface the window — and so should the document a build's own copy was launched with, which arrives down this same arm, so the call is the one that leaves a window nobody can see alone.
                surface_window(&reader.window);
            }
            Event::UserEvent(UserEvent::RemoteRefreshDue) => {
                refresh_due_vaults(&vault_state, &mut refresh_book, &proxy, reader.page());
            }
            Event::UserEvent(UserEvent::RemoteRefreshDone {
                id,
                ran_under,
                state,
            }) => {
                deliver_refresh(
                    id,
                    ran_under,
                    *state,
                    &vault_state,
                    &mut refresh_book,
                    reader.page(),
                );
            }
            Event::UserEvent(UserEvent::FileChanged(changed)) => {
                // A 2,000-file folder rewrite arrives as 2,020 paths in one batch; its shared work runs once after the app's own paths leave the batch.
                let changed: Vec<_> = changed
                    .into_iter()
                    .filter(|path| !refresh_book.is_our_own_write(path))
                    .collect();
                if changed.is_empty() {
                    return;
                }
                // The active document live-reloads; a sibling change instead refreshes the pane and the corpus so both stay in sync without a full rescan.
                let active_file = reader.workspace.active_file().map(PathBuf::from);
                let changed: Vec<_> = changed
                    .into_iter()
                    .map(|path| {
                        let is_active_document = active_file
                            .as_deref()
                            .is_some_and(|current| paths_refer_to_same_document(&path, current));
                        (path, is_active_document)
                    })
                    .collect();
                for step in watched_batch_steps(&vault_state, changed) {
                    match step {
                        WatchedChangeStep::RereadVaultStatus(id) => {
                            refresh_vault_status(&mut vault_state, &proxy, id)
                        }
                        WatchedChangeStep::ReloadActiveDocument => {
                            reload_active_document(&mut reader, &mut file_watch)
                        }
                        WatchedChangeStep::RereadPaneFolder(folder) => {
                            request_folder(&vault_state, &proxy, folder)
                        }
                        WatchedChangeStep::PatchCorpus {
                            paths,
                            redraw_graph,
                        } => refresh_corpus_paths(&mut vault_state, &proxy, &paths, redraw_graph),
                        WatchedChangeStep::RefreshImages => run_page_script(
                            reader.page(),
                            &image_refresh_script(),
                            "Live reload: failed to refresh images",
                        ),
                        WatchedChangeStep::AgeLinkPreviews => run_page_script(
                            reader.page(),
                            &age_link_previews_script(),
                            "Live reload: failed to age the link cards",
                        ),
                    }
                }
            }
            Event::UserEvent(UserEvent::VaultGitReady { json }) => {
                deliver_vault_git(reader.page(), &json);
            }
            Event::UserEvent(UserEvent::VaultStatusReady { id, json }) => {
                deliver_vault_status(reader.page(), &mut vault_state, &proxy, id, &json);
            }
            Event::UserEvent(UserEvent::CloudFoldersReady { folders }) => {
                deliver_cloud_folders(&vault_state, reader.page(), &folders);
            }
            Event::UserEvent(UserEvent::FileClipboardDone { cut, error }) => {
                if let Some(error) = error {
                    eprintln!("{error}");
                    report_file_action_failure(
                        reader.page(),
                        if cut {
                            "the file could not be cut — try again"
                        } else {
                            "the file could not be copied — try again"
                        },
                    );
                }
            }
            Event::UserEvent(UserEvent::PictureClipboardDone { error }) => {
                if let Some(error) = error {
                    eprintln!("{error}");
                    report_file_action_failure(
                        reader.page(),
                        "the picture could not be copied — try again",
                    );
                }
            }
            Event::UserEvent(UserEvent::VaultCloneDone { folder, error }) => {
                deliver_vault_clone(folder, error, &mut vault_state, &proxy, reader.page());
            }
            Event::UserEvent(UserEvent::FolderLoaded { scope, listing }) => {
                deliver_folder(&mut vault_state, reader.page(), scope, listing);
            }
            Event::UserEvent(UserEvent::CorpusLoaded {
                root,
                documents,
                truncated,
                skipped,
                replaces,
                last,
                wanted,
            }) => {
                // Answered only by the last slice of the read still being waited for, in the vault still on screen — `deliver_corpus` throws the rest away.
                let hints = deliver_corpus(
                    &mut vault_state,
                    &proxy,
                    root,
                    *documents,
                    truncated,
                    skipped,
                    replaces,
                    last,
                    wanted,
                );
                if let Some(hints) = hints {
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
                corpus,
                partial,
            }) => {
                deliver_search(
                    &mut vault_state,
                    reader.page(),
                    scope,
                    &query,
                    results,
                    corpus,
                    partial,
                );
            }
            Event::UserEvent(UserEvent::PagerLoaded { path, html }) => {
                let is_active_document = reader
                    .workspace
                    .active_file()
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
                pipe_asks::state(&reader, &vault_state, &reply)
            }
            Event::UserEvent(UserEvent::PipeDoc { path, reply }) => {
                pipe_asks::doc(&mut reader, &path, &reply)
            }
            Event::UserEvent(UserEvent::PipeEdit {
                path,
                start,
                end,
                text,
                expect,
                reply,
            }) => pipe_asks::edit(&mut reader, &path, start, end, &text, &expect, &reply),
            Event::UserEvent(UserEvent::PipeTask {
                path,
                index,
                expect,
                reply,
            }) => pipe_asks::task(
                &mut reader,
                &mut file_watch,
                &mut vault_state,
                &mut refresh_book,
                &path,
                index,
                &expect,
                &reply,
            ),
            Event::UserEvent(UserEvent::PipeSave {
                path,
                expect,
                reply,
            }) => pipe_asks::save(
                &mut reader,
                &mut file_watch,
                &mut vault_state,
                &mut refresh_book,
                &path,
                &expect,
                &reply,
            ),
            Event::UserEvent(UserEvent::PipeExport {
                path,
                width,
                height,
                reply,
            }) => pipe_asks::export(&reader, &path, width, height, &reply),
            Event::UserEvent(UserEvent::PipeShot {
                path,
                width,
                height,
                reply,
            }) => pipe_asks::shot(&reader, &path, width, height, &reply),
            Event::UserEvent(UserEvent::PipeQuit { reply }) => {
                // Answer only. The asker still has nothing in hand, and a loop that stopped here would take the reply with it.
                let _ = reply.try_send(Ok(serde_json::json!({ "closing": true })));
            }
            // The pipe thread, once that reply has been taken. Out the same door as the close button, so the geometry is saved.
            Event::UserEvent(UserEvent::PipeCloseNow) => shut_down(
                &mut reader,
                &mut settings,
                settings_path.as_ref(),
                last_windowed_size,
                control_flow,
            ),
            // The one script the app runs for an answer rather than an effect. The answer, and whether the page read the script at all, are `eval_ask`'s.
            Event::UserEvent(UserEvent::PipeEval { script, reply }) => match reader.page() {
                Some(page) => eval_ask::run(page, &script, reply),
                None => {
                    let _ = reply.try_send(Err("there is no window to run it in".to_string()));
                }
            },
            // The gesture walks on a thread of its own and lands back here one step at a time, because the protocol call must be made from this thread and a paced drag made here would hold the loop for the walk.
            Event::UserEvent(UserEvent::PipeGesture { gesture, reply }) => match reader.page() {
                Some(_) => gesture_ask::run(&proxy, reader.window.scale_factor(), &gesture, reply),
                None => {
                    let _ = reply.try_send(Err("there is no window to play it in".to_string()));
                }
            },
            Event::UserEvent(UserEvent::PipeGestureStep { params, done }) => {
                gesture_ask::step(reader.page(), &params, done)
            }
            Event::UserEvent(UserEvent::FromPage(command)) => match command {
                IpcCommand::Open => file_cmds::open(&mut reader),
                IpcCommand::NewDocument => file_cmds::new_document(&mut reader),
                IpcCommand::OpenRecent { path } => file_cmds::open_recent(&proxy, path),
                IpcCommand::PasteFile {
                    path,
                    into_folder,
                    cut,
                } => file_cmds::paste(&reader, &path, &into_folder, cut),
                IpcCommand::RevealFile { path } => file_cmds::reveal(&reader, &path),
                IpcCommand::CopyFile { path, cut } => file_cmds::copy_file(&proxy, path, cut),
                IpcCommand::ToggleFavorite { path, kind } => {
                    file_cmds::toggle_favorite(&mut reader, &vault_state, path, kind)
                }
                IpcCommand::CheckFavorites => file_cmds::check_favorites(&reader, &vault_state),
                IpcCommand::RepointFavorite { path } => {
                    file_cmds::repoint_favorite(&mut reader, &vault_state, &path)
                }
                IpcCommand::MoveFavorite { path, before } => {
                    file_cmds::move_favorite(&mut reader, &path, before.as_deref())
                }
                IpcCommand::CopyPath { path } => file_cmds::copy_path(&reader, &path),
                IpcCommand::RenameFile { path, new_name } => {
                    file_cmds::rename(&mut reader, &path, &new_name)
                }
                IpcCommand::DeleteFile { path } => {
                    file_cmds::delete(&reader, &mut last_delete, path)
                }
                IpcCommand::UndoDelete { path } => {
                    file_cmds::undo_delete(&reader, &mut last_delete, &path)
                }
                IpcCommand::ShowProperties { path } => file_cmds::properties(&reader, &path),
                IpcCommand::RevealImage { src } => file_cmds::reveal_picture(&reader, &src),
                IpcCommand::CopyImagePath { src } => file_cmds::copy_picture_path(&reader, &src),
                IpcCommand::ShowImageProperties { src } => {
                    file_cmds::picture_properties(&reader, &src)
                }
                IpcCommand::CopyImage { data } => picture_clipboard::copy(&proxy, data),
                IpcCommand::CloseTab { index } => {
                    match close_tab_draw(&mut reader.workspace, index) {
                        TabDraw::Strip => reader.refresh_tab_strip(),
                        TabDraw::Render(intent) => reader.render(intent),
                        TabDraw::Nothing => {}
                    }
                }
                IpcCommand::SwitchTab {
                    index,
                    scroll_anchor,
                    code_scroll,
                    render_key,
                    force_full,
                } => {
                    // Clicking the active tab is a no-op; re-rendering would jump the reader.
                    if reader.workspace.active == Some(index) && !force_full {
                        return;
                    }
                    if !force_full {
                        if let Some(active) = reader.workspace.active {
                            if let Some(tab) = reader.workspace.tabs.get_mut(active) {
                                tab.history.stamp_current(scroll_anchor);
                                // Remember where the source editor was left; `None` for a reading-view tab, which leaves nothing to restore.
                                tab.saved_code_scroll = code_scroll;
                            }
                        }
                        reader.workspace.set_active(index);
                    }
                    if reader.workspace.active == Some(index) {
                        // Reopen where the reader left it (`None` starts at the top).
                        if let Some(intent) = restore_front_tab_intent(&reader.workspace) {
                            reader.render_switch(intent, render_key.as_deref(), force_full);
                        }
                    }
                }
                IpcCommand::MoveTab { from, to } => {
                    match move_tab_draw(&mut reader.workspace, from, to) {
                        TabDraw::Strip => reader.refresh_tab_strip(),
                        TabDraw::Render(intent) => reader.render(intent),
                        TabDraw::Nothing => {}
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
                        LinkTarget::External(_)
                        | LinkTarget::ForeignScheme(_)
                        | LinkTarget::LocalFile(_) => {
                            // A dead link is otherwise silent twice over: the path resolves to nothing and the opener reports success anyway.
                            if let Some(missing) = missing_linked_file(&href, &current_path) {
                                report_file_action_failure(
                                    reader.page(),
                                    &format!("there is no file at {}", missing.display()),
                                );
                                return;
                            }
                            // Resolved for a file sitting beside the note, as written for an address another handler reads. Both live in `os_open_target`, so what the opener is handed can be read by a test without an event loop around it.
                            if let Some(target) = os_open_target(&href, &current_path) {
                                if let Err(error) = open_with_os(&target) {
                                    eprintln!("Failed to open {target} with the OS: {error}");
                                }
                            }
                        }
                        LinkTarget::LocalDocument(target) => {
                            let path = path_from_local_link(&target, &current_path);
                            // What the tab is showing, never the name it wears: a note wears a bare name, so comparing against that name scrolls the note instead of opening a file of that name.
                            let stays_on_this_page =
                                reader.workspace.active_file().is_some_and(|current| {
                                    paths_refer_to_same_document(&path, current)
                                });
                            if stays_on_this_page {
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
                        .and_then(|current| linked_file_path(&href, current))
                    else {
                        return;
                    };
                    if let Err(error) = reveal_in_file_manager(&path) {
                        eprintln!(
                            "Failed to reveal {} in the file manager: {error}",
                            path.display()
                        );
                        report_file_action_failure(
                            reader.page(),
                            "the file manager window could not be opened",
                        );
                    }
                }
                IpcCommand::CopyLinkPath { href } => {
                    let Some(path) = reader
                        .workspace
                        .active_path()
                        .and_then(|current| linked_file_path(&href, current))
                    else {
                        return;
                    };
                    if let Err(error) = copy_path_to_clipboard(&path) {
                        eprintln!(
                            "Failed to copy the path {} to the clipboard: {error}",
                            path.display()
                        );
                        report_file_action_failure(
                            reader.page(),
                            "the path could not be copied — try again",
                        );
                    }
                }
                IpcCommand::CountLines { href, token } => {
                    // Count the linked document's lines for the hover tooltip. Only a file the card can be about resolves — a bare `glossary:` link is that glossary; else -1 ("unknown").
                    let lines = reader
                        .workspace
                        .active_path()
                        .and_then(|current| hover_card_document_path(&href, current))
                        .and_then(|path| read_source(&path).ok())
                        .map(|source| source.text.lines().count() as i64)
                        .unwrap_or(-1);
                    run_page_script(
                        reader.page(),
                        &line_count_script(token, lines),
                        "Failed to send line count to the webview",
                    );
                }
                IpcCommand::PreviewLink { href, token } => {
                    // A page that cannot be rendered — deleted, renamed, unreadable — answers empty rather than not at all, the way countLines answers -1. Only an answer settles the card's waiting box.
                    let html = reader
                        .workspace
                        .active_path()
                        .and_then(|current| link_preview_html(&href, current))
                        .unwrap_or_default();
                    run_page_script(
                        reader.page(),
                        &link_preview_script(token, &html),
                        "Failed to send link preview to the webview",
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
                IpcCommand::EnterCodeView => editing_cmds::enter_source(&mut reader),
                IpcCommand::ExitCodeView => editing_cmds::exit_source(&mut reader),
                IpcCommand::UpdateSource { text } => editing_cmds::update_source(&mut reader, text),
                IpcCommand::SpliceSource {
                    start,
                    removed,
                    inserted,
                    length,
                } => editing_cmds::source_spliced(&mut reader, start, removed, &inserted, length),
                IpcCommand::CodeCompleteNotes { token } => {
                    editing_cmds::complete_notes(&reader, &mut vault_state, &proxy, token)
                }
                IpcCommand::CodeCompleteHeadings { token, note } => {
                    editing_cmds::complete_headings(&reader, &mut vault_state, &proxy, token, note)
                }
                IpcCommand::CodeHoverNote { token, note } => {
                    editing_cmds::hover_note(&reader, &mut vault_state, &proxy, token, note)
                }
                IpcCommand::CodeLint { token } => {
                    editing_cmds::lint_source(&reader, &mut vault_state, &proxy, token)
                }
                IpcCommand::SaveDocument { format } => editing_cmds::save_document(
                    &mut reader,
                    &mut file_watch,
                    &mut vault_state,
                    &mut refresh_book,
                    format.as_deref(),
                ),
                IpcCommand::ToggleTask { index, token } => editing_cmds::task_toggled(
                    &mut reader,
                    &mut file_watch,
                    &mut vault_state,
                    &mut refresh_book,
                    index,
                    token,
                ),
                IpcCommand::EditBlock {
                    start,
                    end,
                    text,
                    autosave,
                    live,
                    continuing,
                    cell,
                    token,
                } => editing_cmds::edit_block(
                    &mut reader,
                    &mut file_watch,
                    &mut vault_state,
                    &mut refresh_book,
                    &BlockEdit {
                        start,
                        end,
                        text: &text,
                        autosave,
                        live,
                        continuing,
                        cell: cell.as_ref(),
                    },
                    token,
                ),
                IpcCommand::EditBlocks { blocks } => {
                    editing_cmds::edit_blocks(&mut reader, &blocks)
                }
                IpcCommand::SetField { key, value } => {
                    editing_cmds::set_frontmatter_field(&mut reader, &key, value.as_deref())
                }
                IpcCommand::SetListField { key, items } => {
                    editing_cmds::set_frontmatter_list(&mut reader, &key, &items)
                }
                IpcCommand::RenameField { key, to } => {
                    editing_cmds::rename_frontmatter_field(&mut reader, &key, &to)
                }
                IpcCommand::MoveBlock { ranges, from, to } => {
                    editing_cmds::move_source_block(&mut reader, &ranges, from, to)
                }
                IpcCommand::PickImage { token } => {
                    editing_cmds::pick_image(&mut reader, &mut file_watch, token)
                }
                IpcCommand::PickDiagramPath { token, format } => {
                    editing_cmds::pick_diagram(&reader, token, format.as_deref())
                }
                IpcCommand::ExportDiagram {
                    format,
                    data,
                    path,
                    width,
                    height,
                } => editing_cmds::write_diagram(&reader, &format, &data, &path, width, height),
                IpcCommand::PrintDiagramPdf {
                    path,
                    width,
                    height,
                } => editing_cmds::write_diagram_pdf(&reader, &path, width, height),
                IpcCommand::PickPicturePath {
                    token,
                    source,
                    format,
                } => editing_cmds::pick_picture(&reader, token, &source, format.as_deref()),
                IpcCommand::ExportPicture {
                    format,
                    source,
                    path,
                    alt,
                    data,
                } => editing_cmds::write_picture(&reader, &format, &source, &path, &alt, &data),
                IpcCommand::PrintPicturePdf {
                    path,
                    width,
                    height,
                } => editing_cmds::write_picture_pdf(&reader, &path, width, height),
                IpcCommand::ExportPdf {
                    format,
                    width,
                    height,
                } => editing_cmds::export_pdf(&reader, format, width, height),
                IpcCommand::ExportPageHtml {
                    path,
                    markup,
                    sheet,
                    theme,
                    appearance,
                    title,
                } => editing_cmds::export_html(
                    &reader,
                    &path,
                    &PageHtmlExport {
                        markup,
                        sheet,
                        theme,
                        appearance,
                        title,
                    },
                ),
                IpcCommand::UndoEdit => editing_cmds::undo_edit(&mut reader),
                IpcCommand::RedoEdit => editing_cmds::redo_edit(&mut reader),
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
                IpcCommand::StartupReady => {
                    if window_cmds::finish_startup(&reader, &mut startup) {
                        // The page has just been told which window it has, so the next resize diffs against that rather than against the launch window's answer.
                        last_maximized = startup.maximized;
                    }
                }
                IpcCommand::WindowDrag => window_cmds::drag(&reader),
                IpcCommand::WindowResizeDrag {
                    direction,
                    phase,
                    x,
                    y,
                } => window_cmds::resize(&reader, &mut resize_drag, &direction, &phase, x, y),
                IpcCommand::WindowMinimize => window_cmds::minimize(&reader),
                IpcCommand::WindowToggleMaximize => window_cmds::toggle_maximize(&reader),
                IpcCommand::WindowToggleFullscreen => window_cmds::toggle_fullscreen(&reader),
                IpcCommand::WindowClose => shut_down(
                    &mut reader,
                    &mut settings,
                    settings_path.as_ref(),
                    last_windowed_size,
                    control_flow,
                ),
                IpcCommand::SaveSessionPlace {
                    scroll_anchor,
                    code_scroll,
                } => window_cmds::save_place(&mut reader, scroll_anchor, code_scroll),
                IpcCommand::SetWindowChrome { r, g, b, dark } => {
                    window_cmds::set_chrome(&reader, r, g, b, dark)
                }
                IpcCommand::SetGraphView { open } => {
                    vault_state.graph_open = open;
                }
                IpcCommand::GetVaultGit { id } => {
                    request_vault_git(&vault_state, &proxy, reader.page(), id);
                }
                IpcCommand::GetVaultStatus { id } => {
                    refresh_vault_status(&mut vault_state, &proxy, id);
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
                IpcCommand::SetGitIdentity { id, name, email } => {
                    set_vault_git_identity(&vault_state, &proxy, reader.page(), id, name, email);
                }
                IpcCommand::RefreshVault { id } => vaults::wake_and_refresh_vault(
                    &reader,
                    &vault_state,
                    &mut refresh_book,
                    &proxy,
                    id,
                ),
                IpcCommand::SignInVault { id } => {
                    sign_in_vault(&vault_state, reader.page(), id);
                }
                IpcCommand::SignOutVault { id } => {
                    vaults::sign_out_vault_row(&reader, &vault_state, id)
                }
                IpcCommand::CreateVault => {
                    vaults::create_vault_from_picker(&reader, &mut vault_state, &proxy)
                }
                IpcCommand::GetCloudFolders => {
                    request_cloud_folders(&proxy);
                }
                IpcCommand::CloneVault { url } => {
                    vaults::clone_vault_into_picked_folder(url, &proxy)
                }
                IpcCommand::SetActiveVault { id } => {
                    vaults::switch_active_vault(&reader, &mut vault_state, &proxy, id)
                }
                IpcCommand::RenameVault { id, name } => {
                    rename_vault_row(id, &name, &vault_state, reader.page());
                }
                IpcCommand::ChangeVaultFolder { id } => {
                    vaults::change_vault_folder_from_picker(&reader, &mut vault_state, &proxy, id)
                }
                IpcCommand::RemoveVault { id } => vaults::remove_vault_everywhere(
                    &mut reader,
                    &mut vault_state,
                    &mut file_watch,
                    &proxy,
                    id,
                ),
                IpcCommand::GetFolder { path } => {
                    request_folder(&vault_state, &proxy, path);
                }
                IpcCommand::RevealInLibrary { path } => {
                    reveal_in_library(&path, &mut vault_state, &proxy, reader.page());
                }
                IpcCommand::GetGraph { scope, seeds } => {
                    vaults::request_graph_for(&reader, &mut vault_state, &proxy, &scope, seeds)
                }
                IpcCommand::Search { query, today } => {
                    // Search reads the active vault's text. Without a vault there is nothing bounded to read, so the page says so and never asks.
                    let typed = TypedQuery::new(query, today.as_deref());
                    request_vault_search(&mut vault_state, &proxy, typed);
                }
                IpcCommand::LoadPager { path } => vaults::load_pager_page(&proxy, path),
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

        if !anything_to_persist {
            return;
        }

        persist_workspace_session(&reader.workspace, &mut settings, settings_path.as_ref());

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
