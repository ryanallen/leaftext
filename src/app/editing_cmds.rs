//! Turning an edit into a buffer change, and a buffer into a saved file.

use super::*;

/// The scheme the page fetches the code view's payload over.
pub(crate) const SOURCE_PAYLOAD_PROTOCOL: &str = "leaf-source";

/// The code view's payload, staged for the page to fetch rather than pushed to it.
///
/// `evaluate_script` hands the whole script across WebView2's process boundary, which was 4.4s of a 4 MB source's 8.8s entry — and `JSON.parse` instead of an object literal changed nothing, because the cost is the crossing, not the parse.
static PENDING_SOURCE_PAYLOAD: std::sync::Mutex<Option<(u64, Vec<u8>)>> =
    std::sync::Mutex::new(None);
static SOURCE_PAYLOAD_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// One staged payload, served over [`SOURCE_PAYLOAD_PROTOCOL`].
pub(crate) struct SourcePayload {
    pub(crate) status: u16,
    pub(crate) content_type: &'static str,
    /// A different origin from the page, so without this the fetch is refused before the first byte — the way GitHub's asset host defeats the updater. Wildcard is safe: the scheme only exists inside this webview's own request interception.
    pub(crate) allow_origin: &'static str,
    pub(crate) body: Vec<u8>,
}

/// Stage `json` and return the URL that serves it. Each call supersedes the last, so at most one payload is held.
pub(crate) fn stage_source_payload(json: String) -> String {
    let id = SOURCE_PAYLOAD_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if let Ok(mut slot) = PENDING_SOURCE_PAYLOAD.lock() {
        *slot = Some((id, json.into_bytes()));
    }
    source_payload_url(SOURCE_PAYLOAD_PROTOCOL, id)
}

/// Resolve a payload request. Kept rather than taken, so a retried fetch still finds it; the next code-view entry replaces it.
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

/// Render a tab's reading view from its edit buffer, so unsaved edits show. The buffer's format came from its path, so the shared router picks the same renderer an initial open would have.
pub(crate) fn reading_document_from_buffer(edit: &EditableDocument, path: &Path) -> OpenedDocument {
    opened_document_from_source(edit.text(), path)
}

/// The active tab's edit buffer, seeded from disk the first time; re-entry reuses it so unsaved edits survive. `what` names the caller in the error line. Also returns the tab's index.
fn seeded_active_edit<'a>(
    workspace: &'a mut Workspace,
    what: &str,
) -> Option<(usize, &'a mut EditableDocument)> {
    let (index, path) = active_tab_path(workspace)?;
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match read_source(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("{what}: failed to read {}: {error}", path.display());
                return None;
            }
        }
    } else {
        SourceText::utf8(String::new())
    };
    let tab = workspace.tabs.get_mut(index)?;
    Some((index, tab.edit_buffer(&path, contents)))
}

/// Swap the active document to the code view. Seeds the edit buffer from disk the first time, then hands the webview the highlighted source, buffer text, language, and dirty state.
pub(crate) fn enter_code_view(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    scroll_fraction: Option<f64>,
) {
    let Some((index, edit)) = seeded_active_edit(workspace, "Code view") else {
        return;
    };
    // Building the editor on a big source takes a while; the code-view script clears the spinner once it is on screen.
    begin_reader_loading(webview);
    let text = edit.text().to_string();
    let language = edit.format.language_token().to_string();
    let display = edit.format.display_name().to_string();
    let dirty = edit.is_dirty();

    let url = stage_source_payload(code_view_payload(
        &text,
        &language,
        &display,
        dirty,
        scroll_fraction,
    ));
    run_page_script(
        webview,
        &code_view_fetch_script(&url),
        "Code view: failed to show source",
    );
    if let Some(tab) = workspace.tabs.get_mut(index) {
        tab.code_view = true;
    }
}

/// Apply a code-view edit expressed as the range it replaced.
///
/// The page sends the change instead of the buffer (see `sourceSpliceSince`), which is the difference between a few bytes and 4 MB of IPC per typing pause. `length` is what the page believes the buffer now measures in UTF-16 units; if ours disagrees the two copies have drifted, and rather than splice into a buffer we no longer understand we ask the page to resend the whole thing.
pub(crate) fn splice_source_buffer(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    start: usize,
    removed: usize,
    inserted: &str,
    length: usize,
) {
    let Some(edit) = workspace.active_edit_mut() else {
        return;
    };
    edit.splice_utf16_without_undo(start, removed, inserted);

    if edit.utf16_len() != length {
        eprintln!("Code view: buffer drifted from the page; asking for a full resend");
        run_page_script(
            webview,
            "window.leafResyncSource();",
            "Code view: failed to request a resync",
        );
        return;
    }

    let dirty = edit.is_dirty();
    run_page_script(
        webview,
        &source_updated_script(dirty),
        "Code view: failed to refresh source",
    );
}

/// Apply a debounced code-view edit to the buffer, then refresh the dirty state.
pub(crate) fn update_source_buffer(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    text: String,
) {
    let Some(edit) = workspace.active_edit_mut() else {
        return;
    };
    edit.set_text(text);
    let dirty = edit.is_dirty();
    run_page_script(
        webview,
        &source_updated_script(dirty),
        "Code view: failed to refresh source",
    );
}

/// Whether a save can go ahead, and whether the document was named on the way.
pub(crate) enum SaveReady {
    /// The document already had a file.
    Ready,
    /// It has just been given one, so everything that names it - the tab strip, the window title, the folder images resolve against - is now stale.
    Named,
    /// The dialog was closed without choosing. Nothing was written.
    Canceled,
}

/// Give the active document a file if it hasn't got one, asking where through `ask`. The first save of a new document is a Save As; every other save walks straight past this.
pub(crate) fn name_untitled_document(
    reader: &mut Reader,
    ask: impl FnOnce(&Path) -> Option<PathBuf>,
) -> SaveReady {
    let Some(edit) = reader.workspace.active_edit() else {
        return SaveReady::Ready;
    };
    if !edit.untitled {
        return SaveReady::Ready;
    }
    let Some(chosen) = ask(&edit.path) else {
        return SaveReady::Canceled;
    };
    let Some(index) = reader.workspace.active else {
        return SaveReady::Canceled;
    };
    if let Some(tab) = reader.workspace.tabs.get_mut(index) {
        if let Some(edit) = tab.edit.as_mut() {
            edit.adopt_path(chosen.clone());
        }
        tab.history.replace_current(chosen.clone());
        tab.title = tab_title_from_path(&chosen);
        // Cached under the old name, and the render reads the buffer anyway.
        tab.rendered = None;
    }
    // No unlock to carry onto the new name: the padlock is a setting, not a fact about a path.
    reader.record_recent(chosen);
    SaveReady::Named
}

/// Write the active tab's edit buffer to disk. Sets the watcher's content hash to the written text so its own FileChanged for this save is a no-op.
pub(crate) fn save_active_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
) {
    let Some(edit) = workspace.active_edit_mut() else {
        return;
    };
    let path = edit.path.clone();
    let text = edit.text().to_string();
    let path_str = path.display().to_string();

    let script = match write_source(&path, &text, edit.spelling) {
        Ok(()) => {
            edit.mark_saved();
            // Self-save suppression: reload_active_document skips when the hash matches, so our own write-back FileChanged won't clobber the buffer.
            file_watch.active_hash = Some(content_hash(&text));
            save_result_script(&path_str, true, None)
        }
        Err(error) => {
            let message = error.to_string();
            eprintln!("Save failed for {}: {message}", path.display());
            save_result_script(&path_str, false, Some(&message))
        }
    };

    run_page_script(webview, &script, "Save: failed to report result");
}

/// Seed the edit buffer from disk on the first edit, then splice a reading-view inline edit over `[start, end)`. Returns whether a buffer was available (the caller re-renders from the now-authoritative buffer when so).
pub(crate) fn apply_block_edit(
    workspace: &mut Workspace,
    start: usize,
    end: usize,
    text: &str,
    record_undo: bool,
) -> bool {
    let Some((_, edit)) = seeded_active_edit(workspace, "Edit block") else {
        return false;
    };
    if record_undo {
        edit.replace_range(start, end, text);
    } else {
        edit.replace_range_without_undo(start, end, text);
    }
    true
}

/// Seed the edit buffer, then drag-reorder a run of sibling blocks in it. One undo step, like any other reading-view edit. Returns whether the buffer moved (the caller re-renders when so); a range list the buffer can't trust moves nothing.
pub(crate) fn apply_block_move(
    workspace: &mut Workspace,
    ranges: &[(usize, usize)],
    from: usize,
    to: usize,
) -> bool {
    let Some((_, edit)) = seeded_active_edit(workspace, "Move block") else {
        return false;
    };
    edit.move_blocks(ranges, from, to)
}

/// Write the active buffer to disk for an auto-saving edit (a checkbox toggle): no Save-button round-trip. The version bump plus watcher-hash update keep our own write from bouncing back through the file watcher as an external change.
pub(crate) fn autosave_active_buffer(workspace: &mut Workspace, file_watch: &mut FileWatch) {
    let Some(edit) = workspace.active_edit_mut() else {
        return;
    };
    let text = edit.text().to_string();
    match write_source(&edit.path, &text, edit.spelling) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        Err(error) => eprintln!("Auto-save failed for {}: {error}", edit.path.display()),
    }
}

/// Toggle a task-list checkbox from the reading view. Seeds the tab's edit buffer from disk on the first edit, flips the marker, writes it straight to disk, then reports the refreshed task offsets and dirty state so the reading view stays in sync without a full re-render — the checkbox's own checked state is already flipped in the DOM by the frontend. A checkbox toggle auto-saves and records no undo step, so it works even with reading-view editing turned off.
pub(crate) fn toggle_task_marker(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
) {
    let Some((_, edit)) = seeded_active_edit(workspace, "Toggle task") else {
        return;
    };
    edit.toggle_task_without_undo(index);
    let text = edit.text().to_string();
    match write_source(&edit.path, &text, edit.spelling) {
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

    // A toggle doesn't re-render, so carry the toggled source for the reader's raw-source editors to slice from.
    run_page_script(
        webview,
        &blocks_resynced_script(&tasks, dirty, can_undo, Some(&text)),
        "Toggle task: failed to resync reading view",
    );
}

/// Push the buffer's editing state (task offsets, dirty, undo availability) back to the reading view. The source is omitted since the caller's re-render already delivered it.
pub(crate) fn resync_editing_state(webview: Option<&WebView>, workspace: &Workspace) {
    let Some(edit) = workspace.active_edit() else {
        return;
    };
    run_page_script(
        webview,
        &blocks_resynced_script(&edit.task_offsets(), edit.is_dirty(), edit.can_undo(), None),
        "Editing: failed to resync reading view",
    );
}
