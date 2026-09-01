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

/// Whether `tab`'s buffer for `path` is worth opening the file for at all.
///
/// Asked before anything touches the disk, because the read behind it is the whole file. A package's buffer holds one member of an archive while the file is the archive, so the two can never be compared as text — the decoder refuses the archive at the first byte no text file could hold, and tens of megabytes are read to be dropped. `format.rs` answers that from the extension for nothing.
///
/// A dirty buffer says no because the comparison behind the read already refuses to replace unsaved words. No buffer says no as well: that render reads the file itself.
pub(crate) fn buffer_is_worth_opening_the_file(tab: &Tab, path: &Path) -> bool {
    tab.edit
        .as_ref()
        .filter(|edit| !edit.is_dirty())
        .is_some_and(|_| {
            tab.has_edit_for(path)
                && DocumentFormat::from_path(path).source_shape() == leaftext::SourceShape::Text
        })
}

/// The record only gates the read; the byte comparison still decides whether the buffer takes the file.
pub(crate) fn buffer_record_requires_read(
    tab: &Tab,
    path: &Path,
    record: Option<FileRecord>,
) -> bool {
    tab.edit
        .as_ref()
        .filter(|_| tab.has_edit_for(path))
        .is_some_and(|edit| match record {
            Some(record) => !edit.matches_file_record(record),
            None => true,
        })
}

/// Whether `tab`'s clean package buffer is behind what `path` now holds, asked on the archive's own identity rather than on its words.
///
/// A package's buffer holds one member while the file is the whole archive, so there is no text comparison to make here. What the two do share is the identity a zip writes into the directory at its end: the file's comes off a tail read, the buffer's off the archive it is already carrying, and neither inflates a member.
///
/// A dirty buffer says no, the way the text path does. So does a file whose tail will not read as a package — mid-save, or briefly gone during an atomic rename — because that is a read which would have settled.
///
/// The comparison itself is [`package_buffer_matches_file`], which the picture dialog's reconciliation asks too. The rule about a dirty buffer stays here, because that caller answers it the other way.
pub(crate) fn package_buffer_must_take_disk(tab: &Tab, path: &Path) -> bool {
    let clean = tab
        .edit
        .as_ref()
        .filter(|_| tab.has_edit_for(path))
        .is_some_and(|edit| !edit.is_dirty());
    clean && package_buffer_matches_file(tab, path) == Some(false)
}

/// Bring tab `index`'s clean edit buffer into step with the file at `path`, the way the live reload does for the tab at the front. Answers whether the buffer took the file, so a caller holding something drawn from it knows it is drawn from words the buffer no longer holds.
///
/// A free function over the workspace rather than a method on the `Reader`, because the pipe's three writes need it and none of them has a `Reader`. Each guards itself with a fingerprint of the buffer, so a buffer left behind matches its own stale self and the write puts the old words back over a file somebody changed outside the app.
///
/// The read below is the whole file, and for a package it was only ever spent: a 50 MB deck read 50,347,428 bytes here to be refused by the decoder and dropped. Hence the shape test in front of it.
pub(crate) fn take_disk_into_clean_buffer(
    workspace: &mut Workspace,
    index: usize,
    path: &Path,
) -> bool {
    take_disk_into_clean_buffer_at(workspace, index, path, std::time::SystemTime::now())
}

pub(crate) fn take_disk_into_clean_buffer_at(
    workspace: &mut Workspace,
    index: usize,
    path: &Path,
    now: std::time::SystemTime,
) -> bool {
    // A package answers first, on the identity at the end of its file. The two arms are exclusive: only a package carries an archive, and only a text format is worth opening whole.
    if workspace
        .tabs
        .get(index)
        .is_some_and(|tab| package_buffer_must_take_disk(tab, path))
    {
        // The one place a package's file is opened here, and only where the identity really moved. The archive comes with its anchored member, because a save writes that member back into the archive it was read from.
        let Ok(source) = read_document_for_editing(path) else {
            return false;
        };
        let Some(edit) = workspace
            .tabs
            .get_mut(index)
            .and_then(|tab| tab.edit.as_mut())
        else {
            return false;
        };
        edit.adopt_external(source);
        return true;
    }
    if !workspace
        .tabs
        .get(index)
        .is_some_and(|tab| buffer_is_worth_opening_the_file(tab, path))
    {
        return false;
    }
    let record = file_record_at(path, now);
    if workspace
        .tabs
        .get(index)
        .is_some_and(|tab| !buffer_record_requires_read(tab, path, record))
    {
        return false;
    }
    // Unreadable mid-save or briefly gone during an atomic rename: leave the buffer as it is rather than acting on a read that would have settled.
    let Ok(source) = read_source(path) else {
        return false;
    };
    let Some(tab) = workspace.tabs.get_mut(index) else {
        return false;
    };
    let took_disk = buffer_must_take_disk(tab, path, &source.text);
    let Some(edit) = tab.edit.as_mut() else {
        return false;
    };
    if took_disk {
        edit.adopt_external(source);
    }
    edit.remember_file_record(record);
    took_disk
}

// How old a modification time has to be before it can be trusted to tell two versions of a file apart. Not a delay: nothing waits on it, and a record dropped by it costs one read to earn back. A file system stamps as coarsely as it likes — NTFS separates writes about half a millisecond apart, HFS+ to the second, FAT32 to two — so a write landing in the same tick as the reading below carries the stamp that reading saw, and a record kept from it would leave a stale render on screen for ever. Two seconds is FAT32's own resolution, which puts every file system this app ships to on the safe side without this code having to know which one it is on.
const FILE_RECORD_SETTLE: std::time::Duration = std::time::Duration::from_secs(2);

/// What `path` says about itself, for a caller about to decide whether it needs to read the file — answered off the directory entry in about 17 µs, flat in the file's size where the read it stands in front of is not.
///
/// `None` where the file cannot be asked, and where its stamp had not settled: a stamp younger than [`FILE_RECORD_SETTLE`], or one the clock cannot place behind now, which is what a file dated in the future gives.
///
/// Take it *before* the file is read, never after. Taken after, the record can describe a write that landed during the read, so a newer stamp is stored beside older content and the gate shows a stale render for ever. Taken before, the same race stores an older stamp beside newer content, the next arrival sees a stamp that does not match and reads — one wasted read rather than a wrong page.
pub(crate) fn settled_file_record(path: &Path) -> Option<FileRecord> {
    file_record_at(path, std::time::SystemTime::now())
}

fn file_record_at(path: &Path, now: std::time::SystemTime) -> Option<FileRecord> {
    let meta = fs::metadata(path).ok()?;
    settled_record(meta.len(), meta.modified().ok()?, now)
}

/// The settle rule alone, against a clock the caller names, so a test can ask what a file that settled long ago answers without waiting out [`FILE_RECORD_SETTLE`]. See [`settled_file_record`], which is the only caller that reads the real clock.
pub(crate) fn settled_record(
    len: u64,
    modified: std::time::SystemTime,
    now: std::time::SystemTime,
) -> Option<FileRecord> {
    // `duration_since` fails on a stamp ahead of `now`, so a file dated in the future drops its record rather than having its age guessed at.
    let age = now.duration_since(modified).ok()?;
    (age >= FILE_RECORD_SETTLE).then_some(FileRecord { len, modified })
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

/// A render and the two things a tab switch asks of it: which render it is, and whether the tab already had it.
pub(crate) struct RenderedDocument {
    pub(crate) document: OpenedDocument,
    pub(crate) hash: u64,
    pub(crate) reused: bool,
}

/// May the switch send the key alone? Only where the tab's own render answered, the page still holds the layout that render drew, and the page has not asked for the whole thing back. A fresh render has never been on the page, so there is nothing there to put back.
pub(crate) fn switch_uses_cached_handoff(
    reused: bool,
    hash: u64,
    page_key: Option<&str>,
    force_full: bool,
) -> bool {
    reused && !force_full && page_key == Some(format!("{hash:016x}").as_str())
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

    /// The document for `path`: the tab's cached render where the file still answers the same, a fresh render (cached on the tab) where it does not. The render is what the cache saves, and the one read here is what the render is drawn from — a package's archive travels with its text, so nothing reads the file again to unpack it.
    ///
    /// A package states what every member's bytes are in its own directory, written at the end of the file, so a tab switched back to is gated on a small read from the tail and the document is opened only where that misses. Every other format is its own text and has to be read before it can be hashed at all — which is why the file's own record is asked first.
    fn document_for(&mut self, index: usize, path: &Path) -> io::Result<RenderedDocument> {
        // Taken at the top, before anything opens the file, so the entry written below stands on a reading of the file as it was when this render was drawn from it. One call serves that entry and the gate that reads it back.
        let record = settled_file_record(path);
        // The record decides whether to read; the hash below still decides whether the render answers. Two questions, not one — drop the hash behind this and `page_shows_file` loses the only key it can ask about contents the live reload is already holding.
        if let Some(cache) = self
            .workspace
            .tabs
            .get(index)
            .and_then(|tab| tab.rendered.as_ref())
            .filter(|cache| cache.stands_for(path, record))
        {
            return Ok(RenderedDocument {
                document: cache.document.clone(),
                hash: cache.hash,
                reused: true,
            });
        }
        let (hash, read_already) = match render_hash(path, None) {
            Some(hash) => (hash, None),
            None => {
                let source = read_document_for_editing(path)?;
                (content_hash(&source.text.text), Some(source))
            }
        };
        if let Some(cache) = self
            .workspace
            .tabs
            .get(index)
            .and_then(|tab| tab.rendered.as_ref())
            .filter(|cache| cache.answers_for(path, hash))
        {
            return Ok(RenderedDocument {
                document: cache.document.clone(),
                hash: cache.hash,
                reused: true,
            });
        }
        let source = match read_already {
            Some(source) => source,
            None => read_document_for_editing(path)?,
        };
        let document = opened_document_for_path_with_host(path, &source, &DesktopHost::default())?;
        if let Some(tab) = self.workspace.tabs.get_mut(index) {
            tab.rendered = Some(RenderedCache {
                path: path.to_path_buf(),
                hash,
                record,
                document: document.clone(),
            });
        }
        Ok(RenderedDocument {
            document,
            hash,
            reused: false,
        })
    }

    /// Render the active tab's document (or the home screen) into the webview and refresh the tab bar, window title, image source dir, and navigation buttons.
    pub(crate) fn render(&mut self, scroll: ScrollIntent) {
        let _ = self.render_with_open_result(scroll, None);
    }

    /// Render for a tab switch, which may hand the page a key instead of the document.
    pub(crate) fn render_switch(
        &mut self,
        scroll: ScrollIntent,
        page_key: Option<&str>,
        force_full: bool,
    ) {
        let _ = self.render_with_open_result(scroll, Some((page_key, force_full)));
    }

    /// Render for a caller that needs to know whether the document opened.
    pub(crate) fn render_for_pipe(&mut self, scroll: ScrollIntent) -> Result<(), String> {
        self.render_with_open_result(scroll, None)
    }

    fn render_with_open_result(
        &mut self,
        scroll: ScrollIntent,
        switch: Option<(Option<&str>, bool)>,
    ) -> Result<(), String> {
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
                    return self.render_with_open_result(scroll, switch);
                };
                // Opening, Back, Forward and a tab switch are the four ways a reader arrives at a document they have been away from, and any of them can arrive at a buffer the disk has moved past. A `Preserve` render is the app redrawing its own edit, where the buffer is the truth and a read could only ever say the same thing.
                if !matches!(scroll, ScrollIntent::Preserve { .. }) {
                    take_disk_into_clean_buffer(&mut self.workspace, index, &path);
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
                let rendered = if has_edit {
                    let edit = self
                        .workspace
                        .tabs
                        .get(index)
                        .and_then(|tab| tab.edit.as_ref())
                        .expect("edit buffer present");
                    let document = reading_document_from_buffer(edit, &path);
                    RenderedDocument {
                        hash: content_hash(&document.source),
                        document,
                        reused: false,
                    }
                } else {
                    match self.document_for(index, &path) {
                        Ok(rendered) => {
                            // The same recent-files bookkeeping an initial open does.
                            self.recent.record(path.clone());
                            self.save_recent();
                            rendered
                        }
                        Err(error) => {
                            // One reason for every outward sentence, with this file's name taken off the end of it. The log, the ask refusal and the message in the corner all name the file at the front themselves, so they cannot part company and none of them says it twice.
                            let reason = opened_file_named_once(&path, &error.to_string());
                            let missing = error.kind() == io::ErrorKind::NotFound;
                            let refusal = open_refusal(&path, &reason);
                            eprintln!("{refusal}");

                            // Drop a missing file from Recent so it can't re-trigger.
                            if missing && self.recent.forget(&path) {
                                self.save_recent();
                            }

                            // Don't strand the user on a tab that can't render: fall back to the previous document, or close the tab.
                            recover_failed_open(&mut self.workspace, index);

                            let _ = self.render_with_open_result(ScrollIntent::Reset, None);
                            show_open_error(self.page(), &path, &reason);
                            return Err(refusal);
                        }
                    }
                };
                let document = &rendered.document;

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
                        Some(document),
                        Some(rendered.hash),
                    ),
                    ScrollIntent::Restore { anchor, .. } => {
                        let cached = switch.is_some_and(|(page_key, force_full)| {
                            switch_uses_cached_handoff(
                                rendered.reused,
                                rendered.hash,
                                page_key,
                                force_full,
                            )
                        });
                        if cached {
                            leaftext::workspace_cached_switch_script(
                                &self.recent.files,
                                &self.favorites,
                                &tabs,
                                Some(index),
                                anchor.as_ref(),
                                rendered.hash,
                            )
                        } else {
                            workspace_switch_script(
                                &self.recent.files,
                                &self.favorites,
                                &tabs,
                                Some(index),
                                Some(document),
                                anchor.as_ref(),
                                Some(rendered.hash),
                            )
                        }
                    }
                    ScrollIntent::Reset => workspace_state_script(
                        &self.recent.files,
                        &self.favorites,
                        &tabs,
                        Some(index),
                        Some(document),
                        Some(rendered.hash),
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
                    &workspace_state_script(
                        &self.recent.files,
                        &self.favorites,
                        &tabs,
                        None,
                        None,
                        None,
                    ),
                    "Failed to update view",
                );
            }
        }
        update_active_navigation(self.page(), &self.workspace);
        Ok(())
    }
}

/// A failed open's reason with the decoder's own trailing copy of this file's name taken off.
///
/// The decoder names the file because its error also travels alone into public reading calls and log lines. Here both outward sentences put the path at the front themselves — [`open_refusal`] for the log and the ask, the page for the message in the corner — so that trailing copy is the same name a second time and wraps a real path over extra lines. Only an exact trailing ` (path)` for the file being opened comes off; every other reason is returned as it arrived.
pub(crate) fn opened_file_named_once(path: &Path, reason: &str) -> String {
    let trailing = format!(" ({})", path.display());
    reason.strip_suffix(&trailing).unwrap_or(reason).to_string()
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
