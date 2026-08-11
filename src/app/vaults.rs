//! The vault switcher: registering a folder as a library root, and pointing the pane at one.
//!
//! Everything a vault is lives in `manifest.db` — the folder itself is never written to. A vault scopes the library pane and nothing else: opening a file from outside it still works.
//!
//! The pane's files do not come from the database at all. They are read off the folder, one folder at a time, by [`request_folder`].

use super::*;

/// The library pane's tree source while a vault is active, and the id the page was last told about. Held by the loop so a folder read that lands after a switch can be discarded.
pub(crate) struct VaultState {
    /// Read-write connection to `manifest.db`. `open_db` applies the migrations on the way in, so the tables are already there.
    pub(crate) conn: Option<Connection>,
    /// The app's own data root, kept because a remote vault's files live in a folder under it that has to go when the vault does.
    pub(crate) data_dir: Option<PathBuf>,
    pub(crate) active: i64,
    pub(crate) root: Option<PathBuf>,
    /// The folder the pane is showing, so a change on disk under it can be noticed and a stale read discarded.
    pub(crate) folder: String,
    /// The active vault's text. Read once, on first use, then patched a file at a time by the watcher. Both the graph and search read it, so the vault is opened once and serves both.
    ///
    /// Behind an `Arc` because neither of those runs here: walking every document to build a graph or scan for a query is far too much work for the thread that answers the window, so each goes to a worker holding a cheap clone of this.
    pub(crate) corpus: Option<Arc<VaultCorpus>>,
    /// Bumped whenever that text changes — read, patched by the watcher, or dropped on a vault switch. It is what tells a kept answer it is still true.
    pub(crate) corpus_generation: u64,
    /// A read is in flight, so a second request waits rather than starting one.
    pub(crate) corpus_loading: bool,
    /// What asked for the corpus while it was being read.
    pub(crate) pending_graph: Option<GraphRequest>,
    pub(crate) pending_search: Option<TypedQuery>,
    /// The search thread and its query counter — see `vault_search.rs`.
    pub(crate) search: VaultSearch,
    /// The last graph asked for, so an edit on disk can redraw it.
    pub(crate) last_graph: Option<PendingGraph>,
    /// Whether the page is showing the graph. Transient, and the page owns it — this copy exists only so a file changing on disk knows whether there is a map on screen worth rebuilding.
    pub(crate) graph_open: bool,
}

impl VaultState {
    /// Load the registry at startup. With no database — it could not be opened — there are no vaults and the pane is the whole library.
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
        // An id whose row is gone means no vault: fall back to the whole library rather than to a pane nothing can leave.
        let active = if root.is_some() { active } else { 0 };
        Self {
            conn,
            data_dir: data_dir.map(Path::to_path_buf),
            active,
            root,
            folder: String::new(),
            corpus: None,
            corpus_generation: 0,
            corpus_loading: false,
            pending_graph: None,
            pending_search: None,
            search: VaultSearch::default(),
            last_graph: None,
            graph_open: false,
        }
    }

    /// Forget the vault's text and anything waiting on it. Called whenever the root moves: what was read is about somewhere else now.
    pub(crate) fn drop_corpus(&mut self) {
        self.corpus = None;
        self.corpus_generation += 1;
        self.pending_graph = None;
        self.pending_search = None;
        self.last_graph = None;
        // A scan of the vault we just left is work nobody is waiting on.
        self.search.cancel();
    }

    pub(crate) fn vaults(&self) -> Vec<Vault> {
        self.conn
            .as_ref()
            .map(|conn| list_vaults(conn).unwrap_or_default())
            .unwrap_or_default()
    }
}

/// Register the picked folder and switch to it. A folder that is already a vault is switched to rather than added twice.
///
/// `kind` is how the folder arrived: picked by the user, or made by a clone. It is the one thing about a vault that cannot be read back off the disk later, which is why it is recorded at the moment it is known.
pub(crate) fn create_vault(
    folder: &Path,
    kind: VaultKind,
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    let name = default_vault_name(folder);
    let vault = match add_vault(conn, folder, &name, kind) {
        Ok(vault) => vault,
        Err(error) => {
            eprintln!("Could not add {} as a vault: {error}", folder.display());
            return;
        }
    };
    apply_active_vault(vault.id, state, proxy, webview);
}

/// Which sync clients have a folder on this machine. Off the loop: it stats a handful of named paths and reads one small config file, and the thread that answers the window never waits on a disk.
pub(crate) fn request_cloud_folders(proxy: &EventLoopProxy<UserEvent>) {
    off_loop(proxy, move || {
        let folders = CloudRoots::from_environment()
            .map(|roots| cloud_folders(&roots))
            .unwrap_or_default();
        UserEvent::CloudFoldersReady { folders }
    });
}

/// Register any cloud folder that is not a vault yet, then tell the page which folders they are so a vault living in one wears a cloud rather than a box.
///
/// Nothing switches: a vault appearing is not a reason to move somebody off what they were reading, which is the whole difference between this and [`create_vault`].
pub(crate) fn deliver_cloud_folders(
    state: &VaultState,
    webview: Option<&WebView>,
    folders: &[CloudFolder],
) {
    if let Some(conn) = state.conn.as_ref() {
        let roots: Vec<String> = state
            .vaults()
            .into_iter()
            .map(|vault| vault.root_path)
            .collect();
        let mut added = false;
        for folder in cloud_folders_to_register(folders, &roots) {
            let path = Path::new(&folder.path);
            // A sync client's folder is a folder on this machine like any other: the client does the syncing, and the app is only pointed at what it left there.
            match add_vault(conn, path, &default_vault_name(path), VaultKind::Folder) {
                Ok(_) => added = true,
                Err(error) => eprintln!("Could not add {} as a vault: {error}", folder.path),
            }
        }
        if added {
            push_vaults(webview, state);
        }
    }
    run_page_script(
        webview,
        &cloud_folders_script(folders),
        "Failed to name the cloud folders",
    );
}

/// Point the pane at a vault, or at the whole library with `0`. An id with no row is ignored rather than emptying the pane.
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

/// Point an existing vault at `folder` — what to do when the wrong one was picked. Re-reads the pane when it is the vault on screen.
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

/// Forget a vault. Removing the one on screen falls back to the whole library, whose folder the caller then reads off the disk.
pub(crate) fn remove_vault_row(id: i64, state: &mut VaultState, webview: Option<&WebView>) {
    let Some(conn) = state.conn.as_ref() else {
        return;
    };
    if let Err(error) = remove_vault(conn, id) {
        eprintln!("Could not remove that vault: {error}");
        return;
    }
    // A remote vault's files are the app's, not the user's, so forgetting the vault forgets them. A folder vault has no mirror and this finds nothing, which is why it runs for every removal rather than only the ones that do.
    if let Some(data_dir) = state.data_dir.as_deref() {
        if let Err(error) = remove_vault_mirror(data_dir, id) {
            eprintln!("Could not remove that vault's copied files: {error}");
        }
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

/// Where a vault's files are on this machine, while the row is still there to say so.
pub(crate) fn vault_root_path(state: &VaultState, id: i64) -> Option<PathBuf> {
    let conn = state.conn.as_ref()?;
    find_vault(conn, id)
        .ok()
        .flatten()
        .map(|vault| PathBuf::from(vault.root_path))
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
    state.root = find_vault(conn, id)
        .ok()
        .flatten()
        .map(|vault| PathBuf::from(vault.root_path));
    // An id we cannot find a folder for is no vault at all. Keeping the two in step matters because the page is told the id and decides what to offer from it, while search and the graph need the folder — set one without the other and the interface offers a vault nothing can read.
    state.active = if state.root.is_some() { id } else { 0 };
    // A new root, so the pane starts at the top of it rather than in a folder that belonged to whatever was showing before, and everything read under the old one is about somewhere else.
    state.folder.clear();
    state.drop_corpus();
    push_vaults(webview, state);
    request_folder(state, proxy, String::new());
}

/// Show a document in the pane: switch to the vault that owns it when that is not the one on screen, then open the folder holding it.
///
/// Going to a file should land you where the file *is*. Without this the pane only ever navigates inside whatever vault happens to be active, so a file from somewhere else clamps back to that vault's root and the trail reads as the wrong place entirely. A file in no vault lands on the whole library, for the same reason in reverse.
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
        // Landing in another vault is remembered; landing outside every vault is not. Writing "no vault" into the database for one loose file forgets the vault you chose — for that session and every session after it — so opening something from a downloads folder would cost you it. Opening a file is navigation, and navigation must not overwrite a choice.
        if target != 0 {
            if let Some(conn) = state.conn.as_ref() {
                if let Err(error) = set_active_vault_id(conn, target) {
                    eprintln!("Could not remember the active vault: {error}");
                }
            }
        }
        state.active = target;
        state.root = owner.map(|vault| PathBuf::from(vault.root_path));
        // A different root: what was read under the old one is about somewhere else, and the graph with it.
        state.drop_corpus();
        push_vaults(webview, state);
    }
    let folder = file
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .unwrap_or_default();
    request_folder(state, proxy, folder);
}

/// Read one folder for the pane. Empty `path` is the top level — the vault's folder, or the drive roots. Reading a directory is IO against whatever the user pointed at, so it does not run on the event loop.
pub(crate) fn request_folder(state: &VaultState, proxy: &EventLoopProxy<UserEvent>, path: String) {
    let scope = state.root.clone();
    off_loop(proxy, move || {
        let listing = read_folder_listing(scope.as_deref(), &path);
        UserEvent::FolderLoaded { scope, listing }
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
    run_page_script(
        webview,
        &library_folder_script(&listing),
        "Failed to show the folder",
    );
}

/// A graph that was asked for: the document it was about, and the slice wanted. Kept so an edit on disk can redraw the same picture.
#[derive(Debug, Clone)]
pub(crate) struct PendingGraph {
    pub(crate) document: Option<PathBuf>,
    pub(crate) request: GraphRequest,
}

/// What a graph is drawn over — and the key a finished one is checked against, so a map built for somewhere else is dropped rather than painted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GraphSource {
    /// The active vault: every document under it. The bigger picture, because what links *back* to a document is only ever written in another one, and a whole collection is where `[[wiki]]` names can resolve.
    Vault(PathBuf),
    /// One document, its folder, and what it links to — [`document_graph`].
    Document(PathBuf),
}

/// What the graph on screen is drawn over, given the document on screen.
///
/// The vault wins when it holds that document, because it is strictly more. But it is not required, and that is the point: refusing to draw without a vault leaves every document outside one with no map, even though its links are sitting in its own text. A vault is something you name so search has a bounded set of words — not a precondition for a document having links.
///
/// Only reading a *folder tree* ever needed a vault to bound it, and a document's own map does not read one.
pub(crate) fn graph_source(state: &VaultState, document: Option<&Path>) -> Option<GraphSource> {
    let vault = state
        .root
        .as_deref()
        .filter(|root| document.is_none_or(|document| vault_holds(root, document)));
    match (vault, document) {
        (Some(root), _) => Some(GraphSource::Vault(root.to_path_buf())),
        (None, Some(document)) => Some(GraphSource::Document(document.to_path_buf())),
        // No document and no vault: nothing to be a map of. The page only offers the view with a document open, so this is not a state anyone can reach from the interface.
        (None, None) => None,
    }
}

/// The link graph. Off the vault's text when the vault holds the open document — waiting for that read if it is the first thing to ask for it — and off the document itself otherwise. Either way the building happens on a worker: it reads files, and the thread that answers the window must not.
pub(crate) fn request_link_graph(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    webview: Option<&WebView>,
    document: Option<PathBuf>,
    request: GraphRequest,
) {
    let source = graph_source(state, document.as_deref());
    state.last_graph = Some(PendingGraph {
        document,
        request: request.clone(),
    });
    match source {
        Some(GraphSource::Vault(root)) => match state.corpus.clone() {
            Some(corpus) => build_vault_graph_off_thread(proxy, root, corpus, request),
            None => {
                state.pending_graph = Some(request);
                read_corpus(state, proxy);
            }
        },
        Some(GraphSource::Document(seed)) => build_document_graph_off_thread(proxy, seed, request),
        None => {
            // An empty graph, not an error: the page shows it as nothing to draw. Cheap enough to answer here.
            run_page_script(
                webview,
                &graph_script(&empty_graph()),
                "Failed to draw the graph",
            );
        }
    }
}

fn build_vault_graph_off_thread(
    proxy: &EventLoopProxy<UserEvent>,
    root: PathBuf,
    corpus: Arc<VaultCorpus>,
    request: GraphRequest,
) {
    off_loop(proxy, move || UserEvent::GraphReady {
        source: GraphSource::Vault(root),
        graph: corpus.graph(&request),
    });
}

/// The map around one document. No corpus to wait for and none to keep: the read is one folder and one hop along the document's own links, so it is done fresh here rather than cached and patched.
fn build_document_graph_off_thread(
    proxy: &EventLoopProxy<UserEvent>,
    seed: PathBuf,
    request: GraphRequest,
) {
    off_loop(proxy, move || {
        let graph = DesktopHost::default().graph(&seed, &request);
        UserEvent::GraphReady {
            source: GraphSource::Document(seed),
            graph,
        }
    });
}

/// Paint a finished graph, unless what it is a map of moved while it was building — the vault switched, or the reader went to another document that a different source answers for. Switching documents *inside* one vault is not that: both are the same source, and moving the highlight is the page's own job.
pub(crate) fn deliver_graph(
    state: &VaultState,
    webview: Option<&WebView>,
    document: Option<&Path>,
    source: GraphSource,
    graph: DocumentGraph,
) {
    if graph_source(state, document) != Some(source) {
        return;
    }
    run_page_script(webview, &graph_script(&graph), "Failed to draw the graph");
}

/// Start the one read, unless it is already running. The code view's typing help also calls this: its first ask under an unread vault starts the read.
pub(crate) fn read_corpus(state: &mut VaultState, proxy: &EventLoopProxy<UserEvent>) {
    if state.corpus_loading {
        return;
    }
    let Some(root) = state.root.clone() else {
        return;
    };
    state.corpus_loading = true;
    off_loop(proxy, move || {
        let corpus = VaultCorpus::read(&root);
        // Read here, on the worker that has the text open anyway, rather than on the thread that answers the window: it is a frontmatter parse per document.
        let hints = corpus.filter_hints();
        UserEvent::CorpusLoaded {
            corpus: Box::new(corpus),
            hints: Box::new(hints),
        }
    });
}

/// The read landed. Anything that was waiting on it starts now — on a worker, not here.
pub(crate) fn deliver_corpus(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    corpus: VaultCorpus,
) {
    state.corpus_loading = false;
    // Read under a root we have since left: throw it away rather than answer with someone else's vault.
    if state.root.as_deref() != Some(corpus.root.as_path()) {
        return;
    }
    let corpus = Arc::new(corpus);
    state.corpus = Some(Arc::clone(&corpus));
    state.corpus_generation += 1;
    if let Some(request) = state.pending_graph.take() {
        build_vault_graph_off_thread(proxy, corpus.root.clone(), Arc::clone(&corpus), request);
    }
    if let Some(query) = state.pending_search.take() {
        // The parked query is the first one over this text, so there is nothing to narrow to.
        run_search(state, proxy, corpus, query, None);
    }
}

/// A file changed on disk: patch the vault's text if the vault holds it, and redraw the map if one is on screen.
///
/// The graph is redrawn only when it is the view on screen. Rebuilding it for a pane nobody is looking at turns a burst of saves into a locked window, and rebuilding it *here* rather than on a worker makes each one cost the whole vault.
pub(crate) fn refresh_corpus_path(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    changed: &Path,
    graph_showing: bool,
) {
    let corpus_moved = patch_vault_corpus(state, changed);
    if !graph_showing {
        return;
    }
    let Some(pending) = state.last_graph.clone() else {
        return;
    };
    match graph_source(state, pending.document.as_deref()) {
        // The vault's text is a cache, so the cache is the thing to ask: unless patching it moved something, the map cannot have changed. A vault is a folder someone works in, and unasked, every unrelated write in it reaches the page as a fresh graph — which the page can only receive by tearing the map down.
        Some(GraphSource::Vault(root)) => {
            let Some(corpus) = state.corpus.clone().filter(|_| corpus_moved) else {
                return;
            };
            build_vault_graph_off_thread(proxy, root, corpus, pending.request);
        }
        // A document's map holds no cache to compare against, so "did this change anything" cannot be answered here. Rebuild for any document that could be in the picture and let the page drop the redraw: it compares what arrives against what it is already drawing, and an identical graph never reaches the scene.
        Some(GraphSource::Document(seed)) => {
            if !crate::is_supported_document_path(changed) {
                return;
            }
            build_document_graph_off_thread(proxy, seed, pending.request);
        }
        None => {}
    }
}

/// Bring the vault's held text up to date for one changed path, and say whether that actually moved anything.
fn patch_vault_corpus(state: &mut VaultState, changed: &Path) -> bool {
    let Some(corpus) = state.corpus.as_mut() else {
        return false;
    };
    // Before the refresh: `Arc::make_mut` clones the whole vault's text when a worker is mid-build, and a path that is not a document must not cost that.
    if !corpus.covers(changed) {
        return false;
    }
    // Cheap unless a worker is mid-build against this exact corpus, in which case it clones rather than mutate out from under it.
    let moved = Arc::make_mut(corpus).refresh(changed);
    if moved {
        // A kept search answer describes text that has just changed.
        state.corpus_generation += 1;
    }
    moved
}

fn empty_graph() -> DocumentGraph {
    DocumentGraph {
        nodes: Vec::new(),
        edges: Vec::new(),
        truncated: false,
    }
}

/// Whether a path that changed on disk would alter what the pane is showing: the folder itself, or something directly inside it. Nothing below that is on screen, so nothing below that needs a re-read.
pub(crate) fn change_affects_pane(state: &VaultState, changed: &Path) -> bool {
    if state.folder.is_empty() {
        return false;
    }
    let folder = Path::new(&state.folder);
    changed == folder || changed.parent() == Some(folder)
}

/// Send the registry and the active id to the page.
pub(crate) fn push_vaults(webview: Option<&WebView>, state: &VaultState) {
    run_page_script(
        webview,
        &vaults_script(&state.vaults(), state.active),
        "Failed to update the vault switcher",
    );
}
