//! Handing a rendered document to the web view.

use super::*;

/// Run `script` in the page, logging a failure under `what`. A `None` webview (teardown) is not an error.
pub(crate) fn run_page_script(webview: Option<&WebView>, script: &str, what: &str) {
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(script) {
            eprintln!("{what}: {error}");
        }
    }
}

/// Whether `tab`'s edit buffer has to take what `path` now holds on disk before the page is drawn from it.
///
/// A tab the reader has touched is drawn from its buffer rather than from the file, and the live reload refreshes only the tab at the front — so a change that lands behind another tab is never shown, and coming back does not go and look. This is that look, asked once on the way in.
///
/// Yes only where the buffer is this document's, is clean, and holds different text. A dirty buffer says no: the disk must never write over words the reader has not saved. No buffer says no as well — that render reads the file itself.
pub(crate) fn buffer_must_take_disk(tab: &Tab, path: &Path, disk: &str) -> bool {
    tab.edit
        .as_ref()
        .filter(|_| tab.has_edit_for(path))
        .is_some_and(|edit| !edit.is_dirty() && edit.text() != disk)
}

/// What it takes to put a document on screen: the window to title, the page to write to, the tabs to draw, the recents to record, the favorites to mark, and where images resolve from. One bundle because they always travel together.
pub(crate) struct Reader {
    pub(crate) window: tao::window::Window,
    pub(crate) webview: Option<WebView>,
    pub(crate) workspace: Workspace,
    pub(crate) recent: RecentFiles,
    pub(crate) favorites: Favorites,
    pub(crate) config_path: Option<PathBuf>,
    pub(crate) image_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl Reader {
    /// The page, when there is one. `None` from the close handler onward.
    pub(crate) fn page(&self) -> Option<&WebView> {
        self.webview.as_ref()
    }

    /// Point the image protocol at the folder the open document sits in.
    fn set_image_dir(&self, source_dir: Option<PathBuf>) {
        if let Ok(mut current) = self.image_dir.lock() {
            *current = source_dir;
        }
    }

    /// Save the recents list, if there is a file to save it to.
    pub(crate) fn save_recent(&self) {
        if let Some(config_path) = self.config_path.as_ref() {
            if let Err(error) = save_recent_files(config_path, &self.recent) {
                eprintln!("Failed to save recent files: {error}");
            }
        }
    }

    /// Put `path` in Recent and save the list. The render below records only documents it read off the disk, so one saved out of a buffer needs this.
    pub(crate) fn record_recent(&mut self, path: PathBuf) {
        self.recent.record(path);
        self.save_recent();
    }

    /// Save the favorites, if there is a file to save them to.
    fn persist_favorites(&self) {
        if let Some(config_path) = self.config_path.as_ref() {
            if let Err(error) = save_favorites(config_path, &self.favorites) {
                eprintln!("Failed to save favorites: {error}");
            }
        }
    }

    /// Mark or unmark `path`, save, and tell every screen that draws the list. Marking is its own answer: the page has already drawn it, and this is the host agreeing.
    pub(crate) fn toggle_favorite(
        &mut self,
        path: PathBuf,
        kind: FavoriteKind,
        vault_id: Option<i64>,
    ) {
        if !self.favorites.remove(&path) {
            self.favorites.add(Favorite {
                vault_id,
                path,
                kind,
            });
        }
        self.persist_favorites();
        self.refresh_tab_strip();
    }

    /// Point the favorite row at `from` at the file the picker handed back, save, and redraw. Unlike marking, the page cannot draw this ahead of the host: the path the row now holds is one only the dialog knows.
    pub(crate) fn repoint_favorite(&mut self, from: &Path, to: &Path, vault_id: Option<i64>) {
        if let TabDraw::Render(intent) =
            repoint_favorite_draw(&mut self.favorites, from, to, vault_id)
        {
            self.persist_favorites();
            self.render(intent);
        }
    }

    /// Move the favorite row for `path` so it sits before `before`, save, and redraw.
    pub(crate) fn move_favorite(&mut self, path: &Path, before: Option<&Path>) {
        if let TabDraw::Render(intent) = move_favorite_draw(&mut self.favorites, path, before) {
            self.persist_favorites();
            self.render(intent);
        }
    }

    /// Drop the favorites inside a vault that has just been removed.
    pub(crate) fn forget_vault_favorites(&mut self, vault_id: i64) {
        if self.favorites.forget_vault(vault_id) {
            self.persist_favorites();
        }
    }

    /// Redraw the tab strip and leave the document on screen alone — what a page opened behind the reader needs, and nothing more.
    pub(crate) fn refresh_tab_strip(&self) {
        let tabs = self.workspace.tab_summaries();
        run_page_script(
            self.page(),
            &workspace_only_script(
                &self.recent.files,
                &self.favorites,
                &tabs,
                self.workspace.active,
            ),
            "Failed to refresh the tab strip",
        );
    }

    /// Bring this tab's clean edit buffer into step with the file before the page is drawn from it, the way the live reload does for the tab at the front. Reads only where the page is about to come out of a buffer, so the branch that reads the file anyway pays nothing.
    fn take_disk_into_clean_buffer(&mut self, index: usize, path: &Path) {
        if !self
            .workspace
            .tabs
            .get(index)
            .is_some_and(|tab| tab.has_edit_for(path))
        {
            return;
        }
        // Unreadable mid-save or briefly gone during an atomic rename: leave the buffer as it is rather than acting on a read that would have settled.
        let Ok(source) = read_source(path) else {
            return;
        };
        let Some(tab) = self.workspace.tabs.get_mut(index) else {
            return;
        };
        if !buffer_must_take_disk(tab, path, &source.text) {
            return;
        }
        if let Some(edit) = tab.edit.as_mut() {
            edit.adopt_external(source);
        }
    }

    /// The document for `path`: the tab's cached render when the file still hashes the same, a fresh render (cached on the tab) when not. The read is cheap; the render is what the cache saves.
    fn document_for(&mut self, index: usize, path: &Path) -> io::Result<OpenedDocument> {
        let source = read_source(path)?;
        let hash = content_hash(&source.text);
        if let Some(cache) = self
            .workspace
            .tabs
            .get(index)
            .and_then(|tab| tab.rendered.as_ref())
            .filter(|cache| cache.answers_for(path, hash))
        {
            return Ok(cache.document.clone());
        }
        let document =
            opened_document_from_source_with_host(&source.text, path, &DesktopHost::default());
        if let Some(tab) = self.workspace.tabs.get_mut(index) {
            tab.rendered = Some(RenderedCache {
                path: path.to_path_buf(),
                hash,
                document: document.clone(),
            });
        }
        Ok(document)
    }

    /// Render the active tab's document (or the home screen) into the webview and refresh the tab bar, window title, image source dir, and navigation buttons.
    pub(crate) fn render(&mut self, scroll: ScrollIntent) {
        let _ = self.render_with_open_result(scroll);
    }

    /// Render for a caller that needs to know whether the document opened.
    pub(crate) fn render_for_pipe(&mut self, scroll: ScrollIntent) -> Result<(), String> {
        self.render_with_open_result(scroll)
    }

    fn render_with_open_result(&mut self, scroll: ScrollIntent) -> Result<(), String> {
        // Pop the spinner for navigations (open, back/forward, tab switch), where the load below can be slow; the state script clears it. In-place re-renders (Preserve: edits, saves, renames) and the home screen skip it, so a checkbox click doesn't flash an overlay.
        if self.workspace.active.is_some() && !matches!(scroll, ScrollIntent::Preserve { .. }) {
            begin_reader_loading(self.page());
        }
        match self.workspace.active {
            Some(index) => {
                let Some(path) = self
                    .workspace
                    .tabs
                    .get(index)
                    .and_then(|tab| tab.history.current().cloned())
                else {
                    self.workspace.active = None;
                    return self.render_with_open_result(scroll);
                };
                // Opening, Back, Forward and a tab switch are the four ways a reader arrives at a document they have been away from, and any of them can arrive at a buffer the disk has moved past. A `Preserve` render is the app redrawing its own edit, where the buffer is the truth and a read could only ever say the same thing.
                if !matches!(scroll, ScrollIntent::Preserve { .. }) {
                    self.take_disk_into_clean_buffer(index, &path);
                }

                // A tab left in code view must stay in code view when it is re-rendered (switching tabs away and back, a save, a rename, the file changing on disk). The reading-view render below would silently drop out of the source editor, so restore the code view from the tab's buffer instead.
                if self
                    .workspace
                    .tabs
                    .get(index)
                    .is_some_and(|tab| tab.code_view)
                {
                    if let Some(title) = self.workspace.tabs.get(index).map(|tab| tab.title.clone())
                    {
                        self.window.set_title(&format!("{title} - Leaftext"));
                    }
                    let scroll_fraction = code_view_scroll(&scroll);
                    // The code view's own payload carries no tabs, so the strip and the active index have to go over separately. A file opened straight into source is a tab the page has never heard of.
                    let tabs = self.workspace.tab_summaries();
                    run_page_script(
                        self.page(),
                        &workspace_only_script(
                            &self.recent.files,
                            &self.favorites,
                            &tabs,
                            Some(index),
                        ),
                        "Failed to update tabs for the code view",
                    );
                    if let Err(why) =
                        enter_code_view(self.webview.as_ref(), &mut self.workspace, scroll_fraction)
                    {
                        say_edit_refused(self.page(), &self.workspace, &why);
                    }
                    return Ok(());
                }

                // Prefer this document's edit buffer so unsaved edits show — but only when the buffer is for THIS document, or a leftover buffer would shadow a page opened by a link click.
                let has_edit = self
                    .workspace
                    .tabs
                    .get(index)
                    .is_some_and(|tab| tab.has_edit_for(&path));
                let document = if has_edit {
                    let edit = self
                        .workspace
                        .tabs
                        .get(index)
                        .and_then(|tab| tab.edit.as_ref())
                        .expect("edit buffer present");
                    reading_document_from_buffer(edit, &path)
                } else {
                    match self.document_for(index, &path) {
                        Ok(document) => {
                            // The same recent-files bookkeeping an initial open does.
                            self.recent.record(path.clone());
                            self.save_recent();
                            document
                        }
                        Err(error) => {
                            let reason = error.to_string();
                            let missing = error.kind() == io::ErrorKind::NotFound;
                            let refusal = open_refusal(&path, &reason);
                            eprintln!("{refusal}");

                            // Drop a missing file from Recent so it can't re-trigger.
                            if missing && self.recent.forget(&path) {
                                self.save_recent();
                            }

                            // Don't strand the user on a tab that can't render: fall back to the previous document, or close the tab.
                            recover_failed_open(&mut self.workspace, index);

                            let _ = self.render_with_open_result(ScrollIntent::Reset);
                            show_open_error(self.page(), &path, &reason);
                            return Err(refusal);
                        }
                    }
                };

                if let Some(tab) = self.workspace.tabs.get_mut(index) {
                    tab.title = document.title.clone();
                }
                self.window
                    .set_title(&format!("{} - Leaftext", document.title));
                let image_source_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                self.set_image_dir(local_image_source_dir(&image_source_path));
                let tabs = self.workspace.tab_summaries();
                let script = match scroll {
                    ScrollIntent::Preserve { .. } => workspace_reload_script(
                        &self.recent.files,
                        &self.favorites,
                        &tabs,
                        Some(index),
                        Some(&document),
                    ),
                    ScrollIntent::Restore { anchor, .. } => workspace_switch_script(
                        &self.recent.files,
                        &self.favorites,
                        &tabs,
                        Some(index),
                        Some(&document),
                        anchor.as_ref(),
                    ),
                    ScrollIntent::Reset => workspace_state_script(
                        &self.recent.files,
                        &self.favorites,
                        &tabs,
                        Some(index),
                        Some(&document),
                    ),
                };
                run_page_script(self.page(), &script, "Failed to update document view");
            }
            None => {
                self.window.set_title("Leaftext");
                self.set_image_dir(None);
                let tabs = self.workspace.tab_summaries();
                run_page_script(
                    self.page(),
                    &workspace_state_script(&self.recent.files, &self.favorites, &tabs, None, None),
                    "Failed to update view",
                );
            }
        }
        update_active_navigation(self.page(), &self.workspace);
        Ok(())
    }
}

pub(crate) fn open_refusal(path: &Path, reason: &str) -> String {
    format!("Failed to open {}: {reason}", path.display())
}

pub(crate) fn recover_failed_open(workspace: &mut Workspace, index: usize) {
    let recovered = workspace
        .tabs
        .get_mut(index)
        .map(|tab| {
            tab.scroll_history.clear();
            tab.history.forget_current()
        })
        .unwrap_or(false);
    if !recovered {
        // The reader never saw this document, so whichever tab the close chooses is the right reset target.
        let _ = workspace.close_tab(index);
    }
}

/// Where the source editor goes when a tab showing source is re-rendered — one of the two answers a source-editor landing has. A restore carries the fraction it means and a reset says the top; an in-place change sends none on purpose, which is the page's cue to use the other answer and carry the fraction off the editor it is about to replace. A rename is the one in-place change that carries a fraction, because the path it moves is what makes the page refuse its own capture. What repointing a favorite row leaves to be drawn. A favorite row is only ever on the start screen, which the tab strip's own refresh does not draw, so the whole render is what draws it — and that costs nothing there, where the render takes the home branch and reads no file. A row that did not move draws nothing. State alone and no page, which is what lets a test ask it.
pub(crate) fn repoint_favorite_draw(
    favorites: &mut Favorites,
    from: &Path,
    to: &Path,
    vault_id: Option<i64>,
) -> TabDraw {
    favorite_draw(favorites.repoint(from, to, vault_id))
}

/// What dragging a favorite row to a new place leaves to be drawn. The same answer as repointing, and here the drag needs it: the page clears the row's transform without moving the row, so this render is the only thing that draws the new order.
pub(crate) fn move_favorite_draw(
    favorites: &mut Favorites,
    path: &Path,
    before: Option<&Path>,
) -> TabDraw {
    favorite_draw(favorites.move_before(path, before))
}

/// The one answer both favorite moves give, kept in one place so neither can quietly fall back to the strip.
fn favorite_draw(moved: bool) -> TabDraw {
    if moved {
        // The document on screen is untouched, so it keeps the place it was left at.
        TabDraw::Render(ScrollIntent::Preserve { code: None })
    } else {
        TabDraw::Nothing
    }
}

pub(crate) fn code_view_scroll(scroll: &ScrollIntent) -> Option<f64> {
    match scroll {
        ScrollIntent::Restore { code, .. } => *code,
        ScrollIntent::Preserve { code } => *code,
        ScrollIntent::Reset => Some(0.0),
    }
}

pub(crate) fn update_navigation(
    webview: Option<&WebView>,
    history: &DocumentHistory,
    scroll_history: &ScrollHistory,
) {
    run_page_script(
        webview,
        &navigation_state_script(
            scroll_history.can_go_back() || history.can_go_back(),
            scroll_history.can_go_forward() || history.can_go_forward(),
        ),
        "Failed to update navigation state",
    );
}

/// Refresh the back/forward buttons from the active tab's histories, or disable them when the home screen is showing.
pub(crate) fn update_active_navigation(webview: Option<&WebView>, workspace: &Workspace) {
    match workspace.active.and_then(|index| workspace.tabs.get(index)) {
        Some(tab) => update_navigation(webview, &tab.history, &tab.scroll_history),
        None => run_page_script(
            webview,
            &navigation_state_script(false, false),
            "Failed to update navigation state",
        ),
    }
}

/// Pop the reader loading spinner before a view renders on this thread. The state script the render sends back clears it; a page-side safety timeout covers anything that slips through.
pub(crate) fn begin_reader_loading(webview: Option<&WebView>) {
    run_page_script(
        webview,
        "beginReaderLoading();",
        "Failed to arm the reader loading spinner",
    );
}

pub(crate) fn scroll_to_fragment(webview: Option<&WebView>, fragment: &str) {
    run_page_script(
        webview,
        &fragment_scroll_script(fragment),
        "Failed to scroll to document fragment",
    );
}

pub(crate) fn restore_scroll_anchor(webview: Option<&WebView>, anchor: &ScrollAnchor) {
    run_page_script(
        webview,
        &scroll_anchor_script(anchor),
        "Failed to restore document scroll position",
    );
}

pub(crate) fn show_open_error(webview: Option<&WebView>, path: &std::path::Path, reason: &str) {
    run_page_script(
        webview,
        &open_error_state_script(path, reason),
        "Failed to show localized open error message",
    );
}
