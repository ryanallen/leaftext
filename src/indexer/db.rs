//! Opening the index, migrating its schema, and per-feature state.

use super::*;

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

/// Migration 5: vaults. A vault is a folder the app treats as a library root,
/// and it is recorded here — nothing is written into the folder itself, so
/// adding one leaves the user's files untouched. `root_path` is unique: adding
/// the same folder twice is the same vault, not a second one.
///
/// `app_state` is the app's own scratch row store; `active_vault` lives there
/// (absent, empty, or `0` all mean the whole library).
const MIGRATION_5_SQL: &str = r#"
CREATE TABLE vaults (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    added_at  INTEGER NOT NULL
);

CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
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

    if current < 5 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_5_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
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
pub(super) struct ScanRoot {
    pub(super) id: i64,
    pub(super) path: PathBuf,
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
pub(super) fn ensure_roots(conn: &Connection, roots: &[PathBuf]) -> DbResult<Vec<ScanRoot>> {
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

pub(super) fn all_features_current(
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
