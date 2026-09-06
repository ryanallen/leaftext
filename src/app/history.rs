//! Back/forward, and the scroll position each entry remembers.

use super::*;

/// One step in a tab's back/forward list: a document, and where the reader was on it when they left. `anchor` is `None` until they leave, so a document never left lands at the top.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct DocumentVisit {
    pub(crate) path: PathBuf,
    pub(crate) anchor: Option<ScrollAnchor>,
}

#[derive(Debug, Default)]
pub(crate) struct DocumentHistory {
    pub(crate) entries: Vec<DocumentVisit>,
    pub(crate) index: Option<usize>,
}

#[derive(Debug, Default)]
pub(crate) struct ScrollHistory {
    pub(crate) back_entries: Vec<ScrollAnchor>,
    pub(crate) forward_entries: Vec<ScrollAnchor>,
}

impl ScrollHistory {
    pub(crate) fn record(&mut self, anchor: ScrollAnchor) {
        self.back_entries.push(anchor);
        self.forward_entries.clear();
    }

    pub(crate) fn back(&mut self, current: ScrollAnchor) -> Option<ScrollAnchor> {
        let previous = self.back_entries.pop()?;
        self.forward_entries.push(current);
        Some(previous)
    }

    pub(crate) fn forward(&mut self, current: ScrollAnchor) -> Option<ScrollAnchor> {
        let next = self.forward_entries.pop()?;
        self.back_entries.push(current);
        Some(next)
    }

    pub(crate) fn clear(&mut self) {
        self.back_entries.clear();
        self.forward_entries.clear();
    }

    pub(crate) fn can_go_back(&self) -> bool {
        !self.back_entries.is_empty()
    }

    pub(crate) fn can_go_forward(&self) -> bool {
        !self.forward_entries.is_empty()
    }
}

impl DocumentHistory {
    pub(crate) fn current(&self) -> Option<&PathBuf> {
        self.index
            .and_then(|index| self.entries.get(index))
            .map(|entry| &entry.path)
    }

    /// Where the reader was on the document now showing, if they have ever left it. `None` lands at the top.
    pub(crate) fn current_anchor(&self) -> Option<ScrollAnchor> {
        self.index
            .and_then(|index| self.entries.get(index))
            .and_then(|entry| entry.anchor.clone())
    }

    /// Where the reader was on `path`, out of this tab's latest visit to it — asked by the close when a tab's unsaved words belong to a document it has since followed a link out of. Searched back from the document showing, so a tab that was on one document twice keeps the later place.
    pub(crate) fn anchor_for(&self, path: &Path) -> Option<ScrollAnchor> {
        let index = self.index?;
        self.entries
            .get(..=index)?
            .iter()
            .rev()
            .find(|entry| paths_refer_to_same_document(&entry.path, path))
            .and_then(|entry| entry.anchor.clone())
    }

    /// Remember where the reader was on the document now showing, before a navigation takes them off it. The one place a position is written, so every navigation stamps the same thing.
    pub(crate) fn stamp_current(&mut self, anchor: ScrollAnchor) {
        if let Some(entry) = self.index.and_then(|index| self.entries.get_mut(index)) {
            entry.anchor = Some(anchor);
        }
    }

    /// Add a visit to this tab, under the one spelling the favorites and recents are kept in. Normalized here rather than at each caller because a path arrives from the command line spelled however it was typed, and the page decides whether the tab wears a filled heart by comparing that string with a favorite exactly.
    pub(crate) fn record(&mut self, path: PathBuf) {
        let path = normalize_document_path(&path);
        if self.current() == Some(&path) {
            return;
        }

        if let Some(index) = self.index {
            self.entries.truncate(index + 1);
        }
        self.entries.push(DocumentVisit { path, anchor: None });
        self.index = Some(self.entries.len() - 1);
    }

    /// Rename every step naming `from` across to `to`, after the file itself has been renamed — back and forward alike, since both live in this one list. A step left wearing the old name can only fail when the reader presses onto it. The path alone is written, so each step keeps the place it remembers, and no step is added or removed.
    pub(crate) fn rename_visits(&mut self, from: &Path, to: &Path) {
        for entry in &mut self.entries {
            if paths_refer_to_same_document(&entry.path, from) {
                entry.path = to.to_path_buf();
            }
        }
    }

    /// Rename the current entry in place — the untitled document that has just been given a file. Not a navigation: Back must not gain a step to a name nothing was ever at.
    pub(crate) fn replace_current(&mut self, path: PathBuf) {
        if let Some(entry) = self.index.and_then(|index| self.entries.get_mut(index)) {
            entry.path = path;
        }
    }

    pub(crate) fn back_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        index
            .checked_sub(1)
            .and_then(|previous| self.entries.get(previous))
            .map(|entry| &entry.path)
    }

    pub(crate) fn forward_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        self.entries.get(index + 1).map(|entry| &entry.path)
    }

    pub(crate) fn go_back(&mut self) {
        if let Some(index) = self.index.and_then(|index| index.checked_sub(1)) {
            self.index = Some(index);
        }
    }

    /// Remove the current entry (e.g. it failed to open) and fall back to the previous document. Returns whether an entry remains to show; `false` means the history is now empty and the tab should be closed.
    pub(crate) fn forget_current(&mut self) -> bool {
        let Some(index) = self.index else {
            return false;
        };
        self.entries.remove(index);
        if self.entries.is_empty() {
            self.index = None;
            false
        } else {
            self.index = Some(index.saturating_sub(1).min(self.entries.len() - 1));
            true
        }
    }

    pub(crate) fn go_forward(&mut self) {
        if let Some(index) = self.index.filter(|index| index + 1 < self.entries.len()) {
            self.index = Some(index + 1);
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn clear(&mut self) {
        self.entries.clear();
        self.index = None;
    }

    pub(crate) fn can_go_back(&self) -> bool {
        self.back_target().is_some()
    }

    pub(crate) fn can_go_forward(&self) -> bool {
        self.forward_target().is_some()
    }
}
