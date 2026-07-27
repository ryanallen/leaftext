//! The library pane's files, read straight off the disk.
//!
//! The pane shows one folder at a time, so it reads one folder at a time. No
//! index, no crawl, nothing to go stale — listing a directory is the whole job,
//! and it costs the same whether the folder sits in a vault or at the top of a
//! drive. Nothing is walked that nobody opened.
//!
//! The top level is the vault's own folder, or — with no vault — the drive
//! roots, which is what "Library" has always shown.

use crate::indexer::{
    detect_roots, is_dir_reparse, is_system_dir, path_to_string, root_label, FileTreeNode, NodeKind,
};

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Directories never listed: build output and vendored code. Anything hidden (a
/// leading dot) is skipped too. None of it is what someone opened the pane to
/// read.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "Pods",
    "__pycache__",
];

/// One step of the trail between the root and the folder on screen. The root
/// itself is not here — that is the switcher's crumb.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCrumb {
    pub name: String,
    pub path: String,
}

/// What the pane needs to draw itself: where it is, how it got there, and what
/// is in front of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    /// The folder shown, or empty at the top level.
    pub path: String,
    pub chain: Vec<FolderCrumb>,
    pub entries: Vec<FileTreeNode>,
}

/// List one folder. `root` is the active vault's folder, or `None` for the whole
/// library; `path` is the folder being opened, or empty for the top level.
///
/// A `path` that has gone missing, or that sits outside the active vault (the
/// vault changed under it), falls back to the top rather than to an empty pane.
pub fn read_folder_listing(root: Option<&Path>, path: &str) -> FolderListing {
    match resolve_folder(root, path) {
        Some(dir) => FolderListing {
            path: path_to_string(&dir),
            chain: chain_to(root, &dir),
            entries: read_entries(&dir),
        },
        // No vault and no folder: the drive roots, which is the top of the
        // library and the one listing that is not a directory read.
        None => FolderListing {
            path: String::new(),
            chain: Vec::new(),
            entries: drive_root_entries(),
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

/// One directory's immediate children: the folders you can open, and the
/// documents you can read. Nothing below them is touched — that is the point.
fn read_entries(dir: &Path) -> Vec<FileTreeNode> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    // A drive root carries the OS's own furniture, which the crawl has always
    // skipped by the same rule: only directly under a root, where the name is
    // known to be system-owned.
    let at_drive_root = dir.parent().is_none();

    let mut folders: Vec<FileTreeNode> = Vec::new();
    let mut files: Vec<FileTreeNode> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        if file_type.is_dir() {
            if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            if at_drive_root && is_system_dir(&name) {
                continue;
            }
            // A junction or symlink can point back up its own tree.
            if is_dir_reparse(&path) {
                continue;
            }
            folders.push(FileTreeNode {
                name,
                path: path_to_string(&path),
                kind: NodeKind::Folder,
                title: None,
                children: Vec::new(),
            });
        } else if file_type.is_file() && crate::is_supported_document_path(&path) {
            files.push(FileTreeNode {
                name,
                path: path_to_string(&path),
                kind: NodeKind::File,
                title: None,
                children: Vec::new(),
            });
        }
    }

    // Folders first, then documents, each alphabetical.
    let by_name =
        |a: &FileTreeNode, b: &FileTreeNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    folders.sort_by(by_name);
    files.sort_by(by_name);
    folders.extend(files);
    folders
}
