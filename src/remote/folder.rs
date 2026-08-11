//! A source that is just another folder on this disk.
//!
//! It proves the copy, the pointer file and the path contract with no network, no account and nothing that can rate-limit — which is everything a real source does except talk to an API. An id here is the path relative to the folder the source was rooted at, so it is stable across a listing and means nothing outside this source, exactly like the ids a service hands out.

use std::path::{Path, PathBuf};

use super::{failed, RemoteEntry, RemoteEntryKind, RemoteError, RemoteResult, RemoteSource};

/// A folder on this machine, read through the same four questions every other source answers.
pub struct FolderSource {
    root: PathBuf,
}

impl FolderSource {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The path an id names. An id that climbs out of the root is refused rather than followed: this source is asked for ids it handed out, and anything else is a bug or a lie.
    fn path_for(&self, id: &str) -> RemoteResult<PathBuf> {
        if id.is_empty() {
            return Ok(self.root.clone());
        }
        let candidate = self.root.join(id);
        if !candidate.starts_with(&self.root)
            || candidate
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(RemoteError::Failed(format!("{id} is not in this folder")));
        }
        Ok(candidate)
    }

    /// The id for a path under the root: its place inside the folder, in one spelling, so the same file is the same id on either platform.
    fn id_for(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
}

impl RemoteSource for FolderSource {
    fn source_name(&self) -> &str {
        "folder"
    }

    fn list(&self, folder: &str) -> RemoteResult<Vec<RemoteEntry>> {
        let dir = self.path_for(folder)?;
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(failed)? {
            let entry = entry.map_err(failed)?;
            let path = entry.path();
            let meta = entry.metadata().map_err(failed)?;
            // A symlink is not followed, for the same reason the library pane does not follow one: it is a loop waiting to happen and a way out of the folder somebody pointed at.
            if meta.file_type().is_symlink() {
                continue;
            }
            entries.push(RemoteEntry {
                id: self.id_for(&path),
                name: entry.file_name().to_string_lossy().to_string(),
                kind: if meta.is_dir() {
                    RemoteEntryKind::Folder
                } else {
                    RemoteEntryKind::File
                },
                // A modified time is this source's version stamp. Like every other source's it is compared and never parsed.
                version: meta
                    .modified()
                    .ok()
                    .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|since| since.as_nanos().to_string()),
                size: meta.is_file().then(|| meta.len()),
            });
        }
        // Read order off a disk is the filesystem's business, and a mirror that lands in a different order every pass is one nothing can be compared against.
        entries.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(entries)
    }

    fn fetch(&self, id: &str, into: &Path) -> RemoteResult<()> {
        let from = self.path_for(id)?;
        if let Some(parent) = into.parent() {
            std::fs::create_dir_all(parent).map_err(failed)?;
        }
        std::fs::copy(&from, into).map_err(failed)?;
        Ok(())
    }

    /// Send a document back, unless this folder has moved on since it was read.
    ///
    /// The stamp is checked before a byte is written, and a difference stops the write rather than merging it: the two versions are both somebody's work, and the one thing that must not happen is one of them disappearing without anyone being asked.
    fn push(&self, path: &Path, id: &str, base_version: Option<&str>) -> RemoteResult<String> {
        let target = self.path_for(id)?;
        if let Some(base) = base_version {
            if let Some(now) = version_of(&target) {
                if now != base {
                    return Err(RemoteError::Moved);
                }
            }
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(failed)?;
        }
        std::fs::copy(path, &target).map_err(failed)?;
        version_of(&target)
            .ok_or_else(|| RemoteError::Failed("the copy went nowhere readable".to_string()))
    }
}

/// This source's version stamp for a file: its modified time. Compared for equality, never parsed, exactly like the stamps a real service hands out.
fn version_of(path: &Path) -> Option<String> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|since| since.as_nanos().to_string())
}
