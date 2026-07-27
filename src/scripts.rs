use crate::store::{DocumentGraph, SearchHit, Vault};
use crate::*;

/// A JSON value as a `JSON.parse("…")` expression rather than a JavaScript object
/// literal. Same bytes to us, very different work for the web view: a literal goes
/// through the JavaScript parser, the string through the much smaller JSON reader —
/// 236 ms against 38 ms for a 4 MB glossary's state. The document payloads are the
/// only ones here big enough for it to matter.
fn json_parse_expr(value: &serde_json::Value) -> String {
    let json = value.to_string();
    // `serde_json` escapes quotes, backslashes and control characters, so this is
    // already a valid JS string literal. U+2028/U+2029 are the exception it leaves
    // bare — legal in JSON, line terminators to some JS parsers — so spell them out.
    let literal = serde_json::to_string(&json)
        .unwrap_or_else(|_| "\"{}\"".to_string())
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    format!("JSON.parse({literal})")
}

/// `f(<state>);`, with the state handed over via [`json_parse_expr`].
fn call_with_json(function: &str, value: &serde_json::Value) -> String {
    format!("{function}({});", json_parse_expr(value))
}

/// Initial workspace state as `window.__leafInitialState`. Run as an init
/// script (before any page script) so the boot bootstrap applies it on the
/// first render.
pub fn initial_state_script(recent: &[PathBuf]) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "document": serde_json::Value::Null,
    });
    format!("window.__leafInitialState = {};", state)
}

/// Persisted UI toggles as `window.__leafSettings`. Run as an init script so
/// theme and library pane render from saved state on the first paint. Keys are
/// camelCase to match the frontend, not the snake_case on-disk format.
pub fn initial_settings_script(settings: &Settings) -> String {
    let state = serde_json::json!({
        "minimapEnabled": settings.minimap_enabled,
        "pagerEnabled": settings.pager_enabled,
        "speedReaderEnabled": settings.speed_reader_enabled,
        "lineNumbersEnabled": settings.line_numbers_enabled,
        "themeFamily": settings.theme_family,
        "themeMode": settings.theme_mode,
        "themeRandomUsed": settings.theme_random_used,
        "graphScope": settings.graph_scope.as_str(),
        "libraryProjectPath": settings.library_project_path,
        "libraryClosed": settings.library_closed,
        "libraryWidth": settings.library_width,
        "updateLastChecked": settings.update_last_checked,
        "updateStagedVersion": settings.update_staged_version,
    });
    format!("window.__leafSettings = {};", state)
}

/// The link graph, for the graph view. Every string is file-derived and
/// untrusted; the page escapes them before they reach a label.
pub fn graph_script(graph: &DocumentGraph) -> String {
    let payload = serde_json::json!({
        "nodes": graph.nodes,
        "edges": graph.edges,
        "truncated": graph.truncated,
        "error": serde_json::Value::Null,
    });
    format!("window.leafSetGraph({payload});")
}

/// Ranked search results. The query is echoed so the page can drop an answer to
/// a query the field has already moved on from.
pub fn search_results_script(query: &str, hits: &[SearchHit]) -> String {
    let payload = serde_json::json!({
        "query": query,
        "hits": hits,
        "error": serde_json::Value::Null,
    });
    format!("window.leafSetSearchResults({payload});")
}

/// One folder's contents, for the library pane. Every string in it is
/// file-derived and untrusted; the page escapes them before the DOM.
pub fn library_folder_script(listing: &FolderListing) -> String {
    let payload = serde_json::to_string(listing).unwrap_or_else(|_| "null".to_string());
    format!("window.leafSetLibraryFolder({payload});")
}

/// The vault registry as `window.__leafVaults`. An init script, like the other
/// seeded state, so the leftmost crumb reads the active vault's name on the
/// first paint instead of flashing "Library" and correcting itself.
pub fn initial_vaults_script(vaults: &[Vault], active: i64) -> String {
    format!("window.__leafVaults = {};", vaults_payload(vaults, active))
}

/// The same registry, pushed after a change (a vault added, or switched to).
pub fn vaults_script(vaults: &[Vault], active: i64) -> String {
    format!("window.leafSetVaults({});", vaults_payload(vaults, active))
}

/// Vault names are folder names — user text — so the page escapes them before
/// the DOM.
fn vaults_payload(vaults: &[Vault], active: i64) -> serde_json::Value {
    serde_json::json!({ "vaults": vaults, "active": active })
}

/// The running app version as `window.__leafVersion`. Run as an init script so
/// the frontend's update check can compare it against the latest GitHub release.
pub fn initial_version_script() -> String {
    format!(
        "window.__leafVersion = {};",
        serde_json::json!(env!("CARGO_PKG_VERSION"))
    )
}

/// Which release asset this build can install, as a file-name suffix, so the
/// page can pick its own platform's installer out of the release. Empty on a
/// build with no installable artifact, which the page reads as notify-only.
pub fn initial_update_script() -> String {
    format!(
        "window.__leafUpdateAsset = {};",
        serde_json::json!(crate::platform_asset_suffix())
    )
}

/// How the last install attempt ended, as `window.__leafUpdateApply`, or `null`
/// when there is nothing to report. The page turns a failure into a line in the
/// settings panel — the only place a detached installer's error can surface.
pub fn initial_apply_outcome_script(outcome: Option<&crate::ApplyOutcome>) -> String {
    let value = match outcome {
        Some(outcome) => serde_json::json!({
            "version": outcome.version,
            "ok": outcome.ok,
            "message": outcome.message,
        }),
        None => serde_json::Value::Null,
    };
    format!("window.__leafUpdateApply = {value};")
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

/// Full workspace state: recent files, tab bar (title + path), active tab
/// index (`null` on the home screen), and active document (`null` on home).
pub fn workspace_state_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    call_with_json("window.leafSetState", &state)
}

/// Tabs, recents and the active index with no document. The code view renders
/// itself from [`code_view_script`], so the state script never runs for a tab
/// showing source — this is how such a tab still gets its entry in the strip and
/// gives the page an active document to name.
pub fn workspace_only_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
    });
    format!("window.leafSetWorkspace({});", state)
}

/// Like [`workspace_state_script`] but via `leafReloadDocument`, which
/// re-renders in place and preserves scroll position. Used by live-reload.
pub fn workspace_reload_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    call_with_json("window.leafReloadDocument", &state)
}

/// A document-intrinsic scroll position that survives a full re-render (tab
/// switch, history nav, live reload). Names the nearest heading above the top
/// edge, the block ordinal within that section, and the offset into it —
/// unlike a raw pixel offset, which drifts as images settle the layout.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScrollAnchor {
    /// Heading slug the position sits under; `None` above the first heading.
    #[serde(default)]
    pub section: Option<String>,
    /// Zero-based block index within the section (the heading itself is 0).
    #[serde(default)]
    pub block: u32,
    /// Signed offset of the top edge from the block's top; signed so the
    /// reading-mode top gap survives at the start of a document.
    #[serde(default, rename = "offsetY")]
    pub offset_y: f64,
}

/// Serialize an anchor to the JS object literal the webview restore hooks expect.
fn scroll_anchor_json(anchor: &ScrollAnchor) -> String {
    serde_json::to_string(anchor)
        .unwrap_or_else(|_| r#"{"section":null,"block":0,"offsetY":0}"#.to_string())
}

/// Like [`workspace_state_script`] but via `leafSwitchTab`, which renders the
/// target tab and restores `anchor` in the same frame so the switch never
/// snaps to the top. `anchor` is `None` the first time a tab is opened.
pub fn workspace_switch_script(
    recent: &[PathBuf],
    tabs: &[(String, String)],
    active: Option<usize>,
    document: Option<&OpenedDocument>,
    anchor: Option<&ScrollAnchor>,
) -> String {
    let recent: Vec<String> = recent
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let tabs: Vec<serde_json::Value> = tabs
        .iter()
        .map(|(title, path)| serde_json::json!({ "title": title, "path": path }))
        .collect();
    let state = serde_json::json!({
        "recent": recent,
        "tabs": tabs,
        "active": active,
        "document": document,
    });
    let anchor = match anchor {
        Some(anchor) => scroll_anchor_json(anchor),
        None => "null".to_string(),
    };
    // Same `JSON.parse` hand-off as the other document payloads; the anchor is a
    // handful of bytes and stays a literal.
    format!(
        "window.leafSwitchTab({}, {anchor});",
        json_parse_expr(&state)
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

/// Show a glossary term in the bottom sheet. `body_html` is the fully rendered
/// glossary document; the page extracts the entry whose heading id is `anchor`
/// and slides the sheet up over the current document.
pub fn glossary_sheet_script(body_html: &str, anchor: &str) -> String {
    let body_html = serde_json::to_string(body_html).expect("glossary html serializes");
    let anchor = serde_json::to_string(anchor).expect("glossary anchor serializes");
    format!("window.leafShowGlossary({body_html}, {anchor});")
}

/// Tell the page a lookup produced nothing: the sheet is already up on a spinner
/// by the time the host reads, so silence would leave it spinning. `reason` is
/// `missing` (no glossary file near the document) or `failed`.
pub fn glossary_failed_script(reason: &str) -> String {
    let reason = serde_json::to_string(reason).expect("glossary reason serializes");
    format!("window.leafGlossaryFailed({reason});")
}

/// Re-fetch the local images on screen. Sent when an image file changes: nothing
/// to re-render, but the web view would otherwise keep the copy it decoded.
pub fn image_refresh_script() -> String {
    "window.leafRefreshImages();".to_string()
}

/// Restore a saved scroll anchor in the current document without re-rendering.
/// Used by Back/Forward when the jump stays within the same document.
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

/// Swap to the raw-source code view: highlighted source (the layer behind the
/// textarea), the buffer text, language token and label, and dirty state.
pub fn code_view_script(
    highlighted_html: &str,
    text: &str,
    language: &str,
    display_name: &str,
    dirty: bool,
    scroll_fraction: Option<f64>,
) -> String {
    let mut state = serde_json::json!({
        "html": highlighted_html,
        "text": text,
        "language": language,
        "displayName": display_name,
        "dirty": dirty,
    });
    // A restored position (returning to a tab left in code view) rides along as
    // a 0..1 scroll fraction; omit it entirely otherwise so the page keeps its
    // own placement (fresh toggle, in-place live reload).
    if let Some(fraction) = scroll_fraction {
        state["scrollFraction"] = serde_json::json!(fraction);
    }
    format!("window.leafShowCodeView({});", state)
}

/// Refresh the code view's highlight overlay and dirty state after a debounced
/// re-highlight. Leaves the textarea untouched.
pub fn source_updated_script(highlighted_html: &str, dirty: bool) -> String {
    let state = serde_json::json!({
        "html": highlighted_html,
        "dirty": dirty,
    });
    format!("window.leafSourceUpdated({});", state)
}

/// Re-sync the reading view's editing state from the buffer: task-marker
/// offsets in document order, dirty state, whether an undo step exists, and
/// optionally the buffer text for block editors. Pass `source: None` when a
/// full re-render already delivered the same text, to avoid shipping it twice.
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

/// Report the outcome of a save for `path`: `error` is null on success and a
/// message string when the write failed.
pub fn save_result_script(path: &str, ok: bool, error: Option<&str>) -> String {
    let path = serde_json::to_string(path).expect("path serializes");
    let error = match error {
        Some(message) => serde_json::to_string(message).expect("error serializes"),
        None => "null".to_string(),
    };
    format!("window.leafSaved({path}, {ok}, {error});")
}

/// Answer a hover tooltip's `countLines` request for `token`. A negative count
/// means "unknown" (not a readable local document); the page shows no count.
pub fn line_count_script(token: u64, lines: i64) -> String {
    format!("window.leafLineCount({token}, {lines});")
}

/// Tell the page how a download ended: `staged` when an installer is verified
/// and waiting, `failed` with a reason otherwise.
pub fn update_state_script(status: &str, version: &str, message: Option<&str>) -> String {
    let state = serde_json::json!({
        "status": status,
        "version": version,
        "message": message,
    });
    format!("window.leafUpdateState({});", state)
}

/// Move the download's progress bar, 0-100. Separate from `update_state_script`
/// because it fires a hundred times a download and carries no message to read.
pub fn update_progress_script(version: &str, percent: u8) -> String {
    let state = serde_json::json!({
        "status": "downloading",
        "version": version,
        "percent": percent,
    });
    format!("window.leafUpdateState({});", state)
}
