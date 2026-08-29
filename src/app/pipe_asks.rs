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
pub(crate) fn doc(reader: &mut Reader, path: &Path, reply: &PipeReply) {
    let answer = match pipe_bring_to_front(&mut reader.workspace, path) {
        Ok(moved) => {
            let rendered = if moved {
                reader.render_for_pipe(ScrollIntent::Reset)
            } else {
                Ok(())
            };
            pipe_document_answer_after_render(&mut reader.workspace, rendered)
        }
        Err(reason) => Err(reason),
    };
    let _ = reply.try_send(answer);
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
    if answer.is_ok() {
        reader.render(ScrollIntent::Preserve { code: None });
        resync_editing_state(reader.page(), &reader.workspace);
    }
    let _ = reply.try_send(answer);
}

/// One task marker checked or cleared and the file written at once. No render: one marker byte changed, and the resync inside the toggle is what the reader's own checkbox does with it.
pub(crate) fn task(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    path: &Path,
    index: usize,
    expect: &str,
    reply: &PipeReply,
) {
    let answer = pipe_toggle_task(
        reader.webview.as_ref(),
        &mut reader.workspace,
        file_watch,
        path,
        index,
        expect,
    );
    let _ = reply.try_send(answer);
}

/// The document at the front written back to its file, through the same save the page's own Save button runs.
pub(crate) fn save(
    reader: &mut Reader,
    file_watch: &mut FileWatch,
    vault_state: &VaultState,
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
