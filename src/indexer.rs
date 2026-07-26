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

/// Latest applied schema migration: 1 base, 2 full-text search, 3 frontmatter,
/// 4 doc-to-doc link graph.
const SCHEMA_VERSION: i64 = 4;

/// Feature name recorded in `file_feature_state` for the chunk/FTS layer.
const CHUNKS_FEATURE: &str = "chunks";

/// Schema version for the chunk extraction shape. Bump when the chunking output
/// changes so the next scan rebuilds stale chunks even with unchanged bytes.
const CHUNKS_SCHEMA_VERSION: i64 = 1;

/// Feature name recorded in `file_feature_state` for the frontmatter layer.
const FRONTMATTER_FEATURE: &str = "frontmatter";

/// Schema version for the frontmatter extraction shape. Bump when the parsed
/// key/value shape changes so the next scan rebuilds stale rows.
const FRONTMATTER_SCHEMA_VERSION: i64 = 1;

/// Feature name recorded in `file_feature_state` for the doc-to-doc link layer.
const LINKS_FEATURE: &str = "links";

/// Schema version for the link extraction shape. Bump when the extracted link
/// shape changes so the next scan rebuilds stale rows.
const LINKS_SCHEMA_VERSION: i64 = 1;

/// Soft cap on a chunk's source length. A heading section under this becomes one
/// chunk; larger sections split at block boundaries. Not hard: an oversized
/// block still becomes one chunk.
const CHUNK_TARGET_BYTES: usize = 1500;

/// Version of the base parse pipeline (`files` + `headings`). Bump when the
/// parsed shape changes so the next scan reparses stale files once.
const CURRENT_DERIVED_VERSION: i64 = 1;

/// How many bytes of a file the indexer reads. Larger files are indexed from
/// their leading prefix and still appear in the library; this bounds crawl work,
/// not inclusion. The reader opens the full file regardless.
const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;

/// Parse/hash worker count. Parse + hash is the crawl bottleneck; many parsers
/// funnel to one writer.
const PARSE_WORKERS: usize = 4;

/// Bound on in-flight parse jobs so the walker paces itself to the pool.
const JOB_QUEUE_BOUND: usize = 64;

/// Throttle for progress and tree events so a large scan never floods the UI.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);
const TREE_THROTTLE: Duration = Duration::from_millis(1500);

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
const SEARCH_LIMIT: i64 = 50;

// ---------------------------------------------------------------------------
// Errors / small helpers
// ---------------------------------------------------------------------------

type DbResult<T> = Result<T, String>;

fn to_err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime_secs(meta: &Metadata) -> i64 {
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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// The IO-time path. On Windows the `\\?\` extended-length prefix keeps
/// `read_dir`/`metadata`/`read` working on paths over 260 chars. IO-only:
/// stored and user-facing paths use the normal form.
#[cfg(windows)]
fn io_path(path: &Path) -> PathBuf {
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
fn io_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// The storage-side inverse of [`io_path`]: strip the Windows `\\?\` prefix so a
/// path matches the normal form the crawl stores. A path from the file watcher
/// carries it (it watches a canonicalized dir); storing it verbatim would file
/// the entry under a duplicate `\\?\C:` root. UNC verbatim paths are left as-is.
#[cfg(windows)]
fn normal_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        if !rest.starts_with("UNC\\") {
            return PathBuf::from(rest.to_string());
        }
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn normal_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn lowercase_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        lowercase_extension(path).as_deref(),
        Some("md" | "markdown" | "mdown")
    )
}

/// XML documents (opened as `.xml`, rendered by the XML pipeline).
fn is_xml_file(path: &Path) -> bool {
    matches!(lowercase_extension(path).as_deref(), Some("xml"))
}

/// JSON and YAML documents, rendered by the data pipeline.
fn is_data_file(path: &Path) -> bool {
    matches!(
        lowercase_extension(path).as_deref(),
        Some("json" | "yaml" | "yml")
    )
}

/// Document types the library indexes: Markdown, XML, and the data formats.
fn is_indexable_file(path: &Path) -> bool {
    is_markdown_file(path) || is_xml_file(path) || is_data_file(path)
}

/// A data file's title, read by the same renderer the reading view uses so the
/// library and the open tab agree on what the document is called.
fn data_title(content: &str, path: &Path) -> Option<String> {
    match lowercase_extension(path).as_deref() {
        Some("json") => crate::render_json_body(content).0,
        _ => crate::render_yaml_body(content).0,
    }
}

fn is_repo_noise_dir(name: &str) -> bool {
    REPO_NOISE_DIRS.contains(&name)
}

fn is_system_dir(name: &str) -> bool {
    SYSTEM_DIRS.contains(&name)
}

/// PermissionDenied / NotFound are expected on a whole-device walk: skip that
/// directory. Any other error is treated as a root-level failure.
fn is_benign_dir_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::NotFound
    )
}

/// Whether a directory is a reparse point (symlink or, on Windows, a junction).
/// Following these causes loops and access errors, so they are not descended.
/// A directory we cannot stat is treated as a reparse point (do not descend).
fn is_dir_reparse(path: &Path) -> bool {
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
fn stem_of(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| filename.to_string())
}

/// `display_path` shown in the tree: the file's path relative to its scan root,
/// with the OS separator.
fn display_path_for(root: &Path, child: &Path) -> String {
    match child.strip_prefix(root) {
        Ok(rel) => rel.to_string_lossy().to_string(),
        Err(_) => child
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

/// The top-level tree node label for a root, e.g. `C:\` -> `C:`, `/` -> `/`.
fn root_label(root: &str) -> String {
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

const MIGRATION_1_SQL: &str = r#"
CREATE TABLE scan_roots (
    id       INTEGER PRIMARY KEY,
    path     TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
);

CREATE TABLE scan_runs (
    id          INTEGER PRIMARY KEY,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    completed   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE scan_run_roots (
    scan_run_id  INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
    scan_root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
    completed    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scan_run_id, scan_root_id)
);

CREATE TABLE files (
    id                INTEGER PRIMARY KEY,
    scan_root_id      INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
    abs_path          TEXT NOT NULL UNIQUE,
    display_path      TEXT NOT NULL,
    filename          TEXT NOT NULL,
    size_bytes        INTEGER NOT NULL,
    mtime             INTEGER NOT NULL,
    content_hash      TEXT,
    title             TEXT,
    derived_version   INTEGER NOT NULL DEFAULT 0,
    last_indexed      INTEGER NOT NULL,
    last_seen_scan_id INTEGER REFERENCES scan_runs(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'ok',
    error             TEXT
);

CREATE TABLE headings (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    depth   INTEGER NOT NULL,
    text    TEXT NOT NULL,
    PRIMARY KEY (file_id, ordinal)
);

CREATE TABLE file_feature_state (
    file_id         INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    feature         TEXT NOT NULL,
    schema_version  INTEGER NOT NULL,
    content_hash    TEXT NOT NULL,
    status          TEXT NOT NULL,
    error           TEXT,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (file_id, feature)
);

CREATE INDEX idx_files_root ON files(scan_root_id);
CREATE INDEX idx_files_status ON files(status);
CREATE INDEX idx_files_seen_scan ON files(last_seen_scan_id);
CREATE INDEX idx_file_feature_state_feature ON file_feature_state(feature, status);
"#;

/// Migration 2: full-text search. A `chunks` table holds searchable pieces of
/// each file; an external-content FTS5 table mirrors their text. The triggers
/// keep `chunks_fts` in sync (external-content tables need the `'delete'` form
/// to drop old terms before reinsert).
const MIGRATION_2_SQL: &str = r#"
CREATE TABLE chunks (
    id         INTEGER PRIMARY KEY,
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    ordinal    INTEGER NOT NULL,
    start_line INTEGER NOT NULL,
    end_line   INTEGER NOT NULL,
    anchor     TEXT,
    text       TEXT NOT NULL,
    text_hash  TEXT NOT NULL,
    UNIQUE(file_id, ordinal)
);

CREATE INDEX idx_chunks_file ON chunks(file_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
"#;

/// Migration 3: frontmatter. One row per key/value of a file's leading
/// `--- ... ---` block. Keys stored lowercase for case-insensitive filters; list
/// values expand to one row each. The composite key dedupes repeated pairs.
const MIGRATION_3_SQL: &str = r#"
CREATE TABLE frontmatter (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (file_id, key, value)
);

CREATE INDEX idx_frontmatter_key_value ON frontmatter(key, value);
"#;

/// Migration 4: the doc-to-doc link graph. One row per outgoing link.
/// `target_abs` is a resolved absolute path (relative links); `target_name` a
/// normalized note name (`[[wiki]]` links). Both are hints matched to a file id
/// in Rust at graph-build time, so dangling links persist harmlessly.
const MIGRATION_4_SQL: &str = r#"
CREATE TABLE links (
    from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    ordinal      INTEGER NOT NULL,
    target_abs   TEXT,
    target_name  TEXT,
    raw          TEXT NOT NULL,
    PRIMARY KEY (from_file_id, ordinal)
);

CREATE INDEX idx_links_from ON links(from_file_id);
CREATE INDEX idx_links_target_abs ON links(target_abs);
CREATE INDEX idx_links_target_name ON links(target_name);
"#;

/// Open (creating if needed) the manifest database, apply PRAGMAs, and migrate.
/// Runs on the caller's thread so the schema exists before the reader connects.
pub fn open_db(data_dir: &Path) -> DbResult<Connection> {
    std::fs::create_dir_all(data_dir).map_err(to_err)?;
    let mut conn = Connection::open(manifest_path(data_dir)).map_err(to_err)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 2500;",
    )
    .map_err(to_err)?;
    ensure_fts5_available(&conn)?;
    run_migrations(&mut conn)?;
    Ok(conn)
}

/// Fail loudly at startup if the bundled SQLite lacks FTS5. A throwaway
/// in-memory FTS5 table is a cheap probe that doesn't touch the manifest.
fn ensure_fts5_available(conn: &Connection) -> DbResult<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE temp.leaf_fts5_probe USING fts5(x);
         DROP TABLE temp.leaf_fts5_probe;",
    )
    .map_err(|error| {
        format!("SQLite was built without FTS5, which leaftext search requires: {error}")
    })
}

/// A separate read-only connection for query commands. Safe alongside the writer
/// under WAL.
pub fn open_read_db(data_dir: &Path) -> DbResult<Connection> {
    let conn = Connection::open_with_flags(
        manifest_path(data_dir),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(to_err)?;
    conn.busy_timeout(Duration::from_millis(2500))
        .map_err(to_err)?;
    Ok(conn)
}

fn run_migrations(conn: &mut Connection) -> DbResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )
    .map_err(to_err)?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(to_err)?;

    if current < 1 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_1_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    if current < 2 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_2_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    if current < 3 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_3_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    if current < 4 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_4_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    // Rebuild the FTS index once if it drifted from the chunk rows. No-op when
    // the counts agree.
    rebuild_fts_if_stale(conn)?;

    let _ = SCHEMA_VERSION;
    Ok(())
}

/// Rebuild `chunks_fts` when its row count doesn't match `chunks`, guarding
/// against a drifted or predating index.
fn rebuild_fts_if_stale(conn: &Connection) -> DbResult<()> {
    let chunk_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
        .map_err(to_err)?;
    let fts_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks_fts", [], |row| row.get(0))
        .map_err(to_err)?;
    if chunk_count != fts_count {
        conn.execute_batch("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');")
            .map_err(to_err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ScanRoot {
    id: i64,
    path: PathBuf,
}

/// Accessible roots to crawl: existing drive roots on Windows, else `/`.
pub fn detect_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let path = PathBuf::from(format!("{}:\\", letter as char));
            if std::fs::metadata(io_path(&path)).is_ok() {
                roots.push(path);
            }
        }
        roots
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}

/// Ensure each detected root exists in `scan_roots` and return them with ids.
fn ensure_roots(conn: &Connection, roots: &[PathBuf]) -> DbResult<Vec<ScanRoot>> {
    let mut out = Vec::with_capacity(roots.len());
    for path in roots {
        let path_str = path_to_string(path);
        conn.execute(
            "INSERT OR IGNORE INTO scan_roots (path, added_at) VALUES (?1, ?2)",
            params![path_str, now_secs()],
        )
        .map_err(to_err)?;
        let id: i64 = conn
            .query_row(
                "SELECT id FROM scan_roots WHERE path = ?1",
                params![path_str],
                |row| row.get(0),
            )
            .map_err(to_err)?;
        out.push(ScanRoot {
            id,
            path: path.clone(),
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Feature-state plumbing
// ---------------------------------------------------------------------------

/// Whether a derived feature row is current: it exists with a matching feature
/// name, `schema_version`, `content_hash`, and `status = 'ready'`.
pub fn is_feature_current(
    conn: &Connection,
    file_id: i64,
    feature: &str,
    schema_version: i64,
    content_hash: Option<&str>,
) -> DbResult<bool> {
    let Some(content_hash) = content_hash else {
        return Ok(false);
    };
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM file_feature_state
             WHERE file_id = ?1 AND feature = ?2 AND schema_version = ?3
               AND content_hash = ?4 AND status = 'ready'",
            params![file_id, feature, schema_version, content_hash],
            |row| row.get(0),
        )
        .map_err(to_err)?;
    Ok(count > 0)
}

/// Record a successful feature rebuild. Call only after the feature's tables
/// are updated in the same transaction.
pub fn mark_feature_ready(
    conn: &Connection,
    file_id: i64,
    feature: &str,
    schema_version: i64,
    content_hash: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO file_feature_state
            (file_id, feature, schema_version, content_hash, status, error, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'ready', NULL, ?5)
         ON CONFLICT(file_id, feature) DO UPDATE SET
            schema_version = excluded.schema_version,
            content_hash = excluded.content_hash,
            status = 'ready', error = NULL, updated_at = excluded.updated_at",
        params![file_id, feature, schema_version, content_hash, now_secs()],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Record a retryable feature failure so the next scan reparses this file.
pub fn mark_feature_failed(
    conn: &Connection,
    file_id: i64,
    feature: &str,
    schema_version: i64,
    content_hash: &str,
    error: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO file_feature_state
            (file_id, feature, schema_version, content_hash, status, error, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'failed', ?5, ?6)
         ON CONFLICT(file_id, feature) DO UPDATE SET
            schema_version = excluded.schema_version,
            content_hash = excluded.content_hash,
            status = 'failed', error = excluded.error, updated_at = excluded.updated_at",
        params![
            file_id,
            feature,
            schema_version,
            content_hash,
            error,
            now_secs()
        ],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Remove a file's feature readiness (when it leaves status `ok`).
pub fn clear_feature_state(conn: &Connection, file_id: i64, feature: &str) -> DbResult<()> {
    conn.execute(
        "DELETE FROM file_feature_state WHERE file_id = ?1 AND feature = ?2",
        params![file_id, feature],
    )
    .map_err(to_err)?;
    Ok(())
}

fn all_features_current(
    conn: &Connection,
    file_id: i64,
    content_hash: Option<&str>,
) -> DbResult<bool> {
    for spec in required_features() {
        if !is_feature_current(conn, file_id, spec.name, spec.schema_version, content_hash)? {
            return Ok(false);
        }
    }
    Ok(true)
}

// ---------------------------------------------------------------------------
// Markdown parse
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
struct Heading {
    ordinal: i64,
    depth: i64,
    text: String,
}

#[derive(Debug, Clone, PartialEq)]
struct ParsedDoc {
    title: String,
    headings: Vec<Heading>,
}

fn heading_depth(level: pulldown_cmark::HeadingLevel) -> i64 {
    use pulldown_cmark::HeadingLevel::*;
    match level {
        H1 => 1,
        H2 => 2,
        H3 => 3,
        H4 => 4,
        H5 => 5,
        H6 => 6,
    }
}

/// Parse the title (first H1, else the filename) and the document's headings in
/// document order. Uses the real Markdown parser, not regex.
fn parse_markdown(content: &str, fallback_title: &str) -> ParsedDoc {
    use pulldown_cmark::{Event, Parser, Tag, TagEnd};

    let mut headings: Vec<Heading> = Vec::new();
    let mut ordinal = 0i64;
    let mut current: Option<(i64, String)> = None;

    for event in Parser::new(content) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current = Some((heading_depth(level), String::new()));
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((depth, text)) = current.take() {
                    headings.push(Heading {
                        ordinal,
                        depth,
                        text: text.trim().to_string(),
                    });
                    ordinal += 1;
                }
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, accumulator)) = current.as_mut() {
                    accumulator.push_str(&text);
                }
            }
            _ => {}
        }
    }

    let title = headings
        .iter()
        .find(|h| h.depth == 1 && !h.text.is_empty())
        .map(|h| h.text.clone())
        .unwrap_or_else(|| fallback_title.to_string());

    ParsedDoc { title, headings }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/// Byte offset of the start of each source line. `line_of` maps any byte offset
/// to its one-based line number with a binary search.
fn line_starts_of(content: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (index, byte) in content.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_of(line_starts: &[usize], offset: usize) -> i64 {
    // The count of line starts at or before `offset` is its one-based line.
    line_starts.partition_point(|&start| start <= offset) as i64
}

/// A top-level Markdown block with its source byte range. Headings carry the
/// rendered slug so the section's chunks can point at them.
struct SourceBlock {
    start: usize,
    end: usize,
    is_heading: bool,
    anchor: Option<String>,
}

/// Split a document into searchable chunks, delimited by headings; each chunk
/// carries its heading's slug as its anchor. A section over [`CHUNK_TARGET_BYTES`]
/// splits at block boundaries. Deterministic. Slugs match the renderer's own
/// `unique_heading_slug`, so `leafScrollToFragment` can land on the heading.
pub fn chunk_file(content: &str) -> Vec<Chunk> {
    let line_starts = line_starts_of(content);
    let blocks = collect_source_blocks(content);

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut ordinal: i64 = 0;
    let mut current_anchor: Option<String> = None;
    let mut pending_start: Option<usize> = None;
    let mut pending_end: usize = 0;

    let flush = |chunks: &mut Vec<Chunk>,
                 ordinal: &mut i64,
                 start: &mut Option<usize>,
                 end: usize,
                 anchor: &Option<String>| {
        if let Some(from) = start.take() {
            let text = content[from..end].trim();
            if !text.is_empty() {
                chunks.push(Chunk {
                    ordinal: *ordinal,
                    start_line: line_of(&line_starts, from),
                    end_line: line_of(&line_starts, end.saturating_sub(1)),
                    anchor: anchor.clone(),
                    text: text.to_string(),
                    text_hash: blake3::hash(text.as_bytes()).to_hex().to_string(),
                });
                *ordinal += 1;
            }
        }
    };

    for block in blocks {
        if block.is_heading {
            // A heading starts a new section: flush the previous, then open a
            // fresh chunk with the heading line.
            flush(
                &mut chunks,
                &mut ordinal,
                &mut pending_start,
                pending_end,
                &current_anchor,
            );
            current_anchor = block.anchor.clone();
            pending_start = Some(block.start);
            pending_end = block.end;
            continue;
        }
        if pending_start.is_none() {
            pending_start = Some(block.start);
        }
        pending_end = block.end;
        // Once a section's accumulated source exceeds the target, close the chunk
        // at this block boundary. A single oversized block still becomes one chunk.
        if let Some(from) = pending_start {
            if pending_end.saturating_sub(from) >= CHUNK_TARGET_BYTES {
                flush(
                    &mut chunks,
                    &mut ordinal,
                    &mut pending_start,
                    pending_end,
                    &current_anchor,
                );
            }
        }
    }
    flush(
        &mut chunks,
        &mut ordinal,
        &mut pending_start,
        pending_end,
        &current_anchor,
    );

    chunks
}

/// Record each top-level block's byte range, tagging headings with their slug.
/// A per-document `seen` set gives duplicates the same `-1`/`-2` suffixes the
/// renderer assigns.
fn collect_source_blocks(content: &str) -> Vec<SourceBlock> {
    use pulldown_cmark::{Event, Parser, Tag};

    let mut blocks: Vec<SourceBlock> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut depth: i32 = 0;
    let mut block_start: usize = 0;
    let mut is_heading = false;
    let mut heading_text = String::new();

    for (event, range) in Parser::new_ext(content, crate::markdown_options()).into_offset_iter() {
        match &event {
            Event::Start(tag) => {
                if depth == 0 {
                    block_start = range.start;
                    is_heading = matches!(tag, Tag::Heading { .. });
                    heading_text.clear();
                } else if is_heading {
                    crate::append_heading_slug_text(&event, &mut heading_text);
                }
                depth += 1;
            }
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    let anchor = if is_heading {
                        Some(crate::unique_heading_slug(&heading_text, &mut seen))
                    } else {
                        None
                    };
                    blocks.push(SourceBlock {
                        start: block_start,
                        end: range.end,
                        is_heading,
                        anchor,
                    });
                }
            }
            _ => {
                if depth == 0 {
                    // A standalone top-level block (thematic break, raw HTML block).
                    blocks.push(SourceBlock {
                        start: range.start,
                        end: range.end,
                        is_heading: false,
                        anchor: None,
                    });
                } else if is_heading {
                    crate::append_heading_slug_text(&event, &mut heading_text);
                }
            }
        }
    }

    blocks
}

/// Replace one file's chunks, preserving `chunks.id` for surviving `(file_id,
/// ordinal)` rows: surviving ordinals update in place only when changed, new
/// ones insert, removed ones delete. The triggers keep `chunks_fts` in sync.
pub fn replace_chunks(conn: &Connection, file_id: i64, chunks: &[Chunk]) -> DbResult<()> {
    struct ExistingChunk {
        start_line: i64,
        end_line: i64,
        anchor: Option<String>,
        text_hash: String,
    }

    let mut existing: HashMap<i64, ExistingChunk> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT ordinal, start_line, end_line, anchor, text_hash
                 FROM chunks WHERE file_id = ?1",
            )
            .map_err(to_err)?;
        let rows = stmt
            .query_map(params![file_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    ExistingChunk {
                        start_line: row.get(1)?,
                        end_line: row.get(2)?,
                        anchor: row.get(3)?,
                        text_hash: row.get(4)?,
                    },
                ))
            })
            .map_err(to_err)?;
        for row in rows {
            let (ordinal, value) = row.map_err(to_err)?;
            existing.insert(ordinal, value);
        }
    }

    for chunk in chunks {
        match existing.remove(&chunk.ordinal) {
            Some(prev) => {
                let unchanged = prev.text_hash == chunk.text_hash
                    && prev.start_line == chunk.start_line
                    && prev.end_line == chunk.end_line
                    && prev.anchor == chunk.anchor;
                if !unchanged {
                    conn.execute(
                        "UPDATE chunks
                         SET start_line = ?3, end_line = ?4, anchor = ?5, text = ?6, text_hash = ?7
                         WHERE file_id = ?1 AND ordinal = ?2",
                        params![
                            file_id,
                            chunk.ordinal,
                            chunk.start_line,
                            chunk.end_line,
                            chunk.anchor,
                            chunk.text,
                            chunk.text_hash,
                        ],
                    )
                    .map_err(to_err)?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO chunks
                        (file_id, ordinal, start_line, end_line, anchor, text, text_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        file_id,
                        chunk.ordinal,
                        chunk.start_line,
                        chunk.end_line,
                        chunk.anchor,
                        chunk.text,
                        chunk.text_hash,
                    ],
                )
                .map_err(to_err)?;
            }
        }
    }

    for ordinal in existing.keys() {
        conn.execute(
            "DELETE FROM chunks WHERE file_id = ?1 AND ordinal = ?2",
            params![file_id, ordinal],
        )
        .map_err(to_err)?;
    }

    Ok(())
}

/// Remove all of a file's chunks (when it leaves status `ok`). The `chunks_ad`
/// trigger drops the matching FTS rows.
fn delete_chunks(conn: &Connection, file_id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM chunks WHERE file_id = ?1", params![file_id])
        .map_err(to_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------
//
// Parser scope (a documented subset, kept pure-Rust rather than a YAML crate):
//   - `key: value`
//   - `key: [a, b, c]`
//   - `key:` followed by `- item` block-list entries
//   - all scalars stored as text
// Unrecognized lines are skipped, never fatal. Keys are lowercased.

/// The leading frontmatter block's inner text (between the `---` fences), with
/// fences and any UTF-8 BOM stripped.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterBlock {
    pub body: String,
}

/// One normalized frontmatter field. `key` is lowercase; a list value expands to
/// one field per item. Untrusted; the frontend escapes before the DOM.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterField {
    pub key: String,
    pub value: String,
}

/// The normalized output of parsing a frontmatter block.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedFrontmatter {
    pub fields: Vec<FrontmatterField>,
}

/// A frontmatter block that could not be interpreted as a key/value mapping at
/// all. Recorded for diagnostics; it never fails the file.
#[derive(Debug, Clone, PartialEq)]
pub enum MetadataError {
    Unparseable,
}

impl std::fmt::Display for MetadataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MetadataError::Unparseable => {
                write!(f, "frontmatter is not a key/value mapping")
            }
        }
    }
}

/// Extract the leading frontmatter block, if any. Detected only when `---` is
/// the first line (after an optional BOM) and a later `---` closes it; a `---`
/// deeper in the document is body content.
pub fn extract_frontmatter(text: &str) -> Option<FrontmatterBlock> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    // `str::lines` strips trailing `\r` (CRLF works); fence trailing spaces tolerated.
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut body = String::new();
    for line in lines {
        if line.trim_end() == "---" {
            return Some(FrontmatterBlock { body });
        }
        body.push_str(line);
        body.push('\n');
    }
    // No closing fence: this is not a frontmatter block.
    None
}

/// Strip one layer of matching surrounding quotes from a scalar value.
fn strip_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// Parse the inline-array form `[a, b, c]`, returning the cleaned, non-empty
/// items. The caller has already confirmed the brackets.
fn parse_inline_array(inner: &str) -> Vec<String> {
    inner
        .split(',')
        .map(|item| strip_quotes(item.trim()).trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// Parse a frontmatter block into normalized key/value fields. Unrecognized
/// lines are skipped. Returns `Err` only when the block has content but nothing
/// parsed as a mapping (the file is still indexed either way).
pub fn parse_frontmatter(block: &FrontmatterBlock) -> Result<ParsedFrontmatter, MetadataError> {
    let mut fields: Vec<FrontmatterField> = Vec::new();
    let mut bad_lines = 0usize;
    // The key of the most recent `key:` line with an empty value, which a run of
    // `- item` lines attaches to (block-list form).
    let mut list_key: Option<String> = None;

    for raw in block.body.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // A block-list item attaches to the pending list key.
        if let Some(item) = trimmed.strip_prefix("- ").or_else(|| {
            // A bare `-` (empty item) is ignored rather than treated as bad.
            (trimmed == "-").then_some("")
        }) {
            match &list_key {
                Some(key) => {
                    let value = strip_quotes(item.trim()).trim();
                    if !value.is_empty() {
                        fields.push(FrontmatterField {
                            key: key.clone(),
                            value: value.to_string(),
                        });
                    }
                    continue;
                }
                None => {
                    bad_lines += 1;
                    continue;
                }
            }
        }

        // Otherwise it must be a `key: ...` line. Split on the first colon.
        let Some((key_part, value_part)) = line.split_once(':') else {
            bad_lines += 1;
            continue;
        };
        let key = key_part.trim().to_lowercase();
        if key.is_empty() {
            bad_lines += 1;
            continue;
        }
        let value = value_part.trim();

        if value.is_empty() {
            // `key:` opens a possible block list; rows come from following items.
            list_key = Some(key);
            continue;
        }
        list_key = None;

        if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            for item in parse_inline_array(inner) {
                fields.push(FrontmatterField {
                    key: key.clone(),
                    value: item,
                });
            }
        } else {
            fields.push(FrontmatterField {
                key,
                value: strip_quotes(value).trim().to_string(),
            });
        }
    }

    if fields.is_empty() && bad_lines > 0 {
        return Err(MetadataError::Unparseable);
    }
    Ok(ParsedFrontmatter { fields })
}

/// Replace one file's frontmatter rows. `INSERT OR IGNORE` collapses duplicate
/// (key, value) pairs; keys are already lowercased by [`parse_frontmatter`].
pub fn replace_frontmatter(
    conn: &Connection,
    file_id: i64,
    fields: &[FrontmatterField],
) -> DbResult<()> {
    conn.execute(
        "DELETE FROM frontmatter WHERE file_id = ?1",
        params![file_id],
    )
    .map_err(to_err)?;
    for field in fields {
        conn.execute(
            "INSERT OR IGNORE INTO frontmatter (file_id, key, value) VALUES (?1, ?2, ?3)",
            params![file_id, field.key, field.value],
        )
        .map_err(to_err)?;
    }
    Ok(())
}

/// Remove all of a file's frontmatter rows (when it leaves status `ok`).
fn delete_frontmatter(conn: &Connection, file_id: i64) -> DbResult<()> {
    conn.execute(
        "DELETE FROM frontmatter WHERE file_id = ?1",
        params![file_id],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Extract and parse a file's frontmatter into fields; a malformed block yields
/// no fields but never fails the file.
fn frontmatter_fields(content: &str) -> Vec<FrontmatterField> {
    match extract_frontmatter(content) {
        Some(block) => parse_frontmatter(&block).unwrap_or_default().fields,
        None => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Link extraction (doc-to-doc graph edges)
// ---------------------------------------------------------------------------

/// One outgoing link. Exactly one hint is set: `target_abs` (a resolved absolute
/// path) or `target_name` (a `[[wiki]]` note name). Both are matched to a file id
/// at graph-build time, so dangling links persist without rewriting.
#[derive(Debug, Clone, PartialEq)]
pub struct DocLink {
    pub target_abs: Option<String>,
    pub target_name: Option<String>,
    pub raw: String,
}

/// Extract a document's outgoing links, dispatching on file type. Markdown gets
/// Markdown links, `<a href>`, and `[[wiki]]`; XML gets `target=`/`href=` attrs.
/// Deduplicated by resolved target so a repeated link draws one edge.
fn document_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    let mut links = if is_xml_file(source_abs) {
        xml_links(content, source_abs)
    } else if is_data_file(source_abs) {
        // A data file's strings are values, not prose. Scanning them as Markdown
        // invents links that were never written, so the graph leaves them out.
        Vec::new()
    } else {
        markdown_links(content, source_abs)
    };
    dedup_links(&mut links);
    links
}

fn dedup_links(links: &mut Vec<DocLink>) {
    let mut seen: HashSet<(Option<String>, Option<String>)> = HashSet::new();
    links.retain(|link| seen.insert((link.target_abs.clone(), link.target_name.clone())));
}

/// Markdown link destinations come from the parser; `<a href>` and `[[wiki]]`
/// aren't link tags, so they're scanned from the source separately.
fn markdown_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    use pulldown_cmark::{Event, Parser, Tag};
    let mut out = Vec::new();
    for event in Parser::new(content) {
        if let Event::Start(Tag::Link { dest_url, .. }) = event {
            push_path_target(&mut out, &dest_url, source_abs);
        }
    }
    collect_attr_targets(content, "href", source_abs, &mut out);
    collect_wiki_links(content, &mut out);
    out
}

/// TEI cross-references live in `target=` (`<ref>`, `<ptr>`) and `href=` (`<a>`)
/// attributes.
fn xml_links(content: &str, source_abs: &Path) -> Vec<DocLink> {
    let mut out = Vec::new();
    collect_attr_targets(content, "target", source_abs, &mut out);
    collect_attr_targets(content, "href", source_abs, &mut out);
    out
}

/// Push a resolved path link, skipping empty, anchor-only, and external-URL
/// targets (those never point at a local document).
fn push_path_target(out: &mut Vec<DocLink>, raw: &str, source_abs: &Path) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || has_url_scheme(trimmed) {
        return;
    }
    if let Some(abs) = resolve_path_target(trimmed, source_abs) {
        out.push(DocLink {
            target_abs: Some(abs),
            target_name: None,
            raw: trimmed.to_string(),
        });
    }
}

/// Scan for `<... attr="value" ...>` and push each value as a path target. A
/// lexical scan, not a full parse: enough for the anchor/ref/ptr elements used.
fn collect_attr_targets(content: &str, attr: &str, source_abs: &Path, out: &mut Vec<DocLink>) {
    let needle = format!("{attr}=");
    let bytes = content.as_bytes();
    let mut search_from = 0;
    while let Some(rel) = content[search_from..].find(&needle) {
        let eq = search_from + rel + needle.len();
        // The char before the attribute name must be a tag delimiter (space, '<',
        // '/', or a quote) so `data-href=` / `xtarget=` do not match `href=` /
        // `target=`.
        let start = search_from + rel;
        let boundary_ok = start == 0
            || matches!(
                bytes[start - 1],
                b' ' | b'\t' | b'\n' | b'\r' | b'<' | b'/' | b'"' | b'\''
            );
        search_from = eq;
        if !boundary_ok || eq >= bytes.len() {
            continue;
        }
        let quote = bytes[eq];
        if quote != b'"' && quote != b'\'' {
            continue;
        }
        let value_start = eq + 1;
        if let Some(end_rel) = content[value_start..].find(quote as char) {
            let value = &content[value_start..value_start + end_rel];
            search_from = value_start + end_rel + 1;
            push_path_target(out, value, source_abs);
        }
    }
}

/// Scan for `[[Note]]`, `[[Note|alias]]`, and `[[Note#heading]]` wiki links and
/// push the note name (before any `|` or `#`) as a name target.
fn collect_wiki_links(content: &str, out: &mut Vec<DocLink>) {
    let mut search_from = 0;
    while let Some(rel) = content[search_from..].find("[[") {
        let open = search_from + rel + 2;
        let Some(close_rel) = content[open..].find("]]") else {
            break;
        };
        let inner = &content[open..open + close_rel];
        search_from = open + close_rel + 2;
        if inner.contains('\n') {
            continue;
        }
        let name = inner.split(['|', '#']).next().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        out.push(DocLink {
            target_abs: None,
            target_name: Some(normalize_name_key(name)),
            raw: format!("[[{inner}]]"),
        });
    }
}

/// True when `target` begins with a URL scheme (not a local document). Requires
/// 2+ scheme chars so a Windows drive path (`C:\...`) reads as a path, not a URL.
fn has_url_scheme(target: &str) -> bool {
    let bytes = target.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if c == b':' {
            return i >= 2;
        }
        let scheme_char = c.is_ascii_alphabetic()
            || (i > 0 && (c.is_ascii_digit() || c == b'+' || c == b'-' || c == b'.'));
        if !scheme_char {
            return false;
        }
    }
    false
}

/// Resolve a relative link target to an absolute path string (crawl normal form),
/// stripping `#fragment`/`?query` and percent-decoding. `None` for path-less targets.
fn resolve_path_target(raw: &str, source_abs: &Path) -> Option<String> {
    let without_fragment = raw.split(['#', '?']).next().unwrap_or("").trim();
    if without_fragment.is_empty() {
        return None;
    }
    let decoded = percent_decode(without_fragment);
    let base = source_abs.parent()?;
    Some(normalize_join(base, &decoded))
}

/// Lexically join `rel` onto `base`, resolving `.`/`..` without touching the
/// filesystem (the target may not exist yet). Absolute `rel` replaces `base`.
fn normalize_join(base: &Path, rel: &str) -> String {
    use std::path::Component;
    let rel_path = Path::new(rel);
    let mut result = if rel_path.is_absolute() {
        PathBuf::new()
    } else {
        base.to_path_buf()
    };
    for component in rel_path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            Component::Normal(part) => result.push(part),
            Component::RootDir => {}
            Component::Prefix(prefix) => result = PathBuf::from(prefix.as_os_str()),
        }
    }
    path_to_string(&result)
}

/// Decode `%XX` escapes in a link target (e.g. `My%20Note.md` -> `My Note.md`),
/// leaving anything that is not a valid escape untouched.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Normalize a note name (wiki link text, or a file's own name) to the key both
/// sides match on: trimmed and lowercased.
fn normalize_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Persist a file's outgoing links, replacing prior rows. Ordinal is the vector
/// index, giving stable per-file primary keys.
fn replace_links(conn: &Connection, file_id: i64, links: &[DocLink]) -> DbResult<()> {
    conn.execute(
        "DELETE FROM links WHERE from_file_id = ?1",
        params![file_id],
    )
    .map_err(to_err)?;
    for (ordinal, link) in links.iter().enumerate() {
        conn.execute(
            "INSERT INTO links (from_file_id, ordinal, target_abs, target_name, raw)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                file_id,
                ordinal as i64,
                link.target_abs,
                link.target_name,
                link.raw
            ],
        )
        .map_err(to_err)?;
    }
    Ok(())
}

fn delete_links(conn: &Connection, file_id: i64) -> DbResult<()> {
    conn.execute(
        "DELETE FROM links WHERE from_file_id = ?1",
        params![file_id],
    )
    .map_err(to_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// Split user input into plain search terms: whitespace-separated, FTS operator
/// characters dropped. Shared by the FTS `MATCH` query and the filename match.
fn query_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .filter_map(|raw| {
            let cleaned: String = raw
                .chars()
                .filter(|c| !matches!(c, '"' | '*' | '^' | '(' | ')' | ':'))
                .collect();
            let cleaned = cleaned.trim();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned.to_string())
            }
        })
        .collect()
}

/// Turn user input into a safe FTS5 `MATCH` expression, or `None` for blank /
/// operator-only input. Each term becomes a quoted prefix token, so punctuation
/// and operators are literal text.
pub fn escape_fts_query(query: &str) -> Option<String> {
    let terms = query_terms(query);
    if terms.is_empty() {
        None
    } else {
        Some(
            terms
                .iter()
                .map(|term| format!("\"{term}\"*"))
                .collect::<Vec<_>>()
                .join(" "),
        )
    }
}

/// Escape LIKE metacharacters so `a_b` matches literally. Paired with `ESCAPE '\'`.
fn like_escape(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Build an ` AND f.abs_path IN (…)` fragment plus bound values restricting
/// results to `scope`. `None` = whole library (empty fragment); an empty slice
/// matches nothing (`AND 0`, since SQLite rejects a literal `IN ()`).
fn scope_clause(scope: Option<&[String]>) -> (String, Vec<Value>) {
    match scope {
        None => (String::new(), Vec::new()),
        Some(paths) if paths.is_empty() => (" AND 0".to_string(), Vec::new()),
        Some(paths) => {
            let placeholders = vec!["?"; paths.len()].join(",");
            let values = paths.iter().map(|p| Value::Text(p.clone())).collect();
            (format!(" AND f.abs_path IN ({placeholders})"), values)
        }
    }
}

fn search_by_name(
    conn: &Connection,
    terms: &[String],
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let mut clauses = Vec::with_capacity(terms.len());
    let mut values: Vec<Value> = Vec::new();
    for term in terms {
        clauses.push(
            "(f.filename LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\' \
              OR f.display_path LIKE ? ESCAPE '\\')",
        );
        let pattern = format!("%{}%", like_escape(term));
        values.push(Value::Text(pattern.clone()));
        values.push(Value::Text(pattern.clone()));
        values.push(Value::Text(pattern));
    }
    let (scope_sql, scope_values) = scope_clause(scope);
    values.extend(scope_values);
    values.push(Value::Integer(SEARCH_LIMIT));

    let sql = format!(
        "SELECT f.abs_path,
                COALESCE(NULLIF(f.title, ''), f.filename) AS title,
                f.display_path
         FROM files f
         WHERE f.status = 'ok' AND {}{}
         ORDER BY title COLLATE NOCASE, f.display_path COLLATE NOCASE
         LIMIT ?",
        clauses.join(" AND "),
        scope_sql,
    );

    let mut stmt = conn.prepare(&sql).map_err(to_err)?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            Ok(SearchHit {
                abs_path: row.get(0)?,
                title: row.get(1)?,
                start_line: 1,
                end_line: 1,
                anchor: None,
                snippet: row.get::<_, String>(2)?,
                score: 0.0,
            })
        })
        .map_err(to_err)?;
    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(to_err)?);
    }
    Ok(hits)
}

/// Rank chunks against the prepared `match_query` with FTS5 `bm25()` and return
/// per-chunk snippets, scoped to `status = 'ok'` files.
fn search_by_content(
    conn: &Connection,
    match_query: &str,
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    let (scope_sql, scope_values) = scope_clause(scope);
    let sql = format!(
        "SELECT f.abs_path,
                COALESCE(NULLIF(f.title, ''), f.filename) AS title,
                c.start_line, c.end_line, c.anchor,
                snippet(chunks_fts, 0, char(2), char(3), '…', 12) AS snip,
                bm25(chunks_fts) AS score
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN files f ON f.id = c.file_id
         WHERE chunks_fts MATCH ? AND f.status = 'ok'{}
         ORDER BY score
         LIMIT ?",
        scope_sql,
    );
    let mut values: Vec<Value> = Vec::with_capacity(scope_values.len() + 2);
    values.push(Value::Text(match_query.to_string()));
    values.extend(scope_values);
    values.push(Value::Integer(SEARCH_LIMIT));
    let mut stmt = conn.prepare(&sql).map_err(to_err)?;

    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            Ok(SearchHit {
                abs_path: row.get(0)?,
                title: row.get(1)?,
                start_line: row.get::<_, i64>(2)? as u32,
                end_line: row.get::<_, i64>(3)? as u32,
                anchor: row.get(4)?,
                snippet: row.get(5)?,
                score: row.get(6)?,
            })
        })
        .map_err(to_err)?;

    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(to_err)?);
    }
    Ok(hits)
}

/// Search the library: filename/title/path matches first (a named file is a
/// strong hit), then content matches for files not already shown by name.
/// Scoped to `status = 'ok'`. Blank/operator queries return no hits.
pub fn search(
    conn: &Connection,
    query: &str,
    scope: Option<&[String]>,
) -> DbResult<Vec<SearchHit>> {
    let terms = query_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let limit = SEARCH_LIMIT as usize;
    let mut hits = search_by_name(conn, &terms, scope)?;
    let mut seen: HashSet<String> = hits.iter().map(|hit| hit.abs_path.clone()).collect();

    if hits.len() < limit {
        if let Some(match_query) = escape_fts_query(query) {
            for hit in search_by_content(conn, &match_query, scope)? {
                if hits.len() >= limit {
                    break;
                }
                if seen.insert(hit.abs_path.clone()) {
                    hits.push(hit);
                }
            }
        }
    }

    hits.truncate(limit);
    Ok(hits)
}

// ---------------------------------------------------------------------------
// File writes
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ExistingFile {
    id: i64,
    mtime: i64,
    size: i64,
    derived_version: i64,
    content_hash: Option<String>,
}

fn lookup_file(conn: &Connection, abs_path: &str) -> DbResult<Option<ExistingFile>> {
    conn.query_row(
        "SELECT id, mtime, size_bytes, derived_version, content_hash
         FROM files WHERE abs_path = ?1",
        params![abs_path],
        |row| {
            Ok(ExistingFile {
                id: row.get(0)?,
                mtime: row.get(1)?,
                size: row.get(2)?,
                derived_version: row.get(3)?,
                content_hash: row.get(4)?,
            })
        },
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(to_err(other)),
    })
}

fn update_last_seen(conn: &Connection, file_id: i64, scan_run_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE files SET last_seen_scan_id = ?2 WHERE id = ?1",
        params![file_id, scan_run_id],
    )
    .map_err(to_err)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_file_record(
    conn: &mut Connection,
    root_id: i64,
    abs_path: &str,
    display_path: &str,
    filename: &str,
    size: i64,
    mtime: i64,
    status: &str,
    content_hash: Option<&str>,
    title: Option<&str>,
    headings: &[Heading],
    chunks: &[Chunk],
    frontmatter: &[FrontmatterField],
    links: &[DocLink],
    scan_run_id: Option<i64>,
) -> DbResult<i64> {
    let tx = conn.transaction().map_err(to_err)?;
    let now = now_secs();
    let file_id: i64 = tx
        .query_row(
            "INSERT INTO files
                (scan_root_id, abs_path, display_path, filename, size_bytes, mtime,
                 content_hash, title, derived_version, last_indexed, last_seen_scan_id,
                 status, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)
             ON CONFLICT(abs_path) DO UPDATE SET
                scan_root_id = excluded.scan_root_id,
                display_path = excluded.display_path,
                filename = excluded.filename,
                size_bytes = excluded.size_bytes,
                mtime = excluded.mtime,
                content_hash = excluded.content_hash,
                title = excluded.title,
                derived_version = excluded.derived_version,
                last_indexed = excluded.last_indexed,
                last_seen_scan_id = COALESCE(excluded.last_seen_scan_id, last_seen_scan_id),
                status = excluded.status,
                error = NULL
             RETURNING id",
            params![
                root_id,
                abs_path,
                display_path,
                filename,
                size,
                mtime,
                content_hash,
                title,
                CURRENT_DERIVED_VERSION,
                now,
                scan_run_id,
                status,
            ],
            |row| row.get(0),
        )
        .map_err(to_err)?;

    // Headings are part of the base parse; always replace them for this file.
    tx.execute("DELETE FROM headings WHERE file_id = ?1", params![file_id])
        .map_err(to_err)?;
    if status == "ok" {
        for heading in headings {
            tx.execute(
                "INSERT INTO headings (file_id, ordinal, depth, text) VALUES (?1, ?2, ?3, ?4)",
                params![file_id, heading.ordinal, heading.depth, heading.text],
            )
            .map_err(to_err)?;
        }
        // Rebuild derived features and record readiness in this same transaction.
        replace_chunks(&tx, file_id, chunks)?;
        replace_frontmatter(&tx, file_id, frontmatter)?;
        replace_links(&tx, file_id, links)?;
        if let Some(hash) = content_hash {
            mark_feature_ready(&tx, file_id, CHUNKS_FEATURE, CHUNKS_SCHEMA_VERSION, hash)?;
            mark_feature_ready(
                &tx,
                file_id,
                FRONTMATTER_FEATURE,
                FRONTMATTER_SCHEMA_VERSION,
                hash,
            )?;
            mark_feature_ready(&tx, file_id, LINKS_FEATURE, LINKS_SCHEMA_VERSION, hash)?;
        }
    } else {
        // A file leaving `ok` loses its derived data and feature readiness in the
        // same transaction as the status update.
        delete_chunks(&tx, file_id)?;
        delete_frontmatter(&tx, file_id)?;
        delete_links(&tx, file_id)?;
        tx.execute(
            "DELETE FROM file_feature_state WHERE file_id = ?1",
            params![file_id],
        )
        .map_err(to_err)?;
    }
    tx.commit().map_err(to_err)?;
    Ok(file_id)
}

fn mark_root_completed(conn: &Connection, scan_run_id: i64, root_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE scan_run_roots SET completed = 1 WHERE scan_run_id = ?1 AND scan_root_id = ?2",
        params![scan_run_id, root_id],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Mark `ok` files under a completed root missing when they weren't seen this
/// scan, clearing their derived data too. Only touches `ok` rows, so skipped or
/// failed roots never demote.
fn mark_missing_for_root(conn: &mut Connection, root_id: i64, scan_run_id: i64) -> DbResult<()> {
    let tx = conn.transaction().map_err(to_err)?;
    // Drop derived data for the files about to be demoted (`chunks_ad` clears
    // their FTS rows); the predicate matches the status update below.
    tx.execute(
        "DELETE FROM chunks WHERE file_id IN (
            SELECT id FROM files
            WHERE scan_root_id = ?1 AND status = 'ok'
              AND (last_seen_scan_id IS NULL OR last_seen_scan_id <> ?2))",
        params![root_id, scan_run_id],
    )
    .map_err(to_err)?;
    tx.execute(
        "DELETE FROM frontmatter WHERE file_id IN (
            SELECT id FROM files
            WHERE scan_root_id = ?1 AND status = 'ok'
              AND (last_seen_scan_id IS NULL OR last_seen_scan_id <> ?2))",
        params![root_id, scan_run_id],
    )
    .map_err(to_err)?;
    tx.execute(
        "DELETE FROM links WHERE from_file_id IN (
            SELECT id FROM files
            WHERE scan_root_id = ?1 AND status = 'ok'
              AND (last_seen_scan_id IS NULL OR last_seen_scan_id <> ?2))",
        params![root_id, scan_run_id],
    )
    .map_err(to_err)?;
    tx.execute(
        "DELETE FROM file_feature_state WHERE file_id IN (
            SELECT id FROM files
            WHERE scan_root_id = ?1 AND status = 'ok'
              AND (last_seen_scan_id IS NULL OR last_seen_scan_id <> ?2))",
        params![root_id, scan_run_id],
    )
    .map_err(to_err)?;
    tx.execute(
        "UPDATE files SET status = 'missing'
         WHERE scan_root_id = ?1 AND status = 'ok'
           AND (last_seen_scan_id IS NULL OR last_seen_scan_id <> ?2)",
        params![root_id, scan_run_id],
    )
    .map_err(to_err)?;
    tx.commit().map_err(to_err)?;
    Ok(())
}

/// Keep the last 5 completed scan runs; cascades drop their `scan_run_roots`,
/// and `files.last_seen_scan_id` is set null by the foreign key.
fn prune_old_runs(conn: &Connection) -> DbResult<()> {
    conn.execute(
        "DELETE FROM scan_runs
         WHERE completed = 1 AND id NOT IN (
            SELECT id FROM scan_runs WHERE completed = 1 ORDER BY id DESC LIMIT 5)",
        [],
    )
    .map_err(to_err)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

#[derive(Default)]
struct FolderBuild {
    name: String,
    path: String,
    subfolders: std::collections::BTreeMap<String, FolderBuild>,
    files: Vec<FileTreeNode>,
}

fn folder_to_node(folder: FolderBuild) -> FileTreeNode {
    let mut children: Vec<FileTreeNode> = folder
        .subfolders
        .into_values()
        .map(folder_to_node)
        .collect();
    let mut files = folder.files;
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    children.extend(files);
    FileTreeNode {
        name: folder.name,
        path: folder.path,
        kind: NodeKind::Folder,
        title: None,
        children,
    }
}

/// Build the pruned folder/file forest from the `ok` file rows. A folder exists
/// only as an ancestor of an included file, so empty branches never appear.
pub fn build_tree(conn: &Connection) -> DbResult<Vec<FileTreeNode>> {
    let mut stmt = conn
        .prepare(
            "SELECT r.path, f.display_path, f.filename, f.abs_path, f.title
             FROM files f JOIN scan_roots r ON r.id = f.scan_root_id
             WHERE f.status = 'ok'
             ORDER BY r.path, f.display_path",
        )
        .map_err(to_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(to_err)?;

    let mut roots: std::collections::BTreeMap<String, FolderBuild> =
        std::collections::BTreeMap::new();

    for row in rows {
        let (root_path, display_path, filename, abs_path, title) = row.map_err(to_err)?;
        let root_entry = roots
            .entry(root_path.clone())
            .or_insert_with(|| FolderBuild {
                name: root_label(&root_path),
                path: root_path.clone(),
                ..FolderBuild::default()
            });

        // Folder components are everything in display_path before the filename.
        let mut components: Vec<&str> = display_path
            .split(['/', '\\'])
            .filter(|part| !part.is_empty())
            .collect();
        components.pop(); // drop the file name itself

        let mut folder = &mut *root_entry;
        let mut folder_path = PathBuf::from(&root_path);
        for component in components {
            folder_path.push(component);
            let key = component.to_string();
            let path_string = path_to_string(&folder_path);
            folder = folder
                .subfolders
                .entry(key.clone())
                .or_insert_with(|| FolderBuild {
                    name: key,
                    path: path_string,
                    ..FolderBuild::default()
                });
        }

        folder.files.push(FileTreeNode {
            name: filename,
            path: abs_path,
            kind: NodeKind::File,
            title,
            children: Vec::new(),
        });
    }

    Ok(roots.into_values().map(folder_to_node).collect())
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

/// The label shown on a graph node: the document title, else its filename with a
/// Markdown extension stripped.
fn graph_label(title: Option<&str>, filename: &str) -> String {
    match title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => stem_of(filename),
    }
}

/// Build the library link graph: one node per `ok` document, one undirected edge
/// per link resolving to another indexed document. Path links match `abs_path`
/// (exact, then case-insensitively); `[[wiki]]` links match a filename stem.
/// Dangling links contribute no edge. `request` chooses the slice (see
/// [`GraphRequest`]).
pub fn build_graph(conn: &Connection, request: &GraphRequest) -> DbResult<DocumentGraph> {
    // 1. Load every indexed document and index it by id + resolution keys.
    struct Row {
        id: i64,
        path: String,
        label: String,
    }
    let mut stmt = conn
        .prepare("SELECT id, abs_path, filename, title FROM files WHERE status = 'ok'")
        .map_err(to_err)?;
    let rows: Vec<Row> = stmt
        .query_map([], |row| {
            let path: String = row.get(1)?;
            let filename: String = row.get(2)?;
            let title: Option<String> = row.get(3)?;
            Ok(Row {
                id: row.get(0)?,
                label: graph_label(title.as_deref(), &filename),
                path,
            })
        })
        .map_err(to_err)?
        .collect::<Result<_, _>>()
        .map_err(to_err)?;

    let mut path_to_id: HashMap<String, i64> = HashMap::with_capacity(rows.len());
    let mut lower_path_to_id: HashMap<String, i64> = HashMap::with_capacity(rows.len());
    // Name keys can collide across folders; first writer wins, which is a fine
    // best-effort for wiki-style links in a flat vault.
    let mut name_to_id: HashMap<String, i64> = HashMap::new();
    for row in &rows {
        path_to_id.insert(row.path.clone(), row.id);
        lower_path_to_id
            .entry(row.path.to_lowercase())
            .or_insert(row.id);
        let filename = Path::new(&row.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        name_to_id
            .entry(normalize_name_key(&stem_of(&filename)))
            .or_insert(row.id);
    }

    // 2. Resolve every link to a target document id, collecting undirected edges
    //    keyed by the ordered id pair so A->B and B->A collapse to one edge.
    let mut link_stmt = conn
        .prepare("SELECT from_file_id, target_abs, target_name FROM links")
        .map_err(to_err)?;
    let resolved = link_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(to_err)?;

    let mut edge_set: HashSet<(i64, i64)> = HashSet::new();
    for entry in resolved {
        let (from_id, target_abs, target_name) = entry.map_err(to_err)?;
        let to_id = target_abs
            .as_deref()
            .and_then(|abs| {
                path_to_id
                    .get(abs)
                    .or_else(|| lower_path_to_id.get(&abs.to_lowercase()))
                    .copied()
            })
            .or_else(|| {
                target_name
                    .as_deref()
                    .and_then(|name| name_to_id.get(name).copied())
            });
        let Some(to_id) = to_id else { continue };
        if to_id == from_id {
            continue; // a document linking itself is not an edge
        }
        let key = if from_id < to_id {
            (from_id, to_id)
        } else {
            (to_id, from_id)
        };
        edge_set.insert(key);
    }

    // 3. Degree per node, then choose which documents to keep for the requested
    //    scope: a focused neighborhood, the densest N, or everything.
    let mut degree: HashMap<i64, u32> = HashMap::new();
    for (a, b) in &edge_set {
        *degree.entry(*a).or_insert(0) += 1;
        *degree.entry(*b).or_insert(0) += 1;
    }

    let (kept, truncated): (Vec<&Row>, bool) = if let Some(seeds) = &request.focus {
        // Focus: the seed documents plus every document one link away. Seeds are
        // paths the frontend stored as node ids; resolve them exactly, then
        // case-insensitively (matching how links resolve on Windows).
        let mut adjacency: HashMap<i64, Vec<i64>> = HashMap::new();
        for (a, b) in &edge_set {
            adjacency.entry(*a).or_default().push(*b);
            adjacency.entry(*b).or_default().push(*a);
        }
        let mut included: HashSet<i64> = HashSet::new();
        for seed in seeds {
            let id = path_to_id
                .get(seed)
                .or_else(|| lower_path_to_id.get(&seed.to_lowercase()))
                .copied();
            if let Some(id) = id {
                included.insert(id);
                if let Some(neighbors) = adjacency.get(&id) {
                    included.extend(neighbors.iter().copied());
                }
            }
        }
        (
            rows.iter()
                .filter(|row| included.contains(&row.id))
                .collect(),
            false,
        )
    } else if let Some(limit) = request.limit.filter(|limit| rows.len() > *limit) {
        // Capped: keep the densest documents, flag the result as partial.
        let mut ranked: Vec<&Row> = rows.iter().collect();
        ranked.sort_by(|a, b| {
            degree
                .get(&b.id)
                .unwrap_or(&0)
                .cmp(degree.get(&a.id).unwrap_or(&0))
                .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
        });
        ranked.truncate(limit);
        (ranked, true)
    } else {
        // Everything (the XL scope, or a capped scope under its limit).
        (rows.iter().collect(), false)
    };
    let kept_ids: HashSet<i64> = kept.iter().map(|row| row.id).collect();
    let id_to_path: HashMap<i64, &str> =
        kept.iter().map(|row| (row.id, row.path.as_str())).collect();

    let nodes: Vec<GraphNode> = kept
        .iter()
        .map(|row| GraphNode {
            path: row.path.clone(),
            label: row.label.clone(),
            degree: *degree.get(&row.id).unwrap_or(&0),
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_set
        .into_iter()
        .filter(|(a, b)| kept_ids.contains(a) && kept_ids.contains(b))
        .map(|(a, b)| GraphEdge {
            source: id_to_path[&a].to_string(),
            target: id_to_path[&b].to_string(),
        })
        .collect();

    Ok(DocumentGraph {
        nodes,
        edges,
        truncated,
    })
}

// ---------------------------------------------------------------------------
// Parse pool
// ---------------------------------------------------------------------------

struct ParseJob {
    root_id: i64,
    abs_path: PathBuf,
    display_path: String,
    filename: String,
    size: i64,
    mtime: i64,
}

enum FileOutcome {
    Indexed {
        content_hash: String,
        title: String,
        headings: Vec<Heading>,
        chunks: Vec<Chunk>,
        frontmatter: Vec<FrontmatterField>,
        links: Vec<DocLink>,
    },
    Unreadable,
    Cancelled,
}

struct ParseResult {
    job: ParseJob,
    outcome: FileOutcome,
}

/// Read, hash, and parse a single file. Pure CPU/IO; no database access. Hashes
/// the full indexed content (not a prefix) so edits anywhere change the hash.
fn process_file(job: &ParseJob, cancel: &AtomicBool) -> FileOutcome {
    if cancel.load(Ordering::SeqCst) {
        return FileOutcome::Cancelled;
    }
    // Read at most MAX_INDEX_BYTES; a file over the cap is indexed from this
    // prefix rather than skipped, so it still appears and is searchable.
    let mut bytes = Vec::new();
    match std::fs::File::open(io_path(&job.abs_path)) {
        Ok(file) => {
            if file.take(MAX_INDEX_BYTES).read_to_end(&mut bytes).is_err() {
                return FileOutcome::Unreadable;
            }
        }
        Err(_) => return FileOutcome::Unreadable,
    }
    // A file at/beyond the cap was cut off and may end in a partial codepoint.
    let truncated = bytes.len() as u64 >= MAX_INDEX_BYTES;
    if bytes.contains(&0u8) {
        return FileOutcome::Unreadable;
    }
    let content = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_string(),
        // A truncated read may split a char at the end; keep the valid prefix.
        Err(error) if truncated => {
            String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
        }
        Err(_) => return FileOutcome::Unreadable,
    };
    let content_hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    // Parsing runs here on the parse pool; the writer thread only persists.
    // Link extraction runs for every type so the graph can edge MD and XML.
    let links = document_links(&content, &job.abs_path);
    if is_xml_file(&job.abs_path) {
        // XML: take the document title and links; body isn't chunked for
        // search yet, so chunks/frontmatter stay empty.
        let (title, _body) = crate::render_xml_body(&content);
        FileOutcome::Indexed {
            content_hash,
            title: title.unwrap_or_else(|| stem_of(&job.filename)),
            headings: Vec::new(),
            chunks: Vec::new(),
            frontmatter: Vec::new(),
            links,
        }
    } else if is_data_file(&job.abs_path) {
        // JSON and YAML: the title only, as for XML. A data file has no headings
        // to outline, and its body isn't chunked for search yet.
        let title = data_title(&content, &job.abs_path);
        FileOutcome::Indexed {
            content_hash,
            title: title.unwrap_or_else(|| stem_of(&job.filename)),
            headings: Vec::new(),
            chunks: Vec::new(),
            frontmatter: Vec::new(),
            links,
        }
    } else {
        let parsed = parse_markdown(&content, &stem_of(&job.filename));
        let chunks = chunk_file(&content);
        let frontmatter = frontmatter_fields(&content);
        FileOutcome::Indexed {
            content_hash,
            title: parsed.title,
            headings: parsed.headings,
            chunks,
            frontmatter,
            links,
        }
    }
}

fn apply_result(
    conn: &mut Connection,
    result: ParseResult,
    scan_run_id: Option<i64>,
) -> DbResult<()> {
    let job = result.job;
    let abs = path_to_string(&job.abs_path);
    match result.outcome {
        FileOutcome::Indexed {
            content_hash,
            title,
            headings,
            chunks,
            frontmatter,
            links,
        } => {
            write_file_record(
                conn,
                job.root_id,
                &abs,
                &job.display_path,
                &job.filename,
                job.size,
                job.mtime,
                "ok",
                Some(&content_hash),
                Some(&title),
                &headings,
                &chunks,
                &frontmatter,
                &links,
                scan_run_id,
            )?;
        }
        FileOutcome::Unreadable => {
            write_file_record(
                conn,
                job.root_id,
                &abs,
                &job.display_path,
                &job.filename,
                job.size,
                job.mtime,
                "unreadable",
                None,
                None,
                &[],
                &[],
                &[],
                &[],
                scan_run_id,
            )?;
        }
        FileOutcome::Cancelled => {}
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/// Run one incremental scan over `roots`. Used for both the first crawl and
/// every later launch rescan; unchanged files fast-path on `mtime + size`.
fn run_scan(
    conn: &mut Connection,
    roots: &[ScanRoot],
    cancel: &Arc<AtomicBool>,
    sink: &dyn Fn(IndexerEvent),
) -> DbResult<()> {
    let scan_run_id: i64 = conn
        .query_row(
            "INSERT INTO scan_runs (started_at, completed) VALUES (?1, 0) RETURNING id",
            params![now_secs()],
            |row| row.get(0),
        )
        .map_err(to_err)?;
    for root in roots {
        conn.execute(
            "INSERT INTO scan_run_roots (scan_run_id, scan_root_id, completed) VALUES (?1, ?2, 0)",
            params![scan_run_id, root.id],
        )
        .map_err(to_err)?;
    }

    // Spin up the parse/hash pool. One bounded job queue (shared receiver) and an
    // unbounded result channel back to this writer thread.
    let (job_tx, job_rx) = mpsc::sync_channel::<ParseJob>(JOB_QUEUE_BOUND);
    let (result_tx, result_rx) = mpsc::channel::<ParseResult>();
    let job_rx = Arc::new(Mutex::new(job_rx));
    let mut workers: Vec<JoinHandle<()>> = Vec::with_capacity(PARSE_WORKERS);
    for _ in 0..PARSE_WORKERS {
        let rx = Arc::clone(&job_rx);
        let tx = result_tx.clone();
        let cancel = Arc::clone(cancel);
        workers.push(thread::spawn(move || loop {
            let job = {
                let guard = match rx.lock() {
                    Ok(guard) => guard,
                    Err(_) => break,
                };
                guard.recv()
            };
            match job {
                Ok(job) => {
                    let outcome = process_file(&job, &cancel);
                    if tx.send(ParseResult { job, outcome }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }));
    }
    drop(result_tx);

    let mut files_found: u64 = 0;
    let mut last_progress = Instant::now();
    let mut last_tree = Instant::now();
    let mut tree_dirty = false;

    // Tell the UI a scan is underway right away.
    sink(IndexerEvent::Progress(ScanProgress {
        phase: ScanPhase::Scanning,
        files_found,
    }));

    for root in roots {
        let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
        queue.push_back((root.path.clone(), 0));
        let mut dispatched = 0usize;
        let mut written = 0usize;
        let mut root_failed = false;

        while let Some((dir, depth)) = queue.pop_front() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let entries = match std::fs::read_dir(io_path(&dir)) {
                Ok(entries) => entries,
                Err(error) => {
                    if depth == 0 || !is_benign_dir_error(&error) {
                        // Root unreadable, or a non-benign error deeper: fail the
                        // root so its files aren't demoted on this partial run.
                        root_failed = true;
                        break;
                    }
                    continue;
                }
            };

            for entry in entries {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => continue,
                };
                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_string();
                let child = dir.join(&name);
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => continue,
                };

                if file_type.is_dir() {
                    if is_repo_noise_dir(&name_str) {
                        continue;
                    }
                    if depth == 0 && is_system_dir(&name_str) {
                        continue;
                    }
                    if is_dir_reparse(&child) {
                        continue;
                    }
                    queue.push_back((child, depth + 1));
                } else if file_type.is_file() && is_indexable_file(&child) {
                    files_found += 1;
                    if last_progress.elapsed() >= PROGRESS_THROTTLE {
                        sink(IndexerEvent::Progress(ScanProgress {
                            phase: ScanPhase::Scanning,
                            files_found,
                        }));
                        last_progress = Instant::now();
                    }

                    let meta = match std::fs::metadata(io_path(&child)) {
                        Ok(meta) => meta,
                        Err(_) => continue,
                    };
                    let size = meta.len() as i64;
                    let mtime = mtime_secs(&meta);
                    let abs = path_to_string(&child);

                    let existing = lookup_file(conn, &abs)?;
                    let fast_id = if let Some(existing) = &existing {
                        if existing.mtime == mtime
                            && existing.size == size
                            && existing.derived_version == CURRENT_DERIVED_VERSION
                            && all_features_current(
                                conn,
                                existing.id,
                                existing.content_hash.as_deref(),
                            )?
                        {
                            Some(existing.id)
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    if let Some(id) = fast_id {
                        update_last_seen(conn, id, scan_run_id)?;
                    } else {
                        let job = ParseJob {
                            root_id: root.id,
                            display_path: display_path_for(&root.path, &child),
                            filename: name_str.clone(),
                            abs_path: child.clone(),
                            size,
                            mtime,
                        };
                        if job_tx.send(job).is_ok() {
                            dispatched += 1;
                            tree_dirty = true;
                        }
                        // Apply any results that are ready so memory stays bounded
                        // and the tree refresh below has fresh rows.
                        while let Ok(result) = result_rx.try_recv() {
                            apply_result(conn, result, Some(scan_run_id))?;
                            written += 1;
                        }
                    }

                    if tree_dirty && last_tree.elapsed() >= TREE_THROTTLE {
                        // Drain what is ready before snapshotting so shallow files
                        // surface first.
                        while let Ok(result) = result_rx.try_recv() {
                            apply_result(conn, result, Some(scan_run_id))?;
                            written += 1;
                        }
                        let tree = build_tree(conn)?;
                        sink(IndexerEvent::Library {
                            tree,
                            progress: ScanProgress {
                                phase: ScanPhase::Scanning,
                                files_found,
                            },
                        });
                        last_tree = Instant::now();
                        tree_dirty = false;
                    }
                }
            }
        }

        // Drain every dispatched result for this root before deciding completion
        // (workers always send one result per job, even when cancelling).
        while written < dispatched {
            match result_rx.recv() {
                Ok(result) => {
                    apply_result(conn, result, Some(scan_run_id))?;
                    written += 1;
                }
                Err(_) => break,
            }
        }

        // Missing-marking is gated on per-root completion, so a cancelled or
        // failed root never demotes its files.
        if !cancel.load(Ordering::SeqCst) && !root_failed {
            mark_root_completed(conn, scan_run_id, root.id)?;
            mark_missing_for_root(conn, root.id, scan_run_id)?;
        }
    }

    // Close the job channel and wait for the pool to wind down.
    drop(job_tx);
    for worker in workers {
        let _ = worker.join();
    }

    if !cancel.load(Ordering::SeqCst) {
        conn.execute(
            "UPDATE scan_runs SET finished_at = ?2, completed = 1 WHERE id = ?1",
            params![scan_run_id, now_secs()],
        )
        .map_err(to_err)?;
        prune_old_runs(conn)?;
    }

    // Final snapshot: hide the scanning indicator and deliver the settled tree.
    let tree = build_tree(conn)?;
    sink(IndexerEvent::Library {
        tree,
        progress: ScanProgress {
            phase: ScanPhase::Idle,
            files_found,
        },
    });
    Ok(())
}

fn perform_scan(conn: &mut Connection, cancel: &Arc<AtomicBool>, sink: &dyn Fn(IndexerEvent)) {
    let roots = detect_roots();
    let scan_roots = match ensure_roots(conn, &roots) {
        Ok(roots) => roots,
        Err(error) => {
            sink(IndexerEvent::Error(error));
            return;
        }
    };
    if let Err(error) = run_scan(conn, &scan_roots, cancel, sink) {
        sink(IndexerEvent::Error(error));
    }
}

/// Normalize a path for manifest storage: make it absolute, then strip any
/// `\\?\` prefix to match the crawl's convention. `None` when a relative path
/// has no current directory to anchor against.
fn resolve_for_manifest(path: &Path) -> Option<PathBuf> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    Some(normal_path(&abs))
}

/// Push the current tree to the pane after a single-file change. Errors surface
/// as a backend error event rather than silently leaving the pane stale.
fn emit_tree(conn: &Connection, sink: &dyn Fn(IndexerEvent)) {
    match build_tree(conn) {
        Ok(tree) => sink(IndexerEvent::Library {
            tree,
            progress: ScanProgress {
                phase: ScanPhase::Idle,
                files_found: 0,
            },
        }),
        Err(error) => sink(IndexerEvent::Error(error)),
    }
}

/// Bring one path up to date with disk, outside any crawl: index a readable
/// file or forget a gone one. The live path for opened/edited files and the
/// right-click actions.
fn sync_markdown_file(conn: &mut Connection, abs: &Path) -> DbResult<()> {
    let Some(root) = abs.ancestors().last().map(Path::to_path_buf) else {
        return Ok(());
    };
    let meta = std::fs::metadata(io_path(abs)).map_err(to_err)?;
    let scan_root = match ensure_roots(conn, &[root.clone()]) {
        Ok(roots) => match roots.into_iter().next() {
            Some(root) => root,
            None => return Ok(()),
        },
        Err(error) => return Err(error),
    };

    let job = ParseJob {
        root_id: scan_root.id,
        display_path: display_path_for(&root, abs),
        filename: abs
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        abs_path: abs.to_path_buf(),
        size: meta.len() as i64,
        mtime: mtime_secs(&meta),
    };
    let never_cancel = AtomicBool::new(false);
    let outcome = process_file(&job, &never_cancel);
    apply_result(conn, ParseResult { job, outcome }, None)
}

fn like_prefix(prefix: &str) -> String {
    let mut escaped = String::with_capacity(prefix.len());
    for ch in prefix.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '%' => escaped.push_str("\\%"),
            '_' => escaped.push_str("\\_"),
            _ => escaped.push(ch),
        }
    }
    escaped.push('%');
    escaped
}

fn forget_directory_tree(conn: &mut Connection, dir: &Path, sink: &dyn Fn(IndexerEvent)) {
    let dir_text = path_to_string(dir);
    let prefix = if dir_text.ends_with(['/', '\\']) {
        dir_text.clone()
    } else {
        format!("{dir_text}{}", std::path::MAIN_SEPARATOR)
    };
    let like = like_prefix(&prefix);
    let removed = match conn.execute(
        "DELETE FROM files WHERE abs_path LIKE ?1 ESCAPE '\\'",
        params![like],
    ) {
        Ok(count) => count,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    if removed > 0 {
        emit_tree(conn, sink);
    }
}

fn sync_directory_tree(conn: &mut Connection, dir: &Path, sink: &dyn Fn(IndexerEvent)) {
    let mut queue = VecDeque::from([dir.to_path_buf()]);
    let mut seen = HashSet::new();

    while let Some(current) = queue.pop_front() {
        let entries = match std::fs::read_dir(io_path(&current)) {
            Ok(entries) => entries,
            Err(error) => {
                if is_benign_dir_error(&error) {
                    continue;
                }
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let child = current.join(entry.file_name());
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };

            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_repo_noise_dir(&name) || is_dir_reparse(&child) {
                    continue;
                }
                queue.push_back(child);
                continue;
            }

            if !file_type.is_file() || !is_indexable_file(&child) {
                continue;
            }

            let abs = normal_path(&child);
            seen.insert(path_to_string(&abs));
            if let Err(error) = sync_markdown_file(conn, &abs) {
                sink(IndexerEvent::Error(error));
                return;
            }
        }
    }

    let dir_text = path_to_string(dir);
    let prefix = if dir_text.ends_with(['/', '\\']) {
        dir_text.clone()
    } else {
        format!("{dir_text}{}", std::path::MAIN_SEPARATOR)
    };
    let like = like_prefix(&prefix);
    let mut stale =
        match conn.prepare("SELECT abs_path FROM files WHERE abs_path LIKE ?1 ESCAPE '\\'") {
            Ok(stmt) => stmt,
            Err(error) => {
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        };
    let rows = match stale.query_map(params![like], |row| row.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    let stale_paths: Vec<String> = rows.filter_map(Result::ok).collect();
    drop(stale);

    for abs_path in stale_paths {
        if !seen.contains(&abs_path) {
            if let Err(error) =
                conn.execute("DELETE FROM files WHERE abs_path = ?1", params![abs_path])
            {
                sink(IndexerEvent::Error(to_err(error)));
                return;
            }
        }
    }

    emit_tree(conn, sink);
}

fn sync_single_file(conn: &mut Connection, path: &Path, sink: &dyn Fn(IndexerEvent)) {
    let Some(abs) = resolve_for_manifest(path) else {
        return;
    };
    match std::fs::metadata(io_path(&abs)) {
        Ok(meta) if meta.is_dir() => {
            sync_directory_tree(conn, &abs, sink);
        }
        Ok(meta) if meta.is_file() && is_indexable_file(&abs) => {
            if let Err(error) = sync_markdown_file(conn, &abs) {
                sink(IndexerEvent::Error(error));
                return;
            }
            emit_tree(conn, sink);
        }
        Ok(_) => {}
        Err(_) if is_indexable_file(&abs) => {
            forget_single_file(conn, &abs, sink);
        }
        Err(_) => {
            forget_directory_tree(conn, &abs, sink);
        }
    }
}

/// Drop one file from the manifest; foreign keys cascade to its headings,
/// chunks, frontmatter, and feature state. Refreshes the pane only when a row
/// was removed.
fn forget_single_file(conn: &mut Connection, abs: &Path, sink: &dyn Fn(IndexerEvent)) {
    let removed = match conn.execute(
        "DELETE FROM files WHERE abs_path = ?1",
        params![path_to_string(abs)],
    ) {
        Ok(count) => count,
        Err(error) => {
            sink(IndexerEvent::Error(to_err(error)));
            return;
        }
    };
    if removed > 0 {
        emit_tree(conn, sink);
    }
}

// ---------------------------------------------------------------------------
// Worker handle
// ---------------------------------------------------------------------------

enum WriterCmd {
    Scan,
    SyncPath(PathBuf),
}

enum ReaderCmd {
    Tree,
    Search {
        query: String,
        /// When `Some`, restrict results to these document paths (the "Focus"
        /// search scope); `None` searches the whole library.
        scope: Option<Vec<String>>,
    },
    Graph(GraphRequest),
}

/// Owns the indexer's threads: a writer/coordinator (write connection + crawl)
/// and a reader (read-only connection) for tree/search/graph queries. Results
/// arrive through the sink passed to [`new`](IndexerWorker::new).
pub struct IndexerWorker {
    writer_tx: Option<mpsc::Sender<WriterCmd>>,
    reader_tx: Option<mpsc::Sender<ReaderCmd>>,
    cancel: Arc<AtomicBool>,
    writer_handle: Option<JoinHandle<()>>,
    reader_handle: Option<JoinHandle<()>>,
}

impl IndexerWorker {
    /// Open the database (creating + migrating it on this thread so the reader's
    /// connection sees the schema), then spawn the writer and reader threads.
    pub fn new<F>(data_dir: PathBuf, sink: F) -> DbResult<Self>
    where
        F: Fn(IndexerEvent) + Send + Clone + 'static,
    {
        let write_conn = open_db(&data_dir)?;
        let cancel = Arc::new(AtomicBool::new(false));

        let (writer_tx, writer_rx) = mpsc::channel::<WriterCmd>();
        let (reader_tx, reader_rx) = mpsc::channel::<ReaderCmd>();

        let writer_sink = sink.clone();
        let writer_cancel = Arc::clone(&cancel);
        let writer_handle = thread::spawn(move || {
            let mut conn = write_conn;
            while let Ok(cmd) = writer_rx.recv() {
                match cmd {
                    WriterCmd::Scan => {
                        perform_scan(&mut conn, &writer_cancel, &writer_sink);
                    }
                    WriterCmd::SyncPath(path) => {
                        // Index or forget this one path, even when the "Index
                        // entire device" toggle is off.
                        sync_single_file(&mut conn, &path, &writer_sink);
                    }
                }
            }
        });

        let reader_sink = sink;
        let reader_handle = thread::spawn(move || {
            let conn = match open_read_db(&data_dir) {
                Ok(conn) => conn,
                Err(error) => {
                    reader_sink(IndexerEvent::Error(error));
                    return;
                }
            };
            while let Ok(cmd) = reader_rx.recv() {
                match cmd {
                    ReaderCmd::Tree => match build_tree(&conn) {
                        Ok(tree) => reader_sink(IndexerEvent::Library {
                            tree,
                            progress: ScanProgress {
                                phase: ScanPhase::Idle,
                                files_found: 0,
                            },
                        }),
                        Err(error) => reader_sink(IndexerEvent::Error(error)),
                    },
                    ReaderCmd::Search { query, scope } => {
                        let event = match search(&conn, &query, scope.as_deref()) {
                            Ok(hits) => IndexerEvent::SearchResults {
                                query,
                                hits,
                                error: None,
                            },
                            Err(error) => IndexerEvent::SearchResults {
                                query,
                                hits: Vec::new(),
                                error: Some(error),
                            },
                        };
                        reader_sink(event);
                    }
                    ReaderCmd::Graph(request) => {
                        let event = match build_graph(&conn, &request) {
                            Ok(graph) => IndexerEvent::Graph { graph, error: None },
                            Err(error) => IndexerEvent::Graph {
                                graph: DocumentGraph {
                                    nodes: Vec::new(),
                                    edges: Vec::new(),
                                    truncated: false,
                                },
                                error: Some(error),
                            },
                        };
                        reader_sink(event);
                    }
                }
            }
        });

        Ok(Self {
            writer_tx: Some(writer_tx),
            reader_tx: Some(reader_tx),
            cancel,
            writer_handle: Some(writer_handle),
            reader_handle: Some(reader_handle),
        })
    }

    /// Turn indexing on (start an immediate crawl / launch rescan) or off (cancel
    /// any active crawl promptly; no future scans are scheduled).
    pub fn set_indexing_enabled(&self, enabled: bool) {
        if enabled {
            self.cancel.store(false, Ordering::SeqCst);
            if let Some(tx) = &self.writer_tx {
                let _ = tx.send(WriterCmd::Scan);
            }
        } else {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Ask for the current tree from the read-only connection. Answers promptly
    /// even mid-crawl.
    pub fn request_tree(&self) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Tree);
        }
    }

    /// Run a full-text search on the read-only connection. Results arrive through
    /// the sink as [`IndexerEvent::SearchResults`], so a long crawl never blocks
    /// the query.
    pub fn search(&self, query: String, scope: Option<Vec<String>>) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Search { query, scope });
        }
    }

    /// Build the library link graph on the read-only connection; the result
    /// arrives via the sink as [`IndexerEvent::Graph`].
    pub fn request_graph(&self, request: GraphRequest) {
        if let Some(tx) = &self.reader_tx {
            let _ = tx.send(ReaderCmd::Graph(request));
        }
    }

    /// Bring one path up to date now (index if present, forget if gone),
    /// independent of the device-wide toggle. Keeps the pane current with "Index
    /// entire device" off.
    pub fn sync_path(&self, path: PathBuf) {
        if let Some(tx) = &self.writer_tx {
            let _ = tx.send(WriterCmd::SyncPath(path));
        }
    }
}

impl Drop for IndexerWorker {
    fn drop(&mut self) {
        // Cancel any crawl, then close the command channels so both threads fall
        // out of their recv loops, and join them.
        self.cancel.store(true, Ordering::SeqCst);
        self.writer_tx.take();
        self.reader_tx.take();
        if let Some(handle) = self.writer_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.reader_handle.take() {
            let _ = handle.join();
        }
    }
}

// ---------------------------------------------------------------------------
// Event -> JS bridge
// ---------------------------------------------------------------------------

/// Turn an [`IndexerEvent`] into the JS call that delivers it to the webview.
/// The frontend escapes every file-derived string before it reaches the DOM.
pub fn event_script(event: &IndexerEvent) -> String {
    match event {
        IndexerEvent::Library { tree, progress } => {
            let payload = serde_json::json!({
                "tree": tree,
                "progress": progress,
                "error": serde_json::Value::Null,
            });
            format!("window.leafSetLibraryState({payload});")
        }
        IndexerEvent::Progress(progress) => {
            let payload = serde_json::to_string(progress).unwrap_or_else(|_| "null".to_string());
            format!("window.leafSetScanProgress({payload});")
        }
        IndexerEvent::SearchResults { query, hits, error } => {
            let payload = serde_json::json!({
                "query": query,
                "hits": hits,
                "error": error.as_ref().map(|message| serde_json::json!({ "message": message })),
            });
            format!("window.leafSetSearchResults({payload});")
        }
        IndexerEvent::Graph { graph, error } => {
            let payload = serde_json::json!({
                "nodes": graph.nodes,
                "edges": graph.edges,
                "truncated": graph.truncated,
                "error": error.as_ref().map(|message| serde_json::json!({ "message": message })),
            });
            format!("window.leafSetGraph({payload});")
        }
        IndexerEvent::Error(message) => {
            let payload = serde_json::json!({
                "tree": serde_json::Value::Null,
                "progress": serde_json::Value::Null,
                "error": { "message": message },
            });
            format!("window.leafSetLibraryState({payload});")
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    fn unique_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("leaf-indexer-{tag}-{nanos}-{n}"));
        std::fs::create_dir_all(&dir).expect("temp dir created");
        dir
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent created");
        }
        std::fs::write(path, contents).expect("file written");
    }

    /// Run a scan over an explicit root (not the whole device).
    fn scan(conn: &mut Connection, root: &Path) {
        let roots = ensure_roots(conn, &[root.to_path_buf()]).expect("roots ensured");
        let cancel = Arc::new(AtomicBool::new(false));
        run_scan(conn, &roots, &cancel, &|_| {}).expect("scan ran");
    }

    fn flatten_paths(nodes: &[FileTreeNode], out: &mut Vec<String>) {
        for node in nodes {
            match node.kind {
                NodeKind::File => out.push(node.path.clone()),
                NodeKind::Folder => flatten_paths(&node.children, out),
            }
        }
    }

    fn status_of(conn: &Connection, abs: &str) -> Option<String> {
        conn.query_row(
            "SELECT status FROM files WHERE abs_path = ?1",
            params![abs],
            |row| row.get(0),
        )
        .ok()
    }

    fn title_of(conn: &Connection, abs: &str) -> Option<String> {
        conn.query_row(
            "SELECT title FROM files WHERE abs_path = ?1",
            params![abs],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    #[test]
    fn migrations_create_schema_at_current_version() {
        let dir = unique_dir("migrate");
        let conn = open_db(&dir).expect("db opens");
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("version row");
        assert_eq!(version, SCHEMA_VERSION);
        // Every table the indexer + full-text-search plans name exists.
        for table in [
            "scan_roots",
            "scan_runs",
            "scan_run_roots",
            "files",
            "headings",
            "file_feature_state",
            "chunks",
            "chunks_fts",
            "frontmatter",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
                    params![table],
                    |row| row.get(0),
                )
                .expect("table query");
            assert!(count >= 1, "missing table {table}");
        }
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reopening_keeps_indexed_files_and_does_not_remigrate() {
        // Stand in for "an older manifest upgrades without losing indexed files":
        // a second open runs no migration and the rows survive.
        let dir = unique_dir("reopen");
        let root = dir.join("vault");
        write_file(&root.join("note.md"), "# Note\n");
        {
            let mut conn = open_db(&dir).expect("db opens");
            scan(&mut conn, &root);
        }
        let conn = open_db(&dir).expect("db reopens");
        let files: i64 = conn
            .query_row("SELECT COUNT(*) FROM files WHERE status='ok'", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(files, 1);
        let migrations: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(migrations, SCHEMA_VERSION);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn builds_pruned_tree_with_titles_and_status_filter() {
        let dir = unique_dir("tree");
        let root = dir.join("vault");
        write_file(&root.join("README.md"), "# Guide\n\ncontent");
        write_file(&root.join("docs").join("intro.md"), "# Intro\n");
        write_file(
            &root.join("docs").join("deep").join("more.md"),
            "no heading\n",
        );
        // A folder with no Markdown must be pruned away.
        std::fs::create_dir_all(root.join("empty-folder")).expect("empty dir");
        // A non-Markdown file is ignored.
        write_file(&root.join("notes.txt"), "ignored");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let tree = build_tree(&conn).expect("tree built");

        // One root node.
        assert_eq!(tree.len(), 1);
        let root_node = &tree[0];
        assert_eq!(root_node.kind, NodeKind::Folder);

        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        assert_eq!(paths.len(), 3, "three Markdown files");
        assert!(paths.iter().any(|p| p.ends_with("README.md")));
        assert!(paths.iter().any(|p| p.ends_with("more.md")));

        // Empty folder pruned: the only child folder is `docs`.
        let folder_names: Vec<&str> = root_node
            .children
            .iter()
            .filter(|c| c.kind == NodeKind::Folder)
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(folder_names, vec!["docs"]);

        // Title comes from the first H1; the headingless file falls back to its
        // file name.
        let readme = root_node
            .children
            .iter()
            .find(|c| c.name == "README.md")
            .expect("readme node");
        assert_eq!(readme.title.as_deref(), Some("Guide"));
        let more = {
            let docs = root_node
                .children
                .iter()
                .find(|c| c.name == "docs")
                .expect("docs node");
            let deep = docs
                .children
                .iter()
                .find(|c| c.name == "deep")
                .expect("deep node");
            deep.children
                .iter()
                .find(|c| c.name == "more.md")
                .expect("more node")
                .clone()
        };
        assert_eq!(more.title.as_deref(), Some("more"));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_index_adds_a_single_file_in_normal_form() {
        // The live-update path indexes one file outside any crawl; it must land
        // in the manifest at the exact path passed.
        let dir = unique_dir("manual");
        let file = dir.join("note.md");
        write_file(&file, "# Note\n");

        let mut conn = open_db(&dir).expect("db opens");
        sync_single_file(&mut conn, &file, &|_| {});

        let stored: String = conn
            .query_row("SELECT abs_path FROM files WHERE status='ok'", [], |row| {
                row.get(0)
            })
            .expect("one indexed file");
        assert_eq!(stored, path_to_string(&file));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_indexing_a_directory_syncs_nested_files_and_forgets_removed_entries() {
        let dir = unique_dir("manual-dir");
        let root = dir.join("vault");
        let nested = root.join("notes");
        let first = nested.join("first.md");
        let second = nested.join("second.md");

        write_file(&first, "# First\n");
        write_file(&second, "# Second\n");

        let mut conn = open_db(&dir).expect("db opens");
        sync_single_file(&mut conn, &root, &|_| {});

        let mut paths = Vec::new();
        flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
        assert!(
            paths.iter().any(|path| path.ends_with("first.md")),
            "directory sync indexes nested markdown files"
        );
        assert!(
            paths.iter().any(|path| path.ends_with("second.md")),
            "directory sync indexes all markdown files in the subtree"
        );

        std::fs::remove_file(&second).expect("removed second");
        let third = nested.join("third.md");
        write_file(&third, "# Third\n");

        sync_single_file(&mut conn, &root, &|_| {});

        let mut paths = Vec::new();
        flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
        assert!(
            paths.iter().any(|path| path.ends_with("first.md")),
            "unchanged files remain"
        );
        assert!(
            paths.iter().any(|path| path.ends_with("third.md")),
            "new files in a watched directory are added"
        );
        assert!(
            paths.iter().all(|path| !path.ends_with("second.md")),
            "removed files under the changed directory are forgotten"
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn manual_index_normalizes_a_verbatim_watcher_path() {
        // The file watcher reports paths with the `\\?\` prefix; indexing one
        // must store normal form under the existing drive root, not a duplicate
        // `\\?\C:` root.
        let dir = unique_dir("verbatim");
        let file = dir.join("note.md");
        write_file(&file, "# Note\n");
        let verbatim = std::fs::canonicalize(&file).expect("canonicalize");
        assert!(
            verbatim.to_string_lossy().starts_with(r"\\?\"),
            "precondition: canonicalize yields a verbatim path"
        );

        let mut conn = open_db(&dir).expect("db opens");
        sync_single_file(&mut conn, &verbatim, &|_| {});

        let stored: String = conn
            .query_row("SELECT abs_path FROM files WHERE status='ok'", [], |row| {
                row.get(0)
            })
            .expect("one indexed file");
        assert!(
            !stored.starts_with(r"\\?\"),
            "stored path must be normal form, got {stored}"
        );

        let mut stmt = conn.prepare("SELECT path FROM scan_roots").unwrap();
        let roots: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(roots.len(), 1, "exactly one scan root, got {roots:?}");
        assert!(
            !roots[0].starts_with(r"\\?\"),
            "scan root must be normal form, got {}",
            roots[0]
        );

        drop(stmt);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn indexes_oversized_from_prefix_and_keeps_unreadable_out_of_the_tree() {
        let dir = unique_dir("status");
        let root = dir.join("vault");
        write_file(&root.join("ok.md"), "# Ok\n");
        // Binary-looking content (NUL byte) -> unreadable.
        write_file(&root.join("binary.md"), "before\u{0}after");
        // Oversized: a real H1 in the leading prefix, then filler past the cap.
        let big = format!("# Huge\n\n{}", "a ".repeat(MAX_INDEX_BYTES as usize));
        write_file(&root.join("huge.md"), &big);

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        assert_eq!(
            status_of(&conn, &path_to_string(&root.join("binary.md"))).as_deref(),
            Some("unreadable")
        );
        // The oversized file is indexed (from its prefix), not skipped.
        assert_eq!(
            status_of(&conn, &path_to_string(&root.join("huge.md"))).as_deref(),
            Some("ok")
        );

        let tree = build_tree(&conn).expect("tree built");
        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        // Both the small and the oversized file show; only the binary one is hidden.
        assert_eq!(paths.len(), 2, "the ok and oversized files show");
        assert!(paths.iter().any(|p| p.ends_with("ok.md")));
        assert!(paths.iter().any(|p| p.ends_with("huge.md")));
        assert!(paths.iter().all(|p| !p.ends_with("binary.md")));

        // Its title came from the H1 in the indexed prefix.
        assert_eq!(
            title_of(&conn, &path_to_string(&root.join("huge.md"))).as_deref(),
            Some("Huge")
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_junk_directories() {
        let dir = unique_dir("junk");
        let root = dir.join("vault");
        write_file(&root.join("keep.md"), "# Keep\n");
        write_file(&root.join("node_modules").join("dep.md"), "# Dep\n");
        write_file(&root.join(".git").join("hook.md"), "# Hook\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let tree = build_tree(&conn).expect("tree built");
        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("keep.md"));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marks_removed_files_missing_on_a_completed_rescan() {
        let dir = unique_dir("missing");
        let root = dir.join("vault");
        let keep = root.join("keep.md");
        let gone = root.join("gone.md");
        write_file(&keep, "# Keep\n");
        write_file(&gone, "# Gone\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        assert_eq!(
            status_of(&conn, &path_to_string(&gone)).as_deref(),
            Some("ok")
        );

        std::fs::remove_file(&gone).expect("file removed");
        scan(&mut conn, &root);

        assert_eq!(
            status_of(&conn, &path_to_string(&gone)).as_deref(),
            Some("missing")
        );
        assert_eq!(
            status_of(&conn, &path_to_string(&keep)).as_deref(),
            Some("ok")
        );
        // Missing files drop out of the tree.
        let tree = build_tree(&conn).expect("tree built");
        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("keep.md"));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_bump_reparses_stale_files_with_unchanged_bytes() {
        // Age a row's derived_version: the next scan must reparse it despite
        // unchanged mtime + size, restoring it to current.
        let dir = unique_dir("bump");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "# Note\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let abs = path_to_string(&note);

        conn.execute(
            "UPDATE files SET derived_version = 0, content_hash = 'stale' WHERE abs_path = ?1",
            params![abs],
        )
        .expect("aged row");

        scan(&mut conn, &root);

        let (derived, hash): (i64, Option<String>) = conn
            .query_row(
                "SELECT derived_version, content_hash FROM files WHERE abs_path = ?1",
                params![abs],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row");
        assert_eq!(derived, CURRENT_DERIVED_VERSION);
        assert_ne!(hash.as_deref(), Some("stale"), "content was rehashed");

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fast_path_keeps_unchanged_files_and_reparses_edited_ones() {
        let dir = unique_dir("fastpath");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "# One\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let abs = path_to_string(&note);
        let (hash_before, title_before): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT content_hash, title FROM files WHERE abs_path = ?1",
                params![abs],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row");
        assert_eq!(title_before.as_deref(), Some("One"));

        // Tag the row so we can tell whether the fast path skipped the rewrite.
        conn.execute(
            "UPDATE files SET error = 'sentinel' WHERE abs_path = ?1",
            params![abs],
        )
        .expect("sentinel set");
        scan(&mut conn, &root);
        let sentinel: Option<String> = conn
            .query_row(
                "SELECT error FROM files WHERE abs_path = ?1",
                params![abs],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(
            sentinel.as_deref(),
            Some("sentinel"),
            "unchanged file fast-pathed (no rewrite cleared the sentinel)"
        );

        // Edit the file: the change must be picked up (write clears the sentinel
        // and updates the hash + title).
        write_file(&note, "# Two\n\nmore text");
        scan(&mut conn, &root);
        let (hash_after, title_after, error_after): (
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT content_hash, title, error FROM files WHERE abs_path = ?1",
                params![abs],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row");
        assert_eq!(title_after.as_deref(), Some("Two"));
        assert_eq!(error_after, None, "rewrite cleared the sentinel");
        assert_ne!(hash_after, hash_before, "edited file rehashed");

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancelled_scan_does_not_mark_files_missing() {
        let dir = unique_dir("cancel");
        let root = dir.join("vault");
        write_file(&root.join("a.md"), "# A\n");
        write_file(&root.join("b.md"), "# B\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        // A pre-cancelled scan must not demote the existing files.
        let roots = ensure_roots(&conn, &[root.clone()]).expect("roots");
        let cancel = Arc::new(AtomicBool::new(true));
        run_scan(&mut conn, &roots, &cancel, &|_| {}).expect("scan ran");

        for name in ["a.md", "b.md"] {
            assert_eq!(
                status_of(&conn, &path_to_string(&root.join(name))).as_deref(),
                Some("ok"),
                "{name} stayed ok after a cancelled scan"
            );
        }

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn feature_state_roundtrip_supports_retry() {
        // The plumbing later features rely on: ready/failed/current/clear.
        let dir = unique_dir("feature");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "# Note\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        let (file_id, hash): (i64, String) = conn
            .query_row(
                "SELECT id, content_hash FROM files WHERE abs_path = ?1",
                params![path_to_string(&note)],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row");

        // Use a hypothetical feature name ("tags") so this exercises the generic
        // plumbing without colliding with `chunks`, which the scan now builds and
        // marks ready for real.
        assert!(!is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());
        mark_feature_failed(&conn, file_id, "tags", 1, &hash, "boom").unwrap();
        assert!(
            !is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap(),
            "a failed feature is not current, so it retries"
        );
        mark_feature_ready(&conn, file_id, "tags", 1, &hash).unwrap();
        assert!(is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());
        // A schema bump invalidates readiness.
        assert!(!is_feature_current(&conn, file_id, "tags", 2, Some(&hash)).unwrap());
        clear_feature_state(&conn, file_id, "tags").unwrap();
        assert!(!is_feature_current(&conn, file_id, "tags", 1, Some(&hash)).unwrap());

        // The chunks feature, by contrast, is current right after the scan.
        assert!(
            is_feature_current(
                &conn,
                file_id,
                CHUNKS_FEATURE,
                CHUNKS_SCHEMA_VERSION,
                Some(&hash)
            )
            .unwrap(),
            "the scan builds chunks and marks the feature ready"
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_title_and_headings_in_document_order() {
        let parsed = parse_markdown("# Top\n\n## Sub\n\ntext\n\n### Deep\n", "fallback");
        assert_eq!(parsed.title, "Top");
        let depths: Vec<i64> = parsed.headings.iter().map(|h| h.depth).collect();
        assert_eq!(depths, vec![1, 2, 3]);
        let ordinals: Vec<i64> = parsed.headings.iter().map(|h| h.ordinal).collect();
        assert_eq!(ordinals, vec![0, 1, 2]);
        assert_eq!(parsed.headings[1].text, "Sub");

        // No H1: the title falls back to the supplied name.
        let parsed = parse_markdown("## Only sub\n", "my-file");
        assert_eq!(parsed.title, "my-file");
    }

    #[test]
    fn manual_index_adds_a_file_without_a_crawl() {
        // Opening a file indexes it even when no device crawl ever ran (the
        // "Index entire device" toggle being off).
        let dir = unique_dir("manual");
        let root = dir.join("vault");
        let note = root.join("opened.md");
        write_file(&note, "# Opened\n");
        let mut conn = open_db(&dir).expect("db opens");

        sync_single_file(&mut conn, &note, &|_| {});

        let abs = path_to_string(&note);
        assert_eq!(status_of(&conn, &abs).as_deref(), Some("ok"));
        let title: Option<String> = conn
            .query_row(
                "SELECT title FROM files WHERE abs_path = ?1",
                params![abs],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(title.as_deref(), Some("Opened"));

        let tree = build_tree(&conn).expect("tree built");
        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("opened.md"));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_forgets_a_file_deleted_from_disk() {
        // After a delete the file is gone from disk; syncing its path must drop
        // it from the manifest and tree without a full rescan.
        let dir = unique_dir("forget");
        let root = dir.join("vault");
        let keep = root.join("keep.md");
        let gone = root.join("gone.md");
        write_file(&keep, "# Keep\n");
        write_file(&gone, "# Gone\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        assert_eq!(
            status_of(&conn, &path_to_string(&gone)).as_deref(),
            Some("ok")
        );

        std::fs::remove_file(&gone).expect("file removed");
        sync_single_file(&mut conn, &gone, &|_| {});

        assert_eq!(status_of(&conn, &path_to_string(&gone)), None);
        let mut paths = Vec::new();
        flatten_paths(&build_tree(&conn).expect("tree built"), &mut paths);
        assert_eq!(paths.len(), 1, "only the surviving file remains");
        assert!(paths[0].ends_with("keep.md"));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // --- Full-text search -------------------------------------------------

    fn file_id_of(conn: &Connection, abs: &str) -> i64 {
        conn.query_row(
            "SELECT id FROM files WHERE abs_path = ?1",
            params![abs],
            |row| row.get(0),
        )
        .expect("file id")
    }

    fn chunk_rows(conn: &Connection, file_id: i64) -> Vec<(i64, i64, Option<String>, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT ordinal, id, anchor, text FROM chunks WHERE file_id = ?1 ORDER BY ordinal",
            )
            .expect("prepare");
        let rows = stmt
            .query_map(params![file_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .expect("query");
        rows.map(|r| r.expect("row")).collect()
    }

    fn fts_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM chunks_fts", [], |row| row.get(0))
            .expect("fts count")
    }

    #[test]
    fn chunk_anchors_match_renderer_heading_slugs() {
        // Each chunk's anchor must equal the id the reader gives that heading.
        // Duplicate and punctuated headings exercise the shared slug rules.
        let content = "\
# Hello World

intro text

## Hello World

second section body

## Notes & Stuff

final body
";
        let chunks = chunk_file(content);
        let anchors: Vec<Option<&str>> = chunks.iter().map(|c| c.anchor.as_deref()).collect();
        assert_eq!(
            anchors,
            vec![
                Some("hello-world"),
                Some("hello-world-1"),
                Some("notes--stuff"),
            ]
        );

        // And those are exactly what the renderer's own slug helper produces.
        let mut seen = std::collections::HashSet::new();
        assert_eq!(
            crate::unique_heading_slug("Hello World", &mut seen),
            "hello-world"
        );
        assert_eq!(
            crate::unique_heading_slug("Hello World", &mut seen),
            "hello-world-1"
        );
        assert_eq!(
            crate::unique_heading_slug("Notes & Stuff", &mut seen),
            "notes--stuff"
        );
    }

    #[test]
    fn chunking_is_deterministic_with_contiguous_ordinals() {
        let content = "# A\n\npara one\n\n## B\n\npara two\n\n- item\n- item\n";
        let first = chunk_file(content);
        let second = chunk_file(content);
        assert_eq!(first, second, "same input yields identical chunks");
        let ordinals: Vec<i64> = first.iter().map(|c| c.ordinal).collect();
        assert_eq!(ordinals, (0..first.len() as i64).collect::<Vec<_>>());
        assert!(first
            .iter()
            .all(|c| c.start_line >= 1 && c.end_line >= c.start_line));
    }

    #[test]
    fn content_above_the_first_heading_has_no_anchor() {
        let chunks = chunk_file("preamble text\n\n# Heading\n\nbody\n");
        assert!(chunks.len() >= 2);
        assert_eq!(
            chunks[0].anchor, None,
            "preamble chunk has no heading anchor"
        );
        assert_eq!(chunks[1].anchor.as_deref(), Some("heading"));
    }

    #[test]
    fn empty_document_yields_no_chunks() {
        assert!(chunk_file("").is_empty());
        assert!(chunk_file("   \n\n\t\n").is_empty());
    }

    #[test]
    fn search_finds_files_with_snippets_and_keeps_fts_in_sync() {
        let dir = unique_dir("search");
        let root = dir.join("vault");
        write_file(
            &root.join("install.md"),
            "# Install\n\nRun the installer to install leaftext on your device.\n",
        );
        write_file(
            &root.join("other.md"),
            "# Other\n\nUnrelated content here.\n",
        );

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        // The external-content index has one row per chunk.
        let chunk_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .expect("chunk count");
        assert_eq!(fts_count(&conn), chunk_total);

        // A content-only term (not in any filename) returns a chunk hit whose
        // snippet carries the STX/ETX highlight markers around the match.
        let hits = search(&conn, "installer", None).expect("search ok");
        assert!(!hits.is_empty(), "query finds the install file");
        assert!(hits[0].abs_path.ends_with("install.md"));
        assert!(hits[0].snippet.contains('\u{2}') && hits[0].snippet.contains('\u{3}'));
        assert!(hits.iter().all(|h| !h.abs_path.ends_with("other.md")));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_scope_restricts_results_to_given_paths() {
        let dir = unique_dir("search-scope");
        let root = dir.join("vault");
        write_file(
            &root.join("keep.md"),
            "# Keep\n\nThe dharma teaching appears here.\n",
        );
        write_file(
            &root.join("drop.md"),
            "# Drop\n\nThe dharma teaching also appears here.\n",
        );
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        // Unscoped, both files match; capture keep.md's stored path.
        let all = search(&conn, "dharma", None).expect("search ok");
        assert_eq!(all.len(), 2);
        let keep_path = all
            .iter()
            .find(|h| h.abs_path.ends_with("keep.md"))
            .map(|h| h.abs_path.clone())
            .expect("keep.md matches");

        // Scoped to keep.md: drop.md is excluded even though it matches.
        let scoped = search(&conn, "dharma", Some(&[keep_path])).expect("search ok");
        assert_eq!(scoped.len(), 1);
        assert!(scoped[0].abs_path.ends_with("keep.md"));

        // An empty scope matches nothing (never a raw `IN ()`).
        let empty = search(&conn, "dharma", Some(&[])).expect("search ok");
        assert!(empty.is_empty());

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_matches_file_names_not_just_contents() {
        let dir = unique_dir("namesearch");
        let root = dir.join("vault");
        // Filename matches "skill" but the body does not.
        write_file(&root.join("SKILL.md"), "no matching word in this body\n");
        // Body matches "skill" but the filename does not.
        write_file(
            &root.join("guide.md"),
            "# Guide\n\ntalk about skills here\n",
        );
        // Neither matches.
        write_file(&root.join("misc.md"), "# Misc\n\nunrelated content\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        let hits = search(&conn, "skill", None).expect("search ok");
        // The name match leads, then the content match; the unrelated file is out.
        assert!(
            hits[0].abs_path.ends_with("SKILL.md"),
            "name match comes first"
        );
        assert!(
            hits.iter().any(|h| h.abs_path.ends_with("guide.md")),
            "content match too"
        );
        assert!(hits.iter().all(|h| !h.abs_path.ends_with("misc.md")));
        // Each file appears once.
        let skill_count = hits
            .iter()
            .filter(|h| h.abs_path.ends_with("SKILL.md"))
            .count();
        assert_eq!(skill_count, 1);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn editing_a_file_updates_search_results() {
        let dir = unique_dir("livesync");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "# Note\n\nthe quick brown fox\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        assert!(!search(&conn, "brown", None).expect("search").is_empty());

        write_file(&note, "# Note\n\nthe lazy green turtle\n");
        scan(&mut conn, &root);
        assert!(
            search(&conn, "brown", None).expect("search").is_empty(),
            "old term gone"
        );
        assert!(
            !search(&conn, "turtle", None).expect("search").is_empty(),
            "new term found"
        );
        // FTS rows still match chunk rows after the rewrite.
        let chunk_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .expect("chunk count");
        assert_eq!(fts_count(&conn), chunk_total);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_chunks_preserves_ids_for_surviving_ordinals() {
        let dir = unique_dir("chunkid");
        let root = dir.join("vault");
        let note = root.join("note.md");
        // Two sections: editing only the second must leave the first chunk's id.
        write_file(&note, "# First\n\nalpha body\n\n# Second\n\nbeta body\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let file_id = file_id_of(&conn, &path_to_string(&note));
        let before = chunk_rows(&conn, file_id);
        let first_id_before = before[0].1;
        assert!(before.len() >= 2);

        write_file(
            &note,
            "# First\n\nalpha body\n\n# Second\n\nbeta body rewritten\n",
        );
        scan(&mut conn, &root);
        let after = chunk_rows(&conn, file_id);
        assert_eq!(
            after[0].1, first_id_before,
            "surviving ordinal 0 kept its id"
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_escaping_handles_punctuation_and_blanks() {
        // Blank / operator-only input collapses to no query.
        assert_eq!(escape_fts_query(""), None);
        assert_eq!(escape_fts_query("   \t"), None);
        assert_eq!(escape_fts_query("\"*^():"), None);
        // Real terms survive as quoted prefix tokens; operators are stripped.
        assert_eq!(escape_fts_query("hello"), Some("\"hello\"*".to_string()));
        assert_eq!(
            escape_fts_query("foo bar"),
            Some("\"foo\"* \"bar\"*".to_string())
        );
        assert_eq!(
            escape_fts_query("a*b (c)"),
            Some("\"ab\"* \"c\"*".to_string())
        );
    }

    #[test]
    fn search_does_not_crash_on_hostile_queries() {
        let dir = unique_dir("hostile");
        let root = dir.join("vault");
        write_file(
            &root.join("doc.md"),
            "# Doc\n\nsome searchable words here\n",
        );
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        for query in [
            "",
            "   ",
            "\"",
            "AND OR NOT",
            "foo:bar",
            "a* (b) ^c",
            "\"unterminated",
            "words", // a real one too
        ] {
            let result = search(&conn, query, None);
            assert!(result.is_ok(), "query {query:?} must not error");
        }

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_change_removes_chunks_and_search_hits() {
        let dir = unique_dir("statushits");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "# Note\n\nfindme keyword inside\n");

        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let file_id = file_id_of(&conn, &path_to_string(&note));
        assert!(!search(&conn, "findme", None).expect("search").is_empty());

        // Removing the file then rescanning demotes it to `missing`.
        std::fs::remove_file(&note).expect("removed");
        scan(&mut conn, &root);

        assert_eq!(
            status_of(&conn, &path_to_string(&note)).as_deref(),
            Some("missing")
        );
        assert!(chunk_rows(&conn, file_id).is_empty(), "chunks dropped");
        assert!(
            search(&conn, "findme", None).expect("search").is_empty(),
            "no stale hits"
        );
        let chunk_total: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .expect("chunk count");
        assert_eq!(fts_count(&conn), chunk_total);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cjk_search_matches_leading_prefix_documented_behavior() {
        // CJK is best-effort under unicode61: an unspaced Han run is one token, so
        // a query matches only as a leading prefix. Pins the shipped behavior.
        let dir = unique_dir("cjk");
        let root = dir.join("vault");
        write_file(&root.join("zh.md"), "# 测试\n\n安装程序很好用\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        assert!(
            !search(&conn, "安装", None).expect("search").is_empty(),
            "leading prefix of the run matches"
        );
        assert!(
            search(&conn, "程序", None).expect("search").is_empty(),
            "mid-run substring does not match under unicode61"
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_results_event_script_targets_the_callback() {
        let event = IndexerEvent::SearchResults {
            query: "hi".to_string(),
            hits: vec![SearchHit {
                abs_path: "C:\\docs\\a.md".to_string(),
                title: "A".to_string(),
                start_line: 1,
                end_line: 3,
                anchor: Some("intro".to_string()),
                snippet: "an [a]nswer".to_string(),
                score: -1.5,
            }],
            error: None,
        };
        let script = event_script(&event);
        assert!(script.starts_with("window.leafSetSearchResults("));
        assert!(script.contains("\"query\":\"hi\""));
        assert!(script.contains("\"absPath\":\"C:\\\\docs\\\\a.md\""));
        assert!(script.contains("\"anchor\":\"intro\""));
        assert!(script.contains("\"error\":null"));

        let failure = event_script(&IndexerEvent::SearchResults {
            query: "x".to_string(),
            hits: Vec::new(),
            error: Some("boom".to_string()),
        });
        assert!(failure.contains("\"message\":\"boom\""));
    }

    #[test]
    fn event_script_builds_callbacks_and_escapes_via_json() {
        let progress = ScanProgress {
            phase: ScanPhase::Scanning,
            files_found: 1240,
        };
        let script = event_script(&IndexerEvent::Progress(progress));
        assert!(script.starts_with("window.leafSetScanProgress("));
        assert!(script.contains("\"phase\":\"scanning\""));
        assert!(script.contains("\"filesFound\":1240"));

        let library = IndexerEvent::Library {
            tree: vec![FileTreeNode {
                name: "README.md".to_string(),
                path: "C:\\docs\\README.md".to_string(),
                kind: NodeKind::File,
                title: Some("Guide".to_string()),
                children: Vec::new(),
            }],
            progress: ScanProgress {
                phase: ScanPhase::Idle,
                files_found: 0,
            },
        };
        let script = event_script(&library);
        assert!(script.starts_with("window.leafSetLibraryState("));
        assert!(script.contains("\"kind\":\"file\""));
        assert!(script.contains("\"error\":null"));

        let error = event_script(&IndexerEvent::Error("DB unavailable".to_string()));
        assert!(error.contains("\"message\":\"DB unavailable\""));
    }

    // --- Frontmatter ------------------------------------------------------

    fn frontmatter_rows(conn: &Connection, file_id: i64) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT key, value FROM frontmatter WHERE file_id = ?1 ORDER BY key, value")
            .expect("prepare");
        let rows = stmt
            .query_map(params![file_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query");
        rows.map(|r| r.expect("row")).collect()
    }

    #[test]
    fn extracts_only_a_leading_block_and_skips_later_rules() {
        // A real leading block parses.
        let block = extract_frontmatter("---\ntitle: Hi\n---\n\nbody\n").expect("leading block");
        assert_eq!(block.body, "title: Hi\n");

        // A horizontal rule later in the document is not frontmatter.
        assert_eq!(
            extract_frontmatter("# Heading\n\nintro\n\n---\n\nmore\n"),
            None
        );

        // Extraction stops at the first closing fence, so a later `---` rule stays
        // in the body rather than reopening metadata.
        let block =
            extract_frontmatter("---\nstatus: done\n---\n\ntext\n\n---\n\ntail\n").expect("block");
        assert_eq!(block.body, "status: done\n");

        // No closing fence: not a block.
        assert_eq!(extract_frontmatter("---\ntitle: Hi\nno close\n"), None);
    }

    #[test]
    fn extracts_block_after_a_utf8_bom() {
        let block = extract_frontmatter("\u{feff}---\ntitle: Hi\n---\nbody\n").expect("bom block");
        assert_eq!(block.body, "title: Hi\n");
    }

    #[test]
    fn parses_scalars_arrays_and_block_lists() {
        let block = FrontmatterBlock {
            body: "Title: Project Plan\n\
                   status: done\n\
                   due: 2026-07-01\n\
                   draft: true\n\
                   category: [guides, drafts]\n\
                   tags:\n\
                   - rust\n\
                   - desktop\n"
                .to_string(),
        };
        let parsed = parse_frontmatter(&block).expect("parsed");
        let mut fields: Vec<(String, String)> = parsed
            .fields
            .iter()
            .map(|f| (f.key.clone(), f.value.clone()))
            .collect();
        fields.sort();
        assert_eq!(
            fields,
            vec![
                ("category".to_string(), "drafts".to_string()),
                ("category".to_string(), "guides".to_string()),
                ("draft".to_string(), "true".to_string()),
                ("due".to_string(), "2026-07-01".to_string()),
                ("status".to_string(), "done".to_string()),
                ("tags".to_string(), "desktop".to_string()),
                ("tags".to_string(), "rust".to_string()),
                // Keys are lowercased so filters are case-insensitive.
                ("title".to_string(), "Project Plan".to_string()),
            ]
        );
    }

    #[test]
    fn malformed_frontmatter_does_not_fail_the_file() {
        // A block that is not a mapping at all parses to an error...
        let garbage = FrontmatterBlock {
            body: "this is not yaml at all\njust prose\n".to_string(),
        };
        assert_eq!(parse_frontmatter(&garbage), Err(MetadataError::Unparseable));

        // ...but the file still indexes and shows in the tree, with no rows.
        let dir = unique_dir("fm-malformed");
        let root = dir.join("vault");
        let note = root.join("bad.md");
        write_file(
            &note,
            "---\nthis is not yaml at all\njust prose\n---\n\n# Body\n",
        );
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        let abs = path_to_string(&note);
        assert_eq!(status_of(&conn, &abs).as_deref(), Some("ok"));
        let file_id = file_id_of(&conn, &abs);
        assert!(frontmatter_rows(&conn, file_id).is_empty());
        let tree = build_tree(&conn).expect("tree");
        let mut paths = Vec::new();
        flatten_paths(&tree, &mut paths);
        assert_eq!(paths.len(), 1);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn editing_frontmatter_replaces_stale_rows() {
        let dir = unique_dir("fm-rewrite");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "---\nstatus: draft\n---\n# Note\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let abs = path_to_string(&note);
        let file_id = file_id_of(&conn, &abs);
        assert_eq!(
            frontmatter_rows(&conn, file_id),
            vec![("status".to_string(), "draft".to_string())]
        );

        // Rewriting the block removes the stale value and adds the new one.
        write_file(&note, "---\nstatus: done\n---\n# Note\n");
        scan(&mut conn, &root);
        assert_eq!(
            frontmatter_rows(&conn, file_id),
            vec![("status".to_string(), "done".to_string())]
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn demoted_files_drop_their_frontmatter_rows() {
        let dir = unique_dir("fm-demote");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "---\nstatus: done\n---\n# Note\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let abs = path_to_string(&note);
        let file_id = file_id_of(&conn, &abs);
        assert!(!frontmatter_rows(&conn, file_id).is_empty());

        // Removing the file then rescanning demotes it and clears its rows.
        std::fs::remove_file(&note).expect("removed");
        scan(&mut conn, &root);
        assert_eq!(status_of(&conn, &abs).as_deref(), Some("missing"));
        assert!(frontmatter_rows(&conn, file_id).is_empty());
        // A demoted file drops out of the tree entirely.
        let tree = build_tree(&conn).expect("tree");
        assert!(tree.is_empty());

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_frontmatter_feature_forces_a_reparse() {
        // Backfill: a file with a stale frontmatter feature row is reparsed once
        // despite unchanged mtime + size.
        let dir = unique_dir("fm-backfill");
        let root = dir.join("vault");
        let note = root.join("note.md");
        write_file(&note, "---\nstatus: done\n---\n# Note\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);
        let abs = path_to_string(&note);
        let file_id = file_id_of(&conn, &abs);

        // Simulate a pre-feature file: drop its frontmatter rows and readiness
        // without touching mtime/size.
        conn.execute(
            "DELETE FROM frontmatter WHERE file_id = ?1",
            params![file_id],
        )
        .expect("clear rows");
        clear_feature_state(&conn, file_id, FRONTMATTER_FEATURE).expect("clear feature");
        assert!(frontmatter_rows(&conn, file_id).is_empty());

        // The next scan reparses the file and rebuilds its frontmatter.
        scan(&mut conn, &root);
        assert_eq!(
            frontmatter_rows(&conn, file_id),
            vec![("status".to_string(), "done".to_string())]
        );

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // Link extraction + graph building
    // -----------------------------------------------------------------------

    #[test]
    fn url_scheme_detection_separates_external_links_from_paths() {
        assert!(has_url_scheme("https://example.com"));
        assert!(has_url_scheme("mailto:a@b.com"));
        assert!(has_url_scheme("data:text/plain,x"));
        // A Windows drive is a path, not a URL (single-letter "scheme").
        assert!(!has_url_scheme(r"C:\notes\a.md"));
        assert!(!has_url_scheme("./b.md"));
        assert!(!has_url_scheme("sub/c.md"));
        assert!(!has_url_scheme("#section"));
    }

    #[test]
    fn extracts_markdown_html_and_wiki_links_and_drops_external() {
        let a = Path::new("root").join("notes").join("a.md");
        let content = "[rel](./b.md)\n\
             <a href=\"c.md\">c</a>\n\
             see [[Note D]] and [[Note D#head|alias]]\n\
             [ext](https://example.com)\n\
             [anchor](#top)\n\
             [space](My%20Note.md)\n";
        let links = document_links(content, &a);

        let names: Vec<String> = links.iter().filter_map(|l| l.target_name.clone()).collect();
        assert!(names.contains(&"note d".to_string()));
        // The two `[[Note D...]]` links dedupe to one name target.
        assert_eq!(names.iter().filter(|n| *n == "note d").count(), 1);

        let paths: Vec<String> = links.iter().filter_map(|l| l.target_abs.clone()).collect();
        assert!(paths.iter().any(|p| p.ends_with("b.md")));
        assert!(paths.iter().any(|p| p.ends_with("c.md")));
        // Percent escapes are decoded so the target matches the on-disk name.
        assert!(paths.iter().any(|p| p.ends_with("My Note.md")));
        // The external URL and the pure anchor contribute no link.
        assert!(!paths.iter().any(|p| p.contains("example.com")));
        assert_eq!(links.len(), 4);
    }

    #[test]
    fn xml_links_come_from_target_and_href_attributes() {
        let a = Path::new("root").join("x.xml");
        let content = "<ref target=\"other.xml\">x</ref>\
             <ptr target=\"https://example.com\"/>\
             <a href=\"deep/inner.xml\">y</a>";
        let links = document_links(content, &a);
        let paths: Vec<String> = links.iter().filter_map(|l| l.target_abs.clone()).collect();
        assert!(paths.iter().any(|p| p.ends_with("other.xml")));
        assert!(paths.iter().any(|p| p.ends_with("inner.xml")));
        assert!(!paths.iter().any(|p| p.contains("example.com")));
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn build_graph_edges_linked_documents_and_indexes_xml_nodes() {
        let dir = unique_dir("graph");
        let root = dir.join("vault");
        write_file(&root.join("a.md"), "# Alpha\n\nlink to [Beta](./b.md)\n");
        // b links back to a with a wiki link (resolved by filename stem).
        write_file(&root.join("b.md"), "# Beta\n\nback to [[a]]\n");
        write_file(
            &root.join("c.xml"),
            "<TEI><teiHeader><fileDesc><titleStmt>\
                <title type=\"mainTitle\" xml:lang=\"en\">Gamma</title>\
             </titleStmt></fileDesc></teiHeader>\
             <text><body><p>hello</p></body></text></TEI>",
        );
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        let graph = build_graph(&conn, &GraphRequest::default()).expect("graph builds");
        // All three documents — including the TEI XML — are nodes.
        assert_eq!(graph.nodes.len(), 3);
        assert!(graph.nodes.iter().any(|n| n.label == "Gamma"));
        assert!(!graph.truncated);

        // The forward Markdown link and the backward wiki link collapse to one
        // undirected edge between a.md and b.md; c.xml stays an isolated node.
        assert_eq!(graph.edges.len(), 1);
        let edge = &graph.edges[0];
        let ends = [edge.source.as_str(), edge.target.as_str()];
        assert!(ends.iter().any(|p| p.ends_with("a.md")));
        assert!(ends.iter().any(|p| p.ends_with("b.md")));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_graph_focus_scope_keeps_seed_and_its_neighbors() {
        let dir = unique_dir("graph-focus");
        let root = dir.join("vault");
        write_file(&root.join("a.md"), "# Alpha\n\nlink to [Beta](./b.md)\n");
        write_file(&root.join("b.md"), "# Beta\n\nback to [[a]]\n");
        write_file(&root.join("c.md"), "# Gamma\n\nno links here\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        // The full graph gives us a.md's stored path to seed the focus request.
        let all = build_graph(&conn, &GraphRequest::default()).expect("graph builds");
        let a_path = all
            .nodes
            .iter()
            .find(|n| n.path.ends_with("a.md"))
            .map(|n| n.path.clone())
            .expect("a.md is a node");

        // Focused on a.md: the slice is a plus its one neighbor b, never the
        // unlinked c.
        let focus = build_graph(
            &conn,
            &GraphRequest {
                focus: Some(vec![a_path]),
                limit: None,
            },
        )
        .expect("focus graph builds");
        assert!(!focus.truncated);
        assert_eq!(focus.nodes.len(), 2);
        assert!(focus.nodes.iter().any(|n| n.path.ends_with("a.md")));
        assert!(focus.nodes.iter().any(|n| n.path.ends_with("b.md")));
        assert!(!focus.nodes.iter().any(|n| n.path.ends_with("c.md")));

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_graph_capped_scope_keeps_densest_and_flags_truncated() {
        let dir = unique_dir("graph-capped");
        let root = dir.join("vault");
        // hub links to two leaves, so hub has degree 2 and each leaf degree 1.
        write_file(
            &root.join("hub.md"),
            "# Hub\n\n[one](./one.md) and [two](./two.md)\n",
        );
        write_file(&root.join("one.md"), "# One\n");
        write_file(&root.join("two.md"), "# Two\n");
        let mut conn = open_db(&dir).expect("db opens");
        scan(&mut conn, &root);

        // Cap at 2: the densest documents win (hub, then a leaf) and the result
        // is flagged partial.
        let capped = build_graph(
            &conn,
            &GraphRequest {
                focus: None,
                limit: Some(2),
            },
        )
        .expect("capped graph builds");
        assert!(capped.truncated);
        assert_eq!(capped.nodes.len(), 2);
        assert!(capped.nodes.iter().any(|n| n.path.ends_with("hub.md")));

        // A limit larger than the library drops nothing and is not flagged.
        let uncapped = build_graph(
            &conn,
            &GraphRequest {
                focus: None,
                limit: Some(10),
            },
        )
        .expect("graph builds");
        assert!(!uncapped.truncated);
        assert_eq!(uncapped.nodes.len(), 3);

        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
