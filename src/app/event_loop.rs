//! The event loop: one arm for each thing the window, the page, the watcher or
//! the workers can report.

use super::*;

use tao::event_loop::EventLoop;
use tao::window::Window;

/// Everything the loop owns between events, assembled by `run_app` at startup.
/// It exists so the loop takes one argument instead of fourteen.
pub(crate) struct AppCtx {
    pub(crate) settings: Settings,
    pub(crate) settings_path: Option<PathBuf>,
    pub(crate) recent: RecentFiles,
    pub(crate) config_path: Option<PathBuf>,
    pub(crate) workspace: Workspace,
    pub(crate) pending_open_path: Option<PathBuf>,
    pub(crate) webview: Option<WebView>,
    pub(crate) window: Window,
    pub(crate) proxy: EventLoopProxy<UserEvent>,
    pub(crate) local_image_source_dir: Arc<Mutex<Option<PathBuf>>>,
    pub(crate) file_watch: FileWatch,
    pub(crate) vault_state: VaultState,
    pub(crate) last_windowed_size: LogicalSize<f64>,
    pub(crate) last_maximized: bool,
}

/// Apply a page command that records a setting; the one caller persists when
/// this returns true. A new persisted toggle is its command plus an arm here.
fn apply_setting_command(settings: &mut Settings, command: IpcCommand) -> bool {
    match command {
        IpcCommand::SetMinimapEnabled { enabled } => settings.minimap_enabled = enabled,
        IpcCommand::SetPagerEnabled { enabled } => settings.pager_enabled = enabled,
        IpcCommand::SetSpeedReaderEnabled { enabled } => settings.speed_reader_enabled = enabled,
        IpcCommand::SetThemeFamily { family } => settings.theme_family = family,
        IpcCommand::SetThemeMode { mode } => settings.theme_mode = mode,
        IpcCommand::SetThemeRandomBag { used } => settings.theme_random_used = used,
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

/// Runs until the window closes, which ends the process — hence the `!`.
pub(crate) fn run_event_loop(event_loop: EventLoop<UserEvent>, ctx: AppCtx) -> ! {
    // Unpacked straight back into locals: the arms mutate a dozen of these and read
    // them constantly, and `ctx.` at every use would bury the event handling.
    let AppCtx {
        mut settings,
        settings_path,
        mut recent,
        config_path,
        mut workspace,
        mut pending_open_path,
        mut webview,
        window,
        proxy,
        local_image_source_dir,
        mut file_watch,
        mut vault_state,
        mut last_windowed_size,
        mut last_maximized,
    } = ctx;

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
                    run_page_script(
                        webview.as_ref(),
                        &format!("window.leafSetWindowMaximized({maximized});"),
                        "Failed to sync the maximize button",
                    );
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
            // macOS delivers a double-clicked document as an Apple Event, not an
            // argument, so file associations there are inert without this. Before
            // the page is up the path waits with the command-line one.
            Event::Opened { urls } => {
                for path in urls.iter().filter_map(|url| url.to_file_path().ok()) {
                    if webview.is_some() && pending_open_path.is_none() {
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
            }
            Event::UserEvent(UserEvent::FocusWindow) => {
                window.set_minimized(false);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::OpenPath(path)) => {
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
            Event::UserEvent(UserEvent::FileChanged(changed)) => {
                // The active document live-reloads; a sibling change instead
                // refreshes the pane and the corpus so both stay in sync without
                // a full rescan.
                let is_active_document = workspace
                    .active_path()
                    .is_some_and(|current| paths_refer_to_same_document(&changed, current));
                // Above the split, or it misses the commonest change of all —
                // saving the document you are reading takes the other branch.
                // Unfiltered on purpose: a containment check here compared the
                // watcher's canonicalised path against the registry's plain one
                // and discarded every event. One `git status`, off the loop, on
                // an already-debounced event, is cheaper than being wrong.
                if vault_state.active != 0 {
                    refresh_vault_status(&vault_state, &proxy, vault_state.active);
                }
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
                    // The pane lists one folder off the disk, so a file added,
                    // renamed or removed in that folder changes what it shows.
                    if change_affects_pane(&vault_state, &changed) {
                        let folder = vault_state.folder.clone();
                        request_folder(&vault_state, &proxy, folder);
                    }
                    // And the vault's text is a cache of the disk, so it is
                    // patched a file at a time rather than re-read. The graph is
                    // only redrawn when the graph is the view on screen —
                    // rebuilding it for a pane nobody is looking at is what made
                    // a burst of saves lock the window.
                    let graph_showing = vault_state.graph_open;
                    refresh_corpus_path(&mut vault_state, &proxy, &changed, graph_showing);
                    // An image, not a document: the text is unchanged, so the
                    // reload above would hash-gate itself out.
                    if is_local_image_path(&changed) {
                        run_page_script(
                            webview.as_ref(),
                            &image_refresh_script(),
                            "Live reload: failed to refresh images",
                        );
                    }
                }
            }
            Event::UserEvent(UserEvent::VaultGitReady { json }) => {
                deliver_vault_git(webview.as_ref(), &json);
            }
            Event::UserEvent(UserEvent::VaultStatusReady { id, json }) => {
                deliver_vault_status(webview.as_ref(), id, &json);
            }
            Event::UserEvent(UserEvent::FolderLoaded { scope, listing }) => {
                deliver_folder(&mut vault_state, webview.as_ref(), scope, listing);
            }
            Event::UserEvent(UserEvent::CorpusLoaded { corpus }) => {
                deliver_corpus(&mut vault_state, &proxy, *corpus);
            }
            Event::UserEvent(UserEvent::GraphReady { source, graph }) => {
                deliver_graph(
                    &vault_state,
                    webview.as_ref(),
                    workspace.active_path(),
                    source,
                    graph,
                );
            }
            Event::UserEvent(UserEvent::SearchReady { scope, query, hits }) => {
                deliver_search(&vault_state, webview.as_ref(), scope, &query, hits);
            }
            Event::UserEvent(UserEvent::PagerLoaded { path, html }) => {
                let is_active_document = workspace
                    .active_path()
                    .is_some_and(|current| paths_refer_to_same_document(&path, current));
                if is_active_document {
                    run_page_script(
                        webview.as_ref(),
                        &pager_loaded_script(&path, &html),
                        "Failed to update document pager",
                    );
                }
            }
            Event::UserEvent(UserEvent::UpdateDownloadProgress { version, percent }) => {
                run_page_script(
                    webview.as_ref(),
                    &update_progress_script(&version, percent),
                    "Failed to report download progress",
                );
            }
            Event::UserEvent(UserEvent::UpdateDownloadStaged { version }) => {
                settings.update_staged_version = version.clone();
                persist_settings(&settings, settings_path.as_ref());
                // Now that a newer one is ready, older staged installers are
                // just disk usage.
                if let Some(data_dir) = app_data_dir() {
                    leaftext::prune_staged(&data_dir, Some(&version));
                }
                report_update_state(webview.as_ref(), "staged", &version, None);
            }
            Event::UserEvent(UserEvent::UpdateDownloadFailed { version, message }) => {
                eprintln!("Update download failed: {message}");
                report_update_state(webview.as_ref(), "failed", &version, Some(&message));
            }
            Event::UserEvent(UserEvent::FromPage(command)) => match command {
                IpcCommand::Open => {
                    if let Some(path) = pick_document_file() {
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
                // The page opening a file is the same act as a forwarded open.
                IpcCommand::OpenRecent { path } => {
                    let _ = proxy.send_event(UserEvent::OpenPath(path));
                }
                IpcCommand::PasteFile {
                    path,
                    into_folder,
                    cut,
                } => match transfer_into_folder(&path, &into_folder, cut) {
                    Ok(_) => refresh_library_folder(webview.as_ref()),
                    Err(error) => {
                        let verb = if cut { "move" } else { "copy" };
                        eprintln!(
                            "Failed to {verb} {} into {}: {error}",
                            path.display(),
                            into_folder.display()
                        );
                        report_file_action_failure(webview.as_ref(), &error.to_string());
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
                IpcCommand::CopyPath { path } => {
                    if let Err(error) = copy_path_to_clipboard(&path) {
                        eprintln!(
                            "Failed to copy the path {} to the clipboard: {error}",
                            path.display()
                        );
                    }
                }
                IpcCommand::RenameFile { path, new_name } => match rename_file(&path, &new_name) {
                    Ok(_) => refresh_library_folder(webview.as_ref()),
                    Err(error) => {
                        eprintln!("Failed to rename {}: {error}", path.display());
                        report_file_action_failure(webview.as_ref(), &error.to_string());
                    }
                },
                IpcCommand::DeleteFile { path } => match delete_to_trash(&path) {
                    Ok(()) => refresh_library_folder(webview.as_ref()),
                    Err(error) => {
                        eprintln!("Failed to move {} to the trash: {error}", path.display());
                        report_file_action_failure(webview.as_ref(), &error);
                    }
                },
                IpcCommand::ShowProperties { path } => {
                    if let Err(error) = show_properties(&path) {
                        eprintln!("Failed to show properties for {}: {error}", path.display());
                    }
                }
                IpcCommand::CloseTab { index } => {
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
                IpcCommand::SwitchTab {
                    index,
                    scroll_anchor,
                    code_scroll,
                } => {
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
                IpcCommand::MoveTab { from, to } => {
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
                IpcCommand::GoHome => {
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
                IpcCommand::OpenLink {
                    href,
                    scroll_anchor,
                } => {
                    let Some(active) = workspace.active else {
                        return;
                    };
                    let Some(current_path) = workspace.tabs[active].history.current().cloned()
                    else {
                        return;
                    };
                    // A bare `glossary:` link ("open the full glossary"): resolve to
                    // the nearest GLOSSARY.md and open it as a tab.
                    if glossary_scheme_slug(&href).is_some() {
                        match nearest_glossary_file(&current_path) {
                            Some(path) if !paths_refer_to_same_document(&path, &current_path) => {
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
                        LinkTarget::External(target) | LinkTarget::LocalOther(target) => {
                            if let Err(error) = open_with_os(&target) {
                                eprintln!("Failed to open {target} with the OS: {error}");
                            }
                        }
                        LinkTarget::LocalDocument(target) => {
                            let path = path_from_local_link(&target, &current_path);
                            if paths_refer_to_same_document(&path, &current_path) {
                                if let Some(fragment) = fragment_from_href(&target) {
                                    workspace.tabs[active].scroll_history.record(scroll_anchor);
                                    update_active_navigation(webview.as_ref(), &workspace);
                                    scroll_to_fragment(webview.as_ref(), &fragment);
                                }
                                return;
                            }
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
                IpcCommand::OpenExternal { url } => {
                    if let Err(error) = open_with_os(&url) {
                        eprintln!("Failed to open {url} with the OS: {error}");
                    }
                }
                IpcCommand::OpenGlossary { href } => {
                    let Some(current_path) = workspace.active_path().map(Path::to_path_buf) else {
                        return;
                    };
                    show_glossary_entry(webview.as_ref(), &href, &current_path);
                }
                IpcCommand::CountLines { href, token } => {
                    // Count the linked document's lines for the hover tooltip. Only
                    // in-app document links resolve to a file; else -1 ("unknown").
                    let lines = workspace
                        .active_path()
                        .map(Path::to_path_buf)
                        .and_then(|current_path| match classify_link_target(&href) {
                            LinkTarget::LocalDocument(target) => {
                                let path = path_from_local_link(&target, &current_path);
                                read_source(&path)
                                    .ok()
                                    .map(|source| source.text.lines().count() as i64)
                            }
                            _ => None,
                        })
                        .unwrap_or(-1);
                    run_page_script(
                        webview.as_ref(),
                        &line_count_script(token, lines),
                        "Failed to send line count to the webview",
                    );
                }
                IpcCommand::GoBack { scroll_anchor } => {
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
                IpcCommand::GoForward { scroll_anchor } => {
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
                IpcCommand::EnterCodeView => {
                    // A fresh toggle carries its own position: the page stashed the
                    // reading view's scroll fraction before asking to enter.
                    enter_code_view(webview.as_ref(), &mut workspace, None);
                }
                IpcCommand::ExitCodeView => {
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
                IpcCommand::UpdateSource { text } => {
                    update_source_buffer(webview.as_ref(), &mut workspace, text);
                }
                IpcCommand::SpliceSource {
                    start,
                    removed,
                    inserted,
                    length,
                } => {
                    splice_source_buffer(
                        webview.as_ref(),
                        &mut workspace,
                        start,
                        removed,
                        &inserted,
                        length,
                    );
                }
                IpcCommand::SaveDocument => {
                    save_active_document(webview.as_ref(), &mut workspace, &mut file_watch);
                }
                IpcCommand::ToggleTask { index } => {
                    toggle_task_marker(webview.as_ref(), &mut workspace, &mut file_watch, index);
                }
                IpcCommand::EditBlock {
                    start,
                    end,
                    text,
                    autosave,
                } => {
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
                IpcCommand::UndoEdit => {
                    // Pop the buffer back one edit, re-render, and resync so undoing
                    // the only edit also clears the Save button.
                    let undone = workspace
                        .active_edit_mut()
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
                // The persisted toggles, applied in one place and saved once.
                command @ (IpcCommand::SetMinimapEnabled { .. }
                | IpcCommand::SetPagerEnabled { .. }
                | IpcCommand::SetSpeedReaderEnabled { .. }
                | IpcCommand::SetThemeFamily { .. }
                | IpcCommand::SetThemeMode { .. }
                | IpcCommand::SetThemeRandomBag { .. }
                | IpcCommand::SetLibraryState { .. }
                | IpcCommand::SetLibraryLayout { .. }
                | IpcCommand::SetGraphScope { .. }) => {
                    if apply_setting_command(&mut settings, command) {
                        persist_settings(&settings, settings_path.as_ref());
                    }
                }
                IpcCommand::WindowDrag => {
                    let _ = window.drag_window();
                }
                IpcCommand::WindowMinimize => {
                    window.set_minimized(true);
                }
                IpcCommand::WindowToggleMaximize => {
                    window.set_maximized(!window.is_maximized());
                }
                IpcCommand::WindowClose => {
                    // Same teardown as the native close button.
                    settings.window_width = last_windowed_size.width.round() as u32;
                    settings.window_height = last_windowed_size.height.round() as u32;
                    settings.window_maximized = window.is_maximized();
                    persist_settings(&settings, settings_path.as_ref());
                    let _ = webview.take();
                    *control_flow = ControlFlow::Exit;
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
                    apply_window_chrome(&window, r, g, b, border_r, border_g, border_b, dark);
                }
                IpcCommand::SetGraphView { open } => {
                    vault_state.graph_open = open;
                }
                IpcCommand::GetVaultGit { id } => {
                    request_vault_git(&vault_state, &proxy, webview.as_ref(), id);
                }
                IpcCommand::GetVaultStatus { id } => {
                    refresh_vault_status(&vault_state, &proxy, id);
                }
                IpcCommand::CreateVaultRepo { id } => {
                    create_vault_repo(&vault_state, &proxy, webview.as_ref(), id);
                }
                IpcCommand::LinkVaultRemote { id, url } => {
                    link_vault_repo(&vault_state, &proxy, webview.as_ref(), id, url);
                }
                IpcCommand::SyncVault { id } => {
                    sync_vault(&vault_state, &proxy, webview.as_ref(), id);
                }
                IpcCommand::CreateVault => {
                    if let Some(folder) = pick_vault_folder() {
                        create_vault(&folder, &mut vault_state, &proxy, webview.as_ref());
                    }
                }
                IpcCommand::SetActiveVault { id } => {
                    set_active_vault(id, &mut vault_state, &proxy, webview.as_ref());
                    // A different vault has a different repository, and its button
                    // should be right before anyone looks at it.
                    refresh_vault_status(&vault_state, &proxy, id);
                    // Back to the whole library: its top is the drive roots, which
                    // `request_folder` returns without reading anything.
                    if vault_state.root.is_none() {
                        vault_state.folder.clear();
                        request_folder(&vault_state, &proxy, String::new());
                    }
                }
                IpcCommand::RenameVault { id, name } => {
                    rename_vault_row(id, &name, &vault_state, webview.as_ref());
                }
                IpcCommand::ChangeVaultFolder { id } => {
                    if let Some(folder) = pick_vault_folder() {
                        change_vault_folder(
                            id,
                            &folder,
                            &mut vault_state,
                            &proxy,
                            webview.as_ref(),
                        );
                    }
                }
                IpcCommand::RemoveVault { id } => {
                    remove_vault_row(id, &mut vault_state, webview.as_ref());
                    // Removing the vault on screen lands back at the top of the
                    // whole library.
                    vault_state.folder.clear();
                    request_folder(&vault_state, &proxy, String::new());
                }
                IpcCommand::GetFolder { path } => {
                    request_folder(&vault_state, &proxy, path);
                }
                IpcCommand::RevealInLibrary { path } => {
                    reveal_in_library(&path, &mut vault_state, &proxy, webview.as_ref());
                }
                IpcCommand::GetGraph { scope, seeds } => {
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
                    // Off the vault's own text when the vault holds the document on
                    // screen — read once and shared with search — and off that
                    // document itself otherwise, so a file in no vault still has a
                    // map of what it links to.
                    let document = workspace.active_path().map(Path::to_path_buf);
                    request_link_graph(
                        &mut vault_state,
                        &proxy,
                        webview.as_ref(),
                        document,
                        request,
                    );
                }
                IpcCommand::Search { query, scope } => {
                    // Search reads the active vault's text. Without a vault there is
                    // nothing bounded to read, so the page says so and never asks.
                    let _ = scope;
                    request_vault_search(&mut vault_state, &proxy, query);
                }
                IpcCommand::LoadPager { path } => {
                    let proxy = proxy.clone();
                    thread::spawn(move || {
                        let html = document_pager_html(&path);
                        let _ = proxy.send_event(UserEvent::PagerLoaded { path, html });
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
                    let proxy = proxy.clone();
                    thread::spawn(move || run_update_download(proxy, version, asset, size, url));
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
                                Ok(()) => {
                                    // The helper waits for this process to exit
                                    // before installing, so shut down the same way
                                    // the close button does.
                                    settings.window_width = last_windowed_size.width.round() as u32;
                                    settings.window_height =
                                        last_windowed_size.height.round() as u32;
                                    settings.window_maximized = window.is_maximized();
                                    persist_settings(&settings, settings_path.as_ref());
                                    let _ = webview.take();
                                    *control_flow = ControlFlow::Exit;
                                }
                                Err(error) => {
                                    let message = format!("could not start the installer: {error}");
                                    eprintln!("{message}");
                                    report_update_state(
                                        webview.as_ref(),
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
                            report_update_state(webview.as_ref(), "failed", "", Some(&message));
                        }
                    }
                }
            },
            _ => {}
        }

        // Keep the watcher on the active document and on the pane's root, so
        // both live-update. A no-op unless one changed since last sync.
        let active_path = workspace.active_path();
        // A vault is watched whole and recursively — the user picked that
        // folder, and its corpus has to stay live while they edit anywhere
        // inside it. A folder the pane merely browsed to is watched one level
        // deep, because that is all the pane shows: browsing to `C:\` must not
        // subscribe to every change on the drive.
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
