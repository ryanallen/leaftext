//! What a vault's mirror holds: the source's own id for a document, where it landed on this machine, and the version stamp it came down with.
//!
//! **The id is the identity and the name never is.** A document renamed upstream is the same document, so a refresh moves this row rather than writing a second one — the alternative is a mirror that grows a copy of everything anybody renames, and a link graph joining a note to its own ghost.
//!
//! Nothing here is a cache of what is in a file. The row says *which* file, and reading it is still the disk's job, the same as every other vault.

use super::*;

/// One file the mirror holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    /// The source's own id. Never the name.
    pub remote_id: String,
    /// Where it is on this machine, under the vault's mirror.
    pub local_path: String,
    /// The stamp the source gave this version — an etag, a revision, a modified time. Compared for equality and never parsed.
    pub version: Option<String>,
}

/// Write down what the mirror now holds for one of the source's ids, replacing what it held before.
///
/// The primary key is the vault and the id together, so a document that moved is one row that changed rather than a second row alongside the first.
#[cfg(feature = "desktop")]
pub fn record_remote_file(
    conn: &Connection,
    vault_id: i64,
    remote_id: &str,
    local_path: &str,
    version: Option<&str>,
) -> DbResult<()> {
    conn.execute(
        "INSERT INTO remote_files (vault_id, remote_id, local_path, version) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(vault_id, remote_id) DO UPDATE SET local_path = excluded.local_path, version = excluded.version",
        params![vault_id, remote_id, local_path, version],
    )
    .map_err(to_err)?;
    Ok(())
}

/// What the mirror holds for one of the source's ids, or nothing when it holds none.
#[cfg(feature = "desktop")]
pub fn remote_file(
    conn: &Connection,
    vault_id: i64,
    remote_id: &str,
) -> DbResult<Option<RemoteFile>> {
    conn.query_row(
        "SELECT remote_id, local_path, version FROM remote_files WHERE vault_id = ?1 AND remote_id = ?2",
        params![vault_id, remote_id],
        |row| {
            Ok(RemoteFile {
                remote_id: row.get(0)?,
                local_path: row.get(1)?,
                version: row.get(2)?,
            })
        },
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(to_err(other)),
    })
}

/// Everything the mirror holds for a vault, in a fixed order so two readings can be compared.
#[cfg(feature = "desktop")]
pub fn list_remote_files(conn: &Connection, vault_id: i64) -> DbResult<Vec<RemoteFile>> {
    let mut stmt = conn
        .prepare(
            "SELECT remote_id, local_path, version FROM remote_files WHERE vault_id = ?1 ORDER BY remote_id",
        )
        .map_err(to_err)?;
    let rows = stmt
        .query_map(params![vault_id], |row| {
            Ok(RemoteFile {
                remote_id: row.get(0)?,
                local_path: row.get(1)?,
                version: row.get(2)?,
            })
        })
        .map_err(to_err)?;
    let mut files = Vec::new();
    for row in rows {
        files.push(row.map_err(to_err)?);
    }
    Ok(files)
}

/// Forget one of the source's ids. The file it named is the caller's to remove: this row is the record, not the thing.
#[cfg(feature = "desktop")]
pub fn forget_remote_file(conn: &Connection, vault_id: i64, remote_id: &str) -> DbResult<()> {
    conn.execute(
        "DELETE FROM remote_files WHERE vault_id = ?1 AND remote_id = ?2",
        params![vault_id, remote_id],
    )
    .map_err(to_err)?;
    Ok(())
}
