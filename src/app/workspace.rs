//! Open tabs and the document each one shows.

use super::*;

/// One open document tab: its own back/forward history, scroll history, and a
/// cached title used to label the tab even while it is not the active tab.
#[derive(Debug, Default)]
pub(crate) struct Tab {
    pub(crate) history: DocumentHistory,
    pub(crate) scroll_history: ScrollHistory,
    pub(crate) title: String,
    pub(crate) saved_scroll_anchor: Option<ScrollAnchor>,
    /// Where the code view was scrolled when this tab was last left, as a 0..1
    /// fraction of the scrollable range. Restored on return so switching tabs
    /// keeps the source editor's place, the way `saved_scroll_anchor` does for
    /// the reading view. `None` until the tab has been left while in code view.
    pub(crate) saved_code_scroll: Option<f64>,
    /// The editable source buffer, created on first edit and kept so unsaved
    /// edits survive view toggles and tab switches. `None` until edited. The
    /// authoritative copy a save writes and the reading view re-renders from.
    pub(crate) edit: Option<EditableDocument>,
    /// Whether this tab is currently showing the raw-source code view rather
    /// than the rendered reading view.
    pub(crate) code_view: bool,
    /// The last render of this tab's document from disk, reused on a switch
    /// while the contents still hash the same. The hash check is what admits
    /// it, so a stale entry is re-rendered over, never shown.
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

impl Tab {
    /// Whether this tab holds an edit buffer for `path` specifically. A tab
    /// navigates across documents, but its edit buffer belongs to one file.
    pub(crate) fn has_edit_for(&self, path: &Path) -> bool {
        self.edit
            .as_ref()
            .is_some_and(|edit| paths_refer_to_same_document(&edit.path, path))
    }

    /// Whether starting an edit of `path` needs the file read from disk first:
    /// true when there is no buffer, or the buffer is for a different document.
    pub(crate) fn needs_edit_seed(&self, path: &Path) -> bool {
        !self.has_edit_for(path)
    }

    /// The edit buffer for `path`, seeded from `contents` when there's no buffer
    /// yet. Re-editing the same document reuses it; a different document replaces it.
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

/// The set of open tabs plus which one is active. `active` is `None` when the
/// home screen is showing; the tabs stay open so the user can return to them.
#[derive(Debug, Default)]
pub(crate) struct Workspace {
    pub(crate) tabs: Vec<Tab>,
    pub(crate) active: Option<usize>,
}

impl Workspace {
    /// The document on screen, or `None` on the home screen. Asked by everything
    /// that has to know what the reader is actually looking at — the watcher, and
    /// what a graph is a map of — so it is answered in one place rather than by
    /// each of them walking `active` into `tabs` into `history` again.
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

    /// Open `path` as a tab. If a tab is already showing that document, just
    /// activate it; otherwise append a new tab seeded with that document.
    pub(crate) fn open_path(&mut self, path: PathBuf) {
        if let Some(index) = self.tabs.iter().position(|tab| {
            tab.history
                .current()
                .is_some_and(|current| paths_refer_to_same_document(current, &path))
        }) {
            self.active = Some(index);
            return;
        }

        // Reading source and opening another file opens that file in source
        // too. The view is where the reader is working, not a property of the
        // document they picked, so picking one should not throw them out of it.
        let code_view = self
            .active
            .and_then(|index| self.tabs.get(index))
            .is_some_and(|tab| tab.code_view);
        let mut tab = Tab {
            title: tab_title_from_path(&path),
            code_view,
            ..Tab::default()
        };
        tab.history.record(path);
        self.tabs.push(tab);
        self.active = Some(self.tabs.len() - 1);
    }

    /// Close the tab at `index`, then pick a sensible neighbor as active (or
    /// the home screen when no tabs remain).
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

    /// Move the tab at `from` to `to`, keeping the active tab selected. Returns
    /// `false` when an index is out of range or nothing moves.
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

/// Fallback tab label (file stem) used until the document title is known.
pub(crate) fn tab_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string())
}

/// How the reader's scroll position should behave when a render replaces the
/// document view.
#[derive(Clone)]
pub(crate) enum ScrollIntent {
    /// Jump to the top of the freshly rendered document (opening a new file,
    /// navigating history, returning home).
    Reset,
    /// Keep the reader exactly where it is. Used when the active document does
    /// not change, only its surroundings (e.g. reordering tabs).
    Preserve,
    /// Restore a saved anchor after rendering (switching tabs). `None` lands at
    /// the top, used the first time a tab is visited.
    Restore(Option<ScrollAnchor>),
}

/// The active tab's index and its current document path, when a document is open.
pub(crate) fn active_tab_path(workspace: &Workspace) -> Option<(usize, PathBuf)> {
    let index = workspace.active?;
    let path = workspace.tabs.get(index)?.history.current()?.clone();
    Some((index, path))
}
