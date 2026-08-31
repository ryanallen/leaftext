//! The link graph around one document.
//!
//! What a document gets when no vault holds it, so opening the map never depends on having named a vault first. A document that links to things has a map whether or not anyone has drawn a boundary around the folder it lives in — the links are sitting in its own text.
//!
//! The vault's corpus reads a whole folder tree because search has to see every word in it. A map of one document does not need that, and must not do it: this reads the document, the folder it sits in (one level, no further), and whatever the document points at. So the work is bounded by how many links the document has, not by how big the disk under it is. Falling back to "whatever folder the pane is showing" instead means opening the map at `C:\` walks the drive.
//!
//! **What it cannot see.** An outgoing link is written in the document; an incoming one is only ever written in somebody else's. Reading the folder recovers what links back from among the siblings, and nothing further out. So a document's own map is smaller than the same document's map inside a vault, and `[[wiki]]` names resolve only against that one folder. Smaller, not wrong: a link out of the set resolves to nothing and simply draws no edge.
//!
//! Nothing is cached. The vault's text is held in memory because reading it costs thousands of files; this costs one folder, so it is read again each time a map is drawn and can never be out of step with the disk.

use crate::store::{document_links, path_to_string, DocumentGraph, GraphRequest};
use crate::vault_corpus::{build_graph, narrow, read_document, CorpusDocument};

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// How many documents one document's map may gather. A folder is bounded by construction; this is the backstop for a document sitting in someone's downloads folder next to a thousand others.
///
/// Also the cap on how many of a folder's files typing help will open ([`crate::code_intel`]): how much of one folder this app reads is one answer.
pub(crate) const MAX_DOCUMENTS: usize = 500;

/// The graph around `seed`, sliced by `request` exactly as a vault's graph is.
///
/// The requested slice is applied to the gathered set, so "Focus" here means the same thing it means in a vault — the document and everything one link away.
pub fn document_graph(seed: &Path, request: &GraphRequest) -> DocumentGraph {
    let (documents, truncated) = gather(seed);
    let mut graph = narrow(build_graph(&documents), request);
    graph.truncated |= truncated;
    graph
}

/// The documents a map of `seed` is drawn over, and whether the cap left any out.
fn gather(seed: &Path) -> (Vec<CorpusDocument>, bool) {
    let Some(document) = read_document(seed) else {
        // Gone or unreadable: an empty graph, which the page shows as having nothing to draw. There is nothing else honest to put on screen.
        return (Vec::new(), false);
    };
    // Resolved against the document's own location, and taken before anything else is read: this is the one list that comes from the document rather than from the disk around it.
    let targets: Vec<String> = document_links(&document.text, seed)
        .into_iter()
        .filter_map(|link| link.target_abs)
        .collect();

    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(dedup_key(&document.path));
    let mut documents = vec![document];
    let mut truncated = false;

    // The folder the document sits in, one level deep. This is the half of the picture the document's own text cannot supply — what links *here* — and one level is where it stops, because a folder holds a document's siblings and a tree is where a crawl starts.
    if let Some(folder) = seed.parent() {
        for path in folder_documents(folder) {
            if documents.len() >= MAX_DOCUMENTS {
                truncated = true;
                break;
            }
            if !seen.insert(dedup_key(&path_to_string(&path))) {
                continue;
            }
            if let Some(sibling) = read_document(&path) {
                documents.push(sibling);
            }
        }
    }

    // Then what the document points at, wherever that lives — a link across the disk is still a link. Only the seed's own links are followed: every sibling gathered above has links too, and following those as well is how a read bounded by one document turns back into a walk of everything reachable.
    for target in targets {
        if documents.len() >= MAX_DOCUMENTS {
            truncated = true;
            break;
        }
        if !seen.insert(dedup_key(&target)) {
            continue;
        }
        let path = PathBuf::from(&target);
        if !crate::is_listed_document_path(&path) {
            continue;
        }
        if let Some(linked) = read_document(&path) {
            documents.push(linked);
        }
    }

    (documents, truncated)
}

/// The documents directly inside one folder. Files only, and nothing below is opened — that is what keeps this bounded. The code view's completions read the same listing, which is why this is visible outside the graph.
pub(crate) fn folder_documents(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .filter(|path| crate::is_listed_document_path(path))
        .collect();
    // Sorted so the cap above keeps the same documents every time. A map that reshuffles between two reads of a folder nobody touched reads as a bug.
    paths.sort();
    paths
}

/// The key two paths are the same document under. Windows reaches one file under either spelling, so a link written `./Notes.md` and a folder entry named `notes.md` must not be read twice and drawn as two nodes.
fn dedup_key(path: &str) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path.to_string()
    }
}
