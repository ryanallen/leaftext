use super::*;

const COMPLETE_PAGE: &str = r#"<!doctype html>
<html><head><title>Ignored title</title><style>body { color: red }</style><script>alert(1)</script></head>
<body onload="alert(2)"><main><section><h2>Kept heading</h2><p onclick="alert(3)">Safe words <a href="javascript:alert(4)">bad link</a></p><form><button>Do nothing</button></form></section></main></body></html>"#;

#[test]
fn html_extensions_open_as_html() {
    for extension in ["html", "htm"] {
        let path = PathBuf::from(format!("saved-report.{extension}"));
        assert_eq!(DocumentFormat::for_path(&path), Some(DocumentFormat::Html));
        assert_eq!(DocumentFormat::from_path(&path), DocumentFormat::Html);
    }
    assert_eq!(DocumentFormat::Html.display_name(), "HTML");
    assert_eq!(DocumentFormat::Html.language_token(), "html");
}

#[test]
fn complete_html_page_is_sanitized_into_the_reading_view() {
    let document = opened_document_from_source(COMPLETE_PAGE, "saved-report.html");

    assert_eq!(document.title, "Saved report");
    assert_eq!(document.format, DocumentFormat::Html);
    assert_contains(
        &document.html,
        "<h1 id=\"saved-report\" data-borrowed-title>Saved report</h1>",
    );
    assert_contains(&document.html, "<main><section><h2>Kept heading</h2>");
    assert_contains(
        &document.html,
        "Safe words <a rel=\"noopener noreferrer\">bad link</a>",
    );
    for removed in [
        "Ignored title",
        "color: red",
        "alert(1)",
        "onload",
        "onclick",
        "javascript:",
        "<form",
        "<button",
    ] {
        assert!(
            !document.html.contains(removed),
            "HTML kept {removed}: {}",
            document.html
        );
    }
    assert!(document.blocks.is_empty());
    assert!(document.tasks.is_empty());
    assert!(EditableDocument::new(
        PathBuf::from("saved-report.html"),
        SourceText::utf8(COMPLETE_PAGE.to_string())
    )
    .block_source_map()
    .is_empty());
}

#[test]
fn unsaved_html_source_edits_are_rendered_from_the_live_buffer() {
    let source = "<main><p>Before</p></main>";
    let mut editable = EditableDocument::new(
        PathBuf::from("saved-report.html"),
        SourceText::utf8(source.to_string()),
    );
    let start = source.find("Before").expect("the original words");
    assert!(editable.replace_range(start, start + "Before".len(), "After<script>bad()</script>"));
    assert!(editable.is_dirty());

    let document = opened_document_from_source(editable.text(), &editable.path);
    assert_contains(&document.html, "<p>After</p>");
    assert!(!document.html.contains("bad()"));
    assert_eq!(editable.saved_text(), source);
}

#[test]
#[ignore = "release-build measurement"]
fn measure_one_megabyte_html_render() {
    let paragraph = "<section><p>A safe exported paragraph with <strong>weight</strong> and <a href=\"https://example.com\">a link</a>.</p></section>";
    let mut source = "<!doctype html><html><body><main>".to_string();
    while source.len() + paragraph.len() + "</main></body></html>".len() <= 1024 * 1024 {
        source.push_str(paragraph);
    }
    source.push_str("</main></body></html>");
    let started = std::time::Instant::now();
    let document = opened_document_from_source(&source, "one-megabyte.html");
    let elapsed = started.elapsed();
    assert_contains(&document.html, "A safe exported paragraph");
    eprintln!(
        "1 MB HTML render: {elapsed:?} ({} source bytes)",
        source.len()
    );
}
