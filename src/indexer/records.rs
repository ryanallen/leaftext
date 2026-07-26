//! The files table: reading rows, writing them, retiring them.

use super::*;

#[derive(Debug)]
pub(super) struct ExistingFile {
    pub(super) id: i64,
    pub(super) mtime: i64,
    pub(super) size: i64,
    pub(super) derived_version: i64,
    pub(super) content_hash: Option<String>,
}

pub(super) fn lookup_file(conn: &Connection, abs_path: &str) -> DbResult<Option<ExistingFile>> {
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

pub(super) fn update_last_seen(conn: &Connection, file_id: i64, scan_run_id: i64) -> DbResult<()> {
    conn.execute(
        "UPDATE files SET last_seen_scan_id = ?2 WHERE id = ?1",
        params![file_id, scan_run_id],
    )
    .map_err(to_err)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn write_file_record(
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

pub(super) fn mark_root_completed(
    conn: &Connection,
    scan_run_id: i64,
    root_id: i64,
) -> DbResult<()> {
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
pub(super) fn mark_missing_for_root(
    conn: &mut Connection,
    root_id: i64,
    scan_run_id: i64,
) -> DbResult<()> {
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
pub(super) fn prune_old_runs(conn: &Connection) -> DbResult<()> {
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
