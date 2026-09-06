//! Opening the database and migrating its schema.
//!
//! Migrations 1–4 built a manifest of every Markdown file on the computer: `files`, `headings`, `chunks`, the FTS5 mirror, `frontmatter`, `links`, and the scan bookkeeping around them. Nothing reads any of it — the pane, the graph and search all read the disk — so migration 6 drops the lot. What is left is the vault registry.

use super::*;

/// Migration 5: vaults. A vault is a folder the app treats as a library root, and it is recorded here — nothing is written into the folder itself, so adding one leaves the user's files untouched. `root_path` is unique: adding the same folder twice is the same vault, not a second one.
///
/// `app_state` is the app's own scratch row store; `active_vault` lives there (absent, empty, or `0` all mean the whole library).
#[cfg(feature = "desktop")]
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

/// Migration 6: drop the crawl. `IF EXISTS` throughout because a database created after this point never had these tables, and one created before has all of them. The FTS5 mirror goes before `chunks`, which owns it.
#[cfg(feature = "desktop")]
const MIGRATION_6_SQL: &str = r#"
DROP TRIGGER IF EXISTS chunks_ai;
DROP TRIGGER IF EXISTS chunks_ad;
DROP TRIGGER IF EXISTS chunks_au;
DROP TABLE IF EXISTS chunks_fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS frontmatter;
DROP TABLE IF EXISTS links;
DROP TABLE IF EXISTS headings;
DROP TABLE IF EXISTS file_feature_state;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS scan_run_roots;
DROP TABLE IF EXISTS scan_runs;
DROP TABLE IF EXISTS scan_roots;
"#;

/// Migration 7: a vault says where its files came from, and a remote vault gets somewhere to record what it copied down.
///
/// The `DEFAULT 'folder'` is what turns every row an installed copy already has into a folder vault, which is exactly what each one is — no backfill statement, and none possible to forget. `remote_id` and `account` stay null for a folder vault, because a folder has neither.
///
/// `remote_files` maps the source's own id to the file in the mirror and whatever version stamp that source gave it. The id is the identity, never the name, so a rename upstream moves this row rather than making a second one. It cascades on the vault, so forgetting a vault forgets what its mirror held — the connection turns `foreign_keys` on, so the cascade is real rather than decorative.
#[cfg(feature = "desktop")]
const MIGRATION_7_SQL: &str = r#"
ALTER TABLE vaults ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder';
ALTER TABLE vaults ADD COLUMN remote_id TEXT;
ALTER TABLE vaults ADD COLUMN account TEXT;

CREATE TABLE remote_files (
    vault_id   INTEGER NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    remote_id  TEXT NOT NULL,
    local_path TEXT NOT NULL,
    version    TEXT,
    PRIMARY KEY (vault_id, remote_id)
);

CREATE INDEX remote_files_by_path ON remote_files (vault_id, local_path);
"#;

/// Migration 8: automatic GitHub sync is a choice on one vault and starts off.
#[cfg(feature = "desktop")]
const MIGRATION_8_SQL: &str =
    "ALTER TABLE vaults ADD COLUMN git_auto_sync INTEGER NOT NULL DEFAULT 0;";

/// Migration 9: named views belong to one vault and disappear with it.
#[cfg(feature = "desktop")]
const MIGRATION_9_SQL: &str = r#"
CREATE TABLE saved_views (
    id             INTEGER PRIMARY KEY,
    vault_id       INTEGER NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    name           TEXT NOT NULL,
    query          TEXT NOT NULL,
    shape          TEXT NOT NULL DEFAULT 'list',
    shape_settings TEXT NOT NULL DEFAULT '{"version":1}'
);
CREATE INDEX saved_views_vault_position ON saved_views(vault_id, position, id);
"#;

/// Open (creating if needed) the database, apply PRAGMAs, and migrate.
#[cfg(feature = "desktop")]
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
    run_migrations(&mut conn)?;
    Ok(conn)
}

/// A read-only connection. Safe alongside the writer under WAL.
#[cfg(feature = "desktop")]
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

#[cfg(feature = "desktop")]
fn run_migrations(conn: &mut Connection) -> DbResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )
    .map_err(to_err)?;

    let current = applied_version(conn)?;

    // 1–4 are never applied again. A database that has them gets them dropped by 6; a fresh one is simply recorded as past them, so the numbering stays honest and nothing tries to build a crawl that no longer exists.
    if current < 5 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_5_SQL).map_err(to_err)?;
        for version in 1..=5 {
            tx.execute(
                "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, now_secs()],
            )
            .map_err(to_err)?;
        }
        tx.commit().map_err(to_err)?;
    }

    if current < 6 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_6_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
        // The crawl's tables were most of the file. Hand the space back rather than leave a 200 MB database holding a few rows.
        conn.execute_batch("VACUUM;").map_err(to_err)?;
    }

    if current < 7 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_7_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    if current < 8 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_8_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    if current < 9 {
        let tx = conn.transaction().map_err(to_err)?;
        tx.execute_batch(MIGRATION_9_SQL).map_err(to_err)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?1)",
            params![now_secs()],
        )
        .map_err(to_err)?;
        tx.commit().map_err(to_err)?;
    }

    // The constant read 5 for as long as 6 had been shipping, because nothing ever compared it to anything. Comparing it here is what stops the next migration being written against a number that is two behind: it fires in every test run, and a database from a later version — where the constant is legitimately lower — is not something a shipped build should refuse to open over.
    debug_assert_eq!(
        applied_version(conn)?,
        SCHEMA_VERSION,
        "the migrations applied and SCHEMA_VERSION disagree"
    );
    Ok(())
}

/// The highest migration this database has recorded.
#[cfg(feature = "desktop")]
fn applied_version(conn: &Connection) -> DbResult<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
    .map_err(to_err)
}

/// Accessible drive roots: existing drives on Windows, else `/`. The top of the library pane when no vault is active.
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
