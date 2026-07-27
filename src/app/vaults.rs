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
    /// The active vault's text. Read once, on first use, then patched a file at
    /// a time by the watcher. Both the graph and search read it, so the vault is
    /// opened once and serves both.
    ///
    /// Behind an `Arc` because neither of those runs here: walking every
    /// document to build a graph or scan for a query is far too much work for
    /// the thread that answers the window, so each goes to a worker holding a
    /// cheap clone of this.
    pub(crate) corpus: Option<Arc<VaultCorpus>>,
    /// A read is in flight, so a second request waits rather than starting one.
    pub(crate) corpus_loading: bool,
    /// What asked for the corpus while it was being read.
    pub(crate) pending_graph: Option<GraphRequest>,
    pub(crate) pending_search: Option<String>,
    /// The last graph asked for, so an edit on disk can redraw it.
    pub(crate) last_graph: Option<GraphRequest>,
    /// Whether the page is showing the graph. Transient, and the page owns it —
    /// this copy exists only so a file changing on disk knows whether there is
    /// a map on screen worth rebuilding.
    pub(crate) graph_open: bool,
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
            corpus: None,
            corpus_loading: false,
            pending_graph: None,
            pending_search: None,
            last_graph: None,
            graph_open: false,
        }
    }

    /// Forget the vault's text and anything waiting on it. Called whenever the
    /// root moves: what was read is about somewhere else now.
    pub(crate) fn drop_corpus(&mut self) {
        self.corpus = None;
        self.pending_graph = None;
        self.pending_search = None;
        self.last_graph = None;
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
        state.drop_corpus();
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
        state.drop_corpus();
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
    // that belonged to whatever was showing before, and everything read under
    // the old one is about somewhere else.
    state.folder.clear();
    state.drop_corpus();
    push_vaults(webview, state);
    request_folder(state, proxy, String::new());
}

/// Show a document in the pane: switch to the vault that owns it when that is
/// not the one on screen, then open the folder holding it.
///
/// Going to a file should land you where the file *is*. Without this the pane
/// only ever navigated inside whatever vault happened to be active, so a file
/// from somewhere else clamped back to that vault's root and the trail read as
/// the wrong place entirely. A file in no vault lands on the whole library, for
/// the same reason in reverse.
pub(crate) fn reveal_in_library(
    file: &Path,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let owner = state
        .conn
        .as_ref()
        .and_then(|conn| vault_containing(conn, file));
    let target = owner.as_ref().map(|vault| vault.id).unwrap_or(0);
    if target != state.active {
        if let Some(conn) = state.conn.as_ref() {
            if let Err(error) = set_active_vault_id(conn, target) {
                eprintln!("Could not remember the active vault: {error}");
            }
        }
        state.active = target;
        state.root = owner.map(|vault| PathBuf::from(vault.root_path));
        // A different root: what was read under the old one is about somewhere
        // else, and the graph with it.
        state.drop_corpus();
        push_vaults(webview, state);
    }
    let folder = file
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .unwrap_or_default();
    request_folder(state, proxy, folder);
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

/// The one folder the graph covers: the active vault, and only that.
///
/// It used to fall back to whatever folder the pane was in, which read fine
/// until that folder was `C:\` — then opening the graph walked the whole drive,
/// which is the crawl this all exists to be rid of. A vault is the only thing in
/// the app that means "this is a collection", and a graph is a map of one.
pub(crate) fn graph_root(state: &VaultState) -> Option<PathBuf> {
    state.root.clone()
}

/// The link graph, off the vault's text. Waits for the read if it is the first
/// thing to ask for it, and builds on a worker either way.
pub(crate) fn request_link_graph(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    request: GraphRequest,
) {
    state.last_graph = Some(request.clone());
    if graph_root(state).is_none() {
        // Nothing bounded to read. An empty graph, not an error: the page says
        // what to do about it. Cheap enough to answer here.
        if let Some(webview) = webview {
            let _ = webview.evaluate_script(&graph_script(&empty_graph()));
        }
        return;
    }
    match state.corpus.clone() {
        Some(corpus) => build_graph_off_thread(state, proxy, corpus, request),
        None => {
            state.pending_graph = Some(request);
            read_corpus(state, proxy);
        }
    }
}

/// Search the vault's text. Same wait-for-the-read shape as the graph, the same
/// one read behind both, and the same worker.
pub(crate) fn request_vault_search(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    query: String,
) {
    match state.corpus.clone() {
        Some(corpus) => run_search_off_thread(state, proxy, corpus, query),
        None => {
            state.pending_search = Some(query);
            read_corpus(state, proxy);
        }
    }
}

fn build_graph_off_thread(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    corpus: Arc<VaultCorpus>,
    request: GraphRequest,
) {
    let scope = state.root.clone();
    let proxy = proxy.clone();
    thread::spawn(move || {
        let graph = corpus.graph(&request);
        let _ = proxy.send_event(UserEvent::GraphReady { scope, graph });
    });
}

fn run_search_off_thread(
    state: &VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    corpus: Arc<VaultCorpus>,
    query: String,
) {
    let scope = state.root.clone();
    let proxy = proxy.clone();
    thread::spawn(move || {
        let hits = corpus.search(&query);
        let _ = proxy.send_event(UserEvent::SearchReady { scope, query, hits });
    });
}

/// Paint a finished graph, unless the vault moved while it was building.
pub(crate) fn deliver_graph(
    state: &VaultState,
    webview: Option<&WebView>,
    scope: Option<PathBuf>,
    graph: DocumentGraph,
) {
    if scope != state.root {
        return;
    }
    let Some(webview) = webview else {
        return;
    };
    if let Err(error) = webview.evaluate_script(&graph_script(&graph)) {
        eprintln!("Failed to draw the graph: {error}");
    }
}

/// Same for a finished search. The page also drops answers to queries the field
/// has moved on from, so a slow one is harmless twice over.
pub(crate) fn deliver_search(
    state: &VaultState,
    webview: Option<&WebView>,
    scope: Option<PathBuf>,
    query: &str,
    hits: Vec<SearchHit>,
) {
    if scope != state.root {
        return;
    }
    let Some(webview) = webview else {
        return;
    };
    if let Err(error) = webview.evaluate_script(&search_results_script(query, &hits)) {
        eprintln!("Failed to show search results: {error}");
    }
}

/// Start the one read, unless it is already running.
fn read_corpus(state: &mut VaultState, proxy: &EventLoopProxy<UserEvent>) {
    if state.corpus_loading {
        return;
    }
    let Some(root) = state.root.clone() else {
        return;
    };
    state.corpus_loading = true;
    let proxy = proxy.clone();
    thread::spawn(move || {
        let corpus = VaultCorpus::read(&root);
        let _ = proxy.send_event(UserEvent::CorpusLoaded {
            corpus: Box::new(corpus),
        });
    });
}

/// The read landed. Anything that was waiting on it starts now — on a worker,
/// not here.
pub(crate) fn deliver_corpus(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    corpus: VaultCorpus,
) {
    state.corpus_loading = false;
    // Read under a root we have since left: throw it away rather than answer
    // with someone else's vault.
    if state.root.as_deref() != Some(corpus.root.as_path()) {
        return;
    }
    let corpus = Arc::new(corpus);
    state.corpus = Some(Arc::clone(&corpus));
    if let Some(request) = state.pending_graph.take() {
        build_graph_off_thread(state, proxy, Arc::clone(&corpus), request);
    }
    if let Some(query) = state.pending_search.take() {
        run_search_off_thread(state, proxy, corpus, query);
    }
}

/// A file under the vault changed: patch that one document. This is what "live"
/// costs — one file read, not a scan.
///
/// The graph is redrawn only when it is the view on screen. Rebuilding it for a
/// pane nobody is looking at is what turned a burst of saves into a locked
/// window, and rebuilding it *here* is what made each one cost the whole vault.
pub(crate) fn refresh_corpus_path(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    changed: &Path,
    graph_showing: bool,
) {
    let Some(corpus) = state.corpus.as_mut() else {
        return;
    };
    // Cheap unless a worker is mid-build against this exact corpus, in which
    // case it clones rather than mutate out from under it.
    Arc::make_mut(corpus).refresh(changed);
    if !graph_showing {
        return;
    }
    let (Some(request), Some(corpus)) = (state.last_graph.clone(), state.corpus.clone()) else {
        return;
    };
    build_graph_off_thread(state, proxy, corpus, request);
}

fn empty_graph() -> DocumentGraph {
    DocumentGraph {
        nodes: Vec::new(),
        edges: Vec::new(),
        truncated: false,
    }
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
