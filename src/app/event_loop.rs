//! The event loop: one arm for each thing the window, the page, the watcher or
//! the indexer can report.

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
    pub(crate) indexer: Option<IndexerWorker>,
    pub(crate) vault_state: VaultState,
    pub(crate) last_windowed_size: LogicalSize<f64>,
    pub(crate) last_maximized: bool,
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
        indexer,
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
                if let Some(path) = pick_document_file() {
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
                // in-app document links resolve to a file; else -1 ("unknown").
                let lines = workspace
                    .active
                    .and_then(|active| workspace.tabs[active].history.current().cloned())
                    .and_then(|current_path| match classify_link_target(&href) {
                        LinkTarget::LocalDocument(target) => {
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
                    // The pane lists one folder off the disk, so a file added,
                    // renamed or removed in that folder changes what it shows.
                    if change_affects_pane(&vault_state, &changed) {
                        let folder = vault_state.folder.clone();
                        request_folder(&vault_state, &proxy, folder);
                    }
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
            Event::UserEvent(UserEvent::CreateVault) => {
                if let Some(folder) = pick_vault_folder() {
                    create_vault(&folder, &mut vault_state, &proxy, webview.as_ref());
                }
            }
            Event::UserEvent(UserEvent::SetActiveVault { id }) => {
                set_active_vault(id, &mut vault_state, &proxy, webview.as_ref());
                // Back to the whole library: the indexer owns that tree.
                if vault_state.root.is_none() {
                    if let Some(indexer) = indexer.as_ref() {
                        indexer.request_tree();
                    }
                }
            }
            Event::UserEvent(UserEvent::RenameVault { id, name }) => {
                rename_vault_row(id, &name, &vault_state, webview.as_ref());
            }
            Event::UserEvent(UserEvent::ChangeVaultFolder { id }) => {
                if let Some(folder) = pick_vault_folder() {
                    change_vault_folder(id, &folder, &mut vault_state, &proxy, webview.as_ref());
                }
            }
            Event::UserEvent(UserEvent::RemoveVault { id }) => {
                remove_vault_row(id, &mut vault_state, webview.as_ref());
                // Removing the vault on screen lands back at the top of the
                // whole library.
                vault_state.folder.clear();
                request_folder(&vault_state, &proxy, String::new());
            }
            Event::UserEvent(UserEvent::LoadFolder { path }) => {
                request_folder(&vault_state, &proxy, path);
            }
            Event::UserEvent(UserEvent::FolderLoaded { scope, listing }) => {
                deliver_folder(&mut vault_state, webview.as_ref(), scope, listing);
            }
            Event::UserEvent(UserEvent::GetGraph { scope, seeds }) => {
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
                // Read off the disk under one bounded root: the active vault, or
                // the folder the pane is in. No index, so nothing to go stale.
                request_link_graph(&vault_state, &proxy, request);
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
                // The pane's files are read off the disk now, so the indexer's
                // own tree snapshots have nowhere to go. Its scan progress,
                // search results, graph and errors still do.
                if matches!(indexer_event, IndexerEvent::Library { .. }) {
                    return;
                }
                if let Some(webview) = webview.as_ref() {
                    if let Err(error) = webview.evaluate_script(&event_script(&indexer_event)) {
                        eprintln!("Failed to update library view: {error}");
                    }
                }
            }
            Event::UserEvent(UserEvent::UpdateChecked { version }) => {
                settings.update_last_checked = leaftext::now_unix();
                persist_settings(&settings, settings_path.as_ref());
                if !version.is_empty() {
                    eprintln!("Update available: {version}");
                }
            }
            Event::UserEvent(UserEvent::UpdateDownload {
                version,
                asset,
                size,
                url,
            }) => {
                let proxy = proxy.clone();
                thread::spawn(move || run_update_download(proxy, version, asset, size, url));
            }
            Event::UserEvent(UserEvent::UpdateDownloadProgress { version, percent }) => {
                if let Some(webview) = webview.as_ref() {
                    if let Err(error) =
                        webview.evaluate_script(&update_progress_script(&version, percent))
                    {
                        eprintln!("Failed to report download progress: {error}");
                    }
                }
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
            Event::UserEvent(UserEvent::ApplyUpdate) => {
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
                                settings.window_height = last_windowed_size.height.round() as u32;
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
