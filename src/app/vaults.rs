//! The vault switcher: registering a folder as a library root, and pointing the
//! pane at one.
//!
//! Everything a vault is lives in the index database — the folder is never
//! written to. A vault scopes the library pane and nothing else: opening a file
//! from outside it still works exactly as before.
//!
//! The pane's files do not come from the index at all. They are read off the
//! folder, one folder at a time, by [`request_folder`].

use super::*;

/// The library pane's tree source while a vault is active, and the id the page
/// was last told about. Held by the loop so a folder read that lands after a
/// switch can be discarded.
pub(crate) struct VaultState {
    /// Read-write connection to the same manifest the indexer uses. Opened after
    /// the worker has migrated it, so the tables are already there.
    pub(crate) conn: Option<Connection>,
    pub(crate) active: i64,
    pub(crate) root: Option<PathBuf>,
    /// The folder the pane is showing, so a change on disk under it can be
    /// noticed and a stale read discarded.
    pub(crate) folder: String,
}

impl VaultState {
    /// Load the registry at startup. With no database (the indexer failed to
    /// open one) there are no vaults and the pane is the whole library, which is
    /// what it was before vaults existed.
    pub(crate) fn load(data_dir: Option<&Path>) -> Self {
        let conn = data_dir.and_then(|dir| match open_db(dir) {
            Ok(conn) => Some(conn),
            Err(error) => {
                eprintln!("Vaults unavailable: {error}");
                None
            }
        });
        let active = conn.as_ref().map(active_vault_id).unwrap_or(0);
        let root = conn
            .as_ref()
            .and_then(|conn| find_vault(conn, active).ok().flatten())
            .map(|vault| PathBuf::from(vault.root_path));
        // An id whose row is gone means no vault: fall back to the whole library
        // rather than to a pane nothing can leave.
        let active = if root.is_some() { active } else { 0 };
        Self {
            conn,
            active,
            root,
            folder: String::new(),
        }
    }

    pub(crate) fn vaults(&self) -> Vec<Vault> {
        self.conn
            .as_ref()
            .map(|conn| list_vaults(conn).unwrap_or_default())
            .unwrap_or_default()
    }
}

/// Register the picked folder and switch to it. A folder that is already a vault
/// is switched to rather than added twice.
pub(crate) fn create_vault(
    folder: &Path,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    let name = default_vault_name(folder);
    let vault = match add_vault(conn, folder, &name) {
        Ok(vault) => vault,
        Err(error) => {
            eprintln!("Could not add {} as a vault: {error}", folder.display());
            return;
        }
    };
    apply_active_vault(vault.id, state, proxy, webview);
}

/// Point the pane at a vault, or at the whole library with `0`. An id with no
/// row is ignored rather than emptying the pane.
pub(crate) fn set_active_vault(
    id: i64,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if id != 0 && find_vault(conn, id).ok().flatten().is_none() {
        return;
    }
    apply_active_vault(id, state, proxy, webview);
}

/// Relabel a vault. Only the menu changes; the folder and the pane do not.
pub(crate) fn rename_vault_row(id: i64, name: &str, state: &VaultState, webview: Option<&WebView>) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if let Err(error) = rename_vault(conn, id, name) {
        eprintln!("Could not rename that vault: {error}");
        return;
    }
    push_vaults(webview, state);
}

/// Point an existing vault at `folder` — what to do when the wrong one was
/// picked. Re-reads the pane when it is the vault on screen.
pub(crate) fn change_vault_folder(
    id: i64,
    folder: &Path,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if let Err(error) = set_vault_root(conn, id, folder) {
        eprintln!("Could not move that vault to {}: {error}", folder.display());
        return;
    }
    if state.active == id {
        state.root = Some(folder.to_path_buf());
        state.folder.clear();
        request_folder(state, proxy, String::new());
    }
    push_vaults(webview, state);
}

/// Forget a vault. Removing the one on screen falls back to the whole library,
/// which the caller then asks the indexer for.
pub(crate) fn remove_vault_row(id: i64, state: &mut VaultState, webview: Option<&WebView>) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if let Err(error) = remove_vault(conn, id) {
        eprintln!("Could not remove that vault: {error}");
        return;
    }
    if state.active == id {
        if let Err(error) = set_active_vault_id(conn, 0) {
            eprintln!("Could not clear the active vault: {error}");
        }
        state.active = 0;
        state.root = None;
    }
    push_vaults(webview, state);
}

fn apply_active_vault(
    id: i64,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if let Err(error) = set_active_vault_id(conn, id) {
        eprintln!("Could not remember the active vault: {error}");
    }
    state.active = id;
    state.root = find_vault(conn, id)
        .ok()
        .flatten()
        .map(|vault| PathBuf::from(vault.root_path));
    // A new root, so the pane starts at the top of it rather than in a folder
    // that belonged to whatever was showing before.
    state.folder.clear();
    push_vaults(webview, state);
    request_folder(state, proxy, String::new());
}

/// Read one folder for the pane. Empty `path` is the top level — the vault's
/// folder, or the drive roots. Reading a directory is IO against whatever the
/// user pointed at, so it does not run on the event loop.
pub(crate) fn request_folder(state: &VaultState, proxy: &EventLoopProxy<UserEvent>, path: String) {
    let scope = state.root.clone();
    let proxy = proxy.clone();
    thread::spawn(move || {
        let listing = read_folder_listing(scope.as_deref(), &path);
        let _ = proxy.send_event(UserEvent::FolderLoaded { scope, listing });
    });
}

/// Deliver a finished read, unless the vault changed while it was running.
pub(crate) fn deliver_folder(
    state: &mut VaultState,
    webview: Option<&WebView>,
    scope: Option<PathBuf>,
    listing: FolderListing,
) {
    if scope != state.root {
        return;
    }
    state.folder = listing.path.clone();
    let Some(webview) = webview else {
        return;
    };
    if let Err(error) = webview.evaluate_script(&library_folder_script(&listing)) {
        eprintln!("Failed to show the folder: {error}");
    }
}

/// The one bounded folder the graph covers: the active vault, or the folder the
/// pane is in. `None` at the drive roots with no vault — there is nothing
/// bounded to graph there, and walking a whole disk is the crawl we just left.
pub(crate) fn graph_root(state: &VaultState) -> Option<PathBuf> {
    if let Some(root) = state.root.clone() {
        return Some(root);
    }
    let folder = Path::new(&state.folder);
    (!state.folder.is_empty() && folder.is_dir()).then(|| folder.to_path_buf())
}

/// Build the link graph off the disk and hand it to the page through the same
/// callback the indexed graph used, so the front end is none the wiser.
pub(crate) fn request_link_graph(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    request: GraphRequest,
) {
    let Some(root) = graph_root(state) else {
        // Nothing bounded to read. An empty graph, not an error: the page says
        // what to do about it.
        let _ = proxy.send_event(UserEvent::Indexer(IndexerEvent::Graph {
            graph: DocumentGraph {
                nodes: Vec::new(),
                edges: Vec::new(),
                truncated: false,
            },
            error: None,
        }));
        return;
    };
    let proxy = proxy.clone();
    thread::spawn(move || {
        let graph = read_link_graph(&root, &request);
        let _ = proxy.send_event(UserEvent::Indexer(IndexerEvent::Graph {
            graph,
            error: None,
        }));
    });
}

/// Whether a path that changed on disk would alter what the pane is showing:
/// the folder itself, or something directly inside it. Nothing below that is on
/// screen, so nothing below that needs a re-read.
pub(crate) fn change_affects_pane(state: &VaultState, changed: &Path) -> bool {
    if state.folder.is_empty() {
        return false;
    }
    let folder = Path::new(&state.folder);
    changed == folder || changed.parent() == Some(folder)
}

/// Send the registry and the active id to the page.
pub(crate) fn push_vaults(webview: Option<&WebView>, state: &VaultState) {
    let Some(webview) = webview else {
        return;
    };
    if let Err(error) = webview.evaluate_script(&vaults_script(&state.vaults(), state.active)) {
        eprintln!("Failed to update the vault switcher: {error}");
    }
}
