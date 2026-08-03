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

use crate::store::{
    alias_count, aliases_from, document_fields, document_links, frontmatter_key_span,
    normalize_name_key, MAX_ALIASES,
};
use crate::vault_corpus::{read_document, CorpusDocument};
use crate::{
    append_title_text, normalize_title_whitespace, parse_markdown_source,
    register_markdown_extensions, MarkdownParserConfig,
};

use pulldown_cmark::{Event, Tag, TagEnd};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

/// The notes a vault can offer, named every way `[[wiki]]` names resolve — a row
/// per file name, and a row per alias, because a name that resolves and is not
/// offered is one somebody has to already know about.
pub fn corpus_note_items(documents: &[CorpusDocument], root: &Path) -> Vec<NoteItem> {
    let mut items: Vec<NoteItem> = documents
        .iter()
        .flat_map(|document| {
            let detail = parent_detail(Path::new(&document.path), Some(root));
            note_rows(&document.label, &document.aliases, detail)
        })
        .collect();
    sort_note_items(&mut items);
    items
}

/// The notes one folder can offer — what a document outside every vault gets.
/// The names come off the listing; the aliases cost the top of each file.
pub fn folder_note_items(folder: &Path) -> Vec<NoteItem> {
    let mut items: Vec<NoteItem> = folder_notes(folder)
        .into_iter()
        .flat_map(|note| {
            let detail = parent_detail(&note.path, None);
            note_rows(&note.label, &note.aliases, detail)
        })
        .collect();
    sort_note_items(&mut items);
    items
}

/// One row for the file name, then one per alias. An alias's row says which file
/// it belongs to, because the alias alone does not say what will open.
fn note_rows(label: &str, aliases: &[String], detail: String) -> Vec<NoteItem> {
    let mut rows = vec![NoteItem {
        label: label.to_string(),
        detail,
    }];
    rows.extend(aliases.iter().map(|alias| NoteItem {
        label: alias.clone(),
        detail: label.to_string(),
    }));
    rows
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

/// Every name `[[wiki]]` links can resolve against, and which notes claim each
/// one. Keys are `normalize_name_key`'s — the same normalization the graph uses.
///
/// More than one claimant is a real state of a vault rather than a mistake in a
/// link: a note preferring a name another note is called, or two notes preferring
/// the same one. The link resolves to the first, and the check can say so.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NoteNames {
    claims: HashMap<String, Vec<String>>,
}

impl NoteNames {
    /// Build from each note's names — its label, then its aliases. Every label
    /// goes in before any alias, so a name somebody typed on disk is always the
    /// first claimant of it.
    fn new(notes: Vec<(String, Vec<String>)>) -> Self {
        let mut claims: HashMap<String, Vec<String>> = HashMap::new();
        for (label, _) in &notes {
            claims
                .entry(normalize_name_key(label))
                .or_default()
                .push(label.clone());
        }
        for (label, aliases) in &notes {
            for alias in aliases {
                claims
                    .entry(normalize_name_key(alias))
                    .or_default()
                    .push(label.clone());
            }
        }
        Self { claims }
    }

    /// Whether any note answers to this key.
    pub fn contains(&self, key: &str) -> bool {
        self.claims.contains_key(key)
    }

    /// The notes claiming this key, in the order a link resolves them: the first
    /// is the one it opens.
    fn claimants(&self, key: &str) -> &[String] {
        self.claims.get(key).map_or(&[], Vec::as_slice)
    }
}

/// Every name a vault answers to, with its claimants.
pub fn known_note_names(documents: &[CorpusDocument]) -> NoteNames {
    NoteNames::new(
        documents
            .iter()
            .map(|document| (document.label.clone(), document.aliases.clone()))
            .collect(),
    )
}

/// How much of a file is opened to find its aliases. The frontmatter block is at
/// the top of the file, and this is past any real one — a block longer than this
/// has no closing fence inside it, so the note simply has no aliases.
const ALIAS_HEAD_BYTES: usize = 8 * 1024;

/// One note in a folder: the name off the listing, and the other names it answers
/// to. The aliases are inside the file, so this is the only thing here that opens
/// one, and it opens only the head.
struct FolderNote {
    path: PathBuf,
    label: String,
    aliases: Vec<String>,
}

/// Every note one folder offers, with its aliases. One directory listing and a
/// head read per file, capped at [`crate::doc_graph::MAX_DOCUMENTS`] — the cap
/// the map around a loose document already reads to. One folder, never a tree.
fn folder_notes(folder: &Path) -> Vec<FolderNote> {
    crate::doc_graph::folder_documents(folder)
        .into_iter()
        .take(crate::doc_graph::MAX_DOCUMENTS)
        .filter_map(|path| {
            let label = path.file_stem()?.to_string_lossy().to_string();
            let aliases = folder_note_aliases(&path, &label);
            Some(FolderNote {
                path,
                label,
                aliases,
            })
        })
        .collect()
}

/// One file's aliases, from the top of it. Unreadable is no aliases, the way an
/// unreadable file is no document everywhere else.
fn folder_note_aliases(path: &Path, label: &str) -> Vec<String> {
    crate::read_source_head(path, ALIAS_HEAD_BYTES)
        .ok()
        .map(|source| aliases_from(&document_fields(&source.text), label))
        .unwrap_or_default()
}

/// The same from one folder, for a document no vault holds: the listing's names,
/// and each file's aliases.
pub fn folder_note_names(folder: &Path) -> NoteNames {
    NoteNames::new(
        folder_notes(folder)
            .into_iter()
            .map(|note| (note.label, note.aliases))
            .collect(),
    )
}

/// Find the note a `[[name]]` points at among `documents` — the corpus, or a
/// folder's freshly read documents. First match wins, as in the graph.
pub fn find_note<'a>(name: &str, documents: &'a [CorpusDocument]) -> Option<&'a CorpusDocument> {
    let key = normalize_name_key(name);
    // The label pass runs to the end before any alias is tried, so a real file
    // name beats another note's alias — the same order the graph builds its index.
    documents
        .iter()
        .find(|document| normalize_name_key(&document.label) == key)
        .or_else(|| {
            documents.iter().find(|document| {
                document
                    .aliases
                    .iter()
                    .any(|alias| normalize_name_key(alias) == key)
            })
        })
}

/// Read the note `[[name]]` points at out of one folder, for a document no
/// vault holds. One directory listing, then at most one whole file read.
///
/// A file name is tried against the listing alone, so the common case still opens
/// nothing it does not return. Only a name no file is called falls back to the
/// aliases, which are inside the files.
pub fn read_folder_note(name: &str, folder: &Path) -> Option<CorpusDocument> {
    let key = normalize_name_key(name);
    let listed = crate::doc_graph::folder_documents(folder);
    let named = listed.iter().find(|path| {
        path.file_stem()
            .is_some_and(|stem| normalize_name_key(&stem.to_string_lossy()) == key)
    });
    match named {
        Some(path) => read_document(path),
        None => {
            let aliased = listed
                .iter()
                .take(crate::doc_graph::MAX_DOCUMENTS)
                .find(|path| {
                    let label = path.file_stem().unwrap_or_default().to_string_lossy();
                    folder_note_aliases(path, &label)
                        .iter()
                        .any(|alias| normalize_name_key(alias) == key)
                })?;
            read_document(aliased)
        }
    }
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
/// the folder's) note names in `normalize_name_key` form.
///
/// Web addresses are never checked — nothing local can vouch for them — and a
/// link the scan cannot place in the source draws no marker.
pub fn lint_links(text: &str, path: &Path, known_names: &NoteNames) -> Vec<LintMarker> {
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
            } else if let Some(message) = shared_name_notice(known_names.claimants(name)) {
                broken.push((span, message));
            }
        }
    }
    if let Some(notice) = alias_cap_notice(text, path) {
        broken.push(notice);
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

/// What to say about a name more than one note answers to: which note the link
/// opens, and which others wanted it. Nothing when only one note claims it.
fn shared_name_notice(claimants: &[String]) -> Option<String> {
    let (opens, others) = claimants.split_first()?;
    if others.is_empty() {
        return None;
    }
    Some(format!(
        "This opens {opens}. {} also answers to this name.",
        others.join(", ")
    ))
}

/// The note's own `aliases` field when it claims more than the cap keeps, with the
/// range of the line that says so. A silently ignored alias is a link that will
/// never resolve and nothing anywhere saying why.
fn alias_cap_notice(text: &str, path: &Path) -> Option<((usize, usize), String)> {
    let label = path.file_stem().unwrap_or_default().to_string_lossy();
    let claimed = alias_count(&document_fields(text), &label);
    if claimed <= MAX_ALIASES {
        return None;
    }
    let span = frontmatter_key_span(text, "aliases")?;
    Some((
        span,
        format!("This note claims {claimed} aliases; only the first {MAX_ALIASES} are used."),
    ))
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
