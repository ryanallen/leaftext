//! Back/forward, and the scroll position each entry remembers.

use super::*;

#[derive(Debug, Default)]
pub(crate) struct DocumentHistory {
    pub(crate) entries: Vec<PathBuf>,
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
        self.index.and_then(|index| self.entries.get(index))
    }

    pub(crate) fn record(&mut self, path: PathBuf) {
        if self.current() == Some(&path) {
            return;
        }

        if let Some(index) = self.index {
            self.entries.truncate(index + 1);
        }
        self.entries.push(path);
        self.index = Some(self.entries.len() - 1);
    }

    pub(crate) fn back_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        index
            .checked_sub(1)
            .and_then(|previous| self.entries.get(previous))
    }

    pub(crate) fn forward_target(&self) -> Option<&PathBuf> {
        let index = self.index?;
        self.entries.get(index + 1)
    }

    pub(crate) fn go_back(&mut self) {
        if let Some(index) = self.index.and_then(|index| index.checked_sub(1)) {
            self.index = Some(index);
        }
    }

    /// Remove the current entry (e.g. it failed to open) and fall back to the
    /// previous document. Returns whether an entry remains to show; `false`
    /// means the history is now empty and the tab should be closed.
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
