//! The code view's typing help: headings, note lists, previews, and the
//! broken-link check.

use super::*;

use crate::code_intel::{
    corpus_note_items, document_headings, find_note, folder_note_items, folder_note_names,
    known_note_names, lint_links, note_preview, read_folder_note,
};
use crate::store::document_links;
use crate::vault_corpus::CorpusDocument;

use std::collections::HashSet;

fn intel_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("leaf-codeintel-{tag}-{nanos}"));
    fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn doc(label: &str, path: &str, text: &str) -> CorpusDocument {
    CorpusDocument {
        label: label.to_string(),
        path: path.to_string(),
        text: text.to_string(),
    }
}

// ---- headings ---------------------------------------------------------------

#[test]
fn headings_carry_the_renderer_s_own_anchors() {
    let text = "# My Title\n\n## Notes\n\nwords\n\n## Notes\n\n### Deep dive!\n";
    let headings = document_headings(text, Path::new("C:/tmp/doc.md"));
    let pairs: Vec<(&str, &str)> = headings
        .iter()
        .map(|h| (h.text.as_str(), h.slug.as_str()))
        .collect();
    // The second "Notes" gets the renderer's uniquing suffix, and punctuation
    // drops out of the slug exactly as the reading view drops it.
    assert_eq!(
        pairs,
        vec![
            ("My Title", "my-title"),
            ("Notes", "notes"),
            ("Notes", "notes-1"),
            ("Deep dive!", "deep-dive"),
        ]
    );
}

#[test]
fn headings_come_back_empty_for_a_document_without_any() {
    assert!(document_headings("plain words\n", Path::new("C:/tmp/doc.md")).is_empty());
}

// ---- notes ------------------------------------------------------------------

#[test]
fn corpus_notes_are_sorted_and_carry_their_folder() {
    let root = Path::new("C:/vault");
    let documents = vec![
        doc("Zebra", "C:/vault/sub/Zebra.md", ""),
        doc("alpha", "C:/vault/alpha.md", ""),
    ];
    let items = corpus_note_items(&documents, root);
    assert_eq!(items[0].label, "alpha");
    assert_eq!(items[0].detail, "");
    assert_eq!(items[1].label, "Zebra");
    assert_eq!(items[1].detail, "sub");
}

#[test]
fn find_note_matches_the_way_wiki_links_resolve() {
    let documents = vec![doc("My Note", "C:/vault/My Note.md", "hello")];
    assert!(find_note("my note", &documents).is_some());
    assert!(find_note("  MY NOTE ", &documents).is_some());
    assert!(find_note("other", &documents).is_none());
}

#[test]
fn a_folder_answers_notes_names_and_reads_for_a_document_outside_every_vault() {
    let dir = intel_dir("folder");
    fs::write(dir.join("Sibling.md"), "# Sibling\n\nbody\n").expect("sibling written");
    fs::write(dir.join("notes.txt"), "not a document").expect("txt written");

    let items = folder_note_items(&dir);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].label, "Sibling");

    let names = folder_note_names(&dir);
    assert!(names.contains("sibling"));

    let found = read_folder_note("sibling", &dir).expect("note read");
    assert!(found.text.contains("body"));
    assert!(read_folder_note("ghost", &dir).is_none());

    fs::remove_dir_all(&dir).ok();
}

// ---- preview ----------------------------------------------------------------

#[test]
fn preview_skips_leading_blanks_and_marks_what_it_cut() {
    let short = note_preview("\n\n# Title\nbody\n");
    assert_eq!(short, "# Title\nbody");

    let long_note = (0..40).map(|i| format!("line {i}\n")).collect::<String>();
    let long = note_preview(&long_note);
    assert!(long.ends_with('…'));
    assert!(long.lines().count() <= 14);
}

// ---- the broken-link check --------------------------------------------------

#[test]
fn lint_marks_missing_paths_and_unknown_notes_and_nothing_else() {
    let dir = intel_dir("lint");
    fs::write(dir.join("real.md"), "# Real\n").expect("target written");
    let source = dir.join("doc.md");
    let text =
        "[fine](real.md)\n[gone](missing.md)\n[[Known]] and [[Ghost]]\nhttps://example.com/page\n";
    fs::write(&source, text).expect("source written");

    let known: HashSet<String> = ["known".to_string()].into();
    let markers = lint_links(text, &source, &known);

    assert_eq!(markers.len(), 2, "markers: {markers:?}");
    // The missing path, underlined as the whole `[gone](missing.md)` on line 2.
    assert_eq!(markers[0].start_line, 2);
    assert_eq!(markers[0].start_col, 1);
    assert_eq!(markers[0].end_col, 1 + "[gone](missing.md)".len() as u32);
    assert!(markers[0].message.contains("path"));
    // The unknown note, underlined as `[[Ghost]]` on line 3.
    assert_eq!(markers[1].start_line, 3);
    assert_eq!(markers[1].start_col, 1 + "[[Known]] and ".len() as u32);
    assert!(markers[1].message.contains("name"));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn lint_columns_count_utf16_units_the_way_the_editor_does() {
    let dir = intel_dir("utf16");
    let source = dir.join("doc.md");
    // Emoji ahead of the link: 4 bytes, 2 UTF-16 units, 1 char. Monaco counts
    // UTF-16 units, so the column must land after 2, not 4 or 1.
    let text = "😀 [gone](missing.md)\n";
    fs::write(&source, text).expect("source written");

    let markers = lint_links(text, &source, &HashSet::new());
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].start_line, 1);
    assert_eq!(markers[0].start_col, 4); // 1 + emoji(2) + space(1)

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn known_note_names_use_the_graph_s_normalization() {
    let documents = vec![doc("My Note", "C:/vault/My Note.md", "")];
    let names = known_note_names(&documents);
    assert!(names.contains("my note"));
}

// ---- spans ------------------------------------------------------------------

#[test]
fn document_links_place_each_link_in_the_source() {
    let text = "start [label](target.md) then [[Wiki Name]] end\n";
    let links = document_links(text, Path::new("C:/tmp/doc.md"));

    let path_link = links
        .iter()
        .find(|link| link.target_abs.is_some())
        .expect("path link found");
    let (start, end) = path_link.span.expect("path link placed");
    assert_eq!(&text[start..end], "[label](target.md)");

    let wiki_link = links
        .iter()
        .find(|link| link.target_name.is_some())
        .expect("wiki link found");
    let (start, end) = wiki_link.span.expect("wiki link placed");
    assert_eq!(&text[start..end], "[[Wiki Name]]");
}
