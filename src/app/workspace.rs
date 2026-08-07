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

impl Workspace {
    /// The document on screen, or `None` on the home screen. Asked by everything that has to know what the reader is actually looking at — the watcher, and what a graph is a map of — so it is answered in one place rather than by each of them walking `active` into `tabs` into `history` again.
    pub(crate) fn active_path(&self) -> Option<&Path> {
        self.active
            .and_then(|index| self.tabs.get(index))
            .and_then(|tab| tab.history.current())
            .map(PathBuf::as_path)
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

    /// The tab already showing `path`, if one is.
    fn tab_showing(&self, path: &Path) -> Option<usize> {
        self.tabs.iter().position(|tab| {
            tab.history
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

    /// `(title, path)` for each tab, in tab-bar order, for the webview state.
    pub(crate) fn tab_summaries(&self) -> Vec<(String, String)> {
        self.tabs
            .iter()
            .map(|tab| {
                let path = tab
                    .history
                    .current()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default();
                (tab.title.clone(), path)
            })
            .collect()
    }
}

/// What a never-saved document is called until someone saves it somewhere.
pub(crate) const UNTITLED_STEM: &str = "Untitled";

/// Fallback tab label (file stem) used until the document title is known.
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
