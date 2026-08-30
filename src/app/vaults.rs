//! The vault switcher: registering a folder as a library root, and pointing the pane at one.
//!
//! Everything a vault is lives in `manifest.db` — the folder itself is never written to. A vault scopes the library pane and nothing else: opening a file from outside it still works.
//!
//! The pane's files do not come from the database at all. They are read off the folder, one folder at a time, by [`request_folder`].

use super::*;

use std::collections::BTreeSet;

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
    /// Which vault's read is wanted. Claimed when one starts and bumped when the vault is left, so the thread stops between documents instead of walking a folder nobody is in — its own counter rather than `corpus_generation`, which every slice bumps and would cancel the read that sent it.
    pub(crate) corpus_read: WorkGeneration,
    /// The text above is part of a vault, not all of it: the read has handed over some slices and not the last. An answer scanned over it is true of what has been read and no more, so it is never kept, and the pane keeps its ring.
    pub(crate) corpus_partial: bool,
    /// Documents that changed while the read was running, to be re-read once it has finished. A change patched into partial text is thrown away by the slice that replaces the preview, or appended again by a slice that then reads the same file — so the change waits here instead, and the whole-vault seam replays it.
    pub(crate) corpus_changes: BTreeSet<PathBuf>,
    /// What asked for the corpus while it was being read.
    pub(crate) pending_graph: Option<GraphRequest>,
    pub(crate) pending_search: Option<TypedQuery>,
    /// Vaults whose git state is being read right now, and which of those were asked again while that read was running. A read is a thread and five git processes, so a burst of saves must not start one each.
    ///
    /// Keyed by id rather than a single flag: the page asks for every vault it knows at once, and a second vault must not be made to wait behind the first.
    pub(crate) status_loading: HashSet<i64>,
    pub(crate) status_pending: HashSet<i64>,
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
            corpus_read: WorkGeneration::default(),
            corpus_partial: false,
            corpus_changes: BTreeSet::new(),
            pending_graph: None,
            pending_search: None,
            status_loading: HashSet::new(),
            status_pending: HashSet::new(),
            search: VaultSearch::default(),
            last_graph: None,
            graph_open: false,
        }
    }

    /// Whether a git-state read may start for this vault now. A no remembers that it was asked, so the read already running leaves exactly one repeat behind it — a request that arrived mid-read describes a folder the running read predates, so it cannot be served by that answer.
    pub(crate) fn may_read_status(&mut self, id: i64) -> bool {
        if self.status_loading.insert(id) {
            return true;
        }
        self.status_pending.insert(id);
        false
    }

    /// A read has landed: let the next one start, and say whether one was asked for while it ran.
    pub(crate) fn status_read_settled(&mut self, id: i64) -> bool {
        self.status_loading.remove(&id);
        self.status_pending.remove(&id)
    }

    /// Forget the vault's text and anything waiting on it. Called whenever the root moves: what was read is about somewhere else now.
    ///
    /// Its callers ask `pointing_here_is_a_move` first, because the folder you are already in is not one you left — re-picking it would otherwise throw away a whole vault's text and the read still filling it.
    pub(crate) fn drop_corpus(&mut self) {
        self.corpus = None;
        self.corpus_generation += 1;
        // Every caller is a vault move, so a path kept for the old root would be replayed into the new one's text.
        self.corpus_changes.clear();
        self.pending_graph = None;
        self.pending_search = None;
        self.last_graph = None;
        // A scan of the vault we just left is work nobody is waiting on, and neither is the read feeding it.
        self.search.cancel();
        self.corpus_read.cancel();
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
        // Accepting the folder the vault already shows is the same slip as picking it again from scratch, so it is the same rule.
        point_at_vault(state, id, Some(folder.to_path_buf()));
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
    let root = find_vault(conn, id)
        .ok()
        .flatten()
        .map(|vault| PathBuf::from(vault.root_path));
    // An id we cannot find a folder for is no vault at all. Keeping the two in step matters because the page is told the id and decides what to offer from it, while search and the graph need the folder — set one without the other and the interface offers a vault nothing can read.
    let active = if root.is_some() { id } else { 0 };
    point_at_vault(state, active, root);
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

/// What starting the one read needs: the folder to walk, the number every slice of it is stamped with, and the counter that number is read against. `None` where a read is already running or there is no vault.
///
/// The number is claimed here, once, so a slice can never be stamped with one the reader has already moved past — which would refuse every slice of every read and leave each vault empty with the whole suite still green. State alone and no worker, which is what lets a test ask it.
pub(crate) struct CorpusRead {
    pub(crate) root: PathBuf,
    pub(crate) wanted: u64,
    pub(crate) counter: WorkGeneration,
}

/// The read the open vault would start now, or nothing.
pub(crate) fn corpus_read_to_start(state: &mut VaultState) -> Option<CorpusRead> {
    if state.corpus_loading {
        return None;
    }
    let root = state.root.clone()?;
    state.corpus_loading = true;
    // The read about to start re-reads every document itself, so anything kept for the read before it would be replayed against text that already holds it.
    state.corpus_changes.clear();
    Some(CorpusRead {
        root,
        wanted: state.corpus_read.claim(),
        counter: state.corpus_read.clone(),
    })
}

/// Start the one read, unless it is already running. The code view's typing help also calls this: its first ask under an unread vault starts the read.
pub(crate) fn read_corpus(state: &mut VaultState, proxy: &EventLoopProxy<UserEvent>) {
    let Some(CorpusRead {
        root,
        wanted,
        counter,
    }) = corpus_read_to_start(state)
    else {
        return;
    };
    // Its own thread rather than `off_loop`, because this worker answers many times: a slice of the vault every fifty documents, so the pane fills while the disk is still being read instead of after it.
    let proxy = proxy.clone();
    thread::spawn(move || {
        let overtaken = || !counter.is_current(wanted);
        VaultCorpus::read_in_slices(&root, CORPUS_SLICE_DOCUMENTS, &overtaken, |slice| {
            let _ = proxy.send_event(UserEvent::CorpusLoaded {
                root: root.clone(),
                documents: Box::new(slice.documents),
                truncated: slice.truncated,
                skipped: slice.skipped,
                replaces: slice.replaces,
                last: slice.last,
                wanted,
            });
        });
    });
}

/// What one slice of a read leaves to be done, once the vault's held text has grown by it.
pub(crate) struct AbsorbedSlice {
    pub(crate) corpus: Arc<VaultCorpus>,
    /// The query parked on the read, to answer again over what has landed now.
    pub(crate) parked: Option<TypedQuery>,
    /// A map somebody asked for while the read was running. Answered once, on the last slice: a picture redrawn every third of a second while the disk is read is a map nobody can look at.
    pub(crate) graph: Option<GraphRequest>,
    /// The completion menu's field names, on the last slice only — they are the whole vault's, and a menu that grew as the disk was read would offer a different list each time. A frontmatter parse per document, under a millisecond over eight thousand of them, so it costs the window nothing here.
    pub(crate) hints: Option<FilterHints>,
}

/// Grow the vault's text by one slice of the read, and say what that leaves to do. Split from [`deliver_corpus`] because everything here is a decision about state and nothing here touches a worker, which is the half worth testing.
///
/// `None` when the slice is for a vault we have since left, or for a read nobody is waiting on any more. The two answer different questions — which vault, and which read — and only the second catches a vault left and come straight back to, where the root is the same again while the abandoned read is still delivering.
pub(crate) fn absorb_corpus_slice(
    state: &mut VaultState,
    root: &Path,
    documents: Vec<CorpusDocument>,
    truncated: bool,
    skipped: Vec<String>,
    replaces: bool,
    last: bool,
    wanted: u64,
) -> Option<AbsorbedSlice> {
    if last {
        state.corpus_loading = false;
    }
    if state.root.as_deref() != Some(root) {
        return None;
    }
    // Leaving the vault bumped this, so a slice stamped with the older number is a read nobody is waiting on — including the one overtaken before it opened a document, whose only slice also replaces.
    if !state.corpus_read.is_current(wanted) {
        return None;
    }
    match state.corpus.as_mut().filter(|_| !replaces) {
        // Cheap unless a worker is mid-scan against this exact text, in which case it clones rather than grow it out from under one.
        Some(held) => {
            let held = Arc::make_mut(held);
            held.documents.extend(documents);
            held.truncated |= truncated;
            // Every slice carries the same list, so this is the walk's one answer restated rather than a set growing.
            held.skipped = skipped;
        }
        None => {
            state.corpus = Some(Arc::new(VaultCorpus {
                root: root.to_path_buf(),
                documents,
                truncated,
                skipped,
            }))
        }
    }
    state.corpus_partial = !last;
    // The text is the whole vault now, so the changes held back while it was partial are read into it here — before the clone below, which is what the map, the filter hints and the final search all answer from.
    if last {
        replay_corpus_changes(state);
    }
    // Every slice is a change to the text, which is what makes a kept answer and the narrowing shortcut refuse themselves: both turn on this number, so neither can hand back a whole vault's answer that saw half of it.
    state.corpus_generation += 1;
    let corpus = Arc::clone(state.corpus.as_ref()?);
    Some(AbsorbedSlice {
        hints: last.then(|| corpus.filter_hints()),
        graph: last.then(|| state.pending_graph.take()).flatten(),
        // The parked query stays in its slot until the last slice, so every one of them answers it. Taken on the first, it would answer once and go quiet for the rest of the read — the silence this is here to end.
        parked: if last {
            state.pending_search.take()
        } else {
            state.pending_search.clone()
        },
        corpus,
    })
}

/// Whether the open vault is owed a read: nothing is running, there is a vault, and a search or a map is waiting on text that will never arrive on its own. True after a slice of the vault somebody left clears the one-at-a-time guard, which is the moment an ask made in the vault they switched *to* stops being refused and starts being forgotten.
///
/// Keyed on the guard rather than on the slice being the last one, so which slice frees a read stays written in the one place that owns it. State alone and no worker, which is what lets a test ask it.
pub(crate) fn read_is_owed(state: &VaultState) -> bool {
    !state.corpus_loading
        && state.root.is_some()
        && (state.pending_search.is_some() || state.pending_graph.is_some())
}

/// Point the pane at a vault and say whether that left the folder it was in. Both ways of pointing at one — picking it from the menu, and moving the one on screen to another folder — ask this same question, and both must ask it before the root is overwritten, since the answer is about what is held against what is arriving.
///
/// A move clears the pane back to the top of the new root rather than a folder that belonged to whatever was showing before, and forgets the vault's text, which is about somewhere else. Re-picking the folder you are already in is not leaving it, so it keeps both. State alone and no worker, which is what lets a test ask it.
pub(crate) fn point_at_vault(state: &mut VaultState, id: i64, root: Option<PathBuf>) -> bool {
    let moved = pointing_here_is_a_move(state, id, root.as_deref());
    state.root = root;
    state.active = id;
    state.folder.clear();
    if moved {
        state.drop_corpus();
    }
    moved
}

/// Whether pointing the pane at `id` and `root` moves it anywhere at all. A no means the vault's text is still about that same folder, so it is kept: re-picking the folder you are already in is not leaving it. State alone and no worker, which is what lets a test ask it.
pub(crate) fn pointing_here_is_a_move(state: &VaultState, id: i64, root: Option<&Path>) -> bool {
    state.active != id || state.root.as_deref() != root
}

/// What one delivered slice leaves the loop to do.
pub(crate) enum SliceWork {
    /// The slice grew the vault's text, and this is what that leaves to do.
    Absorbed(AbsorbedSlice),
    /// The slice belonged to a vault nobody is in any more, and letting go of it freed the one read that anything asked since has been turned away by.
    StartTheOwedRead,
    /// A slice nobody is waiting on, with nobody waiting on the open vault either.
    Nothing,
}

/// Grow the vault's text by one slice and say what that leaves to do — including the case the slice itself is worthless for: giving it up is what frees the read anything asked since the reader switched vaults has been sitting behind. State alone and no worker, which is what lets a test ask it.
#[allow(clippy::too_many_arguments)]
pub(crate) fn delivered_slice_work(
    state: &mut VaultState,
    root: &Path,
    documents: Vec<CorpusDocument>,
    truncated: bool,
    skipped: Vec<String>,
    replaces: bool,
    last: bool,
    wanted: u64,
) -> SliceWork {
    match absorb_corpus_slice(
        state, root, documents, truncated, skipped, replaces, last, wanted,
    ) {
        Some(absorbed) => SliceWork::Absorbed(absorbed),
        None if read_is_owed(state) => SliceWork::StartTheOwedRead,
        None => SliceWork::Nothing,
    }
}

/// A slice of the read landed. The vault's text grows by it, and anything parked on the read is answered again — so a search fills in while the rest of the vault is still being opened. Whatever it starts runs on a worker, not here.
pub(crate) fn deliver_corpus(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    root: PathBuf,
    documents: Vec<CorpusDocument>,
    truncated: bool,
    skipped: Vec<String>,
    replaces: bool,
    last: bool,
    wanted: u64,
) -> Option<FilterHints> {
    let absorbed = match delivered_slice_work(
        state, &root, documents, truncated, skipped, replaces, last, wanted,
    ) {
        SliceWork::Absorbed(absorbed) => absorbed,
        SliceWork::StartTheOwedRead => {
            read_corpus(state, proxy);
            return None;
        }
        SliceWork::Nothing => return None,
    };
    if let Some(request) = absorbed.graph {
        build_vault_graph_off_thread(proxy, root, Arc::clone(&absorbed.corpus), request);
    }
    if let Some(query) = absorbed.parked {
        // Every slice grows the text, so there is nothing a shorter query's matches could narrow this to.
        run_search(state, proxy, absorbed.corpus, query, None);
    }
    absorbed.hints
}

/// Patch every changed path in one batch, then rebuild the map at most once.
pub(crate) fn refresh_corpus_paths(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    changed: &[PathBuf],
    graph_showing: bool,
) {
    match corpus_changes_redraw(state, changed, graph_showing) {
        GraphRedraw::Vault {
            root,
            corpus,
            request,
        } => {
            build_vault_graph_off_thread(proxy, root, corpus, request);
        }
        GraphRedraw::Document { seed, request } => {
            build_document_graph_off_thread(proxy, seed, request);
        }
        GraphRedraw::Nothing => {}
    }
}

/// What a changed file leaves the map to redraw.
pub(crate) enum GraphRedraw {
    /// The vault's text really moved, so the map drawn from it can have changed.
    Vault {
        root: PathBuf,
        corpus: Arc<VaultCorpus>,
        request: GraphRequest,
    },
    /// A document's own map, which has to be rebuilt to find out whether it changed.
    Document {
        seed: PathBuf,
        request: GraphRequest,
    },
    Nothing,
}

/// Patch every path in one watcher batch and say what one map redraw then owes.
pub(crate) fn corpus_changes_redraw(
    state: &mut VaultState,
    changed: &[PathBuf],
    graph_showing: bool,
) -> GraphRedraw {
    let corpus_moved = changed
        .iter()
        .any(|path| record_or_refresh_corpus_path(state, path));
    if !graph_showing {
        return GraphRedraw::Nothing;
    }
    let Some(pending) = state.last_graph.clone() else {
        return GraphRedraw::Nothing;
    };
    match graph_source(state, pending.document.as_deref()) {
        // The vault's text is a cache, so the cache is the thing to ask: unless patching it moved something, the map cannot have changed. A vault is a folder someone works in, and unasked, every unrelated write in it reaches the page as a fresh graph — which the page can only receive by tearing the map down.
        Some(GraphSource::Vault(root)) => match state.corpus.clone().filter(|_| corpus_moved) {
            Some(corpus) => GraphRedraw::Vault {
                root,
                corpus,
                request: pending.request,
            },
            None => GraphRedraw::Nothing,
        },
        // A document's map holds no cache to compare against, so "did this change anything" cannot be answered here. Rebuild for any document that could be in the picture and let the page drop the redraw: it compares what arrives against what it is already drawing, and an identical graph never reaches the scene.
        Some(GraphSource::Document(seed))
            if changed
                .iter()
                .any(|path| crate::is_supported_document_path(path)) =>
        {
            GraphRedraw::Document {
                seed,
                request: pending.request,
            }
        }
        _ => GraphRedraw::Nothing,
    }
}

/// The one door every change to a document takes, whether it was saved here or written by something else: re-read it now against finished text, or keep it until the read filling that text has handed over its last slice.
///
/// Nothing is patched into a partial vault, because the read still owns it — the slice that replaces the preview would throw the change away, and a slice arriving later reads the same file off the disk as it was before the save. Says whether the held text actually moved, which is false for every kept path: the map is redrawn off this answer, and the vault it would be drawn from is half a vault.
pub(crate) fn record_or_refresh_corpus_path(state: &mut VaultState, changed: &Path) -> bool {
    if state.corpus_loading {
        // A set, so a file saved five times during one read is one re-read at the end of it.
        state.corpus_changes.insert(changed.to_path_buf());
        return false;
    }
    patch_vault_corpus(state, changed)
}

/// Re-read every path kept while the read was running, now that the last slice has landed and the text is the whole vault. Each is read once however often it changed, and a path the read already carried in its final shape moves nothing.
fn replay_corpus_changes(state: &mut VaultState) {
    for changed in std::mem::take(&mut state.corpus_changes) {
        patch_vault_corpus(state, &changed);
    }
}

/// Bring the vault's held text up to date for one changed path, and say whether that actually moved anything.
pub(crate) fn patch_vault_corpus(state: &mut VaultState, changed: &Path) -> bool {
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

/// Which vault's git state to read again, or none. Asked by the watcher on every change and by the window coming back to the front: a commit made in a terminal writes nothing but `.git`, which the watcher does not report, so nothing else would ever correct the header's count, and coming back to the window is the gesture that follows committing elsewhere. Losing focus asks nothing.
pub(crate) fn vault_to_reread(state: &VaultState) -> Option<i64> {
    (state.active != 0).then_some(state.active)
}

/// One thing the watcher does about a path that changed on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WatchedChangeStep {
    /// Read this vault's git state again, so the header's count moves.
    RereadVaultStatus(i64),
    /// The document on screen changed under the reader, so it is loaded again.
    ReloadActiveDocument,
    /// The pane lists this one folder off the disk, and the change is in it.
    RereadPaneFolder(String),
    /// Patch the vault's own text, redrawing the graph only where the graph is the view on screen.
    PatchCorpus {
        paths: Vec<PathBuf>,
        redraw_graph: bool,
    },
    /// A picture rather than a document: the text is unchanged, so only the page's images are refreshed.
    RefreshImages,
    /// Tells the page its remembered link answers may be stale.
    AgeLinkPreviews,
}

/// What the watcher does about a changed path, in the order it has to happen. The status read comes above the split, or it misses the commonest change of all — saving the document you are reading takes the active-document branch. Unfiltered on purpose: a containment check here compares the watcher's canonicalised path against the registry's plain one and so discards every event, and one `git status`, off the loop, on an already-debounced event, is cheaper than being wrong.
pub(crate) fn watched_change_steps(
    state: &VaultState,
    changed: &Path,
    is_active_document: bool,
) -> Vec<WatchedChangeStep> {
    let mut steps = Vec::new();
    if let Some(id) = vault_to_reread(state) {
        steps.push(WatchedChangeStep::RereadVaultStatus(id));
    }
    // The active-document branch returns before later steps.
    steps.push(WatchedChangeStep::AgeLinkPreviews);
    if is_active_document {
        steps.push(WatchedChangeStep::ReloadActiveDocument);
        return steps;
    }
    if change_affects_pane(state, changed) {
        steps.push(WatchedChangeStep::RereadPaneFolder(state.folder.clone()));
    }
    steps.push(WatchedChangeStep::PatchCorpus {
        paths: vec![changed.to_path_buf()],
        redraw_graph: state.graph_open,
    });
    if is_local_image_path(changed) {
        steps.push(WatchedChangeStep::RefreshImages);
    }
    steps
}

/// What one debounced watcher batch does, keeping the per-path branches and folding shared work.
pub(crate) fn watched_batch_steps(
    state: &VaultState,
    changed: impl IntoIterator<Item = (PathBuf, bool)>,
) -> Vec<WatchedChangeStep> {
    let mut status = None;
    let mut age_link_previews = false;
    let mut reload_active_document = false;
    let mut reread_pane_folder = None;
    let mut corpus_paths = Vec::new();
    let mut refresh_images = false;

    for (path, is_active_document) in changed {
        for step in watched_change_steps(state, &path, is_active_document) {
            match step {
                WatchedChangeStep::RereadVaultStatus(id) => status = Some(id),
                WatchedChangeStep::AgeLinkPreviews => age_link_previews = true,
                WatchedChangeStep::ReloadActiveDocument => reload_active_document = true,
                WatchedChangeStep::RereadPaneFolder(folder) => reread_pane_folder = Some(folder),
                WatchedChangeStep::PatchCorpus { paths, .. } => corpus_paths.extend(paths),
                WatchedChangeStep::RefreshImages => refresh_images = true,
            }
        }
    }

    let mut steps = Vec::new();
    if let Some(id) = status {
        steps.push(WatchedChangeStep::RereadVaultStatus(id));
    }
    if age_link_previews {
        steps.push(WatchedChangeStep::AgeLinkPreviews);
    }
    if reload_active_document {
        steps.push(WatchedChangeStep::ReloadActiveDocument);
    }
    if let Some(folder) = reread_pane_folder {
        steps.push(WatchedChangeStep::RereadPaneFolder(folder));
    }
    if !corpus_paths.is_empty() {
        steps.push(WatchedChangeStep::PatchCorpus {
            paths: corpus_paths,
            redraw_graph: state.graph_open,
        });
    }
    if refresh_images {
        steps.push(WatchedChangeStep::RefreshImages);
    }
    steps
}

/// One thing removing a vault does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VaultRemovalStep {
    /// The registry was the only record of what that id meant, so the favorites inside it go too.
    ForgetFavorites(i64),
    /// The shorter list first, because the registry push below is what redraws the start screen. The other way round it is drawn from favorites naming a vault the registry no longer has.
    RedrawTabStrip,
    /// Stop watching the vault's folder. Before the row goes, because the row is where the folder is written down — and before the folder goes, because a recursive watch reports every file in a folder being deleted and the whole point is that none of that is news.
    ReleaseWatch(PathBuf),
    /// The registry row itself, whose push to the page is what redraws the start screen.
    RemoveRow(i64),
    /// Removing the vault on screen lands back at the top of the whole library.
    ShowLibraryRoot,
}

/// What removing a vault does, in the order it has to happen.
pub(crate) fn vault_removal_steps(state: &VaultState, id: i64) -> Vec<VaultRemovalStep> {
    let mut steps = vec![
        VaultRemovalStep::ForgetFavorites(id),
        VaultRemovalStep::RedrawTabStrip,
    ];
    if let Some(root) = vault_root_path(state, id) {
        steps.push(VaultRemovalStep::ReleaseWatch(root));
    }
    steps.push(VaultRemovalStep::RemoveRow(id));
    steps.push(VaultRemovalStep::ShowLibraryRoot);
    steps
}

/// Refresh pressed on one vault. Pressing it wakes a vault the timer had stopped asking: whoever pressed it knows something the app does not — that the network is back, or that the service is answering again.
pub(crate) fn wake_and_refresh_vault(
    reader: &Reader,
    vault_state: &VaultState,
    refresh_book: &mut RefreshBook,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
) {
    refresh_book.wake(id);
    let Some(vault) = vault_state
        .conn
        .as_ref()
        .and_then(|conn| find_vault(conn, id).ok().flatten())
    else {
        return;
    };
    if !refresh_book.is_busy(id) {
        start_refresh(&vault, vault_state, refresh_book, proxy, reader.page());
    }
}

/// The account signed out of one vault, and the panel handed its row again — the panel draws itself from that row, and the account on it is what just changed.
pub(crate) fn sign_out_vault_row(reader: &Reader, vault_state: &VaultState, id: i64) {
    if let Err(error) = sign_out_vault(vault_state, id) {
        report_file_action_failure(reader.page(), &error);
    }
    push_vaults(reader.page(), vault_state);
}

/// A new vault made out of a folder the reader picks.
pub(crate) fn create_vault_from_picker(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
) {
    if let Some(folder) = pick_vault_folder() {
        create_vault(
            &folder,
            VaultKind::Folder,
            vault_state,
            proxy,
            reader.page(),
        );
    }
}

/// A repository cloned into a folder the reader picks.
///
/// The folder is picked here rather than in the worker: a window belongs to the window's thread, and picking it first means a canceled one starts nothing.
pub(crate) fn clone_vault_into_picked_folder(url: String, proxy: &EventLoopProxy<UserEvent>) {
    if let Some(parent) = pick_clone_parent_folder() {
        clone_vault(url, parent, proxy);
    }
}

/// The vault the app is looking at, changed.
pub(crate) fn switch_active_vault(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
) {
    set_active_vault(id, vault_state, proxy, reader.page());
    // A different vault has a different repository, and its button should be right before anyone looks at it.
    refresh_vault_status(vault_state, proxy, id);
    // Back to the whole library: its top is the drive roots, which `request_folder` returns without reading anything.
    if vault_state.root.is_none() {
        vault_state.folder.clear();
        request_folder(vault_state, proxy, String::new());
    }
}

/// One vault pointed at a different folder, picked by the reader.
pub(crate) fn change_vault_folder_from_picker(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
) {
    if let Some(folder) = pick_vault_folder() {
        change_vault_folder(id, &folder, vault_state, proxy, reader.page());
    }
}

/// One vault taken off the list, everywhere it is held. The watcher sync at the end of the turn puts back whatever watch is still wanted.
pub(crate) fn remove_vault_everywhere(
    reader: &mut Reader,
    vault_state: &mut VaultState,
    file_watch: &mut FileWatch,
    proxy: &EventLoopProxy<UserEvent>,
    id: i64,
) {
    for step in vault_removal_steps(vault_state, id) {
        match step {
            VaultRemovalStep::ForgetFavorites(id) => reader.forget_vault_favorites(id),
            VaultRemovalStep::RedrawTabStrip => reader.refresh_tab_strip(),
            VaultRemovalStep::ReleaseWatch(root) => file_watch.release(&root),
            VaultRemovalStep::RemoveRow(id) => remove_vault_row(id, vault_state, reader.page()),
            VaultRemovalStep::ShowLibraryRoot => {
                vault_state.folder.clear();
                request_folder(vault_state, proxy, String::new());
            }
        }
    }
}

/// The link map at the size the page asked for. Focus keeps the seed neighborhood; the rest cap the densest documents, up to XL, which caps nothing.
///
/// Off the vault's own text when the vault holds the document on screen — read once and shared with search — and off that document itself otherwise, so a file in no vault still has a map of what it links to.
pub(crate) fn request_graph_for(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    scope: &str,
    seeds: Vec<String>,
) {
    let request = match GraphScope::from_client(scope).unwrap_or_default() {
        GraphScope::Small => GraphRequest {
            focus: Some(seeds),
            limit: None,
        },
        GraphScope::Medium => GraphRequest {
            focus: None,
            limit: Some(2000),
        },
        GraphScope::Large => GraphRequest {
            focus: None,
            limit: Some(5000),
        },
        GraphScope::Xl => GraphRequest {
            focus: None,
            limit: None,
        },
    };
    let document = reader.workspace.active_path().map(Path::to_path_buf);
    request_link_graph(
        vault_state,
        proxy,
        reader.webview.as_ref(),
        document,
        request,
    );
}

/// The Previous/Next strip's own page, built off the loop because it walks the document's folder.
pub(crate) fn load_pager_page(proxy: &EventLoopProxy<UserEvent>, path: PathBuf) {
    off_loop(proxy, move || {
        let html = document_pager_html(&path);
        UserEvent::PagerLoaded { path, html }
    });
}
