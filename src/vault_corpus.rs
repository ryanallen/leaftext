//! A vault's text, held in memory.
//!
//! One read of the folder serves both things that need to see inside every
//! document: the link graph, and search. Neither has an index behind it, so
//! there is one copy of the truth — the files — and this is a cache of it that
//! the watcher patches a file at a time.
//!
//! Nothing here is written to disk. Switching vaults drops it; quitting drops
//! it; the next session reads again on first use.

use crate::read_source;
use crate::store::{
    document_links, normalize_name_key, path_to_string, url_host_label, DocumentGraph, GraphEdge,
    GraphNode, GraphRequest, SearchHit,
};
use crate::unique_heading_slug;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// Directories never read, matching the pane's own listing rules.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "Pods",
    "__pycache__",
];

/// How many documents one vault may hold in memory. A vault is bounded by
/// construction; this is the backstop for someone pointing one at a source tree.
pub const MAX_CORPUS_DOCUMENTS: usize = 5_000;

/// How much of one document is kept. Long enough for anything anyone reads;
/// short enough that one enormous file cannot dominate the vault's footprint.
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

/// How deep the walk goes.
const MAX_DEPTH: usize = 24;

/// Cap on returned hits, matching what the indexed search returned.
const SEARCH_LIMIT: usize = 50;

/// How many web addresses one document may put on the map. A link roll or a
/// bibliography is a real document, and without a cap it would bury the notes
/// around it under a hundred nodes nobody was looking for.
const MAX_EXTERNAL_LINKS_PER_DOCUMENT: usize = 25;

/// How many characters of context a snippet carries around its match.
const SNIPPET_RADIUS: usize = 90;

/// The markers a snippet wraps its match in. STX/ETX cannot occur in a document,
/// so the page escapes the whole snippet for the DOM first and only then swaps
/// these for `<mark>` — the same contract FTS5's `snippet()` was held to.
const MARK_OPEN: char = '\u{2}';
const MARK_CLOSE: char = '\u{3}';

/// One document, as the corpus holds it.
///
/// Compared by value so a watcher tick reporting text identical to what is held
/// can be answered with "nothing changed", the way live reload hash-gates itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorpusDocument {
    pub path: String,
    /// The file name without its extension: what the pane and the graph show.
    pub label: String,
    pub text: String,
}

/// Every document under one vault root.
#[derive(Debug, Clone)]
pub struct VaultCorpus {
    pub root: PathBuf,
    pub documents: Vec<CorpusDocument>,
    /// Set when the walk hit [`MAX_CORPUS_DOCUMENTS`], so the graph can say the
    /// picture is partial.
    pub truncated: bool,
}

impl VaultCorpus {
    /// Read the whole vault. The expensive call, made once per vault per
    /// session, on a background thread.
    pub fn read(root: &Path) -> Self {
        let mut paths = Vec::new();
        collect_documents(root, 0, &mut paths);
        let truncated = paths.len() > MAX_CORPUS_DOCUMENTS;
        paths.truncate(MAX_CORPUS_DOCUMENTS);

        let documents = paths
            .iter()
            .filter_map(|path| read_document(path))
            .collect();
        Self {
            root: root.to_path_buf(),
            documents,
            truncated,
        }
    }

    /// Whether a changed path is one this corpus holds text for. Asked before
    /// [`Self::refresh`], because getting that far can cost a clone of the whole
    /// corpus, and most of what the watcher reports is not a document.
    pub fn covers(&self, path: &Path) -> bool {
        path.starts_with(&self.root) && crate::is_supported_document_path(path)
    }

    /// Bring one path up to date after the watcher reports a change: re-read it,
    /// add it if it is new, drop it if it is gone. Cheaper than re-reading the
    /// vault, and it is what keeps search and the graph live while you edit.
    ///
    /// Returns whether the corpus is actually different afterwards. The watcher
    /// reports every write under the vault — `.git` bookkeeping, an image, a save
    /// whose bytes did not change — and the graph is redrawn off this answer, so
    /// "nothing changed" has to be sayable: that churn used to tear the map down
    /// and rebuild it over and over while someone was reading it.
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
            (Some(fresh), None) if self.documents.len() < MAX_CORPUS_DOCUMENTS => {
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

    /// The link graph over these documents. `request` narrows it the way it
    /// always has: a focused neighborhood, the densest N, or all of it.
    pub fn graph(&self, request: &GraphRequest) -> DocumentGraph {
        let mut graph = narrow(build_graph(&self.documents), request);
        graph.truncated |= self.truncated;
        graph
    }

    /// Search the vault. A document matches when it carries every term, in its
    /// name or its text; hits are ranked name-first, then by how often the terms
    /// appear. Scanning a few megabytes of RAM beats a round trip to SQLite, and
    /// it can never be out of step with the disk.
    pub fn search(&self, query: &str) -> Vec<SearchHit> {
        let terms = search_terms(query);
        if terms.is_empty() {
            return Vec::new();
        }

        let mut hits: Vec<SearchHit> = Vec::new();
        for document in &self.documents {
            let Some(hit) = self.match_document(document, &terms) else {
                continue;
            };
            hits.push(hit);
        }
        // Best first, then alphabetical so equal scores hold a stable order.
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        hits.truncate(SEARCH_LIMIT);
        hits
    }

    fn match_document(&self, document: &CorpusDocument, terms: &[String]) -> Option<SearchHit> {
        let name = document.label.to_lowercase();
        let body = document.text.to_lowercase();
        // Every term has to land somewhere, or this is not the document.
        if !terms
            .iter()
            .all(|term| name.contains(term) || body.contains(term))
        {
            return None;
        }

        let mut score = 0.0f64;
        for term in terms {
            if name.contains(term) {
                // A named file is a strong hit — the same bias the indexed
                // search had when it put filename matches above content.
                score += 100.0;
            }
            score += body.matches(term.as_str()).count().min(20) as f64;
        }

        // Where to show and where to jump: the first term's first appearance in
        // the body, and the heading above it.
        let found = terms
            .iter()
            .filter_map(|term| body.find(term.as_str()).map(|at| (at, term.len())))
            .min_by_key(|(at, _)| *at);
        let (line, anchor, snippet) = match found {
            Some((at, length)) => {
                let line = line_number_at(&document.text, at);
                (
                    line,
                    heading_anchor_above(&document.text, at),
                    snippet_around(&document.text, at, length),
                )
            }
            // Only the file name matched, so its first lines are the preview.
            None => (
                1,
                None,
                document.text.lines().next().unwrap_or("").to_string(),
            ),
        };

        Some(SearchHit {
            abs_path: document.path.clone(),
            title: document.label.clone(),
            start_line: line,
            end_line: line,
            anchor,
            snippet,
            score,
        })
    }
}

/// Split user input into terms: whitespace-separated and lowercased. There is no
/// query language here — every term is literal text.
fn search_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|term| term.trim().to_lowercase())
        .filter(|term| !term.is_empty())
        .collect()
}

fn collect_documents(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
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
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            if crate::store::is_dir_reparse(&path) {
                continue;
            }
            subfolders.push(path);
        } else if file_type.is_file() && crate::is_supported_document_path(&path) {
            out.push(path);
        }
    }
    for folder in subfolders {
        collect_documents(&folder, depth + 1, out);
    }
}

/// Read one document. `None` when it is gone or unreadable, which is how a
/// deleted file leaves the corpus.
pub(crate) fn read_document(path: &Path) -> Option<CorpusDocument> {
    // Decoded, not just read: a UTF-16 document in the vault should be findable
    // by search and appear in the link graph like any other.
    let mut text = read_source(path).ok()?.text;
    if text.len() > MAX_DOCUMENT_BYTES {
        // Cut on a character boundary, never mid-codepoint.
        let mut cut = MAX_DOCUMENT_BYTES;
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
    }
    Some(CorpusDocument {
        label: path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(path)),
        path: path_to_string(path),
        text,
    })
}

/// The 1-based line a byte offset falls on.
fn line_number_at(text: &str, at: usize) -> u32 {
    (text[..at].matches('\n').count() + 1) as u32
}

/// The slug of the nearest ATX heading above `at`, so a hit can jump to its
/// section. Slugs are counted from the top of the document with the same
/// uniquing the renderer uses, or a second "## Notes" would land on the first.
fn heading_anchor_above(text: &str, at: usize) -> Option<String> {
    let mut seen = HashSet::new();
    let mut anchor = None;
    let mut offset = 0usize;
    for line in text.split_inclusive('\n') {
        if offset > at {
            break;
        }
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() {
                anchor = Some(unique_heading_slug(title, &mut seen));
            }
        }
        offset += line.len();
    }
    anchor
}

/// A window of text around a match, with the match marked. Cut on character
/// boundaries and elided with an ellipsis at each end that is not the document's.
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

/// The undirected link graph over a set of documents: one node each, one edge per
/// link that resolves to another document in the set.
///
/// Which documents are in the set is the caller's business and the only thing that
/// differs between a vault's map and the map around one document — how a graph is
/// built from them is the same either way, so it is written once. Note what that
/// means for a link out of the set: it resolves to nothing and draws no edge, so a
/// smaller set is a smaller picture rather than a wrong one.
pub(crate) fn build_graph(documents: &[CorpusDocument]) -> DocumentGraph {
    let mut path_to_index: HashMap<&str, usize> = HashMap::with_capacity(documents.len());
    let mut lower_path_to_index: HashMap<String, usize> = HashMap::new();
    // Name keys can collide across folders; first writer wins, a fine
    // best-effort for wiki-style links.
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

    // Documents take the first indices, so a node index is a document index until
    // the end of the list. Web addresses are appended as they are met.
    let mut nodes: Vec<GraphNode> = documents
        .iter()
        .map(|document| GraphNode {
            path: document.path.clone(),
            label: document.label.clone(),
            degree: 0,
            external: false,
        })
        .collect();
    let mut url_to_index: HashMap<String, usize> = HashMap::new();
    let mut truncated = false;

    let mut edges: HashSet<(usize, usize)> = HashSet::new();
    for (from, document) in documents.iter().enumerate() {
        let mut urls_from_here = 0usize;
        for link in document_links(&document.text, Path::new(&document.path)) {
            // A web address is its own node, shared by every document citing it —
            // which is the point: it shows which of your notes lean on one source.
            if let Some(url) = link.target_url {
                if urls_from_here >= MAX_EXTERNAL_LINKS_PER_DOCUMENT {
                    truncated = true;
                    continue;
                }
                urls_from_here += 1;
                let to = *url_to_index.entry(url.clone()).or_insert_with(|| {
                    nodes.push(GraphNode {
                        label: url_host_label(&url),
                        path: url,
                        degree: 0,
                        external: true,
                    });
                    nodes.len() - 1
                });
                edges.insert((from, to));
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
            edges.insert(if from < to { (from, to) } else { (to, from) });
        }
    }

    for (a, b) in &edges {
        nodes[*a].degree += 1;
        nodes[*b].degree += 1;
    }

    DocumentGraph {
        edges: edges
            .iter()
            .map(|(a, b)| GraphEdge {
                source: nodes[*a].path.clone(),
                target: nodes[*b].path.clone(),
            })
            .collect(),
        nodes,
        truncated,
    }
}

/// Apply the requested slice to a finished graph: a focused neighborhood, the
/// densest N, or all of it.
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
