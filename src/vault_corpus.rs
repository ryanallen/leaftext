//! A vault's text, held in memory.
//!
//! One read of the folder serves both things that need to see inside every document: the link graph, and search. Neither has an index behind it, so there is one copy of the truth — the files — and this is a cache of it that the watcher patches a file at a time.
//!
//! Nothing here is written to disk. Switching vaults drops it; quitting drops it; the next session reads again on first use.

use crate::read_source;
use crate::store::{
    document_fields, document_links, normalize_name_key, path_to_string, url_host_label,
    DocumentGraph, FieldType, FrontmatterField, GraphEdge, GraphNode, GraphRequest, SearchHit,
    SearchResults,
};
use crate::unique_heading_slug;
use crate::{Candidate as _, FieldAnswer, FieldValue as QueryValue, Needle, Query, TaskTally};

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// How many documents one vault may hold in memory. A vault is bounded by construction; this is the backstop for someone pointing one at a source tree.
pub const MAX_CORPUS_DOCUMENTS: usize = 25_000;

/// How much text one vault may hold. The count above does not bound memory, because the many files and the many bytes sit in different folders: measured on this repo, a count of 5,000 filled with 5 MB of build output and left every note somebody wrote unread.
const MAX_CORPUS_BYTES: usize = 32 * 1024 * 1024;

/// How much of one document is kept. Long enough for anything anyone reads; short enough that one enormous file cannot dominate the vault's footprint.
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

/// How deep the walk goes.
const MAX_DEPTH: usize = 24;

/// Cap on returned hits: past this, a query is one to narrow rather than scroll.
const SEARCH_LIMIT: usize = 50;

/// How many appearances of one term are worth counting. Past this the score is the same either way, so the walk stops rather than counting a whole document.
const SCORE_COUNT_CAP: usize = 20;

/// What a name match is worth, by how much of the name the term is. A file called exactly the term is the answer; the same letters buried inside a longer word are a hint. Names are a few dozen bytes, so telling these apart is free.
const NAME_SCORE_EXACT: f64 = 400.0;
const NAME_SCORE_PREFIX: f64 = 300.0;
const NAME_SCORE_WORD: f64 = 200.0;
const NAME_SCORE_ANYWHERE: f64 = 100.0;

/// A folder name counts, but weakly: everything under `notes/` matches "notes", so it says less about a document than the document's own name does.
const FOLDER_SCORE: f64 = 25.0;

/// A match inside a heading is what a section is about, so it outranks the same word in a paragraph. Only the finalists are checked, on the walk that already finds their heading.
const HEADING_SCORE: f64 = 50.0;

/// Body frequency is counted per this many bytes rather than per document: on raw count a 2 MB file beats a one-page note by being long, which crowds the top of the list with whatever is longest.
const FREQUENCY_WINDOW: f64 = 10_240.0;

/// The most one term's frequency can be worth, however small the file.
const FREQUENCY_CAP: f64 = 20.0;

/// How many matches in one document get a row of their own. One row per file hides where else the word is; a row per match buries every other file.
const ROWS_PER_DOCUMENT: usize = 3;

/// How many web addresses one document may put on the map. A link roll or a bibliography is a real document, and without a cap it would bury the notes around it under a hundred nodes nobody was looking for.
const MAX_EXTERNAL_LINKS_PER_DOCUMENT: usize = 25;

/// How many characters of context a snippet carries around its match.
const SNIPPET_RADIUS: usize = 90;

/// The markers a snippet wraps its match in. STX/ETX cannot occur in a document, so the page escapes the whole snippet for the DOM first and only then swaps these for `<mark>`.
const MARK_OPEN: char = '\u{2}';
const MARK_CLOSE: char = '\u{3}';

/// One document, as the corpus holds it.
///
/// Compared by value so a watcher tick reporting text identical to what is held can be answered with "nothing changed", the way live reload hash-gates itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorpusDocument {
    pub path: String,
    /// The file name without its extension: what the pane and the graph show.
    pub label: String,
    /// The other names it answers to, from its `aliases` field, as written. A wiki link, search and the popup match these as well as the label; the label is still the only name anything is *labeled* with.
    pub aliases: Vec<String>,
    pub text: String,
}

/// Every document under one vault root.
#[derive(Debug, Clone)]
pub struct VaultCorpus {
    pub root: PathBuf,
    pub documents: Vec<CorpusDocument>,
    /// Set when the read hit either limit, so the graph can say the picture is partial.
    pub truncated: bool,
}

impl VaultCorpus {
    /// Read the whole vault. The expensive call, made once per vault per session, on a background thread.
    pub fn read(root: &Path) -> Self {
        let mut found = Vec::new();
        collect_documents(root, 0, &mut found);
        // Smallest first, so the byte budget buys as many documents as it can: the whole of a vault of notes, and as much as fits of a folder of generated ones. The sizes came back off the same directory entries the walk had already read, so this costs no second look at the disk.
        found.sort_by_key(|(size, _)| *size);
        let mut truncated = found.len() > MAX_CORPUS_DOCUMENTS;
        found.truncate(MAX_CORPUS_DOCUMENTS);

        let mut held = 0;
        let mut documents = Vec::new();
        for (_, path) in found {
            if held >= MAX_CORPUS_BYTES {
                truncated = true;
                break;
            }
            let Some(document) = read_document(&path) else {
                continue;
            };
            held += document.text.len();
            documents.push(document);
        }
        Self {
            root: root.to_path_buf(),
            documents,
            truncated,
        }
    }

    /// How much text is held. A read of a length per document, so it costs nothing next to what it guards.
    fn held_bytes(&self) -> usize {
        self.documents
            .iter()
            .map(|document| document.text.len())
            .sum()
    }

    /// Whether a changed path is one this corpus holds text for. Asked before [`Self::refresh`], because getting that far can cost a clone of the whole corpus, and most of what the watcher reports is not a document.
    pub fn covers(&self, path: &Path) -> bool {
        path.starts_with(&self.root) && crate::is_supported_document_path(path)
    }

    /// Bring one path up to date after the watcher reports a change: re-read it, add it if it is new, drop it if it is gone. Cheaper than re-reading the vault, and it is what keeps search and the graph live while you edit.
    ///
    /// Returns whether the corpus is actually different afterwards. The watcher reports every write under the vault — `.git` bookkeeping, an image, a save whose bytes did not change — and the graph is redrawn off this answer, so "nothing changed" has to be sayable: unanswered, that churn tears the map down and rebuilds it over and over while someone is reading it.
    pub fn refresh(&mut self, path: &Path) -> bool {
        if !self.covers(path) {
            return false;
        }
        let key = path_to_string(path);
        let existing = self
            .documents
            .iter()
            .position(|document| document.path == key);
        match (read_document(path), existing) {
            (Some(fresh), Some(index)) => {
                if self.documents[index] == fresh {
                    return false;
                }
                self.documents[index] = fresh;
                true
            }
            // A document that appears while the vault is open joins it under the same two limits the first read held to, or the corpus grows past them one save at a time.
            (Some(fresh), None)
                if self.documents.len() < MAX_CORPUS_DOCUMENTS
                    && self.held_bytes() < MAX_CORPUS_BYTES =>
            {
                self.documents.push(fresh);
                true
            }
            (Some(_), None) => false,
            (None, Some(index)) => {
                self.documents.remove(index);
                true
            }
            (None, None) => false,
        }
    }

    /// The link graph over these documents. `request` narrows it: a focused neighborhood, the densest N, or all of it.
    pub fn graph(&self, request: &GraphRequest) -> DocumentGraph {
        let mut graph = narrow(build_graph(&self.documents), request);
        graph.truncated |= self.truncated;
        graph
    }

    /// Search the vault, with the filter syntax read against today's UTC date. The convenience door: anything with a reader behind it parses the query itself, so `friday` is the reader's Friday.
    pub fn search(&self, query: &str) -> SearchResults {
        self.search_until(&Query::parse(query, crate::utc_today()), None, &|| false)
            .unwrap_or_default()
    }

    /// The whole search: a document passes the parsed filter, then scores on the words in it. Hits are ranked name-first, then by how often those words appear. Scanning a few megabytes of RAM beats a round trip to SQLite, and it can never be out of step with the disk.
    ///
    /// Ranked before anything is drawn: a snippet, its line and its heading cost a walk of the document, and a broad query has hundreds of matches to show fifty of.
    ///
    /// `overtaken` is checked between documents: the field has moved on, so finishing is work for an answer nobody will read. One atomic load against a document's scan.
    ///
    /// `within` narrows the scan to the paths that matched a shorter query — sound only for a query of required words, which is the caller's half of the promise (see [`Query::is_plain`]).
    pub fn search_until(
        &self,
        query: &Query,
        within: Option<&[String]>,
        overtaken: &dyn Fn() -> bool,
    ) -> Option<SearchResults> {
        if query.is_empty() {
            return Some(SearchResults::default());
        }
        // Worked out once for the whole scan rather than per document: a plain query's words are all required, which is what lets one pass both accept and score a document.
        let needles = query.scoring_needles();
        let required = query.is_plain();
        // A set that holds the whole vault narrows nothing, and building it to discover that costs more than the scan saves — a one-letter query matches every document, so this is the common first keystroke.
        let narrowed: Option<HashSet<&str>> = within
            .filter(|paths| paths.len() < self.documents.len())
            .map(|paths| paths.iter().map(String::as_str).collect());

        let mut ranked: Vec<Candidate> = Vec::new();
        let mut matched: Vec<String> = Vec::new();
        for document in &self.documents {
            if let Some(paths) = &narrowed {
                if !paths.contains(document.path.as_str()) {
                    continue;
                }
            }
            if overtaken() {
                return None;
            }
            // A plain query is proved by the scan below, which is why it does not pay for a pass of its own — the words it needs are exactly the words it scores.
            if !required && !query.matches(&DocumentCandidate::new(document)) {
                continue;
            }
            if let Some(candidate) = score_document(document, &needles, required) {
                matched.push(document.path.clone());
                ranked.push(candidate);
            }
        }
        ranked.sort_by(|a, b| by_score(a.score, &a.document.label, b.score, &b.document.label));
        let truncated = ranked.len() > SEARCH_LIMIT;
        ranked.truncate(SEARCH_LIMIT);

        // Only now is anything drawn, and only now can a heading match be seen — both are on the same walk of a finalist's text, which is why the ranking is finished off here rather than above.
        let mut files: Vec<Vec<SearchHit>> = ranked.into_iter().map(Candidate::into_rows).collect();
        files.sort_by(|a, b| by_score(a[0].score, &a[0].title, b[0].score, &b[0].title));
        Some(SearchResults {
            hits: files.into_iter().flatten().collect(),
            truncated,
            matched,
            // A query of plain words reads back as the words themselves, which is the box repeating what is already in it.
            understood: if required {
                String::new()
            } else {
                query.describe()
            },
            unknown_fields: self.unknown_fields(query),
        })
    }

    /// The field names in `query` that no document in this vault sets. A filter naming one can only ever match nothing, so the box says which name it did not know instead of showing an empty list and leaving somebody to guess.
    pub fn unknown_fields(&self, query: &Query) -> Vec<String> {
        let mut wanted: Vec<&str> = query.field_names();
        if wanted.is_empty() {
            return Vec::new();
        }
        for document in &self.documents {
            if wanted.is_empty() {
                break;
            }
            let candidate = DocumentCandidate::new(document);
            wanted.retain(|name| !matches!(candidate.field(name), FieldAnswer::Values(_)));
        }
        wanted.into_iter().map(str::to_string).collect()
    }
}

/// One corpus document with the answers a filter asks for. Frontmatter is parsed and checkboxes counted at most once per document per query, and only if something asks — a plain word query pays for neither.
struct DocumentCandidate<'a> {
    document: &'a CorpusDocument,
    fields: OnceCell<Vec<FrontmatterField>>,
    tasks: OnceCell<TaskTally>,
}

impl<'a> DocumentCandidate<'a> {
    fn new(document: &'a CorpusDocument) -> Self {
        Self {
            document,
            fields: OnceCell::new(),
            tasks: OnceCell::new(),
        }
    }
}

impl crate::Candidate for DocumentCandidate<'_> {
    fn name(&self) -> &str {
        &self.document.label
    }

    fn path(&self) -> &str {
        &self.document.path
    }

    fn aliases(&self) -> &[String] {
        &self.document.aliases
    }

    fn text(&self) -> Option<&str> {
        Some(&self.document.text)
    }

    fn field(&self, name: &str) -> FieldAnswer {
        let fields = self
            .fields
            .get_or_init(|| document_fields(&self.document.text));
        let Some(field) = fields.iter().find(|field| field.key_is(name)) else {
            return FieldAnswer::Missing;
        };
        FieldAnswer::Values(
            field
                .values
                .iter()
                .map(|value| typed(field, value))
                .collect(),
        )
    }

    fn tasks(&self) -> Option<TaskTally> {
        Some(*self.tasks.get_or_init(|| tally_tasks(self.document)))
    }
}

/// One frontmatter value as the filter compares it — the field's own type decides, so `due:<friday` is a date comparison and `rating:>4` a number one.
fn typed(field: &FrontmatterField, value: &crate::store::FieldValue) -> QueryValue {
    match field.kind {
        FieldType::Date | FieldType::DateTime => value
            .text
            .get(..10)
            .and_then(|day| {
                time::Date::parse(
                    day,
                    time::macros::format_description!("[year]-[month]-[day]"),
                )
                .ok()
            })
            .map(QueryValue::Date)
            .unwrap_or_else(|| QueryValue::Text(value.text.clone())),
        FieldType::Number => value
            .text
            .parse::<f64>()
            .map(QueryValue::Number)
            .unwrap_or_else(|_| QueryValue::Text(value.text.clone())),
        FieldType::Checkbox => QueryValue::Checkbox(value.text.eq_ignore_ascii_case("true")),
        FieldType::Text | FieldType::List => QueryValue::Text(value.text.clone()),
    }
}

/// A document's checkboxes, counted. Only Markdown has any, and the cheap test for a bracket pair comes first because the real count is a whole parse of the document and nearly every file in a vault has no task in it at all.
fn tally_tasks(document: &CorpusDocument) -> TaskTally {
    if crate::DocumentFormat::from_path(Path::new(&document.path))
        != crate::DocumentFormat::Markdown
    {
        return TaskTally::default();
    }
    if !document.text.contains("[ ]")
        && !document.text.contains("[x]")
        && !document.text.contains("[X]")
    {
        return TaskTally::default();
    }
    let mut tally = TaskTally::default();
    for offset in crate::task_marker_offsets(&document.text) {
        match document.text.as_bytes().get(offset) {
            Some(b' ') => tally.open += 1,
            Some(_) => tally.done += 1,
            None => {}
        }
    }
    tally
}

/// Best first, then alphabetical so equal scores hold a stable order.
fn by_score(a: f64, a_title: &str, b: f64, b_title: &str) -> std::cmp::Ordering {
    b.partial_cmp(&a)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| a_title.to_lowercase().cmp(&b_title.to_lowercase()))
}

/// A document that matched, before anything is drawn for it.
struct Candidate<'a> {
    document: &'a CorpusDocument,
    score: f64,
    /// The first few term appearances in the body, earliest first: each one's offset, and its length *there* — case folding can make a match a different size than its term.
    spots: Vec<(usize, usize)>,
    /// The alias a term matched, when one beat the file name. What the row shows so a hit on a name that is not the file's own name is explained.
    alias: Option<String>,
}

impl Candidate<'_> {
    /// The rows the page shows, one per match, up to [`ROWS_PER_DOCUMENT`]. This is the expensive half of a hit, so it runs for the fifty that survived ranking rather than for every match in the vault.
    fn into_rows(self) -> Vec<SearchHit> {
        let text = &self.document.text;
        // One walk for all three rows. Both the line a match is on and the heading above it are counted from the top of the document — the heading because its slug has to be unique the way the renderer makes it unique — so a walk each would read the document from the top six times.
        let places = places_above(text, &self.spots);
        let mut rows: Vec<SearchHit> = self
            .spots
            .iter()
            .zip(places)
            .map(|((at, length), (line, anchor))| SearchHit {
                abs_path: self.document.path.clone(),
                title: self.document.label.clone(),
                alias: self.alias.clone(),
                start_line: line,
                end_line: line,
                anchor,
                snippet: snippet_around(text, *at, *length),
                score: self.score,
            })
            .collect();
        if rows.is_empty() {
            // Only the file name matched, so its first lines are the preview.
            rows.push(SearchHit {
                abs_path: self.document.path.clone(),
                title: self.document.label.clone(),
                alias: self.alias.clone(),
                start_line: 1,
                end_line: 1,
                anchor: None,
                snippet: text.lines().next().unwrap_or("").to_string(),
                score: self.score,
            });
        }
        // A heading match lifts the whole document, so its rows stay together.
        let heading = self.spots.iter().any(|(at, _)| on_heading_line(text, *at));
        if heading {
            for row in &mut rows {
                row.score += HEADING_SCORE;
            }
        }
        rows
    }
}

/// Score one document on the words the query is worth ranking by. `required` is a plain query, where every word has to land and a miss is the document refused on the spot — the one pass then both accepts and ranks. With syntax in the query the tree has already accepted this document, so a word it does not carry simply scores nothing.
fn score_document<'a>(
    document: &'a CorpusDocument,
    terms: &[&Needle],
    required: bool,
) -> Option<Candidate<'a>> {
    let name = document.label.to_lowercase();
    let aliases: Vec<String> = document
        .aliases
        .iter()
        .map(|alias| alias.to_lowercase())
        .collect();
    let folder = folder_of(&document.path);
    let mut score = 0.0f64;
    let mut spots: Vec<(usize, usize)> = Vec::new();
    // The best any one term managed against an alias, so a row found by one can say which name it was rather than looking like a mystery.
    let mut best_alias: Option<(f64, usize)> = None;
    for term in terms {
        let (named, alias) = best_name_score(&name, &aliases, term.text());
        if let Some(index) = alias {
            if best_alias.is_none_or(|(best, _)| named > best) {
                best_alias = Some((named, index));
            }
        }
        let scan = scan_term(&document.text, term);
        let foldered = term.is_in(folder);
        if named == 0.0 && scan.count == 0 && !foldered {
            // Every term of a plain query has to land somewhere, or this is not the document — and there is no reason to read it for the rest of them.
            if required {
                return None;
            }
            continue;
        }
        score += named;
        if foldered {
            score += FOLDER_SCORE;
        }
        // Per 10 KB, not per document: see FREQUENCY_WINDOW.
        let density = scan.count as f64 * FREQUENCY_WINDOW / document.text.len().max(1) as f64;
        score += density.min(FREQUENCY_CAP);
        spots.extend(scan.spots);
    }
    spots.sort_unstable();
    spots.dedup_by_key(|(at, _)| *at);
    spots.truncate(ROWS_PER_DOCUMENT);
    Some(Candidate {
        document,
        score,
        spots,
        alias: best_alias.map(|(_, index)| document.aliases[index].clone()),
    })
}

/// The best a term scores against any name the document answers to, and which alias that was when an alias beat the file name.
///
/// An alias is a name, so it scores like one — the whole scale, not a discount. Scoring it lower would sort a note below worse matches for using the field.
fn best_name_score(name: &str, aliases: &[String], term: &str) -> (f64, Option<usize>) {
    let mut best = (name_score(name, term), None);
    for (index, alias) in aliases.iter().enumerate() {
        let score = name_score(alias, term);
        if score > best.0 {
            best = (score, Some(index));
        }
    }
    best
}

/// The folders a document sits in: its path without the file name. Borrowed, not lowercased — the scan matches either case, and this runs once per document per keystroke.
fn folder_of(path: &str) -> &str {
    &path[..path.rfind(['/', '\\']).unwrap_or(0)]
}

/// What a name match is worth: the whole name, its start, the start of a word in it, or somewhere inside one.
fn name_score(name: &str, term: &str) -> f64 {
    let Some(at) = name.find(term) else {
        return 0.0;
    };
    if name.len() == term.len() {
        NAME_SCORE_EXACT
    } else if at == 0 {
        NAME_SCORE_PREFIX
    } else if name[..at]
        .chars()
        .next_back()
        .map_or(true, |ch| !ch.is_alphanumeric())
    {
        NAME_SCORE_WORD
    } else {
        NAME_SCORE_ANYWHERE
    }
}

/// Whether an offset sits on an ATX heading line.
fn on_heading_line(text: &str, at: usize) -> bool {
    let start = text[..at].rfind('\n').map_or(0, |newline| newline + 1);
    text[start..].trim_start().starts_with('#')
}

/// What one walk of a document answers about one term: how often it appears, and where its first few are. Both questions in one pass, and the count stops at [`SCORE_COUNT_CAP`] because the score cannot go higher.
struct TermScan {
    count: usize,
    /// Enough for a row each, no more — see [`ROWS_PER_DOCUMENT`].
    spots: Vec<(usize, usize)>,
}

fn scan_term(text: &str, term: &Needle) -> TermScan {
    let mut scan = TermScan {
        count: 0,
        spots: Vec::new(),
    };
    let mut from = 0usize;
    while let Some((at, length)) = term.find(text, from) {
        if scan.spots.len() < ROWS_PER_DOCUMENT {
            scan.spots.push((at, length));
        }
        scan.count += 1;
        if scan.count >= SCORE_COUNT_CAP {
            break;
        }
        // Non-overlapping, the way `str::matches` counts.
        from = at + length.max(1);
    }
    scan
}

/// Every document under one folder, each with its size. No folder is skipped for its name: a vault whose notes live under a dotted folder otherwise reads as empty.
fn collect_documents(dir: &Path, depth: usize, out: &mut Vec<(u64, PathBuf)>) {
    if depth >= MAX_DEPTH || out.len() > MAX_CORPUS_DOCUMENTS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut subfolders = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            // This is the walk that can loop: a junction pointing back up its own tree never ends. The pane's listing reads one folder and descends nowhere, which is why it does not need this.
            if crate::store::is_dir_reparse(&path) {
                continue;
            }
            subfolders.push(path);
        } else if file_type.is_file() && crate::is_supported_document_path(&path) {
            // The size is already in the directory entry, so this is not a second look at the disk.
            out.push((entry.metadata().map(|meta| meta.len()).unwrap_or(0), path));
        }
    }
    for folder in subfolders {
        collect_documents(&folder, depth + 1, out);
    }
}

/// Read one document. `None` when it is gone or unreadable, which is how a deleted file leaves the corpus.
pub(crate) fn read_document(path: &Path) -> Option<CorpusDocument> {
    // Decoded, not just read: a UTF-16 document in the vault should be findable by search and appear in the link graph like any other.
    let mut text = read_source(path).ok()?.text;
    if text.len() > MAX_DOCUMENT_BYTES {
        // Cut on a character boundary, never mid-codepoint.
        let mut cut = MAX_DOCUMENT_BYTES;
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }
    let label = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| path_to_string(path));
    Some(CorpusDocument {
        aliases: crate::store::aliases_from(&crate::store::document_fields(&text), &label),
        label,
        path: path_to_string(path),
        text,
    })
}

/// Where each match is: the 1-based line it sits on, and the slug of the nearest ATX heading above it so a hit can jump to its section. Slugs are counted from the top of the document with the same uniquing the renderer uses, or a second "## Notes" would land on the first — so both answers come off one walk, for every offset at once. `spots` must be in ascending order, as ranking leaves them.
fn places_above(text: &str, spots: &[(usize, usize)]) -> Vec<(u32, Option<String>)> {
    let mut seen = HashSet::new();
    let mut places: Vec<(u32, Option<String>)> = Vec::with_capacity(spots.len());
    let mut anchor: Option<String> = None;
    let mut offset = 0usize;
    let mut line = 1u32;
    let mut wanted = spots.iter();
    let mut next = wanted.next();
    for text_line in text.split_inclusive('\n') {
        let ends_at = offset + text_line.len();
        // Every match on this line is answered before moving past it.
        while let Some((at, _)) = next {
            if *at >= ends_at {
                break;
            }
            places.push((line, anchor.clone()));
            next = wanted.next();
        }
        if next.is_none() {
            break;
        }
        let trimmed = text_line.trim_start();
        if let Some(rest) = trimmed.strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() {
                anchor = Some(unique_heading_slug(title, &mut seen));
            }
        }
        offset = ends_at;
        line += 1;
    }
    // Anything past the last line takes the last line and heading seen.
    while places.len() < spots.len() {
        places.push((line, anchor.clone()));
    }
    places
}

/// A window of text around a match, with the match marked. Cut on character boundaries and elided with an ellipsis at each end that is not the document's.
fn snippet_around(text: &str, at: usize, length: usize) -> String {
    let start = floor_boundary(text, at.saturating_sub(SNIPPET_RADIUS));
    let match_end = ceil_boundary(text, at + length);
    let end = ceil_boundary(text, (at + length + SNIPPET_RADIUS).min(text.len()));

    let mut snippet = String::new();
    if start > 0 {
        snippet.push('…');
    }
    snippet.push_str(text[start..at].trim_start());
    snippet.push(MARK_OPEN);
    snippet.push_str(&text[at..match_end]);
    snippet.push(MARK_CLOSE);
    snippet.push_str(text[match_end..end].trim_end());
    if end < text.len() {
        snippet.push('…');
    }
    // The page shows this on two lines; newlines would waste both.
    snippet.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn floor_boundary(text: &str, mut at: usize) -> usize {
    while at > 0 && !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

fn ceil_boundary(text: &str, mut at: usize) -> usize {
    let limit = text.len();
    while at < limit && !text.is_char_boundary(at) {
        at += 1;
    }
    at.min(limit)
}

/// The undirected link graph over a set of documents: one node each, one edge per link that resolves to another document in the set.
///
/// Which documents are in the set is the caller's business and the only thing that differs between a vault's map and the map around one document — how a graph is built from them is the same either way, so it is written once. Note what that means for a link out of the set: it resolves to nothing and draws no edge, so a smaller set is a smaller picture rather than a wrong one.
pub(crate) fn build_graph(documents: &[CorpusDocument]) -> DocumentGraph {
    let mut path_to_index: HashMap<&str, usize> = HashMap::with_capacity(documents.len());
    let mut lower_path_to_index: HashMap<String, usize> = HashMap::new();
    // Name keys can collide across folders; first writer wins, a fine best-effort for wiki-style links.
    let mut name_to_index: HashMap<String, usize> = HashMap::new();
    for (index, document) in documents.iter().enumerate() {
        path_to_index.insert(document.path.as_str(), index);
        lower_path_to_index
            .entry(document.path.to_lowercase())
            .or_insert(index);
        name_to_index
            .entry(normalize_name_key(&document.label))
            .or_insert(index);
    }
    // Aliases go in only after every file name is in, so a name somebody typed on disk always beats a name somebody preferred.
    for (index, document) in documents.iter().enumerate() {
        for alias in &document.aliases {
            name_to_index
                .entry(normalize_name_key(alias))
                .or_insert(index);
        }
    }

    // Documents take the first indices, so a node index is a document index until the end of the list. Web addresses are appended as they are met.
    let mut nodes: Vec<GraphNode> = documents
        .iter()
        .map(|document| GraphNode {
            path: document.path.clone(),
            label: document.label.clone(),
            aliases: document.aliases.clone(),
            degree: 0,
            external: false,
        })
        .collect();
    let mut url_to_index: HashMap<String, usize> = HashMap::new();
    let mut truncated = false;

    // Deduped directed: `(a, b)` and `(b, a)` are two different facts. Sorting the pair here collapses them, killing the duplicate at the cost of forgetting which end wrote the link.
    let mut directed: HashSet<(usize, usize)> = HashSet::new();
    for (from, document) in documents.iter().enumerate() {
        let mut urls_from_here = 0usize;
        for link in document_links(&document.text, Path::new(&document.path)) {
            // A web address is its own node, shared by every document citing it — which is the point: it shows which of your notes lean on one source.
            if let Some(url) = link.target_url {
                if urls_from_here >= MAX_EXTERNAL_LINKS_PER_DOCUMENT {
                    truncated = true;
                    continue;
                }
                urls_from_here += 1;
                let to = *url_to_index.entry(url.clone()).or_insert_with(|| {
                    nodes.push(GraphNode {
                        label: url_host_label(&url),
                        aliases: Vec::new(),
                        path: url,
                        degree: 0,
                        external: true,
                    });
                    nodes.len() - 1
                });
                // Always this way round: a page cannot link back at you.
                directed.insert((from, to));
                continue;
            }
            let to = link
                .target_abs
                .as_deref()
                .and_then(|abs| {
                    path_to_index
                        .get(abs)
                        .or_else(|| lower_path_to_index.get(&abs.to_lowercase()))
                        .copied()
                })
                .or_else(|| {
                    link.target_name
                        .as_deref()
                        .and_then(|name| name_to_index.get(name).copied())
                });
            let Some(to) = to else { continue };
            if to == from {
                continue; // a document linking itself is not an edge
            }
            directed.insert((from, to));
        }
    }

    // One line per pair. A pair linked both ways keeps its own orientation (sorted, so it is the same every read) and is marked `mutual`; a one-way pair keeps the direction it was written in.
    let mut drawn: HashSet<(usize, usize)> = HashSet::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    for &(from, to) in &directed {
        let pair = if from < to { (from, to) } else { (to, from) };
        if !drawn.insert(pair) {
            continue;
        }
        let mutual = directed.contains(&(to, from));
        let (source, target) = if mutual { pair } else { (from, to) };
        nodes[source].degree += 1;
        nodes[target].degree += 1;
        edges.push(GraphEdge {
            source: nodes[source].path.clone(),
            target: nodes[target].path.clone(),
            mutual,
        });
    }
    // A HashSet iterates in no fixed order, and the page compares graphs by signature to decide whether it is already drawing this one.
    edges.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.target.cmp(&b.target))
    });

    DocumentGraph {
        nodes,
        edges,
        truncated,
    }
}

/// Apply the requested slice to a finished graph: a focused neighborhood, the densest N, or all of it.
pub(crate) fn narrow(graph: DocumentGraph, request: &GraphRequest) -> DocumentGraph {
    let DocumentGraph {
        nodes,
        edges,
        truncated,
    } = graph;

    let (kept, truncated): (HashSet<String>, bool) = if let Some(seeds) = &request.focus {
        let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
        for edge in &edges {
            adjacency
                .entry(&edge.source)
                .or_default()
                .push(&edge.target);
            adjacency
                .entry(&edge.target)
                .or_default()
                .push(&edge.source);
        }
        let by_lower: HashMap<String, &str> = nodes
            .iter()
            .map(|node| (node.path.to_lowercase(), node.path.as_str()))
            .collect();
        let mut included: HashSet<String> = HashSet::new();
        for seed in seeds {
            let Some(path) = by_lower.get(&seed.to_lowercase()).copied() else {
                continue;
            };
            included.insert(path.to_string());
            for neighbor in adjacency.get(path).into_iter().flatten() {
                included.insert((*neighbor).to_string());
            }
        }
        (included, truncated)
    } else if let Some(limit) = request.limit.filter(|limit| nodes.len() > *limit) {
        let mut ranked: Vec<&GraphNode> = nodes.iter().collect();
        ranked.sort_by(|a, b| {
            b.degree
                .cmp(&a.degree)
                .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
        });
        ranked.truncate(limit);
        (ranked.into_iter().map(|n| n.path.clone()).collect(), true)
    } else {
        return DocumentGraph {
            nodes,
            edges,
            truncated,
        };
    };

    DocumentGraph {
        edges: edges
            .into_iter()
            .filter(|edge| kept.contains(&edge.source) && kept.contains(&edge.target))
            .collect(),
        nodes: nodes
            .into_iter()
            .filter(|node| kept.contains(&node.path))
            .collect(),
        truncated,
    }
}

/// How many field names one vault offers the box, and how many values of one field. A vault with a `uuid` on every note would otherwise push thousands of one-off values at a menu nobody can read.
const MAX_HINT_FIELDS: usize = 200;
const MAX_HINT_VALUES: usize = 50;

/// What a filter box can offer: every frontmatter field name in the vault, and the values each one is known to hold. Read once when the vault's text is read, on the same worker, so typing costs nothing.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterHints {
    pub fields: Vec<FilterHintField>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterHintField {
    pub name: String,
    pub values: Vec<String>,
}

impl VaultCorpus {
    /// The field names and values in this vault, alphabetical, for the completion menu. Names keep the case the first file that wrote one gave it, so a menu offers `Status` to a vault that spells it that way.
    pub fn filter_hints(&self) -> FilterHints {
        let mut order: Vec<String> = Vec::new();
        let mut seen: HashMap<String, Vec<String>> = HashMap::new();
        for document in &self.documents {
            for field in document_fields(&document.text) {
                let key = field.key.to_lowercase();
                let values = match seen.entry(key) {
                    std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        if order.len() >= MAX_HINT_FIELDS {
                            continue;
                        }
                        order.push(field.key.clone());
                        entry.insert(Vec::new())
                    }
                };
                for value in &field.values {
                    if values.len() >= MAX_HINT_VALUES {
                        break;
                    }
                    if value.text.is_empty()
                        || values
                            .iter()
                            .any(|held| held.eq_ignore_ascii_case(&value.text))
                    {
                        continue;
                    }
                    values.push(value.text.clone());
                }
            }
        }
        order.sort_by_key(|name| name.to_lowercase());
        FilterHints {
            fields: order
                .into_iter()
                .map(|name| {
                    let mut values = seen.remove(&name.to_lowercase()).unwrap_or_default();
                    values.sort_by_key(|value| value.to_lowercase());
                    FilterHintField { name, values }
                })
                .collect(),
        }
    }
}
