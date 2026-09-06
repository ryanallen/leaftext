//! Desktop doors for the saved-view page controls.

use super::*;

fn deliver(state: &VaultState, page: Option<&WebView>) {
    let views = state
        .conn
        .as_ref()
        .and_then(|conn| leaftext::store::list_saved_views(conn, state.active).ok())
        .unwrap_or_default();
    let json = serde_json::to_string(&views).unwrap_or_else(|_| "[]".to_string());
    run_page_script(
        page,
        &format!("window.leafSetSavedViews({json});"),
        "Could not show saved views",
    );
}

pub(crate) fn save(state: &mut VaultState, page: Option<&WebView>, name: String, query: String) {
    if state.active == 0 || query.trim().is_empty() {
        return;
    }
    if let Some(conn) = state.conn.as_ref() {
        if let Err(error) = leaftext::store::save_view(
            conn,
            state.active,
            name.trim(),
            query.trim(),
            "list",
            r#"{"version":1}"#,
        ) {
            eprintln!("Could not save view: {error}");
        }
    }
    deliver(state, page);
}

pub(crate) fn delete(state: &mut VaultState, page: Option<&WebView>, id: i64) {
    if let Some(conn) = state.conn.as_ref() {
        let _ = leaftext::store::remove_saved_view(conn, state.active, id);
    }
    deliver(state, page);
}

pub(crate) fn move_view(state: &mut VaultState, page: Option<&WebView>, id: i64, position: i64) {
    if let Some(conn) = state.conn.as_ref() {
        if let Ok(mut view) = leaftext::store::list_saved_views(conn, state.active)
            .map(|views| views.into_iter().find(|view| view.id == id))
        {
            if let Some(mut view) = view.take() {
                view.position = position.max(0);
                let _ = leaftext::store::update_saved_view(conn, &view);
            }
        }
    }
    deliver(state, page);
}

pub(crate) fn run(state: &VaultState, page: Option<&WebView>, id: i64) {
    let query = state
        .conn
        .as_ref()
        .and_then(|conn| leaftext::store::list_saved_views(conn, state.active).ok())
        .and_then(|views| views.into_iter().find(|view| view.id == id))
        .map(|view| view.query);
    let results = query
        .as_deref()
        .and_then(|query| state.corpus.as_ref().map(|corpus| corpus.view(query)))
        .unwrap_or_default();
    let json = serde_json::to_string(&results).unwrap_or_else(|_| "null".to_string());
    run_page_script(
        page,
        &format!("window.leafSetSavedViewResults({json});"),
        "Could not show saved view",
    );
}

pub(crate) fn write_refused(
    page: Option<&WebView>,
    _path: String,
    _field: String,
    _value: String,
    _fingerprint: String,
) {
    run_page_script(
        page,
        "window.leafSavedViewWriteRefused('Editing a view field is not available yet.');",
        "Could not refuse saved-view write",
    );
}
