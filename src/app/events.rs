//! The event vocabulary, and the IPC bridge the page talks over.
//!
//! [`IpcCommand`] is the page's whole vocabulary, and the loop handles it
//! directly: one variant, one handler arm. A second, mirrored enum with a
//! field-by-field copier between the two writes every command out three times
//! and lets the copies drift.

use super::*;

/// What the event loop can be told. The page's commands arrive whole as
/// [`UserEvent::FromPage`]; the rest are the app's own signals — a second
/// launch's forwarded file, the watcher, and answers coming back from worker
/// threads, none of which the page can say over IPC.
#[derive(Debug)]
pub(crate) enum UserEvent {
    /// A command the page sent over IPC, forwarded unopened.
    FromPage(IpcCommand),
    /// Open a document: a second launch's forwarded file, a macOS Apple Event,
    /// a drag-and-drop, or the page's `openRecent` re-sent as this. Also
    /// surfaces the window, which a forwarded open should do.
    OpenPath(PathBuf),
    /// The webview finished its first page load, so its render hooks now exist.
    /// Sent once on boot to flush a file passed on the command line, whose render
    /// would otherwise race the load.
    WebviewReady,
    /// A second launch of the app forwarded a request to this (primary) instance
    /// but carried no file — bring the existing window to the front.
    FocusWindow,
    /// The file backing some tab changed on disk; the live-reload watcher sends
    /// this with the changed path. Only acted on when it is the active document.
    FileChanged(PathBuf),
    /// The git panel's next whole state, already serialized on the worker thread.
    VaultGitReady { json: String },
    /// Just the folder's own git state, for the header's sync button.
    VaultStatusReady { id: i64, json: String },
    /// A folder finished being read off disk. `scope` is the vault root the read
    /// was made under, so a listing that lands after a vault switch is dropped.
    FolderLoaded {
        scope: Option<PathBuf>,
        listing: FolderListing,
    },
    /// The active vault's text finished being read. Whatever was waiting on it —
    /// a graph, a search — runs when it lands.
    CorpusLoaded { corpus: Box<VaultCorpus> },
    /// A graph finished building. Both this and the search below are computed on
    /// a worker thread: they read documents off the disk, which is far too much to
    /// do on the thread that answers the window.
    ///
    /// `source` is what the map is of — a vault, or one document — so a graph that
    /// finished after the reader moved somewhere a different source answers for is
    /// dropped rather than painted.
    GraphReady {
        source: GraphSource,
        graph: DocumentGraph,
    },
    SearchReady {
        scope: Option<PathBuf>,
        query: String,
        hits: Vec<SearchHit>,
    },
    /// The background pager scan completed for a document path.
    PagerLoaded { path: PathBuf, html: String },
    /// A code-view IntelliSense answer — completions, hover or lint — already
    /// serialized as the page script that delivers it, on the worker that
    /// computed it. The token inside pairs it with the ask.
    CodeIntelReady { script: String },
    /// How far along the running update download is, 0-100.
    UpdateDownloadProgress { version: String, percent: u8 },
    /// A verified installer is on disk and ready to apply.
    UpdateDownloadStaged { version: String },
    /// The download or its verification failed; nothing is staged.
    UpdateDownloadFailed { version: String, message: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command")]
pub(crate) enum IpcCommand {
    /// Show the OS file picker.
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "openRecent")]
    OpenRecent { path: PathBuf },
    /// Start an empty document in a new tab, unlocked for typing. It has no file
    /// until the first save, which asks where it goes.
    #[serde(rename = "newDocument")]
    NewDocument,
    /// Paste what the library pane last cut or copied into a folder. `cut` decides
    /// move or copy; the page carries both because the page is what remembered them.
    #[serde(rename = "pasteFile")]
    PasteFile {
        path: PathBuf,
        #[serde(rename = "intoFolder")]
        into_folder: PathBuf,
        cut: bool,
    },
    #[serde(rename = "revealFile")]
    RevealFile { path: PathBuf },
    #[serde(rename = "copyFile")]
    CopyFile { path: PathBuf, cut: bool },
    #[serde(rename = "copyPath")]
    CopyPath { path: PathBuf },
    #[serde(rename = "renameFile")]
    RenameFile {
        path: PathBuf,
        #[serde(rename = "newName")]
        new_name: String,
    },
    #[serde(rename = "deleteFile")]
    DeleteFile { path: PathBuf },
    #[serde(rename = "showProperties")]
    ShowProperties { path: PathBuf },
    #[serde(rename = "closeTab")]
    CloseTab { index: usize },
    #[serde(rename = "switchTab")]
    SwitchTab {
        index: usize,
        scroll_anchor: ScrollAnchor,
        /// Code-view scroll fraction when the outgoing tab is showing source;
        /// `None` for a reading-view tab.
        #[serde(default)]
        code_scroll: Option<f64>,
    },
    #[serde(rename = "moveTab")]
    MoveTab { from: usize, to: usize },
    #[serde(rename = "goHome")]
    GoHome,
    #[serde(rename = "openLink")]
    OpenLink {
        href: String,
        scroll_anchor: ScrollAnchor,
    },
    /// Open a URL in the system browser, unattached to any document (the update
    /// button). Unlike `OpenLink`, it doesn't require an active tab.
    #[serde(rename = "openExternal")]
    OpenExternal { url: String },
    /// A glossary link was clicked: show the term in a bottom sheet, not a new
    /// tab. `href` is the glossary file plus `#anchor`, relative to the doc.
    #[serde(rename = "openGlossary")]
    OpenGlossary { href: String },
    /// A hover tooltip wants a linked document's line count. `href` resolves
    /// against the active doc; `token` correlates the answer with the hover.
    #[serde(rename = "countLines")]
    CountLines { href: String, token: u64 },
    #[serde(rename = "goBack")]
    GoBack { scroll_anchor: ScrollAnchor },
    #[serde(rename = "goForward")]
    GoForward { scroll_anchor: ScrollAnchor },
    #[serde(rename = "setMinimapEnabled")]
    SetMinimapEnabled { enabled: bool },
    #[serde(rename = "setPagerEnabled")]
    SetPagerEnabled { enabled: bool },
    #[serde(rename = "setSpeedReaderEnabled")]
    SetSpeedReaderEnabled { enabled: bool },
    #[serde(rename = "setCodeIntelEnabled")]
    SetCodeIntelEnabled { enabled: bool },
    #[serde(rename = "setReadingUnlocked")]
    SetReadingUnlocked { enabled: bool },
    #[serde(rename = "setCodeUnlocked")]
    SetCodeUnlocked { enabled: bool },
    #[serde(rename = "setThemeFamily")]
    SetThemeFamily { family: String },
    #[serde(rename = "setThemeMode")]
    SetThemeMode { mode: String },
    /// The families already shown in the current random-theme cycle.
    #[serde(rename = "setThemeRandomBag")]
    SetThemeRandomBag { used: Vec<String> },
    /// Custom title-bar controls (the app bar is the title bar on frameless Windows).
    #[serde(rename = "windowDrag")]
    WindowDrag,
    #[serde(rename = "windowMinimize")]
    WindowMinimize,
    #[serde(rename = "windowToggleMaximize")]
    WindowToggleMaximize,
    #[serde(rename = "windowClose")]
    WindowClose,
    /// Paint the native title bar to the page color and the window border to the
    /// theme's divider color, both reported by the webview on theme change.
    #[serde(rename = "setWindowChrome")]
    SetWindowChrome {
        r: u8,
        g: u8,
        b: u8,
        #[serde(rename = "borderR")]
        border_r: u8,
        #[serde(rename = "borderG")]
        border_g: u8,
        #[serde(rename = "borderB")]
        border_b: u8,
        dark: bool,
    },
    /// Persist the folder the library pane is inside.
    #[serde(rename = "setLibraryState")]
    SetLibraryState {
        #[serde(rename = "projectPath")]
        project_path: String,
    },
    /// Whether the page is showing the graph. Not persisted — it says only
    /// whether a change on disk has a map on screen to redraw.
    #[serde(rename = "setGraphView")]
    SetGraphView { open: bool },
    /// A vault's git panel: read it, make it a repository, point it at one, or
    /// push it. Each runs off the loop and comes back as `VaultGitReady`.
    #[serde(rename = "getVaultGit")]
    GetVaultGit { id: i64 },
    #[serde(rename = "getVaultStatus")]
    GetVaultStatus { id: i64 },
    #[serde(rename = "createVaultRepo")]
    CreateVaultRepo { id: i64 },
    #[serde(rename = "linkVaultRemote")]
    LinkVaultRemote { id: i64, url: String },
    #[serde(rename = "syncVault")]
    SyncVault { id: i64 },
    /// Persist the library pane's open/closed state and last open width.
    #[serde(rename = "setLibraryLayout")]
    SetLibraryLayout { closed: bool, width: u32 },
    /// Pick a folder and register it as a vault, then switch the library to it.
    #[serde(rename = "createVault")]
    CreateVault,
    /// Scope the library to a vault by id; `0` is the whole library.
    #[serde(rename = "setActiveVault")]
    SetActiveVault {
        #[serde(default)]
        id: i64,
    },
    /// Relabel a vault. The folder is untouched.
    #[serde(rename = "renameVault")]
    RenameVault { id: i64, name: String },
    /// Reopen the folder picker and point an existing vault somewhere else —
    /// the fix for having picked the wrong folder.
    #[serde(rename = "changeVaultFolder")]
    ChangeVaultFolder { id: i64 },
    /// Forget a vault. The row goes; the folder stays.
    #[serde(rename = "removeVault")]
    RemoveVault { id: i64 },
    /// Show one folder in the library pane. Empty is the top level: the active
    /// vault's folder, or the drive roots.
    #[serde(rename = "getFolder")]
    GetFolder {
        #[serde(default)]
        path: String,
    },
    /// Point the pane at a document: the vault that owns it, and its folder.
    #[serde(rename = "revealInLibrary")]
    RevealInLibrary { path: PathBuf },
    /// Request the library link graph. `scope` is the persisted graph size;
    /// `seeds` are the focus documents, used only by the Focus scope.
    #[serde(rename = "getGraph")]
    GetGraph {
        #[serde(default)]
        scope: String,
        #[serde(default)]
        seeds: Vec<String>,
    },
    /// Persist the graph size the frontend just selected.
    #[serde(rename = "setGraphScope")]
    SetGraphScope { scope: String },
    /// Run a full-text search over the active vault's text. `scope` is the folder
    /// the pane is showing, sent as a hint and currently ignored — the whole vault
    /// is searched either way (see `event_loop.rs`).
    #[serde(rename = "search")]
    Search {
        query: String,
        #[serde(default)]
        scope: Option<Vec<String>>,
    },
    /// Compute Previous/Next pager links without blocking the initial render.
    #[serde(rename = "loadPager")]
    LoadPager { path: PathBuf },
    /// Swap the active document to the raw-source code view.
    #[serde(rename = "enterCodeView")]
    EnterCodeView,
    /// Swap the active document back to the rendered reading view.
    #[serde(rename = "exitCodeView")]
    ExitCodeView,
    /// A code-view edit, as the range it replaced rather than the whole buffer.
    #[serde(rename = "spliceSource")]
    SpliceSource {
        start: usize,
        removed: usize,
        inserted: String,
        length: usize,
    },
    /// The code-view editor changed; carries the full buffer text (debounced).
    #[serde(rename = "updateSource")]
    UpdateSource { text: String },
    /// Write the active document's buffer to disk.
    #[serde(rename = "saveDocument")]
    SaveDocument,
    /// The code view's popup wants the notes `[[` can complete to.
    #[serde(rename = "codeCompleteNotes")]
    CodeCompleteNotes { token: u64 },
    /// The headings of a named note (`[[note#`), or of the active buffer
    /// (`](#`) when `note` is absent.
    #[serde(rename = "codeCompleteHeadings")]
    CodeCompleteHeadings {
        token: u64,
        #[serde(default)]
        note: Option<String>,
    },
    /// The hover card is over `[[note]]` and wants its opening lines.
    #[serde(rename = "codeHoverNote")]
    CodeHoverNote { token: u64, note: String },
    /// Check the active buffer's links and answer with broken-link markers.
    #[serde(rename = "codeLint")]
    CodeLint { token: u64 },
    /// Toggle a reading-view task checkbox, addressed by its document-order
    /// position among list checkboxes.
    #[serde(rename = "toggleTask")]
    ToggleTask { index: usize },
    /// Splice an inline reading-view edit into the buffer over a source range.
    #[serde(rename = "editBlock")]
    EditBlock {
        start: usize,
        end: usize,
        text: String,
        /// Set by checkbox toggles: splice with no undo step and write to disk
        /// immediately, rather than the normal undoable, dirty-marking edit.
        #[serde(default)]
        autosave: bool,
    },
    /// Drag-reorder one run of sibling blocks in the reading view. `ranges` are
    /// their source ranges in document order; `from` and `to` are slots in that
    /// run. The page sends the whole run because the page is what knows which
    /// blocks are siblings — the buffer only sees text.
    #[serde(rename = "moveBlock")]
    MoveBlock {
        ranges: Vec<(usize, usize)>,
        from: usize,
        to: usize,
    },
    /// Show the image picker for the reading view's insert box. The page keeps
    /// the insertion point against `token` and writes the block itself once the
    /// path comes back — the host only answers "which file".
    #[serde(rename = "pickImage")]
    PickImage { token: u64 },
    /// Revert the most recent reading-view edit in the active document.
    #[serde(rename = "undoEdit")]
    UndoEdit,
    /// Sent after every release check, found or not, to reset the throttle.
    #[serde(rename = "updateChecked")]
    UpdateChecked {
        #[serde(default)]
        version: String,
    },
    /// Fetch `url` and stage it as the installer for `version`, expecting exactly
    /// `size` bytes. Any earlier attempt at the same version is discarded.
    #[serde(rename = "updateDownload")]
    UpdateDownload {
        version: String,
        asset: String,
        size: u64,
        url: String,
    },
    /// Install the staged update and relaunch.
    #[serde(rename = "applyUpdate")]
    ApplyUpdate,
}

pub(crate) fn ipc_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(Request<String>) {
    move |request| {
        if let Ok(command) = serde_json::from_str::<IpcCommand>(request.body()) {
            let _ = proxy.send_event(UserEvent::FromPage(command));
        }
    }
}

/// Run `job` on a worker and post what it returns back to the loop. Everything
/// that reads the disk or the network goes through here — the thread answering
/// the window must wait on neither.
///
/// The answer lands as an ordinary event, so the loop decides whether it still
/// wants it. Each `*Ready` arm carries what it was about (a vault root, a graph
/// source, a path) and drops an answer that outlived its question.
pub(crate) fn off_loop<F>(proxy: &EventLoopProxy<UserEvent>, job: F)
where
    F: FnOnce() -> UserEvent + Send + 'static,
{
    let proxy = proxy.clone();
    thread::spawn(move || {
        let _ = proxy.send_event(job());
    });
}
