//! The library pane's files, read straight off the disk.
//!
//! The pane shows one folder at a time, so it reads one folder at a time. No index, no crawl, nothing to go stale — listing a directory is the whole job, and it costs the same whether the folder sits in a vault or at the top of a drive. Nothing is walked that nobody opened.
//!
//! The top level is the vault's own folder, or — with no vault — the drive roots.

use crate::store::{
    detect_roots, is_system_dir, path_to_string, root_label, FileTreeNode, NodeKind,
};

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// One step of the trail between the root and the folder on screen. The root itself is not here — that is the switcher's crumb.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCrumb {
    pub name: String,
    pub path: String,
}

/// What the pane needs to draw itself: where it is, how it got there, and what is in front of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    /// The folder shown, or empty at the top level.
    pub path: String,
    pub chain: Vec<FolderCrumb>,
    pub entries: Vec<FileTreeNode>,
    /// Files in the folder the app cannot read, so an empty pane can say why it is empty instead of looking like a folder that lost its files.
    pub skipped_files: usize,
}

/// List one folder. `root` is the active vault's folder, or `None` for the whole library; `path` is the folder being opened, or empty for the top level.
///
/// A `path` that has gone missing, or that sits outside the active vault (the vault changed under it), falls back to the top rather than to an empty pane.
pub fn read_folder_listing(root: Option<&Path>, path: &str) -> FolderListing {
    match resolve_folder(root, path) {
        Some(dir) => {
            let (entries, skipped_files) = read_entries(&dir);
            FolderListing {
                path: path_to_string(&dir),
                chain: chain_to(root, &dir),
                entries,
                skipped_files,
            }
        }
        // No vault and no folder: the drive roots, which is the top of the library and the one listing that is not a directory read.
        None => FolderListing {
            path: String::new(),
            chain: Vec::new(),
            entries: drive_root_entries(),
            skipped_files: 0,
        },
    }
}

/// Which directory to read, or `None` for the drive roots.
fn resolve_folder(root: Option<&Path>, path: &str) -> Option<PathBuf> {
    if !path.is_empty() {
        let dir = PathBuf::from(path);
        let inside_vault = root.is_none_or(|root| dir.starts_with(root));
        if inside_vault && dir.is_dir() {
            return Some(dir);
        }
    }
    // Empty, gone, or out of the vault: the top level.
    root.filter(|root| root.is_dir()).map(Path::to_path_buf)
}

/// The folders between the root and `dir`, outermost first. Empty at the root.
fn chain_to(root: Option<&Path>, dir: &Path) -> Vec<FolderCrumb> {
    let mut stack: Vec<PathBuf> = Vec::new();
    let mut current = Some(dir);
    while let Some(folder) = current {
        // The vault's own folder is the switcher's crumb, not a step in the trail.
        if root.is_some_and(|root| folder == root) {
            break;
        }
        stack.push(folder.to_path_buf());
        current = match folder.parent() {
            // `C:\`'s parent is `C:\`; without this the walk never ends.
            Some(parent) if parent != folder => Some(parent),
            _ => None,
        };
    }
    stack.reverse();
    stack
        .iter()
        .map(|folder| FolderCrumb {
            name: crumb_label(folder),
            path: path_to_string(folder),
        })
        .collect()
}

/// A folder's name, or its whole path for a drive root, which has none.
fn crumb_label(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root_label(&path_to_string(folder)))
}

/// The drives, as the top level of the whole library.
fn drive_root_entries() -> Vec<FileTreeNode> {
    detect_roots()
        .into_iter()
        .map(|root| FileTreeNode {
            name: root_label(&path_to_string(&root)),
            path: path_to_string(&root),
            kind: NodeKind::Folder,
            title: None,
            children: Vec::new(),
        })
        .collect()
}

/// One directory's immediate children: the folders you can open, and the documents you can read. Nothing below them is touched — that is the point.
///
/// Also how many files it left out, which is the only thing the pane can say when it draws nothing. Every folder is listed — a leading dot, a build name, a junction. Guards against a runaway walk belong where a walk runs: this reads one directory and descends nowhere, and `vault_corpus.rs`, which does descend, keeps its junction guard.
fn read_entries(dir: &Path) -> (Vec<FileTreeNode>, usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        // A folder that cannot be read skipped nothing; it was never opened.
        return (Vec::new(), 0);
    };
    // A drive root carries the OS's own furniture. Skipped only directly under a root, where the name is known to be system-owned.
    let at_drive_root = dir.parent().is_none();

    let mut folders: Vec<FileTreeNode> = Vec::new();
    let mut files: Vec<FileTreeNode> = Vec::new();
    let mut skipped = 0usize;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        // A junction or symlink is neither a folder nor a file to the directory entry; whatever it points at is. `None` is a link pointing nowhere, which is the one thing here that cannot be listed.
        let is_folder = if file_type.is_symlink() {
            fs::metadata(&path).ok().map(|meta| meta.is_dir())
        } else if file_type.is_dir() {
            Some(true)
        } else if file_type.is_file() {
            Some(false)
        } else {
            None
        };

        if is_folder == Some(true) {
            if at_drive_root && is_system_dir(&name) {
                continue;
            }
            folders.push(FileTreeNode {
                name,
                path: path_to_string(&path),
                kind: NodeKind::Folder,
                title: None,
                children: Vec::new(),
            });
        } else if is_folder == Some(false) {
            if crate::is_supported_document_path(&path) {
                files.push(FileTreeNode {
                    name,
                    path: path_to_string(&path),
                    kind: NodeKind::File,
                    title: None,
                    children: Vec::new(),
                });
            } else {
                skipped += 1;
            }
        }
    }

    // Folders first, then documents, each alphabetical.
    let by_name =
        |a: &FileTreeNode, b: &FileTreeNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    folders.sort_by(by_name);
    files.sort_by(by_name);
    folders.extend(files);
    (folders, skipped)
}
