use crate::store::{DocumentGraph, SearchResults, Vault};
use crate::*;
use std::hash::{Hash, Hasher};
use std::io::Write as _;

/// The key a page names when it asks for a switch back. Taken from the source, so a payload built anywhere but the desktop's own render still carries one.
fn document_render_key(source: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    hasher.finish()
}

/// `f(<state>);` — the state written out as a JavaScript value.
///
/// Not `JSON.parse("…")`, which is slower here. That trick wins when a payload is dense structure (the blocks array alone parses 3x faster that way) and loses on long strings, because the text is scanned and unescaped once as a JS string before the JSON reader sees it at all. A document payload is mostly two very large strings — the rendered HTML and the source — so it came out ~40 ms slower on a 4 MB glossary, and 1.4 MB larger to hand across.
fn call_with_json(
    function: &str,
    value: &impl serde::Serialize,
    suffix: &str,
    capacity: usize,
) -> String {
    let mut script = Vec::with_capacity(capacity);
    write!(&mut script, "{function}(").expect("script buffer accepts text");
    serde_json::to_writer(&mut script, value).expect("workspace state serializes");
    script.extend_from_slice(suffix.as_bytes());
    String::from_utf8(script).expect("JSON and script syntax are UTF-8")
}

/// One tab as the strip draws it: the label, the document it stands for, whether that document has edits nobody has saved, and whether there is a step to take back.
///
/// Both flags travel with the tab because the page's own maps of them start empty at every launch. Without the first, a tab whose edits the session put back would show no dot unless the reader happened to be looking at it; without the second, the one step it can undo is unreachable, since the page refuses to ask for an undo it does not believe in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabSummary {
    pub title: String,
    pub path: String,
    pub dirty: bool,
    pub undoable: bool,
    pub redoable: bool,
    /// Whether this tab is showing a note that has never had a file. The page reads it at the press: the first Save of one opens a save window, and on a Mac that window says nothing about format, so the format is asked before it opens.
    pub untitled: bool,
}

/// Initial workspace state as `window.__leafInitialState`. Run as an init script (before any page script) so the boot bootstrap applies it on the first render. Both lists, because the start screen draws both and a cold launch is the one render nothing else answers for.
pub fn initial_state_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, None, None);
    format!(
        "window.__leafInitialState = {};",
        serde_json::json!({
            "recent": state.recent,
            "favorites": state.favorites,
            "tabs": state.tabs,
            "active": state.active,
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

/// Whether the reader told their operating system to always show scrollbars, as `window.__leafScrollbarsAlways`; the page stamps a flag on the surface when it is true. Always emitted, so the flag is never undefined.
///
/// Its own global rather than a field on `Settings`: the answer belongs to the operating system, so writing it into `settings.json` would keep a second copy of it that goes stale the moment somebody changes their mind. A published page and an exported one carry no init scripts at all, so neither ever sees this and both behave as they do today.
pub fn scrollbars_always_script(always: bool) -> String {
    format!("window.__leafScrollbarsAlways = {always};")
}

/// The last install attempt when it failed, as `window.__leafUpdateFailed`: the version it was installing and the applier's own words. `null` for a success and for nothing recorded, and always emitted so the flag is never undefined.
///
/// An init script rather than a message, because the launch reads the record before the event loop starts and there is no page yet to send one to — the same crossing `settings_unreadable_script` makes. The success case is filtered here rather than at the launch so a test can call it; nothing can call into `run_app`.
pub fn update_failed_script(outcome: Option<&ApplyOutcome>) -> String {
    let state = match outcome.filter(|outcome| !outcome.ok) {
        Some(outcome) => serde_json::json!({
            "version": outcome.version,
            "message": outcome.message,
        }),
        None => serde_json::Value::Null,
    };
    format!("window.__leafUpdateFailed = {state};")
}

/// Whether the previous run missed the close that saves, as `window.__leafClosedUnexpectedly`; the boot growls once when it is true. Always emitted, so the flag is never undefined.
///
/// An init script rather than a message, for the reason the two above are: the launch reads the run marker before the event loop starts and there is no page to send anything to yet. A published page and an exported one carry no init scripts at all, and neither has a desktop run marker to read, so both keep saying nothing.
pub fn unexpected_close_script(closed_unexpectedly: bool) -> String {
    format!("window.__leafClosedUnexpectedly = {closed_unexpectedly};")
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
///
/// `partial` says the vault was still being read, so more rows are coming for this same query: the pane keeps its ring, adds what is new under what is drawn, and re-sorts only on the answer that is not partial. Absent reads as finished, which is what a host that never streams — a published site, an older payload — is saying by not saying anything.
pub fn search_results_script(query: &str, results: &SearchResults, partial: bool) -> String {
    let payload = serde_json::json!({
        "query": query,
        "hits": results.hits,
        "truncated": results.truncated,
        "understood": results.understood,
        "unknownFields": results.unknown_fields,
        "skipped": results.skipped,
        "partial": partial,
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

/// Every readable format as `window.__leafDocumentFormats` — the words a reader is offered, and the ending each one writes. Off the same table as the flat list above, in the order the save window offers them, because a Mac panel shows none of them and the menu the page draws instead is the only place they are ever said. A new format appears there the day it is added here.
pub fn initial_document_formats_script() -> String {
    let formats: Vec<serde_json::Value> = DocumentFormat::ALL
        .iter()
        .filter(|format| **format != DocumentFormat::Code)
        .map(|format| {
            serde_json::json!({
                "label": format.display_name(),
                "ext": format.extensions()[0],
            })
        })
        .collect();
    format!(
        "window.__leafDocumentFormats = {};",
        serde_json::json!(formats)
    )
}

/// The running app version as `window.__leafVersion`. Run as an init script so the frontend's update check can compare it against the latest GitHub release.
pub fn initial_version_script() -> String {
    format!(
        "window.__leafVersion = {};",
        serde_json::json!(env!("CARGO_PKG_VERSION"))
    )
}

/// Whether this page is a document inside somebody else's product, as `window.__leafEmbedded`. The front end reads it before it draws: an embed shows the document and nothing around it, because the product owns the bar, the buttons and the save. The same pattern as the frameless-window flag and the published-site one, and for the same reason — the alternative is drawing the chrome and taking it down again.
pub fn initial_embedded_script(embedded: bool) -> String {
    format!("window.__leafEmbedded = {embedded};")
}

/// Which release asset this copy can install, as a file-name suffix, so the page can pick its own installer out of the release. Empty on a build with no installable artifact, which the page reads as notify-only.
///
/// Handed in rather than looked up: on Windows the answer is which installer put this copy on the machine, and that is a registry read this library must never do — it compiles for a browser too.
pub fn initial_update_script(suffix: &str) -> String {
    format!("window.__leafUpdateAsset = {};", serde_json::json!(suffix))
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
    call_with_json("window.leafSetState", &state, ");", 0)
}

/// The payload every workspace script carries: recents, the favorites, tabs, active index and document (`null` on the home screen). One builder so the four senders agree — a screen left out of it is a screen that never hears about a change.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePayload<'a> {
    active: Option<usize>,
    document: Option<&'a OpenedDocument>,
    favorites: Vec<WorkspaceFavorite<'a>>,
    recent: Vec<String>,
    render_key: Option<String>,
    tabs: Vec<WorkspaceTab<'a>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFavorite<'a> {
    kind: &'a FavoriteKind,
    path: String,
    vault_id: Option<i64>,
}

#[derive(serde::Serialize)]
struct WorkspaceTab<'a> {
    dirty: bool,
    path: &'a str,
    redoable: bool,
    title: &'a str,
    undoable: bool,
    untitled: bool,
}

impl WorkspacePayload<'_> {
    fn payload_capacity(&self) -> usize {
        let document = self
            .document
            .map(|document| document.source.len() + document.html.len())
            .unwrap_or_default();
        let recent = self.recent.iter().map(String::len).sum::<usize>();
        let favorites = self
            .favorites
            .iter()
            .map(|favorite| favorite.path.len() + 64)
            .sum::<usize>();
        let tabs = self
            .tabs
            .iter()
            .map(|tab| tab.title.len() + tab.path.len() + 96)
            .sum::<usize>();
        document + recent + favorites + tabs + 256
    }
}

fn workspace_payload<'a>(
    recent: &[PathBuf],
    favorites: &'a Favorites,
    tabs: &'a [TabSummary],
    active: Option<usize>,
    document: Option<&'a OpenedDocument>,
    render_key: Option<u64>,
) -> WorkspacePayload<'a> {
    let render_key = render_key.or_else(|| document.map(|item| document_render_key(&item.source)));
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    // Spelled out rather than serialized whole, so a favorite reaches the page the way a recent does: as the text the page compares against a document's own path.
    let favorites = favorites
        .entries
        .iter()
        .map(|favorite| WorkspaceFavorite {
            kind: &favorite.kind,
            path: favorite.path.display().to_string(),
            vault_id: favorite.vault_id,
        })
        .collect();
    let tabs = tabs
        .iter()
        .map(|tab| WorkspaceTab {
            dirty: tab.dirty,
            path: &tab.path,
            redoable: tab.redoable,
            title: &tab.title,
            undoable: tab.undoable,
            untitled: tab.untitled,
        })
        .collect();
    WorkspacePayload {
        active,
        document,
        favorites,
        recent,
        render_key: render_key.map(|key| format!("{key:016x}")),
        tabs,
    }
}

fn workspace_call(function: &str, state: &WorkspacePayload<'_>, suffix: &str) -> String {
    call_with_json(
        function,
        state,
        suffix,
        function.len() + suffix.len() + state.payload_capacity(),
    )
}

fn workspace_json(state: &WorkspacePayload<'_>) -> Vec<u8> {
    let mut json = Vec::with_capacity(state.payload_capacity());
    serde_json::to_writer(&mut json, state).expect("workspace state serializes");
    json
}

/// A document-bearing workspace update staged for the desktop page to fetch.
pub struct WorkspacePayloadMessage {
    action: &'static str,
    detail: Option<String>,
    json: Vec<u8>,
}

impl WorkspacePayloadMessage {
    /// The short page command that fetches this message instead of carrying its document.
    pub fn fetch_script(&self, url: &str) -> String {
        format!(
            "window.leafLoadWorkspace({}, {}, {});",
            serde_json::json!(url),
            serde_json::json!(self.action),
            self.detail.as_deref().unwrap_or("null")
        )
    }

    /// The JSON served when the page fetches the staged message.
    pub fn into_json(self) -> Vec<u8> {
        self.json
    }

    /// Stage the JSON and return the short command that points the page at it.
    pub fn stage_with(self, stage: impl FnOnce(Vec<u8>) -> String) -> String {
        let url = stage(self.json);
        format!(
            "window.leafLoadWorkspace({}, {}, {});",
            serde_json::json!(url),
            serde_json::json!(self.action),
            self.detail.as_deref().unwrap_or("null")
        )
    }

    /// The bytes sent through WebView2's shared-buffer door.
    pub fn shared_json(&self) -> &[u8] {
        &self.json
    }

    /// The small routing record sent beside WebView2's shared buffer.
    pub fn shared_metadata(&self) -> String {
        format!(
            "{{\"action\":{},\"detail\":{}}}",
            serde_json::json!(self.action),
            self.detail.as_deref().unwrap_or("null")
        )
    }
}

/// Full workspace state as a staged desktop payload.
pub fn workspace_state_message(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    render_key: Option<u64>,
) -> WorkspacePayloadMessage {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    WorkspacePayloadMessage {
        action: "state",
        detail: None,
        json: workspace_json(&state),
    }
}

/// A live reload as a staged desktop payload.
pub fn workspace_reload_message(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    render_key: Option<u64>,
) -> WorkspacePayloadMessage {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    WorkspacePayloadMessage {
        action: "reload",
        detail: None,
        json: workspace_json(&state),
    }
}

/// A tab switch as a staged desktop payload.
pub fn workspace_switch_message(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    anchor: Option<&ScrollAnchor>,
    render_key: Option<u64>,
) -> WorkspacePayloadMessage {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    let anchor = anchor
        .map(scroll_anchor_json)
        .unwrap_or_else(|| "null".to_string());
    WorkspacePayloadMessage {
        action: "switch",
        detail: Some(anchor),
        json: workspace_json(&state),
    }
}

/// A cached tab switch as a staged desktop payload.
pub fn workspace_cached_switch_message(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    anchor: Option<&ScrollAnchor>,
    render_key: u64,
) -> WorkspacePayloadMessage {
    let state = workspace_payload(recent, favorites, tabs, active, None, Some(render_key));
    let detail = serde_json::json!({
        "anchor": anchor,
        "key": format!("{render_key:016x}"),
    })
    .to_string();
    WorkspacePayloadMessage {
        action: "cachedSwitch",
        detail: Some(detail),
        json: workspace_json(&state),
    }
}

/// Full workspace state, applied via `leafSetState` (resets the scroll).
pub fn workspace_state_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    render_key: Option<u64>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    workspace_call("window.leafSetState", &state, ");")
}

/// Tabs, recents and the active index with no document. The code view renders itself from its own payload, so the state script never runs for a tab showing source — this is how such a tab still gets its entry in the strip and gives the page an active document to name. The page reads only the fields it merges (recent, tabs, active); the null document is ignored.
pub fn workspace_only_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, None, None);
    workspace_call("window.leafSetWorkspace", &state, ");")
}

/// Like [`workspace_state_script`] but via `leafReloadDocument`, which re-renders in place and preserves scroll position. Used by live-reload.
pub fn workspace_reload_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    render_key: Option<u64>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    workspace_call("window.leafReloadDocument", &state, ");")
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
    tabs: &[TabSummary],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    anchor: Option<&ScrollAnchor>,
    render_key: Option<u64>,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, document, render_key);
    let anchor = match anchor {
        Some(anchor) => scroll_anchor_json(anchor),
        None => "null".to_string(),
    };
    workspace_call("window.leafSwitchTab", &state, &format!(", {anchor});"))
}

/// `leafSwitchTabCached(<state>, <anchor>, <key>);` — a switch carrying no document at all. The page holds the layout this key names and puts it back; it asks for the whole thing where it does not.
pub fn workspace_cached_switch_script(
    recent: &[PathBuf],
    favorites: &Favorites,
    tabs: &[TabSummary],
    active: Option<usize>,
    anchor: Option<&ScrollAnchor>,
    render_key: u64,
) -> String {
    let state = workspace_payload(recent, favorites, tabs, active, None, Some(render_key));
    let anchor = match anchor {
        Some(anchor) => scroll_anchor_json(anchor),
        None => "null".to_string(),
    };
    let key = serde_json::to_string(&format!("{render_key:016x}")).expect("render key serializes");
    workspace_call(
        "window.leafSwitchTabCached",
        &state,
        &format!(", {anchor}, {key});"),
    )
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

/// The sentence a reader is shown when an edit did not land. Composed apart from the growl because a sender waiting on the answer says it in its own corner, and the two must be the same words rather than a sentence and a fragment of one.
pub fn edit_refused_words(document: &str, why: &str) -> String {
    format!("{document} was not changed: {why}.")
}

/// Say an edit did not land, and which document it was aimed at. A failure growl composes its value into the sentence: the document it names is the one that was **not** written, so there is nothing there to press.
pub fn edit_refused_script(document: &str, why: &str) -> String {
    error_toast_script(&edit_refused_words(document, why))
}

/// The sentence for a change the buffer took and the file did not. Its own words because `edit_refused_words` says nothing was changed, which is false here: the reader is looking at a real change with an unwritten file behind it, and telling them nothing happened would send them off to make it again.
pub fn edit_unsaved_words(document: &str, why: &str) -> String {
    format!("{document} was changed and not saved: {why}.")
}

/// The same, for something that worked and names no file: silence reads as nothing having happened. A growl naming a file uses `file_written_notice_script` instead, so its path reaches the page as a press.
pub fn notice_toast_script(message: &str) -> String {
    let message = serde_json::to_string(message).expect("toast message serializes");
    format!("window.leafShowNotice({message});")
}

/// Say a file was written, and where. The path travels as its own value rather than inside the sentence, because the page draws it as a press: the file just written is opened from the growl instead of gone looking for.
pub fn file_written_notice_script(path: &str) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    format!("window.leafFileWritten({path});")
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

/// Tells the page to refresh remembered link answers.
pub fn age_link_previews_script() -> String {
    "window.leafAgeLinkPreviews();".to_string()
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
    // The host's half of a source-editor landing: a returning tab or a launch rides along as a 0..1 scroll fraction, `0` among them, since a saved place at the top is still a place. Omitted otherwise, which tells the page to use its own — the line the toggle was reading on a fresh entry, and the fraction off the editor it is replacing on an in-place rebuild.
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

/// Re-sync the reading view's editing state from the buffer: task-marker offsets in document order, dirty state, whether a step exists in either direction of the history, and optionally the buffer text for block editors. Pass `source: None` when a full re-render already delivered the same text, to avoid shipping it twice.
pub fn blocks_resynced_script(
    tasks: &[usize],
    dirty: bool,
    can_undo: bool,
    can_redo: bool,
    source: Option<&str>,
) -> String {
    let state = serde_json::json!({
        "tasks": tasks,
        "dirty": dirty,
        "canUndo": can_undo,
        "canRedo": can_redo,
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

/// Answer an edit for whoever is waiting on it. `token` is the sender that asked — an answer to something nobody is holding is ignored, the way the image picker's is — and `why` is the sentence to say, where there is one.
///
/// `written` means the buffer holds the change, not that it reached the disk. That is what a sender needs to know: a checkbox drew itself ticked before this went out, so it puts its own tick back only where nothing is held — and a sentence rides a true `written` whenever the buffer took the change and the file refused it.
pub fn edit_answered_script(token: u64, written: bool, why: Option<&str>) -> String {
    let why = serde_json::to_string(&why).expect("reason serializes");
    format!("window.leafEditAnswered({token}, {written}, {why});")
}

/// Hand the page the path a diagram is to be written to. `token` is the export that opened the window — the page reads the format off the path's own ending and encodes only that one, which is why nothing is drawn before this answer arrives.
pub fn diagram_path_picked_script(token: u64, path: &str) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    format!("window.leafDiagramPathPicked({token}, {path});")
}

/// Hand the page the path a picture is to be written to. `token` is the export that opened the window — the page reads the format off the path's own ending and does only that one, which is why nothing is drawn or copied before this answer arrives.
pub fn picture_path_picked_script(token: u64, path: &str) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    format!("window.leafPicturePathPicked({token}, {path});")
}

/// Ask the page for the document it has already drawn, so it can be written out as a web page at `path`.
///
/// The page is what cleans the markup, because the page is what knows which of its own elements are controls, and it is what holds the drawings' own stylesheet. It answers with `exportPageHtml`.
pub fn page_html_export_script(path: &str) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    format!("window.leafExportPageHtml({path});")
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

/// Answer a hover tooltip's delayed `previewLink` request with already-sanitized document HTML.
pub fn link_preview_script(token: u64, html: &str) -> String {
    format!("window.leafLinkPreview({token}, {html:?});")
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
