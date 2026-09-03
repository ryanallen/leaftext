//! What the ask pipe's arms do, one function each: bring the document to the front, call the helper that already owns the work, put the window back in step, and answer.
//!
//! The work itself lives in `editing_cmds.rs`, `fileops.rs` and `events.rs`, and `eval_ask.rs` holds the evaluate ask beside these. The asks that end the app — quit and close — stay in the loop, because they reach `shut_down` and the loop's `control_flow`.
//!
//! Every answer goes back with `try_send` rather than `send`: the asker may already have given up and gone, and the window thread must not block on a dead channel.

use super::*;

/// What the app has open, off the workspace and the vaults. No window in the answer, which is what lets a test build the half that matters.
pub(crate) fn state(reader: &Reader, vault_state: &VaultState, reply: &PipeReply) {
    let _ = reply.try_send(Ok(pipe_state(&reader.workspace, vault_state)));
}

/// A document's source, spelling, unsaved state and fingerprint — with the file brought to the front first, which is the one honest visible effect of an agent reading a document: the window shows what it is holding, exactly as if somebody had opened it.
///
/// The fingerprint this answers is what a later write has to quote back, so it is taken over the file rather than over a copy the app has been sitting on. Arriving at a document reconciles inside the render; a document already at the front — every read after the first — reconciles here instead.
pub(crate) fn doc(reader: &mut Reader, path: &Path, reply: &PipeReply) {
    let _ = reply.try_send(document_answer(reader, path));
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DocumentReadStep {
    Answer,
    Redraw,
}

pub(crate) fn document_read_step(took_disk: bool) -> DocumentReadStep {
    if took_disk {
        DocumentReadStep::Redraw
    } else {
        DocumentReadStep::Answer
    }
}

fn document_answer(reader: &mut Reader, path: &Path) -> Result<serde_json::Value, String> {
    if pipe_bring_to_front(&mut reader.workspace, path)? {
        // Arriving at a document renders, and the render is where a buffer takes the file.
        let rendered = reader.render_for_pipe(ScrollIntent::Reset);
        return pipe_document_answer_after_render(&mut reader.workspace, rendered);
    }
    let (took_disk, answer) = pipe_document_read(&mut reader.workspace)?;
    match document_read_step(took_disk) {
        DocumentReadStep::Answer => {}
        // The page is drawn from words the buffer has just replaced. Redraw in place, the way the live reload does.
        DocumentReadStep::Redraw => {
            reader.render_for_pipe(ScrollIntent::Preserve { code: None })?;
        }
    }
    Ok(answer)
}

pub(crate) fn pipe_document_answer_after_render(
    workspace: &mut Workspace,
    rendered: Result<(), String>,
) -> Result<serde_json::Value, String> {
    rendered?;
    pipe_document_answer(workspace)
}

/// A byte range spliced as one undo step, then straight back on screen the way a reading-view edit is: the render restores a tab left in source from the same buffer, so either view shows what the agent wrote.
pub(crate) fn edit(
    reader: &mut Reader,
    path: &Path,
    start: usize,
    end: usize,
    text: &str,
    expect: &str,
    reply: &PipeReply,
) {
    let answer = pipe_edit_document(&mut reader.workspace, path, start, end, text, expect);
    redraw_after_pipe_write(reader);
    let _ = reply.try_send(answer);
}

/// Put the window back in step with the buffer after a pipe write, which is why every one of them draws on a refusal. The guard brings a clean buffer up to the file before it compares, so a write that comes back refused is one that may have left the page drawn from words nobody holds. Only the error path pays for it.
fn redraw_after_pipe_write(reader: &mut Reader) {
    reader.render(ScrollIntent::Preserve { code: None });
    resync_editing_state(reader.page(), &reader.workspace);
}

/// One task marker checked or cleared and the file written at once. No render where it lands: one marker byte changed, and the resync inside the toggle is what the reader's own checkbox does with it.
pub(crate) fn task(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    path: &Path,
    index: usize,
    expect: &str,
    reply: &PipeReply,
) {
    let answer = pipe_toggle_task(
        reader.webview.as_ref(),
        &mut reader.workspace,
        file_watch,
        vault_state,
        refresh_book,
        path,
        index,
        expect,
    );
    if answer.is_err() {
        redraw_after_pipe_write(reader);
    }
    let _ = reply.try_send(answer);
}

/// The document at the front written back to its file, through the same save the page's own Save button runs.
pub(crate) fn save(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &mut VaultState,
    refresh_book: &mut RefreshBook,
    path: &Path,
    expect: &str,
    reply: &PipeReply,
) {
    let answer = pipe_save_document(
        reader.webview.as_ref(),
        &mut reader.workspace,
        file_watch,
        vault_state,
        refresh_book,
        path,
        expect,
    );
    if answer.is_err() {
        redraw_after_pipe_write(reader);
    }
    let _ = reply.try_send(answer);
}

/// The Export button's own render with the dialog taken out of the way, so a session can make one of these files and read it back. The loop is inside the render, which is why this ask gets a longer wait than the rest.
pub(crate) fn export(reader: &Reader, path: &Path, width: f64, height: f64, reply: &PipeReply) {
    let answer = write_page_pdf_at(reader.webview.as_ref(), path, width, height).map(|()| {
        serde_json::json!({
            "wrote": path.display().to_string(),
            "width": width,
            "height": height,
        })
    });
    let _ = reply.try_send(answer);
}

/// The picture the Export button's picture rows write, at a path the asker named. The render is inside the loop, which is why this ask waits as long as an export does.
pub(crate) fn shot(reader: &Reader, path: &Path, width: f64, height: f64, reply: &PipeReply) {
    let scale = reader.window.scale_factor();
    let answer = page_picture_answer(reader.webview.as_ref(), scale, path, width, height);
    let _ = reply.try_send(answer);
}
