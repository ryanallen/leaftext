//! The event vocabulary, and the IPC bridge the page talks over.
//!
//! [`IpcCommand`] is the page's whole vocabulary, and the loop handles it directly: one variant, one handler arm. A second, mirrored enum with a field-by-field copier between the two writes every command out three times and lets the copies drift.

use super::*;

/// What the event loop can be told. The page's commands arrive whole as [`UserEvent::FromPage`]; the rest are the app's own signals — a second launch's forwarded file, the watcher, and answers coming back from worker threads, none of which the page can say over IPC.
#[derive(Debug)]
pub(crate) enum UserEvent {
    /// A command the page sent over IPC, forwarded unopened.
    FromPage(IpcCommand),
    /// One delivery of documents to open, in the order they were handed over: a second launch's forwarded file, one macOS Apple Event's whole list, a drop's whole list, the picker's choice, or the page's `openRecent` re-sent as this. A batch rather than one path because an Apple Event and a drop each carry several, and one event per file draws the page once per file. Every one goes through `LaunchOpenQueue`, which holds it until the front end has said it can receive a document; the release surfaces the window, which a forwarded open should do.
    OpenPaths(Vec<PathBuf>),
    /// The launch window has waited long enough for the page and grows now whether or not it ever speaks. A page that threw while it loaded sends no `startupReady`, and there is nothing in a 256-pixel window for a reader to press.
    StartupGrowDue,
    /// A second launch of the app forwarded a request to this (primary) instance but carried no file — bring the existing window to the front.
    FocusWindow,
    /// Files changed on disk in one debounced watcher batch.
    FileChanged(Vec<PathBuf>),
    /// The git panel's next whole state, already serialized on the worker thread.
    VaultGitReady { json: String },
    /// Just the folder's own git state, for the header's sync button.
    VaultStatusReady {
        id: i64,
        generation: u64,
        json: String,
    },
    /// The clock says it is time to ask the remote vaults what has moved. The loop decides which, if any, are worth asking — it is the only place that knows what is busy and what is resting.
    RemoteRefreshDue,
    /// A refresh pass finished. `ran_under` is the mirror it ran against, so a pass that outlived its vault is thrown away rather than delivered.
    RemoteRefreshDone {
        id: i64,
        ran_under: PathBuf,
        state: Box<VaultRemoteState>,
    },
    /// A folder finished being read off disk. `scope` is the vault root the read was made under, so a listing that lands after a vault switch is dropped.
    FolderLoaded {
        scope: Option<PathBuf>,
        listing: FolderListing,
    },
    /// The sync clients whose folders are on this machine, found on the worker that stat'd them.
    CloudFoldersReady { folders: Vec<CloudFolder> },
    /// A file Copy or Cut finished on the worker that waited on the clipboard helper. Nothing is said when it worked — the paste is its own proof — so only `error` has anywhere to go, and `cut` decides which of the two the sentence names.
    FileClipboardDone { cut: bool, error: Option<String> },
    /// A picture Copy finished on the worker that waited on the same helper. Nothing is said when it worked, for the same reason: the paste is the proof.
    PictureClipboardDone { error: Option<String> },
    /// A clone finished. `folder` is where it landed, so the loop can register it as a vault; `error` is what to say instead when it failed.
    VaultCloneDone {
        folder: PathBuf,
        error: Option<String>,
    },
    /// A slice of the active vault's text, as the read hands it over. Several of these land per read: a query parked on the read is answered by each one, so somebody is reading matches while the rest of the vault is still being opened, and only the last one lets an answer be kept. The first is a preview taken while the folders were still being listed, and the first sorted slice replaces it.
    CorpusLoaded {
        root: PathBuf,
        documents: Box<Vec<CorpusDocument>>,
        /// The read hit a cap, so the vault holds more than this will.
        truncated: bool,
        /// Folders the walk did not go into because they hold generated files. Empty on the preview, which goes out before the walk has finished listing; every sorted slice carries the whole answer.
        skipped: Vec<String>,
        /// What this slice lands on is thrown away rather than grown: the preview, which starts the text, and the first sorted slice, which drops the preview.
        replaces: bool,
        /// The last slice. Until it lands the vault's text is partial.
        last: bool,
        /// Which read sent it, claimed once when that read started. A vault left and come straight back to is the same root again, so the root alone cannot tell an abandoned read's slice from the live one's.
        wanted: u64,
    },
    /// A graph finished building. Both this and the search below are computed on a worker thread: they read documents off the disk, which is far too much to do on the thread that answers the window.
    ///
    /// `source` is what the map is of — a vault, or one document — so a graph that finished after the reader moved somewhere a different source answers for is dropped rather than painted.
    GraphReady {
        source: GraphSource,
        graph: DocumentGraph,
    },
    /// The completion menu's field names, walked over the whole vault on a worker. `corpus` is the version of the vault's text it saw, so a walk overtaken by a later one is dropped rather than drawn over the newer list.
    FilterHintsReady { hints: FilterHints, corpus: u64 },
    SearchReady {
        scope: Option<PathBuf>,
        query: String,
        results: SearchResults,
        /// Which version of the vault's text this was scanned over, so an answer that landed after a file changed under it is not kept as the answer to that query.
        corpus: u64,
        /// The text it scanned was part of a vault still being read. The pane keeps its ring, and nothing keeps the answer.
        partial: bool,
    },
    /// The background pager scan completed for a document path.
    PagerLoaded { path: PathBuf, html: String },
    /// A code-view IntelliSense answer — completions, hover or lint — already serialized as the page script that delivers it, on the worker that computed it. The token inside pairs it with the ask.
    CodeIntelReady { script: String },
    /// How far along the running update download is, 0-100.
    UpdateDownloadProgress { version: String, percent: u8 },
    /// A verified installer is on disk and ready to apply.
    UpdateDownloadStaged { version: String },
    /// The download or its verification failed; nothing is staged.
    UpdateDownloadFailed { version: String, message: String },
    /// Somebody on the ask pipe wants to know what is open. `reply` is how the answer gets back to them — the pipe thread is waiting on it with a timeout, so a loop too busy to fill it costs that asker two seconds and nothing else.
    PipeState { reply: PipeReply },
    /// Somebody on the ask pipe wants a line of JavaScript run in the page. `evaluate_script_with_callback` must be called from this thread and answers later, so the reply channel is filled by the callback rather than by the arm that starts it.
    PipeEval { script: String, reply: PipeReply },
    /// Somebody on the ask pipe wants a document's source. The path is brought to the front first, so the window shows what is being worked on, and the answer comes off the same buffer the reader is typing into.
    PipeDoc { path: PathBuf, reply: PipeReply },
    /// Somebody on the ask pipe wants text spliced into the document at the front. The same buffer, undo stack and re-render an edit typed in the window goes through, which is the whole reason the ask exists.
    PipeEdit {
        path: PathBuf,
        start: usize,
        end: usize,
        text: String,
        expect: String,
        reply: PipeReply,
    },
    /// Somebody on the ask pipe wants one task of the document at the front checked or cleared and the file written at once — the same action the reader's own checkbox is, guarded by a path, a fingerprint and the task list the read answered.
    PipeTask {
        path: PathBuf,
        index: usize,
        expect: String,
        reply: PipeReply,
    },
    /// Somebody on the ask pipe wants the document at the front written to its file, through the same save the page's own Save button runs.
    PipeSave {
        path: PathBuf,
        expect: String,
        reply: PipeReply,
    },
    /// Somebody on the ask pipe wants the page written out as a PDF at a path they name, skipping the save dialog they cannot answer. The same render the Export button runs, so what comes out is the sheet a reader would get.
    PipeExport {
        path: PathBuf,
        width: f64,
        height: f64,
        reply: PipeReply,
    },
    /// Somebody on the ask pipe wants the page written out as a picture at a path they name, skipping the save window they cannot answer. The same call the Export button's picture rows run, so what comes out is the picture a reader would get.
    PipeShot {
        path: PathBuf,
        width: f64,
        height: f64,
        reply: PipeReply,
    },
    /// Somebody on the ask pipe wants a pointer gesture played into the page over the web view's own developer protocol — the route that needs no cursor, no focus and no place on screen, which is what reaches a copy standing off every monitor.
    PipeGesture { gesture: Gesture, reply: PipeReply },
    /// One step of that gesture's walk, posted by its pacing thread: the protocol call must be made from the loop thread, and a paced drag walked there would hold the loop for its whole length. `done` rides the last step — the reply, and the answer it carries once the engine takes the step.
    // Only the Windows route posts one; the arm stays on both so the loop's vocabulary is one list rather than two.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    PipeGestureStep {
        params: String,
        done: Option<(PipeReply, serde_json::Value)>,
    },
    /// Somebody on the ask pipe wants the app closed. This one only answers that the loop heard: closing here would end the process with the reply still in the pipe, where it is thrown away.
    PipeQuit { reply: PipeReply },
    /// Close now — the pipe thread saying the asker has taken its answer. The second half of `PipeQuit`, and the only thing that closes the app on its behalf.
    PipeCloseNow,
}

/// Where an ask-pipe answer goes back to. `Err` is a refusal with a reason, so a window that cannot answer says why instead of running the asker's clock out.
pub(crate) type PipeReply = std::sync::mpsc::SyncSender<Result<serde_json::Value, String>>;

/// What the ask pipe's `state` answers with: enough to know what the app is looking at without asking for anything the loop would have to go to disk for.
///
/// The workspace rather than the whole [`Reader`], because that carries a window and this half of the answer does not need one — which is what lets a test build it.
pub(crate) fn pipe_state(workspace: &Workspace, vaults: &VaultState) -> serde_json::Value {
    let tabs: Vec<serde_json::Value> = workspace
        .tabs
        .iter()
        .map(|tab| {
            serde_json::json!({
                "title": tab.title,
                "path": tab.history.current().map(|path| path.display().to_string()),
                "codeView": tab.code_view,
                "unsaved": tab.edit.as_ref().is_some_and(|edit| edit.is_dirty()),
            })
        })
        .collect();

    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "activeTab": workspace.active,
        "activePath": workspace.active_path().map(|path| path.display().to_string()),
        "tabs": tabs,
        "vault": {
            "id": vaults.active,
            "root": vaults.root.as_ref().map(|root| root.display().to_string()),
            "folder": vaults.folder,
        },
    })
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command")]
pub(crate) enum IpcCommand {
    /// Show the OS file picker.
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "openRecent")]
    OpenRecent { path: PathBuf },
    /// Start an empty document in a new tab, unlocked for typing. It has no file until the first save, which asks where it goes.
    #[serde(rename = "newDocument")]
    NewDocument,
    /// Paste what the library pane last cut or copied into a folder. `cut` decides move or copy; the page carries both because the page is what remembered them.
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
    /// Mark or unmark a path — the heart on a tab, and the right-click item for everything not open. Which vault it belongs to is worked out here rather than sent, since the page never knows it.
    #[serde(rename = "toggleFavorite")]
    ToggleFavorite { path: PathBuf, kind: FavoriteKind },
    /// Which favorites are no longer on the disk. Asked as the start screen draws its favorites column; the answer marks the rows already on screen rather than redrawing the list.
    #[serde(rename = "checkFavorites")]
    CheckFavorites,
    /// Point a favorite row at the file it has become: opens the picker Open opens, and repoints that entry in place. Never automatic, at any name — silent and wrong is worse than visible and broken.
    #[serde(rename = "repointFavorite")]
    RepointFavorite { path: PathBuf },
    /// Move a favorite row so it sits before `before`, or last when that is `None`. Paths, not indices: the page's list is grouped by vault and can still be drawing a row that has left the store.
    #[serde(rename = "moveFavorite")]
    MoveFavorite {
        path: PathBuf,
        #[serde(default)]
        before: Option<PathBuf>,
    },
    #[serde(rename = "renameFile")]
    RenameFile {
        path: PathBuf,
        #[serde(rename = "newName")]
        new_name: String,
    },
    #[serde(rename = "deleteFile")]
    DeleteFile { path: PathBuf },
    /// Put back the file the last delete took. The path comes with it so a stale offer cannot restore something else.
    #[serde(rename = "undoDelete")]
    UndoDelete { path: PathBuf },
    #[serde(rename = "showProperties")]
    ShowProperties { path: PathBuf },
    /// The three file rows of a picture's own right-click menu. `src` is the address the picture is drawn from, which the host resolves back to a file against the document in front — the page holds no path for a picture and could not send one. A picture served from anywhere but this disk resolves to nothing, which is why the page draws none of these rows over one.
    #[serde(rename = "revealImage")]
    RevealImage { src: String },
    #[serde(rename = "copyImagePath")]
    CopyImagePath { src: String },
    #[serde(rename = "showImageProperties")]
    ShowImageProperties { src: String },
    /// The picture itself on the clipboard, as pixels rather than as a file to paste somewhere. `data` is a finished PNG the page's own canvas wrote, base64'd because IPC carries a string — the same encoder the picture export uses, so every kind of picture the reading view can draw copies rather than only the ones a decoder here would have known.
    ///
    /// The page cannot finish this itself: the desktop page is not a secure context, so it has neither `navigator.clipboard` nor `ClipboardItem`.
    #[serde(rename = "copyImage")]
    CopyImage { data: String },
    #[serde(rename = "closeTab")]
    CloseTab { index: usize },
    #[serde(rename = "switchTab")]
    SwitchTab {
        index: usize,
        scroll_anchor: ScrollAnchor,
        /// Code-view scroll fraction when the outgoing tab is showing source; `None` for a reading-view tab.
        #[serde(default)]
        code_scroll: Option<f64>,
        #[serde(rename = "renderKey", default)]
        render_key: Option<String>,
        #[serde(rename = "forceFull", default)]
        force_full: bool,
    },
    #[serde(rename = "moveTab")]
    MoveTab { from: usize, to: usize },
    #[serde(rename = "goHome")]
    GoHome,
    #[serde(rename = "openLink")]
    OpenLink {
        href: String,
        scroll_anchor: ScrollAnchor,
        /// Ctrl-held (Cmd on a Mac) or middle click: the document opens as a page behind this one. The name is spelled out rather than left to match — nothing here rejects an unknown field, so a name that disagreed would default to false and the gesture would do nothing, silently.
        #[serde(rename = "newPage", default)]
        new_page: bool,
    },
    /// Open a URL in the system browser, unattached to any document (the update button). Unlike `OpenLink`, it doesn't require an active tab.
    #[serde(rename = "openExternal")]
    OpenExternal { url: String },
    /// A glossary link was clicked: show the term in a bottom sheet, not a new tab. `href` is the glossary file plus `#anchor`, relative to the doc.
    #[serde(rename = "openGlossary")]
    OpenGlossary { href: String },
    /// The right-click menu on a document link. An href only means something against the document it sits in, and the page never learns where that is — so both of these resolve here and then do what the library pane's own items do. Neither answers for a link with no file behind it.
    #[serde(rename = "revealLink")]
    RevealLink { href: String },
    #[serde(rename = "copyLinkPath")]
    CopyLinkPath { href: String },
    /// A hover tooltip wants a linked document's line count. `href` resolves against the active doc; `token` correlates the answer with the hover.
    #[serde(rename = "countLines")]
    CountLines { href: String, token: u64 },
    /// A hovered local link wants its rendered opening. `token` keeps an old hover answer from changing the current tooltip.
    #[serde(rename = "previewLink")]
    PreviewLink { href: String, token: u64 },
    #[serde(rename = "goBack")]
    GoBack { scroll_anchor: ScrollAnchor },
    #[serde(rename = "goForward")]
    GoForward { scroll_anchor: ScrollAnchor },
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
    /// The first-run bubbles' whole one-shot state, sent together: nothing here is meaningful without the other two.
    #[serde(rename = "setHintState")]
    SetHintState {
        launches: u32,
        seen: Vec<String>,
        #[serde(rename = "lastLaunch")]
        last_launch: u32,
    },
    /// Every front-end fragment has run, so the page can now receive a document from the host. Said once, immediately after the last fragment sets `window.__leafBooted`, and before the initial state is drawn.
    ///
    /// This is the only true answer to "can the page be sent a render". The web view's own page-load-finished callback is not: the desktop appends the joined script two painted frames after the document is parsed, so that callback fires while the page still has no hooks — a render sent then changes the tabs and lands nowhere, which is the file that opens as the home screen under its own name.
    ///
    /// It is also not `StartupReady`, which is a later and different promise: that one says a screen a reader could use has been *drawn*, and a launch opening a file withholds it until the document arrives. Waiting for it to release that document would wait for itself.
    #[serde(rename = "frontEndReady")]
    FrontEndReady,
    /// The page has drawn the first document, or the home screen where the launch opens none. The window is put up small and holding the startup card, and this is what grows it into the one the reader left.
    ///
    /// `FrontEndReady` cannot do it: that is said before the initial state is drawn, and the loop releases the launch's documents inside that very arm — so a window grown there is a full-size window with an empty reader in it, which is the half of the complaint about stuff still loading.
    #[serde(rename = "startupReady")]
    StartupReady,
    /// Custom title-bar controls (the app bar is the title bar on frameless Windows).
    #[serde(rename = "windowDrag")]
    WindowDrag,
    #[serde(rename = "windowMinimize")]
    WindowMinimize,
    #[serde(rename = "windowToggleMaximize")]
    WindowToggleMaximize,
    /// Native full screen, which is a different thing from zoom: a Mac gives it a space of its own, and zoom only fills the room the menu bar and the Dock leave over.
    #[serde(rename = "windowToggleFullscreen")]
    WindowToggleFullscreen,
    #[serde(rename = "windowClose")]
    WindowClose,
    /// The active view stopped moving, so its position can survive a native close.
    #[serde(rename = "saveSessionPlace")]
    SaveSessionPlace {
        #[serde(default)]
        scroll_anchor: Option<ScrollAnchor>,
        #[serde(default)]
        code_scroll: Option<f64>,
    },
    /// A drag in the shadow band, which is the only edge the window has left: the web view covers every pixel of it, so the page is the only thing that sees the press. `direction` is the compass point grabbed (`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`); `phase` is `start`, `move` or `end`; `x` and `y` are the pointer on the screen. Windows acts on the press alone and hands the window to the platform's own resize loop; macOS is refused that call, so the host holds the window's rectangle from the press and sets it on every move.
    #[serde(rename = "windowResizeDrag")]
    WindowResizeDrag {
        direction: String,
        phase: String,
        x: f64,
        y: f64,
    },
    /// Paint the native frame to the page color, reported by the webview on theme change. No divider color rides along: the app draws its own edge, and the frame is told to draw none.
    #[serde(rename = "setWindowChrome")]
    SetWindowChrome { r: u8, g: u8, b: u8, dark: bool },
    /// Persist the folder the library pane is inside.
    #[serde(rename = "setLibraryState")]
    SetLibraryState {
        #[serde(rename = "projectPath")]
        project_path: String,
    },
    /// Whether the page is showing the graph. Not persisted — it says only whether a change on disk has a map on screen to redraw.
    #[serde(rename = "setGraphView")]
    SetGraphView { open: bool },
    /// A vault's git panel: read it, make it a repository, point it at one, or push it. Each runs off the loop and comes back as `VaultGitReady`.
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
    /// Save whether this vault starts GitHub sync when local work appears.
    #[serde(rename = "setVaultGitAutoSync")]
    SetVaultGitAutoSync { id: i64, enabled: bool },
    /// Put the repositories inside this vault that nothing is holding back into its own `.gitignore`, with the reason beside them. Which ones came from the panel's own read, so nothing here is decided by the page.
    #[serde(rename = "ignoreVaultRepos")]
    IgnoreVaultRepos { id: i64, paths: Vec<String> },
    /// Set `user.name` and `user.email` for this machine, from the panel that said git does not know who you are. The id names the panel to redraw, not whose settings are written — the note is read machine-wide, so the write has to be.
    #[serde(rename = "setGitIdentity")]
    SetGitIdentity {
        id: i64,
        name: String,
        email: String,
    },
    /// Ask a remote vault's source what has moved, now, rather than waiting for the clock. Also wakes a vault the timer had stopped asking: the person pressing it knows something the app does not.
    #[serde(rename = "refreshVault")]
    RefreshVault { id: i64 },
    /// Sign a remote vault in. The consent page opens in the person's normal browser and the answer comes back to a listener on the loopback address; nothing is ever typed into Leaftext.
    #[serde(rename = "signInVault")]
    SignInVault { id: i64 },
    /// Forget a remote vault's token. The copied files stay and go on reading offline.
    #[serde(rename = "signOutVault")]
    SignOutVault { id: i64 },
    /// Persist the library pane's open/closed state and last open width.
    #[serde(rename = "setLibraryLayout")]
    SetLibraryLayout { closed: bool, width: u32 },
    /// Pick a folder and register it as a vault, then switch the library to it.
    #[serde(rename = "createVault")]
    CreateVault,
    /// Which sync clients have a folder on this machine. Each becomes a vault if it is not one already, and the answer is what makes a vault in one wear a cloud.
    #[serde(rename = "getCloudFolders")]
    GetCloudFolders,
    /// Clone a repository into a folder the user picks, and register the clone as a vault.
    #[serde(rename = "cloneVault")]
    CloneVault { url: String },
    /// Scope the library to a vault by id; `0` is the whole library.
    #[serde(rename = "setActiveVault")]
    SetActiveVault {
        #[serde(default)]
        id: i64,
    },
    /// Relabel a vault. The folder is untouched.
    #[serde(rename = "renameVault")]
    RenameVault { id: i64, name: String },
    /// Reopen the folder picker and point an existing vault somewhere else — the fix for having picked the wrong folder.
    #[serde(rename = "changeVaultFolder")]
    ChangeVaultFolder { id: i64 },
    /// Forget a vault. The row goes; the folder stays.
    #[serde(rename = "removeVault")]
    RemoveVault { id: i64 },
    /// Show one folder in the library pane. Empty is the top level: the active vault's folder, or the drive roots.
    #[serde(rename = "getFolder")]
    GetFolder {
        #[serde(default)]
        path: String,
    },
    /// Point the pane at a document: the vault that owns it, and its folder.
    #[serde(rename = "revealInLibrary")]
    RevealInLibrary { path: PathBuf },
    /// Request the library link graph. `scope` is the persisted graph size; `seeds` are the focus documents, used only by the Focus scope.
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
    /// Filter the active vault's text. `today` is the reader's own date, from the page, so `due:<friday` means their Friday; a missing or unreadable one falls back to UTC.
    #[serde(rename = "search")]
    Search {
        query: String,
        #[serde(default)]
        today: Option<String>,
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
    /// Write the active document's buffer to disk. `format` is the one the reader picked before the window opened, and only a note that has never had a file ever opens one — a Mac panel shows no format at all, so the page asks there first and the window is left that one ending with a name already wearing it. Without it the window carries every readable format and Windows draws them as its own dropdown.
    #[serde(rename = "saveDocument")]
    SaveDocument {
        #[serde(default)]
        format: Option<String>,
    },
    /// The code view's popup wants the notes `[[` can complete to.
    #[serde(rename = "codeCompleteNotes")]
    CodeCompleteNotes { token: u64 },
    /// The headings of a named note (`[[note#`), or of the active buffer (`](#`) when `note` is absent.
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
    /// Toggle a reading-view task checkbox, addressed by its document-order position among list checkboxes.
    #[serde(rename = "toggleTask")]
    ToggleTask {
        index: usize,
        /// Set by the box that sent it, which drew itself ticked before this left. The host answers this number with whether the buffer holds the tick, and a box told nothing is holding it takes its own tick back off — see [`IpcCommand::EditBlock`]'s `token`, which a box inside a table travels under instead.
        #[serde(default)]
        token: Option<u64>,
    },
    /// Splice an inline reading-view edit into the buffer over a source range.
    #[serde(rename = "editBlock")]
    EditBlock {
        start: usize,
        end: usize,
        text: String,
        /// Set by checkbox toggles: splice with no undo step and write to disk immediately, rather than the normal undoable, dirty-marking edit.
        #[serde(default)]
        autosave: bool,
        /// Set while the reader is still typing in the block: splice the buffer and leave the page alone. The box being typed in is already the picture, and rebuilding the document would throw the editing session away under the caret — so the commit that ends the run is the one that renders.
        #[serde(default)]
        live: bool,
        /// Set on every splice of a typing run after its first — the pauses in the middle, and the commit that ends it. The first splice of a run records the snapshot, so however many times the typing paused, one press of undo takes the whole run back.
        #[serde(default)]
        continuing: bool,
        /// Set when one cell of a table was what changed. The cell is written on its own so the rest of the table keeps the spacing somebody gave it; `text` and the range stay the whole-table rewrite, which is what a cell the source map cannot prove falls back to.
        #[serde(default)]
        cell: Option<TableCellEdit>,
        /// Set by a sender that keeps something open until it knows: the flowchart sheet holds the drawing until the host says the splice landed, rather than closing on the dispatch. The host answers this number either way, the way the image picker's `token` is answered.
        #[serde(default)]
        token: Option<u64>,
    },
    /// Rewrite several reading-view blocks as one undoable edit.
    #[serde(rename = "editBlocks")]
    EditBlocks { blocks: Vec<BlockReplacement> },
    /// Write one frontmatter field on the active buffer, or remove it when `value` is absent. The host works out the splice: where the field's bytes are, and whether a quote goes back on, is the parser's to know, and a second reader of the block in the page would be a second answer.
    #[serde(rename = "setField")]
    SetField {
        key: String,
        #[serde(default)]
        value: Option<String>,
    },
    /// Set every item of a list field at once. Its own command rather than one value with commas in it: how a list is written — inline or a line each, at the file's own indent — is the parser's to keep, and joining the items in the page would settle it there instead.
    #[serde(rename = "setListField")]
    SetListField { key: String, items: Vec<String> },
    /// Rename one frontmatter field's key on the active buffer, keeping its value and its place in the block. Refused when the block already holds that name, since the parser would then read the second as a duplicate and drop it.
    #[serde(rename = "renameField")]
    RenameField { key: String, to: String },
    /// Drag-reorder one run of sibling blocks in the reading view. `ranges` are their source ranges in document order; `from` and `to` are slots in that run. The page sends the whole run because the page is what knows which blocks are siblings — the buffer only sees text.
    #[serde(rename = "moveBlock")]
    MoveBlock {
        ranges: Vec<(usize, usize)>,
        from: usize,
        to: usize,
    },
    /// Show the image picker for the reading view's insert box. The page keeps the insertion point against `token` and writes the block itself once the path comes back — the host only answers "which file".
    #[serde(rename = "pickImage")]
    PickImage { token: u64 },
    /// Ask where a diagram goes, before anything is drawn. `format` is the one the reader has already picked: a Mac panel shows no format at all, so the page asks there first and the window is left that one ending with a name already wearing it. Without it the window carries every format and the ending on the name the reader chooses is what the page then encodes. Either way exactly one picture is ever made — the page keeps the diagram against `token` and does the rest once the path comes back.
    #[serde(rename = "pickDiagramPath")]
    PickDiagramPath {
        token: u64,
        #[serde(default)]
        format: Option<String>,
    },
    /// Write the flowchart sheet's diagram out as a file of its own. `format` is `md`, `png`, `webp` or `jpg`; `data` is the text for the first and base64 for the three pictures, since IPC carries a string and a picture is bytes. The `pdf` row never arrives here — it is printed by `printDiagramPdf` instead. `path` is where it goes, answered by `pickDiagramPath` a moment earlier — the host opens no window of its own here.
    #[serde(rename = "exportDiagram")]
    /// `data` is Markdown for a `md` export, base64 RGBA pixels for a `png` one — the page sends pixels so the host's encoder does the writing — and a finished file for `webp` and `jpg`, both of which the canvas writes itself.
    ExportDiagram {
        format: String,
        data: String,
        path: String,
        #[serde(default)]
        width: u32,
        #[serde(default)]
        height: u32,
    },
    /// Print one diagram onto a sheet of its own. `path` is where it goes, answered by `pickDiagramPath` a moment earlier; `width` and `height` are the sheet's own CSS pixels, read off the drawing the page put in its print container — never off the box around it, which under the paper rules is as wide as the whole surface.
    ///
    /// Its own command rather than a fourth `exportDiagram` format: that one carries finished bytes the page made, and a print carries none, while its size is a bitmap's whole pixels where a sheet is measured in fractions of one.
    #[serde(rename = "printDiagramPdf")]
    PrintDiagramPdf {
        path: String,
        #[serde(default)]
        width: f64,
        #[serde(default)]
        height: f64,
    },
    /// Ask where a picture in the document goes, before anything is drawn or copied. `source` is the address the picture is drawn from, which the host resolves back to a file so the window can suggest that picture's own name. `format` is the one the reader has already picked, for the same reason `pickDiagramPath` carries one: a Mac panel shows no format at all, so the page asks there first and the window is left that one ending. The page keeps the picture against `token` and does the rest once the path comes back.
    #[serde(rename = "pickPicturePath")]
    PickPicturePath {
        token: u64,
        source: String,
        #[serde(default)]
        format: Option<String>,
    },
    /// Write a picture in the document out as a file of its own. `format` is `md`, `png`, `webp` or `jpg`; the `pdf` row never arrives here — it is printed by `printPicturePdf` instead. `source` is the address the picture is drawn from, which the host resolves back to the file on disk; `alt` is the words the note gave it, which only the `md` row writes down. `path` is where it goes, answered by `pickPicturePath` a moment earlier — the host opens no window of its own here.
    ///
    /// `data` is empty for `md`, which copies the file rather than encoding anything, and for a picture already in the format asked for, which the host copies byte for byte because that file is smaller, lossless and exact. Otherwise it is a finished file the page's own canvas wrote — for the PNG row as well as the WebP and JPEG ones, because the host's encoder leaves every row unfiltered for flat fill and a photograph is not flat, and because the pixels would cross as about twenty times the bytes of the file they come to.
    ///
    /// The `jpg` row is the one whose file is written over a painted canvas: JPEG carries no transparency and an unpainted one encodes as solid black, so what arrives is the picture on the page's own surface color.
    #[serde(rename = "exportPicture")]
    ExportPicture {
        format: String,
        source: String,
        path: String,
        #[serde(default)]
        alt: String,
        #[serde(default)]
        data: String,
    },
    /// Print one picture onto a sheet of its own. `path` is where it goes, answered by `pickPicturePath` a moment earlier; `width` and `height` are the sheet's own CSS pixels, which is the picture's own size rather than the room the reader's lane had squeezed it into.
    ///
    /// Its own command rather than a fourth `exportPicture` format, for the reason `printDiagramPdf` is its own: that one carries finished bytes the page made, and a print carries none.
    #[serde(rename = "printPicturePdf")]
    PrintPicturePdf {
        path: String,
        #[serde(default)]
        width: f64,
        #[serde(default)]
        height: f64,
    },
    /// Write the page as it stands out as a file of its own. `format` is `pdf` or `png`; `width` and `height` are the page's own CSS pixels, which is how the host sizes one continuous page instead of chopping the document across sheets — only the page knows how tall it is. The stylesheet's `leaf-paper` class is what makes that page the whole document in its theme rather than one screen of app frame, and it is on a class rather than in a print block so the page can measure the sheet it is about to ask for. Nothing about the open document is read or written.
    #[serde(rename = "exportPdf")]
    ExportPdf {
        format: String,
        #[serde(default)]
        width: f64,
        #[serde(default)]
        height: f64,
    },
    /// Write the page as it stands out as a web page at `path`, answered by the save window `exportPdf` opened a moment earlier.
    ///
    /// `markup` is the document as the page has already drawn it, its own controls taken out and wrapped in the ancestors every rule in the stylesheet is keyed on — the page builds that chain, because the page is what knows which of its own elements are controls. `sheet` is the drawings' own stylesheet, which mermaid writes per drawing and the page hoists into one element in its head: it is neither in the stylesheet nor inside the SVG, so a copy of the document alone comes out a page of black boxes. `theme` and `appearance` are the two attributes every theme's colors are keyed on, and `title` names the page in a browser tab.
    ///
    /// Its own command rather than a second format on `exportPdf`: that one ends in the web view's own print, and nothing on that path can write markup.
    #[serde(rename = "exportPageHtml")]
    ExportPageHtml {
        path: String,
        markup: String,
        #[serde(default)]
        sheet: String,
        #[serde(default)]
        theme: String,
        #[serde(default)]
        appearance: String,
        #[serde(default)]
        title: String,
    },
    /// Revert the most recent reading-view edit in the active document.
    #[serde(rename = "undoEdit")]
    UndoEdit,
    /// Bring back the reading-view edit the last undo displaced.
    #[serde(rename = "redoEdit")]
    RedoEdit,
    /// Sent after every release check, found or not, to reset the throttle.
    #[serde(rename = "updateChecked")]
    UpdateChecked {
        #[serde(default)]
        version: String,
    },
    /// Fetch `url` and stage it as the installer for `version`, expecting exactly `size` bytes. Any earlier attempt at the same version is discarded.
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
    /// Something threw in the page. `count` is how many times that same text has been seen, because `journal.js` collapses repeats rather than sending every one — see the fragment for why.
    #[serde(rename = "logError")]
    LogError { message: String, count: u32 },
}

/// Which cell of a table an [`IpcCommand::EditBlock`] was really about, as the page draws it: the head row is row 0. `columns` is the width the page drew that row at, so a row the source map reads at another width is a row this edit is not describing and the whole-table rewrite takes over.
#[derive(Debug, Deserialize)]
pub(crate) struct TableCellEdit {
    pub row: usize,
    pub column: usize,
    pub columns: usize,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BlockReplacement {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

pub(crate) fn ipc_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(Request<String>) {
    move |request| {
        if let Ok(command) = serde_json::from_str::<IpcCommand>(request.body()) {
            let _ = proxy.send_event(UserEvent::FromPage(command));
        }
    }
}

/// Run `job` on a worker and post what it returns back to the loop. Everything that reads the disk or the network goes through here — the thread answering the window must wait on neither.
///
/// The answer lands as an ordinary event, so the loop decides whether it still wants it. Each `*Ready` arm carries what it was about (a vault root, a graph source, a path) and drops an answer that outlived its question.
pub(crate) fn off_loop<F>(proxy: &EventLoopProxy<UserEvent>, job: F)
where
    F: FnOnce() -> UserEvent + Send + 'static,
{
    let proxy = proxy.clone();
    thread::spawn(move || {
        let _ = proxy.send_event(job());
    });
}
