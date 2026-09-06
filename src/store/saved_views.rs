//! Durable named filters, owned by the vault whose documents they describe.

#[cfg(feature = "desktop")]
use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: i64,
    pub vault_id: i64,
    pub position: i64,
    pub name: String,
    pub query: String,
    pub shape: String,
    pub shape_settings: String,
}

#[cfg(feature = "desktop")]
pub fn list_saved_views(conn: &Connection, vault_id: i64) -> super::DbResult<Vec<SavedView>> {
    let mut statement = conn.prepare("SELECT id, vault_id, position, name, query, shape, shape_settings FROM saved_views WHERE vault_id = ?1 ORDER BY position, id").map_err(super::to_err)?;
    let rows = statement
        .query_map(params![vault_id], read_saved_view)
        .map_err(super::to_err)?;
    rows.map(|row| row.map_err(super::to_err)).collect()
}

#[cfg(feature = "desktop")]
pub fn save_view(
    conn: &Connection,
    vault_id: i64,
    name: &str,
    query: &str,
    shape: &str,
    shape_settings: &str,
) -> super::DbResult<SavedView> {
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM saved_views WHERE vault_id = ?1",
            params![vault_id],
            |row| row.get(0),
        )
        .map_err(super::to_err)?;
    conn.execute("INSERT INTO saved_views (vault_id, position, name, query, shape, shape_settings) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![vault_id, position, name, query, shape, shape_settings]).map_err(super::to_err)?;
    let id = conn.last_insert_rowid();
    conn.query_row("SELECT id, vault_id, position, name, query, shape, shape_settings FROM saved_views WHERE id = ?1", params![id], read_saved_view).map_err(super::to_err)
}

#[cfg(feature = "desktop")]
pub fn update_saved_view(conn: &Connection, view: &SavedView) -> super::DbResult<()> {
    conn.execute("UPDATE saved_views SET name = ?2, query = ?3, shape = ?4, shape_settings = ?5 WHERE id = ?1 AND vault_id = ?6", params![view.id, view.name, view.query, view.shape, view.shape_settings, view.vault_id]).map_err(super::to_err)?;
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn remove_saved_view(conn: &Connection, vault_id: i64, id: i64) -> super::DbResult<()> {
    conn.execute(
        "DELETE FROM saved_views WHERE id = ?1 AND vault_id = ?2",
        params![id, vault_id],
    )
    .map_err(super::to_err)?;
    Ok(())
}

#[cfg(feature = "desktop")]
fn read_saved_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedView> {
    Ok(SavedView {
        id: row.get(0)?,
        vault_id: row.get(1)?,
        position: row.get(2)?,
        name: row.get(3)?,
        query: row.get(4)?,
        shape: row.get(5)?,
        shape_settings: row.get(6)?,
    })
}
