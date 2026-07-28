//! Turning an edit into a buffer change, and a buffer into a saved file.

use super::*;

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
    // Highlighting a big source takes a while; the code-view script clears it.
    begin_reader_loading(webview);
    let edit = tab.edit_buffer(&path, contents);
    let text = edit.text().to_string();
    let language = edit.format.language_token().to_string();
    let display = edit.format.display_name().to_string();
    let dirty = edit.is_dirty();
    // Last, and nothing touches `edit` after it: the memo hands back a borrow of
    // the cached markup rather than a fresh 26 MB copy.
    let highlighted = edit.source_view_html();

    if let Some(webview) = webview {
        if let Err(error) = webview.evaluate_script(&code_view_script(
            highlighted,
            &text,
            &language,
            &display,
            dirty,
            scroll_fraction,
        )) {
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
    let highlighted = (edit.text().len() <= MAX_LIVE_HIGHLIGHT_BYTES)
        .then(|| edit.source_view_html().to_string());
    if let Some(webview) = webview {
        if let Err(error) =
            webview.evaluate_script(&source_updated_script(highlighted.as_deref(), dirty))
        {
            eprintln!("Code view: failed to refresh source: {error}");
        }
    }
}

/// The largest buffer re-highlighted while you type. Measured: 16 KB costs 9 ms,
/// 256 KB ~380 ms, 4 MB 6.6 s. Ordinary source files sit far below it.
const MAX_LIVE_HIGHLIGHT_BYTES: usize = 256 * 1024;

/// Apply a debounced code-view edit to the buffer, then re-highlight and refresh
/// the code view's colour layer and dirty state.
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
    // Re-highlighting scales with the whole buffer, not the edit — 6.6 s for a 4 MB
    // file, on this thread, every time typing pauses. Past the cap the edited lines
    // keep the plain text the page already patched in, and colour returns on the
    // next build.
    let highlighted = (edit.text().len() <= MAX_LIVE_HIGHLIGHT_BYTES)
        .then(|| edit.source_view_html().to_string());
    if let Some(webview) = webview {
        if let Err(error) =
            webview.evaluate_script(&source_updated_script(highlighted.as_deref(), dirty))
        {
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
