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
    opened_document_from_source_with_host(edit.text(), path, &DesktopHost::default())
}

/// The active tab's edit buffer, seeded from disk the first time; re-entry reuses it so unsaved edits survive. Also returns the tab's index.
///
/// A refusal comes back as words rather than only a line in the log, the way `pipe_active_edit` already answers: the reader who typed is waiting on this one, and the sentence is what the growl says. The operating system's own words stay in the log, which is where a diagnosis is made and not where anybody is reading.
fn seeded_active_edit<'a>(
    workspace: &'a mut Workspace,
) -> Result<(usize, &'a mut EditableDocument), String> {
    let Some((index, path)) = active_tab_path(workspace) else {
        return Err("no document is open".to_string());
    };
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        match read_source(&path) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!("Editing: failed to read {}: {error}", path.display());
                return Err("the file could not be read".to_string());
            }
        }
    } else {
        SourceText::utf8(String::new())
    };
    let Some(tab) = workspace.tabs.get_mut(index) else {
        return Err("no document is open".to_string());
    };
    Ok((index, tab.edit_buffer(&path, contents)))
}

/// The name of the document at the front, for a sentence about it. The file's own name rather than the tab's label, because the reader is being told which file on disk was not written.
pub(crate) fn front_document_name(workspace: &Workspace) -> String {
    active_tab_path(workspace)
        .and_then(|(_, path)| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "the document".to_string())
}

/// Swap the active document to the code view. Seeds the edit buffer from disk the first time, then hands the webview the highlighted source, buffer text, language, and dirty state.
///
/// Answers the sentence saying why the source could not be shown, so the caller says it where the reader is looking rather than opening nothing at all.
pub(crate) fn enter_code_view(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    scroll_fraction: Option<f64>,
) -> Result<(), String> {
    let (index, edit) = seeded_active_edit(workspace)?;
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
    Ok(())
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
    let ready = name_untitled_in_workspace(&mut reader.workspace, &mut reader.recent, ask);
    if matches!(ready, SaveReady::Named) {
        reader.save_recent();
    }
    ready
}

/// The state half of [`name_untitled_document`]: everything the naming changes, with the window and the dialog left outside so each outcome can be tested.
pub(crate) fn name_untitled_in_workspace(
    workspace: &mut Workspace,
    recent: &mut RecentFiles,
    ask: impl FnOnce(&Path) -> Option<PathBuf>,
) -> SaveReady {
    let Some(edit) = workspace.active_edit() else {
        return SaveReady::Ready;
    };
    if !edit.untitled {
        return SaveReady::Ready;
    }
    let Some(chosen) = ask(&edit.path) else {
        return SaveReady::Canceled;
    };
    let Some(index) = workspace.active else {
        return SaveReady::Canceled;
    };
    if let Some(tab) = workspace.tabs.get_mut(index) {
        if let Some(edit) = tab.edit.as_mut() {
            edit.adopt_path(chosen.clone());
        }
        tab.history.replace_current(chosen.clone());
        tab.title = leaftext::tab_title_from_path(&chosen);
        // Cached under the old name, and the render reads the buffer anyway.
        tab.rendered = None;
    }
    // No unlock to carry onto the new name: the padlock is a setting, not a fact about a path.
    recent.record(chosen);
    SaveReady::Named
}

/// Write the active tab's edit buffer to disk. Sets the watcher's content hash to the written text so its own FileChanged for this save is a no-op.
///
/// The page is told either way, and the outcome is handed back as well: a save asked for over the pipe has somebody waiting on whether the file was written, and a script into the page is not an answer to them.
pub(crate) fn save_active_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    vault_state: &VaultState,
    refresh_book: &mut RefreshBook,
) -> Result<(), String> {
    if let Some(said) = save_refusal_script(workspace) {
        // The control a reader presses after a refused edit, which answered before it composed a single line for the page. Silence here is the same fault twice over.
        cleared_editing_state(webview);
        run_page_script(webview, &said, "Save: failed to say nothing was held");
        return Err("no document is open".to_string());
    }
    let edit = workspace
        .active_edit_mut()
        .expect("the buffer was there a line ago");
    let path = edit.path.clone();
    let text = edit.text().to_string();
    let path_str = path.display().to_string();

    let (script, written) = match DesktopHost::default().save(
        &path,
        &SourceText {
            text: text.clone(),
            spelling: edit.spelling,
        },
    ) {
        Ok(()) => {
            edit.mark_saved();
            // Self-save suppression: reload_active_document skips when the hash matches, so our own write-back FileChanged won't clobber the buffer.
            file_watch.active_hash = Some(content_hash(&text));
            // The bytes are on this machine now, which is the whole guarantee: a document whose vault keeps its files somewhere else is sent on from here, and a send that fails cannot take back what was typed.
            push_saved_document(vault_state, refresh_book, webview, &path);
            (save_result_script(&path_str, true, None), Ok(()))
        }
        Err(error) => {
            let message = error.to_string();
            eprintln!("Save failed for {}: {message}", path.display());
            (
                save_result_script(&path_str, false, Some(&message)),
                Err(message),
            )
        }
    };

    run_page_script(webview, &script, "Save: failed to report result");
    written
}

/// Seed the edit buffer from disk on the first edit, then splice a reading-view inline edit over `[start, end)`. The caller re-renders from the now-authoritative buffer, or takes the sentence saying why nothing was written and says it where the reader is looking.
///
/// `cell` says the edit was one cell of the table `[start, end)` covers. That cell is written on its own where the source map can prove where it sits, so a table lined up by hand keeps its spacing and its delimiter row; where it cannot — no map, a cell GFM invented to fill a short row, a row the page drew at another width — the whole-table rewrite is what lands, so no edit is ever refused.
pub(crate) fn apply_block_edit(
    workspace: &mut Workspace,
    start: usize,
    end: usize,
    text: &str,
    record_undo: bool,
    cell: Option<&TableCellEdit>,
) -> Result<(), String> {
    let (_, edit) = seeded_active_edit(workspace)?;
    if let Some(cell) = cell {
        if edit.replace_table_cell(
            start,
            cell.row,
            cell.column,
            cell.columns,
            &cell.text,
            record_undo,
        ) {
            return Ok(());
        }
    }
    if record_undo {
        edit.replace_range(start, end, text);
    } else {
        edit.replace_range_without_undo(start, end, text);
    }
    Ok(())
}

/// One reading-view edit as the page sent it, so the decision below takes two arguments rather than eight.
pub(crate) struct BlockEdit<'a> {
    pub start: usize,
    pub end: usize,
    pub text: &'a str,
    /// A checkbox toggle: spliced without an undo step and written straight to disk.
    pub autosave: bool,
    /// The reader is still typing in the page, so nothing is drawn over them.
    pub live: bool,
    /// One more keystroke in a run already standing on the undo stack.
    pub continuing: bool,
    pub cell: Option<&'a TableCellEdit>,
}

/// What the loop owes the page after one edit. Answered as a value rather than done, because the loop never returns and a test has no `Reader` to hand it.
pub(crate) enum BlockEditOutcome {
    /// The buffer moved. `autosave` writes it to disk; `render` redraws the page.
    Spliced { autosave: bool, render: bool },
    /// Nothing was written, carrying the sentence the reader is shown beside the document's name.
    Refused(String),
}

/// Splice one reading-view edit, and say what the loop should then spend on its `Reader`.
///
/// A live splice leaves the page standing: the reader is still typing in it, and a render would take the words out from under the caret. A refusal is the state the page cannot see for itself, because it raised the dirty mark and the Undo button before the command ever left it.
pub(crate) fn edit_block_outcome(
    workspace: &mut Workspace,
    edit: &BlockEdit<'_>,
) -> BlockEditOutcome {
    match apply_block_edit(
        workspace,
        edit.start,
        edit.end,
        edit.text,
        !edit.autosave && !edit.continuing,
        edit.cell,
    ) {
        Ok(()) => BlockEditOutcome::Spliced {
            autosave: edit.autosave,
            render: !edit.live,
        },
        Err(why) => BlockEditOutcome::Refused(why),
    }
}

/// What one field-edit command asks for.
pub(crate) enum FieldEdit<'a> {
    Set(&'a str),
    /// Every item of a list at once, in the form the file already wrote it.
    SetList(&'a [String]),
    /// The key's own bytes, replaced. One splice rather than a remove and an add, so the field keeps its value, its quoting and its place in the block.
    Rename(&'a str),
    Remove,
}

/// Seed the edit buffer, then set, rename or remove one frontmatter field in it. The splice comes from the parser, so the block keeps its order, its comments, its quoting and every line the parser would not read.
///
/// It goes on the undo stack and marks the document dirty, rather than writing itself to disk the way a checkbox toggle does — saving is what ends an undo stack, so the two cannot both be true. Taking a removed field back with the history is what the cross needs instead of an undo button beside it.
///
/// Answers whether the buffer moved — a key that is not there to remove, a name the block already holds, or a value already written, moves nothing and re-renders nothing — or the sentence saying why nothing could be written at all.
pub(crate) fn apply_field_edit(
    workspace: &mut Workspace,
    key: &str,
    value: FieldEdit<'_>,
) -> Result<bool, String> {
    let (_, edit) = seeded_active_edit(workspace)?;
    let splice = match value {
        FieldEdit::Set(value) => leaftext::store::set_field(edit.text(), key, value),
        FieldEdit::SetList(items) => {
            let items: Vec<&str> = items.iter().map(String::as_str).collect();
            leaftext::store::set_list_field(edit.text(), key, &items)
        }
        FieldEdit::Rename(to) => leaftext::store::rename_field(edit.text(), key, to),
        FieldEdit::Remove => leaftext::store::remove_field(edit.text(), key),
    };
    let Some(splice) = splice else {
        return Ok(false);
    };
    edit.replace_range(splice.range.start, splice.range.end, &splice.text);
    Ok(true)
}

/// Seed the edit buffer, then drag-reorder a run of sibling blocks in it. One undo step, like any other reading-view edit. Answers whether the buffer moved (the caller re-renders when so) — a range list the buffer can't trust moves nothing — or the sentence saying why nothing could be written at all.
pub(crate) fn apply_block_move(
    workspace: &mut Workspace,
    ranges: &[(usize, usize)],
    from: usize,
    to: usize,
) -> Result<bool, String> {
    let (_, edit) = seeded_active_edit(workspace)?;
    Ok(edit.move_blocks(ranges, from, to))
}

/// Write the active buffer to disk for an auto-saving edit (a checkbox toggle): no Save-button round-trip. The version bump plus watcher-hash update keep our own write from bouncing back through the file watcher as an external change.
///
/// Answers the write rather than only logging it. The splice has already landed, so a failure here is a real change with no file behind it — and swallowing it into the log is what left a box inside a table ticked with nothing said anywhere a reader looks.
pub(crate) fn autosave_active_buffer(
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
) -> Result<(), String> {
    let Some(edit) = workspace.active_edit_mut() else {
        return Ok(());
    };
    let text = edit.text().to_string();
    match DesktopHost::default().save(
        &edit.path,
        &SourceText {
            text: text.clone(),
            spelling: edit.spelling,
        },
    ) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
            Ok(())
        }
        Err(error) => {
            eprintln!("Auto-save failed for {}: {error}", edit.path.display());
            Err(error.to_string())
        }
    }
}

/// Toggle a task-list checkbox from the reading view. Everything it does is `flip_task_and_save`'s; what the page is then told is decided here, because the box drew itself ticked before the command left and only the host knows whether that tick is standing on anything.
///
/// So the two refusals are not one. Where nothing is held the chrome goes back to nothing and the answer says so, which is the page's cue to put its own tick back. Where the buffer took the tick and only the file refused it, the box on screen is right: the chrome is refreshed instead, which leaves the dirty mark up and Save lit over a change that is genuinely there.
///
/// `token` is the box that sent it. The sentence rides the answer where there is one, so it is said once beside the box it is about rather than twice.
pub(crate) fn toggle_task_marker(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
    token: Option<u64>,
) {
    let answer = task_toggle_answer(webview, workspace, file_watch, index);
    match answer.chrome {
        TaskChrome::Sent => {}
        TaskChrome::Resync => resync_editing_state(webview, workspace),
        TaskChrome::Clear => cleared_editing_state(webview),
    }
    say_edit_outcome(webview, token, answer.held, answer.said.as_deref());
}

/// What the page is owed after one tick: the chrome to send, whether the buffer holds the tick, and the sentence to say.
///
/// Answered as a value rather than done, for the reason [`edit_block_outcome`] is: the loop never returns, so a test has no `Reader` to hand it, and the decision here is the whole of what this ticket changed.
pub(crate) struct TaskToggleAnswer {
    pub chrome: TaskChrome,
    /// True where the buffer kept the tick, which is the word the page acts on: told false, the box that drew itself ticked puts its own tick back off.
    pub held: bool,
    pub said: Option<String>,
}

/// What the reading view's editing chrome — the dirty dot, Save, Undo and Redo — should say once a tick has been through.
pub(crate) enum TaskChrome {
    /// Already sent, with the toggled source beside it, by the write that succeeded.
    Sent,
    /// Refreshed off the buffer: the tick is held and the file is not written, so the dot stays up and Save stays lit over a change that is really there.
    Resync,
    /// Back to nothing, because nothing is held.
    Clear,
}

/// Flip one task marker, and say what the page is then owed.
pub(crate) fn task_toggle_answer(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
) -> TaskToggleAnswer {
    let refusal = match flip_task_and_save(webview, workspace, file_watch, index) {
        Ok(_) => {
            return TaskToggleAnswer {
                chrome: TaskChrome::Sent,
                held: true,
                said: None,
            }
        }
        Err(refusal) => refusal,
    };
    eprintln!("Toggle task: {}", refusal.why);
    let document = front_document_name(workspace);
    if refusal.held {
        return TaskToggleAnswer {
            chrome: TaskChrome::Resync,
            held: true,
            said: Some(edit_unsaved_words(&document, &refusal.why)),
        };
    }
    TaskToggleAnswer {
        chrome: TaskChrome::Clear,
        held: false,
        said: Some(edit_refused_words(&document, &refusal.why)),
    }
}

/// Why one edit wrote nothing, and whether the buffer kept the change anyway.
///
/// The two are not the same refusal and the page cannot tell them apart for itself. A file that could not be read holds nothing, so a box the page drew ticked is standing on air; a splice that landed over a file that then refused the write holds everything but the file, so the same box is right and it is the disk that is behind.
pub(crate) struct EditRefused {
    pub why: String,
    pub held: bool,
}

/// Every refusal that comes back as words alone happened before the buffer moved, so none of them holds anything.
impl From<String> for EditRefused {
    fn from(why: String) -> Self {
        EditRefused { why, held: false }
    }
}

/// What one edit owes the page: the answer to whoever is waiting on it, or the growl where nobody is.
///
/// `held` says the buffer kept the change. A sender waiting on a token says the sentence in its own corner beside whatever it is holding open, so the host stays quiet there — both would be one refusal said twice.
pub(crate) fn say_edit_outcome(
    webview: Option<&WebView>,
    token: Option<u64>,
    held: bool,
    said: Option<&str>,
) {
    match token {
        Some(token) => run_page_script(
            webview,
            &edit_answered_script(token, held, said),
            "Editing: failed to answer the edit",
        ),
        None => {
            if let Some(said) = said {
                run_page_script(
                    webview,
                    &error_toast_script(said),
                    "Editing: failed to say how the edit went",
                );
            }
        }
    }
}

/// Flip one task marker and write the file, or say why nothing was written.
///
/// The whole of what a checkbox does, shared by the reading view and the ask pipe so neither can write a file it did not change: the marker is looked up before anything is spliced, and an index naming no task is refused rather than saved over. Seeds the tab's edit buffer from disk on the first edit, writes straight to disk, then reports the refreshed task offsets and dirty state so the reading view stays in sync without a full re-render — the checkbox's own checked state is already flipped in the DOM by the frontend. A checkbox toggle auto-saves and records no undo step, so it works even with reading-view editing turned off.
pub(crate) fn flip_task_and_save(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    index: usize,
) -> Result<serde_json::Value, EditRefused> {
    let (_, edit) = seeded_active_edit(workspace)?;
    if edit.format != DocumentFormat::Markdown {
        return Err(format!(
            "{} is not Markdown, so it has no tasks to check",
            edit.path.display()
        )
        .into());
    }
    let markers = task_marker_offsets(edit.text());
    let Some(&offset) = markers.get(index) else {
        return Err(match markers.len() {
            0 => format!("{} has no tasks", edit.path.display()),
            count => format!(
                "there is no task {index} — {} has {count}",
                edit.path.display()
            ),
        }
        .into());
    };
    // Read after the flip, off the same buffer the write goes to, so the answer is what the file now says rather than what the caller meant.
    edit.toggle_task_without_undo(index);
    let checked = edit
        .text()
        .as_bytes()
        .get(offset)
        .is_some_and(|byte| *byte != b' ');
    let text = edit.text().to_string();
    match DesktopHost::default().save(
        &edit.path,
        &SourceText {
            text: text.clone(),
            spelling: edit.spelling,
        },
    ) {
        Ok(()) => {
            edit.mark_saved();
            file_watch.active_hash = Some(content_hash(&text));
        }
        // The marker moved in the buffer, so the tick on screen is right and the document is now dirty. Only the file is behind, which is what `held` carries out to the page: it takes no box back, and the chrome it gets says Save.
        Err(error) => {
            return Err(EditRefused {
                why: error.to_string(),
                held: true,
            })
        }
    }
    let saved = edit.path.display().to_string();
    let tasks = edit.task_offsets();
    let dirty = edit.is_dirty();
    let can_undo = edit.can_undo();
    let can_redo = edit.can_redo();

    // A toggle doesn't re-render, so carry the toggled source for the reader's raw-source editors to slice from.
    run_page_script(
        webview,
        &blocks_resynced_script(&tasks, dirty, can_undo, can_redo, Some(&text)),
        "Toggle task: failed to resync reading view",
    );
    Ok(serde_json::json!({
        "path": saved,
        "index": index,
        "checked": checked,
        "fingerprint": source_fingerprint(&text),
    }))
}

/// What a document's source is worth as one short string, and the value a write over the ask pipe has to quote back.
///
/// Hex rather than the number itself: the asker reads it through JavaScript, where a 64-bit integer loses its low bits on the way through, and a fingerprint that changed in transit would refuse every write.
pub(crate) fn source_fingerprint(text: &str) -> String {
    format!("{:016x}", content_hash(text))
}

/// How a file spells its text, in the words the answer uses. Rust's own names for the encodings are the enum's; these are what somebody reading the reply would write.
fn spelling_answer(spelling: SourceSpelling) -> serde_json::Value {
    let encoding = match spelling.encoding {
        SourceEncoding::Utf8 => "utf-8",
        SourceEncoding::Utf16Le => "utf-16le",
        SourceEncoding::Utf16Be => "utf-16be",
        SourceEncoding::Utf32Le => "utf-32le",
        SourceEncoding::Utf32Be => "utf-32be",
    };
    serde_json::json!({ "encoding": encoding, "mark": spelling.mark })
}

/// The active tab's edit buffer for the ask pipe, seeded from disk the first time. Unlike [`seeded_active_edit`] a failure comes back as words rather than a line in the log: somebody is waiting on this one.
fn pipe_active_edit(workspace: &mut Workspace) -> Result<(PathBuf, &mut EditableDocument), String> {
    let Some((index, path)) = active_tab_path(workspace) else {
        return Err("no document is open".to_string());
    };
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        read_source(&path)
            .map_err(|error| format!("{} could not be read: {error}", path.display()))?
    } else {
        SourceText::utf8(String::new())
    };
    let tab = workspace
        .tabs
        .get_mut(index)
        .ok_or_else(|| "no document is open".to_string())?;
    let edit = tab.edit_buffer(&path, contents);
    Ok((path, edit))
}

/// Refuse anything aimed at a document that is not the one at the front. Every buffer and save routine here works the active tab, so a write meant for another one would land on this one.
fn front_document(workspace: &Workspace, path: &Path) -> Result<(), String> {
    match workspace.active_path() {
        Some(current) if paths_refer_to_same_document(current, path) => Ok(()),
        Some(current) => Err(format!(
            "{} is the document at the front, not {} — ask for that one first",
            current.display(),
            path.display()
        )),
        None => Err("no document is open".to_string()),
    }
}

/// Bring `path` to the front for the ask pipe, opening a tab when nothing is showing it. Answers whether the front moved, since only the loop can redraw.
pub(crate) fn pipe_bring_to_front(workspace: &mut Workspace, path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Err(format!("there is no file at {}", path.display()));
    }
    // A front tab showing its no-file buffer's name is showing no file, however that name resolves — the same test the open match asks, so the reader's file is opened rather than answered for by the note wearing its name.
    if !workspace.active_shows_untitled_buffer() && front_document(workspace, path).is_ok() {
        return Ok(false);
    }
    workspace.open_path(path.to_path_buf());
    Ok(true)
}

/// What the ask pipe answers about the document at the front: its source as the buffer holds it, how its file is spelled, whether it has edits nobody has saved, the fingerprint a write has to quote back, and its tasks.
///
/// The tasks carry no byte offset on purpose: a caller names one by its place in the list, which is the arithmetic the task ask exists to remove, and the source is right here for anything that genuinely needs a byte.
pub(crate) fn pipe_document_answer(workspace: &mut Workspace) -> Result<serde_json::Value, String> {
    let (path, edit) = pipe_active_edit(workspace)?;
    let tasks: Vec<serde_json::Value> = document_tasks(edit)
        .into_iter()
        .map(|task| serde_json::json!({ "checked": task.checked, "text": task.text }))
        .collect();
    Ok(serde_json::json!({
        "path": path.display().to_string(),
        "text": edit.text(),
        "spelling": spelling_answer(edit.spelling),
        "unsaved": edit.is_dirty(),
        "untitled": edit.untitled,
        "fingerprint": source_fingerprint(edit.text()),
        "tasks": tasks,
    }))
}

/// The tasks in a buffer, in document order. Empty for anything that is not Markdown, which is the one format a task marker means something in.
fn document_tasks(edit: &EditableDocument) -> Vec<TaskEntry> {
    if edit.format == DocumentFormat::Markdown {
        task_entries(edit.text())
    } else {
        Vec::new()
    }
}

/// A write refused because the document moved on under it, saying what it is now so the asker reads it again rather than guessing.
fn stale_fingerprint(fresh: &str) -> String {
    format!("the document has changed since that fingerprint — it is {fresh} now, so read it again before writing")
}

/// The pipe's write: splice `text` over `[start, end)` of the document at the front, as one undo step.
///
/// Refused unless `path` is that document and `expect` is its fingerprint. It splices the same buffer the window types into, so the loop redraws afterwards and the owner sees the edit land and can take it back.
pub(crate) fn pipe_edit_document(
    workspace: &mut Workspace,
    path: &Path,
    start: usize,
    end: usize,
    text: &str,
    expect: &str,
) -> Result<serde_json::Value, String> {
    front_document(workspace, path)?;
    let (path, edit) = pipe_active_edit(workspace)?;
    let holding = source_fingerprint(edit.text());
    if holding != expect {
        return Err(stale_fingerprint(&holding));
    }
    edit.replace_range(start, end, text);
    Ok(serde_json::json!({
        "path": path.display().to_string(),
        "bytes": edit.text().len(),
        "unsaved": edit.is_dirty(),
        "fingerprint": source_fingerprint(edit.text()),
    }))
}

/// The pipe's task toggle: check or clear the `index`-th task of the document at the front and write it at once, the way the reader's own checkbox does.
///
/// Every refusal lands before anything is written — a document that is not at the front, a fingerprint that has moved, a document with no tasks, an index naming none. That is the whole of what this adds over the page command it shares its body with, which takes no path, checks no fingerprint and answers nothing.
pub(crate) fn pipe_toggle_task(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    path: &Path,
    index: usize,
    expect: &str,
) -> Result<serde_json::Value, String> {
    front_document(workspace, path)?;
    let (_, edit) = pipe_active_edit(workspace)?;
    let holding = source_fingerprint(edit.text());
    if holding != expect {
        return Err(stale_fingerprint(&holding));
    }
    // The asker on the pipe is told what happened, not what is held: it has no box on screen to put back.
    flip_task_and_save(webview, workspace, file_watch, index).map_err(|refusal| refusal.why)
}

/// The pipe's save: write the document at the front to its file, through the same host save the page's own Save runs.
///
/// Refused for a document with no file yet — the dialog that asks where one goes is the owner's — and refused on a fingerprint that is not the buffer's, so nothing on disk is replaced by text nobody has read back.
pub(crate) fn pipe_save_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    vault_state: &VaultState,
    refresh_book: &mut RefreshBook,
    path: &Path,
    expect: &str,
) -> Result<serde_json::Value, String> {
    front_document(workspace, path)?;
    let (path, edit) = pipe_active_edit(workspace)?;
    if edit.untitled {
        return Err(format!(
            "{} has never been saved, so the app has to ask where it goes — that dialog is the owner's to answer",
            path.display()
        ));
    }
    let holding = source_fingerprint(edit.text());
    if holding != expect {
        return Err(stale_fingerprint(&holding));
    }
    save_active_document(webview, workspace, file_watch, vault_state, refresh_book)
        .map_err(|error| format!("{} was not written: {error}", path.display()))?;
    Ok(serde_json::json!({
        "saved": path.display().to_string(),
        "unsaved": false,
        "fingerprint": holding,
    }))
}

/// Push the buffer's editing state (task offsets, dirty, whether the history has a step in either direction) back to the reading view. The source is omitted since the caller's re-render already delivered it.
pub(crate) fn resync_editing_state(webview: Option<&WebView>, workspace: &Workspace) {
    let Some(edit) = workspace.active_edit() else {
        return;
    };
    run_page_script(
        webview,
        &editing_state_script(edit),
        "Editing: failed to resync reading view",
    );
}

/// The chrome as one buffer says it is.
pub(crate) fn editing_state_script(edit: &EditableDocument) -> String {
    blocks_resynced_script(
        &edit.task_offsets(),
        edit.is_dirty(),
        edit.can_undo(),
        edit.can_redo(),
        None,
    )
}

/// Tell the page nothing is held for the document at the front: no dirty mark, nothing to undo, nothing to redo.
///
/// `resync_editing_state` cannot say this. It answers off `workspace.active_edit()`, and a refused seed returns before the tab's buffer is ever made, so the call reads nothing and the raised buttons stand. Where the tab does hold a buffer it is worse than nothing: a tab that followed a link away from the document it was editing still holds that other file's buffer, and the script names no path, so the page would stamp that document's state onto the one on screen.
pub(crate) fn cleared_editing_state(webview: Option<&WebView>) {
    run_page_script(
        webview,
        &cleared_editing_state_script(),
        "Editing: failed to clear the reading view's state",
    );
}

/// The chrome with nothing behind it. Task offsets go out empty because the page reads the source, the dirty flag and the two history flags and drops them.
pub(crate) fn cleared_editing_state_script() -> String {
    blocks_resynced_script(&[], false, false, false, None)
}

/// What the page is told when Save is pressed on a document the app holds no buffer for, or nothing when it holds one. Answered as a value so a test can read the sentence without a window to send it into.
///
/// A reader reaches this by pressing Save after an edit was refused, which is the one way the button is lit over a document nothing was written to.
pub(crate) fn save_refusal_script(workspace: &Workspace) -> Option<String> {
    if workspace.active_edit().is_some() {
        return None;
    }
    Some(edit_refused_script(
        &front_document_name(workspace),
        "the app is holding no changes for it",
    ))
}

/// What every command sharing the seed does when it is refused: the chrome goes back to what the app is actually holding, which is nothing, and the reader is told in the corner the app always uses.
///
/// One branch rather than five, because a refusal said in one command's arm and not in the next four's is the silence this exists to end.
pub(crate) fn say_edit_refused(webview: Option<&WebView>, workspace: &Workspace, why: &str) {
    cleared_editing_state(webview);
    run_page_script(
        webview,
        &edit_refused_script(&front_document_name(workspace), why),
        "Editing: failed to say the edit was refused",
    );
}
