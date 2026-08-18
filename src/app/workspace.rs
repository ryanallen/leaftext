//! Open tabs and the document each one shows.

use super::*;

/// One open document tab: its own back/forward history, scroll history, and a cached title used to label the tab even while it is not the active tab.
#[derive(Debug, Default)]
pub(crate) struct Tab {
    pub(crate) history: DocumentHistory,
    pub(crate) scroll_history: ScrollHistory,
    pub(crate) title: String,
    /// Where the code view was scrolled when this tab was last left, as a 0..1 fraction of the scrollable range, so switching tabs keeps the source editor's place. On the tab rather than on the history entry beside it: a fraction of a source buffer is not a block in a rendered document. `None` until the tab has been left while in code view.
    pub(crate) saved_code_scroll: Option<f64>,
    /// The editable source buffer, created on first edit and kept so unsaved edits survive view toggles and tab switches. `None` until edited. The authoritative copy a save writes and the reading view re-renders from.
    pub(crate) edit: Option<EditableDocument>,
    /// Whether this tab is currently showing the raw-source code view rather than the rendered reading view.
    pub(crate) code_view: bool,
    /// The last render of this tab's document from disk, reused on a switch while the contents still hash the same. The hash check is what admits it, so a stale entry is re-rendered over, never shown.
    pub(crate) rendered: Option<RenderedCache>,
}

/// See [`Tab::rendered`].
#[derive(Debug)]
pub(crate) struct RenderedCache {
    pub(crate) path: PathBuf,
    /// [`content_hash`] of the source the document was rendered from.
    pub(crate) hash: u64,
    pub(crate) document: OpenedDocument,
}

impl RenderedCache {
    /// Whether this entry answers for `path` at `hash`. The path check matters: two files can hold identical text, and a render carries the folder its images resolve against.
    pub(crate) fn answers_for(&self, path: &Path, hash: u64) -> bool {
        self.hash == hash && paths_refer_to_same_document(&self.path, path)
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

    /// The edit buffer for `path`, seeded from `contents` when there's no buffer yet. Re-editing the same document reuses it; a different document replaces it.
    pub(crate) fn edit_buffer(
        &mut self,
        path: &Path,
        contents: SourceText,
    ) -> &mut EditableDocument {
        if self.needs_edit_seed(path) {
            self.edit = Some(EditableDocument::new(path.to_path_buf(), contents));
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
            let Some(path) = tab.history.current().cloned() else {
                continue;
            };
            // Only a buffer belonging to the document this tab is showing: a tab that navigated on can still hold one for where it has been, and that is not what reopening this tab would put on screen.
            let unsaved = carry_unsaved
                .then(|| tab.edit.as_ref())
                .flatten()
                .filter(|edit| edit.is_dirty() && tab.has_edit_for(&path));
            let untitled = tab.edit.as_ref().is_some_and(|edit| edit.untitled);
            // A note with no file is only worth an entry where the entry carries its own words: there is nothing to reopen. That is one test, not two — an untitled buffer's saved baseline is the empty note it opened as, so dirty on one means exactly that something was typed into it.
            if untitled && unsaved.is_none() {
                continue;
            }
            if self.active == Some(index) {
                active = Some(tabs.len());
            }
            tabs.push(SessionTab {
                path,
                title: tab.title.clone(),
                code_view: tab.code_view,
                anchor: tab.history.current_anchor(),
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

    /// Close the tab at `index`, then pick a sensible neighbor as active (or the home screen when no tabs remain).
    pub(crate) fn close_tab(&mut self, index: usize) {
        if index >= self.tabs.len() {
            return;
        }
        self.tabs.remove(index);
        if self.tabs.is_empty() {
            self.active = None;
            return;
        }
        self.active = match self.active {
            Some(active) if active == index => Some(index.min(self.tabs.len() - 1)),
            Some(active) if active > index => Some(active - 1),
            other => other,
        };
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
                }
            })
            .collect()
    }
}

/// What a never-saved document is called until someone saves it somewhere.
pub(crate) const UNTITLED_STEM: &str = "Untitled";

/// How the reader's scroll position should behave when a render replaces the document view.
#[derive(Clone)]
pub(crate) enum ScrollIntent {
    /// Jump to the top of the freshly rendered document (opening a new file, navigating history, returning home).
    Reset,
    /// Keep the reader exactly where it is. Used when the active document does not change, only its surroundings (e.g. reordering tabs).
    Preserve,
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
