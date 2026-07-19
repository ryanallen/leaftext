use crate::*;

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
        "indexingEnabled": settings.indexing_enabled,
        "pagerEnabled": settings.pager_enabled,
        "speedReaderEnabled": settings.speed_reader_enabled,
        "lineNumbersEnabled": settings.line_numbers_enabled,
        "readerEditingEnabled": settings.reader_editing_enabled,
        "themeFamily": settings.theme_family,
        "themeMode": settings.theme_mode,
        "libraryView": settings.library_view.as_str(),
        "graphScope": settings.graph_scope.as_str(),
        "libraryExpanded": settings.library_expanded,
        "libraryProjectPath": settings.library_project_path,
        "libraryClosed": settings.library_closed,
        "libraryWidth": settings.library_width,
    });
    format!("window.__leafSettings = {};", state)
}

/// The running app version as `window.__leafVersion`. Run as an init script so
/// the frontend's update check can compare it against the latest GitHub release.
pub fn initial_version_script() -> String {
    format!(
        "window.__leafVersion = {};",
        serde_json::json!(env!("CARGO_PKG_VERSION"))
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
    format!("window.leafSetState({});", state)
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
    format!("window.leafSetState({});", state)
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
    format!("window.leafReloadDocument({});", state)
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

/// Show a glossary term in the bottom sheet. `body_html` is the fully rendered
/// glossary document; the page extracts the entry whose heading id is `anchor`
/// and slides the sheet up over the current document.
pub fn glossary_sheet_script(body_html: &str, anchor: &str) -> String {
    let body_html = serde_json::to_string(body_html).expect("glossary html serializes");
    let anchor = serde_json::to_string(anchor).expect("glossary anchor serializes");
    format!("window.leafShowGlossary({body_html}, {anchor});")
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
