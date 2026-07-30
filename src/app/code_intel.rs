//! Answering the code view's typing help: completions, hover and the
//! broken-link check, each computed on a worker from what the loop holds.
//!
//! The shape is one round trip: the page asks with a token, the answer comes
//! back as [`UserEvent::CodeIntelReady`] carrying the script that delivers it.
//! What the answers are drawn from is [`IntelSource`]: the vault's corpus when
//! the vault holds the open document, the document's own folder otherwise —
//! the same boundary the graph draws, so typing help can never read more of
//! the disk than the map would.

use super::*;

/// Where note names come from for one ask. Cloned cheaply into the worker:
/// the corpus is behind an `Arc`, the folder is just a path it reads itself.
pub(crate) enum IntelSource {
    Corpus(Arc<VaultCorpus>),
    Folder(PathBuf),
}

/// The source for the active document's asks. Kicks off the one corpus read
/// when the vault holds the document but its text is not in memory yet — that
/// ask is answered from the folder, the next from the corpus.
fn intel_source(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    document: Option<&Path>,
) -> Option<IntelSource> {
    let document = document?;
    if let Some(root) = state.root.clone() {
        if vault_holds(&root, document) {
            if let Some(corpus) = state.corpus.clone() {
                return Some(IntelSource::Corpus(corpus));
            }
            read_corpus(state, proxy);
        }
    }
    document
        .parent()
        .map(|folder| IntelSource::Folder(folder.to_path_buf()))
}

/// The note a `[[name]]` points at, read through the source. IO on the folder
/// arm, so callers run this on the worker.
fn intel_note(source: &Option<IntelSource>, name: &str) -> Option<CorpusDocument> {
    match source {
        Some(IntelSource::Corpus(corpus)) => find_note(name, &corpus.documents).cloned(),
        Some(IntelSource::Folder(folder)) => read_folder_note(name, folder),
        None => None,
    }
}

/// The notes `[[` can offer.
pub(crate) fn code_complete_notes(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    document: Option<&Path>,
    token: u64,
) {
    let source = intel_source(state, proxy, document);
    off_loop(proxy, move || {
        let notes = match &source {
            Some(IntelSource::Corpus(corpus)) => corpus_note_items(&corpus.documents, &corpus.root),
            Some(IntelSource::Folder(folder)) => folder_note_items(folder),
            None => Vec::new(),
        };
        UserEvent::CodeIntelReady {
            script: code_intel_notes_script(token, &notes),
        }
    });
}

/// The headings `[[note#` (a named note) or `](#` (`note` absent — the active
/// buffer itself) can offer.
pub(crate) fn code_complete_headings(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    workspace: &Workspace,
    token: u64,
    note: Option<String>,
) {
    let document = workspace.active_path().map(Path::to_path_buf);
    let source = match note {
        Some(_) => intel_source(state, proxy, document.as_deref()),
        None => None,
    };
    // The buffer, not the disk: the anchors on offer must be the anchors the
    // text on screen has.
    let active = workspace
        .active_edit()
        .map(|edit| (edit.text().to_string(), edit.path.clone()));
    off_loop(proxy, move || {
        let headings = match note {
            Some(name) => intel_note(&source, &name)
                .map(|found| document_headings(&found.text, Path::new(&found.path)))
                .unwrap_or_default(),
            None => active
                .map(|(text, path)| document_headings(&text, &path))
                .unwrap_or_default(),
        };
        UserEvent::CodeIntelReady {
            script: code_intel_headings_script(token, &headings),
        }
    });
}

/// The hover card over `[[note]]`: its opening lines, or nothing.
pub(crate) fn code_hover_note(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    document: Option<&Path>,
    token: u64,
    note: String,
) {
    let source = intel_source(state, proxy, document);
    off_loop(proxy, move || {
        let hover = intel_note(&source, &note)
            .map(|found| (found.label.clone(), note_preview(&found.text)));
        UserEvent::CodeIntelReady {
            script: code_intel_hover_script(
                token,
                hover
                    .as_ref()
                    .map(|(label, text)| (label.as_str(), text.as_str())),
            ),
        }
    });
}

/// Check the active buffer's links and answer with the ranges to underline.
pub(crate) fn code_lint(
    state: &mut VaultState,
    proxy: &EventLoopProxy<UserEvent>,
    workspace: &Workspace,
    token: u64,
) {
    let source = intel_source(state, proxy, workspace.active_path());
    let active = workspace
        .active_edit()
        .map(|edit| (edit.text().to_string(), edit.path.clone()));
    off_loop(proxy, move || {
        let markers = match active {
            Some((text, path)) => {
                let names = match &source {
                    Some(IntelSource::Corpus(corpus)) => known_note_names(&corpus.documents),
                    Some(IntelSource::Folder(folder)) => folder_note_names(folder),
                    None => Default::default(),
                };
                lint_links(&text, &path, &names)
            }
            None => Vec::new(),
        };
        UserEvent::CodeIntelReady {
            script: code_intel_lint_script(token, &markers),
        }
    });
}
