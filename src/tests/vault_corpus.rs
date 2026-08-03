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

fn titles(results: &crate::store::SearchResults) -> Vec<String> {
    results.hits.iter().map(|hit| hit.title.clone()).collect()
}

/// A vault the size of the cap, built in memory: the read is not what is being
/// timed, the scan is.
fn synthetic_corpus(count: usize) -> VaultCorpus {
    const FILLER: &str = "The path is long and the notes are many. Sitting still is a practice of attention and of patience, and the page says so again. ";
    let documents = (0..count)
        .map(|index| {
            let mut text = format!("# Note {index}\n\n");
            while text.len() < 8 * 1024 {
                text.push_str(FILLER);
                // Most of the vault must not match, or the timing measures
                // ranking rather than scanning.
                if index % 7 == 0 {
                    text.push_str("A talk on dharma.\n\n## Practice\n\n");
                }
            }
            CorpusDocument {
                path: format!("/vault/note-{index}.md"),
                label: format!("note-{index}"),
                aliases: Vec::new(),
                text,
            }
        })
        .collect();
    VaultCorpus {
        root: PathBuf::from("/vault"),
        documents,
        truncated: false,
    }
}

/// Phase 0 of `../docs/refactor/search.md`: what one keystroke costs. Ignored
/// because it is a measurement and machines differ — run it with
/// `cargo test --release -- --ignored --nocapture search_over_a_full_vault`.
///
/// Run it **twice and take the second**: the run straight after a build reads more
/// than twice the time for the same code, and no amount of warm-up inside the test
/// changes that.
#[test]
#[ignore]
fn search_over_a_full_vault_is_timed_not_guessed() {
    let corpus = synthetic_corpus(3_000);
    let bytes: usize = corpus.documents.iter().map(|d| d.text.len()).sum();
    println!(
        "corpus: {} documents, {:.1} MB",
        corpus.documents.len(),
        bytes as f64 / (1024.0 * 1024.0)
    );

    // The best of three, not one run: this machine's spread between runs of the
    // same code is wider than any of the changes being measured, and the first pass
    // pays for faulting 24 MB in. The fastest pass is the one where nothing else
    // got in the way.
    let best = |query: &str, within: Option<&[String]>| {
        (0..3)
            .map(|_| {
                let started = std::time::Instant::now();
                let results = corpus
                    .search_until(query, within, &|| false)
                    .expect("nothing overtook it");
                (started.elapsed(), results)
            })
            .min_by_key(|(elapsed, _)| *elapsed)
            .expect("three passes")
    };

    // Typing a word, one keystroke at a time, is the real load — timed twice: as
    // six searches of the whole vault, and the way the app does it, each keystroke
    // scanning only what the one before it matched.
    let word = "dharma";
    let mut whole = std::time::Duration::ZERO;
    let mut narrowed = std::time::Duration::ZERO;
    let mut matched: Option<Vec<String>> = None;
    for length in 1..=word.len() {
        let query = &word[..length];
        let (full, results) = best(query, None);
        let (short, _) = best(query, matched.as_deref());
        whole += full;
        narrowed += short;
        println!(
            "  {:>8} -> {:>3} hits, {:>7.1} ms over the vault, {:>7.1} ms narrowed",
            query,
            results.hits.len(),
            full.as_secs_f64() * 1000.0,
            short.as_secs_f64() * 1000.0
        );
        matched = Some(results.matched);
    }
    println!(
        "typing \"{word}\": {:.1} ms over the vault, {:.1} ms narrowed",
        whole.as_secs_f64() * 1000.0,
        narrowed.as_secs_f64() * 1000.0
    );

    // The non-ASCII query takes its own path, so it is timed on its own.
    println!(
        "non-ASCII query: {:.1} ms",
        best("é", None).0.as_secs_f64() * 1000.0
    );
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

    // Focus keeps the seed and its neighbors; a cap keeps the densest and says
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
    // A named file outranks a body match, and a file with the word twice gets a
    // row for each place it is, not one row standing for both.
    assert_eq!(titles(&hits), vec!["dharma", "opening", "opening"]);
    assert!(hits.hits[0].score > hits.hits[1].score);
    assert!(!hits.truncated);
    let places: Vec<u32> = hits.hits.iter().map(|hit| hit.start_line).collect();
    assert_eq!(places, vec![1, 3, 7]);

    // The body hit points at the line it matched and the heading above it, so
    // clicking the result lands in the right section.
    let opening = &hits.hits[1];
    assert_eq!(opening.anchor.as_deref(), Some("opening"));
    assert_eq!(opening.start_line, 3);
    // The snippet marks the match with the control characters the page turns
    // into <mark>, and never carries a newline.
    assert!(opening.snippet.contains('\u{2}'));
    assert!(opening.snippet.contains('\u{3}'));
    assert!(!opening.snippet.contains('\n'));

    // Every term has to land somewhere, in the name or the text.
    // Both terms land in one document, and each place they land is a row.
    assert_eq!(
        titles(&corpus.search("dharma practice")),
        vec!["opening", "opening", "opening"]
    );
    assert!(corpus.search("dharma carpentry").hits.is_empty());
    assert!(corpus.search("   ").hits.is_empty());
    // Case does not matter on either side.
    assert_eq!(titles(&corpus.search("DHARMA")), titles(&hits));

    // A match deeper in a document takes the heading it sits under, not the
    // document's first.
    let deep = corpus
        .search("daily")
        .hits
        .into_iter()
        .next()
        .expect("a hit for the second section");
    assert_eq!(deep.anchor.as_deref(), Some("practice"));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_snippet_is_cut_from_the_real_text_not_a_lowercased_copy() {
    let dir = corpus_dir("folding");
    let root = dir.join("vault");
    // İ is two bytes and lowercases to three, so every offset taken from a
    // lowercased copy is wrong from here down — a snippet showing the wrong
    // window, a wrong line, and a panic when the shift lands mid-character.
    write(
        &root.join("notes.md"),
        "# Notes\n\nİstanbul İstanbul İstanbul.\n\nThe dharma talk was on Tuesday.\n",
    );
    // ẞ goes the other way: three bytes down to two.
    write(
        &root.join("other.md"),
        "# Other\n\nSTRAẞE STRAẞE STRAẞE\n\nAnother dharma line.\n",
    );

    let corpus = VaultCorpus::read(&root);
    for hit in &corpus.search("dharma").hits {
        assert!(
            hit.snippet.contains("dharma"),
            "snippet cut around the wrong offset: {}",
            hit.snippet
        );
        assert_eq!(hit.start_line, 5);
    }

    // Case still does not matter, on either path: an ASCII query over text that
    // is not ASCII, and a query that is not ASCII itself.
    assert_eq!(titles(&corpus.search("TUESDAY")), vec!["notes"]);
    assert_eq!(
        titles(&corpus.search("straße")),
        vec!["other", "other", "other"]
    );
    let folded = corpus.search("İSTANBUL");
    assert_eq!(titles(&folded), vec!["notes", "notes", "notes"]);
    // Three appearances, three rows, each pointing at its own one.
    let offsets: Vec<&str> = folded.hits.iter().map(|hit| hit.snippet.as_str()).collect();
    assert_eq!(offsets.len(), 3);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_capped_result_set_says_it_was_capped() {
    let corpus = synthetic_corpus(60);
    // Every document carries the term, so the list is cut and has to say so. The
    // cap is on files, not rows: fifty files, up to three rows each.
    let broad = corpus.search("note");
    assert!(broad.truncated);
    let files: std::collections::BTreeSet<&str> =
        broad.hits.iter().map(|hit| hit.abs_path.as_str()).collect();
    assert_eq!(files.len(), 50);
    assert!(broad.hits.len() <= 150);

    // Exactly at the cap is not cut, and nor is anything under it.
    let exact = synthetic_corpus(50).search("note");
    assert!(!exact.truncated);
    assert!(!synthetic_corpus(3).search("note").truncated);
}

#[test]
fn a_longer_query_scans_only_what_the_shorter_one_matched() {
    let dir = corpus_dir("narrowing");
    let root = dir.join("vault");
    write(&root.join("one.md"), "# One\n\nA talk on dharma.\n");
    write(
        &root.join("two.md"),
        "# Two\n\nCarpentry, and dharma too.\n",
    );
    write(&root.join("three.md"), "# Three\n\nNothing of the sort.\n");
    let mut corpus = VaultCorpus::read(&root);

    let wide = corpus.search("dhar");
    let mut matched = wide.matched.clone();
    matched.sort();
    assert_eq!(matched.len(), 2);

    // The same answer, off two documents instead of three.
    let narrowed = corpus
        .search_until("dharma", Some(&wide.matched), &|| false)
        .expect("nothing overtook it");
    assert_eq!(titles(&narrowed), titles(&corpus.search("dharma")));

    // A document outside the set cannot be found, however well it matches — which
    // is why the caller may only narrow while the vault's text has not moved. The
    // app bumps a generation on every patch, and that is what refuses the narrowing.
    write(&root.join("four.md"), "# Four\n\nMore dharma still.\n");
    assert!(corpus.refresh(&root.join("four.md")));
    let stale = corpus
        .search_until("dharma", Some(&wide.matched), &|| false)
        .expect("nothing overtook it");
    assert!(!titles(&stale).contains(&"four".to_string()));
    // Scanned whole, the new document is there.
    assert!(titles(&corpus.search("dharma")).contains(&"four".to_string()));

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn ranking_puts_the_file_you_named_first_and_a_long_file_in_its_place() {
    let dir = corpus_dir("ranking");
    let root = dir.join("vault");
    // The name tiers, in order: the whole name, the start of it, the start of a
    // word inside it, and buried in one.
    write(&root.join("dharma.md"), "# One\n\nnothing\n");
    write(&root.join("dharma-talks.md"), "# Two\n\nnothing\n");
    write(&root.join("early dharma.md"), "# Three\n\nnothing\n");
    write(&root.join("saddharmapundarika.md"), "# Four\n\nnothing\n");
    let corpus = VaultCorpus::read(&root);
    assert_eq!(
        titles(&corpus.search("dharma")),
        vec![
            "dharma",
            "dharma-talks",
            "early dharma",
            "saddharmapundarika"
        ]
    );

    // A folder counts, and counts for less than the file's own name.
    let by_folder = corpus_dir("ranking-folder");
    let root = by_folder.join("vault");
    write(
        &root.join("dharma").join("monday.md"),
        "# Monday\n\nnothing\n",
    );
    write(
        &root.join("notes").join("dharma.md"),
        "# Notes\n\nnothing\n",
    );
    let corpus = VaultCorpus::read(&root);
    assert_eq!(titles(&corpus.search("dharma")), vec!["dharma", "monday"]);

    // A one-page note beats a long file that only mentions the word more often,
    // and a match in a heading beats the same word in a paragraph.
    let by_size = corpus_dir("ranking-size");
    let root = by_size.join("vault");
    write(&root.join("short.md"), "# Short\n\nA talk on dharma.\n");
    write(
        &root.join("long.md"),
        &format!(
            "# Long\n\n{}\n",
            "Filler about dharma and more filler. ".repeat(600)
        ),
    );
    write(&root.join("headed.md"), "# On dharma\n\nNothing else.\n");
    let corpus = VaultCorpus::read(&root);
    assert_eq!(
        titles(&corpus.search("dharma")),
        vec!["headed", "short", "long", "long", "long"]
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
    fs::remove_dir_all(&by_folder).expect("test directory is removed");
    fs::remove_dir_all(&by_size).expect("test directory is removed");
}

#[test]
fn a_wiki_link_reaches_a_note_by_its_alias() {
    let dir = corpus_dir("aliases");
    let root = dir.join("vault");
    write(
        &root.join("Wolfgang Amadeus Mozart.md"),
        "---\naliases:\n  - Mozart\n  - W. A. Mozart\n---\n\n# Mozart\n",
    );
    write(
        &root.join("listening.md"),
        "# Listening\n\nStarted with [[Mozart]], then [[w. a. mozart]] again.\n",
    );
    // Inline form, and an alias that is the file's own name: neither is a second
    // key, and the self-alias must not draw an edge from a note to itself.
    write(
        &root.join("Kv 626.md"),
        "---\naliases: [Requiem, \"Kv 626\"]\n---\n\n# Requiem\n\nSee [[Requiem]].\n",
    );

    let corpus = VaultCorpus::read(&root);
    let mozart = corpus
        .documents
        .iter()
        .find(|document| document.label == "Wolfgang Amadeus Mozart")
        .expect("the note is in the corpus");
    assert_eq!(mozart.aliases, vec!["Mozart", "W. A. Mozart"]);
    let requiem = corpus
        .documents
        .iter()
        .find(|document| document.label == "Kv 626")
        .expect("the requiem is in the corpus");
    assert_eq!(requiem.aliases, vec!["Requiem"]);

    // One edge from both wiki links in listening.md, and none from the note that
    // links to its own alias.
    let graph = corpus.graph(&GraphRequest::default());
    assert_eq!(graph.edges.len(), 1);
    let edge = &graph.edges[0];
    assert!(
        edge.source.ends_with("Wolfgang Amadeus Mozart.md")
            || edge.source.ends_with("listening.md"),
        "unexpected edge: {edge:?}"
    );

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn search_finds_a_note_by_its_alias_and_scores_it_like_a_name() {
    let dir = corpus_dir("alias-search");
    let root = dir.join("vault");
    write(
        &root.join("Wolfgang Amadeus Mozart.md"),
        "---\naliases: [Mozart]\n---\n\n# A life\n\nNothing here says the short name.\n",
    );
    // Says it in the body only, so a name match has to outrank it.
    write(
        &root.join("concerts.md"),
        "# Concerts\n\nMozart, Mozart, Mozart.\n",
    );

    let corpus = VaultCorpus::read(&root);
    let hits = corpus.search("mozart");
    // Three rows for concerts, one per match in it, all below the name match.
    assert_eq!(
        titles(&hits)[..2],
        ["Wolfgang Amadeus Mozart", "concerts"],
        "an alias matched whole beats a body match"
    );
    // The row says which name matched, since it is not the one on the row.
    assert_eq!(hits.hits[0].alias.as_deref(), Some("Mozart"));
    assert_eq!(hits.hits[1].alias, None);

    fs::remove_dir_all(&dir).expect("test directory is removed");

    // The whole scale, not a discount: an alias the term matches end to end is
    // worth the top of it, the same 400 a file name matched end to end is worth.
    // Anything less and a note would sort below worse matches for using the field.
    let dir = corpus_dir("alias-score");
    let root = dir.join("vault");
    write(&root.join("Zephyr.md"), "plain body\n");
    write(&root.join("Other.md"), "---\naliases: [Zephyr]\n---\n");

    let corpus = VaultCorpus::read(&root);
    for title in ["Zephyr", "Other"] {
        let hit = corpus
            .search("zephyr")
            .hits
            .into_iter()
            .find(|hit| hit.title == title)
            .expect("both notes match");
        assert!(hit.score >= 400.0, "{title} scored {}", hit.score);
    }

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_file_name_beats_an_alias_and_the_alias_cap_holds() {
    let dir = corpus_dir("alias-collisions");
    let root = dir.join("vault");
    // Two notes claim "Shared"; the one actually called that owns it.
    write(
        &root.join("First.md"),
        "---\naliases: [Shared]\n---\n\n# First\n",
    );
    write(&root.join("Shared.md"), "# Shared\n");
    write(&root.join("asking.md"), "# Asking\n\nGo to [[Shared]].\n");
    // Thirty-three claimed, thirty-two kept.
    let many: String = (0..33).map(|n| format!("  - name-{n}\n")).collect();
    write(
        &root.join("Many.md"),
        &format!("---\naliases:\n{many}---\n"),
    );

    let corpus = VaultCorpus::read(&root);
    let many = corpus
        .documents
        .iter()
        .find(|document| document.label == "Many")
        .expect("the note is in the corpus");
    assert_eq!(many.aliases.len(), crate::store::MAX_ALIASES);
    assert_eq!(many.aliases.last().map(String::as_str), Some("name-31"));

    // The edge lands on the file called Shared, not on the note preferring it.
    let graph = corpus.graph(&GraphRequest::default());
    assert_eq!(graph.edges.len(), 1);
    let shared = graph
        .nodes
        .iter()
        .find(|node| node.label == "Shared")
        .expect("Shared is a node");
    assert_eq!(shared.degree, 1);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn an_alias_edited_on_disk_moves_the_link_without_a_restart() {
    let dir = corpus_dir("alias-refresh");
    let root = dir.join("vault");
    let note = root.join("Long Name.md");
    write(&note, "---\naliases: [Short]\n---\n\n# Long Name\n");
    write(&root.join("asking.md"), "# Asking\n\nGo to [[Short]].\n");

    let mut corpus = VaultCorpus::read(&root);
    assert_eq!(corpus.graph(&GraphRequest::default()).edges.len(), 1);

    // The alias is the only thing that changed, and it is in the value the watcher
    // compares, so the link stops resolving without the vault being read again.
    write(&note, "# Long Name\n");
    assert!(corpus.refresh(&note));
    assert!(corpus.graph(&GraphRequest::default()).edges.is_empty());

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
    assert!(corpus.refresh(&root.join("b.md")));
    assert_eq!(corpus.documents.len(), 2);
    assert!(corpus.search("original").hits.is_empty());
    assert_eq!(titles(&corpus.search("rewritten")), vec!["b"]);

    // Added: a file that was not there at read time joins.
    write(&root.join("c.md"), "# C\n\nBrand new.\n");
    assert!(corpus.refresh(&root.join("c.md")));
    assert_eq!(titles(&corpus.search("brand")), vec!["c"]);

    // Deleted: gone from both, with nothing to prune and no stale node.
    fs::remove_file(root.join("b.md")).expect("file removed");
    assert!(corpus.refresh(&root.join("b.md")));
    assert_eq!(
        labels(&corpus.graph(&GraphRequest::default())),
        vec!["a", "c"]
    );
    assert!(corpus.graph(&GraphRequest::default()).edges.is_empty());
    assert!(corpus.search("rewritten").hits.is_empty());

    // Something outside the vault is not the vault's business.
    write(&dir.join("outside.md"), "# Outside\n");
    assert!(!corpus.refresh(&dir.join("outside.md")));
    assert_eq!(corpus.documents.len(), 2);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn a_change_that_changed_nothing_says_so() {
    let dir = corpus_dir("refresh-unchanged");
    let root = dir.join("vault");
    write(&root.join("a.md"), "# A\n\n[c](./c.md)\n");

    let mut corpus = VaultCorpus::read(&root);

    // The graph on screen is redrawn off this answer, so everything the watcher
    // reports that cannot have moved a document has to answer no. A vault is a
    // folder someone works in: most of what happens in it is not a document.
    write(&root.join(".git").join("index"), "not a document\n");
    assert!(!corpus.refresh(&root.join(".git").join("index")));
    write(&root.join("diagram.png"), "not a document either\n");
    assert!(!corpus.refresh(&root.join("diagram.png")));
    // Nor is a document whose bytes came back the same -- a watcher fires more
    // than once for one save, and a touch is not an edit.
    write(&root.join("a.md"), "# A\n\n[c](./c.md)\n");
    assert!(!corpus.refresh(&root.join("a.md")));
    // A link to a file that is not there is not a node, so nothing changes when
    // one that was never in the corpus is reported gone.
    assert!(!corpus.refresh(&root.join("c.md")));
    assert_eq!(corpus.documents.len(), 1);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}
