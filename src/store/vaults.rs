//! Vaults: folders the app treats as library roots.
//!
//! A vault is a row in this table and nothing else. Nothing is written into the folder — no marker, no dotfile — so adding one leaves the user's files exactly as they were, and removing one leaves nothing behind.
//!
//! A vault scopes the library pane. It never scopes what a tab may open: a file from anywhere still opens and renders normally.

use super::*;

/// Where a vault's files came from. `root_path` means the same thing for every one of them — where the files are on this machine — so the pane, search, the graph and the pager never ask this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKind {
    /// A folder the user pointed at, which is every vault registered before this column existed.
    Folder,
    /// A repository the app cloned into a folder it made.
    Git,
}

impl VaultKind {
    /// Every kind, so a caller derives its list from this rather than restating one.
    pub const ALL: [Self; 2] = [Self::Folder, Self::Git];

    /// The word in the `kind` column. Stable: it is written into every installed copy's database.
    pub fn as_stored(self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::Git => "git",
        }
    }

    /// The kind a stored word names. Anything unrecognized reads as a folder, so a database written by a later version still opens and shows its vaults as at least what they are.
    pub fn from_stored(value: &str) -> Self {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_stored() == value)
            .unwrap_or(Self::Folder)
    }

    // No word for the page to print: the switcher shows a vault's name and nothing else, so a kind reaches the page as the stored word and only where something acts on it.

    /// Whether this kind of vault has anybody to sign in as.
    ///
    /// A folder on this machine has nobody, and a clone leans on a git that already knows the user — so neither draws a sign-in row rather than drawing one that cannot work. It is a match rather than a flag so that a kind added later cannot compile without answering.
    pub fn signs_in(self) -> bool {
        match self {
            Self::Folder | Self::Git => false,
        }
    }
}

/// One registered vault. `id` is the row id and the only identity anything keys on — never the name, which the user may repeat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vault {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub kind: VaultKind,
    /// Who this vault is signed in as, when it is signed in as anybody. A name, not a secret — the token is in the machine's own credential store and never in this database or any other file the app writes. The panel shows this, which is why it is here rather than fetched.
    pub account: Option<String>,
}

/// Written out by hand rather than derived, for one field: whether this kind signs in is answered here, so the page is told rather than holding its own list of kinds that would drift the moment one is added.
impl Serialize for Vault {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut row = serializer.serialize_struct("Vault", 6)?;
        row.serialize_field("id", &self.id)?;
        row.serialize_field("name", &self.name)?;
        row.serialize_field("rootPath", &self.root_path)?;
        row.serialize_field("kind", self.kind.as_stored())?;
        row.serialize_field("account", &self.account)?;
        row.serialize_field("signsIn", &self.kind.signs_in())?;
        row.end()
    }
}

/// The columns every query here selects, in the order [`read_vault`] reads them. One string so the four cannot drift apart.
#[cfg(feature = "desktop")]
const VAULT_COLUMNS: &str = "id, name, root_path, kind, account";

#[cfg(feature = "desktop")]
fn read_vault(row: &rusqlite::Row) -> rusqlite::Result<Vault> {
    Ok(Vault {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        kind: VaultKind::from_stored(&row.get::<_, String>(3)?),
        account: row.get(4)?,
    })
}

/// The `app_state` key holding the active vault's id.
#[cfg(feature = "desktop")]
const ACTIVE_VAULT_KEY: &str = "active_vault";

/// Every vault, oldest first, so the switcher's order is the order they were added rather than something that reshuffles as folders are renamed.
#[cfg(feature = "desktop")]
pub fn list_vaults(conn: &Connection) -> DbResult<Vec<Vault>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {VAULT_COLUMNS} FROM vaults ORDER BY added_at, id"
        ))
        .map_err(to_err)?;
    let rows = stmt.query_map([], read_vault).map_err(to_err)?;
    let mut vaults = Vec::new();
    for row in rows {
        vaults.push(row.map_err(to_err)?);
    }
    Ok(vaults)
}

/// Register `root` as a vault and return it. A folder that is already a vault is returned as it stands — picking it again opens it rather than doubling it, and it keeps the kind it was registered under, since how a folder arrived is not changed by pointing at it a second time.
#[cfg(feature = "desktop")]
pub fn add_vault(conn: &Connection, root: &Path, name: &str, kind: VaultKind) -> DbResult<Vault> {
    let root_path = path_to_string(root);
    conn.execute(
        "INSERT OR IGNORE INTO vaults (name, root_path, added_at, kind) VALUES (?1, ?2, ?3, ?4)",
        params![name, root_path, now_secs(), kind.as_stored()],
    )
    .map_err(to_err)?;
    conn.query_row(
        &format!("SELECT {VAULT_COLUMNS} FROM vaults WHERE root_path = ?1"),
        params![root_path],
        read_vault,
    )
    .map_err(to_err)
}

/// Relabel a vault. The name is only a label — the folder is untouched, and two vaults may end up reading alike, which is why nothing keys on it.
#[cfg(feature = "desktop")]
pub fn rename_vault(conn: &Connection, id: i64, name: &str) -> DbResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE vaults SET name = ?2 WHERE id = ?1",
        params![id, name],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Point an existing vault at a different folder — the fix for picking the wrong one. Fails if another vault already holds that folder, since `root_path` is unique and two rows for one folder are two names for the same place.
#[cfg(feature = "desktop")]
pub fn set_vault_root(conn: &Connection, id: i64, root: &Path) -> DbResult<()> {
    let root_path = path_to_string(root);
    let taken: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM vaults WHERE root_path = ?1 AND id <> ?2",
            params![root_path, id],
            |row| row.get(0),
        )
        .map_err(to_err)?;
    if taken > 0 {
        return Err("another vault already points at that folder".to_string());
    }
    conn.execute(
        "UPDATE vaults SET root_path = ?2 WHERE id = ?1",
        params![id, root_path],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Record who a vault is signed in as, or `None` for signed out. Only the name: the token that goes with it lives in the machine's own credential store, and nothing puts one in this database.
#[cfg(feature = "desktop")]
pub fn set_vault_account(conn: &Connection, id: i64, account: Option<&str>) -> DbResult<()> {
    conn.execute(
        "UPDATE vaults SET account = ?2 WHERE id = ?1",
        params![id, account],
    )
    .map_err(to_err)?;
    Ok(())
}

/// Forget a vault. The row goes; the folder and every file in it stay exactly as they are, because nothing was ever written into it.
#[cfg(feature = "desktop")]
pub fn remove_vault(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM vaults WHERE id = ?1", params![id])
        .map_err(to_err)?;
    Ok(())
}

/// The vault whose folder holds `path`, or `None` when no vault does. The innermost wins: a vault nested inside another owns the files under it, which is the same rule the pane uses when both are on the list.
#[cfg(feature = "desktop")]
pub fn vault_containing(conn: &Connection, path: &Path) -> Option<Vault> {
    let path = path_to_string(path);
    list_vaults(conn)
        .ok()?
        .into_iter()
        .filter(|vault| holds(&vault.root_path, &path))
        .max_by_key(|vault| vault.root_path.len())
}

/// Whether a vault rooted at `root` holds `path`. The same rule [`vault_containing`] matches on, so "which vault owns this file" and "does this vault own this file" can never disagree — and so `C:\Notes` still owns `c:\notes\today.md`, which a plain `starts_with` would deny.
pub fn vault_holds(root: &Path, path: &Path) -> bool {
    holds(&path_to_string(root), &path_to_string(path))
}

/// Whether `root` is `path` or an ancestor of it. Compared case-insensitively on Windows, where the same file is reachable under either spelling.
fn holds(root: &str, path: &str) -> bool {
    let separator = std::path::MAIN_SEPARATOR;
    let root = root.trim_end_matches(separator);
    let Some(rest) = path.get(..root.len()) else {
        return false;
    };
    let matches = if cfg!(windows) {
        rest.eq_ignore_ascii_case(root)
    } else {
        rest == root
    };
    // `C:\notes` must not claim `C:\notes-old`: what follows has to be the separator, or nothing at all.
    matches
        && path[root.len()..]
            .chars()
            .next()
            .is_none_or(|c| c == separator)
}

/// The vault with this id, or `None` — including for `0`, which is the whole library rather than a vault.
#[cfg(feature = "desktop")]
pub fn find_vault(conn: &Connection, id: i64) -> DbResult<Option<Vault>> {
    if id == 0 {
        return Ok(None);
    }
    conn.query_row(
        &format!("SELECT {VAULT_COLUMNS} FROM vaults WHERE id = ?1"),
        params![id],
        read_vault,
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(to_err(other)),
    })
}

/// The active vault's id, or `0` for the whole library. Anything unreadable or unparseable reads as `0`: the pane falls back to what it has always shown rather than to nothing.
#[cfg(feature = "desktop")]
pub fn active_vault_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT value FROM app_state WHERE key = ?1",
        params![ACTIVE_VAULT_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| value.parse::<i64>().ok())
    .unwrap_or(0)
}

/// Remember which vault the pane is scoped to. `0` is the whole library.
#[cfg(feature = "desktop")]
pub fn set_active_vault_id(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute(
        "INSERT INTO app_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![ACTIVE_VAULT_KEY, id.to_string()],
    )
    .map_err(to_err)?;
    Ok(())
}

/// The name a newly added vault gets: its folder's name, falling back to the whole path for a drive root like `C:\`.
pub fn default_vault_name(root: &Path) -> String {
    let from_name = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let trimmed = from_name.trim();
    if trimmed.is_empty() {
        path_to_string(root)
    } else {
        trimmed.to_string()
    }
}
