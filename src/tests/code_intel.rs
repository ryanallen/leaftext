//! The code view's typing help: headings, note lists, previews, and the broken-link check.

use super::*;

use crate::code_intel::{
    corpus_note_items, document_headings, find_note, folder_note_items, folder_note_names,
    known_note_names, lint_links, note_preview, read_folder_note, NoteNames,
};
use crate::store::document_links;
use crate::vault_corpus::CorpusDocument;

fn intel_dir(tag: &str) -> PathBuf {
    scratch_dir(&format!("codeintel-{tag}"))
}

fn doc(label: &str, path: &str, text: &str) -> CorpusDocument {
    CorpusDocument {
        label: label.to_string(),
        aliases: Vec::new(),
        path: path.to_string(),
        text: text.to_string(),
    }
}

/// The same document, answering to other names as well.
fn aliased(document: CorpusDocument, aliases: &[&str]) -> CorpusDocument {
    CorpusDocument {
        aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
        ..document
    }
}

/// What the broken-link check is given: notes by name, each with its aliases.
fn note_names(notes: &[(&str, &[&str])]) -> crate::code_intel::NoteNames {
    let documents: Vec<CorpusDocument> = notes
        .iter()
        .map(|(label, aliases)| aliased(doc(label, &format!("C:/vault/{label}.md"), ""), aliases))
        .collect();
    known_note_names(&documents)
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
    // The second "Notes" gets the renderer's uniquing suffix, and punctuation drops out of the slug exactly as the reading view drops it.
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
fn the_popup_offers_an_alias_as_its_own_row_naming_the_file_it_opens() {
    let root = Path::new("C:/vault");
    let documents = vec![aliased(
        doc(
            "Wolfgang Amadeus Mozart",
            "C:/vault/composers/Wolfgang Amadeus Mozart.md",
            "",
        ),
        &["Mozart"],
    )];
    let items = corpus_note_items(&documents, root);
    // Sorted by name, so the alias comes first — and its detail is the file, not the folder, because the alias alone does not say what will open.
    assert_eq!(items[0].label, "Mozart");
    assert_eq!(items[0].detail, "Wolfgang Amadeus Mozart");
    assert_eq!(items[1].label, "Wolfgang Amadeus Mozart");
    assert_eq!(items[1].detail, "composers");
}

#[test]
fn find_note_matches_the_way_wiki_links_resolve() {
    let documents = vec![doc("My Note", "C:/vault/My Note.md", "hello")];
    assert!(find_note("my note", &documents).is_some());
    assert!(find_note("  MY NOTE ", &documents).is_some());
    assert!(find_note("other", &documents).is_none());
}

#[test]
fn a_note_is_found_by_an_alias_and_a_real_file_name_beats_one() {
    let documents = vec![
        aliased(
            doc(
                "Wolfgang Amadeus Mozart",
                "C:/vault/Wolfgang Amadeus Mozart.md",
                "",
            ),
            &["Mozart", "W. A. Mozart"],
        ),
        // Its own file is called Mozart, so it wins that name outright.
        doc("Mozart", "C:/vault/street/Mozart.md", ""),
    ];

    assert_eq!(
        find_note("mozart", &documents).map(|found| found.path.as_str()),
        Some("C:/vault/street/Mozart.md")
    );
    assert_eq!(
        find_note("  W. A. MOZART ", &documents).map(|found| found.path.as_str()),
        Some("C:/vault/Wolfgang Amadeus Mozart.md")
    );

    let names = known_note_names(&documents);
    assert!(names.contains("w. a. mozart"));
    assert!(names.contains("wolfgang amadeus mozart"));
}

#[test]
fn one_alias_claimed_twice_goes_to_the_same_note_every_time() {
    let documents = vec![
        aliased(doc("First", "C:/vault/First.md", ""), &["Shared"]),
        aliased(doc("Second", "C:/vault/Second.md", ""), &["Shared"]),
    ];
    for _ in 0..5 {
        assert_eq!(
            find_note("shared", &documents).map(|found| found.label.as_str()),
            Some("First")
        );
    }
}

#[test]
fn a_folder_answers_notes_names_and_reads_for_a_document_outside_every_vault() {
    let dir = intel_dir("folder");
    fs::write(dir.join("Sibling.md"), "# Sibling\n\nbody\n").expect("sibling written");
    fs::write(dir.join("notes.rtf"), "not a document").expect("non-document written");

    let items = folder_note_items(&dir);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].label, "Sibling");
    assert_eq!(items[0].detail, dir.file_name().unwrap().to_string_lossy());

    let names = folder_note_names(&dir);
    assert!(names.contains("sibling"));

    let found = read_folder_note("sibling", &dir).expect("note read");
    assert!(found.text.contains("body"));
    assert!(read_folder_note("ghost", &dir).is_none());

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_folder_answers_aliases_too_from_the_top_of_each_file() {
    let dir = intel_dir("folder-aliases");
    fs::write(
        dir.join("Wolfgang Amadeus Mozart.md"),
        "---\naliases: [Mozart]\n---\n\n# Mozart\n\nThe body.\n",
    )
    .expect("note written");
    fs::write(dir.join("plain.md"), "# Plain\n\nNo field block at all.\n").expect("written");
    // A field block with no closing fence inside the head is not a block, so the note has no aliases and nothing about it fails.
    let long: String = (0..600).map(|n| format!("filler-{n}: x\n")).collect();
    fs::write(
        dir.join("huge.md"),
        format!("---\naliases: [Nope]\n{long}---\n"),
    )
    .expect("written");

    let names = folder_note_names(&dir);
    assert!(names.contains("mozart"));
    assert!(names.contains("wolfgang amadeus mozart"));
    assert!(names.contains("plain"));
    assert!(
        !names.contains("nope"),
        "a block past the head read is not read"
    );

    // The popup offers the alias here as well, saying which file it opens.
    let items = folder_note_items(&dir);
    let alias_row = items
        .iter()
        .find(|item| item.label == "Mozart")
        .expect("the alias is offered");
    assert_eq!(alias_row.detail, "Wolfgang Amadeus Mozart");

    // Hover and the heading popup read the note the alias points at.
    let found = read_folder_note("mozart", &dir).expect("note found by its alias");
    assert_eq!(found.label, "Wolfgang Amadeus Mozart");
    assert!(found.text.contains("The body."));
    assert!(read_folder_note("ghost", &dir).is_none());

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_folder_stops_at_the_cap_and_survives_a_file_cut_mid_character() {
    let dir = intel_dir("folder-cap");
    // 600 files, of which the 500 the listing sorts first are opened. `zzz.md` sorts last, so its alias is past the cap.
    for index in 0..600 {
        fs::write(dir.join(format!("note-{index:03}.md")), "# Note\n").expect("written");
    }
    fs::write(dir.join("zzz.md"), "---\naliases: [Past]\n---\n").expect("written");

    // Sorted, so the 500 opened are note-000 through note-499 every time.
    let names = folder_note_names(&dir);
    assert!(names.contains("note-499"));
    assert!(!names.contains("note-500"));
    assert!(!names.contains("past"));

    fs::remove_dir_all(&dir).ok();

    // A wide file whose head read lands inside a character: the split bytes come off rather than decoding as something the file does not say.
    let dir = intel_dir("folder-wide");
    let text = format!("---\naliases: [Wide]\n---\n\n# {}\n", "😀".repeat(400));
    let wide = crate::encode_source(
        &text,
        crate::SourceSpelling {
            encoding: crate::SourceEncoding::Utf16Le,
            mark: true,
        },
    );
    fs::write(dir.join("wide.md"), wide).expect("written");
    assert!(folder_note_names(&dir).contains("wide"));

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

    let markers = lint_links(text, &source, &note_names(&[("Known", &[])]));

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
    // Emoji ahead of the link: 4 bytes, 2 UTF-16 units, 1 char. Monaco counts UTF-16 units, so the column must land after 2, not 4 or 1.
    let text = "😀 [gone](missing.md)\n";
    fs::write(&source, text).expect("source written");

    let markers = lint_links(text, &source, &NoteNames::default());
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].start_line, 1);
    assert_eq!(markers[0].start_col, 4); // 1 + emoji(2) + space(1)

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn the_alias_cap_notice_underlines_the_aliases_key() {
    let dir = intel_dir("alias-cap");
    let source = dir.join("doc.md");
    let claimed: String = (0..crate::store::MAX_ALIASES + 3)
        .map(|n| format!("  - Name{n}\n"))
        .collect();
    let text = format!("---\naliases:\n{claimed}---\n\n# Doc\n");
    fs::write(&source, &text).expect("source written");

    let markers = lint_links(&text, &source, &NoteNames::default());
    assert_eq!(markers.len(), 1, "markers: {markers:?}");
    // The key on line 2, not the whole line and not the list under it: the field's own key range is the only locator now.
    assert_eq!(markers[0].start_line, 2);
    assert_eq!(markers[0].start_col, 1);
    assert_eq!(markers[0].end_line, 2);
    assert_eq!(markers[0].end_col, 1 + "aliases".len() as u32);
    assert!(markers[0].message.contains("35 aliases"));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn known_note_names_use_the_graph_s_normalization() {
    let documents = vec![doc("My Note", "C:/vault/My Note.md", "")];
    let names = known_note_names(&documents);
    assert!(names.contains("my note"));
}

#[test]
fn lint_says_when_two_notes_answer_to_one_name() {
    let dir = intel_dir("lint-shared");
    let source = dir.join("asking.md");
    let text = "Go to [[Shared]], and to [[Only Mine]].\n";
    fs::write(&source, text).expect("source written");

    // "Shared" is one note's file name and another's alias, so a link to it opens the file and the other note is left out of a link its author expected.
    let names = note_names(&[
        ("Shared", &[]),
        ("First", &["Shared"]),
        ("Second", &["Only Mine"]),
    ]);
    let markers = lint_links(text, &source, &names);

    assert_eq!(markers.len(), 1, "markers: {markers:?}");
    assert_eq!(markers[0].start_col, 1 + "Go to ".len() as u32);
    assert!(
        markers[0].message.contains("This opens Shared") && markers[0].message.contains("First"),
        "message: {}",
        markers[0].message
    );

    // One claimant is the ordinary case and says nothing at all.
    let quiet = lint_links(
        text,
        &source,
        &note_names(&[("Shared", &[]), ("Second", &["Only Mine"])]),
    );
    assert!(quiet.is_empty(), "markers: {quiet:?}");

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn lint_marks_a_notes_own_aliases_field_when_it_claims_more_than_are_used() {
    let dir = intel_dir("lint-cap");
    let source = dir.join("Many.md");
    let claimed: String = (0..40).map(|n| format!("  - name-{n}\n")).collect();
    let text = format!("---\ntitle: Many\naliases:\n{claimed}---\n\n# Many\n");
    fs::write(&source, &text).expect("source written");

    let markers = lint_links(&text, &source, &NoteNames::default());
    assert_eq!(markers.len(), 1, "markers: {markers:?}");
    // On the `aliases:` line, which is line 3, and naming both numbers.
    assert_eq!(markers[0].start_line, 3);
    assert_eq!(markers[0].start_col, 1);
    assert!(
        markers[0].message.contains("40") && markers[0].message.contains("32"),
        "message: {}",
        markers[0].message
    );

    // At the cap, nothing is left out, so there is nothing to say.
    let kept: String = (0..32).map(|n| format!("  - name-{n}\n")).collect();
    let fine = format!("---\naliases:\n{kept}---\n");
    assert!(lint_links(&fine, &source, &NoteNames::default()).is_empty());
    // And a document with no field block at all is not asked about one.
    assert!(lint_links("# Plain\n", &source, &NoteNames::default()).is_empty());

    fs::remove_dir_all(&dir).ok();
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
