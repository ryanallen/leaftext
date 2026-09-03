//! Turning an edit into a buffer change, and a buffer into a saved file.

use super::*;

/// The scheme the page fetches large JSON payloads over.
pub(crate) const SOURCE_PAYLOAD_PROTOCOL: &str = "leaf-source";

/// The page's pending payload, staged for it to fetch rather than pushed to it.
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
pub(crate) fn stage_page_payload(json: Vec<u8>) -> String {
    let id = SOURCE_PAYLOAD_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if let Ok(mut slot) = PENDING_SOURCE_PAYLOAD.lock() {
        *slot = Some((id, json));
    }
    source_payload_url(SOURCE_PAYLOAD_PROTOCOL, id)
}

/// Hand a document-bearing workspace update to the page without putting its bytes in a page command.
pub(crate) fn run_workspace_payload(
    webview: Option<&WebView>,
    message: WorkspacePayloadMessage,
    context: &str,
) {
    #[cfg(target_os = "windows")]
    if let Some(webview) = webview {
        if post_workspace_shared_buffer(webview, &message).is_ok() {
            return;
        }
    }
    let script = message.stage_with(stage_page_payload);
    run_page_script(webview, &script, context);
}

#[cfg(target_os = "windows")]
fn post_workspace_shared_buffer(
    webview: &WebView,
    message: &WorkspacePayloadMessage,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
    };
    use windows::core::{Interface, HSTRING};
    use wry::WebViewExtWindows;

    let environment: ICoreWebView2Environment12 = webview
        .environment()
        .cast()
        .map_err(|error| error.to_string())?;
    let shared = unsafe {
        environment
            .CreateSharedBuffer(message.shared_json().len() as u64)
            .map_err(|error| error.to_string())?
    };
    let mut target = std::ptr::null_mut();
    unsafe {
        shared
            .Buffer(&mut target)
            .map_err(|error| error.to_string())?;
        std::ptr::copy_nonoverlapping(
            message.shared_json().as_ptr(),
            target,
            message.shared_json().len(),
        );
    }
    let page: ICoreWebView2_17 = webview
        .webview()
        .cast()
        .map_err(|error| error.to_string())?;
    let metadata = HSTRING::from(message.shared_metadata());
    unsafe {
        page.PostSharedBufferToScript(
            &shared,
            COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
            &metadata,
        )
        .map_err(|error| error.to_string())
    }
}

/// Resolve a payload request. The matching request takes the body rather than copying it, so the address answers once — the page fetches once, and a failed fetch leaves source view, where the next press stages a fresh address.
pub(crate) fn source_payload_response(uri: &str) -> SourcePayload {
    let wanted = uri.rsplit('/').next().and_then(|id| id.parse::<u64>().ok());
    let body = match (wanted, PENDING_SOURCE_PAYLOAD.lock()) {
        (Some(wanted), Ok(mut slot)) => {
            if matches!(slot.as_ref(), Some((id, _)) if *id == wanted) {
                slot.take().map(|(_, body)| body)
            } else {
                None
            }
        }
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
    // A package is drawn from its archive with the buffer's member put back, so an unsaved edit is on screen. A buffer that cannot be packed back — nothing has managed it, but the answer cannot be a panic — falls back to its own text, which for a package is the member the code view shows.
    opened_document_from_buffer_with_host(edit, path, &DesktopHost::default()).unwrap_or_else(
        |_| opened_document_from_source_with_host(edit.text(), path, &DesktopHost::default()),
    )
}

/// Why an edit buffer could not be seeded, as the facts rather than a sentence. The window and the ask pipe word their own from these, because a reader looking at a growl and a caller reading the answer as text want different things said.
enum SeedRefusal {
    NothingOpen,
    Unreadable { path: PathBuf, error: io::Error },
}

/// The one walk to the active tab's edit buffer, seeded from disk the first time; re-entry reuses it so unsaved edits survive. Also returns the tab's index.
///
/// Both doors into editing come through here — the five reading-view commands and the ask pipe's four asks — so the next change to how a buffer is opened is made once. It says nothing and logs nothing: the refusal carries the facts, and the caller says them in the words its own reader wants.
fn seeded_active_edit<'a>(
    workspace: &'a mut Workspace,
) -> Result<(usize, &'a mut EditableDocument), SeedRefusal> {
    let Some((index, path)) = active_tab_path(workspace) else {
        return Err(SeedRefusal::NothingOpen);
    };
    let needs_seed = workspace
        .tabs
        .get(index)
        .is_some_and(|tab| tab.needs_edit_seed(&path));
    let contents = if needs_seed {
        // The tab first: a package this session rendered is already holding both halves of what the buffer wants, so the file is opened only where it is not.
        let from_render = workspace
            .tabs
            .get_mut(index)
            .and_then(|tab| tab.seed_from_render(&path));
        match from_render {
            Some(contents) => contents,
            None => match read_document_for_editing(&path) {
                Ok(contents) => contents,
                Err(error) => return Err(SeedRefusal::Unreadable { path, error }),
            },
        }
    } else {
        DocumentSource {
            text: SourceText::utf8(String::new()),
            package: None,
            document: None,
        }
    };
    let Some(tab) = workspace.tabs.get_mut(index) else {
        return Err(SeedRefusal::NothingOpen);
    };
    Ok((index, tab.edit_buffer(&path, contents)))
}

/// The refusal in the words the growl says. The operating system's own go to the log instead: the reader is looking at a window, where a diagnosis has nowhere to sit and nothing to offer.
fn reading_view_refusal(refusal: SeedRefusal) -> String {
    match refusal {
        SeedRefusal::NothingOpen => "no document is open".to_string(),
        SeedRefusal::Unreadable { path, error } => {
            eprintln!("Editing: failed to read {}: {error}", path.display());
            "the file could not be read".to_string()
        }
    }
}

/// The refusal in the words somebody reading the answer as text wants: the file they cannot see for themselves, and what the operating system said about it. Nothing goes to the log, because the whole diagnosis is already in their hands.
fn pipe_refusal(refusal: SeedRefusal) -> String {
    match refusal {
        SeedRefusal::NothingOpen => "no document is open".to_string(),
        SeedRefusal::Unreadable { path, error } => {
            format!("{} could not be read: {error}", path.display())
        }
    }
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
    let (index, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
    // Building the editor on a big source takes a while; the code-view script clears the spinner once it is on screen.
    begin_reader_loading(webview);
    let source_definition = leaftext::source_definition(&edit.path);
    let language = source_definition
        .map(|definition| definition.language_token)
        .unwrap_or(edit.format.language_token())
        .to_string();
    let display = source_definition
        .map(|definition| definition.display_name)
        .unwrap_or(edit.format.display_name())
        .to_string();
    let dirty = edit.is_dirty();

    // The buffer's own text, never a copy of it: on a package member the copy was a whole inflated member taken and dropped inside one press, and `code_view_payload` only borrows.
    let url = stage_page_payload(code_view_payload(
        edit.text(),
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
    vault_state: &mut VaultState,
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

    let (script, written) = match save_editable_document(&DesktopHost::default(), edit) {
        Ok(()) => {
            after_document_saved(edit, &text, file_watch, vault_state, refresh_book, webview);
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

fn after_document_saved(
    edit: &mut EditableDocument,
    text: &str,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    webview: Option<&WebView>,
) {
    edit.mark_saved();
    let path = edit.path.clone();
    // The same key the live reload's gate reads back off the file, so the watcher event this save is about to raise costs the tail of a package rather than the whole of it.
    file_watch.active_hash = Some(render_key(&path, text));
    push_saved_document(vault_state, refresh_book, webview, &path);
    record_or_refresh_corpus_path(vault_state, &path);
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
    let (_, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
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
    // A workbook's cell is the one place the drawn words are not in the buffer at all — they are in the shared string table, with the cell holding an index — so what the page sends over a cell element is the words, and the cell is rewritten to say them inline. Nothing else matches: the rewrite answers only for a range that really is a cell element, so an ordinary splice cannot be quietly turned into one.
    if edit.replace_sheet_cell(start, end, text) {
        return Ok(());
    }
    if record_undo {
        edit.replace_range(start, end, text);
    } else {
        edit.replace_range_without_undo(start, end, text);
    }
    Ok(())
}

/// Seed the edit buffer, then rewrite several blocks as one undoable edit. A malformed list is refused whole before the buffer moves.
pub(crate) fn apply_block_replacements(
    workspace: &mut Workspace,
    blocks: &[BlockReplacement],
) -> Result<(), String> {
    let (_, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
    let replacements: Vec<(usize, usize, &str)> = blocks
        .iter()
        .map(|block| (block.start, block.end, block.text.as_str()))
        .collect();
    if edit.replace_ranges(&replacements) {
        Ok(())
    } else {
        Err(String::from(
            "the replacement list is empty, out of order, overlapping, or outside the document",
        ))
    }
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
    let (_, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
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
    let (_, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
    Ok(edit.move_blocks(ranges, from, to))
}

/// Write the active buffer to disk for an auto-saving edit (a checkbox toggle): no Save-button round-trip. The version bump plus watcher-hash update keep our own write from bouncing back through the file watcher as an external change.
///
/// Answers the write rather than only logging it. The splice has already landed, so a failure here is a real change with no file behind it, and one swallowed into the log leaves a box inside a table ticked with nothing said anywhere a reader looks.
pub(crate) fn autosave_active_buffer(
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    webview: Option<&WebView>,
) -> Result<(), String> {
    let Some(edit) = workspace.active_edit_mut() else {
        return Ok(());
    };
    let text = edit.text().to_string();
    match save_editable_document(&DesktopHost::default(), edit) {
        Ok(()) => {
            after_document_saved(edit, &text, file_watch, vault_state, refresh_book, webview);
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
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    index: usize,
    token: Option<u64>,
) {
    let answer = task_toggle_answer(
        webview,
        workspace,
        file_watch,
        vault_state,
        refresh_book,
        index,
    );
    match answer.chrome {
        TaskChrome::Sent => {}
        TaskChrome::Resync => resync_editing_state(webview, workspace),
        TaskChrome::Clear => cleared_editing_state(webview),
    }
    say_edit_outcome(webview, token, answer.held, answer.said.as_deref());
}

/// What the page is owed after one tick: the chrome to send, whether the buffer holds the tick, and the sentence to say.
///
/// Answered as a value rather than done, for the reason [`edit_block_outcome`] is: the loop never returns, so a test has no `Reader` to hand it.
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
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    index: usize,
) -> TaskToggleAnswer {
    let refusal = match flip_task_and_save(
        webview,
        workspace,
        file_watch,
        vault_state,
        refresh_book,
        index,
    ) {
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
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    index: usize,
) -> Result<serde_json::Value, EditRefused> {
    let (_, edit) = seeded_active_edit(workspace).map_err(reading_view_refusal)?;
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
    match save_editable_document(&DesktopHost::default(), edit) {
        Ok(()) => {
            after_document_saved(edit, &text, file_watch, vault_state, refresh_book, webview);
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

/// The active tab's edit buffer for the ask pipe, and the path beside it. The walk is [`seeded_active_edit`]'s; this is the one place the pipe's sentence is written and the one place the pipe's path is read, which its four asks would otherwise each repeat.
fn pipe_active_edit(workspace: &mut Workspace) -> Result<(PathBuf, &mut EditableDocument), String> {
    // Read before the walk, not after: the buffer it answers borrows the workspace for as long as the caller holds it.
    let Some((_, path)) = active_tab_path(workspace) else {
        return Err("no document is open".to_string());
    };
    let (_, edit) = seeded_active_edit(workspace).map_err(pipe_refusal)?;
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

/// The pipe's document read: the front document's clean buffer brought into step with its file, then what it holds. Answers whether the buffer took the file as well, because the page is then drawn from words nobody holds and the arm behind this has to redraw.
///
/// Separate from `pipe_document_answer` so the arm can be told that — see `front_buffer_takes_disk` for what the reconciliation is guarding.
pub(crate) fn pipe_document_read(
    workspace: &mut Workspace,
) -> Result<(bool, serde_json::Value), String> {
    let took_disk = front_buffer_takes_disk(workspace);
    Ok((took_disk, pipe_document_answer(workspace)?))
}

/// The tasks in a buffer, in document order. Empty for anything that is not Markdown, which is the one format a task marker means something in.
fn document_tasks(edit: &EditableDocument) -> Vec<TaskEntry> {
    if edit.format == DocumentFormat::Markdown {
        task_entries(edit.text())
    } else {
        Vec::new()
    }
}

/// Bring the front document's clean buffer into step with its file, before a fingerprint is taken over it. Answers whether the buffer took the file, so the arm behind the write knows the page is drawn from words nobody holds any more.
///
/// Every write here guards itself with a fingerprint of the buffer, and the answer the caller quoted was taken from the same buffer — so a file somebody changed outside the app matches its own stale copy, the guard passes, and the write puts the old words back. Asking the file first is what makes the guard a guard.
fn front_buffer_takes_disk(workspace: &mut Workspace) -> bool {
    let Some((index, path)) = active_tab_path(workspace) else {
        return false;
    };
    take_disk_into_clean_buffer(workspace, index, &path)
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
    front_buffer_takes_disk(workspace);
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
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    path: &Path,
    index: usize,
    expect: &str,
) -> Result<serde_json::Value, String> {
    front_document(workspace, path)?;
    front_buffer_takes_disk(workspace);
    let (_, edit) = pipe_active_edit(workspace)?;
    let holding = source_fingerprint(edit.text());
    if holding != expect {
        return Err(stale_fingerprint(&holding));
    }
    // The asker on the pipe is told what happened, not what is held: it has no box on screen to put back.
    flip_task_and_save(
        webview,
        workspace,
        file_watch,
        vault_state,
        refresh_book,
        index,
    )
    .map_err(|refusal| refusal.why)
}

/// The pipe's save: write the document at the front to its file, through the same host save the page's own Save runs.
///
/// Refused for a document with no file yet — the dialog that asks where one goes is the owner's — and refused on a fingerprint that is not the buffer's, so nothing on disk is replaced by text nobody has read back.
pub(crate) fn pipe_save_document(
    webview: Option<&WebView>,
    workspace: &mut Workspace,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    path: &Path,
    expect: &str,
) -> Result<serde_json::Value, String> {
    front_document(workspace, path)?;
    front_buffer_takes_disk(workspace);
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

/// The source view opened. A fresh toggle carries its own position: the page stashed the reading view's scroll fraction before asking to enter.
pub(crate) fn enter_source(reader: &mut Reader) {
    if let Err(why) = enter_code_view(reader.webview.as_ref(), &mut reader.workspace, None) {
        say_edit_refused(reader.page(), &reader.workspace, &why);
    }
}

/// The source view closed, and the document drawn again from the buffer it was typed into.
pub(crate) fn exit_source(reader: &mut Reader) {
    if let Some(index) = reader.workspace.active {
        if let Some(tab) = reader.workspace.tabs.get_mut(index) {
            tab.code_view = false;
        }
    }
    reader.render(ScrollIntent::Reset);
}

/// The whole source buffer as the code view now holds it.
pub(crate) fn update_source(reader: &mut Reader, text: String) {
    update_source_buffer(reader.webview.as_ref(), &mut reader.workspace, text);
}

/// One range of the source buffer replaced, which is what a keystroke in the code view sends.
pub(crate) fn source_spliced(
    reader: &mut Reader,
    start: usize,
    removed: usize,
    inserted: &str,
    length: usize,
) {
    splice_source_buffer(
        reader.webview.as_ref(),
        &mut reader.workspace,
        start,
        removed,
        inserted,
        length,
    );
}

/// The notes `[[` can complete to.
pub(crate) fn complete_notes(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    token: u64,
) {
    let document = reader.workspace.active_path().map(Path::to_path_buf);
    code_complete_notes(vault_state, proxy, document.as_deref(), token);
}

/// The headings of a named note, or of the buffer in front when none is named.
pub(crate) fn complete_headings(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    token: u64,
    note: Option<String>,
) {
    code_complete_headings(vault_state, proxy, &reader.workspace, token, note);
}

/// What a note under the pointer in the code view says.
pub(crate) fn hover_note(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    token: u64,
    note: String,
) {
    let document = reader.workspace.active_path().map(Path::to_path_buf);
    code_hover_note(vault_state, proxy, document.as_deref(), token, note);
}

/// What the code view should underline in the buffer it is holding.
pub(crate) fn lint_source(
    reader: &Reader,
    vault_state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    token: u64,
) {
    code_lint(vault_state, proxy, &reader.workspace, token);
}

/// Save, with the naming window in front of it only for a document that has never had a file.
pub(crate) fn save_document(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    format: Option<&str>,
) {
    match name_untitled_document(reader, |path| pick_save_path(path, format)) {
        SaveReady::Canceled => {}
        ready => {
            // The page has already been told how it went; nobody else is waiting on this one.
            let _ = save_active_document(
                reader.webview.as_ref(),
                &mut reader.workspace,
                file_watch,
                vault_state,
                refresh_book,
            );
            // The tab, the title and the image folder still say Untitled. A plain save changes none of them.
            if matches!(ready, SaveReady::Named) {
                reader.render(ScrollIntent::Preserve { code: None });
            }
        }
    }
}

/// One task marker moved by the box the reader ticked.
pub(crate) fn task_toggled(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    index: usize,
    token: Option<u64>,
) {
    toggle_task_marker(
        reader.webview.as_ref(),
        &mut reader.workspace,
        file_watch,
        vault_state,
        refresh_book,
        index,
        token,
    );
}

/// An inline reading-view edit spliced into the source buffer, then re-rendered from it, keeping the reader's place.
///
/// Source stays authoritative for MD and XML. A checkbox toggle writes to disk right away with no undo step. The decision is `edit_block_outcome` so a test can reach it; this keeps the doing.
pub(crate) fn edit_block(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    asked: &BlockEdit,
    token: Option<u64>,
) {
    match edit_block_outcome(&mut reader.workspace, asked) {
        BlockEditOutcome::Spliced { autosave, render } => {
            let unwritten = if autosave {
                let webview = reader.webview.as_ref();
                autosave_active_buffer(
                    &mut reader.workspace,
                    file_watch,
                    vault_state,
                    refresh_book,
                    webview,
                )
                .err()
            } else {
                None
            };
            if render {
                reader.render(ScrollIntent::Preserve { code: None });
            }
            // Host decides the Save/Undo buttons from the real dirty and undo state, not the frontend's guess. A failed auto-save leaves the buffer dirty, so this is what lights Save over the tick.
            resync_editing_state(reader.page(), &reader.workspace);
            // The buffer holds it either way - the splice landed. Where the write behind it did not, that is said rather than swallowed into the log: a box inside a table sends this command, so the log is nowhere its reader looks.
            let said = unwritten
                .map(|why| edit_unsaved_words(&front_document_name(&reader.workspace), &why));
            say_edit_outcome(reader.page(), token, true, said.as_deref());
        }
        // Nothing was written, so the dirty mark and the Undo button the page raised on its own come back down, and whoever is waiting is told the buffer holds nothing.
        BlockEditOutcome::Refused(why) => {
            let said = edit_refused_words(&front_document_name(&reader.workspace), &why);
            cleared_editing_state(reader.page());
            say_edit_outcome(reader.page(), token, false, Some(&said));
        }
    }
}

/// Several reading-view blocks rewritten in one buffer pass and one undo step.
pub(crate) fn edit_blocks(reader: &mut Reader, blocks: &[BlockReplacement]) {
    let changed = apply_block_replacements(&mut reader.workspace, blocks).map(|()| true);
    after_source_change(reader, changed);
}

/// What every frontmatter and block change ends with: the document drawn again where something moved, the chrome put back in step, and a refusal said in the reader's words.
///
/// Drawn again rather than patched in place: a field other things read has to change everywhere it is shown, not only in the cell it was typed into.
fn after_source_change(reader: &mut Reader, changed: Result<bool, String>) {
    match changed {
        Ok(true) => {
            reader.render(ScrollIntent::Preserve { code: None });
            resync_editing_state(reader.page(), &reader.workspace);
        }
        Ok(false) => {}
        Err(why) => say_edit_refused(reader.page(), &reader.workspace, &why),
    }
}

/// One frontmatter field written, or taken out when there is no value.
pub(crate) fn set_frontmatter_field(reader: &mut Reader, key: &str, value: Option<&str>) {
    let edit = match value {
        Some(value) => FieldEdit::Set(value),
        None => FieldEdit::Remove,
    };
    let changed = apply_field_edit(&mut reader.workspace, key, edit);
    after_source_change(reader, changed);
}

/// One frontmatter field written as a list.
pub(crate) fn set_frontmatter_list(reader: &mut Reader, key: &str, items: &[String]) {
    let changed = apply_field_edit(&mut reader.workspace, key, FieldEdit::SetList(items));
    after_source_change(reader, changed);
}

/// One frontmatter field's key renamed, keeping its value and its place in the block.
pub(crate) fn rename_frontmatter_field(reader: &mut Reader, key: &str, to: &str) {
    let changed = apply_field_edit(&mut reader.workspace, key, FieldEdit::Rename(to));
    after_source_change(reader, changed);
}

/// One run of sibling blocks reordered by a drag in the reading view.
pub(crate) fn move_source_block(
    reader: &mut Reader,
    ranges: &[(usize, usize)],
    from: usize,
    to: usize,
) {
    let changed = apply_block_move(&mut reader.workspace, ranges, from, to);
    after_source_change(reader, changed);
}

/// The picture picker for the reading view's insert box. The window blocks this thread, like Open's does. What comes back is a destination for the document to hold, not a file to copy: the picture stays where the user keeps it.
pub(crate) fn pick_image(reader: &mut Reader, file_watch: &mut FileWatch, token: u64) {
    let Some(image) = pick_image_file() else {
        return;
    };
    // The window stood open while the loop was blocked, so the file may have moved under it. The answer below carries offsets the page read before that, so the view is brought back in step first: a moved file redraws, and the redraw clears the page's pending writer, so the picture is dropped instead of spliced into text nobody has seen.
    reload_if_file_moved(reader, file_watch);
    let source = reader
        .workspace
        .active_path()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let destination = markdown_image_insert_destination(&image, &source);
    let alt = image
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    run_page_script(
        reader.page(),
        &image_picked_script(token, &destination, &alt),
        "Failed to hand the page the picked image",
    );
}

/// Where a diagram goes, asked before anything is drawn. The window blocks this thread, like Open's does. The document in front only names the file it suggests; nothing about it is read or written.
pub(crate) fn pick_diagram(reader: &Reader, token: u64, format: Option<&str>) {
    let stem = reader
        .workspace
        .active_path()
        .and_then(Path::file_stem)
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "diagram".to_string());
    if let Some(target) = pick_diagram_path(&format!("{stem}-diagram"), format) {
        run_page_script(
            reader.page(),
            &diagram_path_picked_script(token, &target.display().to_string()),
            "Failed to answer where a diagram goes",
        );
    }
}

/// A diagram written as a picture. No window here: the page asked where it goes before it drew anything, so this is the write and nothing else.
pub(crate) fn write_diagram(
    reader: &Reader,
    format: &str,
    data: &str,
    path: &str,
    width: u32,
    height: u32,
) {
    export_diagram(reader.page(), format, data, Path::new(path), width, height);
}

/// A diagram written as a PDF. No window here either; the render blocks this thread, the way the page export's does.
pub(crate) fn write_diagram_pdf(reader: &Reader, path: &str, width: f64, height: f64) {
    print_diagram_pdf(reader.page(), Path::new(path), width, height);
}

/// Where a picture goes, asked before anything is drawn or copied. The window blocks this thread, like Open's does. The picture's own file is what names the file it suggests; nothing about the open document is read or written.
pub(crate) fn pick_picture(reader: &Reader, token: u64, source: &str, format: Option<&str>) {
    let Some(file) = file_cmds::picture_source_path(reader, source) else {
        return;
    };
    let stem = file
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "picture".to_string());
    if let Some(target) = pick_picture_path(&stem, format) {
        run_page_script(
            reader.page(),
            &picture_path_picked_script(token, &target.display().to_string()),
            "Failed to answer where a picture goes",
        );
    }
}

/// A picture written out as a file of its own. No window here: the page asked where it goes before it did anything, so this is the write and nothing else.
pub(crate) fn write_picture(
    reader: &Reader,
    format: &str,
    source: &str,
    path: &str,
    alt: &str,
    data: &str,
) {
    let Some(file) = file_cmds::picture_source_path(reader, source) else {
        return;
    };
    export_picture(reader.page(), format, &file, Path::new(path), alt, data);
}

/// A picture written as a PDF. No window here either; the render blocks this thread, the way the diagram print's does.
pub(crate) fn write_picture_pdf(reader: &Reader, path: &str, width: f64, height: f64) {
    print_picture_pdf(reader.page(), Path::new(path), width, height);
}

/// The page written out as a sheet or a picture. The window blocks this thread, like Open's does, and so does the render after it.
pub(crate) fn export_pdf(reader: &Reader, format: String, width: f64, height: f64) {
    let export = page_export_request(&reader.workspace, format, width, height);
    export_page(
        reader.page(),
        export.document.as_deref(),
        &export.format,
        reader.window.scale_factor(),
        export.width,
        export.height,
    );
}

/// The page written out as a web page. Pictures are addressed against the folder the open document sits in, the same way the page addresses them on screen. No window here: the reader said where the page goes before it was asked for any of this.
pub(crate) fn export_html(reader: &Reader, path: &str, export: &PageHtmlExport) {
    let source_dir = reader
        .workspace
        .active_path()
        .and_then(local_image_source_dir);
    export_page_html(
        reader.page(),
        Path::new(path),
        export,
        source_dir.as_deref(),
    );
}

/// The buffer back one edit, drawn again, and resynced so undoing the only edit also clears the Save button.
pub(crate) fn undo_edit(reader: &mut Reader) {
    if reader
        .workspace
        .active_edit_mut()
        .is_some_and(EditableDocument::undo)
    {
        reader.render(ScrollIntent::Preserve { code: None });
        resync_editing_state(reader.page(), &reader.workspace);
    }
}

/// The other direction of the same history, ending in the same resync: a redo that spends the last future step has to take the Redo button away with it.
pub(crate) fn redo_edit(reader: &mut Reader) {
    if reader
        .workspace
        .active_edit_mut()
        .is_some_and(EditableDocument::redo)
    {
        reader.render(ScrollIntent::Preserve { code: None });
        resync_editing_state(reader.page(), &reader.workspace);
    }
}
