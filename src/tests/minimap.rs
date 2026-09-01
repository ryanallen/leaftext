//! The one question a document is asked before the rail is drawn beside it.

use super::*;

#[test]
fn markdown_with_words_has_content_and_an_empty_source_has_none() {
    assert!(markdown_has_visible_content("# Title\n\nA paragraph.\n"));
    // A file holding nothing but a newline still renders a line, so it still gets a rail — the same answer the line count gave.
    assert!(markdown_has_visible_content("\n"));
    assert!(!markdown_has_visible_content(""));
}

#[test]
fn a_rendered_tei_body_has_content_from_its_blocks() {
    // A TEI document renders straight to HTML, so the answer has to come off the rendered blocks; a no leaves the reader with no rail at all.
    let xml = "<TEI><teiHeader><fileDesc><titleStmt><title>A Sutra</title>\
            </titleStmt></fileDesc></teiHeader><text><body>\
            <p>A short opening line.</p>\
            <lg><l>Verse line one,</l><l>verse line two.</l></lg>\
            <p>A closing paragraph.</p>\
            </body></text></TEI>";

    let document = opened_document_from_xml(xml, Path::new("sutra.xml"));

    assert!(document.has_visible_content);
}

#[test]
fn a_body_whose_only_element_holds_nothing_visible_has_none() {
    // A document that is one picture has always got no rail: there is no run of words for a bar to stand for.
    assert!(!html_has_visible_content(r#"<img src="one.png" alt="">"#));
    assert!(!html_has_visible_content(""));
    assert!(!html_has_visible_content("<!-- a note nobody reads -->"));
}

#[test]
fn a_body_that_keeps_its_blocks_inside_a_wrapper_has_content() {
    // The walk this replaced descended into wrappers, and a body whose blocks sit a level or two down is the ordinary case, not the odd one.
    assert!(html_has_visible_content(
        r#"<section><div><p>Words.</p></div></section>"#
    ));
    assert!(html_has_visible_content(
        "<article><h2>A heading</h2></article>"
    ));
    // An unrecognized wrapper is descended into the same way.
    assert!(html_has_visible_content(
        "<table><tbody><tr><td>Cell</td></tr></tbody></table>"
    ));
}

#[test]
fn opened_document_hands_the_page_one_flag_and_no_model() {
    let path = scratch_dir("minimap-state").join("document.md");
    fs::write(&path, "# Map\n\nParagraph.\n\n```rs\nfn main() {}\n```")
        .expect("test markdown is written");

    let document = load_document(&path).expect("test markdown loads");
    let script = document_state_script(&document, &[]);

    fs::remove_file(&path).expect("test markdown is removed");

    assert!(document.has_visible_content);
    assert_contains(&script, r#""has_visible_content":true"#);
    // The page is told whether there is a document here and nothing else: it draws the rail from a scaled clone of the real rendering, so a line-by-line model of the source was a walk of the whole file to answer yes.
    for absent in [r#""minimap""#, r#""spans""#, r#""line_count""#] {
        assert!(
            !script.contains(absent),
            "the rail's handoff should not carry {absent}"
        );
    }
}

#[test]
fn a_source_file_has_content_from_its_own_title() {
    // The third of the three places a document is built, and the only one whose body the renderer writes rather than a parser: a source file always opens with its file name as a heading.
    let document = opened_document_from_source("let value = 1;", "main.rs");

    assert!(document.has_visible_content);
}
