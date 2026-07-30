//! Turning an edit into a buffer change, and a buffer into a saved file.

use super::*;

/// The scheme the page fetches the code view's payload over.
pub(crate) const SOURCE_PAYLOAD_PROTOCOL: &str = "leaf-source";

/// The code view's payload, staged for the page to fetch rather than pushed to it.
///
/// `evaluate_script` hands the whole script across WebView2's process boundary,
/// which was 4.4s of a 4 MB source's 8.8s entry — and `JSON.parse` instead of an
/// object literal changed nothing, because the cost is the crossing, not the parse.
static PENDING_SOURCE_PAYLOAD: std::sync::Mutex<Option<(u64, Vec<u8>)>> =
    std::sync::Mutex::new(None);
static SOURCE_PAYLOAD_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// One staged payload, served over [`SOURCE_PAYLOAD_PROTOCOL`].
pub(crate) struct SourcePayload {
    pub(crate) status: u16,
    pub(crate) content_type: &'static str,
    /// A different origin from the page, so without this the fetch is refused before
    /// the first byte — the way GitHub's asset host defeats the updater. Wildcard is
    /// safe: the scheme only exists inside this webview's own request interception.
    pub(crate) allow_origin: &'static str,
    pub(crate) body: Vec<u8>,
}

/// Stage `json` and return the URL that serves it. Each call supersedes the last,
/// so at most one payload is held.
pub(crate) fn stage_source_payload(json: String) -> String {
    let id = SOURCE_PAYLOAD_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if let Ok(mut slot) = PENDING_SOURCE_PAYLOAD.lock() {
        *slot = Some((id, json.into_bytes()));
    }
    source_payload_url(SOURCE_PAYLOAD_PROTOCOL, id)
}

/// Resolve a payload request. Kept rather than taken, so a retried fetch still
/// finds it; the next code-view entry replaces it.
pub(crate) fn source_payload_response(uri: &str) -> SourcePayload {
    let wanted = uri.rsplit('/').next().and_then(|id| id.parse::<u64>().ok());
    let body = match (wanted, PENDING_SOURCE_PAYLOAD.lock()) {
        (Some(wanted), Ok(slot)) => match slot.as_ref() {
            Some((id, body)) if *id == wanted => Some(body.clone()),
            _ => None,
        },
        _ => None,
    };
    match body {
        Some(body) => SourcePayload {
            status: 200,
            content_type: "application/json; charset=utf-8",
            allow_origin: "*",
            body,
        },
        None => SourcePayload {
            status: 404,
            content_type: "text/plain; charset=utf-8",
            allow_origin: "*",
            body: Vec::new(),
        },
    }
}

/// Render a tab's reading view from its edit buffer, so unsaved edits show.
/// The buffer's format came from its path, so the shared router picks the same
/// renderer an initial open would have.
pub(crate) fn reading_document_from_buffer(edit: &EditableDocument, path: &Path) -> OpenedDocument {
    opened_document_from_source(edit.text(), path)
}

/// Swap the active document to the code view. Seeds the edit buffer from disk
/// the first time, then hands the webview the highlighted source, buffer text,
/// language, and dirty state.
pub(crate) fn enter_code_view(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    scroll_fraction: Option<f64>,
) {
    let Some((index, path)) = active_tab_path(workspace) else {
        return;
    };

    // Read the file only when there's no buffer for this document yet; re-entry
    // reuses the buffer so unsaved edits survive.
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Code view: failed to read {}: {error}", path.display());
                return;
            }
        }
    } else {
        String::new()
    };

    let Some(tab) = workspace.tabs.get_mut(index) else {
        return;
    };
    // Building the editor on a big source takes a while; the code-view script
    // clears the spinner once it is on screen.
    begin_reader_loading(webview);
    let edit = tab.edit_buffer(&path, contents);
    let text = edit.text().to_string();
    let language = edit.format.language_token().to_string();
    let display = edit.format.display_name().to_string();
    let dirty = edit.is_dirty();

    if let Some(webview) = webview {
        let url = stage_source_payload(code_view_payload(
            &text,
            &language,
            &display,
            dirty,
            scroll_fraction,
        ));
        if let Err(error) = webview.evaluate_script(&code_view_fetch_script(&url)) {
            eprintln!("Code view: failed to show source: {error}");
        }
    }
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.code_view = true;
    }
}

/// Apply a code-view edit expressed as the range it replaced.
///
/// The page sends the change instead of the buffer (see `sourceSpliceSince`),
/// which is the difference between a few bytes and 4 MB of IPC per typing pause.
/// `length` is what the page believes the buffer now measures in UTF-16 units; if
/// ours disagrees the two copies have drifted, and rather than splice into a
/// buffer we no longer understand we ask the page to resend the whole thing.
pub(crate) fn splice_source_buffer(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    start: usize,
    removed: usize,
    inserted: &str,
    length: usize,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    edit.splice_utf16_without_undo(start, removed, inserted);

    if edit.utf16_len() != length {
        eprintln!("Code view: buffer drifted from the page; asking for a full resend");
        if let Some(webview) = webview {
            if let Err(error) = webview.evaluate_script("window.leafResyncSource();") {
                eprintln!("Code view: failed to request a resync: {error}");
            }
        }
        return;
    }

    let dirty = edit.is_dirty();
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&source_updated_script(dirty)) {
            eprintln!("Code view: failed to refresh source: {error}");
        }
    }
}

/// Apply a debounced code-view edit to the buffer, then refresh the dirty state.
pub(crate) fn update_source_buffer(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    text: String,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    edit.set_text(text);
    let dirty = edit.is_dirty();
    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&source_updated_script(dirty)) {
            eprintln!("Code view: failed to refresh source: {error}");
        }
    }
}

/// Write the active tab's edit buffer to disk. Sets the watcher's content hash
/// to the written text so its own FileChanged for this save is a no-op.
pub(crate) fn save_active_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
) {
    let Some(index) = workspace.active else {
        return;
    };
    let Some(edit) = workspace
        .tabs
        .get_mut(index)
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    let path = edit.path.clone();
    let text = edit.text().to_string();
    let path_str = path.display().to_string();

    let script = match fs::write(&path, &text) {
        Ok(()) => {
            edit.mark_saved();
            // Self-save suppression: reload_active_document skips when the hash
            // matches, so our own write-back FileChanged won't clobber the buffer.
            file_watch.active_hash = Some(content_hash(&text));
            save_result_script(&path_str, true, None)
        }
        Err(error) => {
            let message = error.to_string();
            eprintln!("Save failed for {}: {message}", path.display());
            save_result_script(&path_str, false, Some(&message))
        }
    };

    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("Save: failed to report result: {error}");
        }
    }
}

/// Seed the edit buffer from disk on the first edit, then splice a reading-view
/// inline edit over `[start, end)`. Returns whether a buffer was available (the
/// caller re-renders from the now-authoritative buffer when so).
pub(crate) fn apply_block_edit(
    workspace: &mut Workspace,
    start: usize,
    end: usize,
    text: &str,
    record_undo: bool,
) -> bool {
    let Some((tab_index, path)) = active_tab_path(workspace) else {
        return false;
    };
    let needs_seed = workspace
        .tabs
        .get(tab_index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Edit block: failed to read {}: {error}", path.display());
                return false;
            }
        }
    } else {
        String::new()
    };
    let Some(tab) = workspace.tabs.get_mut(tab_index) else {
        return false;
    };
    let edit = tab.edit_buffer(&path, contents);
    if record_undo {
        edit.replace_range(start, end, text);
    } else {
        edit.replace_range_without_undo(start, end, text);
    }
    true
}

/// Write the active buffer to disk for an auto-saving edit (a checkbox toggle):
/// no Save-button round-trip. The version bump plus watcher-hash update keep our
/// own write from bouncing back through the file watcher as an external change.
pub(crate) fn autosave_active_buffer(workspace: &mut Workspace, file_watch: &mut FileWatch) {
    let Some(edit) = workspace
        .active
        .and_then(|index| workspace.tabs.get_mut(index))
        .and_then(|tab| tab.edit.as_mut())
    else {
        return;
    };
    let text = edit.text().to_string();
    match fs::write(&edit.path, &text) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        Err(error) => eprintln!("Auto-save failed for {}: {error}", edit.path.display()),
    }
}

/// Toggle a task-list checkbox from the reading view. Seeds the tab's edit buffer
/// from disk on the first edit, flips the marker, writes it straight to disk, then
/// reports the refreshed task offsets and dirty state so the reading view stays in
/// sync without a full re-render — the checkbox's own checked state is already
/// flipped in the DOM by the frontend. A checkbox toggle auto-saves and records no
/// undo step, so it works even with reading-view editing turned off.
pub(crate) fn toggle_task_marker(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
) {
    let Some((tab_index, path)) = active_tab_path(workspace) else {
        return;
    };
    let needs_seed = workspace
        .tabs
        .get(tab_index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Toggle task: failed to read {}: {error}", path.display());
                return;
            }
        }
    } else {
        String::new()
    };
    let Some(tab) = workspace.tabs.get_mut(tab_index) else {
        return;
    };
    let edit = tab.edit_buffer(&path, contents);
    edit.toggle_task_without_undo(index);
    let text = edit.text().to_string();
    match fs::write(&edit.path, &text) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        Err(error) => eprintln!(
            "Toggle task: auto-save failed for {}: {error}",
            edit.path.display()
        ),
    }
    let tasks = edit.task_offsets();
    let dirty = edit.is_dirty();
    let can_undo = edit.can_undo();

    if let Some(webview) = webview {
        // A toggle doesn't re-render, so carry the toggled source for the
        // reader's raw-source editors to slice from.
        let script = blocks_resynced_script(&tasks, dirty, can_undo, Some(&text));
        if let Err(error) = webview.evaluate_script(&script) {
            eprintln!("Toggle task: failed to resync reading view: {error}");
        }
    }
}

/// Push the buffer's editing state (task offsets, dirty, undo availability) back
/// to the reading view. The source is omitted since the caller's re-render
/// already delivered it.
pub(crate) fn resync_editing_state(webview: Option<&WebView>, workspace: &Workspace) {
    let Some(webview) = webview else {
        return;
    };
    let Some(edit) = workspace
        .active
        .and_then(|index| workspace.tabs.get(index))
        .and_then(|tab| tab.edit.as_ref())
    else {
        return;
    };
    let script =
        blocks_resynced_script(&edit.task_offsets(), edit.is_dirty(), edit.can_undo(), None);
    if let Err(error) = webview.evaluate_script(&script) {
        eprintln!("Editing: failed to resync reading view: {error}");
    }
}
