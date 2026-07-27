//! Handing a rendered document to the web view.

use super::*;

pub(crate) fn update_local_image_source_dir(
    state: &Arc<Mutex<Option<PathBuf>>>,
    source_dir: Option<PathBuf>,
) {
    if let Ok(mut current) = state.lock() {
        *current = source_dir;
    }
}

/// Render the active tab's document (or the home screen) into the webview and
/// refresh the tab bar, window title, image source dir, and navigation buttons.
pub(crate) fn render_active(
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
                // The code view's own payload carries no tabs, so the strip and
                // the active index have to go over separately. A file opened
                // straight into source is a tab the page has never heard of.
                let tabs = workspace.tab_summaries();
                if let Some(webview) = webview {
                    if let Err(error) = webview.evaluate_script(&workspace_only_script(
                        &recent.files,
                        &tabs,
                        Some(index),
                    )) {
                        eprintln!("Failed to update tabs for the code view: {error}");
                    }
                }
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

pub(crate) fn update_navigation(
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
pub(crate) fn update_active_navigation(webview: Option<&WebView>, workspace: &Workspace) {
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
pub(crate) fn begin_reader_loading(webview: Option<&WebView>) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script("beginReaderLoading();") {
            eprintln!("Failed to arm the reader loading spinner: {error}");
        }
    }
}

pub(crate) fn scroll_to_fragment(webview: Option<&WebView>, fragment: &str) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&fragment_scroll_script(fragment)) {
            eprintln!("Failed to scroll to document fragment: {error}");
        }
    }
}

pub(crate) fn restore_scroll_anchor(webview: Option<&WebView>, anchor: &ScrollAnchor) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&scroll_anchor_script(anchor)) {
            eprintln!("Failed to restore document scroll position: {error}");
        }
    }
}

pub(crate) fn show_open_error(webview: Option<&WebView>, path: &std::path::Path, reason: &str) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&open_error_state_script(path, reason)) {
            eprintln!("Failed to show localized open error message: {error}");
        }
    }
}
