use crate::*;

/// The initial workspace state as a `window.__leafInitialState` global. Like
/// [`initial_settings_script`], this is run as the webview's initialization
/// script — before any page script — so the page's boot bootstrap can apply it
/// on the first render. Injecting it after load via `evaluate_script` raced the
/// async page load: when the page won the race it ran its own empty bootstrap
/// last, wiping out the recent files.
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

/// The persisted UI toggles as a `window.__leafSettings` global. This is run as
/// the webview's initialization script — before any page script — so the theme
/// bootstrap and library pane render from the saved state on the first paint
/// instead of flashing defaults and re-applying. Keys are camelCase to match
/// what the frontend reads, independent of the snake_case on-disk format.
pub fn initial_settings_script(settings: &Settings) -> String {
    let state = serde_json::json!({
        "minimapEnabled": settings.minimap_enabled,
        "indexingEnabled": settings.indexing_enabled,
        "pagerEnabled": settings.pager_enabled,
        "speedReaderEnabled": settings.speed_reader_enabled,
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

/// Build the full workspace state for the webview: recent files, the open tab
/// bar (title + path per tab), the active tab index (or `null` for the home
/// screen), and the active document (or `null` when the home screen is shown).
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

/// Like [`workspace_state_script`], but routes through `leafReloadDocument` so the
/// webview re-renders the active document in place while preserving the reader's
/// current scroll position. Used by the live-reload watcher when the open file
/// changes on disk, where jumping back to the top would be jarring.
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

/// A document-intrinsic scroll position. Instead of a raw pixel offset — which
/// points at different content every time the document is re-rendered and its
/// images settle the layout — this names the nearest heading slug above the
/// reader's top edge, the ordinal of the block within that section, and how far
/// through that block the reader has scrolled. The same Markdown always renders
/// the same blocks, so this survives a full re-render: switching tabs, history
/// navigation, and live reload all land back on the same paragraph.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScrollAnchor {
    /// Heading slug the position sits under; `None` above the first heading.
    #[serde(default)]
    pub section: Option<String>,
    /// Zero-based block index within the section (the heading itself is 0).
    #[serde(default)]
    pub block: u32,
    /// Signed pixel offset of the reader's top edge from the block's top. Stays
    /// signed so the reading-mode top gap survives at the start of a document.
    #[serde(default, rename = "offsetY")]
    pub offset_y: f64,
}

/// Serialize an anchor to the JS object literal the webview restore hooks expect.
fn scroll_anchor_json(anchor: &ScrollAnchor) -> String {
    serde_json::to_string(anchor)
        .unwrap_or_else(|_| r#"{"section":null,"block":0,"offsetY":0}"#.to_string())
}

/// Like [`workspace_state_script`], but routes through `leafSwitchTab` so the
/// webview renders the target tab's document and then restores the saved scroll
/// anchor in the same frame. Switching tabs must never snap to the top, and
/// restoring as part of the render avoids racing the reset-to-top that
/// `leafSetState` performs. `anchor` is `None` the first time a tab is opened,
/// which lands the reader at the top of the content.
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

/// Answer a hover tooltip's `countLines` request: hand the webview the line count
/// of the linked document for `token`. A negative count means "unknown" (the
/// target wasn't a readable local document), and the page just shows no count.
pub fn line_count_script(token: u64, lines: i64) -> String {
    format!("window.leafLineCount({token}, {lines});")
}
