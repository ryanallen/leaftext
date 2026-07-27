//! Local Markdown indexer.
//!
//! A background worker crawls the device for Markdown files, stores a manifest
//! in SQLite at `{APP_DATA_DIR}/manifest.db`, and serves a pruned folder/file
//! tree to the reader's library pane.
//!
//! Ownership model: one writer/coordinator thread owns the write connection and
//! does all database work (the breadth-first walk, the fast-path checks, and the
//! writes). A small pool of parse/hash workers does the pure CPU/IO work (read,
//! blake3 hash, parse title + headings) and funnels results back to the writer.
//! A separate reader thread owns a read-only connection so `GetFileTree` answers
//! promptly even during a full crawl (WAL allows concurrent readers).

mod chunks;
mod db;
mod frontmatter;
mod graph;
mod links;
mod records;
mod scan;
mod search;
mod sync;
mod tree;
mod vaults;
mod worker;

// Re-exported so `indexer::x` reaches every public item, wherever it lives.
pub use chunks::*;
pub use db::*;
pub use frontmatter::*;
pub use graph::*;
pub use links::*;
pub use search::*;
pub use tree::*;
pub use vaults::*;
pub use worker::*;

// Wholly internal; imported so the submodules can reach each other.
use records::*;
use scan::*;
use sync::*;

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::Metadata;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{params, params_from_iter, types::Value, Connection, OpenFlags};
use serde::Serialize;

use crate::DocumentFormat;

/// Latest applied schema migration: 1 base, 2 full-text search, 3 frontmatter,
/// 4 doc-to-doc link graph, 5 vaults.
pub(super) const SCHEMA_VERSION: i64 = 5;

/// Feature name recorded in `file_feature_state` for the chunk/FTS layer.
pub(super) const CHUNKS_FEATURE: &str = "chunks";

/// Schema version for the chunk extraction shape. Bump when the chunking output
/// changes so the next scan rebuilds stale chunks even with unchanged bytes.
pub(super) const CHUNKS_SCHEMA_VERSION: i64 = 1;

/// Feature name recorded in `file_feature_state` for the frontmatter layer.
pub(super) const FRONTMATTER_FEATURE: &str = "frontmatter";

/// Schema version for the frontmatter extraction shape. Bump when the parsed
/// key/value shape changes so the next scan rebuilds stale rows.
pub(super) const FRONTMATTER_SCHEMA_VERSION: i64 = 1;

/// Feature name recorded in `file_feature_state` for the doc-to-doc link layer.
pub(super) const LINKS_FEATURE: &str = "links";

/// Schema version for the link extraction shape. Bump when the extracted link
/// shape changes so the next scan rebuilds stale rows.
pub(super) const LINKS_SCHEMA_VERSION: i64 = 1;

/// Soft cap on a chunk's source length. A heading section under this becomes one
/// chunk; larger sections split at block boundaries. Not hard: an oversized
/// block still becomes one chunk.
pub(super) const CHUNK_TARGET_BYTES: usize = 1500;

/// Version of the base parse pipeline (`files` + `headings`). Bump when the
/// parsed shape changes so the next scan reparses stale files once.
pub(super) const CURRENT_DERIVED_VERSION: i64 = 1;

/// How many bytes of a file the indexer reads. Larger files are indexed from
/// their leading prefix and still appear in the library; this bounds crawl work,
/// not inclusion. The reader opens the full file regardless.
pub(super) const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;

/// Parse/hash worker count. Parse + hash is the crawl bottleneck; many parsers
/// funnel to one writer.
pub(super) const PARSE_WORKERS: usize = 4;

/// Bound on in-flight parse jobs so the walker paces itself to the pool.
pub(super) const JOB_QUEUE_BOUND: usize = 64;

/// Throttle for progress and tree events so a large scan never floods the UI.
pub(super) const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);

pub(super) const TREE_THROTTLE: Duration = Duration::from_millis(1500);

/// Repository/build noise directories, skipped by name at any depth.
const REPO_NOISE_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    ".cache",
    ".gradle",
    ".m2",
    ".venv",
    "__pycache__",
    "Pods",
    ".next",
    ".terraform",
];

/// OS/system directories, skipped only directly under a detected root (where the
/// name is known to be system-owned). A folder named `Library` deep in user
/// content is left alone.
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

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/// A node in the library tree: a folder or a file. All strings are file-derived
/// and untrusted; the frontend escapes them before the DOM.
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

/// The library link graph: one node per document, one undirected edge per
/// resolved doc-to-doc link. `path` is the node identity the frontend opens by.
/// All strings are file-derived and untrusted; the frontend escapes them.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Kept for the frontend contract; the graph is no longer capped, so always
    /// `false`.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub path: String,
    pub label: String,
    pub degree: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// What slice of the link graph to build. `focus` keeps only the seed documents
/// and their direct neighbors (the "Focus" scope); otherwise `limit` caps to the
/// densest N documents (`None` = all).
#[derive(Debug, Clone, Default)]
pub struct GraphRequest {
    pub focus: Option<Vec<String>>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanPhase {
    Scanning,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: ScanPhase,
    pub files_found: u64,
}

/// An event the worker sends back to the host. The host turns it into a JS call
/// through [`event_script`].
#[derive(Debug, Clone)]
pub enum IndexerEvent {
    /// A full tree snapshot plus the current scan progress (success).
    Library {
        tree: Vec<FileTreeNode>,
        progress: ScanProgress,
    },
    /// Throttled scan progress only, during a crawl.
    Progress(ScanProgress),
    /// Ranked full-text search results for a query (or an error for it). The
    /// query is echoed so the frontend can drop stale responses.
    SearchResults {
        query: String,
        hits: Vec<SearchHit>,
        error: Option<String>,
    },
    /// The library link graph for the graph view (or an error for it).
    Graph {
        graph: DocumentGraph,
        error: Option<String>,
    },
    /// A backend error to surface in the pane.
    Error(String),
}

/// A derived feature that must be current before a file can fast-path. Each
/// records readiness in `file_feature_state`, so a stale feature forces a
/// one-file reparse on the next scan even when bytes are unchanged.
#[derive(Debug, Clone, Copy)]
pub struct FeatureSpec {
    pub name: &'static str,
    pub schema_version: i64,
}

/// The derived features that gate the crawl fast-path. A file with no current
/// row for one (e.g. indexed before that feature shipped) is reparsed once.
pub fn required_features() -> &'static [FeatureSpec] {
    const FEATURES: &[FeatureSpec] = &[
        FeatureSpec {
            name: CHUNKS_FEATURE,
            schema_version: CHUNKS_SCHEMA_VERSION,
        },
        FeatureSpec {
            name: FRONTMATTER_FEATURE,
            schema_version: FRONTMATTER_SCHEMA_VERSION,
        },
        FeatureSpec {
            name: LINKS_FEATURE,
            schema_version: LINKS_SCHEMA_VERSION,
        },
    ];
    FEATURES
}

/// A searchable piece of one file. Chunks are diffed by `(file_id, ordinal)` on
/// reindex rather than recreated. `anchor` is the nearest heading's slug so a
/// result can jump there; `None` for content above the first heading.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub ordinal: i64,
    pub start_line: i64,
    pub end_line: i64,
    pub anchor: Option<String>,
    pub text: String,
    pub text_hash: String,
}

/// One ranked search result, delivered to the frontend as JSON. Every string is
/// file-derived and untrusted; the frontend escapes it before the DOM.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub abs_path: String,
    pub title: String,
    pub start_line: u32,
    pub end_line: u32,
    pub anchor: Option<String>,
    pub snippet: String,
    pub score: f64,
}

/// Cap on returned hits so a broad query stays cheap and bounded.
pub(super) const SEARCH_LIMIT: i64 = 50;

// ---------------------------------------------------------------------------
// Errors / small helpers
// ---------------------------------------------------------------------------

pub(super) type DbResult<T> = Result<T, String>;

pub(super) fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

pub(super) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(super) fn mtime_secs(meta: &Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The manifest database path inside the app data directory.
pub fn manifest_path(data_dir: &Path) -> PathBuf {
    data_dir.join("manifest.db")
}

pub(super) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// The IO-time path. On Windows the `\\?\` extended-length prefix keeps
/// `read_dir`/`metadata`/`read` working on paths over 260 chars. IO-only:
/// stored and user-facing paths use the normal form.
#[cfg(windows)]
pub(super) fn io_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if text.starts_with(r"\\?\") || text.starts_with(r"\\") {
        // Already verbatim, or a UNC share we leave as-is for v1.
        return path.to_path_buf();
    }
    let bytes = text.as_bytes();
    // Drive-absolute like `C:\...`.
    if bytes.len() >= 2 && bytes[1] == b':' {
        return PathBuf::from(format!(r"\\?\{text}"));
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
pub(super) fn io_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// The storage-side inverse of [`io_path`]: strip the Windows `\\?\` prefix so a
/// path matches the normal form the crawl stores. A path from the file watcher
/// carries it (it watches a canonicalized dir); storing it verbatim would file
/// the entry under a duplicate `\\?\C:` root. UNC verbatim paths are left as-is.
#[cfg(windows)]
pub(super) fn normal_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        if !rest.starts_with("UNC\\") {
            return PathBuf::from(rest.to_string());
        }
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
pub(super) fn normal_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Document types the library indexes: every format the app can open, so the
/// library and the reading view never disagree about what a document is.
pub(super) fn is_indexable_file(path: &Path) -> bool {
    crate::is_supported_document_path(path)
}

pub(super) fn is_repo_noise_dir(name: &str) -> bool {
    REPO_NOISE_DIRS.contains(&name)
}

pub(super) fn is_system_dir(name: &str) -> bool {
    SYSTEM_DIRS.contains(&name)
}

/// PermissionDenied / NotFound are expected on a whole-device walk: skip that
/// directory. Any other error is treated as a root-level failure.
pub(super) fn is_benign_dir_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::NotFound
    )
}

/// Whether a directory is a reparse point (symlink or, on Windows, a junction).
/// Following these causes loops and access errors, so they are not descended.
/// A directory we cannot stat is treated as a reparse point (do not descend).
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

/// The file name with a Markdown extension stripped, used as the title fallback.
pub(super) fn stem_of(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| filename.to_string())
}

/// `display_path` shown in the tree: the file's path relative to its scan root,
/// with the OS separator.
pub(super) fn display_path_for(root: &Path, child: &Path) -> String {
    match child.strip_prefix(root) {
        Ok(rel) => rel.to_string_lossy().to_string(),
        Err(_) => child
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

/// The top-level tree node label for a root, e.g. `C:\` -> `C:`, `/` -> `/`.
pub(super) fn root_label(root: &str) -> String {
    let trimmed = root.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

// ---------------------------------------------------------------------------
// Database open + migrations
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
