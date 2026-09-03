//! The map around one document — what a document gets when no vault holds it.

use super::*;

use crate::store::{DocumentGraph, GraphRequest};

fn graph_dir(tag: &str) -> PathBuf {
    scratch_dir(&format!("docgraph-{tag}"))
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent created");
    }
    fs::write(path, contents).expect("file written");
}

fn labels(graph: &DocumentGraph) -> Vec<String> {
    let mut names: Vec<String> = graph.nodes.iter().map(|node| node.label.clone()).collect();
    names.sort();
    names
}

/// Whether two nodes are joined, named by their labels — a document's file stem or a web address's domain, which is what the map itself shows.
fn linked(graph: &DocumentGraph, a: &str, b: &str) -> bool {
    let label_of = |path: &str| {
        graph
            .nodes
            .iter()
            .find(|node| node.path == path)
            .map(|node| node.label.clone())
            .unwrap_or_default()
    };
    graph.edges.iter().any(|edge| {
        let ends = [label_of(&edge.source), label_of(&edge.target)];
        ends.contains(&a.to_string()) && ends.contains(&b.to_string())
    })
}

#[test]
fn graph_scope_accepts_only_the_four_words_the_page_sends() {
    assert_eq!(GraphScope::from_client("small"), Some(GraphScope::Small));
    assert_eq!(GraphScope::from_client("medium"), Some(GraphScope::Medium));
    assert_eq!(GraphScope::from_client("large"), Some(GraphScope::Large));
    assert_eq!(GraphScope::from_client("xl"), Some(GraphScope::Xl));
    for other in ["", "focus", "XL", "everything"] {
        assert_eq!(GraphScope::from_client(other), None, "{other}");
    }
}

#[test]
fn a_document_in_no_vault_still_has_a_map_of_what_it_links_to() {
    let dir = graph_dir("loose");
    // No vault anywhere near this: just a folder with documents in it, which still has to draw a map.
    let seed = dir.join("opening.md");
    write(
        &seed,
        "# Opening\n\nSee [refuge](./refuge.md), [[vows]], and [gone](./missing.md).\n",
    );
    write(&dir.join("refuge.md"), "# Refuge\n");
    write(&dir.join("vows.md"), "# Vows\n");
    // A sibling that links *to* the seed. Nothing in the seed's own text says so, which is exactly why the folder is read.
    write(
        &dir.join("commentary.md"),
        "# Commentary\n\nOn [the opening](./opening.md).\n",
    );

    let graph = document_graph(&seed, &GraphRequest::default());
    assert_eq!(
        labels(&graph),
        vec!["commentary", "opening", "refuge", "vows"]
    );
    // The relative link, the wiki name, and the backlink — three edges. The link that resolves nowhere draws none.
    assert!(linked(&graph, "opening", "refuge"));
    assert!(linked(&graph, "opening", "vows"));
    assert!(linked(&graph, "opening", "commentary"));
    assert_eq!(graph.edges.len(), 3);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_link_out_of_the_folder_is_followed_but_the_tree_below_is_not() {
    let dir = graph_dir("reach");
    let here = dir.join("here");
    let seed = here.join("opening.md");
    // One link up and across, into a folder the seed does not live in.
    write(&seed, "# Opening\n\nSee [away](../elsewhere/away.md).\n");
    write(
        &dir.join("elsewhere").join("away.md"),
        "# Away\n\nAnd on to [further](./further.md).\n",
    );
    write(&dir.join("elsewhere").join("further.md"), "# Further\n");
    // Below the seed's own folder. One level is the rule, so this is not read — descending is how a bounded read becomes a crawl.
    write(&here.join("below").join("deep.md"), "# Deep\n");

    let graph = document_graph(&seed, &GraphRequest::default());
    // The document it points at is there. `further` is not: only the seed's own links are followed, or every link would pull in the next one's links too. Neither is `deep`, which sits below the folder rather than in it.
    assert_eq!(labels(&graph), vec!["away", "opening"]);
    assert!(linked(&graph, "opening", "away"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_loose_document_resolves_an_alias_because_the_graph_is_built_once() {
    let dir = graph_dir("alias");
    let seed = dir.join("listening.md");
    write(&seed, "# Listening\n\nStarted with [[Mozart]].\n");
    write(
        &dir.join("Wolfgang Amadeus Mozart.md"),
        "---\naliases: [Mozart]\n---\n\n# Mozart\n",
    );

    // Nothing in `doc_graph.rs` knows what an alias is; it shares `build_graph` with the vault, so the name index it gets is the same one.
    let graph = document_graph(&seed, &GraphRequest::default());
    assert!(linked(&graph, "listening", "Wolfgang Amadeus Mozart"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn focus_narrows_a_document_map_the_same_way_it_narrows_a_vault() {
    let dir = graph_dir("focus");
    let seed = dir.join("opening.md");
    write(&seed, "# Opening\n\nSee [refuge](./refuge.md).\n");
    write(&dir.join("refuge.md"), "# Refuge\n");
    // Two siblings that link to each other and not to the seed: in the picture at full size, out of it under Focus.
    write(&dir.join("aside.md"), "# Aside\n\n[other](./other.md)\n");
    write(&dir.join("other.md"), "# Other\n");

    let everything = document_graph(&seed, &GraphRequest::default());
    assert_eq!(
        labels(&everything),
        vec!["aside", "opening", "other", "refuge"]
    );

    let focused = document_graph(
        &seed,
        &GraphRequest {
            focus: Some(vec![seed.to_string_lossy().to_string()]),
            limit: None,
        },
    );
    assert_eq!(labels(&focused), vec!["opening", "refuge"]);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn bare_web_addresses_are_nodes_because_the_reader_can_click_them() {
    let dir = graph_dir("urls");
    let seed = dir.join("guide.md");
    // The shape that drew an empty map: a document whose only links out are bare URLs. They are not links in the source — the renderer linkifies them in the plain text — so the graph has to look for them the same way.
    write(
        &seed,
        "# Guide\n\nSources used:\n\n- Reddit: https://www.reddit.com/r/x/comments/1/y/\n\
         - Steam: https://steamcommunity.com/sharedfiles/filedetails/?id=3487014937\n\
         - Written out: [the wiki](https://en.wikipedia.org/wiki/Avalon)\n\
         - Angled: <https://example.org/a>\n\
         - Mail: someone@example.org\n",
    );

    let graph = document_graph(&seed, &GraphRequest::default());
    // Labeled by domain, `www.` dropped. The email is not an address a map goes to.
    assert_eq!(
        labels(&graph),
        vec![
            "en.wikipedia.org",
            "example.org",
            "guide",
            "reddit.com",
            "steamcommunity.com"
        ]
    );
    assert_eq!(graph.edges.len(), 4);
    assert!(linked(&graph, "guide", "reddit.com"));
    assert!(linked(&graph, "guide", "steamcommunity.com"));

    // The whole URL is the node's identity, so a click has somewhere to go — and a trailing slash is not a different page.
    let reddit = graph
        .nodes
        .iter()
        .find(|node| node.label == "reddit.com")
        .expect("the reddit node is on the map");
    assert_eq!(reddit.path, "https://www.reddit.com/r/x/comments/1/y");
    assert!(reddit.external);
    // And a document is never marked external, or clicking it would open a browser.
    assert!(graph
        .nodes
        .iter()
        .all(|node| node.external != (node.label == "guide")));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn two_documents_citing_one_page_share_its_node() {
    let dir = graph_dir("shared");
    let seed = dir.join("first.md");
    // Same article, three spellings: a trailing slash, a fragment, and a capitalized host. One node, cited twice — which is the reason to draw it.
    write(&seed, "# First\n\nSee https://example.org/Article/\n");
    write(
        &dir.join("second.md"),
        "# Second\n\nAlso [it](https://EXAMPLE.org/Article#notes)\n",
    );

    let graph = document_graph(&seed, &GraphRequest::default());
    assert_eq!(labels(&graph), vec!["example.org", "first", "second"]);
    assert!(linked(&graph, "first", "example.org"));
    assert!(linked(&graph, "second", "example.org"));
    // The path's case is left alone — only the scheme and host are folded, because only those are case-insensitive.
    let page = graph
        .nodes
        .iter()
        .find(|node| node.external)
        .expect("the shared page is on the map");
    assert_eq!(page.path, "https://example.org/Article");
    assert_eq!(page.degree, 2);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn an_edge_keeps_the_direction_it_was_written_in() {
    let dir = graph_dir("direction");
    let seed = dir.join("opening.md");
    write(
        &seed,
        "# Opening\n\nSee [refuge](./refuge.md) and https://example.org/a\n",
    );
    // Links back, so that pair goes both ways.
    write(
        &dir.join("refuge.md"),
        "# Refuge\n\n[opening](./opening.md)\n",
    );
    // Points at the seed and is never pointed at: one way.
    write(
        &dir.join("commentary.md"),
        "# Commentary\n\nOn [the opening](./opening.md).\n",
    );

    let graph = document_graph(&seed, &GraphRequest::default());
    let label_of = |path: &str| {
        graph
            .nodes
            .iter()
            .find(|node| node.path == path)
            .map(|node| node.label.clone())
            .unwrap_or_default()
    };
    let mut drawn: Vec<String> = graph
        .edges
        .iter()
        .map(|edge| {
            let arrow = if edge.mutual { "<->" } else { "->" };
            format!(
                "{} {arrow} {}",
                label_of(&edge.source),
                label_of(&edge.target)
            )
        })
        .collect();
    drawn.sort();

    assert_eq!(
        drawn,
        vec![
            // One way, pointing away from whoever wrote the link.
            "commentary -> opening",
            // A page cannot link back, so an address is always the target.
            "opening -> example.org",
            // Both ways: one line, marked so the page puts a head on each end. Its orientation is sorted rather than arbitrary, so two reads of an unchanged folder produce the same list.
            "opening <-> refuge",
        ]
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_document_that_is_gone_is_an_empty_map_rather_than_a_failure() {
    let dir = graph_dir("missing");
    let graph = document_graph(&dir.join("never-written.md"), &GraphRequest::default());
    assert!(graph.nodes.is_empty());
    assert!(graph.edges.is_empty());
    assert!(!graph.truncated);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}
