use crate::store::{DocumentGraph, SearchResults, Vault};
use crate::*;

/// `f(<state>);` — the state written out as a JavaScript value.
///
/// Not `JSON.parse("…")`, which is slower here. That trick wins when a payload is dense structure (the blocks array alone parses 3x faster that way) and loses on long strings, because the text is scanned and unescaped once as a JS string before the JSON reader sees it at all. A document payload is mostly two very large strings — the rendered HTML and the source — so it came out ~40 ms slower on a 4 MB glossary, and 1.4 MB larger to hand across.
fn call_with_json(function: &str, value: &serde_json::Value) -> String {
    format!("{function}({value});")
}

/// Initial workspace state as `window.__leafInitialState`. Run as an init script (before any page script) so the boot bootstrap applies it on the first render. Both lists, because the start screen draws both and a cold launch is the one render nothing else answers for.
pub fn initial_state_script(recent: &[PathBuf], favorites: &Favorites) -> String {
    let state = workspace_payload(recent, favorites, &[], None, None);
    format!(
        "window.__leafInitialState = {};",
        serde_json::json!({
            "recent": state["recent"],
            "favorites": state["favorites"],
            "document": serde_json::Value::Null,
        })
    )
}

/// Persisted UI toggles as `window.__leafSettings`. Run as an init script so theme and library pane render from saved state on the first paint. Keys are camelCase to match the frontend, not the snake_case on-disk format.
pub fn initial_settings_script(settings: &Settings) -> String {
    let state = serde_json::json!({
        "speedReaderEnabled": settings.speed_reader_enabled,
        "codeIntelEnabled": settings.code_intel_enabled,
        "readingUnlocked": settings.reading_unlocked,
        "codeUnlocked": settings.code_unlocked,
        "themeFamily": settings.theme_family,
        "themeMode": settings.theme_mode,
        "themeRandomUsed": settings.theme_random_used,
        "graphScope": settings.graph_scope.as_str(),
        "libraryProjectPath": settings.library_project_path,
        "libraryClosed": settings.library_closed,
        "libraryWidth": settings.library_width,
        "updateLastChecked": settings.update_last_checked,
        "updateStagedVersion": settings.update_staged_version,
        "hintLaunches": settings.hint_launches,
        "hintsSeen": settings.hints_seen,
        "hintLastLaunch": settings.hint_last_launch,
    });
    format!("window.__leafSettings = {};", state)
}

/// Whether `settings.json` was there and unreadable, as `window.__leafSettingsUnreadable`; the boot growls once when it is true. Always emitted, so the flag is never undefined.
pub fn settings_unreadable_script(unreadable: bool) -> String {
    format!("window.__leafSettingsUnreadable = {unreadable};")
}

/// Which favorites are not on the disk, and which vaults' own folders have gone, as `window.leafSetFavoritesMissing`. Sent when the start screen asks, because only the binary reads the disk: this payload's builder is library code a browser compiles too, and it is rebuilt on every render — including every document open, where nobody is looking at the favorites. Nothing marked is the resting state, so a browser and a reply still in flight both say the same true thing.
pub fn favorites_missing_script(paths: &[String], vaults: &[i64]) -> String {
    format!(
        "window.leafSetFavoritesMissing({});",
        serde_json::json!({ "paths": paths, "vaults": vaults })
    )
}

/// The link graph, for the graph view. Every string is file-derived and untrusted; the page escapes them before they reach a label.
pub fn graph_script(graph: &DocumentGraph) -> String {
    let payload = serde_json::json!({
        "nodes": graph.nodes,
        "edges": graph.edges,
        "truncated": graph.truncated,
        "error": serde_json::Value::Null,
    });
    format!("window.leafSetGraph({payload});")
}

/// Ranked search results. The query is echoed so the page can drop an answer to a query the field has already moved on from. `truncated` is the list being cut at the hit cap — a different fact from the graph's, which is the vault walk hitting its document cap.
pub fn search_results_script(query: &str, results: &SearchResults) -> String {
    let payload = serde_json::json!({
        "query": query,
        "hits": results.hits,
        "truncated": results.truncated,
        "understood": results.understood,
        "unknownFields": results.unknown_fields,
        "error": serde_json::Value::Null,
    });
    format!("window.leafSetSearchResults({payload});")
}

/// The field names and values the search box completes from. Pushed once when a vault's text is read, so typing costs no round trip. Every string is file-derived and untrusted; the page escapes them before the DOM.
pub fn filter_hints_script(hints: &FilterHints) -> String {
    let payload = serde_json::to_string(hints).unwrap_or_else(|_| "null".to_string());
    format!("window.leafSetFilterHints({payload});")
}

/// One folder's contents, for the library pane. Every string in it is file-derived and untrusted; the page escapes them before the DOM.
pub fn library_folder_script(listing: &FolderListing) -> String {
    let payload = serde_json::to_string(listing).unwrap_or_else(|_| "null".to_string());
    format!("window.leafSetLibraryFolder({payload});")
}

/// The vault registry as `window.__leafVaults`. An init script, like the other seeded state, so the leftmost crumb reads the active vault's name on the first paint instead of flashing "Library" and correcting itself.
pub fn initial_vaults_script(vaults: &[Vault], active: i64) -> String {
    format!("window.__leafVaults = {};", vaults_payload(vaults, active))
}

/// The same registry, pushed after a change (a vault added, or switched to).
pub fn vaults_script(vaults: &[Vault], active: i64) -> String {
    format!("window.leafSetVaults({});", vaults_payload(vaults, active))
}

/// Vault names are folder names — user text — so the page escapes them before the DOM.
fn vaults_payload(vaults: &[Vault], active: i64) -> serde_json::Value {
    serde_json::json!({ "vaults": vaults, "active": active })
}

/// The sync clients whose folders are on this machine. Pushed rather than seeded: it is read off the disk when the vault menu opens, and nothing before that needs it.
pub fn cloud_folders_script(folders: &[CloudFolder]) -> String {
    format!(
        "window.leafSetCloudFolders({});",
        serde_json::json!(folders)
    )
}

/// Every readable extension as `window.__leafDocumentExts`, from the format table, so the page never keeps its own copy of the list.
pub fn initial_document_exts_script() -> String {
    format!(
        "window.__leafDocumentExts = {};",
        serde_json::json!(all_document_extensions())
    )
}

/// The running app version as `window.__leafVersion`. Run as an init script so the frontend's update check can compare it against the latest GitHub release.
pub fn initial_version_script() -> String {
    format!(
        "window.__leafVersion = {};",
        serde_json::json!(env!("CARGO_PKG_VERSION"))
    )
}

/// Which release asset this build can install, as a file-name suffix, so the page can pick its own platform's installer out of the release. Empty on a build with no installable artifact, which the page reads as notify-only.
pub fn initial_update_script() -> String {
    format!(
        "window.__leafUpdateAsset = {};",
        serde_json::json!(crate::platform_asset_suffix())
    )
}

pub fn document_state_script(document: &OpenedDocument, recent: &[PathBuf]) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "document": document,
    });
    call_with_json("window.leafSetState", &state)
}

/// The payload every workspace script carries: recents, the favorites, tabs, active index and document (`null` on the home screen). One builder so the four senders agree — a screen left out of it is a screen that never hears about a change.
fn workspace_payload(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> serde_json::Value {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    // Spelled out rather than serialized whole, so a favorite reaches the page the way a recent does: as the text the page compares against a document's own path.
    let favorites: Vec<serde_json::Value> = favorites
        .entries
        .iter()
        .map(|favorite| {
            serde_json::json!({
                "vaultId": favorite.vault_id,
                "path": favorite.path.display().to_string(),
                "kind": favorite.kind,
            })
        })
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    serde_json::json!({
        "recent": recent,
        "favorites": favorites,
        "tabs": tabs,
        "active": active,
        "document": document,
    })
}

/// Full workspace state, applied via `leafSetState` (resets the scroll).
pub fn workspace_state_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    call_with_json(
        "window.leafSetState",
        &workspace_payload(recent, favorites, tabs, active, document),
    )
}

/// Tabs, recents and the active index with no document. The code view renders itself from its own payload, so the state script never runs for a tab showing source — this is how such a tab still gets its entry in the strip and gives the page an active document to name. The page reads only the fields it merges (recent, tabs, active); the null document is ignored.
pub fn workspace_only_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[(String, String)],
    active: Option<usize>,
) -> String {
    format!(
        "window.leafSetWorkspace({});",
        workspace_payload(recent, favorites, tabs, active, None)
    )
}

/// Like [`workspace_state_script`] but via `leafReloadDocument`, which re-renders in place and preserves scroll position. Used by live-reload.
pub fn workspace_reload_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    call_with_json(
        "window.leafReloadDocument",
        &workspace_payload(recent, favorites, tabs, active, document),
    )
}

/// A document-intrinsic scroll position that survives a full re-render (tab switch, history nav, live reload). Names the nearest heading above the top edge, the block ordinal within that section, and the offset into it — unlike a raw pixel offset, which drifts as images settle the layout.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScrollAnchor {
    /// Heading slug the position sits under; `None` above the first heading.
    #[serde(default)]
    pub section: Option<String>,
    /// Zero-based block index within the section (the heading itself is 0).
    #[serde(default)]
    pub block: u32,
    /// Signed offset of the top edge from the block's top; signed so the reading-mode top gap survives at the start of a document.
    #[serde(default, rename = "offsetY")]
    pub offset_y: f64,
}

/// Serialize an anchor to the JS object literal the webview restore hooks expect.
fn scroll_anchor_json(anchor: &ScrollAnchor) -> String {
    serde_json::to_string(anchor)
        .unwrap_or_else(|_| r#"{"section":null,"block":0,"offsetY":0}"#.to_string())
}

/// Like [`workspace_state_script`] but via `leafSwitchTab`, which renders the target tab and restores `anchor` in the same frame so the switch never snaps to the top. `anchor` is `None` the first time a tab is opened.
pub fn workspace_switch_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    anchor: Option<&ScrollAnchor>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, document);
    let anchor = match anchor {
        Some(anchor) => scroll_anchor_json(anchor),
        None => "null".to_string(),
    };
    format!("window.leafSwitchTab({state}, {anchor});")
}

pub fn navigation_state_script(can_go_back: bool, can_go_forward: bool) -> String {
    let state = serde_json::json!({
        "canGoBack": can_go_back,
        "canGoForward": can_go_forward,
    });
    format!("window.leafSetNavigation({});", state)
}

pub fn fragment_scroll_script(fragment: &str) -> String {
    let fragment = serde_json::to_string(fragment).expect("fragment serializes");
    format!("window.leafScrollToFragment({fragment});")
}

/// Show a glossary term in the bottom sheet. `body_html` is the fully rendered glossary document; the page extracts the entry whose heading id is `anchor` and slides the sheet up over the current document.
pub fn glossary_sheet_script(body_html: &str, anchor: &str) -> String {
    let body_html = serde_json::to_string(body_html).expect("glossary html serializes");
    let anchor = serde_json::to_string(anchor).expect("glossary anchor serializes");
    format!("window.leafShowGlossary({body_html}, {anchor});")
}

/// Tell the page a lookup produced nothing: the sheet is already up on a spinner by the time the host reads, so silence would leave it spinning. `reason` is `missing` (no glossary file near the document) or `failed`.
pub fn glossary_failed_script(reason: &str) -> String {
    let reason = serde_json::to_string(reason).expect("glossary reason serializes");
    format!("window.leafGlossaryFailed({reason});")
}

/// Re-read the folder the library pane is showing.
///
/// Sent after the app itself changes what is in a folder — a paste, a delete, a rename. The folder watcher also notices, but only for the folder it is watching and only after its debounce, so an action taken here would otherwise leave the pane showing what was true before it.
pub fn library_refresh_script() -> String {
    "window.leafRefreshLibraryFolder();".to_string()
}

/// Show a message as an error toast. For the failures a person set in motion and is waiting on — a paste that collided, a drag that couldn't land — where the terminal is not where they are looking.
pub fn error_toast_script(message: &str) -> String {
    let message = serde_json::to_string(message).expect("toast message serializes");
    format!("window.leafShowError({message});")
}

/// The same, for something that worked — a file written where the person asked for it. Silence reads as nothing having happened.
pub fn notice_toast_script(message: &str) -> String {
    let message = serde_json::to_string(message).expect("toast message serializes");
    format!("window.leafShowNotice({message});")
}

/// Say a file went to the bin, and can come back. The page arms its Undo off this rather than off the asking, so a build with nothing behind the delete never draws an offer it could not keep.
pub fn file_deleted_script(path: &str, name: &str) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    let name = serde_json::to_string(name).expect("name serializes");
    format!("window.leafFileDeleted({path}, {name});")
}

/// Re-fetch the local images on screen. Sent when an image file changes: nothing to re-render, but the web view would otherwise keep the copy it decoded.
pub fn image_refresh_script() -> String {
    "window.leafRefreshImages();".to_string()
}

/// Restore a saved scroll anchor in the current document without re-rendering. Used by Back/Forward when the jump stays within the same document.
pub fn scroll_anchor_script(anchor: &ScrollAnchor) -> String {
    format!(
        "window.leafRestoreScrollAnchor({});",
        scroll_anchor_json(anchor)
    )
}

pub fn open_error_state_script(path: &Path, reason: &str) -> String {
    let path = serde_json::to_string(&path.display().to_string()).expect("path serializes");
    let reason = serde_json::to_string(reason).expect("error reason serializes");
    format!("window.leafShowOpenError({path}, {reason});")
}

/// Swap to the raw-source code view: the buffer text, the language token and label the editor is opened on, and the dirty state. The editor colors its own text, so no markup travels with it.
pub fn code_view_payload(
    text: &str,
    language: &str,
    display_name: &str,
    dirty: bool,
    scroll_fraction: Option<f64>,
) -> String {
    let mut state = serde_json::json!({
        "text": text,
        "language": language,
        "displayName": display_name,
        "dirty": dirty,
    });
    // A restored position (returning to a tab left in code view) rides along as a 0..1 scroll fraction; omit it entirely otherwise so the page keeps its own placement (fresh toggle, in-place live reload).
    if let Some(fraction) = scroll_fraction {
        state["scrollFraction"] = serde_json::json!(fraction);
    }
    state.to_string()
}

/// Point the page at a staged payload instead of carrying it. See `PENDING_SOURCE_PAYLOAD` for why the megabytes do not travel as script.
pub fn code_view_fetch_script(url: &str) -> String {
    format!(
        "window.leafLoadCodeView({});",
        serde_json::to_string(url).unwrap_or_else(|_| String::from("\"\""))
    )
}

/// Tell the page the host has taken a code-view edit: only the dirty state, which is the tab's unsaved dot and the Save button. The text the page already has.
pub fn source_updated_script(dirty: bool) -> String {
    let state = serde_json::json!({ "dirty": dirty });
    format!("window.leafSourceUpdated({});", state)
}

/// Re-sync the reading view's editing state from the buffer: task-marker offsets in document order, dirty state, whether an undo step exists, and optionally the buffer text for block editors. Pass `source: None` when a full re-render already delivered the same text, to avoid shipping it twice.
pub fn blocks_resynced_script(
    tasks: &[usize],
    dirty: bool,
    can_undo: bool,
    source: Option<&str>,
) -> String {
    let state = serde_json::json!({
        "tasks": tasks,
        "dirty": dirty,
        "canUndo": can_undo,
        "source": source,
    });
    format!("window.leafBlocksResynced({});", state)
}

/// Unlock the reading view without anyone clicking the padlock. Sent for a document created here, which exists to be typed into and would otherwise open untypable. The source's padlock is its own and is left alone.
pub fn unlock_reading_script() -> String {
    "window.leafUnlockReading();".to_string()
}

/// Hand the page the image it asked the picker for. `token` is the insert box that opened the dialog — the page dropped it if the document changed while the dialog was up, and an answer to a box nobody is holding is ignored.
pub fn image_picked_script(token: u64, destination: &str, alt: &str) -> String {
    let destination = serde_json::to_string(destination).expect("destination serializes");
    let alt = serde_json::to_string(alt).expect("alt serializes");
    format!("window.leafImagePicked({token}, {destination}, {alt});")
}

/// Report the outcome of a save for `path`: `error` is null on success and a message string when the write failed.
pub fn save_result_script(path: &str, ok: bool, error: Option<&str>) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    let error = match error {
        Some(message) => serde_json::to_string(message).expect("error serializes"),
        None => "null".to_string(),
    };
    format!("window.leafSaved({path}, {ok}, {error});")
}

/// Answer a hover tooltip's `countLines` request for `token`. A negative count means "unknown" (not a readable local document); the page shows no count.
pub fn line_count_script(token: u64, lines: i64) -> String {
    format!("window.leafLineCount({token}, {lines});")
}

/// One answer channel for every code-view IntelliSense ask: the page matches the echoed `token` to the popup, hover or lint pass that asked.
fn code_intel_answer(token: u64, mut payload: serde_json::Value) -> String {
    payload["token"] = serde_json::json!(token);
    format!("window.leafCodeIntelAnswer({payload});")
}

/// The notes `[[` can complete to. Labels and folders are file names — user text — so the page escapes them before the DOM.
pub fn code_intel_notes_script(token: u64, notes: &[crate::NoteItem]) -> String {
    code_intel_answer(token, serde_json::json!({ "notes": notes }))
}

/// The headings `[[note#` or `](#` can complete to.
pub fn code_intel_headings_script(token: u64, headings: &[crate::HeadingItem]) -> String {
    code_intel_answer(token, serde_json::json!({ "headings": headings }))
}

/// A note's opening lines for the hover card, or `null` when no note answers to the name.
pub fn code_intel_hover_script(token: u64, hover: Option<(&str, &str)>) -> String {
    let hover = match hover {
        Some((label, preview)) => serde_json::json!({ "label": label, "preview": preview }),
        None => serde_json::Value::Null,
    };
    code_intel_answer(token, serde_json::json!({ "hover": hover }))
}

/// The broken-link markers for the active buffer, in Monaco's own coordinates.
pub fn code_intel_lint_script(token: u64, markers: &[crate::LintMarker]) -> String {
    code_intel_answer(token, serde_json::json!({ "markers": markers }))
}

/// Tell the page how a download ended: `staged` when an installer is verified and waiting, `failed` with a reason otherwise.
pub fn update_state_script(status: &str, version: &str, message: Option<&str>) -> String {
    let state = serde_json::json!({
        "status": status,
        "version": version,
        "message": message,
    });
    format!("window.leafUpdateState({});", state)
}

/// Move the download's progress bar, 0-100. Separate from `update_state_script` because it fires a hundred times a download and carries no message to read.
pub fn update_progress_script(version: &str, percent: u8) -> String {
    let state = serde_json::json!({
        "status": "downloading",
        "version": version,
        "percent": percent,
    });
    format!("window.leafUpdateState({});", state)
}
