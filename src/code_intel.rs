//! What the code view's suggestion popup knows.
//!
//! Monaco supplies the popup, the hover card and the underline; this module
//! supplies the answers, from what Leaf already holds — the vault's corpus, the
//! document's own folder, and the same link scan the graph draws from. Nothing
//! here reads beyond what the user pointed at: the active vault, or the open
//! document's folder, one level and no further.
//!
//! Everything is a plain function over text and paths, so the binary can run it
//! on a worker and the tests can call it directly.

use crate::store::{document_links, normalize_name_key};
use crate::vault_corpus::{read_document, CorpusDocument};
use crate::{
    append_title_text, normalize_title_whitespace, parse_markdown_source,
    register_markdown_extensions, MarkdownParserConfig,
};

use pulldown_cmark::{Event, Tag, TagEnd};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

/// One note the popup can offer after `[[`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    /// The wiki name: the file name without its extension.
    pub label: String,
    /// Where it lives, shown small beside the name — the folder, relative to
    /// the vault when there is one, so two notes sharing a name stay tellable.
    pub detail: String,
}

/// One heading the popup can offer after `[[note#` or `](#`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeadingItem {
    /// The heading as written, for `[[note#Heading]]`.
    pub text: String,
    /// The renderer's anchor for it, for `](#slug)`.
    pub slug: String,
}

/// One broken link, as the range Monaco underlines. Lines and columns are
/// 1-based, columns in UTF-16 units — the editor's own coordinates, computed
/// here so the page never re-walks the text.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LintMarker {
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub message: String,
}

/// The notes a vault can offer, one per document, named the way `[[wiki]]`
/// names resolve (the graph matches on the same label).
pub fn corpus_note_items(documents: &[CorpusDocument], root: &Path) -> Vec<NoteItem> {
    let mut items: Vec<NoteItem> = documents
        .iter()
        .map(|document| NoteItem {
            label: document.label.clone(),
            detail: parent_detail(Path::new(&document.path), Some(root)),
        })
        .collect();
    sort_note_items(&mut items);
    items
}

/// The notes one folder can offer — what a document outside every vault gets.
/// Reads the directory listing and nothing inside the files.
pub fn folder_note_items(folder: &Path) -> Vec<NoteItem> {
    let mut items: Vec<NoteItem> = crate::doc_graph::folder_documents(folder)
        .iter()
        .filter_map(|path| {
            Some(NoteItem {
                label: path.file_stem()?.to_string_lossy().to_string(),
                detail: parent_detail(path, None),
            })
        })
        .collect();
    sort_note_items(&mut items);
    items
}

fn sort_note_items(items: &mut [NoteItem]) {
    items.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
}

/// The folder shown beside a note's name: relative to the vault root when the
/// note is under one, the folder's own name otherwise, empty at the top.
fn parent_detail(path: &Path, root: Option<&Path>) -> String {
    let Some(parent) = path.parent() else {
        return String::new();
    };
    match root {
        Some(root) => match parent.strip_prefix(root) {
            Ok(rel) if rel.as_os_str().is_empty() => String::new(),
            Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
            Err(_) => parent.to_string_lossy().to_string(),
        },
        None => parent
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

/// Every name `[[wiki]]` links can resolve against, in the key both sides
/// match on — the same normalization the graph uses.
pub fn known_note_names(documents: &[CorpusDocument]) -> HashSet<String> {
    documents
        .iter()
        .map(|document| normalize_name_key(&document.label))
        .collect()
}

/// The same set from one folder's listing, for a document no vault holds.
pub fn folder_note_names(folder: &Path) -> HashSet<String> {
    crate::doc_graph::folder_documents(folder)
        .iter()
        .filter_map(|path| path.file_stem())
        .map(|stem| normalize_name_key(&stem.to_string_lossy()))
        .collect()
}

/// Find the note a `[[name]]` points at among `documents` — the corpus, or a
/// folder's freshly read documents. First match wins, as in the graph.
pub fn find_note<'a>(name: &str, documents: &'a [CorpusDocument]) -> Option<&'a CorpusDocument> {
    let key = normalize_name_key(name);
    documents
        .iter()
        .find(|document| normalize_name_key(&document.label) == key)
}

/// Read the note `[[name]]` points at out of one folder, for a document no
/// vault holds. One directory listing and at most one file read.
pub fn read_folder_note(name: &str, folder: &Path) -> Option<CorpusDocument> {
    let key = normalize_name_key(name);
    let path = crate::doc_graph::folder_documents(folder)
        .into_iter()
        .find(|path| {
            path.file_stem()
                .is_some_and(|stem| normalize_name_key(&stem.to_string_lossy()) == key)
        })?;
    read_document(&path)
}

/// A document's headings, each with the exact anchor the renderer stamps on it.
///
/// Runs the renderer's own pipeline (`register_markdown_extensions` ends by
/// assigning heading ids) and reads the ids back off the events — one
/// definition of a slug, so a completed `](#anchor)` always lands.
pub fn document_headings(text: &str, path: &Path) -> Vec<HeadingItem> {
    let events = parse_markdown_source(text, MarkdownParserConfig::github_flavored());
    let events = register_markdown_extensions(events, path);
    let mut out = Vec::new();
    let mut capture: Option<(String, String)> = None;
    for event in events {
        match event {
            Event::Start(Tag::Heading { id, .. }) => {
                let slug = id.map(|id| id.to_string()).unwrap_or_default();
                capture = Some((slug, String::new()));
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((slug, text)) = capture.take() {
                    if slug.is_empty() {
                        continue;
                    }
                    let title = normalize_title_whitespace(&text);
                    out.push(HeadingItem {
                        text: if title.is_empty() {
                            slug.clone()
                        } else {
                            title
                        },
                        slug,
                    });
                }
            }
            other => {
                if let Some((_, text)) = capture.as_mut() {
                    append_title_text(&other, text);
                }
            }
        }
    }
    out
}

/// How much of a note the hover card shows.
const PREVIEW_MAX_LINES: usize = 12;
const PREVIEW_MAX_CHARS: usize = 700;

/// A note's opening lines, for the hover card. Markdown as written — the card
/// renders it — cut at a line boundary with an ellipsis when there is more.
pub fn note_preview(text: &str) -> String {
    let mut preview = String::new();
    let mut lines = 0usize;
    let mut truncated = false;
    // Leading blank lines say nothing; skip to the first line with content.
    let mut rest = text.lines().skip_while(|line| line.trim().is_empty());
    for line in rest.by_ref() {
        if lines >= PREVIEW_MAX_LINES || preview.len() + line.len() > PREVIEW_MAX_CHARS {
            // Only content counts as "more" — a tail of blank lines does not.
            truncated = !line.trim().is_empty() || rest.any(|left| !left.trim().is_empty());
            break;
        }
        preview.push_str(line);
        preview.push('\n');
        lines += 1;
    }
    let mut preview = preview.trim_end().to_string();
    if truncated {
        preview.push_str("\n…");
    }
    preview
}

/// Every link in `text` that points at nothing: a path with no file behind it,
/// or a `[[name]]` no known note answers to. `known_names` is the vault's (or
/// the folder's) note names in [`normalize_name_key`] form.
///
/// Web addresses are never checked — nothing local can vouch for them — and a
/// link the scan cannot place in the source draws no marker.
pub fn lint_links(text: &str, path: &Path, known_names: &HashSet<String>) -> Vec<LintMarker> {
    let mut broken: Vec<((usize, usize), String)> = Vec::new();
    for link in document_links(text, path) {
        let Some(span) = link.span else {
            continue;
        };
        if let Some(abs) = &link.target_abs {
            if !Path::new(abs).exists() {
                broken.push((span, "Broken link: nothing is at this path.".to_string()));
            }
        } else if let Some(name) = &link.target_name {
            if !known_names.contains(name) {
                broken.push((span, "Broken link: no note has this name.".to_string()));
            }
        }
    }
    broken.sort_by_key(|(span, _)| *span);

    // One walk of the text turns every byte offset into the editor's own
    // coordinates. Sorted and deduped first: two scans can place overlapping
    // spans, so the flattened ends are not in order on their own.
    let mut offsets: Vec<usize> = broken
        .iter()
        .flat_map(|((start, end), _)| [*start, *end])
        .collect();
    offsets.sort_unstable();
    offsets.dedup();
    let positions = positions_at(text, &offsets);
    let position_of = |offset: usize| {
        let index = offsets.binary_search(&offset).unwrap_or(0);
        positions[index]
    };
    broken
        .into_iter()
        .map(|((start, end), message)| {
            let (start_line, start_col) = position_of(start);
            let (end_line, end_col) = position_of(end);
            LintMarker {
                start_line,
                start_col,
                end_line,
                end_col,
                message,
            }
        })
        .collect()
}

/// The (line, column) for each byte offset, both 1-based, columns in UTF-16
/// units — the editor's own coordinates. `offsets` must be sorted; an offset
/// past the end lands on the last position, and one inside a code point on the
/// position of that code point.
fn positions_at(text: &str, offsets: &[usize]) -> Vec<(u32, u32)> {
    let mut out = Vec::with_capacity(offsets.len());
    let mut next = offsets.iter().peekable();
    let mut line = 1u32;
    let mut col = 1u32;
    let mut byte = 0usize;
    for ch in text.chars() {
        while next.peek().is_some_and(|&&wanted| wanted <= byte) {
            next.next();
            out.push((line, col));
        }
        byte += ch.len_utf8();
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += ch.len_utf16() as u32;
        }
    }
    while next.next().is_some() {
        out.push((line, col));
    }
    out
}
