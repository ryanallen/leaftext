//! The folder a remote vault's files are copied into.
//!
//! It is app data, not the user's, so it sits under the app's own data root rather than beside somebody's documents: removing a vault has to be able to remove it, and nothing can be trusted to do that inside a folder somebody chose.

use std::path::{Path, PathBuf};

use super::RemotePointer;

/// Every mirror sits under this one folder inside the data root. A path is a contract with every installed copy the moment it ships, so it is pinned by a test beside the rest of the layout.
pub const MIRROR_DIR_NAME: &str = "remote";

/// What a pointer file is called. A document with no bytes cannot be copied, so the mirror keeps one of these in its place.
pub const POINTER_SUFFIX: &str = ".leafpointer.json";

/// Where one vault's files are copied to: `<data root>/remote/<vault id>`.
///
/// Keyed on the row id and never the name, which the user may repeat and may change. `root_path` on the vault row points here, which is the whole reason the pane, search, the graph, the pager and the watcher need no telling that a vault is remote at all.
pub fn vault_mirror_dir(data_dir: &Path, vault_id: i64) -> PathBuf {
    data_dir.join(MIRROR_DIR_NAME).join(vault_id.to_string())
}

/// Forget everything a vault copied down. Nothing is left in the app's data folder for a vault nobody has.
///
/// A mirror that was never made is not a failure: a folder vault has none, and this is called for every removal rather than only the ones that do.
pub fn remove_vault_mirror(data_dir: &Path, vault_id: i64) -> std::io::Result<()> {
    let mirror = vault_mirror_dir(data_dir, vault_id);
    match std::fs::remove_dir_all(&mirror) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// Write one pointer, making the folder it goes in if it is not there yet.
pub(super) fn write_pointer(path: &Path, pointer: &RemotePointer) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(pointer)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    std::fs::write(path, text)
}
