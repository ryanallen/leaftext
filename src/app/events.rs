//! The event vocabulary, and the IPC bridge the page talks over.

use super::*;

#[derive(Debug)]
pub(crate) enum UserEvent {
    OpenPicker,
    OpenPath(PathBuf),
    /// Move or copy something into a folder — the library pane's paste.
    TransferPath {
        path: PathBuf,
        into_folder: PathBuf,
        move_it: bool,
    },
    /// The webview finished its first page load, so its render hooks now exist.
    /// Sent once on boot to flush a file passed on the command line, whose render
    /// would otherwise race the load.
    WebviewReady,
    /// A second launch of the app forwarded a request to this (primary) instance
    /// but carried no file — bring the existing window to the front.
    FocusWindow,
    RevealPath(PathBuf),
    CopyFileToClipboard {
        path: PathBuf,
        cut: bool,
    },
    CopyPathToClipboard(PathBuf),
    RenamePath {
        path: PathBuf,
        new_name: String,
    },
    DeletePath(PathBuf),
    ShowProperties(PathBuf),
    CloseTab {
        index: usize,
    },
    SwitchTab {
        index: usize,
        scroll_anchor: ScrollAnchor,
        code_scroll: Option<f64>,
    },
    MoveTab {
        from: usize,
        to: usize,
    },
    GoHome,
    OpenLink {
        href: String,
        scroll_anchor: ScrollAnchor,
    },
    /// Open a URL in the system browser, unattached to any document (the update
    /// button). Unlike `OpenLink`, it doesn't require an active tab.
    OpenExternal {
        url: String,
    },
    /// A glossary link was clicked: show the term in a bottom sheet, not a new
    /// tab. `href` is the glossary file plus `#anchor`, relative to the doc.
    OpenGlossary {
        href: String,
    },
    /// A hover tooltip wants a linked document's line count. `href` resolves
    /// against the active doc; `token` correlates the answer with the hover.
    CountLines {
        href: String,
        token: u64,
    },
    GoBack {
        scroll_anchor: ScrollAnchor,
    },
    GoForward {
        scroll_anchor: ScrollAnchor,
    },
    /// The file backing some tab changed on disk; the live-reload watcher sends
    /// this with the changed path. Only acted on when it is the active document.
    FileChanged(PathBuf),
    /// Persist the minimap-visibility toggle.
    SetMinimapEnabled {
        enabled: bool,
    },
    /// Persist the Previous/Next pager toggle.
    SetPagerEnabled {
        enabled: bool,
    },
    /// A code-view edit, as the range it replaced rather than the whole buffer.
    SpliceSource {
        start: usize,
        removed: usize,
        inserted: String,
        length: usize,
    },
    /// Persist the Speed Reader toggle.
    SetSpeedReaderEnabled {
        enabled: bool,
    },
    /// Persist the reading-view editing toggle.
    /// Persist the selected theme family (`github`/`nightshade`/`amaranth`/…).
    SetThemeFamily {
        family: String,
    },
    /// Persist the selected appearance mode (`system`/`light`/`dark`/`daylight`).
    SetThemeMode {
        mode: String,
    },
    /// Persist the families already shown in the current random-theme cycle.
    SetThemeRandomBag {
        used: Vec<String>,
    },
    /// Custom title-bar controls (the app bar is the title bar on frameless Windows).
    WindowDrag,
    WindowMinimize,
    WindowToggleMaximize,
    WindowClose,
    /// Paint the native title bar to the page color and the window border to the
    /// theme's divider color, both reported by the webview on theme change.
    SetWindowChrome {
        r: u8,
        g: u8,
        b: u8,
        border_r: u8,
        border_g: u8,
        border_b: u8,
        dark: bool,
    },
    /// Persist the folder the library pane is inside.
    SetLibraryState {
        project_path: String,
    },
    /// Whether the page is showing the graph. Not persisted — it says only
    /// whether a change on disk has a map on screen to redraw.
    SetGraphView {
        open: bool,
    },
    /// A vault's git panel: read it, make it a repository, point it at one, or
    /// push it. Each runs off the loop and comes back as `VaultGitReady`.
    GetVaultGit {
        id: i64,
    },
    GetVaultStatus {
        id: i64,
    },
    CreateVaultRepo {
        id: i64,
    },
    LinkVaultRemote {
        id: i64,
        url: String,
    },
    SyncVault {
        id: i64,
    },
    /// The panel's next whole state, already serialized on the worker thread.
    VaultGitReady {
        json: String,
    },
    /// Just the folder's own git state, for the header's sync button.
    VaultStatusReady {
        id: i64,
        json: String,
    },
    /// Persist the library pane's open/closed state and last open width.
    SetLibraryLayout {
        closed: bool,
        width: u32,
    },
    /// Pick a folder and register it as a vault, then switch the library to it.
    CreateVault,
    /// Scope the library to a vault by id; `0` is the whole library.
    SetActiveVault {
        id: i64,
    },
    /// Relabel a vault. The folder is untouched.
    RenameVault {
        id: i64,
        name: String,
    },
    /// Reopen the folder picker and point an existing vault somewhere else —
    /// the fix for having picked the wrong folder.
    ChangeVaultFolder {
        id: i64,
    },
    /// Forget a vault. The row goes; the folder stays.
    RemoveVault {
        id: i64,
    },
    /// Show one folder in the library pane. Empty is the top level: the active
    /// vault's folder, or the drive roots.
    LoadFolder {
        path: String,
    },
    /// Point the pane at a document: the vault that owns it, and its folder.
    RevealInLibrary {
        path: PathBuf,
    },
    /// A folder finished being read off disk. `scope` is the vault root the read
    /// was made under, so a listing that lands after a vault switch is dropped.
    FolderLoaded {
        scope: Option<PathBuf>,
        listing: FolderListing,
    },
    /// The active vault's text finished being read. Whatever was waiting on it —
    /// a graph, a search — runs when it lands.
    CorpusLoaded {
        corpus: Box<VaultCorpus>,
    },
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
    /// Request the library link graph. `scope` is the persisted graph size;
    /// `seeds` are the focus documents, used only by the Focus scope.
    GetGraph {
        scope: String,
        seeds: Vec<String>,
    },
    /// Persist the graph size the frontend just selected.
    SetGraphScope {
        scope: String,
    },
    /// Run a full-text search. `scope`, when present, restricts results to those
    /// document paths (the Focus search scope).
    Search {
        query: String,
        scope: Option<Vec<String>>,
    },
    /// Compute Previous/Next pager links without blocking the initial render.
    LoadPager {
        path: PathBuf,
    },
    /// The background pager scan completed for a document path.
    PagerLoaded {
        path: PathBuf,
        html: String,
    },
    /// Show the active document as raw editable source (the code view).
    EnterCodeView,
    /// Return the active document to the rendered reading view.
    ExitCodeView,
    /// The code-view textarea changed; the full buffer text (debounced).
    UpdateSource {
        text: String,
    },
    /// Write the active document's edit buffer to disk.
    SaveDocument,
    /// Toggle the `index`-th task-list checkbox (reading view) in the buffer.
    ToggleTask {
        index: usize,
    },
    /// Splice an inline reading-view edit over `[start, end)` (source byte
    /// offsets), replacing that span with `text`.
    EditBlock {
        start: usize,
        end: usize,
        text: String,
        /// Set by checkbox toggles: no undo step, written to disk immediately.
        autosave: bool,
    },
    /// Revert the most recent reading-view edit in the active document.
    UndoEdit,
    /// The page checked GitHub; record when, so the next launches don't.
    UpdateChecked {
        /// Version found, empty when already current. Only used for logging.
        version: String,
    },
    /// Fetch `url` and stage it as the installer for `version`, expecting exactly
    /// `size` bytes. Any earlier attempt at the same version is discarded.
    UpdateDownload {
        version: String,
        asset: String,
        size: u64,
        url: String,
    },
    /// How far along the running download is, 0-100.
    UpdateDownloadProgress {
        version: String,
        percent: u8,
    },
    /// A verified installer is on disk and ready to apply.
    UpdateDownloadStaged {
        version: String,
    },
    /// The download or its verification failed; nothing is staged.
    UpdateDownloadFailed {
        version: String,
        message: String,
    },
    /// Install the staged update and relaunch.
    ApplyUpdate,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command")]
pub(crate) enum IpcCommand {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "openRecent")]
    OpenRecent { path: PathBuf },
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
    #[serde(rename = "openExternal")]
    OpenExternal { url: String },
    #[serde(rename = "openGlossary")]
    OpenGlossary { href: String },
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
    #[serde(rename = "setThemeFamily")]
    SetThemeFamily { family: String },
    #[serde(rename = "setThemeMode")]
    SetThemeMode { mode: String },
    #[serde(rename = "setThemeRandomBag")]
    SetThemeRandomBag { used: Vec<String> },
    #[serde(rename = "windowDrag")]
    WindowDrag,
    #[serde(rename = "windowMinimize")]
    WindowMinimize,
    #[serde(rename = "windowToggleMaximize")]
    WindowToggleMaximize,
    #[serde(rename = "windowClose")]
    WindowClose,
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
    #[serde(rename = "setLibraryState")]
    SetLibraryState {
        #[serde(rename = "projectPath")]
        project_path: String,
    },
    #[serde(rename = "setGraphView")]
    SetGraphView { open: bool },
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
    #[serde(rename = "setLibraryLayout")]
    SetLibraryLayout { closed: bool, width: u32 },
    #[serde(rename = "createVault")]
    CreateVault,
    #[serde(rename = "setActiveVault")]
    SetActiveVault {
        #[serde(default)]
        id: i64,
    },
    #[serde(rename = "renameVault")]
    RenameVault { id: i64, name: String },
    #[serde(rename = "changeVaultFolder")]
    ChangeVaultFolder { id: i64 },
    #[serde(rename = "removeVault")]
    RemoveVault { id: i64 },
    #[serde(rename = "getFolder")]
    GetFolder {
        #[serde(default)]
        path: String,
    },
    #[serde(rename = "revealInLibrary")]
    RevealInLibrary { path: PathBuf },
    #[serde(rename = "getGraph")]
    GetGraph {
        #[serde(default)]
        scope: String,
        #[serde(default)]
        seeds: Vec<String>,
    },
    #[serde(rename = "setGraphScope")]
    SetGraphScope { scope: String },
    #[serde(rename = "search")]
    Search {
        query: String,
        #[serde(default)]
        scope: Option<Vec<String>>,
    },
    #[serde(rename = "loadPager")]
    LoadPager { path: PathBuf },
    /// Swap the active document to the raw-source code view.
    #[serde(rename = "enterCodeView")]
    EnterCodeView,
    /// Swap the active document back to the rendered reading view.
    #[serde(rename = "exitCodeView")]
    ExitCodeView,
    /// The code-view textarea changed; carries the full buffer text (debounced).
    #[serde(rename = "spliceSource")]
    SpliceSource {
        start: usize,
        removed: usize,
        inserted: String,
        length: usize,
    },
    #[serde(rename = "updateSource")]
    UpdateSource { text: String },
    /// Write the active document's buffer to disk.
    #[serde(rename = "saveDocument")]
    SaveDocument,
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
    /// Revert the most recent reading-view edit in the active document.
    #[serde(rename = "undoEdit")]
    UndoEdit,
    /// Sent after every release check, found or not, to reset the throttle.
    #[serde(rename = "updateChecked")]
    UpdateChecked {
        #[serde(default)]
        version: String,
    },
    #[serde(rename = "updateDownload")]
    UpdateDownload {
        version: String,
        asset: String,
        size: u64,
        url: String,
    },
    #[serde(rename = "applyUpdate")]
    ApplyUpdate,
}

pub(crate) fn ipc_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(Request<String>) {
    move |request| {
        let Ok(command) = serde_json::from_str::<IpcCommand>(request.body()) else {
            return;
        };

        match command {
            IpcCommand::Open => {
                let _ = proxy.send_event(UserEvent::OpenPicker);
            }
            IpcCommand::OpenRecent { path } => {
                let _ = proxy.send_event(UserEvent::OpenPath(path));
            }
            IpcCommand::PasteFile {
                path,
                into_folder,
                cut,
            } => {
                let _ = proxy.send_event(UserEvent::TransferPath {
                    path,
                    into_folder,
                    move_it: cut,
                });
            }
            IpcCommand::RevealFile { path } => {
                let _ = proxy.send_event(UserEvent::RevealPath(path));
            }
            IpcCommand::CopyFile { path, cut } => {
                let _ = proxy.send_event(UserEvent::CopyFileToClipboard { path, cut });
            }
            IpcCommand::CopyPath { path } => {
                let _ = proxy.send_event(UserEvent::CopyPathToClipboard(path));
            }
            IpcCommand::RenameFile { path, new_name } => {
                let _ = proxy.send_event(UserEvent::RenamePath { path, new_name });
            }
            IpcCommand::DeleteFile { path } => {
                let _ = proxy.send_event(UserEvent::DeletePath(path));
            }
            IpcCommand::ShowProperties { path } => {
                let _ = proxy.send_event(UserEvent::ShowProperties(path));
            }
            IpcCommand::CloseTab { index } => {
                let _ = proxy.send_event(UserEvent::CloseTab { index });
            }
            IpcCommand::SwitchTab {
                index,
                scroll_anchor,
                code_scroll,
            } => {
                let _ = proxy.send_event(UserEvent::SwitchTab {
                    index,
                    scroll_anchor,
                    code_scroll,
                });
            }
            IpcCommand::MoveTab { from, to } => {
                let _ = proxy.send_event(UserEvent::MoveTab { from, to });
            }
            IpcCommand::GoHome => {
                let _ = proxy.send_event(UserEvent::GoHome);
            }
            IpcCommand::OpenLink {
                href,
                scroll_anchor,
            } => {
                let _ = proxy.send_event(UserEvent::OpenLink {
                    href,
                    scroll_anchor,
                });
            }
            IpcCommand::OpenExternal { url } => {
                let _ = proxy.send_event(UserEvent::OpenExternal { url });
            }
            IpcCommand::OpenGlossary { href } => {
                let _ = proxy.send_event(UserEvent::OpenGlossary { href });
            }
            IpcCommand::CountLines { href, token } => {
                let _ = proxy.send_event(UserEvent::CountLines { href, token });
            }
            IpcCommand::GoBack { scroll_anchor } => {
                let _ = proxy.send_event(UserEvent::GoBack { scroll_anchor });
            }
            IpcCommand::GoForward { scroll_anchor } => {
                let _ = proxy.send_event(UserEvent::GoForward { scroll_anchor });
            }
            IpcCommand::SetMinimapEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetMinimapEnabled { enabled });
            }
            IpcCommand::SetPagerEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetPagerEnabled { enabled });
            }
            IpcCommand::SpliceSource {
                start,
                removed,
                inserted,
                length,
            } => {
                let _ = proxy.send_event(UserEvent::SpliceSource {
                    start,
                    removed,
                    inserted,
                    length,
                });
            }
            IpcCommand::SetSpeedReaderEnabled { enabled } => {
                let _ = proxy.send_event(UserEvent::SetSpeedReaderEnabled { enabled });
            }
            IpcCommand::SetThemeFamily { family } => {
                let _ = proxy.send_event(UserEvent::SetThemeFamily { family });
            }
            IpcCommand::SetThemeMode { mode } => {
                let _ = proxy.send_event(UserEvent::SetThemeMode { mode });
            }
            IpcCommand::SetThemeRandomBag { used } => {
                let _ = proxy.send_event(UserEvent::SetThemeRandomBag { used });
            }
            IpcCommand::WindowDrag => {
                let _ = proxy.send_event(UserEvent::WindowDrag);
            }
            IpcCommand::WindowMinimize => {
                let _ = proxy.send_event(UserEvent::WindowMinimize);
            }
            IpcCommand::WindowToggleMaximize => {
                let _ = proxy.send_event(UserEvent::WindowToggleMaximize);
            }
            IpcCommand::WindowClose => {
                let _ = proxy.send_event(UserEvent::WindowClose);
            }
            IpcCommand::SetWindowChrome {
                r,
                g,
                b,
                border_r,
                border_g,
                border_b,
                dark,
            } => {
                let _ = proxy.send_event(UserEvent::SetWindowChrome {
                    r,
                    g,
                    b,
                    border_r,
                    border_g,
                    border_b,
                    dark,
                });
            }
            IpcCommand::SetLibraryState { project_path } => {
                let _ = proxy.send_event(UserEvent::SetLibraryState { project_path });
            }
            IpcCommand::SetGraphView { open } => {
                let _ = proxy.send_event(UserEvent::SetGraphView { open });
            }
            IpcCommand::GetVaultGit { id } => {
                let _ = proxy.send_event(UserEvent::GetVaultGit { id });
            }
            IpcCommand::GetVaultStatus { id } => {
                let _ = proxy.send_event(UserEvent::GetVaultStatus { id });
            }
            IpcCommand::CreateVaultRepo { id } => {
                let _ = proxy.send_event(UserEvent::CreateVaultRepo { id });
            }
            IpcCommand::LinkVaultRemote { id, url } => {
                let _ = proxy.send_event(UserEvent::LinkVaultRemote { id, url });
            }
            IpcCommand::SyncVault { id } => {
                let _ = proxy.send_event(UserEvent::SyncVault { id });
            }
            IpcCommand::SetLibraryLayout { closed, width } => {
                let _ = proxy.send_event(UserEvent::SetLibraryLayout { closed, width });
            }
            IpcCommand::CreateVault => {
                let _ = proxy.send_event(UserEvent::CreateVault);
            }
            IpcCommand::SetActiveVault { id } => {
                let _ = proxy.send_event(UserEvent::SetActiveVault { id });
            }
            IpcCommand::RenameVault { id, name } => {
                let _ = proxy.send_event(UserEvent::RenameVault { id, name });
            }
            IpcCommand::ChangeVaultFolder { id } => {
                let _ = proxy.send_event(UserEvent::ChangeVaultFolder { id });
            }
            IpcCommand::RemoveVault { id } => {
                let _ = proxy.send_event(UserEvent::RemoveVault { id });
            }
            IpcCommand::GetFolder { path } => {
                let _ = proxy.send_event(UserEvent::LoadFolder { path });
            }
            IpcCommand::RevealInLibrary { path } => {
                let _ = proxy.send_event(UserEvent::RevealInLibrary { path });
            }
            IpcCommand::GetGraph { scope, seeds } => {
                let _ = proxy.send_event(UserEvent::GetGraph { scope, seeds });
            }
            IpcCommand::SetGraphScope { scope } => {
                let _ = proxy.send_event(UserEvent::SetGraphScope { scope });
            }
            IpcCommand::Search { query, scope } => {
                let _ = proxy.send_event(UserEvent::Search { query, scope });
            }
            IpcCommand::LoadPager { path } => {
                let _ = proxy.send_event(UserEvent::LoadPager { path });
            }
            IpcCommand::EnterCodeView => {
                let _ = proxy.send_event(UserEvent::EnterCodeView);
            }
            IpcCommand::ExitCodeView => {
                let _ = proxy.send_event(UserEvent::ExitCodeView);
            }
            IpcCommand::UpdateSource { text } => {
                let _ = proxy.send_event(UserEvent::UpdateSource { text });
            }
            IpcCommand::SaveDocument => {
                let _ = proxy.send_event(UserEvent::SaveDocument);
            }
            IpcCommand::ToggleTask { index } => {
                let _ = proxy.send_event(UserEvent::ToggleTask { index });
            }
            IpcCommand::EditBlock {
                start,
                end,
                text,
                autosave,
            } => {
                let _ = proxy.send_event(UserEvent::EditBlock {
                    start,
                    end,
                    text,
                    autosave,
                });
            }
            IpcCommand::UndoEdit => {
                let _ = proxy.send_event(UserEvent::UndoEdit);
            }
            IpcCommand::UpdateChecked { version } => {
                let _ = proxy.send_event(UserEvent::UpdateChecked { version });
            }
            IpcCommand::UpdateDownload {
                version,
                asset,
                size,
                url,
            } => {
                let _ = proxy.send_event(UserEvent::UpdateDownload {
                    version,
                    asset,
                    size,
                    url,
                });
            }
            IpcCommand::ApplyUpdate => {
                let _ = proxy.send_event(UserEvent::ApplyUpdate);
            }
        }
    }
}
