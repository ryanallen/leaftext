//! Open tabs and the document each one shows.

use super::*;

/// One open document tab: its own back/forward history, scroll history, and a cached title used to label the tab even while it is not the active tab.
#[derive(Debug, Default)]
pub(crate) struct Tab {
    pub(crate) history: DocumentHistory,
    pub(crate) scroll_history: ScrollHistory,
    pub(crate) title: String,
    /// Where the code view is scrolled to, as a 0..1 fraction of the scrollable range, so switching tabs keeps the source editor's place. Kept current by the reader's own scrolling — the source editor sends it back a quarter second after they stop — rather than written on the way out, which is what lets a rename hand it to a page that has no capture of its own. On the tab rather than on the history entry beside it: a fraction of a source buffer is not a block in a rendered document. `None` until the tab has been scrolled while in code view.
    pub(crate) saved_code_scroll: Option<f64>,
    /// The editable source buffer, created on first edit and kept so unsaved edits survive view toggles and tab switches. `None` until edited. The authoritative copy a save writes and the reading view re-renders from.
    pub(crate) edit: Option<EditableDocument>,
    /// Whether this tab is currently showing the raw-source code view rather than the rendered reading view.
    pub(crate) code_view: bool,
    /// The last render of this tab's document from disk, reused on a switch while the file still answers the same hash. The hash check is what admits it, so a stale entry is re-rendered over, never shown.
    pub(crate) rendered: Option<RenderedCache>,
}

/// See [`Tab::rendered`].
#[derive(Debug)]
pub(crate) struct RenderedCache {
    pub(crate) path: PathBuf,
    /// What `render_hash` answered for the document: a package's own identity, read off the directory at the end of the file, and every other format's source text hashed. Not the source either way for a package — its members are what moved, and its text is one of them.
    pub(crate) hash: u64,
    /// What the file said about itself before it was read, where that reading could be trusted; `None` where it could not, or where whoever wrote this entry had already read the file and so could not take one safely. A package entry with none can still be checked against the identity in the file's own directory.
    pub(crate) record: Option<FileRecord>,
    /// The archive this render was unpacked from, where the document is a package: the bytes a save splices the edited member back into. It rides inside this entry rather than beside it, so a file that moved replaces it whole and a cleared entry clears it — there is no second thing to keep in step. `None` for every text format, and for a package whose buffer has already taken it.
    pub(crate) package: Option<leaftext::PackageBuffer>,
    /// The drawn document this entry owns. Every reader takes a handle on it rather than a copy: a switch back to a rendered tab is answered with the tab's name and a key, so copying the article markup, the block ranges and a package member's whole text to read one field of it is work spent on a path the page is sent none of. `Rc` and not `Arc` because a tab never leaves the window thread — [`Reader`] holds the window itself.
    pub(crate) document: Rc<OpenedDocument>,
}

impl RenderedCache {
    /// Whether this entry answers for `path` at `hash`. The path check matters: two files can hold identical text, and a render carries the folder its images resolve against.
    pub(crate) fn answers_for(&self, path: &Path, hash: u64) -> bool {
        self.hash == hash && paths_refer_to_same_document(&self.path, path)
    }

    /// Whether this entry stands for `path` at `record` — so a caller holding a reading of the file can answer from the render without opening it.
    ///
    /// The same document, a record this entry kept, and a record that still matches. Either side missing one says no: an entry that kept none has nothing to compare, and a file that could not be asked is a file to read. The path check is [`Self::answers_for`]'s, for the same reason — two files can hold the same length and the same stamp.
    pub(crate) fn stands_for(&self, path: &Path, record: Option<FileRecord>) -> bool {
        self.record.is_some()
            && self.record == record
            && paths_refer_to_same_document(&self.path, path)
    }

    /// What a switch takes when this entry answers: a handle on the drawn document and the key it was drawn under. Both gates make this one call, so neither can reach past it and copy — the answer is the entry's own allocation, which is what a test can hold it to.
    pub(crate) fn reuse(&self) -> (Rc<OpenedDocument>, u64) {
        (Rc::clone(&self.document), self.hash)
    }
}

impl Tab {
    /// Whether this tab holds an edit buffer for `path` specifically. A tab navigates across documents, but its edit buffer belongs to one file.
    pub(crate) fn has_edit_for(&self, path: &Path) -> bool {
        self.edit
            .as_ref()
            .is_some_and(|edit| paths_refer_to_same_document(&edit.path, path))
    }

    /// Whether this tab is showing its own no-file buffer's name rather than any document on disk. A note wears a bare relative name, so resolving it lands on whatever folder the app was started in — and a reader with a file of that name sitting there must get their file rather than the blank note. The one test both matches that decide a document is already open ask, so the two cannot drift.
    ///
    /// The flag alone is not the test: a note's tab can follow a link to a real document and keep its no-file buffer, and that tab really is showing that document.
    pub(crate) fn shows_untitled_buffer(&self) -> bool {
        self.edit.as_ref().is_some_and(|edit| {
            edit.untitled
                && self
                    .history
                    .current()
                    .is_some_and(|current| current == &edit.path)
        })
    }

    /// Whether starting an edit of `path` needs the file read from disk first: true when there is no buffer, or the buffer is for a different document.
    pub(crate) fn needs_edit_seed(&self, path: &Path) -> bool {
        !self.has_edit_for(path)
    }

    /// What an edit buffer can be seeded with without opening the file: the member text the drawn document is already carrying, and the archive this tab kept when it rendered — the whole of what a package's buffer wants, so a first click into a Word file costs a folder read rather than a second inflate and a second parse of its largest member.
    ///
    /// `None` for every text format, whose spelling lives in the read and is nowhere on the drawn document, and for a tab whose entry no longer stands for the file by either its reading or a package identity.
    ///
    /// The archive is taken rather than cloned: the buffer is about to own it, and a copy left behind would be a second archive held for nobody.
    pub(crate) fn seed_from_render(&mut self, path: &Path) -> Option<DocumentSource> {
        let cache = self.rendered.as_mut()?;
        // Behind the entry, not in front of it: a tab with no render has nothing to compare a reading against, and the reading is a folder read.
        if !cache.stands_for(path, settled_file_record(path)) {
            let hash = render_hash(path, None)?;
            if !cache.answers_for(path, hash) {
                return None;
            }
        }
        let package = cache.package.take()?;
        Some(DocumentSource {
            // A package's member has no spelling but UTF-8, which is the one the read would have given it too.
            text: SourceText::utf8(cache.document.source.clone()),
            package: Some(package),
            // The buffer drops a parsed package, so parsing one to hand over would be work for nothing.
            document: None,
        })
    }

    /// The edit buffer for `path`, seeded from `contents` when there's no buffer yet. Re-editing the same document reuses it; a different document replaces it. A package's buffer carries the archive its text came out of, so a save can put that one member back.
    pub(crate) fn edit_buffer(
        &mut self,
        path: &Path,
        contents: impl Into<DocumentSource>,
    ) -> &mut EditableDocument {
        if self.needs_edit_seed(path) {
            let DocumentSource {
                text,
                package,
                document: _,
            } = contents.into();
            self.edit = Some(match package {
                Some(package) => EditableDocument::over_package(path.to_path_buf(), text, package),
                None => EditableDocument::new(path.to_path_buf(), text),
            });
        }
        self.edit.as_mut().expect("edit buffer just ensured")
    }
}

/// The set of open tabs plus which one is active. `active` is `None` when the home screen is showing; the tabs stay open so the user can return to them.
#[derive(Debug, Default)]
pub(crate) struct Workspace {
    pub(crate) tabs: Vec<Tab>,
    pub(crate) active: Option<usize>,
}

/// The unsaved buffer a close carried, put back — or `None`, which is every ordinary tab.
///
/// The one disk read the restore makes, and only for a tab that was left dirty. The file has to still be exactly what those edits were made against: changed underneath, the carried pair is dropped and the document opens as the disk has it, because splicing somebody's unsaved words over an edit made somewhere else is the one outcome worse than losing them.
///
/// The buffer is seeded from the read and the carried text goes on as one whole-buffer replacement, so the restored tab is dirty by the ordinary comparison and holds exactly one press of undo — back to the file as it was last saved, which is the only step that is still true.
fn restored_edit_buffer(saved: &SessionTab) -> Option<EditableDocument> {
    let unsaved = saved.unsaved_text.as_deref()?;
    let last_saved = saved.saved_text.as_deref()?;
    let source = read_source(&saved.path).ok()?;
    if source.text != last_saved {
        return None;
    }
    let mut edit = EditableDocument::new(saved.path.clone(), source);
    let end = edit.text().len();
    edit.replace_range(0, end, unsaved);
    Some(edit)
}

/// A note that never got a file, put back: an empty buffer wearing the name it was saved under, with the carried words applied as one whole-buffer replacement. So the tab is dirty by the ordinary comparison and holds exactly one press of undo — back to the empty note it was, which is the only step that was ever true of it.
///
/// Nothing is read and nothing on disk is consulted. The entry says it has no file, and that is the whole test: the name is a bare relative one, so a file of that name beside the app is somebody else's document, not this note.
fn restored_untitled_buffer(saved: &SessionTab) -> EditableDocument {
    let mut edit = EditableDocument::untitled(saved.path.clone());
    if let Some(unsaved) = saved.unsaved_text.as_deref() {
        let end = edit.text().len();
        edit.replace_range(0, end, unsaved);
    }
    edit
}

/// The words typed into a file that has since left the disk, put back as a note with no file wearing the name it had: the carried last-saved text as the baseline, the carried words applied on top as one whole-buffer replacement. `None` where the entry carries no words, which is the ordinary stale tab and drops.
///
/// The app is holding the only copy, so the alternative is discarding it. The raised flag is what keeps that safe: nothing is written to the old path unless the reader picks a place, so a deleted file, a renamed one and a drive nobody mounted all land here together and none of them can be written over — a reassigned drive letter is a different disk, and the first save asks rather than guessing.
///
/// The baseline is the last-saved text rather than the empty note [`restored_untitled_buffer`] opens with, because an empty baseline would make one habitual press of undo empty the whole document. That text is the one earlier state that was ever true of this document, and the close writes it beside the words for exactly this entry.
fn restored_orphaned_buffer(saved: &SessionTab) -> Option<EditableDocument> {
    let unsaved = saved.unsaved_text.as_deref()?;
    let last_saved = saved.saved_text.as_deref()?;
    let mut edit =
        EditableDocument::new(saved.path.clone(), SourceText::utf8(last_saved.to_string()));
    // The words are all that is left of the document, so they answer for it as a note rather than as the file that is gone.
    edit.untitled = true;
    let end = edit.text().len();
    edit.replace_range(0, end, unsaved);
    Some(edit)
}

impl Workspace {
    /// Rebuild the tab strip from the last saved session. The only document read is a tab the last close left with unsaved edits, which [`restored_edit_buffer`] has to compare against the file. A missing path is left out unless its entry carries words, and a missing front tab falls forward to the nearest remaining one.
    pub(crate) fn from_session(session: &Session) -> Self {
        let mut saved_indices = Vec::new();
        let mut tabs = Vec::new();
        for (saved_index, saved) in session.tabs.iter().enumerate() {
            // The buffer is decided first because it also decides whether the entry comes back at all: a file that has left the disk keeps its tab only where its words came with it. A note with no file is never asked about the disk, and `restored_untitled_buffer` says why.
            let edit = if saved.untitled {
                Some(restored_untitled_buffer(saved))
            } else if saved.path.is_file() {
                restored_edit_buffer(saved)
            } else {
                match restored_orphaned_buffer(saved) {
                    Some(edit) => Some(edit),
                    None => continue,
                }
            };
            let mut tab = Tab {
                title: saved.title.clone(),
                code_view: saved.code_view,
                edit,
                ..Tab::default()
            };
            tab.history.record(saved.path.clone());
            if let Some(anchor) = saved.anchor.clone() {
                tab.history.stamp_current(anchor);
            }
            tab.saved_code_scroll = saved.saved_code_scroll;
            saved_indices.push(saved_index);
            tabs.push(tab);
        }
        let active = session.active.and_then(|saved_active| {
            saved_indices
                .iter()
                .position(|&index| index == saved_active)
                .or_else(|| {
                    saved_indices
                        .iter()
                        .position(|&index| index >= saved_active)
                })
                .or_else(|| (!tabs.is_empty()).then_some(tabs.len() - 1))
        });
        Self { tabs, active }
    }

    /// The session worth saving: one current document per tab, with its strip label and view. A note that never got a file is left out entirely, because this session carries no words and an entry without them would come back at the next launch as a blank note nobody opened.
    pub(crate) fn session(&self) -> Session {
        self.build_session(false)
    }

    /// The session the window writes on its way out, which also carries every unsaved buffer so the edits are there at the next launch instead of being discarded without a word. This is the only session a note with no file appears in, and only where something was typed into it.
    ///
    /// Only the close builds this one. The mid-run saves keep to [`session`](Self::session): a typing pause reaches the buffer every fifth of a second, and carrying the text there would rewrite the settings file that often.
    pub(crate) fn closing_session(&self) -> Session {
        self.build_session(true)
    }

    fn build_session(&self, carry_unsaved: bool) -> Session {
        let mut active = None;
        let mut tabs = Vec::new();
        for (index, tab) in self.tabs.iter().enumerate() {
            let Some(showing) = tab.history.current().cloned() else {
                continue;
            };
            let unsaved = carry_unsaved
                .then(|| tab.edit.as_ref())
                .flatten()
                .filter(|edit| edit.is_dirty());
            // The entry names the document the words belong to, not the one the tab has since followed a link to: an entry is one document with no Back list, so words carried under the page the reader walked on to would land where nothing on the window could reach them.
            let path = unsaved.map_or(showing.clone(), |edit| edit.path.clone());
            let moved_on = !paths_refer_to_same_document(&path, &showing);
            // A tab's cached label is for the document it is showing, so an entry written on one behind it takes that document's own name.
            let title = if moved_on {
                leaftext::tab_title_from_path(&path)
            } else {
                tab.title.clone()
            };
            // What the entry describes, not what the buffer is: a note's buffer sitting behind a tab says nothing about the file that tab is showing.
            let untitled = tab.edit.as_ref().is_some_and(|edit| {
                edit.untitled && paths_refer_to_same_document(&edit.path, &path)
            });
            // A note with no file is only worth an entry where the entry carries its own words: there is nothing to reopen. That is one test, not two — an untitled buffer's saved baseline is the empty note it opened as, so dirty on one means exactly that something was typed into it.
            if untitled && unsaved.is_none() {
                continue;
            }
            if self.active == Some(index) {
                active = Some(tabs.len());
            }
            let anchor = tab.history.anchor_for(&path);
            tabs.push(SessionTab {
                path,
                title,
                code_view: tab.code_view,
                anchor,
                saved_code_scroll: tab.saved_code_scroll,
                untitled,
                unsaved_text: unsaved.map(|edit| edit.text().to_string()),
                // No baseline for a note with no file: there is nothing on disk for the next launch to compare, which is what a baseline is for.
                saved_text: unsaved
                    .filter(|_| !untitled)
                    .map(|edit| edit.saved_text().to_string()),
            });
        }
        Session { tabs, active }
    }

    /// Remember the settled active view so a native close never has to ask the page for its place.
    pub(crate) fn save_active_position(
        &mut self,
        anchor: Option<ScrollAnchor>,
        code_scroll: Option<f64>,
    ) {
        let Some(tab) = self.active.and_then(|index| self.tabs.get_mut(index)) else {
            return;
        };
        if let Some(anchor) = anchor {
            tab.history.stamp_current(anchor);
        }
        tab.saved_code_scroll = code_scroll;
    }

    /// The document on screen, or `None` on the home screen. Asked by everything that has to know what the reader is actually looking at — the watcher, and what a graph is a map of — so it is answered in one place rather than by each of them walking `active` into `tabs` into `history` again.
    pub(crate) fn active_path(&self) -> Option<&Path> {
        self.active
            .and_then(|index| self.tabs.get(index))
            .and_then(|tab| tab.history.current())
            .map(PathBuf::as_path)
    }

    /// The file the active tab is showing: nothing on the home screen, and nothing while the tab is showing its no-file buffer's name. Every comparison that decides a path is the document on screen asks this, so a note's bare name never answers for a reader's own file of that name. `active_path` stays beside it as the name the note wears, which the session, the strip and the render read.
    pub(crate) fn active_file(&self) -> Option<&Path> {
        if self.active_shows_untitled_buffer() {
            return None;
        }
        self.active_path()
    }

    /// Whether the active tab is showing its no-file buffer's name. See [`Tab::shows_untitled_buffer`].
    pub(crate) fn active_shows_untitled_buffer(&self) -> bool {
        self.active
            .and_then(|index| self.tabs.get(index))
            .is_some_and(Tab::shows_untitled_buffer)
    }

    /// The active tab's edit buffer, when one exists.
    pub(crate) fn active_edit(&self) -> Option<&EditableDocument> {
        self.active
            .and_then(|index| self.tabs.get(index))
            .and_then(|tab| tab.edit.as_ref())
    }

    /// The active tab's edit buffer, mutably.
    pub(crate) fn active_edit_mut(&mut self) -> Option<&mut EditableDocument> {
        self.active
            .and_then(|index| self.tabs.get_mut(index))
            .and_then(|tab| tab.edit.as_mut())
    }

    /// The source place the tab at the front is holding, but only while that tab is showing `path`. The one caller is a rename, which is the only in-place render that has to hand the page a place of its own: the page's capture is refused when the document moves, and a rename is what moves it. The path is named rather than trusted off `active`, because renaming a file open in a background tab still redraws the front one — and that tab's live position is exacter than anything saved.
    pub(crate) fn front_saved_code_scroll_for(&self, path: &Path) -> Option<f64> {
        let tab = self.active.and_then(|index| self.tabs.get(index))?;
        let showing = tab
            .history
            .current()
            .is_some_and(|current| paths_refer_to_same_document(current, path));
        showing.then_some(tab.saved_code_scroll).flatten()
    }

    /// Move every tab sitting on `from` across to `to`, after the file itself has been renamed, and rename every back and forward step naming it in every tab. Answers whether any tab followed.
    ///
    /// Without this a rename leaves whoever is reading the file pointed at a path that is not there any more, and the next render fails to open it. The buffer is never touched, only the path it wears, so unsaved typing survives — and the format follows the new name, which is the answer reopening the file would give. Every step is renamed in place rather than gaining one: Back must not offer a name nothing was ever at.
    pub(crate) fn follow_rename(&mut self, from: &Path, to: &Path) -> bool {
        let mut followed = false;
        for tab in &mut self.tabs {
            let showing = tab
                .history
                .current()
                .is_some_and(|current| paths_refer_to_same_document(current, from));
            // A tab can hold a buffer for one document while showing another it followed a link to, so the two move independently.
            let holds_buffer = tab.has_edit_for(from);
            // Before the guard below, on every tab: a tab that visited the file and left is skipped there, and that is the tab whose Back lands on a name nothing is at. A buried step is not a redraw, so such a tab changes nothing else and does not count as followed.
            tab.history.rename_visits(from, to);
            if !showing && !holds_buffer {
                continue;
            }
            if holds_buffer {
                if let Some(edit) = tab.edit.as_mut() {
                    edit.adopt_path(to.to_path_buf());
                }
            }
            if showing {
                tab.title = leaftext::tab_title_from_path(to);
            }
            // Cached under the old name.
            tab.rendered = None;
            followed = true;
        }
        followed
    }

    /// Open `path` as a tab. If a tab is already showing that document, just activate it; otherwise append a new tab seeded with that document.
    pub(crate) fn open_path(&mut self, path: PathBuf) {
        if let Some(index) = self.tab_showing(&path) {
            self.active = Some(index);
            return;
        }
        self.active = Some(self.push_tab(path));
    }

    /// Open `path` as a tab behind the one being read: same one-tab-per-document rule, but `active` never moves. A document already open is left where it is rather than brought forward — the gesture asked not to be moved.
    pub(crate) fn open_path_behind(&mut self, path: PathBuf) {
        if self.tab_showing(&path).is_none() {
            self.push_tab(path);
        }
    }

    /// The tab already showing `path`, if one is. A tab showing its no-file buffer's name is showing no file at all, so it never answers for one.
    fn tab_showing(&self, path: &Path) -> Option<usize> {
        self.tabs.iter().position(|tab| {
            !tab.shows_untitled_buffer()
                && tab
                    .history
                    .current()
                    .is_some_and(|current| paths_refer_to_same_document(current, path))
        })
    }

    /// Append a tab seeded with `path` and return its index, leaving `active` alone.
    fn push_tab(&mut self, path: PathBuf) -> usize {
        // Reading source and opening another file opens that file in source too. The view is where the reader is working, not a property of the document they picked, so picking one should not throw them out of it.
        let code_view = self
            .active
            .and_then(|index| self.tabs.get(index))
            .is_some_and(|tab| tab.code_view);
        let mut tab = Tab {
            title: leaftext::tab_title_from_path(&path),
            code_view,
            ..Tab::default()
        };
        tab.history.record(path);
        self.tabs.push(tab);
        self.tabs.len() - 1
    }

    /// Open an empty document in a new tab and return the name it wears. The buffer is there from the start, which is what keeps every reader of this tab off a file that does not exist. Never inherits the code view: a blank page is opened to be typed into, not read as source.
    pub(crate) fn open_untitled(&mut self) -> PathBuf {
        let path = self.next_untitled_path();
        let mut tab = Tab {
            title: leaftext::tab_title_from_path(&path),
            edit: Some(EditableDocument::untitled(path.clone())),
            ..Tab::default()
        };
        tab.history.record(path.clone());
        self.tabs.push(tab);
        self.active = Some(self.tabs.len() - 1);
        path
    }

    /// The first `Untitled` name no open tab is already using. Numbered only as far as it has to be, so the usual case is just `Untitled.md`.
    fn next_untitled_path(&self) -> PathBuf {
        for index in 1.. {
            let path = PathBuf::from(match index {
                1 => format!("{UNTITLED_STEM}.md"),
                _ => format!("{UNTITLED_STEM} {index}.md"),
            });
            let taken = self
                .tabs
                .iter()
                .filter_map(|tab| tab.history.current())
                .any(|current| current == &path);
            if !taken {
                return path;
            }
        }
        unreachable!("an unused Untitled name always exists")
    }

    /// Close the tab at `index`, then pick a sensible neighbor as active (or the home screen when no tabs remain). The answer says how much has to be redrawn, because closing a tab beside the one being read changes nothing about that document.
    pub(crate) fn close_tab(&mut self, index: usize) -> TabClose {
        if index >= self.tabs.len() {
            return TabClose::Nothing;
        }
        self.tabs.remove(index);
        if self.tabs.is_empty() {
            self.active = None;
            return TabClose::HomeScreen;
        }
        let was_being_read = self.active == Some(index);
        self.active = match self.active {
            Some(active) if active == index => Some(index.min(self.tabs.len() - 1)),
            Some(active) if active > index => Some(active - 1),
            other => other,
        };
        if was_being_read {
            TabClose::ReaderMoved
        } else {
            TabClose::StripOnly
        }
    }

    /// Move the tab at `from` to `to`, keeping the active tab selected. Returns `false` when an index is out of range or nothing moves.
    pub(crate) fn move_tab(&mut self, from: usize, to: usize) -> bool {
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
    pub(crate) fn set_active(&mut self, index: usize) -> bool {
        if index < self.tabs.len() {
            self.active = Some(index);
            true
        } else {
            false
        }
    }

    /// Show the home screen without closing any tabs.
    pub(crate) fn go_home(&mut self) {
        self.active = None;
    }

    /// Each tab in tab-bar order, for the webview state: its label, its document, and whether that document has unsaved edits.
    pub(crate) fn tab_summaries(&self) -> Vec<TabSummary> {
        self.tabs
            .iter()
            .map(|tab| {
                let current = tab.history.current();
                // Only a buffer belonging to the document this tab is showing says anything about it.
                let edit = current
                    .filter(|path| tab.has_edit_for(path))
                    .and_then(|_| tab.edit.as_ref());
                TabSummary {
                    title: tab.title.clone(),
                    path: current
                        .map(|path| path.display().to_string())
                        .unwrap_or_default(),
                    dirty: edit.is_some_and(EditableDocument::is_dirty),
                    undoable: edit.is_some_and(EditableDocument::can_undo),
                    redoable: edit.is_some_and(EditableDocument::can_redo),
                    untitled: tab.shows_untitled_buffer(),
                }
            })
            .collect()
    }
}

/// What a never-saved document is called until someone saves it somewhere.
pub(crate) const UNTITLED_STEM: &str = "Untitled";

/// What closing a tab did, which is what says how much has to be drawn again. Only the last two change the document on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TabClose {
    /// The index named no tab, so nothing closed and nothing needs drawing.
    Nothing,
    /// A tab beside the one being read went: the strip is shorter and the document on screen is untouched.
    StripOnly,
    /// The tab being read went and a neighbor came forward, so the document on screen is a different one.
    ReaderMoved,
    /// The last tab went, so the home screen is what is left.
    HomeScreen,
}

/// How the reader's scroll position should behave when a render replaces the document view.
#[derive(Clone)]
pub(crate) enum ScrollIntent {
    /// Jump to the top of the freshly rendered document (opening a new file, navigating history, returning home).
    Reset,
    /// Keep the reader exactly where it is. Used when what the document says changes under them (an edit, a save, a rename, the file changing on disk). A change to the tabs around it does not come here at all — it redraws the strip alone. `code` is a 0..1 fraction of the source and is `None` for all but one caller, which is the page's cue to carry the place off the source editor it is about to replace — exacter than any fraction the host holds. A rename sends the tab's own saved fraction instead, because the page refuses its capture when the path moves under it.
    Preserve { code: Option<f64> },
    /// Put the reader back where they were after rendering — a tab switch, or Back and Forward across documents. Both positions are named because a tab showing source restores the editor instead of the page: `anchor` is a place in the rendered document and `None` lands at the top; `code` is a 0..1 fraction of the source and `None` leaves it where the page has it.
    Restore {
        anchor: Option<ScrollAnchor>,
        code: Option<f64>,
    },
}

/// The active tab's index and its current document path, when a document is open.
pub(crate) fn active_tab_path(workspace: &Workspace) -> Option<(usize, PathBuf)> {
    let index = workspace.active?;
    let path = workspace.tabs.get(index)?.history.current()?.clone();
    Some((index, path))
}

/// What a change to the tabs leaves to be drawn, which is the whole difference between a strip that got shorter and a document that changed. Answered as a value rather than done, so a close and a reorder are held by a test with no window to render into.
#[derive(Clone)]
pub(crate) enum TabDraw {
    /// Nothing closed and nothing moved, so nothing is drawn.
    Nothing,
    /// The strip alone: the document on screen is untouched.
    Strip,
    /// A different document is on screen, opened with this intent.
    Render(ScrollIntent),
}

/// What closing the tab at `index` leaves to be drawn. A tab beside the one being read redraws the strip and nothing else, because a render of any intent rereads the file and pushes the whole document back to a page that did not ask for it; the tab coming forward instead opens where it was left, which is the same question a tab switch asks.
pub(crate) fn close_tab_draw(workspace: &mut Workspace, index: usize) -> TabDraw {
    match workspace.close_tab(index) {
        TabClose::Nothing => TabDraw::Nothing,
        TabClose::StripOnly => TabDraw::Strip,
        TabClose::ReaderMoved => {
            TabDraw::Render(restore_front_tab_intent(workspace).unwrap_or(ScrollIntent::Reset))
        }
        TabClose::HomeScreen => TabDraw::Render(ScrollIntent::Reset),
    }
}

/// What dragging a tab from one slot to another leaves to be drawn, which is only ever the strip. The page has already put the tab in its slot; this is the host agreeing. The title, the image folder and Back/Forward all describe the active document, which a reorder never changes — and a full render would reread the file and rebuild a source editor at the top of it.
pub(crate) fn move_tab_draw(workspace: &mut Workspace, from: usize, to: usize) -> TabDraw {
    if workspace.move_tab(from, to) {
        TabDraw::Strip
    } else {
        TabDraw::Nothing
    }
}

/// The intent a followed rename renders with, or nothing where no tab was on the file. The file moved under whatever tab is sitting on it, so the tab moves with it and redraws under the new name — and this is the one in-place render that names a source place, because the page will not spend the place it captured off the editor it is replacing once the document's path has moved. The tab's own saved fraction goes instead.
pub(crate) fn followed_rename_intent(
    workspace: &mut Workspace,
    from: &Path,
    to: &Path,
) -> Option<ScrollIntent> {
    workspace
        .follow_rename(from, to)
        .then(|| ScrollIntent::Preserve {
            code: workspace.front_saved_code_scroll_for(to),
        })
}

/// What an export is: the chosen format, the size the page measured itself at, and the document that names the file the save dialog suggests. Nothing of that document is read or written, which is why the home screen exports too.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PageExport {
    pub(crate) document: Option<PathBuf>,
    pub(crate) format: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// The export the page asked for, with the open document read for its name and nothing else.
pub(crate) fn page_export_request(
    workspace: &Workspace,
    format: String,
    width: f64,
    height: f64,
) -> PageExport {
    PageExport {
        document: workspace.active_path().map(Path::to_path_buf),
        format,
        width,
        height,
    }
}
