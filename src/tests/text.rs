use super::*;

/// Everything a plain text file is drawn with that Markdown would have taken apart: a title over a rule of `=`, an indented list, a hand-drawn banner, a blank line, and a line carrying characters HTML reads as markup.
const PLAIN_FILE: &str = "Notes\n=====\n\n    indented list\n    another\n\n+---------+\n|  banner |\n+---------+\n\na < b & c > d\n";

#[test]
fn txt_opens_as_text() {
    let path = PathBuf::from("plain.txt");
    assert_eq!(DocumentFormat::for_path(&path), Some(DocumentFormat::Text));
    assert_eq!(DocumentFormat::from_path(&path), DocumentFormat::Text);
    assert_eq!(
        DocumentFormat::from_path(Path::new("PLAIN.TXT")),
        DocumentFormat::Text
    );
    assert_eq!(DocumentFormat::Text.display_name(), "Text");
    assert_eq!(DocumentFormat::Text.language_token(), "text");
}

#[test]
fn a_text_file_is_one_block_kept_exactly_as_typed() {
    let document = opened_document_from_source(PLAIN_FILE, "plain.txt");

    assert_eq!(document.title, "Plain");
    assert_eq!(document.format, DocumentFormat::Text);
    assert_contains(
        &document.html,
        "<h1 id=\"plain\" data-borrowed-title>Plain</h1>",
    );

    // Every space and every line break survives, so the banner is still a banner and the indented lines are still two lines.
    let block = document
        .html
        .split_once("<pre><code>")
        .expect("the file is drawn as one preformatted block")
        .1
        .split_once("</code></pre>")
        .expect("and that block closes")
        .0;
    assert_eq!(block, "Notes\n=====\n\n    indented list\n    another\n\n+---------+\n|  banner |\n+---------+\n\na &lt; b &amp; c &gt; d\n");
    assert_eq!(document.html.matches("<pre>").count(), 1);

    // None of what Markdown would have made of it.
    for taken_apart in ["<h1 id=\"notes\"", "<h2", "<ul", "<li", "<p>"] {
        assert!(
            !document.html.contains(taken_apart),
            "a text file was read as Markdown: {}",
            document.html
        );
    }

    // Nothing on the page claims a byte range, so the reader types into the source view rather than into a block covering the whole file.
    assert!(document.blocks.is_empty());
    assert!(document.tasks.is_empty());
    assert!(!document.html.contains("data-src-"));
    let editable = EditableDocument::new(
        PathBuf::from("plain.txt"),
        SourceText::utf8(PLAIN_FILE.to_string()),
    );
    assert!(editable.block_source_map().is_empty());
    assert!(editable.table_source_map().is_empty());
    assert!(editable.task_offsets().is_empty());
}

#[test]
fn an_empty_text_file_still_opens() {
    let document = opened_document_from_source("", "empty.txt");
    assert_eq!(document.title, "Empty");
    assert_contains(&document.html, "<pre><code></code></pre>");
}

#[test]
fn a_text_file_contributes_no_links_to_the_map() {
    // A bare address in a text file is the words somebody typed, not a link they wrote — the same answer the data formats already give.
    let document = "See https://example.com and ./notes.md\n";
    assert!(crate::store::document_links(document, Path::new("plain.txt")).is_empty());
}

#[test]
#[ignore = "release-build measurement"]
fn measure_one_megabyte_text_render() {
    let line = "A plain line of notes, wrapped by hand at about this width.\n";
    let mut source = String::new();
    while source.len() + line.len() <= 1024 * 1024 {
        source.push_str(line);
    }
    let started = std::time::Instant::now();
    let document = opened_document_from_source(&source, "one-megabyte.txt");
    let elapsed = started.elapsed();
    assert_contains(&document.html, "A plain line of notes");
    eprintln!(
        "1 MB text render: {elapsed:?} ({} source bytes)",
        source.len()
    );
}
