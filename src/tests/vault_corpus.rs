//! A vault's text in memory: one read, serving both the graph and search.

use super::*;

use crate::store::GraphRequest;

fn corpus_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("leaf-corpus-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent created");
    }
    fs::write(path, contents).expect("file written");
}

fn labels(graph: &crate::store::DocumentGraph) -> Vec<String> {
    let mut names: Vec<String> = graph.nodes.iter().map(|node| node.label.clone()).collect();
    names.sort();
    names
}

fn titles(hits: &[crate::store::SearchHit]) -> Vec<String> {
    hits.iter().map(|hit| hit.title.clone()).collect()
}

#[test]
fn one_read_graphs_the_vault_with_no_database_involved() {
    let dir = corpus_dir("graph");
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
    // read the vault rather than accumulate as you click.
    write(&root.join("orphan.md"), "# Orphan\n");

    let corpus = VaultCorpus::read(&root);
    let graph = corpus.graph(&GraphRequest::default());
    assert_eq!(labels(&graph), vec!["opening", "orphan", "refuge", "vows"]);
    assert!(!graph.truncated);

    // Two edges: opening–refuge (both directions collapse to one) and the wiki
    // link opening–vows. The dangling link contributes nothing.
    assert_eq!(graph.edges.len(), 2);
    let opening = graph
        .nodes
        .iter()
        .find(|node| node.label == "opening")
        .expect("opening is a node");
    assert_eq!(opening.degree, 2);
    let orphan = graph
        .nodes
        .iter()
        .find(|node| node.label == "orphan")
        .expect("orphan is a node");
    assert_eq!(orphan.degree, 0);

    // Focus keeps the seed and its neighbours; a cap keeps the densest and says
    // the picture is partial.
    let focused = corpus.graph(&GraphRequest {
        focus: Some(vec![crate::store::path_to_string(&root.join("refuge.md"))]),
        limit: None,
    });
    assert_eq!(labels(&focused), vec!["opening", "refuge"]);
    assert_eq!(focused.edges.len(), 1);

    let capped = corpus.graph(&GraphRequest {
        focus: None,
        limit: Some(2),
    });
    assert!(capped.truncated);
    assert_eq!(capped.nodes.len(), 2);
    assert!(capped.nodes.iter().any(|node| node.label == "opening"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_same_read_answers_search() {
    let dir = corpus_dir("search");
    let root = dir.join("vault");
    write(
        &root.join("opening.md"),
        "# Opening\n\nA talk on dharma.\n\n## Practice\n\nSit with the dharma daily.\n",
    );
    write(&root.join("dharma.md"), "# Dharma\n\nNothing else here.\n");
    write(&root.join("unrelated.md"), "# Unrelated\n\nCarpentry.\n");

    let corpus = VaultCorpus::read(&root);

    let hits = corpus.search("dharma");
    // A named file outranks a body match, the way the indexed search did.
    assert_eq!(titles(&hits), vec!["dharma", "opening"]);
    assert!(hits[0].score > hits[1].score);

    // The body hit points at the line it matched and the heading above it, so
    // clicking the result lands in the right section.
    let opening = &hits[1];
    assert_eq!(opening.anchor.as_deref(), Some("opening"));
    assert_eq!(opening.start_line, 3);
    // The snippet marks the match with the control characters the page turns
    // into <mark>, and never carries a newline.
    assert!(opening.snippet.contains('\u{2}'));
    assert!(opening.snippet.contains('\u{3}'));
    assert!(!opening.snippet.contains('\n'));

    // Every term has to land somewhere, in the name or the text.
    assert_eq!(titles(&corpus.search("dharma practice")), vec!["opening"]);
    assert!(corpus.search("dharma carpentry").is_empty());
    assert!(corpus.search("   ").is_empty());
    // Case does not matter on either side.
    assert_eq!(titles(&corpus.search("DHARMA")), titles(&hits));

    // A match deeper in a document takes the heading it sits under, not the
    // document's first.
    let deep = corpus
        .search("daily")
        .into_iter()
        .next()
        .expect("a hit for the second section");
    assert_eq!(deep.anchor.as_deref(), Some("practice"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn the_watcher_patches_one_file_rather_than_re_reading_the_vault() {
    let dir = corpus_dir("refresh");
    let root = dir.join("vault");
    write(&root.join("a.md"), "# A\n\n[b](./b.md)\n");
    write(&root.join("b.md"), "# B\n\nOriginal wording.\n");

    let mut corpus = VaultCorpus::read(&root);
    assert_eq!(corpus.documents.len(), 2);
    assert_eq!(corpus.graph(&GraphRequest::default()).edges.len(), 1);
    assert_eq!(titles(&corpus.search("original")), vec!["b"]);

    // Edited: the new text is searchable, the old is not.
    write(&root.join("b.md"), "# B\n\nRewritten wording.\n");
    corpus.refresh(&root.join("b.md"));
    assert_eq!(corpus.documents.len(), 2);
    assert!(corpus.search("original").is_empty());
    assert_eq!(titles(&corpus.search("rewritten")), vec!["b"]);

    // Added: a file that was not there at read time joins.
    write(&root.join("c.md"), "# C\n\nBrand new.\n");
    corpus.refresh(&root.join("c.md"));
    assert_eq!(titles(&corpus.search("brand")), vec!["c"]);

    // Deleted: gone from both, with nothing to prune and no stale node.
    fs::remove_file(root.join("b.md")).expect("file removed");
    corpus.refresh(&root.join("b.md"));
    assert_eq!(
        labels(&corpus.graph(&GraphRequest::default())),
        vec!["a", "c"]
    );
    assert!(corpus.graph(&GraphRequest::default()).edges.is_empty());
    assert!(corpus.search("rewritten").is_empty());

    // Something outside the vault is not the vault's business.
    write(&dir.join("outside.md"), "# Outside\n");
    corpus.refresh(&dir.join("outside.md"));
    assert_eq!(corpus.documents.len(), 2);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}
