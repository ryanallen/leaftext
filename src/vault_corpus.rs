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
pub(crate) const MAX_CORPUS_BYTES: usize = 32 * 1024 * 1024;

/// How much of one document is kept. Long enough for anything anyone reads; short enough that one enormous file cannot dominate the vault's footprint.
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

/// How deep the walk goes.
const MAX_DEPTH: usize = 24;

/// Folder names a build tool picks for what it generates. Short on purpose: every name here costs somebody who keeps notes in a folder called that, which is why a vault says what it left out rather than going quiet about it.
///
/// Matched without case, because both platforms this ships to hold their filenames that way — a folder called `Target` is the same folder to the reader as `target`.
const GENERATED_FOLDER_NAMES: &[&str] = &[
    "target",
    "node_modules",
    "build",
    "dist",
    "vendor",
    "venv",
    ".venv",
    "__pycache__",
    ".next",
    ".gradle",
    "Pods",
];

/// The file a folder carries to say a machine filled it — the [cache directory tagging](https://bford.info/cachedir/) convention, which cargo and a dozen other tools write. The half of the rule that needs no list, and the half that answers this repo's own `app/target/`.
const CACHE_TAG_FILE: &str = "CACHEDIR.TAG";

/// What that file has to start with. The convention is a signature line and nothing else is promised, so only the first line is read.
const CACHE_TAG_SIGNATURE: &[u8] = b"Signature: 8a477f597d28d172789f06886806bc55";

/// Whether a folder says it holds generated files: it declares itself a cache, or it carries one of the names above.
///
/// One rule for two halves that must never part company: the walk stops descending here, and the watcher drops this folder's events at the boundary git's own bookkeeping is dropped at. A vault pointed at this project is 98.7% build output, and without this every file of it is listed, opened and answered for.
///
/// The name is asked first, because that is free and it is the case this exists for; the tag costs one look at the disk and is only reached where the name says nothing.
pub fn folder_holds_generated_files(dir: &Path) -> bool {
    if dir.file_name().is_some_and(is_generated_name) {
        return true;
    }
    carries_cache_tag(dir)
}

/// The same rule asked of something that changed rather than of a folder being walked: whether anything it sits under holds generated files.
///
/// The path's own name is never the question — a folder called `target` appearing is news for the pane, and the file inside it is not.
pub fn path_holds_generated_files(path: &Path) -> bool {
    let mut above = path.components();
    above.next_back();
    // Every name first, so a path under a folder the list knows costs no look at the disk at all.
    if above.any(|part| is_generated_name(part.as_os_str())) {
        return true;
    }
    path.ancestors()
        .skip(1)
        // An empty ancestor is what a relative path ends on, and joining a file name to it would ask about the working directory.
        .filter(|dir| !dir.as_os_str().is_empty())
        .any(carries_cache_tag)
}

fn is_generated_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| {
        GENERATED_FOLDER_NAMES
            .iter()
            .any(|known| known.eq_ignore_ascii_case(name))
    })
}

fn carries_cache_tag(dir: &Path) -> bool {
    use std::io::Read;
    let Ok(mut tag) = fs::File::open(dir.join(CACHE_TAG_FILE)) else {
        return false;
    };
    let mut head = [0u8; CACHE_TAG_SIGNATURE.len()];
    tag.read_exact(&mut head).is_ok() && head.as_slice() == CACHE_TAG_SIGNATURE
}

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

/// What one changed file moved in the vault's held text. Two answers rather than one, because their readers want different things: the map is redrawn when the text moved at all, and the completion menu's field names are only worth walking the whole vault for when a frontmatter block did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CorpusChange {
    /// The held text is different afterwards.
    pub text: bool,
    /// A frontmatter block came, went, or reads differently, so the names the vault sets can have changed.
    pub fields: bool,
}

impl CorpusChange {
    /// The watcher's usual report: a path this vault does not hold, or a save whose bytes are the ones already held.
    pub const NOTHING: Self = Self {
        text: false,
        fields: false,
    };
}

/// One document's frontmatter block, lifted out without being parsed. Comparing the two blocks is what says whether a save touched the fields at all — the parse behind the menu costs a walk of the whole vault, and most saves are a line of somebody's prose.
fn frontmatter_block(text: &str) -> Option<String> {
    crate::store::extract_frontmatter(text).map(|block| block.body)
}

/// Every document under one vault root.
#[derive(Debug, Clone)]
pub struct VaultCorpus {
    pub root: PathBuf,
    pub documents: Vec<CorpusDocument>,
    /// Set when the read hit either limit, or was stopped part-way because the vault was left, so the graph can say the picture is partial.
    pub truncated: bool,
    /// Folders the walk did not descend into because they hold generated files, named from the vault root down. A vault that quietly read three quarters of itself would be worse than one that read all of it slowly, so this is what the count line above the rows says out loud.
    pub skipped: Vec<String>,
}

/// One slice of a read, as it lands. `documents` are the new ones only unless `replaces` says otherwise, so whoever is collecting them grows what it holds rather than replacing it.
pub struct CorpusSlice {
    pub documents: Vec<CorpusDocument>,
    /// Whether either cap has been hit so far, or the read was stopped. The last slice carries the final answer.
    pub truncated: bool,
    /// What the walk left out. Empty on a preview, which goes out before the walk has finished listing; every sorted slice carries the walk's one whole answer.
    pub skipped: Vec<String>,
    /// What this slice lands on is thrown away rather than grown. Two slices of a read carry it: the preview, which starts the text, and the first sorted slice, which drops the preview so no document is held twice and nothing the final limits exclude survives.
    pub replaces: bool,
    /// Nothing more is coming. Always sent, even for a vault of nothing: it is what says the read is over.
    pub last: bool,
}

/// The first documents the walk lists, handed over before the sort so a search can be answered while the rest of the tree is still being listed. Bounded by the same two numbers the whole corpus is, read off the directory entries the walk already had, so it costs no second look at the disk and no second format test.
///
/// It goes out once. `deliver` is taken when it does, which is the whole of that rule: after it the walk only records paths.
pub(crate) struct CorpusPreview<'a> {
    paths: Vec<PathBuf>,
    bytes: u64,
    deliver: Option<&'a mut dyn FnMut(Vec<PathBuf>)>,
}

impl<'a> CorpusPreview<'a> {
    /// A walk that hands nothing over early — what a test of the walk itself asks for. Every read the app makes wants the preview, so this exists for the tests alone.
    #[cfg(test)]
    pub(crate) fn none() -> Self {
        Self {
            paths: Vec::new(),
            bytes: 0,
            deliver: None,
        }
    }

    /// A walk that hands its first documents over as soon as it has them.
    pub(crate) fn sending(deliver: &'a mut dyn FnMut(Vec<PathBuf>)) -> Self {
        Self {
            paths: Vec::new(),
            bytes: 0,
            deliver: Some(deliver),
        }
    }

    /// One listed document offered to the batch. A file whose own size would cross the ceiling is left to the final corpus rather than emptying the preview of everything else.
    fn offer(&mut self, size: u64, path: &Path) {
        if self.deliver.is_none() {
            return;
        }
        if self.bytes + size <= MAX_CORPUS_BYTES as u64 {
            self.bytes += size;
            self.paths.push(path.to_path_buf());
        }
        if self.paths.len() >= CORPUS_SLICE_DOCUMENTS || self.bytes >= MAX_CORPUS_BYTES as u64 {
            self.send();
        }
    }

    /// A folder has been listed. Whatever it turned up goes now: waiting for the next folder is the wait this exists to end.
    fn folder_listed(&mut self) {
        if !self.paths.is_empty() {
            self.send();
        }
    }

    fn send(&mut self) {
        if let Some(deliver) = self.deliver.take() {
            deliver(std::mem::take(&mut self.paths));
        }
    }
}

/// How many folders the count line will name. Past this the sentence is longer than the answer it is a footnote to, and the number in front of it still says how many there were.
const SKIPPED_FOLDERS_NAMED: usize = 20;

/// How many documents one slice carries. A file nobody has opened since the machine started costs about 6 ms whatever is in it, so this is roughly a third of a second of reading — long enough that the answers behind it do not crowd each other, short enough that somebody is reading matches while the rest of the vault is still being opened.
pub const CORPUS_SLICE_DOCUMENTS: usize = 50;

impl VaultCorpus {
    /// Read the whole vault and hand it back in one piece. The expensive call, made once per vault per session, on a background thread.
    pub fn read(root: &Path) -> Self {
        let mut documents = Vec::new();
        let mut truncated = false;
        let mut skipped = Vec::new();
        Self::read_in_slices(root, usize::MAX, &|| false, |slice| {
            // The preview lands first and the first sorted slice drops it, so the whole read is these slices played in order rather than added up.
            if slice.replaces {
                documents.clear();
                truncated = false;
            }
            documents.extend(slice.documents);
            truncated |= slice.truncated;
            skipped = slice.skipped;
        });
        Self {
            root: root.to_path_buf(),
            documents,
            truncated,
            skipped,
        }
    }

    /// The same read, handing over what it has as it goes, so a search can answer over part of a vault while the rest is still being opened.
    ///
    /// The sorted slices spend the byte budget smallest-first, which is what buys the whole of a vault of notes rather than as much as fits of a folder of generated ones — and that order needs every path, so none of them can go out until the walk has finished. Ahead of them is one preview taken in the order the walk met them, which answers the search that paid for the walk and is thrown away by the first sorted slice.
    ///
    /// Nothing holds the preview, so the sorted loop opens its files a second time. That is measured rather than missed: the second open lands seconds after the first on files the operating system still holds, and `reading_a_vault_is_timed_in_its_parts` reads one batch of 50 twice in a row — 21.4 ms cold, 1.8 ms again, inside a cold read of 1,732 ms over 5,072 documents. Keeping the batch instead means a map of decoded text bounded by `MAX_CORPUS_BYTES` standing beside a corpus allowed the same, so 32 MB of peak memory buys back about a thousandth of the wait.
    ///
    /// `overtaken` is checked between documents, the same question [`Self::search_until`] asks in the same place: the vault has been left, so the rest of this read is answers nobody will collect.
    pub fn read_in_slices(
        root: &Path,
        size: usize,
        overtaken: &dyn Fn() -> bool,
        mut deliver: impl FnMut(CorpusSlice),
    ) {
        let mut found = Vec::new();
        let mut left_out = Vec::new();
        {
            let mut send_preview = |paths: Vec<PathBuf>| {
                if overtaken() {
                    return;
                }
                let documents: Vec<CorpusDocument> = paths
                    .iter()
                    .filter_map(|path| read_document(path))
                    .collect();
                // Nothing readable in the batch, so there is no early answer to give and the sorted slices carry the read on their own.
                if documents.is_empty() {
                    return;
                }
                deliver(CorpusSlice {
                    documents,
                    truncated: false,
                    skipped: Vec::new(),
                    replaces: true,
                    last: false,
                });
            };
            let mut preview = CorpusPreview::sending(&mut send_preview);
            collect_documents(root, 0, &mut found, &mut left_out, overtaken, &mut preview);
        }
        let skipped = skipped_folder_labels(root, left_out);
        // Smallest first, so the byte budget buys as many documents as it can. The sizes came back off the same directory entries the walk had already read, so this costs no second look at the disk.
        found.sort_by_key(|(size, _)| *size);
        // Asked here rather than reported up through the recursion: a walk that stopped left folders unlisted, which is what this flag already means.
        let mut truncated = found.len() > MAX_CORPUS_DOCUMENTS || overtaken();
        found.truncate(MAX_CORPUS_DOCUMENTS);

        let size = size.max(1);
        let mut held = 0;
        // The first sorted slice drops the preview: a document held twice would be two rows, and a preview hit the final limits exclude would outlive the ranking that excluded it.
        let mut replaces = true;
        let mut documents = Vec::new();
        for (_, path) in found {
            // Break rather than return: the slice below is the only thing that says a read is over, and the loop that started this one cannot begin another until it lands.
            if overtaken() {
                break;
            }
            if held >= MAX_CORPUS_BYTES {
                truncated = true;
                break;
            }
            let Some(document) = read_document(&path) else {
                continue;
            };
            held += document.text.len();
            documents.push(document);
            if documents.len() >= size {
                deliver(CorpusSlice {
                    documents: std::mem::take(&mut documents),
                    truncated,
                    skipped: skipped.clone(),
                    replaces: std::mem::take(&mut replaces),
                    last: false,
                });
            }
        }
        deliver(CorpusSlice {
            documents,
            truncated,
            skipped,
            replaces,
            last: true,
        });
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
        path.starts_with(&self.root) && crate::is_listed_document_path(path)
    }

    /// Bring one path up to date after the watcher reports a change: re-read it, add it if it is new, drop it if it is gone. Cheaper than re-reading the vault, and it is what keeps search and the graph live while you edit.
    ///
    /// Returns what actually moved. The watcher reports every write under the vault — `.git` bookkeeping, an image, a save whose bytes did not change — and the graph is redrawn off this answer, so "nothing changed" has to be sayable: unanswered, that churn tears the map down and rebuilds it over and over while someone is reading it.
    pub fn refresh(&mut self, path: &Path) -> CorpusChange {
        if !self.covers(path) {
            return CorpusChange::NOTHING;
        }
        let key = path_to_string(path);
        let existing = self
            .documents
            .iter()
            .position(|document| document.path == key);
        match (read_document(path), existing) {
            (Some(fresh), Some(index)) => {
                if self.documents[index] == fresh {
                    return CorpusChange::NOTHING;
                }
                let fields = frontmatter_block(&self.documents[index].text)
                    != frontmatter_block(&fresh.text);
                self.documents[index] = fresh;
                CorpusChange { text: true, fields }
            }
            // A document that appears while the vault is open joins it under the same two limits the first read held to, or the corpus grows past them one save at a time.
            (Some(fresh), None)
                if self.documents.len() < MAX_CORPUS_DOCUMENTS
                    && self.held_bytes() < MAX_CORPUS_BYTES =>
            {
                // A document nothing held before brings whatever it sets, so any block at all is a name the menu may now owe.
                let fields = frontmatter_block(&fresh.text).is_some();
                self.documents.push(fresh);
                CorpusChange { text: true, fields }
            }
            (Some(_), None) => CorpusChange::NOTHING,
            (None, Some(index)) => {
                let fields = frontmatter_block(&self.documents[index].text).is_some();
                self.documents.remove(index);
                CorpusChange { text: true, fields }
            }
            (None, None) => CorpusChange::NOTHING,
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

        // The field names nothing has been seen to set yet. Answered on this walk rather than on one of its own: a second walk builds a second candidate per document and parses the same block again, and a name no document sets pays that for the whole vault every keystroke.
        let mut unnamed: Vec<&str> = query.field_names();

        let mut ranked: Vec<Candidate> = Vec::new();
        let mut matched: Vec<String> = Vec::new();
        for document in &self.documents {
            // One candidate per document per query, so a frontmatter block is parsed once and both the filter and the unknown-name answer read that parse. A plain query is proved by the scan below and names no field, so it builds none at all.
            let candidate = (!required).then(|| DocumentCandidate::new(document));
            // Asked before the narrowing below can skip a document, because which names the *vault* sets is not a question a narrowed set can answer. `within` is offered only to a plain query, which names no field, so this costs a narrowed scan nothing.
            if let Some(candidate) = &candidate {
                if !unnamed.is_empty() {
                    unnamed.retain(|name| !matches!(candidate.field(name), FieldAnswer::Values(_)));
                }
            }
            if let Some(paths) = &narrowed {
                if !paths.contains(document.path.as_str()) {
                    continue;
                }
            }
            if overtaken() {
                return None;
            }
            if let Some(candidate) = &candidate {
                if !query.matches(candidate) {
                    continue;
                }
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
            // What the walk above never saw set: a filter naming one of these can only ever match nothing, so the box says which name it did not know instead of showing an empty list and leaving somebody to guess.
            unknown_fields: unnamed.into_iter().map(str::to_string).collect(),
            // Every answer carries it, not just a cut one: a vault whose search finds everything it looked at still did not look at all of it.
            skipped: self.skipped.clone(),
        })
    }
}

#[cfg(test)]
thread_local! {
    /// How many frontmatter blocks this thread has parsed for a filter. Only a test wants it: the whole of the fault it guards is a query that parsed each block twice, and a count is the only thing that can tell one pass from two. Per thread, because `cargo test` runs tests beside each other and a shared tally would read another test's work.
    pub(crate) static FIELD_PARSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Start the count again and answer what it reached while `scan` ran.
#[cfg(test)]
pub(crate) fn field_parses_during(scan: impl FnOnce()) -> usize {
    FIELD_PARSES.with(|count| count.set(0));
    scan();
    FIELD_PARSES.with(std::cell::Cell::get)
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
        let fields = self.fields.get_or_init(|| {
            #[cfg(test)]
            FIELD_PARSES.with(|count| count.set(count.get() + 1));
            document_fields(&self.document.text)
        });
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

/// Every document under one folder, each with its size, and every folder left out on the way. A dotted folder is not one of them: a vault whose notes live under one otherwise reads as empty. What is left out is a folder that says it holds generated files — see [`folder_holds_generated_files`].
pub(crate) fn collect_documents(
    dir: &Path,
    depth: usize,
    out: &mut Vec<(u64, PathBuf)>,
    left_out: &mut Vec<PathBuf>,
    overtaken: &dyn Fn() -> bool,
    preview: &mut CorpusPreview,
) {
    // Beside the document cap, so a walk of a folder nobody is in unwinds at the next folder. The recursion hands nothing back, so the caller asks again once this returns.
    if depth >= MAX_DEPTH || out.len() > MAX_CORPUS_DOCUMENTS || overtaken() {
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
            // Above the descent, not beside the document test below it: that test per file saves a read and never the walk, and 440,034 files under one folder is what the walk costs here.
            if folder_holds_generated_files(&path) {
                left_out.push(path);
                continue;
            }
            subfolders.push(path);
        } else if file_type.is_file() && crate::is_listed_document_path(&path) {
            // The size is already in the directory entry, so this is not a second look at the disk.
            let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            preview.offer(size, &path);
            out.push((size, path));
        }
    }
    // This folder's own files are listed, so anything the preview gathered goes out here rather than waiting on the folders below.
    preview.folder_listed();
    for folder in subfolders {
        collect_documents(&folder, depth + 1, out, left_out, overtaken, preview);
    }
}

/// What the count line names the left-out folders by: their place under the vault, so `app/target` says which one rather than leaving four folders called `target` reading as the same folder. Sorted, and capped — past [`SKIPPED_FOLDERS_NAMED`] the sentence is longer than the answer it is a footnote to, and the number in front of it still says how many there were.
fn skipped_folder_labels(root: &Path, left_out: Vec<PathBuf>) -> Vec<String> {
    let mut labels: Vec<String> = left_out
        .iter()
        .map(|folder| {
            folder
                .strip_prefix(root)
                .unwrap_or(folder)
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    labels.sort();
    labels.dedup();
    labels.truncate(SKIPPED_FOLDERS_NAMED);
    labels
}

/// Read one document. `None` when it is gone or unreadable, which is how a deleted file leaves the corpus.
pub(crate) fn read_document(path: &Path) -> Option<CorpusDocument> {
    // Decoded, not just read: a UTF-16 document in the vault should be findable by search and appear in the link graph like any other.
    let format = crate::DocumentFormat::from_path(path);
    let mut text = match format.source_shape() {
        crate::SourceShape::Text => read_source(path).ok()?.text,
        // A package's words are inside its members, so the corpus reads the document rather than the file — otherwise a vault of Word files is listed in the pane and absent from search.
        crate::SourceShape::Bytes => {
            crate::office::document_text(&std::fs::read(path).ok()?, format)?
        }
    };
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
