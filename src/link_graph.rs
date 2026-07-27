//! The link graph, read off the disk.
//!
//! No index and no crawl: given one bounded root — the active vault, or the
//! folder the pane is in — this walks it, parses each document's outgoing links,
//! and resolves them against the documents it found. Nothing is stored, so
//! nothing goes stale: a renamed or deleted note is simply not there the next
//! time the graph opens.
//!
//! The link parsing itself is [`crate::indexer::document_links`], which never
//! needed the database — it takes a document's text and gives back its links.

use crate::indexer::{
    document_links, normalize_name_key, path_to_string, DocumentGraph, GraphEdge, GraphNode,
    GraphRequest,
};

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// Directories never walked, matching the pane's own listing rules.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "Pods",
    "__pycache__",
];

/// How many documents one graph may cover. A vault is bounded by construction,
/// but the folder fallback is whatever the pane happens to be in, and every
/// document here is a file read.
pub const MAX_GRAPH_DOCUMENTS: usize = 5_000;

/// How deep the walk goes.
const MAX_DEPTH: usize = 24;

/// Build the link graph for everything under `root`. `request` narrows it the
/// same way it always has: a focused neighborhood, the densest N, or all of it.
pub fn read_link_graph(root: &Path, request: &GraphRequest) -> DocumentGraph {
    let mut documents = Vec::new();
    collect_documents(root, 0, &mut documents);
    // More documents than one graph should draw: keep the ones nearest the root,
    // which the walk found first, and say the result is partial.
    let overflowed = documents.len() > MAX_GRAPH_DOCUMENTS;
    documents.truncate(MAX_GRAPH_DOCUMENTS);

    let graph = build_from_documents(&documents);
    let mut graph = narrow(graph, request);
    graph.truncated |= overflowed;
    graph
}

/// Every document under `dir`, breadth kept simple: a plain depth-first walk
/// with the pane's skip rules.
fn collect_documents(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth >= MAX_DEPTH || out.len() > MAX_GRAPH_DOCUMENTS {
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
            if crate::indexer::is_dir_reparse(&path) {
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

/// Read each document, parse its links, and resolve them against the set. Path
/// links match a document's path (exactly, then case-insensitively, the way
/// links resolve on Windows); `[[wiki]]` links match a file-name stem.
fn build_from_documents(documents: &[PathBuf]) -> DocumentGraph {
    struct Row {
        path: String,
        label: String,
    }

    let rows: Vec<Row> = documents
        .iter()
        .map(|path| Row {
            path: path_to_string(path),
            label: document_label(path),
        })
        .collect();

    let mut path_to_index: HashMap<String, usize> = HashMap::with_capacity(rows.len());
    let mut lower_path_to_index: HashMap<String, usize> = HashMap::with_capacity(rows.len());
    // Name keys can collide across folders; first writer wins, a fine
    // best-effort for wiki-style links.
    let mut name_to_index: HashMap<String, usize> = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        path_to_index.insert(row.path.clone(), index);
        lower_path_to_index
            .entry(row.path.to_lowercase())
            .or_insert(index);
        name_to_index
            .entry(normalize_name_key(&row.label))
            .or_insert(index);
    }

    let mut edges: HashSet<(usize, usize)> = HashSet::new();
    for (from, path) in documents.iter().enumerate() {
        // A document we cannot read contributes no links; it stays a node.
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for link in document_links(&content, path) {
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

    let mut degree: HashMap<usize, u32> = HashMap::new();
    for (a, b) in &edges {
        *degree.entry(*a).or_insert(0) += 1;
        *degree.entry(*b).or_insert(0) += 1;
    }

    DocumentGraph {
        nodes: rows
            .iter()
            .enumerate()
            .map(|(index, row)| GraphNode {
                path: row.path.clone(),
                label: row.label.clone(),
                degree: *degree.get(&index).unwrap_or(&0),
            })
            .collect(),
        edges: edges
            .into_iter()
            .map(|(a, b)| GraphEdge {
                source: rows[a].path.clone(),
                target: rows[b].path.clone(),
            })
            .collect(),
        truncated: false,
    }
}

/// A node's label: the file name without its document extension. The indexed
/// graph preferred the document's own title, which cost a parse of every file;
/// the pane shows file names now, so the two read alike.
fn document_label(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| path_to_string(path))
}

/// Apply the requested slice: a focused neighborhood, the densest N, or all of
/// it. Works on the finished graph, so it is the same rule whatever built it.
fn narrow(graph: DocumentGraph, request: &GraphRequest) -> DocumentGraph {
    let DocumentGraph {
        nodes,
        edges,
        truncated,
    } = graph;

    let (kept, truncated): (HashSet<String>, bool) = if let Some(seeds) = &request.focus {
        // Focus: the seed documents plus every document one link away.
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
