//! The link graph, read off the disk with no index behind it.

use super::*;

use crate::indexer::{path_to_string, DocumentGraph, GraphRequest};

fn graph_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("leaf-link-graph-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent created");
    }
    fs::write(path, contents).expect("file written");
}

fn labels(graph: &DocumentGraph) -> Vec<String> {
    let mut names: Vec<String> = graph.nodes.iter().map(|n| n.label.clone()).collect();
    names.sort();
    names
}

#[test]
fn a_folder_graphs_itself_with_no_database_involved() {
    let dir = graph_dir("read");
    let root = dir.join("vault");
    // A relative link, a wiki link, and a link that resolves nowhere.
    write(
        &root.join("opening.md"),
        "# Opening\n\nSee [refuge](./refuge.md) and [[vows]] and [gone](./missing.md).\n",
    );
    write(
        &root.join("refuge.md"),
        "# Refuge\n\nBack to [opening](./opening.md).\n",
    );
    write(&root.join("deep").join("vows.md"), "# Vows\n");
    // Never opened, never linked: still a node, which is the whole reason to
    // read rather than accumulate.
    write(&root.join("orphan.md"), "# Orphan\n");

    let graph = read_link_graph(&root, &GraphRequest::default());
    assert_eq!(labels(&graph), vec!["opening", "orphan", "refuge", "vows"]);
    assert!(!graph.truncated);

    // Two edges: opening–refuge (both directions collapse to one) and the wiki
    // link opening–vows. The dangling link contributes nothing.
    assert_eq!(graph.edges.len(), 2);
    let opening = graph
        .nodes
        .iter()
        .find(|n| n.label == "opening")
        .expect("opening is a node");
    assert_eq!(opening.degree, 2);
    let orphan = graph
        .nodes
        .iter()
        .find(|n| n.label == "orphan")
        .expect("orphan is a node");
    assert_eq!(orphan.degree, 0);

    // Focus keeps the seed and its neighbours, and drops the rest.
    let focused = read_link_graph(
        &root,
        &GraphRequest {
            focus: Some(vec![path_to_string(&root.join("refuge.md"))]),
            limit: None,
        },
    );
    assert_eq!(labels(&focused), vec!["opening", "refuge"]);
    assert_eq!(focused.edges.len(), 1);

    // A cap keeps the densest and flags the result partial.
    let capped = read_link_graph(
        &root,
        &GraphRequest {
            focus: None,
            limit: Some(2),
        },
    );
    assert!(capped.truncated);
    assert_eq!(capped.nodes.len(), 2);
    assert!(capped.nodes.iter().any(|n| n.label == "opening"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_graph_reflects_the_disk_the_moment_it_changes() {
    let dir = graph_dir("fresh");
    let root = dir.join("vault");
    write(&root.join("a.md"), "# A\n\n[b](./b.md)\n");
    write(&root.join("b.md"), "# B\n");

    let before = read_link_graph(&root, &GraphRequest::default());
    assert_eq!(before.nodes.len(), 2);
    assert_eq!(before.edges.len(), 1);

    // Nothing is stored, so a deleted note is simply gone the next time — no
    // stale node, and nothing to prune.
    fs::remove_file(root.join("b.md")).expect("file removed");
    let after = read_link_graph(&root, &GraphRequest::default());
    assert_eq!(labels(&after), vec!["a"]);
    assert!(after.edges.is_empty());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}
