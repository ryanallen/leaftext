//! The vault store, and the parsers that go with it.
//!
//! There is no index here and no crawl. The library pane reads one folder off the disk at a time; the graph and search read the active vault's text into memory once and share it. What is left is a small SQLite database holding which folders are vaults and which one is open, plus two parsers — frontmatter and document links — that only ever needed text, never a table.

mod db;
mod frontmatter;
mod links;
mod obsidian_types;
mod remote_files;
mod saved_views;
mod vaults;

// Re-exported so `store::x` reaches every public item, wherever it lives.
pub use db::*;
pub use frontmatter::*;
pub use links::*;
pub use obsidian_types::*;
pub use remote_files::*;
pub use saved_views::*;
pub use vaults::*;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
#[cfg(feature = "desktop")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(feature = "desktop")]
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;

use crate::DocumentFormat;

/// Latest applied schema migration, checked against what a freshly opened database actually recorded. 1–4 were the crawl's: files, headings, chunks, full-text search, frontmatter and links, all of them a manifest of the whole computer. They are gone; 5 is the vaults, 6 dropped the crawl, 7 gave a vault a kind and a remote vault somewhere to record what it copied down, and 8 records its automatic GitHub sync choice.
#[cfg(feature = "desktop")]
pub(super) const SCHEMA_VERSION: i64 = 9;

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/// A node in the library tree: a folder or a document. All strings are file-derived and untrusted; the frontend escapes them before the DOM.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    pub title: Option<String>,
    pub children: Vec<FileTreeNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Folder,
    File,
}

/// The link graph: one node per document *and per web address linked to*, one undirected edge per resolved link. `path` is the node identity the frontend opens by — a file path, or the URL itself for an external node. All strings are file-derived and untrusted; the frontend escapes them.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Whether documents were left out: the vault ran past the corpus cap, or the requested size capped it.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub path: String,
    pub label: String,
    /// The other names the document answers to. The node is still labeled with the file's name — a node labeled with an alias is one you cannot find by the name on disk — so these show when you hover it.
    pub aliases: Vec<String>,
    pub degree: u32,
    /// A web address rather than one of your documents. Drawn hollow, labeled by domain, and opened in the browser instead of in a tab — so the map can show what a document points *out* at without pretending it is a file you have.
    pub external: bool,
}

/// One line on the map, pointing from the document that wrote the link to the thing it linked. `mutual` when each end links the other: one line with a head at both ends, rather than two lying on top of each other.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub mutual: bool,
}

/// What slice of the link graph to draw. `focus` keeps only the seed documents and their direct neighbors (the "Focus" scope); otherwise `limit` caps to the densest N documents (`None` = all).
#[derive(Debug, Clone, Default)]
pub struct GraphRequest {
    pub focus: Option<Vec<String>>,
    pub limit: Option<usize>,
}

/// One search result. Every string is file-derived and untrusted; the frontend escapes it before the DOM.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub abs_path: String,
    pub title: String,
    /// The other name this document answered to, when that is what matched. The row still shows the file's name; this says why it is in the list.
    pub alias: Option<String>,
    pub start_line: u32,
    pub end_line: u32,
    pub anchor: Option<String>,
    pub snippet: String,
    pub score: f64,
}

/// One query's answer. `truncated` is set when there were more matches than the cap, so the page can say the list was cut instead of printing a count that reads the same as a query matching exactly that many.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    /// Every path that matched, not just the fifty shown. Never sent to the page — it is what lets the next keystroke scan these documents instead of the vault, because a longer query can only ever match fewer of them.
    pub matched: Vec<String>,
    /// The query read back in words, shown under the box. Empty for a query of plain words, which needs no explaining.
    pub understood: String,
    /// Field names the query used that no document in the vault sets. Such a filter can only ever match nothing, so the box says which name it did not know rather than showing an empty list.
    pub unknown_fields: Vec<String>,
    /// Folders under the vault the read did not descend into because they hold generated files, named from the root down. The count line says how many and carries the names, so a vault that read three quarters of itself says so.
    pub skipped: Vec<String>,
}

// ---------------------------------------------------------------------------
// Errors / small helpers
// ---------------------------------------------------------------------------

#[cfg(feature = "desktop")]
pub(super) type DbResult<T> = Result<T, String>;

#[cfg(feature = "desktop")]
pub(super) fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

#[cfg(feature = "desktop")]
pub(super) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The database path inside the app data directory. Still called the manifest for the installs that already have one; it holds only vaults now.
pub fn manifest_path(data_dir: &Path) -> PathBuf {
    data_dir.join("manifest.db")
}

pub(super) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// The IO-time path. On Windows the `\\?\` extended-length prefix keeps `read_dir`/`metadata`/`read` working on paths over 260 chars. IO-only: stored and user-facing paths use the normal form.
#[cfg(windows)]
pub(super) fn io_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if text.starts_with(r"\\?\") || text.starts_with(r"\\") {
        // Already verbatim, or a UNC share we leave as-is.
        return path.to_path_buf();
    }
    let bytes = text.as_bytes();
    // Drive-absolute like `C:\...`.
    if bytes.len() >= 2 && bytes[1] == b':' {
        // A verbatim path is handed to the filesystem unparsed, so a forward slash in one is a character in a name rather than a separator and the walk stops at the first folder.
        let text = text.replace('/', r"\");
        return PathBuf::from(format!(r"\\?\{text}"));
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
pub(super) fn io_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// OS directories skipped directly under a drive root, where the name is known to be system-owned. A folder named `Library` deep in user content is left alone.
const SYSTEM_DIRS: &[&str] = &[
    "Library",
    "AppData",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "System Volume Information",
    "$RECYCLE.BIN",
    "proc",
    "sys",
];

pub(super) fn is_system_dir(name: &str) -> bool {
    SYSTEM_DIRS.contains(&name)
}

/// Whether a directory is a reparse point (symlink or, on Windows, a junction). Following these causes loops and access errors, so they are not descended. A directory we cannot stat is treated as a reparse point (do not descend).
pub(super) fn is_dir_reparse(path: &Path) -> bool {
    match std::fs::symlink_metadata(io_path(path)) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return true;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
                if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return true;
                }
            }
            false
        }
        Err(_) => true,
    }
}

/// The label for a drive root, e.g. `C:\` -> `C:`, `/` -> `/`.
pub(super) fn root_label(root: &str) -> String {
    let trimmed = root.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests;
