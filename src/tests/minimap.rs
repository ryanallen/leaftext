//! The minimap model and the markup it renders to.

use super::*;

fn minimap_spans(markdown: &str) -> Vec<(usize, usize, MinimapLineCategory, MinimapLineStructure)> {
    build_minimap_model(markdown)
        .spans
        .into_iter()
        .map(|span| {
            (
                span.start_line,
                span.line_count,
                span.category,
                span.structure,
            )
        })
        .collect()
}

#[test]
fn minimap_model_compresses_headings_paragraphs_and_blank_lines() {
    let long_line = "A paragraph line that is deliberately long enough to cross the minimap long-line threshold for structure.";
    let markdown = format!("# Title\n\nShort paragraph.\n{long_line}\nSetext title\n---");

    let model = build_minimap_model(&markdown);

    assert_eq!(model.line_count, 6);
    assert_eq!(
        minimap_spans(&markdown),
        vec![
            (
                0,
                1,
                MinimapLineCategory::Heading,
                MinimapLineStructure::Short,
            ),
            (
                1,
                1,
                MinimapLineCategory::Blank,
                MinimapLineStructure::Short,
            ),
            (
                2,
                1,
                MinimapLineCategory::Paragraph,
                MinimapLineStructure::Short,
            ),
            (
                3,
                1,
                MinimapLineCategory::Paragraph,
                MinimapLineStructure::Long,
            ),
            (
                4,
                2,
                MinimapLineCategory::Heading,
                MinimapLineStructure::Short,
            ),
        ]
    );
}

#[test]
fn minimap_model_classifies_lists_and_blockquotes() {
    let markdown = "- first\n- second\n\n1. ordered\n> quote\n> - quoted list\nplain";

    assert_eq!(
        minimap_spans(markdown),
        vec![
            (0, 2, MinimapLineCategory::List, MinimapLineStructure::Short,),
            (
                2,
                1,
                MinimapLineCategory::Blank,
                MinimapLineStructure::Short,
            ),
            (3, 1, MinimapLineCategory::List, MinimapLineStructure::Short,),
            (
                4,
                2,
                MinimapLineCategory::Blockquote,
                MinimapLineStructure::Short,
            ),
            (
                6,
                1,
                MinimapLineCategory::Paragraph,
                MinimapLineStructure::Short,
            ),
        ]
    );
}

#[test]
fn minimap_model_keeps_fenced_code_lines_together() {
    let markdown =
        "```rs\n# not a heading\n- not a list\n```\n\n~~~\n> not a quote\n~~~\n# Heading";

    assert_eq!(
        minimap_spans(markdown),
        vec![
            (
                0,
                4,
                MinimapLineCategory::CodeFence,
                MinimapLineStructure::Short,
            ),
            (
                4,
                1,
                MinimapLineCategory::Blank,
                MinimapLineStructure::Short,
            ),
            (
                5,
                3,
                MinimapLineCategory::CodeFence,
                MinimapLineStructure::Short,
            ),
            (
                8,
                1,
                MinimapLineCategory::Heading,
                MinimapLineStructure::Short,
            ),
        ]
    );
}

#[test]
fn html_minimap_model_charts_tei_blocks() {
    // A TEI document renders straight to HTML; the model must come from the
    // rendered blocks, not stay empty (which left the rail blank).
    let xml = "<TEI><teiHeader><fileDesc><titleStmt><title>A Sutra</title>\
            </titleStmt></fileDesc></teiHeader><text><body>\
            <p>A short opening line.</p>\
            <lg><l>Verse line one,</l><l>verse line two.</l></lg>\
            <p>A closing paragraph.</p>\
            </body></text></TEI>";

    let model = opened_document_from_xml(xml, Path::new("sutra.xml")).minimap;

    assert!(model.line_count > 0, "TEI minimap must not be empty");
    assert!(
        !model.spans.is_empty(),
        "TEI minimap must chart the rendered blocks"
    );
    // The rendered title <h1> plus the body blocks all appear as spans.
    assert!(
        model
            .spans
            .iter()
            .any(|span| span.category == MinimapLineCategory::Heading),
        "the TEI title heading should chart as a heading span"
    );
    assert!(
        model
            .spans
            .iter()
            .any(|span| span.category == MinimapLineCategory::Paragraph),
        "body paragraphs should chart as paragraph spans"
    );
    // Spans stay ordered and never run past the reported line_count.
    let mut previous = 0;
    for span in &model.spans {
        assert!(
            span.start_line >= previous,
            "spans must be in document order"
        );
        assert!(span.start_line + span.line_count <= model.line_count);
        previous = span.start_line;
    }
}

#[test]
fn html_minimap_model_sizes_paragraphs_by_length() {
    let short = build_minimap_model_from_html("<p>Short.</p>");
    let long_text = "word ".repeat(60); // well past the long-line threshold
    let long = build_minimap_model_from_html(&format!("<p>{long_text}</p>"));

    assert_eq!(short.spans.len(), 1);
    assert_eq!(short.spans[0].line_count, 1);
    assert_eq!(short.spans[0].structure, MinimapLineStructure::Short);
    assert!(
        long.spans[0].line_count > 1,
        "a long paragraph should occupy more than one thumbnail row"
    );
    assert_eq!(long.spans[0].structure, MinimapLineStructure::Long);
}

#[test]
fn minimap_model_compresses_large_documents() {
    let markdown = (0..1_000)
        .map(|index| format!("Paragraph line {index}"))
        .collect::<Vec<_>>()
        .join("\n");

    let model = build_minimap_model(&markdown);

    assert_eq!(model.line_count, 1_000);
    assert_eq!(model.spans.len(), 1);
    assert_eq!(model.spans[0].category, MinimapLineCategory::Paragraph);
    assert_eq!(model.spans[0].line_count, 1_000);
}

#[test]
fn minimap_model_does_not_render_or_store_malicious_content() {
    let markdown = r#"# Safe

<script>alert("x")</script>
<img src=x onerror=alert(1)>

```html
<script>inside code</script>
```
"#;

    let model = build_minimap_model(markdown);
    let serialized =
        serde_json::to_string(&model).expect("minimap model serializes for UI handoff");

    assert_eq!(model.line_count, 8);
    assert_eq!(
        minimap_spans(markdown),
        vec![
            (
                0,
                1,
                MinimapLineCategory::Heading,
                MinimapLineStructure::Short,
            ),
            (
                1,
                1,
                MinimapLineCategory::Blank,
                MinimapLineStructure::Short,
            ),
            (
                2,
                2,
                MinimapLineCategory::Paragraph,
                MinimapLineStructure::Short,
            ),
            (
                4,
                1,
                MinimapLineCategory::Blank,
                MinimapLineStructure::Short,
            ),
            (
                5,
                3,
                MinimapLineCategory::CodeFence,
                MinimapLineStructure::Short,
            ),
        ]
    );
    assert!(!serialized.contains("<script"));
    assert!(!serialized.contains("onerror"));
    assert_eq!(
        markdown,
        r#"# Safe

<script>alert("x")</script>
<img src=x onerror=alert(1)>

```html
<script>inside code</script>
```
"#
    );
}

#[test]
fn minimap_model_covers_released_categories_without_source_payloads() {
    let markdown = "# Heading\n\nParagraph line that is deliberately long enough to become a long minimap structure entry.\n- list item\n> quote\n```rs\nfn main() {}\n```\n";

    let model = build_minimap_model(markdown);
    let serialized =
        serde_json::to_string(&model).expect("minimap model serializes for UI handoff");

    assert_eq!(model.line_count, 8);
    for expected in [
        r#""category":"heading""#,
        r#""category":"blank""#,
        r#""category":"paragraph""#,
        r#""category":"list""#,
        r#""category":"blockquote""#,
        r#""category":"code-fence""#,
        r#""structure":"long""#,
        r#""structure":"short""#,
        r#""start_line":"#,
        r#""line_count":"#,
    ] {
        assert_contains(&serialized, expected);
    }
    for forbidden in [
        "Heading",
        "Paragraph line",
        "list item",
        "> quote",
        "fn main",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "minimap handoff should not store source text: {forbidden}"
        );
    }
    assert_eq!(
            markdown,
            "# Heading\n\nParagraph line that is deliberately long enough to become a long minimap structure entry.\n- list item\n> quote\n```rs\nfn main() {}\n```\n"
        );
}

#[test]
fn minimap_model_keeps_large_documents_compressed_by_runs() {
    let markdown = (0..20_000)
        .map(|index| match index % 5 {
            0 => "# Section".to_string(),
            1 => String::new(),
            2 | 3 => "Paragraph line".to_string(),
            _ => "- list item".to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n");

    let model = build_minimap_model(&markdown);

    assert_eq!(model.line_count, 20_000);
    assert_eq!(model.spans.len(), 16_000);
    assert!(
        model.spans.len() < model.line_count,
        "large documents should render from compressed structural runs"
    );
    assert!(model
        .spans
        .iter()
        .any(|span| span.line_count > 1 && span.category == MinimapLineCategory::Paragraph));
}

#[test]
fn opened_document_carries_minimap_model_for_webview_state() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-minimap-state-{unique}.md"));
    fs::write(&path, "# Map\n\nParagraph.\n\n```rs\nfn main() {}\n```")
        .expect("test markdown is written");

    let document = load_document(&path).expect("test markdown loads");
    let script = document_state_script(&document, &[]);

    fs::remove_file(&path).expect("test markdown is removed");

    assert_eq!(document.minimap.line_count, 7);
    assert!(document
        .minimap
        .spans
        .iter()
        .any(|span| span.category == MinimapLineCategory::Heading));
    assert!(document
        .minimap
        .spans
        .iter()
        .any(|span| span.category == MinimapLineCategory::CodeFence));
    assert_contains(&script, r#""minimap":{"line_count":7,"spans":["#);
    assert_contains(&script, r#""category":"heading""#);
    assert_contains(&script, r#""category":"code-fence""#);
}

#[test]
fn settings_default_keeps_minimap_on() {
    let settings = Settings::default();
    assert!(settings.minimap_enabled);
    assert!(!settings.speed_reader_enabled);
    assert!(!settings.line_numbers_enabled);
    assert_eq!(settings.theme_family, "fern");
    assert_eq!(settings.theme_mode, "system");
    // The pane opens on the file list, at the library root — not on a force graph
    // of every indexed document.
    assert_eq!(settings.library_view, LibraryView::Project);
    assert!(settings.library_project_path.is_empty());
    // The pane is open by default, with the 240px fallback width.
    assert!(!settings.library_closed);
    assert_eq!(settings.library_width, 240);
}
