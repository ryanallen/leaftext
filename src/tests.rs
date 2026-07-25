use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy)]
struct Rgb {
    red: f64,
    green: f64,
    blue: f64,
}

fn assert_contains(haystack: &str, needle: &str) {
    assert!(
        haystack.contains(needle),
        "expected rendered HTML to contain:\n{needle}\n\nrendered HTML:\n{haystack}"
    );
}

fn local_img(path: &str) -> String {
    local_image_webview_url(path)
}

fn expected_img(src: &str, attributes: &str) -> String {
    format!(r#"<img src="{}" {}>"#, local_img(src), attributes)
}

fn fixture_source_path(relative_path: &str) -> PathBuf {
    std::env::temp_dir()
        .join("leaf-render-fixtures")
        .join(relative_path)
}

fn expected_base_href(source_path: &Path) -> String {
    source_path
        .parent()
        .and_then(|parent| Url::from_directory_path(parent).ok())
        .map(|url| format!(r#"<base href="{}">"#, encode_text(url.as_str())))
        .expect("fixture source path has a file URL")
}

fn file_url_for_fixture(relative_path: &str) -> String {
    Url::from_file_path(fixture_source_path(relative_path))
        .expect("fixture path has a file URL")
        .to_string()
}

fn absolute_path_destination_for_fixture(relative_path: &str) -> String {
    fixture_source_path(relative_path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn tiny_png_bytes() -> &'static [u8] {
    &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]
}

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
fn markdown_parser_config_enables_expected_github_flavored_extensions() {
    let config = MarkdownParserConfig::github_flavored();

    for option in [
        Options::ENABLE_TABLES,
        Options::ENABLE_STRIKETHROUGH,
        Options::ENABLE_TASKLISTS,
        Options::ENABLE_GFM,
        Options::ENABLE_FOOTNOTES,
        Options::ENABLE_MATH,
    ] {
        assert!(
            config.options.contains(option),
            "expected parser config to include {option:?}"
        );
    }
}

#[test]
fn markdown_pipeline_stages_keep_raw_rendering_before_sanitization() {
    let source_path = Path::new("README.md");
    let events = parse_markdown_source(
        "<script>alert(1)</script>\n\nVisit www.example.com.",
        MarkdownParserConfig::github_flavored(),
    );
    let events = register_markdown_extensions(events, source_path);
    let raw_html = render_markdown_events_to_html(events);

    assert_contains(&raw_html, "<script>alert(1)</script>");
    assert_contains(
        &raw_html,
        r#"<a href="http://www.example.com">www.example.com</a>"#,
    );

    let sanitized = sanitize_rendered_html(&raw_html);

    assert!(!sanitized.contains("<script"));
    assert_contains(
        &sanitized,
        r#"<a href="http://www.example.com" rel="noopener noreferrer">www.example.com</a>"#,
    );
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
fn navigation_state_script_updates_webview_navigation_controls() {
    assert_eq!(
        navigation_state_script(true, false),
        r#"window.leafSetNavigation({"canGoBack":true,"canGoForward":false});"#
    );
}

#[test]
fn initial_state_script_returns_reader_to_no_file_state_with_recent_files() {
    let script = initial_state_script(&[PathBuf::from("README.md")]);

    assert_eq!(
        script,
        r#"window.__leafInitialState = {"document":null,"recent":["README.md"]};"#
    );
}

#[test]
fn scroll_anchor_script_restores_webview_reader_anchor() {
    assert_eq!(
        scroll_anchor_script(&ScrollAnchor {
            section: Some("the-asuras".to_string()),
            block: 3,
            offset_y: -88.0,
        }),
        r#"window.leafRestoreScrollAnchor({"section":"the-asuras","block":3,"offsetY":-88.0});"#
    );
    // A position above the first heading carries a null section.
    assert_eq!(
        scroll_anchor_script(&ScrollAnchor::default()),
        r#"window.leafRestoreScrollAnchor({"section":null,"block":0,"offsetY":0.0});"#
    );
}

#[test]
fn workspace_reload_script_preserves_scroll_via_reload_entry_point() {
    let tabs = [("Guide".to_string(), "guide.md".to_string())];
    let script = workspace_reload_script(&[PathBuf::from("guide.md")], &tabs, Some(0), None);

    // The reload path must call leafReloadDocument (which keeps the reader's
    // scroll position), never leafSetState (which jumps back to the top).
    assert!(script.starts_with("window.leafReloadDocument({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert_contains(&script, r#""title":"Guide""#);
}

#[test]
fn workspace_switch_script_restores_target_tab_anchor_without_reset() {
    let tabs = [("Guide".to_string(), "guide.md".to_string())];
    let anchor = ScrollAnchor {
        section: Some("intro".to_string()),
        block: 2,
        offset_y: 12.5,
    };
    let script = workspace_switch_script(
        &[PathBuf::from("guide.md")],
        &tabs,
        Some(0),
        None,
        Some(&anchor),
    );

    // Switching must render through leafSwitchTab (renders, then restores the
    // saved anchor) rather than leafSetState (which snaps back to the top).
    assert!(script.starts_with("window.leafSwitchTab({"));
    assert!(!script.contains("leafSetState"));
    assert_contains(&script, r#""active":0"#);
    assert!(script.ends_with(r#", {"section":"intro","block":2,"offsetY":12.5});"#));

    // No saved anchor (first visit to a tab) passes null, which starts the
    // reader at the top of the content.
    assert!(workspace_switch_script(&[], &[], None, None, None).ends_with(", null);"));
}

#[test]
fn opened_document_from_markdown_matches_loading_from_disk() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    // Use a dedicated subdirectory so the on-disk load and already-read
    // render both see the same source path.
    let dir = std::env::temp_dir().join(format!("leaf-reload-parity-{unique}"));
    fs::create_dir_all(&dir).expect("test directory is created");
    let path = dir.join("doc.md");
    let markdown = "# Reloaded\n\nBody text.\n";
    fs::write(&path, markdown).expect("test markdown is written");

    let from_disk = load_document(&path).expect("test markdown loads");
    let from_memory = opened_document_from_markdown(markdown, &path);

    fs::remove_dir_all(&dir).expect("test directory is removed");

    // Rendering the already-read string must produce the same document the
    // on-disk loader would, so the live-reload path can read the file once.
    assert_eq!(from_memory.title, from_disk.title);
    assert_eq!(from_memory.html, from_disk.html);
    assert_eq!(from_memory.path, from_disk.path);
    assert_eq!(from_memory.minimap, from_disk.minimap);
}

#[test]
fn links_terms_with_diacritics_without_panicking() {
    // Regression: slicing the original with lowercased-copy offsets panicked on
    // the diacritics these documents are full of. Terms are (term, slug),
    // longest-first.
    let terms = vec![
        ("King of Aṅga".to_string(), "king-of-aṅga".to_string()),
        ("Mahāpadma".to_string(), "mahāpadma".to_string()),
        ("Aṅga".to_string(), "aṅga".to_string()),
        ("Tuṣita".to_string(), "tuṣita".to_string()),
    ];
    let html = "<p>The King of Aṅga fought Mahāpadma near Aṅga, \
            while dwelling in Tuṣita. king of aṅga again.</p>";
    let linked = link_terms_in_html(html, &terms);

    // Longest-first: "King of Aṅga" wins over the bare "Aṅga" inside it.
    assert_contains(
        &linked,
        r#"<a href="glossary:king-of-aṅga">King of Aṅga</a>"#,
    );
    assert_contains(&linked, r#"<a href="glossary:mahāpadma">Mahāpadma</a>"#);
    assert_contains(&linked, r#"<a href="glossary:tuṣita">Tuṣita</a>"#);
    // The standalone "Aṅga" (comma after) still links via the short term.
    assert_contains(&linked, r#"<a href="glossary:aṅga">Aṅga</a>"#);
    // Case-insensitive match keeps the original casing in the link text.
    assert_contains(
        &linked,
        r#"<a href="glossary:king-of-aṅga">king of aṅga</a>"#,
    );
}

#[test]
fn does_not_link_substrings_inside_larger_words() {
    let terms = vec![("go".to_string(), "go".to_string())];
    // "go" must not match inside "going" or "ago".
    let linked = link_terms_in_html("<p>going ago; go now</p>", &terms);
    // "going" and "ago" are left untouched; only the standalone word links.
    assert_contains(&linked, "<p>going ago; ");
    assert_contains(&linked, r#"<a href="glossary:go">go</a> now</p>"#);
    assert!(
        !linked.contains(r#"<a href="glossary:go">go</a>ing"#),
        "should not have linked the 'go' inside 'going'"
    );
}

#[test]
fn auto_links_glossary_terms_from_an_ancestor_folder() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-glossary-walkup-{unique}"));
    // Glossary lives at the project root; the document sits several folders down.
    let deep = root.join("collection").join("volume").join("book");
    fs::create_dir_all(&deep).expect("tree is created");
    fs::write(
        root.join("GLOSSARY.md"),
        "# Glossary\n\n## Bodhisattva\n*byang chub sems dpa'*, a being bound for awakening.\n",
    )
    .expect("glossary written");

    let md = deep.join("chapter.md");
    fs::write(&md, "# Chapter\n\nThe Bodhisattva was dwelling there.\n").expect("markdown written");
    let from_md =
        opened_document_from_markdown("# Chapter\n\nThe Bodhisattva was dwelling there.\n", &md);

    let xml = deep.join("chapter.xml");
    let tei = "<TEI xmlns=\"http://www.tei-c.org/ns/1.0\"><text><body>\
            <div type=\"translation\"><p>The Bodhisattva was dwelling there.</p></div>\
            </body></text></TEI>";
    fs::write(&xml, tei).expect("xml written");
    let from_xml = opened_document_from_xml(tei, &xml);

    fs::remove_dir_all(&root).expect("tree removed");

    assert_contains(
        &from_md.html,
        r#"<a href="glossary:bodhisattva">Bodhisattva</a>"#,
    );
    assert_contains(
        &from_xml.html,
        r#"<a href="glossary:bodhisattva">Bodhisattva</a>"#,
    );
}

#[test]
fn does_not_auto_link_terms_inside_the_glossary_file_itself() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-glossary-self-{unique}"));
    fs::create_dir_all(&root).expect("tree is created");
    let glossary = root.join("GLOSSARY.md");
    let text = "# Glossary\n\n## Buddha\nan awakened one.\n\n## Dharma\nthe Buddha's teaching.\n";
    fs::write(&glossary, text).expect("glossary written");

    let rendered = opened_document_from_markdown(text, &glossary);
    fs::remove_dir_all(&root).expect("tree removed");

    // "Buddha" appears in the Dharma definition but must not be self-linked.
    assert!(
        !rendered.html.contains("glossary:buddha"),
        "the glossary file should not auto-link its own terms"
    );
}

#[test]
fn opened_document_starts_with_async_pager_placeholder() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-async-pager-{unique}"));
    fs::create_dir_all(&root).expect("tree is created");
    fs::write(root.join("README.md"), "# Root\n").expect("README written");
    let current = root.join("current.md");
    let next = root.join("next-page.md");
    fs::write(&current, "# Current\n").expect("current document written");
    fs::write(&next, "# Next\n").expect("next document written");

    let document = opened_document_from_markdown("# Current\n", &current);
    let pager = document_pager_html(&current);
    fs::remove_dir_all(&root).expect("tree removed");

    assert_contains(&document.html, "docs-pager-loading");
    assert_contains(&document.html, "docs-pager-skeleton");
    assert!(
        !document.html.contains("Next Page"),
        "document render should not synchronously scan pager neighbours"
    );
    assert_contains(&pager, "Next Page");
}

#[test]
fn pager_loaded_script_routes_through_webview_hook() {
    let path = PathBuf::from("docs").join("guide.md");
    let script = pager_loaded_script(&path, r#"<nav class="docs-pager"></nav>"#);

    assert!(script.starts_with("window.leafSetPager({"));
    assert_contains(&script, "guide.md");
    assert_contains(&script, r#""html":"<nav class=\"docs-pager\"></nav>""#);
}

#[test]
fn pager_label_matches_web_label_rule() {
    assert_eq!(
        pager_label("book-1-words-of-the-buddha--kangyur"),
        "Book 1 Words Of The Buddha Kangyur"
    );
    assert_eq!(pager_label("going-forth.md"), "Going Forth");
    assert_eq!(pager_label("get_started"), "Get Started");
    // TEI XML chapters are pager pages too; their extension is stripped.
    assert_eq!(
        pager_label("001-001_toh1-1_chapter_on_going_forth.xml"),
        "001 001 Toh1 1 Chapter On Going Forth"
    );
}

#[test]
fn pager_includes_tei_xml_documents() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-xml-{unique}"));
    let book = root.join("book-1-going-forth--pravrajyavastu");
    fs::create_dir_all(&book).expect("tree is created");
    fs::write(root.join("README.md"), "# Root\n").expect("root README written");
    fs::write(book.join("README.md"), "# Book\n").expect("book README written");
    // Two XML chapters plus a Markdown one, to prove XML both appears in the
    // order and pages to its neighbours.
    let ch1 = book.join("001-going-forth.xml");
    let ch2 = book.join("002-ordination.xml");
    let notes = book.join("003-notes.md");
    for (p, body) in [(&ch1, "<TEI/>"), (&ch2, "<TEI/>")] {
        fs::write(p, body).expect("xml chapter written");
    }
    fs::write(&notes, "# Notes\n").expect("md chapter written");

    // Standing on the first XML chapter: next is the second XML chapter.
    let html = pager_html(&ch1);
    // Standing on the second XML chapter: prev is the first, next is the md.
    let html_mid = pager_html(&ch2);
    fs::remove_dir_all(&root).expect("tree removed");

    assert!(
        html.contains(r#"class="docs-pager-next""#) && html.contains("002 Ordination"),
        "an XML chapter should page to the next document: {html}"
    );
    assert!(
        html_mid.contains("001 Going Forth") && html_mid.contains("003 Notes"),
        "the XML chapter should sit between its neighbours: {html_mid}"
    );
}

#[test]
fn pager_orders_by_folder_tree_like_the_web_viewer() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-pager-{unique}"));
    let book = root.join("book-1-words-of-the-buddha--kangyur");
    let section = book.join("discipline--vinayavastu");
    let chapter = section.join("chapter-1-going-forth--pravrajyavastu");
    fs::create_dir_all(&chapter).expect("tree is created");
    for dir in [&root, &book, &section, &chapter] {
        fs::write(dir.join("README.md"), "# x\n").expect("README written");
    }
    fs::write(root.join("GLOSSARY.md"), "# Glossary\n").expect("glossary written");

    // Standing on the section README, prev is its parent book and next is its
    // child chapter — the same neighbours the web pager shows.
    let html = pager_html(&section.join("README.md"));
    fs::remove_dir_all(&root).expect("tree removed");

    assert!(
        html.contains(r#"class="docs-pager-prev""#)
            && html.contains("Book 1 Words Of The Buddha Kangyur"),
        "prev should link the parent book: {html}"
    );
    assert!(
        html.contains(r#"class="docs-pager-next""#)
            && html.contains("Chapter 1 Going Forth Pravrajyavastu"),
        "next should link the child chapter: {html}"
    );
    // GLOSSARY.md is opened in the sheet, never a sequential page.
    assert!(
        !html.contains("Glossary"),
        "glossary must not be a pager page: {html}"
    );
}

#[test]
fn document_title_strips_raw_html_from_markdown_heading() {
    let rendered = render_markdown_document(
        r#"# <div align="center">Words of My Perfect Teacher</div>

Body stays readable.
"#,
        "README.md",
    );

    assert_eq!(rendered.title, "Words of My Perfect Teacher");
    assert!(!rendered.title.contains("<div"));
    assert!(!rendered.title.contains("</div>"));
    assert_contains(&rendered.html, "Words of My Perfect Teacher");
}

#[test]
fn document_title_uses_plain_text_for_heading_inline_markup() {
    let rendered = render_markdown_document(
        r#"# *Perfect* [Teacher &amp; Guide](guide.md) ![Alt &amp; Image](cover.png) `code` <span>plain&nbsp;text</span>"#,
        "README.md",
    );

    assert_eq!(
        rendered.title,
        "Perfect Teacher & Guide Alt & Image code plain text"
    );
    for raw_markup in ["*", "[", "](", "![", "`", "<span", "&amp;", "&nbsp;"] {
        assert!(
            !rendered.title.contains(raw_markup),
            "title should not contain raw markup {raw_markup:?}: {}",
            rendered.title
        );
    }
}

#[test]
fn document_title_preserves_literal_comparison_text() {
    let rendered = render_markdown_document("# 1 < 2 &amp; 3 > 2", "README.md");

    assert_eq!(rendered.title, "1 < 2 & 3 > 2");
}

#[test]
fn document_title_can_come_from_raw_html_heading_or_block() {
    let raw_heading = render_markdown_document(
        r#"<h1><em>Raw</em> HTML &amp; Heading</h1>

Body.
"#,
        "README.md",
    );
    let raw_block = render_markdown_document(
        r#"<div align="center">Words of My Perfect Teacher</div>

Body.
"#,
        "README.md",
    );

    assert_eq!(raw_heading.title, "Raw HTML & Heading");
    assert_eq!(raw_block.title, "Words of My Perfect Teacher");
    assert!(!raw_heading.title.contains("<em>"));
    assert!(!raw_block.title.contains("align="));
}

#[test]
fn raw_html_anchor_ids_survive_so_in_page_links_resolve() {
    // Raw-HTML anchor targets carry an explicit `id=`; the sanitizers must keep
    // it so `[..](#id)` links still scroll.
    let rendered = render_markdown_document(
        r#"[Foreword](#forewordhhdl) [Plate](#guru-rinpoche-il) [Notice](#copyright) [Spearman](#black-spearman)

<h1 id="forewordhhdl" align="center" onclick="bad()">Foreword</h1>
<p id="guru-rinpoche-il">Plate caption.</p>
<div id="copyright">Notice.</div>
<a id="black-spearman">Spearman.</a>
"#,
        "README.md",
    );

    assert_contains(&rendered.html, r#"id="forewordhhdl""#);
    assert_contains(&rendered.html, r#"id="guru-rinpoche-il""#);
    assert_contains(&rendered.html, r#"id="copyright""#);
    assert_contains(&rendered.html, r#"id="black-spearman""#);
    // The id rides through, but unsafe attributes on the same tag still go.
    assert!(!rendered.html.contains("onclick"));
}

#[test]
fn document_state_script_never_serializes_raw_title_markup() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-title-state-{unique}.md"));
    fs::write(
        &path,
        r#"# <div align="center">Words &amp; My Perfect Teacher</div>

![Image alt](cover.png)
"#,
    )
    .expect("test markdown is written");

    let document = load_document(&path).expect("test markdown loads");
    let script = document_state_script(&document, &[]);

    fs::remove_file(&path).expect("test markdown is removed");

    assert_eq!(document.title, "Words & My Perfect Teacher");
    assert_contains(&script, r#""title":"Words & My Perfect Teacher""#);
    assert!(!script.contains(r#""title":"<div"#));
    assert!(!script.contains(r#""title":"Words &amp;"#));
}

#[test]
fn fragment_scroll_script_escapes_fragment_for_webview_handoff() {
    assert_eq!(
        fragment_scroll_script(r#"Section "One""#),
        r#"window.leafScrollToFragment("Section \"One\"");"#
    );
}

#[test]
fn sanitizer_boundary_allows_preview_markup_and_removes_unsafe_markup() {
    let html = r##"<pre class="highlight" data-language="Rust" onclick="bad()"><code class="language-rust"><span class="syn-keyword" title="kw" aria-label="keyword">fn</span></code></pre>
<table><tr><td style="text-align:center;color:red">cell</td></tr></table>
<div align="center" onclick="bad()">centered</div>
<a href="javascript:alert(1)" class="issue-link" aria-label="issue">bad</a>
<a class="footnote-backref" href="#fnref-one" aria-label="Back to content"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" onclick="bad()"/></svg></a>
<script>alert(1)</script>"##;

    let sanitized = sanitize_rendered_html(html);

    assert_contains(
        &sanitized,
        r#"<pre class="highlight" data-language="Rust"><code class="language-rust"><span class="syn-keyword" title="kw" aria-label="keyword">fn</span></code></pre>"#,
    );
    assert_contains(&sanitized, r#"<td>cell</td>"#);
    assert_contains(&sanitized, r#"<div align="center">centered</div>"#);
    assert_contains(
        &sanitized,
        r#"<a class="issue-link" aria-label="issue" rel="noopener noreferrer">bad</a>"#,
    );
    assert_contains(
        &sanitized,
        r##"<a class="footnote-backref" href="#fnref-one" aria-label="Back to content" rel="noopener noreferrer"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"##,
    );
    assert_contains(
        &sanitized,
        r#"<path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>"#,
    );
    assert!(!sanitized.contains("onclick"));
    assert!(!sanitized.contains("style="));
    assert!(!sanitized.contains("color:red"));
    assert!(!sanitized.contains("<script"));
    assert!(!sanitized.contains("javascript:"));
}

#[test]
fn sanitizer_allows_local_image_protocol_urls() {
    let sanitized = sanitize_rendered_html(
        r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
    );

    assert_contains(
        &sanitized,
        r#"<img src="leaf-image://local/nested/space%20image.png" alt="x">"#,
    );
}

#[test]
fn sanitizer_allows_webview_local_image_workaround_urls() {
    let sanitized = sanitize_rendered_html(&format!(
        r#"<img src="{}" alt="x" onerror="alert(1)">"#,
        local_img("nested/space%20image.png")
    ));

    assert_contains(
        &sanitized,
        &expected_img("nested/space%20image.png", r#"alt="x""#),
    );
    assert!(!sanitized.contains("onerror"));
}

#[test]
fn highlighter_boundary_escapes_when_requested_language_has_no_syntax() {
    let language = LanguageDefinition {
        display_name: "Imaginary",
        syntax_names: &["Imaginary Leaf Syntax"],
        syntax_tokens: &["imaginary-leaf-syntax"],
    };

    assert_eq!(
        highlight_code("<b>raw</b>", &language),
        None,
        "missing syntaxes should not produce highlighter HTML"
    );

    let rendered = render_code_block(&CodeBlockCapture {
        language: Some("imaginary-leaf-syntax".to_string()),
        code: "<b>raw</b>".to_string(),
    });

    assert_contains(&rendered, r#"data-language="imaginary-leaf-syntax""#);
    assert_contains(&rendered, "&lt;b&gt;raw&lt;/b&gt;");
    assert!(!rendered.contains("<b>raw</b>"));
}

fn css_token(css: &str, theme: ResolvedTheme, name: &str) -> Rgb {
    let leaf_alias_block = css_block(css, ":root {");
    let mut blocks = vec![leaf_alias_block];
    // The `:root` aliases point at `--leaf-*` tokens defined in the github family
    // block, which hold concrete hex now (no Primer indirection). Load it so the
    // var() chain resolves for the default theme.
    let family_block = match theme {
        ResolvedTheme::Light => {
            r#":root[data-leaf-theme="github"][data-leaf-appearance="light"] {"#
        }
        ResolvedTheme::Dark => r#":root[data-leaf-theme="github"][data-leaf-appearance="dark"] {"#,
    };
    blocks.extend(css_blocks(css, family_block));
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--leaf-background");
            parse_hex_color(&background)
                .and_then(|background| parse_hex_color_with_alpha(&value, background))
        })
        .unwrap_or_else(|| panic!("expected {name} to resolve to a hex color"))
}

fn css_token_for_source(css: &str, source: &ThemeSource, name: &str) -> Rgb {
    let blocks = css_blocks(css, &format!("{} {{", source.selector));
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--leaf-background");
            parse_hex_color(&background)
                .and_then(|background| parse_hex_color_with_alpha(&value, background))
        })
        .unwrap_or_else(|| panic!("expected {} {name} to resolve to a hex color", source.id))
}

fn css_block<'a>(css: &'a str, selector: &str) -> &'a str {
    css_blocks(css, selector)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("expected CSS block {selector}"))
}

fn css_blocks<'a>(css: &'a str, selector: &str) -> Vec<&'a str> {
    css.split(selector)
        .skip(1)
        .filter_map(|rest| rest.split_once("\n}").map(|(block, _)| block))
        .collect()
}

fn css_token_value(blocks: &[&str], name: &str) -> String {
    let declaration = blocks
        .iter()
        .flat_map(|block| block.lines())
        .map(str::trim)
        .find(|line| line.starts_with(name))
        .unwrap_or_else(|| panic!("expected CSS token {name} in theme block"));
    let value = declaration
        .split_once(':')
        .and_then(|(_, value)| value.trim().split_once(';').map(|(value, _)| value.trim()))
        .unwrap_or_else(|| panic!("expected CSS declaration value for {name}"));

    if let Some(alias) = value
        .strip_prefix("var(")
        .and_then(|value| value.strip_suffix(')'))
    {
        return css_token_value(blocks, alias).to_string();
    }

    value.to_string()
}

fn parse_hex_color(value: &str) -> Option<Rgb> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    Some(Rgb {
        red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
        green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
        blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
    })
}

fn parse_hex_color_with_alpha(value: &str, background: Rgb) -> Option<Rgb> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 8 {
        return None;
    }
    let foreground = Rgb {
        red: u8::from_str_radix(&hex[0..2], 16).ok()? as f64 / 255.0,
        green: u8::from_str_radix(&hex[2..4], 16).ok()? as f64 / 255.0,
        blue: u8::from_str_radix(&hex[4..6], 16).ok()? as f64 / 255.0,
    };
    let alpha = u8::from_str_radix(&hex[6..8], 16).ok()? as f64 / 255.0;

    Some(Rgb {
        red: foreground.red * alpha + background.red * (1.0 - alpha),
        green: foreground.green * alpha + background.green * (1.0 - alpha),
        blue: foreground.blue * alpha + background.blue * (1.0 - alpha),
    })
}

fn contrast_ratio(foreground: Rgb, background: Rgb) -> f64 {
    let foreground = relative_luminance(foreground);
    let background = relative_luminance(background);
    let (lighter, darker) = if foreground >= background {
        (foreground, background)
    } else {
        (background, foreground)
    };

    (lighter + 0.05) / (darker + 0.05)
}

fn relative_luminance(color: Rgb) -> f64 {
    fn linearize(channel: f64) -> f64 {
        if channel <= 0.03928 {
            channel / 12.92
        } else {
            ((channel + 0.055) / 1.055).powf(2.4)
        }
    }

    0.2126 * linearize(color.red) + 0.7152 * linearize(color.green) + 0.0722 * linearize(color.blue)
}

fn assert_contrast_at_least(
    css: &str,
    theme: ResolvedTheme,
    foreground: &str,
    background: &str,
    minimum: f64,
) {
    let ratio = contrast_ratio(
        css_token(css, theme, foreground),
        css_token(css, theme, background),
    );
    assert!(
            ratio >= minimum,
            "expected {theme:?} {foreground} on {background} contrast {ratio:.2} to be at least {minimum:.1}"
        );
}

#[test]
fn renders_commonmark_headings_and_paragraphs() {
    let markdown = r#"# H1

Paragraph after H1.

## H2

Paragraph after H2.

### H3

Paragraph after H3.

#### H4

Paragraph after H4.

##### H5

Paragraph after H5.

###### H6

Paragraph after H6.
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_eq!(rendered.title, "H1");
    for level in 1..=6 {
        assert_contains(
            &rendered.html,
            &format!(r#"<h{level} id="h{level}">H{level}</h{level}>"#),
        );
        assert_contains(&rendered.html, &format!("<p>Paragraph after H{level}.</p>"));
    }
}

#[test]
fn renders_commonmark_emphasis_variants_and_escapes() {
    let markdown = r#"**asterisk bold** and __underscore bold__.

*asterisk italic* and _underscore italic_.

***asterisk bold italic*** and ___underscore bold italic___.

\*escaped asterisk\* and \[escaped bracket\].
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "<strong>asterisk bold</strong>");
    assert_contains(&rendered.html, "<strong>underscore bold</strong>");
    assert_contains(&rendered.html, "<em>asterisk italic</em>");
    assert_contains(&rendered.html, "<em>underscore italic</em>");
    assert_contains(
        &rendered.html,
        "<em><strong>asterisk bold italic</strong></em>",
    );
    assert_contains(
        &rendered.html,
        "<em><strong>underscore bold italic</strong></em>",
    );
    assert_contains(
        &rendered.html,
        "<p>*escaped asterisk* and [escaped bracket].</p>",
    );
}

#[test]
fn renders_commonmark_blockquotes_and_nested_lists() {
    let markdown = r#"> outer
> > nested

1. first
   1. nested first
   2. nested second
2. second

- dash
  * star
    + plus
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "<blockquote>");
    assert_contains(&rendered.html, "<p>outer</p>");
    assert_contains(&rendered.html, "<p>nested</p>");
    assert_contains(&rendered.html, "<ol>");
    assert_contains(&rendered.html, "<li>nested first</li>");
    assert_contains(&rendered.html, "<ul>");
    assert_contains(&rendered.html, "<li>plus</li>");
}

#[test]
fn tei_lg_and_bare_l_render_as_verse_blockquotes() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><body>
    <div type="translation">
      <lg>
        <l>When a tree rots,</l>
        <l>What use has it for blossoms and boughs?</l>
      </lg>
      <l>Bare line one,</l>
      <l>Bare line two.</l>
      <p>A prose paragraph.</p>
    </div>
  </body></text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // The <lg> group becomes a blockquote with its lines joined by <br>.
    assert_contains(
            &html,
            "<blockquote class=\"tei-verse\">\n<p>When a tree rots,<br>\nWhat use has it for blossoms and boughs?</p>\n</blockquote>",
        );
    // Consecutive bare <l> lines (no <lg>) coalesce into one blockquote too.
    assert_contains(
            &html,
            "<blockquote class=\"tei-verse\">\n<p>Bare line one,<br>\nBare line two.</p>\n</blockquote>",
        );
    // A following non-<l> block ends the verse run and renders normally. (Match
    // the closing text, since paragraphs carry inline source-range attributes.)
    assert_contains(&html, ">A prose paragraph.</p>");
    // No leftover plain verse paragraph markup.
    assert!(!html.contains("<p class=\"tei-verse\">"));
}

#[test]
fn tei_title_prefers_english_and_stacks_sanskrit_and_long_titles() {
    // A title matrix listing Tibetan first, to prove selection is by type +
    // xml:lang, not document order. Uses the odd lang casing seen in the wild.
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt>
    <title type="mainTitle" xml:lang="Bo-Ltn">rab tu 'byung ba'i gzhi</title>
    <title type="mainTitle" xml:lang="bo">bo-script-title</title>
    <title type="mainTitle" xml:lang="en">The Chapter on Going Forth</title>
    <title type="mainTitle" xml:lang="Sa-Ltn">Pravrajyāvastu</title>
    <title type="longTitle" xml:lang="en">"Going Forth" from The Chapters on Monastic Discipline</title>
    <title type="longTitle" xml:lang="Sa-Ltn">Vinayavastu Pravrajyāvastu</title>
    <title type="longTitle" xml:lang="Bo-Ltn">'dul ba gzhi las</title>
  </titleStmt></fileDesc></teiHeader>
  <text><body><div type="translation"><p>Body.</p></div></body></text>
</TEI>"#;

    let (title, html) = render_xml_body(xml);

    // The returned title (window/tab/library) is the English main title.
    assert_eq!(title.as_deref(), Some("The Chapter on Going Forth"));
    assert_contains(&html, ">The Chapter on Going Forth</h1>");

    // Under the h1: Sanskrit main title, English long title, Sanskrit long
    // title, in that order, with Sanskrit in italics.
    assert_contains(&html, "<div class=\"tei-doc-subtitles\">");
    assert_contains(
        &html,
        "<p class=\"tei-doc-subtitle\"><em>Pravrajyāvastu</em></p>",
    );
    assert_contains(
        &html,
        "<p class=\"tei-doc-subtitle\"><em>Vinayavastu Pravrajyāvastu</em></p>",
    );
    let main_sa = html
        .find("<em>Pravrajyāvastu</em>")
        .expect("Sanskrit main title rendered");
    let long_en = html
        .find("Going Forth\" from The Chapters")
        .expect("English long title rendered");
    let long_sa = html
        .find("<em>Vinayavastu Pravrajyāvastu</em>")
        .expect("Sanskrit long title rendered");
    assert!(
        main_sa < long_en && long_en < long_sa,
        "subtitles keep the order: sa main, en long, sa long"
    );

    // Tibetan titles never appear, in any script.
    assert!(!html.contains("rab tu"));
    assert!(!html.contains("bo-script-title"));
    assert!(!html.contains("'dul ba"));
}

#[test]
fn tei_front_matter_renders_collapsed_before_the_body() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>The Sutra</title></titleStmt></fileDesc></teiHeader>
  <text>
    <front>
      <div type="summary">
        <head>Summary</head>
        <p>This is the summary.</p>
      </div>
      <div type="acknowledgment">
        <head>Acknowledgements</head>
        <p>Thanks to the team.</p>
      </div>
    </front>
    <body>
      <div type="translation">
        <p>The body text.</p>
      </div>
    </body>
  </text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // The front becomes a collapsed <details> (no `open` attribute) labelled
    // with its section headings, and it holds the summary/acknowledgement text.
    assert_contains(
            &html,
            "<details class=\"tei-front\">\n<summary class=\"tei-front-summary\">Summary, Acknowledgements</summary>",
        );
    assert!(
        !html.contains("<details class=\"tei-front\" open"),
        "front must start collapsed"
    );
    assert_contains(&html, ">This is the summary.</p>");
    // The front closes before the body content, so the body is not inside it.
    let front_end = html.find("</details>").expect("front details closes");
    let body_at = html.find(">The body text.</p>").expect("body renders");
    assert!(front_end < body_at, "front must render before the body");
}

#[test]
fn tei_headings_shrink_with_nesting_never_invert() {
    // A `chapter` nested in a `section`: a type→level table would render the
    // nested chapter larger, so heading level must follow nesting depth.
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text><body>
    <div type="translation">
      <div type="section">
        <head>Outer Section</head>
        <div type="chapter">
          <head>Inner Chapter</head>
          <div type="section">
            <head>Deeper Section</head>
          </div>
        </div>
      </div>
    </div>
  </body></text>
</TEI>"#;

    let (_title, html) = render_xml_body(xml);

    // Transparent `translation` adds no depth: h2, h3, h4, strictly shrinking.
    // Match on id + text, since headings carry inline source-range attributes.
    assert_contains(&html, r#"id="outer-section">Outer Section</h2>"#);
    assert_contains(&html, r#"id="inner-chapter">Inner Chapter</h3>"#);
    assert_contains(&html, r#"id="deeper-section">Deeper Section</h4>"#);
}

// ---------------------------------------------------------------------------
// Generic (non-TEI) XML
// ---------------------------------------------------------------------------

#[test]
fn sitemap_records_render_as_a_table_of_links() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://leaftext.com/</loc>
    <lastmod>2026-07-24</lastmod>
  </url>
  <url>
    <loc>https://leaftext.com/docs/</loc>
    <lastmod>2026-07-11</lastmod>
  </url>
</urlset>"#;

    let (title, html) = render_xml_body(xml);

    // A sitemap names no title of its own; the file name heads it (see
    // `opened_document_from_xml`), so the renderer reports none.
    assert!(title.is_none(), "{title:?}");
    // Repeated flat records become one table, with spelled-out column headings.
    assert_contains(&html, "<table class=\"xml-table\"");
    assert_contains(&html, "<th>URL</th><th>Last modified</th>");
    assert_contains(
        &html,
        "<td><a href=\"https://leaftext.com/\">https://leaftext.com/</a></td><td>2026-07-24</td>",
    );
    // And nothing of the TEI renderer's leaks through.
    assert!(!html.contains("No TEI body"), "{html}");
}

#[test]
fn feed_renders_its_title_fields_and_entries() {
    let xml = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Leaf Notes</title>
  <link>https://leaftext.com/feed</link>
  <lastBuildDate>Mon, 20 Jul 2026 09:00:00 GMT</lastBuildDate>
  <item>
    <title>First post</title>
    <link>https://leaftext.com/1</link>
    <description>A paragraph of prose that is long enough to be read as prose rather than as a table cell, which is the whole point of the length limit the record table applies.</description>
  </item>
</channel></rss>"#;

    let (title, html) = render_xml_body(xml);

    // The channel title titles the document, and isn't repeated as a field or
    // as a heading for the wrapper it came from.
    assert_eq!(title.as_deref(), Some("Leaf Notes"));
    assert_contains(&html, ">Leaf Notes</h1>");
    assert_eq!(html.matches("Leaf Notes").count(), 1, "{html}");
    assert!(!html.contains(">Channel</h2>"), "{html}");

    // Leaf children become one label/value list, camelCase names read as words,
    // and a lone URL value links.
    assert_contains(&html, "<dl class=\"xml-fields\">");
    assert_contains(&html, "<dt>Last built</dt>");
    assert_contains(
        &html,
        "<a href=\"https://leaftext.com/feed\">https://leaftext.com/feed</a>",
    );

    // The item is a section headed by its own title — one record is not a table.
    assert_contains(&html, ">First post</h3>");
    assert!(!html.contains("<table"), "{html}");
}

#[test]
fn atom_link_attributes_stand_in_for_missing_text() {
    let xml = r#"<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Feed</title>
  <link href="http://example.org/"/>
  <author><name>Ada</name><email>ada@example.org</email></author>
</feed>"#;

    let (_title, html) = render_xml_body(xml);

    // An empty element with one attribute shows that attribute as its value,
    // unlabelled — the element's own label already names it. (Match around the
    // inline source-range attributes.)
    assert_contains(&html, "<dt>Link</dt><dd data-block-id=");
    assert_contains(
        &html,
        "<a href=\"http://example.org/\">http://example.org/</a></dd>",
    );
    assert!(!html.contains("Link: <a"), "{html}");
    // A section named by a `<name>` child is qualified by its tag, so a person's
    // name doesn't read as a section title on its own.
    assert_contains(&html, ">Author: Ada</h2>");
}

#[test]
fn generic_xml_blocks_anchor_to_their_source_elements() {
    let xml = "<config><name>Widget</name><timeout>30</timeout>\
               <note>Some prose with <b>markup</b> in it.</note></config>";

    let (_title, html, blocks) = render_xml_document(xml, None);

    // Every stamped block slices back to the element it was rendered from.
    assert!(!blocks.is_empty());
    for block in &blocks {
        let slice = &xml[block.start..block.end];
        assert!(slice.starts_with('<') && slice.ends_with('>'), "{slice}");
    }
    // The map matches what the HTML carries, and matches the editing model's.
    assert_eq!(blocks, xml_block_source_map(xml));
    assert_contains(&html, "data-src-start=");
    // Mixed text-and-markup content renders as a paragraph of its text.
    assert_contains(&html, ">Some prose with markup in it.</p>");
}

#[test]
fn xml_with_a_doctype_still_renders() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key>
  <string>Leaf Text</string>
</dict></plist>"#;

    let (_title, html) = render_xml_body(xml);

    assert_contains(&html, "<dt>Key</dt>");
    assert_contains(&html, ">CFBundleName</dd>");
    assert!(!html.contains("parse error"), "{html}");
}

#[test]
fn malformed_xml_reports_where_it_broke() {
    let (title, html) = render_xml_body("<a><b></a>");

    assert!(title.is_none());
    assert_contains(&html, "<strong>XML parse error.</strong>");
    assert_contains(&html, "1:7");
}

#[test]
fn untitled_xml_is_headed_by_its_file_name() {
    let xml = "<urlset><url><loc>https://leaftext.com/</loc><lastmod>2026-07-24</lastmod></url>\
               <url><loc>https://leaftext.com/docs/</loc><lastmod>2026-07-11</lastmod></url></urlset>";

    let document = opened_document_from_xml(xml, "sitemap.xml");

    assert_eq!(document.format, DocumentFormat::Xml);
    assert_eq!(document.title, "Sitemap");
    assert_contains(&document.html, "<h1 id=\"sitemap\">Sitemap</h1>");
    // The reading view can still edit the exact source it came from.
    assert_eq!(document.source, xml);
}

#[test]
fn tei_documents_keep_going_to_the_tei_renderer() {
    let xml = r#"<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt>
    <title type="mainTitle" xml:lang="en">The Work</title>
  </titleStmt></fileDesc></teiHeader>
  <text><body><div type="translation"><lg><l>A verse line.</l></lg></div></body></text>
</TEI>"#;

    let (title, html) = render_xml_body(xml);

    assert_eq!(title.as_deref(), Some("The Work"));
    // TEI-only markup, so the routing (not just the title) went to `tei.rs`.
    assert_contains(&html, "<blockquote class=\"tei-verse\">");
    assert!(!html.contains("xml-fields"), "{html}");
}

#[test]
fn renders_commonmark_code_blocks_links_images_and_rules() {
    let markdown = r#"Paragraph with `inline code`.

Paragraph with [a link](https://example.com).

[a titled link](https://example.com "Example title").

![Alt text](images/example.svg "Example image")

```rust
fn main() {}
```

~~~text
tilde fence
~~~

    indented code

---

***

___
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "<code>inline code</code>");
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" rel="noopener noreferrer">a link</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" title="Example title" rel="noopener noreferrer">a titled link</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="Alt text" title="Example image">"#,
    );
    assert_contains(
        &rendered.html,
        "<pre class=\"highlight\" data-language=\"Rust\"><code class=\"language-rust\">",
    );
    assert_contains(
        &rendered.html,
        "<pre class=\"highlight\" data-language=\"Text\"><code class=\"language-text\">",
    );
    assert_contains(&rendered.html, "tilde fence");
    assert_contains(&rendered.html, "<pre><code>indented code");
    assert_eq!(rendered.html.matches("<hr>").count(), 3);
}

#[test]
fn uses_image_alt_text_as_title_tooltip_when_no_title_is_given() {
    let markdown = "![im the alt text in the box](images/example.svg)";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="im the alt text in the box" title="im the alt text in the box">"#,
    );
}

#[test]
fn keeps_explicit_image_title_over_alt_text() {
    let markdown = r#"![Alt text](images/example.svg "Real title")"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<img src="images/example.svg" alt="Alt text" title="Real title">"#,
    );
}

#[test]
fn renders_simplified_chinese_markdown_without_translating_source_content() {
    let markdown = r#"# Leaf 🍁 使用指南

这是一个包含中文标点、emoji 和链接的段落：[项目链接](https://example.com/leaf)。

## 功能列表

- 阅读 `README.md`
- 保留 Leaf 🍁 名称

| 项目 | 状态 |
| --- | --- |
| 预览 | 可用 |

```ts
const message = "你好，Leaf";
console.log(message);
```
"#;

    let rendered = render_markdown_document(markdown, "中文指南.md");

    assert_eq!(rendered.title, "Leaf 🍁 使用指南");
    assert_contains(&rendered.html, r#"<h1 id="leaf--使用指南">"#);
    assert_contains(&rendered.html, "中文标点、emoji");
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com/leaf" rel="noopener noreferrer">项目链接</a>"#,
    );
    assert_contains(&rendered.html, "<li>阅读 <code>README.md</code></li>");
    assert_contains(&rendered.html, "<td>预览</td>");
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
    );
    assert_contains(&rendered.html, "你好，Leaf");
    assert!(!rendered.html.contains("Hello"));
}

#[test]
fn renders_syntax_highlighted_fenced_code_blocks() {
    let markdown = r#"```rs title="main.rs" {1,3-5}
pub fn main() {
    let value = 1;
}
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="Rust"><code class="language-rust">"#,
    );
    assert_contains(&rendered.html, "syn-storage");
    assert_contains(&rendered.html, "pub");
    assert_contains(&rendered.html, "fn");
    assert_contains(&rendered.html, "let");
    assert!(!rendered.html.contains("title=&quot;main.rs&quot;"));
}

#[test]
fn renders_diff_additions_and_removals_with_theme_token_classes() {
    let markdown = r#"```diff
+added line
-removed line
@@ -1 +1 @@
 unchanged
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="Diff"><code class="language-diff">"#,
    );
    assert_contains(&rendered.html, "syn-inserted");
    assert_contains(&rendered.html, "syn-deleted");
    assert_contains(&rendered.html, "added line");
    assert_contains(&rendered.html, "removed line");
}

#[test]
fn supports_foundation_fenced_code_language_aliases() {
    let cases = [
        (
            "ts",
            "TypeScript",
            "language-typescript",
            "export const value: number = 1;",
        ),
        (
            "typescript",
            "TypeScript",
            "language-typescript",
            "interface User { name: string }",
        ),
        (
            "tsx",
            "TSX",
            "language-tsx",
            "export const App = () => <main>Hello</main>;",
        ),
        (
            "js",
            "JavaScript",
            "language-javascript",
            "const value = 1;",
        ),
        (
            "javascript",
            "JavaScript",
            "language-javascript",
            "function run() { return true; }",
        ),
        (
            "jsx",
            "JSX",
            "language-jsx",
            "export const App = () => <main>Hello</main>;",
        ),
        (
            "json",
            "JSON",
            "language-json",
            r#"{ "enabled": true, "count": 1 }"#,
        ),
        (
            "jsonc",
            "JSONC",
            "language-jsonc",
            r#"{ "enabled": true, "count": 1 }"#,
        ),
        (
            "html",
            "HTML",
            "language-html",
            "<div class=\"card\">Text</div>",
        ),
        ("css", "CSS", "language-css", ".card { color: red; }"),
        (
            "scss",
            "SCSS",
            "language-scss",
            "$color: red; .card { color: $color; }",
        ),
        ("md", "Markdown", "language-markdown", "# Title"),
        ("markdown", "Markdown", "language-markdown", "## Heading"),
        ("bash", "Bash", "language-bash", "echo \"$HOME\""),
        ("sh", "Bash", "language-bash", "printf '%s\\n' \"$SHELL\""),
        ("shell", "Bash", "language-bash", "set -euo pipefail"),
        ("zsh", "Bash", "language-bash", "autoload -Uz compinit"),
        ("yaml", "YAML", "language-yaml", "enabled: true"),
        ("yml", "YAML", "language-yaml", "items:\n  - one"),
        (
            "toml",
            "TOML",
            "language-toml",
            "[package]\nname = \"leaf\"",
        ),
        ("xml", "XML", "language-xml", "<root enabled=\"true\" />"),
        (
            "rust",
            "Rust",
            "language-rust",
            "pub fn main() { let value = 1; }",
        ),
        ("rs", "Rust", "language-rust", "fn main() {}"),
        (
            "python",
            "Python",
            "language-python",
            "def run():\n    return True",
        ),
        ("py", "Python", "language-python", "print('leaf')"),
        ("sql", "SQL", "language-sql", "select * from documents;"),
        ("diff", "Diff", "language-diff", "+added\n-removed"),
        ("patch", "Diff", "language-diff", "@@ -1 +1 @@\n-old\n+new"),
        ("ini", "INI", "language-ini", "[leaf]\nenabled=true"),
        ("dotenv", "Dotenv", "language-dotenv", "LEAF_MODE=preview"),
        (
            "dockerfile",
            "Dockerfile",
            "language-dockerfile",
            "FROM scratch",
        ),
        (
            "graphql",
            "GraphQL",
            "language-graphql",
            "query Leaf { title }",
        ),
        (
            "gql",
            "GraphQL",
            "language-graphql",
            "mutation Save { save }",
        ),
        ("text", "Text", "language-text", "plain text"),
        ("plain", "Text", "language-text", "plain fallback"),
    ];

    for (identifier, display, class_name, code) in cases {
        let rendered =
            render_markdown_document(&format!("```{identifier}\n{code}\n```"), "README.md");

        assert_contains(
            &rendered.html,
            &format!(
                r#"<pre class="highlight" data-language="{display}"><code class="{class_name}">"#
            ),
        );
        assert_contains(&rendered.html, "syn-");
    }
}

#[test]
fn supported_language_aliases_resolve_to_bundled_syntaxes() {
    for identifier in [
        "ts",
        "typescript",
        "tsx",
        "js",
        "javascript",
        "jsx",
        "json",
        "jsonc",
        "html",
        "css",
        "scss",
        "md",
        "markdown",
        "bash",
        "sh",
        "shell",
        "zsh",
        "yaml",
        "yml",
        "toml",
        "xml",
        "rust",
        "rs",
        "python",
        "py",
        "sql",
        "diff",
        "patch",
        "ini",
        "dotenv",
        "dockerfile",
        "graphql",
        "gql",
        "plain",
    ] {
        let language = language_definition(identifier)
            .unwrap_or_else(|| panic!("expected {identifier} to be supported"));
        assert!(
            find_syntax(syntax_set(), &language).is_some(),
            "expected {identifier} to resolve to a bundled syntax"
        );
    }
}

#[test]
fn falls_back_safely_for_unknown_and_empty_code_blocks() {
    let markdown = r#"```unknownlang
const value = "<raw>";
```

```
plain without language
```

```ts" onmouseover="alert(1)
const safe = true;
```

```
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="unknownlang"><code class="language-unknownlang">const value = "&lt;raw&gt;";"#,
    );
    assert_contains(&rendered.html, "<pre><code>plain without language");
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="ts&quot;"><code class="language-ts">"#,
    );
    assert_contains(&rendered.html, "<pre><code></code></pre>");
    assert!(!rendered.html.contains("onmouseover"));
    assert!(!rendered.html.contains("<script"));
}

#[test]
fn escapes_malicious_code_fence_language_identifiers() {
    let markdown = r#"```"><img src=x onerror=alert(1)
<script>alert("identifier")</script>
```

```bad/lang<script>
const value = "<raw>";
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="&quot;><img"><code class="language-img">"#,
    );
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="bad/lang<script>"><code class="language-badlangscript">"#,
    );
    assert_contains(&rendered.html, "&lt;script&gt;alert");
    assert_contains(&rendered.html, "const value = \"&lt;raw&gt;\";");
    assert!(!rendered.html.contains("<img src"));
    assert!(!rendered.html.contains("onerror"));
    assert!(!rendered.html.contains("<script>alert"));
}

#[test]
fn ignores_and_escapes_malicious_code_fence_metadata() {
    let markdown = r#"```ts title="<img src=x onerror=alert(1)>" onclick="alert(2)" {1}
const label = "<button onclick=alert(3)>copy</button>";
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
    );
    assert_contains(&rendered.html, "&lt;button");
    assert_contains(&rendered.html, "onclick=alert");
    assert!(!rendered.html.contains("title=&quot;"));
    assert!(!rendered.html.contains("<img"));
    assert!(!rendered.html.contains("onerror"));
    assert!(!rendered.html.contains("alert(2)"));
    assert!(!rendered.html.contains("{1}"));
}

#[test]
fn escapes_code_content_and_preserves_whitespace() {
    let markdown = "```html\n\t<script>alert(1)</script>  \n<div onerror=\"bad\">x</div>\n```";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "\t");
    assert_contains(&rendered.html, "&lt;");
    assert_contains(&rendered.html, "script");
    assert_contains(&rendered.html, "alert");
    assert!(
        rendered.html.contains("  \n") || rendered.html.contains("  \r\n"),
        "expected trailing spaces before the line break to be preserved:\n{}",
        rendered.html
    );
    assert_contains(&rendered.html, "onerror");
    assert!(!rendered.html.contains("<script>"));
    assert!(!rendered.html.contains("<div onerror"));
}

#[test]
fn handles_large_and_multiple_highlighted_code_blocks() {
    let large_code = (0..300)
        .map(|index| format!("const value{index} = {index};"))
        .collect::<Vec<_>>()
        .join("\n");
    let markdown = format!(
        "```ts\n{large_code}\n```\n\n```js\nconsole.log(\"done\")\n```\n\n```nonsense\nraw\n```"
    );

    let rendered = render_markdown_document(&markdown, "README.md");

    assert_eq!(
        rendered.html.matches(r#"<pre class="highlight""#).count(),
        3
    );
    assert_contains(&rendered.html, "value299");
    assert_contains(&rendered.html, r#"data-language="TypeScript""#);
    assert_contains(&rendered.html, r#"data-language="JavaScript""#);
    assert_contains(&rendered.html, r#"data-language="nonsense""#);
}

#[test]
fn reading_mode_css_includes_light_dark_syntax_themes() {
    let css = reading_mode_css();

    for token in [
        "--background:",
        "--foreground:",
        "--surface:",
        "--surface-page:",
        "--surface-raised:",
        "--surface-elevated:",
        "--surface-muted:",
        "--surface-sunken:",
        "--surface-inset:",
        "--surface-card:",
        "--border:",
        "--border-strong:",
        "--muted:",
        "--muted-foreground:",
        "--primary:",
        "--primary-foreground:",
        "--secondary:",
        "--secondary-foreground:",
        "--accent:",
        "--accent-foreground:",
        "--danger:",
        "--danger-foreground:",
        "--warning:",
        "--warning-foreground:",
        "--success:",
        "--success-foreground:",
        "--done:",
        "--done-foreground:",
        "--link:",
        "--link-hover:",
        "--selection:",
        "--focus-ring:",
        "--shadow:",
        "--app-background:",
        "--app-foreground:",
        "--app-border:",
        "--app-surface:",
        "--app-surface-elevated:",
        "--app-muted-foreground:",
        "--app-action-background:",
        "--app-action-foreground:",
        "--app-focus-ring:",
        "--app-selection-background:",
        "--settings-label-foreground:",
        "--settings-control-background:",
        "--settings-control-border:",
        "--preview-background:",
        "--preview-foreground:",
        "--preview-heading:",
        "--preview-border:",
        "--markdown-inline-code-background:",
        "--markdown-inline-code-foreground:",
        "--markdown-blockquote-background:",
        "--markdown-alert-warning-border:",
        "--markdown-alert-done-border:",
        "--markdown-table-cell-border:",
        "--markdown-table-heading-background:",
        "--markdown-thematic-break:",
        "--minimap-background:",
        "--minimap-border:",
        "--minimap-viewport-border:",
        "--minimap-viewport-background:",
        "--minimap-heading:",
        "--minimap-paragraph:",
        "--minimap-blank:",
        "--minimap-list:",
        "--minimap-blockquote:",
        "--minimap-code:",
        "--code-block-background:",
        "--code-block-foreground:",
        "--code-block-border:",
        "--code-block-selection-background:",
        "--markdown-code-background:",
        "--markdown-code-foreground:",
        "--markdown-blockquote-border:",
        "--markdown-blockquote-foreground:",
        "--markdown-table-border:",
        "--markdown-table-header-background:",
        "--markdown-hr:",
        "--markdown-link:",
        "--markdown-link-hover:",
        "--syntax-background:",
        "--syntax-foreground:",
        "--syntax-comment:",
        "--syntax-keyword:",
        "--syntax-string:",
        "--syntax-number:",
        "--syntax-function:",
        "--syntax-variable:",
        "--syntax-type:",
        "--syntax-operator:",
        "--syntax-punctuation:",
        "--syntax-inserted:",
        "--syntax-deleted:",
        "--syntax-changed:",
    ] {
        assert_contains(css, token);
    }

    // No fonts are bundled into the stylesheet anymore — the app uses system
    // fonts, and web-font themes fetch from Google Fonts on activation.
    assert!(
        !css.contains("@font-face") && !css.contains("data:font/woff2"),
        "reading-mode CSS must not embed bundled font faces"
    );
    // The Primer primitive cascade is gone: every theme, github included, is now
    // a self-contained literal palette, so the compiled CSS carries no Primer
    // primitive blocks or `var(--bgColor-*)` indirection.
    assert!(!css.contains("--base-color-neutral-0"));
    assert!(!css.contains("var(--bgColor-default)"));
    assert!(!css.contains("var(--prettylights-syntax-comment)"));
    assert_contains(css, "/* Leaf semantic theme compiler output. */");
    assert_contains(css, "--leaf-theme-source: github-light;");
    assert_contains(css, "--leaf-theme-source: github-dark;");
    assert_contains(css, "--leaf-theme-source: nightshade-light;");
    assert_contains(css, "--leaf-theme-source: nightshade-dark;");
    assert_contains(css, "--leaf-theme-source: amaranth-light;");
    assert_contains(css, "--leaf-theme-source: amaranth-dark;");
    assert_contains(
        css,
        r#":root[data-leaf-theme="nightshade"][data-leaf-appearance="dark"]"#,
    );
    // GitHub's tokens are concrete hex now, like every other family.
    assert_contains(css, "--leaf-background: #ffffff;");
    assert_contains(css, "--leaf-syntax-comment: #59636e;");
    assert_contains(css, "--surface-page: var(--leaf-markdown-background);");
    assert_contains(css, "--syntax-comment: var(--leaf-syntax-comment);");
    assert_contains(css, "--leaf-syntax-inserted: #116329;");
    assert_contains(css, "--syntax-inserted: var(--leaf-syntax-inserted);");
    assert_contains(css, "--syntax-inserted-bg:");
    assert_contains(css, "--syntax-deleted-bg:");
    assert_contains(css, ".document-body input[type=\"checkbox\"]");
    assert_contains(css, ".document-body .math-display");
    assert_contains(css, ".document-body summary");
    assert_contains(css, ".document-body .syn-keyword");
    assert_contains(css, ".document-body .syn-inserted");
    assert_contains(css, r#":root[data-locale="zh-CN"]"#);
    assert_contains(css, "Noto Sans SC");
    assert_contains(css, "word-wrap: break-word;");
}

#[test]
fn reading_mode_css_consumes_theme_tokens_for_high_impact_surfaces() {
    let css = reading_mode_css();

    for rule in [
        "background: var(--app-background);",
        "color: var(--app-foreground);",
        "background-color: var(--chrome-surface);",
        "color: var(--settings-label-foreground);",
        "border: 1px solid var(--settings-control-border);",
        "background: var(--settings-control-background);",
        "outline: 3px solid var(--app-focus-ring);",
        "background: var(--app-selection-background);",
        "color: var(--app-selection-foreground);",
        "background: var(--preview-background);",
        "color: var(--preview-foreground);",
        "color: var(--preview-heading);",
        "background: var(--markdown-inline-code-background);",
        "color: var(--markdown-inline-code-foreground);",
        "border-left: 0.25em solid var(--markdown-blockquote-border);",
        "color: var(--markdown-blockquote-foreground);",
        "border-left-color: var(--markdown-alert-warning-border);",
        "border: 1px solid var(--markdown-table-cell-border);",
        "background: var(--markdown-table-heading-background);",
        "background: var(--markdown-thematic-break);",
        "background: var(--code-block-background);",
        "background-clip: padding-box;",
        "clip-path: inset(0 round 6px);",
        "color: var(--code-block-foreground);",
        "background: var(--code-block-selection-background);",
        "color: var(--code-block-selection-foreground);",
        "background: var(--keyboard-background);",
        "border-top: 1px solid var(--recent-border);",
        "border: 1px solid var(--minimap-viewport-border);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn reading_mode_css_maps_role_aliases_to_released_tokens() {
    let css = reading_mode_css();

    for alias in [
        "--app-background: var(--background);",
        "--app-foreground: var(--foreground);",
        "--app-border: var(--border);",
        "--app-surface: var(--surface);",
        "--app-surface-elevated: var(--surface-elevated);",
        "--app-action-background: var(--primary);",
        "--app-action-foreground: var(--primary-foreground);",
        "--settings-control-background: var(--surface-elevated);",
        "--settings-control-foreground: var(--foreground);",
        "--preview-background: var(--reading-background);",
        "--preview-foreground: var(--reading-ink);",
        "--preview-heading: var(--reading-heading);",
        "--markdown-inline-code-background: var(--markdown-code-background);",
        "--markdown-inline-code-foreground: var(--markdown-code-foreground);",
        "--markdown-table-cell-border: var(--markdown-table-border);",
        "--markdown-table-heading-background: var(--markdown-table-header-background);",
        "--code-block-background: var(--leaf-editor-code-background);",
        "--code-block-foreground: var(--leaf-editor-code-foreground);",
        "--code-block-selection-foreground: var(--leaf-editor-code-selection-foreground);",
        "--minimap-background: var(--leaf-minimap-background);",
        "--minimap-border: var(--leaf-minimap-border);",
        "--minimap-viewport-border: var(--leaf-minimap-viewport-border);",
        "--minimap-viewport-background: var(--leaf-minimap-viewport-background);",
        "--minimap-heading: var(--leaf-minimap-heading);",
        "--minimap-paragraph: var(--leaf-minimap-paragraph);",
        "--minimap-code: var(--leaf-minimap-code);",
    ] {
        assert_contains(css, alias);
    }
}

#[test]
fn reading_mode_css_defines_document_typography() {
    let css = reading_mode_css();

    for rule in [
            "--reader-content-pad: 32px;",
            "--type-measure-body: 75ch;",
            "--type-base: max(0.875rem, calc(1rem + (100vw - 1280px) / 140));",
            "--type-spacing: calc(var(--type-base) * 1.5);",
            "--type-spacing-sm: var(--type-base);",
            "--type-body-size: var(--type-base);",
            "--type-display-size: calc(var(--type-base) * 3.2);",
            "--type-h1-size: calc(var(--type-base) * 2.2);",
            "--type-h2-size: calc(var(--type-base) * 2);",
            "--type-h3-size: calc(var(--type-base) * 1.8);",
            "--type-h4-size: calc(var(--type-base) * 1.6);",
            "--type-h5-size: calc(var(--type-base) * 1.4);",
            "--type-h6-size: calc(var(--type-base) * 1.2);",
            "--type-caption-size: calc(var(--type-base) * 0.8125);",
            "--type-display-line: 1.2;",
            "--type-h1-line: 1.25;",
            "--type-h2-line: 1.25;",
            "--type-h3-line: 1.25;",
            "--type-h4-line: 1.25;",
            "--type-body-line: 1.6;",
            "--type-caption-line: 1.6;",
            ".reader-layout {\n  --reader-layout-padding-inline: var(--reader-content-pad);\n  container-type: inline-size;",
            "width: min(var(--type-measure-body), 100%);",
            "padding: var(--reader-content-pad) 0;",
            "font-size: var(--type-body-size);",
            "line-height: var(--type-body-line);",
            "word-wrap: break-word;",
            ".document-body h1,",
            ".document-body h6 {",
            "font-family: var(--heading-font);",
            "font-weight: var(--type-h1-weight);",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            "font-size: var(--type-h1-size);",
            "font-size: var(--type-h2-size);",
            "font-size: var(--type-h3-size);",
            "font-size: var(--type-h4-size);",
            "font-size: var(--type-h5-size);",
            "font-size: var(--type-h6-size);",
        ] {
            assert_contains(css, rule);
        }

    for old_reader_specific_layout in [
        "--type-h1-measure",
        "--type-h2-measure",
        "--type-h3-measure",
        "--type-heading-measure",
        "text-wrap: balance;",
        "text-box-trim: trim-both;",
    ] {
        assert!(
                !css.contains(old_reader_specific_layout),
                "rendered Markdown should keep the web reader layout instead of {old_reader_specific_layout}"
            );
    }
}

#[test]
fn reading_mode_css_uses_web_reader_document_rhythm() {
    let css = reading_mode_css();

    for rule in [
            ".document-body p,\n.document-body ul,\n.document-body ol,\n.document-body blockquote,\n.document-body table,\n.document-body pre {\n  margin: 0 0 var(--type-spacing);\n}",
            ".document-body h1,\n.document-body h2,\n.document-body h3,\n.document-body h4,\n.document-body h5,\n.document-body h6 {",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            ".document-body strong {\n  font-weight: 600;\n}",
            ".document-body ul,\n.document-body ol {\n  padding-left: 2em;\n}",
            ".document-body li + li {\n  margin-top: 0.25em;\n}",
            ".document-body li > ul,\n.document-body li > ol {\n  margin: 0.25em 0 0;\n}",
            ".document-body input[type=\"checkbox\"] {\n  accent-color: var(--leaf-markdown-checkbox, #6e7681);\n  margin-right: 0.4em;\n}",
            ".document-body blockquote {\n  border-left: 0.25em solid var(--markdown-blockquote-border);\n  color: var(--markdown-blockquote-foreground);\n  padding: 0 1em;\n}",
            ".document-body blockquote:not(.markdown-alert) p {\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body blockquote:not(.markdown-alert) p.blockquote-lines {\n  padding-left: 0;\n  text-indent: 0;\n}",
            ".document-body blockquote:not(.markdown-alert) .blockquote-line {\n  display: block;\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body code {",
            "font-size: 0.875em;\n  padding: 0.2em 0.4em;",
            ".document-body pre {",
            "line-height: 1.45;",
            "padding: 1em;",
            ".document-body table {",
            "overflow: auto;",
            "width: max-content;",
            ".document-body th,\n.document-body td {\n  border: 1px solid var(--markdown-table-cell-border);\n  padding: 0.375em 0.8125em;\n}",
            ".document-body hr {\n  border: 0;\n  height: 1px;\n  margin: var(--type-spacing) 0;",
            "@media (max-width: 600px) {\n  :root {\n    --reader-content-pad: 16px;",
        ] {
            assert_contains(css, rule);
        }

    for old_rhythm in [
        ".document-body > * {\n  margin-block: 0 16px;\n}",
        "margin-block-start: calc(var(--type-base) * 4);",
        "margin-block-start: calc(var(--type-base) * 1.5);",
        "padding-top: 136px;",
        "padding: 320px 0 88px;",
    ] {
        assert!(
            !css.contains(old_rhythm),
            "rendered Markdown rhythm should match the web reader instead of {old_rhythm}"
        );
    }
}

#[test]
fn app_shell_decorates_blockquote_hard_break_lines_for_hanging_indent() {
    let html = app_shell_html();

    assert_contains(&html, "function decorateBlockquoteLines(root = app) {");
    assert_contains(
        &html,
        "root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {",
    );
    assert_contains(
        &html,
        "if (!children.some((node) => node.nodeName === 'BR')) return;",
    );
    assert_contains(&html, "line.className = 'blockquote-line';");
    assert_contains(&html, "paragraph.classList.add('blockquote-lines');");
    assert_contains(&html, "decorateBlockquoteLines();");
}

#[test]
fn app_shell_builds_collapsed_heading_outline_under_the_title() {
    let html = app_shell_html();

    // The builder exists, is wired into the render pipeline before the anchor
    // pass, and the anchor pass skips the outline so its link-only entries
    // never take a locus number.
    assert_contains(&html, "function buildDocumentOutline() {");
    assert_contains(&html, "buildDocumentOutline();");
    assert_contains(&html, "if (target.closest('.document-outline')) return;");
    // A title plus at least one section, inserted just under the title.
    assert_contains(&html, "if (headings.length < 2) return;");
    assert_contains(&html, "title.insertAdjacentElement('afterend', details);");
    // Collapsed <details> with a localized "Outline" summary, entries nested
    // as a bulleted list (numbers overflow the panel on deep documents) that
    // links each heading by its slug id.
    assert_contains(&html, "details.className = 'document-outline';");
    assert_contains(&html, "summaryLabel.dataset.i18n = 'outline.title';");
    assert_contains(&html, "const rootList = document.createElement('ul');");
    assert!(!html.contains("const rootList = document.createElement('ol');"));
    assert_contains(&html, "link.className = 'document-outline-link';");
    assert_contains(&html, "link.href = '#' + encodeURIComponent(h.id);");
    // The summary carries the document's total line count, stamped in by the
    // anchor pass (whose running count is the total) after the outline exists.
    assert_contains(&html, "summaryCount.className = 'document-outline-count';");
    assert_contains(&html, "const lineTotal = ensureAnchorLinkTargets(body);");
    assert_contains(
        &html,
        "window.leafLocale.t('outline.lineCount', { count: lineTotal })",
    );
    // The (potentially ~25k-entry) list is built lazily, only when the reader
    // first expands the outline — not at every document render.
    assert_contains(&html, "function populateDocumentOutline(details, rest) {");
    assert_contains(&html, "details.addEventListener('toggle', () => {");
    assert_contains(
        &html,
        "if (details.open) populateDocumentOutline(details, rest);",
    );
    // The outline never opens on its own — closed until the reader expands it.
    assert!(!html.contains("details.open = true"));
    // Localized label and line-count suffix present in both shipped languages.
    assert_contains(&html, "'outline.title': 'Outline'");
    assert_contains(&html, "'outline.title': '大纲'");
    assert_contains(&html, "'outline.lineCount': '({count} lines)'");
    assert_contains(&html, "'outline.lineCount': '（{count} 行）'");
}

#[test]
fn theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled() {
    let css = reading_mode_css();
    let sources = theme_sources();

    assert_theme_sources_cover_contract(sources);
    // Ten families (github, nightshade, amaranth, fern, sage, halcyon, arabica, goldenrod, ginger, pippin), each a light/dark pair.
    assert_eq!(sources.len(), 20);
    assert!(sources.iter().any(|source| source.id == "nightshade-dark"));

    for source in sources {
        for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
            assert!(
                theme_source_token_value(source, token).is_some(),
                "expected {} to compile required token {token}",
                source.id
            );
        }
        assert_contains(css, source.selector);
    }

    // The picker's families come from the registered sources, sorted by display
    // name (the theme bundle emits them alphabetically).
    assert_eq!(
        theme_families(),
        vec![
            ("amaranth", "Amaranth"),
            ("arabica", "Arabica"),
            ("fern", "Fern"),
            ("ginger", "Ginger"),
            ("github", "GitHub"),
            ("goldenrod", "Goldenrod"),
            ("halcyon", "Halcyon"),
            ("nightshade", "Nightshade"),
            ("pippin", "Pippin"),
            ("sage", "Sage"),
        ]
    );

    let html = app_shell_html();
    // Theme controls live in a bottom-sheet selector, not inline dropdowns.
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert!(!html.contains(r#"id="themeMode""#));
    assert!(!html.contains(r#"id="themeFamily""#));
    assert_contains(&html, "settings.theme.");
    // Every registered family is a pickable card in the selector sheet (name in a
    // span, with the selected-state check badge).
    for (family, name) in theme_families() {
        assert_contains(
            &html,
            &format!(
                r#"<button type="button" class="theme-item" data-family="{family}" aria-pressed="false"><span class="theme-item-name">{name}</span>"#
            ),
        );
    }
    // Plus the special "Random" preference, localized via data-i18n on the name
    // span (not the button, so localization can't wipe the check SVG). It is not a
    // real family, so it never appears in theme_families()/the font map/the CSS.
    assert_contains(
        &html,
        r#"<button type="button" class="theme-item theme-item-random" data-family="random" aria-pressed="false"><span class="theme-item-name" data-i18n="settings.theme.family.random">Random</span>"#,
    );
    assert!(!theme_families().iter().any(|(id, _)| *id == "random"));
    // Palettes are data-only token maps, not free-form author CSS.
    assert!(!html.contains("customTheme"));
}

#[test]
fn theme_preview_images_are_prose_the_parser_ignores() {
    // Every family file opens with a preview screenshot (`![…](../imgs/themes/…)`),
    // carried into the bundle verbatim by scripts/bundle-themes.mjs. The parser
    // reads only headings and tables, so those lines must be inert: they are not
    // families, not tokens, and not part of any display name.
    let bundle = include_str!("assets/themes.md");
    let preview_lines: Vec<&str> = bundle
        .lines()
        .filter(|line| line.starts_with("!["))
        .collect();
    assert_eq!(
        preview_lines.len(),
        theme_families().len(),
        "expected one preview image per family in the bundle"
    );

    let sources = theme_sources();
    for (family, name) in theme_families() {
        assert!(
            !name.contains('!') && !name.contains('['),
            "family {family} display name picked up image markup: {name}"
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains(&format!("../imgs/themes/{family}.png"))),
            "expected a preview image line for {family}"
        );
        // Both variants still parse, with the full contract intact.
        for appearance in ["light", "dark"] {
            let source = sources
                .iter()
                .find(|source| source.id == format!("{family}-{appearance}"))
                .unwrap_or_else(|| panic!("{family}-{appearance} parses out of the bundle"));
            for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
                assert!(
                    theme_source_token_value(source, token).is_some(),
                    "expected {} to keep required token {token}",
                    source.id
                );
            }
        }
    }
}

#[test]
fn github_family_uses_github_markdown_fonts_not_noto() {
    let css = reading_mode_css();
    // The GitHub family swaps the document fonts for GitHub's own markdown stack:
    // system sans (no serif) for body and headings, system mono for code.
    let block = css
        .split(":root[data-leaf-theme=\"github\"] {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("github family font override block exists");
    assert!(block.contains("--heading-font: -apple-system"));
    assert!(block.contains("--reading-font: -apple-system"));
    assert!(block.contains("--code-font: ui-monospace"));
    // The GitHub document fonts drop the app's bundled Noto serif/mono faces.
    assert!(!block.contains("Noto Serif"));
    assert!(!block.contains("Noto Sans Mono"));
}

#[test]
fn web_font_mechanism_fetches_noto_by_default_and_swaps_on_theme_change() {
    // Nothing is bundled: the stylesheet embeds no font faces.
    let css = reading_mode_css();
    assert!(
        !css.contains("@font-face") && !css.contains("data:font/woff2"),
        "fonts must be fetched from Google Fonts, not bundled into the stylesheet"
    );

    // The family -> Google Fonts URL map gives each non-system family its own web
    // font (Fern keeps Noto; others pick their own vibe). GitHub is omitted, so its
    // loader drops the font link and falls back to the OS stack.
    let map: serde_json::Value =
        serde_json::from_str(&theme_web_font_hrefs_json()).expect("font map is valid JSON");
    let map = map.as_object().expect("font map is an object");
    // A family is present with a Google Fonts URL, or absent (system fonts, fetch nothing).
    for (family, _) in theme_families() {
        if let Some(href) = map.get(family).and_then(|v| v.as_str()) {
            assert!(
                href.starts_with("https://fonts.googleapis.com/css2?family="),
                "{family} should fetch its font from Google Fonts, got {href:?}"
            );
        }
    }
    assert!(!map.contains_key("github"));
    assert!(map.contains_key("fern"));

    // The bootstrap injects the map and swaps a single <link> as the family
    // changes (run on every apply — initial paint and switches alike).
    let html = app_shell_html();
    assert!(html.contains("const FAMILY_FONTS = {"));
    assert!(html.contains("fonts.googleapis.com/css2?family=Noto"));
    assert!(html.contains("const applyFamilyFont = (fam) => {"));
    assert!(html.contains("document.getElementById('leafThemeFont')"));
    assert!(html.contains("applyFamilyFont(family);"));

    // The CSP admits Google Fonts (stylesheet host + font-file host) and no more.
    assert!(html.contains(
        "style-src 'self' 'unsafe-inline' http://leaf-asset.local leaf-asset: https://fonts.googleapis.com"
    ));
    assert!(html.contains(
        "font-src 'self' data: http://leaf-asset.local leaf-asset: https://fonts.gstatic.com"
    ));
}

#[test]
fn theme_compiler_gates_readable_pairs_for_every_source() {
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            ("--leaf-foreground", "--leaf-background"),
            ("--leaf-muted-foreground", "--leaf-background"),
            ("--leaf-primary-foreground", "--leaf-primary"),
            ("--leaf-markdown-foreground", "--leaf-markdown-background"),
            ("--leaf-markdown-heading", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-2", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-3", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-4", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-5", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-6", "--leaf-markdown-background"),
            (
                "--leaf-markdown-inline-code-foreground",
                "--leaf-markdown-inline-code-background",
            ),
            (
                "--leaf-editor-code-foreground",
                "--leaf-editor-code-background",
            ),
            (
                "--leaf-editor-code-selection-foreground",
                "--leaf-editor-code-selection-background",
            ),
            (
                "--leaf-focus-selection-foreground",
                "--leaf-focus-selection-background",
            ),
            ("--leaf-syntax-foreground", "--leaf-syntax-background"),
            ("--leaf-syntax-comment", "--leaf-syntax-background"),
            ("--leaf-syntax-keyword", "--leaf-syntax-background"),
            ("--leaf-syntax-string", "--leaf-syntax-background"),
            ("--leaf-syntax-number", "--leaf-syntax-background"),
            ("--leaf-syntax-function", "--leaf-syntax-background"),
            ("--leaf-syntax-variable", "--leaf-syntax-background"),
            ("--leaf-syntax-type", "--leaf-syntax-background"),
            ("--leaf-syntax-operator", "--leaf-syntax-background"),
            ("--leaf-syntax-punctuation", "--leaf-syntax-background"),
            (
                "--leaf-syntax-inserted",
                "--leaf-syntax-inserted-background",
            ),
            ("--leaf-syntax-deleted", "--leaf-syntax-deleted-background"),
            ("--leaf-syntax-changed", "--leaf-syntax-changed-background"),
        ] {
            let ratio = contrast_ratio(
                css_token_for_source(css, source, foreground),
                css_token_for_source(css, source, background),
            );
            assert!(
                ratio >= 4.5,
                "expected {} {foreground} on {background} contrast {ratio:.2} to be at least 4.5",
                source.id
            );
        }
    }
}

#[test]
fn theme_compiler_gates_interactive_chrome_contrast() {
    // Icons/controls on filled backgrounds, incl. hover. WCAG 1.4.11 gates non-text
    // contrast at 3:1 (text is 4.5:1). The tab-close hover regressed here once (white
    // icon on a light accent), so gate every theme's chrome to catch that class.
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            // Filled action buttons and their hover state (the tab close X reuses
            // the action foreground on the action hover background).
            ("--leaf-primary-foreground", "--leaf-primary"),
            (
                "--leaf-primary-foreground",
                "--leaf-navigation-button-hover-background",
            ),
            (
                "--leaf-navigation-button-foreground",
                "--leaf-navigation-button-background",
            ),
            (
                "--leaf-navigation-button-foreground",
                "--leaf-navigation-button-hover-background",
            ),
            (
                "--leaf-markdown-badge-foreground",
                "--leaf-markdown-badge-background",
            ),
            ("--leaf-secondary-foreground", "--leaf-secondary"),
        ] {
            let ratio = contrast_ratio(
                css_token_for_source(css, source, foreground),
                css_token_for_source(css, source, background),
            );
            assert!(
                ratio >= 3.0,
                "expected {} {foreground} on {background} contrast {ratio:.2} to be at least 3.0",
                source.id
            );
        }
    }
}

#[test]
fn app_shell_renders_interactive_document_minimap() {
    let html = app_shell_html();

    for expected in [
            "renderDocumentMinimap(state.document.minimap)",
            "function renderDocumentMinimap(model) {",
            "document-minimap-track",
            "document-minimap-content",
            "document-minimap-viewport",
            "window.leafLocale.t('minimap.aria')",
            "aria-hidden=\"true\"><div class=\"document-minimap-content\" aria-hidden=\"true\"></div><div class=\"document-minimap-viewport\" aria-hidden=\"true\"",
            "bindDocumentMinimap();",
            "function bindDocumentMinimap() {",
        ] {
            assert_contains(&html, expected);
        }

    // The minimap is a real-text thumbnail: a shrunken clone of the rendered
    // document, not an abstract canvas painting.
    assert!(
        html.contains("const preview = source.cloneNode(true);"),
        "minimap must clone the document into a scaled preview"
    );
    assert!(
        !html.contains("document-minimap-canvas"),
        "minimap no longer paints an abstract canvas"
    );
}

#[test]
fn app_shell_csp_allows_bundled_data_fonts() {
    // Bundled fonts are `data:` URLs, so the CSP must grant `font-src ... data:`
    // or WebView2 silently blocks every one. Guard against that regression.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let font_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("font-src"))
        .expect("CSP declares an explicit font-src directive");
    assert!(
        font_src.contains("data:"),
        "font-src must allow data: URLs so bundled fonts load: {font_src}"
    );
}

#[test]
fn app_shell_builds_minimap_preview_from_document_clone() {
    let html = app_shell_html();
    let css = reading_mode_css();

    for expected in [
        "let minimapPreviewFrame = 0;",
        "let minimapResizeObserver = null;",
        "let minimapBodyObserver = null;",
        "let readerLayoutFrame = 0;",
        "let readerScrollAnchor = null;",
        "function bindDocumentMinimapPreview(track) {",
        // Content changes bump the version so the clone is rebuilt; geometry-only
        // triggers (resize) skip the rebuild unless a width changed.
        "minimapBodyObserver = new MutationObserver(invalidateMinimapPreview);",
        "minimapResizeObserver = new ResizeObserver(() => {",
        "minimapResizeObserver.observe(track);",
        "image.addEventListener('load', invalidateMinimapPreview, { once: true });",
        "function invalidateMinimapPreview() {",
        "minimapContentVersion += 1;",
        "function disconnectMinimapPreviewObservers() {",
        "window.cancelAnimationFrame(minimapPreviewFrame);",
        "function scheduleMinimapPreviewUpdate() {",
        "minimapPreviewFrame = window.requestAnimationFrame(() => {",
        "function updateDocumentMinimapPreview() {",
        // The clone is skipped when nothing shaping the thumbnail changed, so a
        // height-only resize doesn't rebuild the whole document.
        "minimapBuiltVersion === minimapContentVersion &&",
        "minimapBuiltSourceWidth === metrics.sourceWidth &&",
        "minimapBuiltPreviewWidth === previewWidth",
        "const preview = source.cloneNode(true);",
        "preview.classList.add('document-minimap-preview');",
        "preview.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;",
        "content.replaceChildren(preview);",
        "updateMinimapViewport();",
        // Glossary terms are tagged before their hrefs are stripped so the clone can
        // re-blend them (the href-based body blend can't match once href is gone).
        "link.classList.add('glossary-term');",
    ] {
        assert_contains(&html, expected);
    }

    // The clone keeps glossary terms blended into body text like the page, instead
    // of showing them on the generic accent link colour.
    assert_contains(
        &css,
        ".document-minimap-preview a.glossary-term {\n  color: inherit;\n}",
    );

    // The real-text clone replaces the old abstract canvas entirely (no 2D
    // context, palette, or line-model rows). Checked across both the shell
    // markup/script and the linked stylesheet since styles no longer inline.
    for forbidden in [
        "document-minimap-canvas",
        "canvas.getContext('2d')",
        "function drawDocumentMinimapCanvas() {",
        "const scaleY = cssHeight / model.line_count;",
        "readColor('--minimap-heading'",
        "minimapThemeUnsubscribe",
        "minimapResizeObserver.observe(source)",
    ] {
        assert!(
            !html.contains(forbidden) && !css.contains(forbidden),
            "minimap preview must not reintroduce the canvas or scroll-churn path: {forbidden}"
        );
    }
}

#[test]
fn app_shell_maps_minimap_geometry_proportionally() {
    let html = app_shell_html();

    // The box and click/drag mapping derive from the reader's real scroll range,
    // so they track the thumbnail at any length; on tall documents the thumbnail
    // slides in the rail.
    for expected in [
            "const previewScale = contentWidth / sourceWidth;",
            "const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportDocumentTop = scrollTop * metrics.previewScale;",
            "const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;",
            "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
            "minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);",
            "minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);",
            "minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("function minimapViewportGeometry(metrics) {"),
        "the clone minimap replaces the canvas geometry helper"
    );
    // The content-visibility-era clone-offset workaround is gone: the reader renders
    // in full, so the box reads the exact scroll position, not a block-offset table.
    assert!(
        !html.contains("minimapCloneOffsets") && !html.contains("minimapReaderTrueScrolled"),
        "the full-render minimap drops the clone-offset scroll estimate"
    );
}

#[test]
fn app_shell_loads_mermaid_and_renders_diagram_fences_after_document_insert() {
    let html = app_shell_html();

    for expected in [
        "mermaid.min.js",
        "let mermaidLoadPromise = null;",
        "renderMermaidDiagrams();",
        "function loadMermaid() {",
        "function renderMermaidDiagrams() {",
        "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])",
        "mermaid.initialize({",
        "securityLevel: 'strict'",
        "fontFamily: \"'Noto Sans', sans-serif\"",
        "return mermaid.run({ nodes: diagrams });",
        "diagram.dataset.mermaidRender = 'failed';",
    ] {
        assert_contains(&html, expected);
    }
    // Mermaid and KaTeX are served from the bundled-asset protocol, never a CDN.
    assert!(
        !html.contains("cdn.jsdelivr"),
        "runtimes must be self-hosted, not loaded from a CDN"
    );
    assert!(html.contains(LOCAL_ASSET_PROTOCOL));
}

#[test]
fn app_shell_loads_bundled_katex_and_renders_math_after_document_insert() {
    let html = app_shell_html();

    for expected in [
        "katex/katex.min.js",
        "katex/katex.min.css",
        "let katexLoadPromise = null;",
        "function loadKatex() {",
        "function renderMathElements() {",
        "renderMathElements();",
        "node.classList.contains('math-display')",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn bundled_asset_response_serves_known_assets_and_404s_unknown() {
    let js = bundled_asset_response("leaf-asset://local/mermaid.min.js");
    assert_eq!(js.status, 200);
    assert_eq!(js.content_type, "text/javascript; charset=utf-8");
    assert!(!js.body.is_empty());

    let css = bundled_asset_response("http://leaf-asset.local/katex/katex.min.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type, "text/css; charset=utf-8");

    let font = bundled_asset_response("leaf-asset://local/katex/fonts/KaTeX_Main-Regular.woff2");
    assert_eq!(font.status, 200);
    assert_eq!(font.content_type, "font/woff2");
    assert!(!font.body.is_empty());

    let missing = bundled_asset_response("leaf-asset://local/nope.js");
    assert_eq!(missing.status, 404);
}

#[test]
fn app_css_is_served_over_the_asset_protocol_not_inlined() {
    // The reading-mode stylesheet is delivered as a linked stylesheet, so the
    // shell links it and the protocol serves the full CSS. Keeping it out of the
    // inlined shell is what keeps `NavigateToString` under WebView2's size cap.
    let html = app_shell_html();
    assert!(
        html.contains(r#"<link rel="stylesheet" href="#) && html.contains("app.css"),
        "shell must link app.css rather than inline a <style> block"
    );
    assert!(
        !html.contains("<style>"),
        "reading-mode CSS must not be inlined into the shell"
    );

    let css = bundled_asset_response("http://leaf-asset.local/app.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type, "text/css; charset=utf-8");
    // The route serves the whole compiled stylesheet: fonts, semantic tokens,
    // and app layout all resolve here.
    let body = std::str::from_utf8(&css.body).expect("app.css is utf-8");
    assert_eq!(body, reading_mode_css());
    assert!(body.contains("--leaf-background"));
    assert!(body.contains(".app-bar"));
}

#[test]
fn app_shell_stays_well_under_navigate_to_string_budget() {
    // WebView2 loads the shell through `ICoreWebView2::NavigateToString`, which
    // rejects content past ~2 MB with E_INVALIDARG (0x80070057) — the string is
    // measured as UTF-16, so the real ceiling is ~1M ASCII chars. Inlining the
    // ~1.3 MB reading-mode stylesheet blew past it (regression: "Leaf Text could
    // not start"). All heavy CSS now loads via `app.css` over the asset
    // protocol, so the shell is a small skeleton + inline bootstrap/app script.
    // This test fails loudly if any large blob is inlined back into the shell.
    let html = app_shell_html();
    let utf16_bytes = html.encode_utf16().count() * 2;
    const BUDGET_BYTES: usize = 1_400_000; // ~2/3 of the ~2 MB NavigateToString cap.
    assert!(
        utf16_bytes < BUDGET_BYTES,
        "app shell is {utf16_bytes} UTF-16 bytes, over the {BUDGET_BYTES}-byte \
         NavigateToString safety budget; do not inline large CSS/JS into the shell — \
         serve it over the leaf-asset:// protocol instead"
    );
    // NavigateToString takes a NUL-terminated wide string, so one stray NUL in a
    // string literal truncates the page there: a blank frame, no window controls.
    assert!(
        !html.contains('\0'),
        "app shell contains a NUL byte; NavigateToString would truncate the page there"
    );
}

#[test]
fn app_shell_renders_history_controls_and_intercepts_document_links() {
    let html = app_shell_html();

    for expected in [
            r#"<button type="button" id="backButton""#,
            r#"<button type="button" id="forwardButton""#,
            r#"<button type="button" id="homeButton" class="brand-button" data-i18n-aria-label="actions.home" data-i18n-title="actions.home.title" aria-label="Home" title="Home">"#,
            r#"<div class="tab-bar" id="tabBar" role="tablist" aria-label="Open documents"></div>"#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.back""#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.forward""#,
            r#"<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M18 6 6 18"/><path d="m6 6 12 12"/>"#,
            "backButton.addEventListener('click', () => sendNavigationCommand('goBack'))",
            "forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'))",
            "homeButton.addEventListener('click', () => send({ command: 'goHome' }))",
            "function sendNavigationCommand(command) {",
            "function isEditableMouseTarget(target) {",
            "function navigationCommandForMouseButton(event) {",
            "event.button === 3",
            "return 'goBack';",
            "event.button === 4",
            "return 'goForward';",
            "window.addEventListener('mousedown', (event) => {",
            "event.preventDefault();",
            "const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';",
            "const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';",
            "event.key.toLowerCase() === 'w' && currentState.active != null",
            "send({ command: 'closeTab', index: currentState.active });",
            "command: 'switchTab',",
            "code_scroll: codeViewActive ? viewScrollFraction() : null,",
            "send({ command: 'closeTab', index: Number(button.dataset.tabClose) });",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
            "function bindDocumentLinks() {",
            "const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;",
            "window.leafSetNavigation({ canGoBack: false, canGoForward: false });",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
        "Back button must use the vendored arrow-left icon instead of the fallback chevron"
    );

    let forward_position = html
        .find(r#"<button type="button" id="forwardButton""#)
        .expect("app shell renders forward button");
    let nav_end_position = html
        .find("</nav>")
        .expect("app shell closes history navigation");
    let tab_bar_position = html
        .find(r#"<div class="tab-bar" id="tabBar""#)
        .expect("app shell renders the open-document tab bar");

    assert!(
        forward_position < nav_end_position && nav_end_position < tab_bar_position,
        "Tab bar should follow the history navigation controls"
    );
}

/// The header logomark and the library's per-file badge are the same glyph, and
/// neither may carry a color of its own: both inherit the theme through
/// `currentColor`, which is what keeps the library leaves in step with the
/// header when the theme changes.
#[test]
fn app_shell_inlines_one_leaf_mark_that_tracks_the_theme() {
    let html = app_shell_html();
    let leaf_path_prefix = r#"<path d="M59.7,60.1c-7.9-20.9"#;

    assert_eq!(
        html.matches(leaf_path_prefix).count(),
        2,
        "the leaf glyph should be inlined exactly twice: header logomark + library row template"
    );
    for (index, _) in html.match_indices(leaf_path_prefix) {
        let element_end = html[index..]
            .find("/>")
            .map(|offset| index + offset)
            .expect("inlined leaf path closes");
        assert!(
            html[index..element_end].contains(r#"fill="currentColor""#),
            "every inlined leaf mark fills with currentColor so it inherits the theme"
        );
    }
    assert!(
        !html.contains("#3fb950"),
        "the leaf mark must not ship a baked-in green; it inherits the theme color"
    );

    // Both sites point that inherited color at the theme's primary token.
    let css = reading_mode_css();
    for selector in [".brand-button > svg", ".library-file > svg"] {
        let rule_start = css
            .find(selector)
            .unwrap_or_else(|| panic!("{selector} is styled"));
        let rule_end = css[rule_start..]
            .find('}')
            .map(|offset| rule_start + offset)
            .expect("rule closes");
        assert!(
            css[rule_start..rule_end].contains("color: var(--primary)"),
            "{selector} should take the theme's primary color"
        );
    }
}

#[test]
fn app_shell_normalizes_literal_svg_icon_colors_to_current_color() {
    let icon = r##"<svg><path fill="#fff" stroke="#FFFFFF"/><path fill='white' stroke='none'/><path fill="#fff0eb" stroke="currentColor"/><path fill="rgb(255, 255, 255)" stroke="rebeccapurple"/><path fill-rule="evenodd"/><path style="fill:#fff; stroke: hsl(0 0% 100%); fill-opacity: 0.5"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="currentColor" stroke="currentColor"/><path fill='currentColor' stroke='none'/><path fill="currentColor" stroke="currentColor"/><path fill="currentColor" stroke="currentColor"/><path fill-rule="evenodd"/><path style="fill:currentColor; stroke: currentColor; fill-opacity: 0.5"/></svg>"##
    );
}

#[test]
fn app_shell_preserves_tokenized_svg_icon_colors() {
    let icon = r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##
    );
}

#[test]
fn app_shell_back_icon_uses_current_color_and_keeps_no_square_fallback() {
    let html = app_shell_html();

    assert_contains(&html, r#"stroke="currentColor""#);
    assert_contains(
        &html,
        r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor""#,
    );
    assert!(
        !html.contains(r##"stroke="#fff""##)
            && !html.contains(r##"stroke="#ffffff""##)
            && !html.contains(r#"stroke="white""#),
        "app-owned icon SVGs must inherit the surrounding control color"
    );
    for hardcoded_color in [
        r##"fill="#fff0eb""##,
        r#"fill="rgb("#,
        r#"stroke="rgb("#,
        r#"fill="hsl("#,
        r#"stroke="hsl("#,
        r#"fill="black""#,
        r#"stroke="black""#,
        r#"fill="white""#,
        r#"stroke="white""#,
    ] {
        assert!(
            !html.contains(hardcoded_color),
            "app-owned icon SVGs must not contain hardcoded theme colors: {hardcoded_color}"
        );
    }
    assert!(
        !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
        "Back button must not regress to the generic fallback chevron"
    );
}

#[test]
fn app_shell_styles_history_controls_with_neutral_icon_treatment() {
    let css = reading_mode_css();

    for expected in [
        ".history-button {",
        "border-color: transparent;",
        "background: var(--settings-control-background);",
        "color: var(--settings-control-foreground);",
        ".history-button:hover:not(:disabled)",
        ".history-button:disabled,\n.history-button:disabled:hover",
        "color: var(--app-muted-foreground);",
        "opacity: 0.46;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
    let css = reading_mode_css();

    for expected in [
        ".open-button {",
        "border-color: transparent;",
        "background: transparent;",
        "color: var(--app-muted-foreground);",
        ".open-button:hover {",
        "color: var(--app-action-foreground);",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_header_keeps_one_chrome_shade_with_dividers() {
    let css = reading_mode_css();

    for expected in [
        // One flat chrome shade under the dot grid. No translucent fill or backdrop
        // blur: either makes the bar's tone depend on what sits behind it.
        "background-color: var(--chrome-surface);",
        "radial-gradient(circle, var(--app-bar-grain) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        // The grain tiles from the window, so every grained surface shares one
        // lattice and no seam between them reads as a hairline.
        "background-attachment: fixed;",
        // The bar keeps a hairline top divider in the outer border color.
        "border-top: 1px solid var(--app-border);",
        // The bottom divider is drawn by ::after (not border-bottom) so the
        // active tab can paint over it and read as joined to the page below.
        ".app-bar::after {",
        "background: var(--app-border);",
    ] {
        assert_contains(css, expected);
    }

    // No blurred fade elements hanging below the bar, and no scroll shadow.
    for absent in [".app-bar::before", ".app-bar.is-scrolled"] {
        assert!(!css.contains(absent), "app header must not draw {absent}");
    }

    // No surface derives its own shade from the token — a tint on one shows up as a
    // tone seam where it meets its neighbour.
    assert!(!css.contains("--library-surface"));
    for tinted in [
        "color-mix(in srgb, var(--chrome-surface)",
        "color-mix(in srgb, var(--app-surface) 98%, black)",
    ] {
        assert!(!css.contains(tinted), "chrome must not tint {tinted}");
    }
}

#[test]
fn reading_surfaces_carry_the_chrome_dot_grain() {
    let css = reading_mode_css();

    // Its own token, lighter than the chrome's: body text sits on these.
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.08);");
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.3);");

    // Every tinted reading surface takes the grain, on the chrome's lattice.
    for expected in [
        ".document-body .document-outline,",
        ".document-body .tei-front,",
        ".document-body pre,",
        ".document-body th,",
        ".document-body tr:nth-child(2n) td,",
        ".code-view {",
        "radial-gradient(circle, var(--reader-surface-grain) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
    ] {
        assert_contains(css, expected);
    }

    // The grain rule has to follow the fills it grains: at equal specificity a
    // `background:` shorthand declared later blanks the image again.
    let grain = css
        .find("var(--reader-surface-grain)")
        .expect("reader grain rule");
    for fill in [
        ".document-body .document-outline {",
        ".document-body pre {",
        ".document-body th {",
        ".code-view {",
    ] {
        let at = css.find(fill).unwrap_or_else(|| panic!("{fill} rule"));
        assert!(at < grain, "{fill} must be declared before the grain rule");
    }
}

#[test]
fn app_shell_throttles_minimap_scroll_sync() {
    let html = app_shell_html();

    for expected in [
        "let minimapViewportFrame = 0;",
        "function scheduleMinimapViewportUpdate() {",
        "window.requestAnimationFrame(() => {",
        "function updateMinimapViewport() {",
        "app.addEventListener('scroll', () => {",
        "clampReaderScrollPosition();",
        "readerScrollAnchor = captureReaderScrollAnchor();",
        "scheduleMinimapViewportUpdate();",
        "window.addEventListener('resize', () => {",
        "scheduleReaderLayoutUpdate();",
        "scheduleMinimapViewportUpdate();",
        "scheduleMinimapPreviewUpdate();",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_clicks_minimap_to_scroll_document() {
    let html = app_shell_html();

    for expected in [
        "const scrollToMinimapSnapshotPoint = (event) => {",
        "const content = track.querySelector('.document-minimap-content');",
        "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
        "app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));",
        "track.addEventListener('pointerdown', (event) => {",
        "if (Number.isFinite(minimapPointerOffsetY)) {",
        "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
        "} else {",
        "scrollToMinimapSnapshotPoint(event);",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_drags_minimap_to_scroll_document() {
    let html = app_shell_html();

    for expected in [
            "let minimapPointerId = null;",
            "let minimapPointerOffsetY = null;",
            "const minimapPointerOffset = (event) => {",
            "return event.clientY - viewportRect.top;",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const previewTravel = Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);",
            "const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;",
            "placeMinimapViewport(minimap, metrics, boundedScrollTop);",
            "minimapPointerOffsetY = minimapPointerOffset(event);",
            "track.setPointerCapture(event.pointerId);",
            "track.addEventListener('pointermove', (event) => {",
            "if (event.pointerId !== minimapPointerId) {",
            "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
            "minimapPointerOffsetY = null;",
            "track.addEventListener('pointerup', endDrag);",
            "track.addEventListener('pointercancel', endDrag);",
            "track.addEventListener('lostpointercapture', endDrag);",
        ] {
            assert_contains(&html, expected);
        }

    // A grab inside the box preserves the offset (drag); a bare click centers
    // the reader on the pointer (snapshot). The drag handler is defined before
    // the snapshot handler in bindDocumentMinimap.
    let drag_position = html
        .find("const dragMinimapViewportToPointer = (event, pointerOffsetY) => {")
        .expect("minimap drag handler exists");
    let snapshot_position = html
        .find("const scrollToMinimapSnapshotPoint = (event) => {")
        .expect("minimap click-to-scroll handler exists");
    assert!(
        drag_position < snapshot_position,
        "drag handler is defined before the snapshot handler"
    );
    assert!(
        !html.contains("minimapDragStartScrollTop"),
        "minimap drag maps through the scroll range, not a cached start offset"
    );
}

#[test]
fn app_shell_preserves_focus_and_updates_minimap_viewport_indicator() {
    let html = app_shell_html();

    for expected in [
        "const restoreFocus = () => {",
        "const active = document.activeElement;",
        "active.focus({ preventScroll: true });",
        "event.preventDefault();",
        "minimap.style.setProperty('--minimap-viewport-top'",
        "minimap.style.setProperty('--minimap-viewport-height'",
        "updateMinimapViewport();",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_sizes_minimap_viewport_from_scroll_fraction() {
    let html = app_shell_html();

    // The box height is the reader window at thumbnail scale, placed from the
    // slide plus scaled scroll top, so it tracks the visible region at any length.
    let box_height_position = html
        .find("const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);")
        .expect("viewport box height is the reader window at the thumbnail scale");
    let preview_top_position = html
            .find("const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);")
            .expect("the thumbnail slides by the scroll ratio");
    let box_top_position = html
            .find("const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));")
            .expect("box top combines the thumbnail slide and the scaled scroll top");

    assert!(
        box_height_position < preview_top_position && preview_top_position < box_top_position,
        "viewport geometry should size the box, slide the thumbnail, then place the box"
    );
    assert!(
        !html.contains("const boxTop = scrollFraction * travel;"),
        "the clone minimap replaces the canvas fraction-only box placement"
    );
}

#[test]
fn app_shell_sizes_minimap_track_to_available_reader_height() {
    let html = app_shell_html();

    for expected in [
        "function minimapAvailableHeight(minimap) {",
        "const shellRect = app.getBoundingClientRect();",
        "const minimapRect = minimap.getBoundingClientRect();",
        "return Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));",
        "function measureDocumentMinimap(track) {",
        "const scrollHeight = Math.max(1, Math.ceil(app.scrollHeight));",
        "const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));",
        "const scrollable = Math.max(0, scrollHeight - viewportHeight);",
        "const scrollTop = Math.min(scrollable, Math.max(0, app.scrollTop));",
        "const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);",
        "const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;",
        "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));",
        "minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);",
    ] {
        assert_contains(&html, expected);
    }

    // The track caps its height at the scaled document height, so a short document
    // gets a short rail with no dead space below it.
    assert!(
        html.contains(
            "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));"
        ),
        "track sizing caps at the scaled thumbnail height"
    );
}

#[test]
fn app_shell_rebinds_minimap_after_document_updates() {
    let html = app_shell_html();

    for expected in [
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            "app.innerHTML = `<div class=\"${layoutClass}\">${state.document.html}${minimapHtml}</div>`;",
            "bindDocumentMinimap();",
            "updateMinimapViewport();",
        ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_reader_editor_round_trips_safe_inline_html() {
    let html = app_shell_html();

    for expected in [
        "const MARKDOWN_RAW_INLINE_TAGS = new Set(['abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div']);",
        "div: ['align', 'id'],",
        "return '<' + tag + rawInlineHtmlAttributes(el, tag) + '>' + inlineDomToMarkdown(el) + '</' + tag + '>';",
        "out += '<br>';",
        "'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',",
        "out += rawInlineHtmlToMarkdown(child, tag);",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_save_success_clears_reader_undo_state() {
    let html = app_shell_html();

    assert_contains(&html, "window.leafSaved = (path, ok, error) => {");
    assert_contains(&html, "undoableByPath.delete(path);");
}

#[test]
fn app_shell_resets_new_documents_to_rendered_content_top() {
    let html = app_shell_html();

    for expected in [
        "let resetReaderScrollOnNextRender = false;",
        "resetReaderScrollOnNextRender = true;",
        "resetReaderScrollToContentStart();",
        "function resetReaderScrollToContentStart() {",
        "const content = correctReaderScrollOrigin(source);",
        "setReaderScrollTop(content.topOffset);",
        "readerScrollAnchor = captureReaderScrollAnchor();",
        "const firstContent = source.firstElementChild;",
        "const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);",
        "const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);",
    ] {
        assert_contains(&html, expected);
    }

    assert!(
        !html.contains("app.scrollTop = 0;"),
        "new document reset should account for reader padding instead of blindly scrolling to zero"
    );
}

#[test]
fn app_shell_clamps_reader_scroll_to_rendered_content_range() {
    let html = app_shell_html();

    for expected in [
            "function measureReaderScrollRange(documentContent, viewportHeight) {",
            "minScrollTop: documentContent.topOffset,",
            "maxScrollTop: documentContent.topOffset + scrollable,",
            "function readerScrollOrigin(source) {",
            "function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {",
            "const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));",
            "source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);",
            "function clampReaderScrollTop(scrollTop) {",
            "return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));",
            "function setReaderScrollTop(scrollTop) {",
            "app.scrollTop = clampReaderScrollTop(scrollTop);",
            "function clampReaderScrollPosition() {",
            "const clampedScrollTop = clampReaderScrollTop(app.scrollTop);",
            "app.addEventListener('scroll', () => {",
            "clampReaderScrollPosition();",
            "setReaderScrollTop(app.scrollTop);",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("app.scrollTop = Math.max(0, nextScrollTop);"),
        "restored reader scroll positions must clamp to the rendered content top, not raw zero"
    );
}

#[test]
fn app_shell_preserves_reader_anchor_across_layout_reflow() {
    let html = app_shell_html();

    for expected in [
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "let readerReflowObserver = null;",
            "const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';",
            "function captureReaderScrollAnchor() {",
            // Capture and restore share one cached block list so a serialized
            // {section, block} anchor always resolves back to the element it named.
            "readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));",
            "const blocks = readerAnchorBlockList(source);",
            "return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };",
            "function resolveReaderAnchorElement(anchor) {",
            "function restoreReaderScrollAnchor(anchor) {",
            "setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);",
            "function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {",
            "correctReaderScrollOrigin();",
            "restoreReaderScrollAnchor(anchor);",
            "readerScrollAnchor = captureReaderScrollAnchor();",
            "window.addEventListener('resize', () => {",
            "scheduleReaderLayoutUpdate();",
            // The reflow observer re-pins the anchor as images decode and grow,
            // and drops the stale anchor-block cache so the re-pin resolves
            // against the current DOM rather than detached, zero-rect entries.
            "function observeReaderReflow() {",
            "readerReflowObserver = new ResizeObserver(() => {",
            "readerAnchorBlocks = null;",
            "image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_records_the_anchor_whenever_the_minimap_moves_the_reader() {
    // The scroll listener is deliberately inert during a minimap drag, so the minimap
    // must record the anchor itself. When it didn't, the anchor kept the pre-drag
    // position and the next late reflow — most visibly the async bottom pager landing
    // seconds after the document — restored it and threw the reader back up the page.
    let html = app_shell_html();

    for expected in [
        "function recordReaderScrollPosition() {",
        "clampReaderScrollPosition();\n  readerScrollAnchor = captureReaderScrollAnchor();",
        // Rail click (pointerdown, so already flagged as dragging).
        "app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));\n    recordReaderScrollPosition();",
        // Drag release: drop the queued pass built on the pre-drag anchor first,
        // then record where the drag landed.
        "cancelReaderLayoutUpdate();\n      recordReaderScrollPosition();",
        "function cancelReaderLayoutUpdate() {",
        "window.cancelAnimationFrame(readerLayoutFrame);",
    ] {
        assert_contains(&html, expected);
    }

    // Mid-drag, the queued pass must not re-pin at all: its anchor predates the
    // drag, so restoring it would fight the pointer and undo the jump.
    let update_start = html
        .find("function scheduleReaderLayoutUpdate(")
        .expect("app shell should schedule reader layout updates");
    let update_body = &html[update_start..];
    let drag_guard = update_body
        .find("if (minimapDragging) {")
        .expect("the layout pass should bail while a minimap drag owns the scroll");
    let repin = update_body
        .find("restoreReaderScrollAnchor(anchor);")
        .expect("the layout pass should re-pin the reader anchor");
    assert!(
        drag_guard < repin,
        "the minimap-drag bail must come before the anchor re-pin, or a drag gets yanked back to where it started"
    );
}

#[test]
fn reading_mode_css_offsets_document_by_measured_scroll_origin() {
    let css = reading_mode_css();

    assert_contains(
        css,
        "margin: calc(-1 * var(--reader-scroll-origin, 0px)) 0 0;",
    );
}

#[test]
fn reading_mode_css_pins_reader_to_its_grid_cell() {
    // The reader must be explicitly placed in the library-shell grid. When it
    // was auto-placed, unhiding the .reader-loading overlay (explicitly at
    // column 2, row 1) evicted the reader into an implicit row in the 0px
    // library column, reflowing the whole document at zero width and turning
    // every in-flight scroll computation into garbage — the "page jumps all
    // over the place" bug.
    let css = reading_mode_css();
    let shell_rule_start = css
        .find(".reader-shell {")
        .expect("reading-mode CSS should define .reader-shell");
    let shell_rule_end = css[shell_rule_start..]
        .find('}')
        .map(|offset| shell_rule_start + offset)
        .expect(".reader-shell rule should close");
    let shell_rule = &css[shell_rule_start..shell_rule_end];

    assert_contains(shell_rule, "grid-column: 2;");
    assert_contains(shell_rule, "grid-row: 1;");
}

#[test]
fn reading_mode_css_keeps_minimap_stable_wide_enough_and_responsive() {
    let css = reading_mode_css();

    for expected in [
            ".reader-layout {",
            "--reader-layout-padding-inline: var(--reader-content-pad);",
            "grid-template-columns: minmax(0, 1fr);",
            "justify-items: center;",
            "padding: 0 var(--reader-layout-padding-inline);",
            "position: relative;",
            ".reader-shell.has-document:has(.document-minimap)",
            ".reader-layout-no-minimap",
            "justify-items: center;",
            ".document-minimap {",
            "--minimap-padding-inline: 8px;",
            "--minimap-preview-width: 68px;",
            "grid-area: 1 / 1;",
            "justify-self: end;",
            "position: sticky;",
            "top: 0;",
            "--minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));",
            "width: var(--minimap-width);",
            "margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));",
            "--minimap-track-height: 100%;",
            "height: var(--minimap-track-height);",
            ".document-minimap-content",
            ".document-minimap-preview",
            "left: var(--minimap-padding-inline);",
            "right: var(--minimap-padding-inline);",
            "cursor: default;",
            "touch-action: none;",
            "user-select: none;",
            "@media (max-width: 900px)",
            "--minimap-preview-width: 46px;",
        ] {
            assert_contains(css, expected);
        }

    assert!(
        !css.contains(".document-minimap {\n    display: none;"),
        "minimap must stay visible on narrow windows so it remains the scroll affordance"
    );

    for removed_fixed_height in [
        "height: calc(100vh - 150px);",
        "min-height: 180px;",
        "max-height: 720px;",
    ] {
        assert!(
            !css.contains(removed_fixed_height),
            "minimap rail should use measured reader viewport height, not {removed_fixed_height}"
        );
    }

    assert!(
        !css.contains("--reader-layout-padding-inline: 14px;"),
        "reader side padding should follow the web reader content pad token"
    );

    assert!(
            !css.contains("padding-inline: var(--minimap-padding-inline);"),
            "minimap track padding would double-inset the preview lane and keep the viewport overlay from reading as edge-to-edge"
        );
    assert!(
            !css.contains("border-left: 1px solid var(--minimap-border);"),
            "minimap track border must not consume layout width because the preview lane needs exactly 8px from both minimap edges"
        );
    assert!(
        css.contains(".document-minimap-viewport {\n  position: absolute;\n  inset-inline: 0;"),
        "minimap viewport must span the full rail width"
    );
    assert!(
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: var(--minimap-preview-top, 0px);\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "the minimap thumbnail lane fills the rail inside the exact 8px padding on both edges"
        );
    // The reader renders the whole document up front, so it must NOT use
    // content-visibility (which flashed blocks blank and jumped the minimap box).
    assert!(
        !css.contains("content-visibility: auto"),
        "the reader must render in full (no content-visibility) so scrolling matches the web"
    );
    assert!(
            css.contains("margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));"),
            "minimap rail must occupy the layout padding so no dead strip remains to the right of the rail"
        );
}

#[test]
fn app_shell_persists_minimap_enabled_setting() {
    let html = app_shell_html();

    for expected in [
            "const minimapEnabledControl = document.getElementById('minimapEnabled');",
            "let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;",
            "getEnabled: () => minimapEnabled",
            "setEnabled(nextEnabled)",
            "document.documentElement.dataset.minimapEnabled = String(minimapEnabled);",
            "window.leafMinimap.setEnabled(minimapEnabled);",
            "minimapEnabledControl.checked = window.leafMinimap.getEnabled();",
            "send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });",
        ] {
            assert_contains(&html, expected);
        }

    // The host owns persistence now: no localStorage-backed settings remain.
    assert!(
        !html.contains("createBooleanStorage"),
        "settings must be persisted by the host, not the non-durable localStorage shim"
    );
}

#[test]
fn app_shell_persists_and_applies_speed_reader_setting() {
    let html = app_shell_html();
    let css = reading_mode_css();

    for expected in [
            r#"<label class="setting-control setting-control-inline" for="speedReaderEnabled">"#,
            r#"<input type="checkbox" id="speedReaderEnabled" aria-label="Speed Reader" aria-describedby="speedReaderEnabledHelp">"#,
            "const speedReaderEnabledControl = document.getElementById('speedReaderEnabled');",
            "let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;",
            "function setSpeedReaderEnabled(enabled) {",
            "document.documentElement.dataset.speedReader = String(speedReaderEnabled);",
            "send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });",
            "applySpeedReaderToDocument();",
            "function leadAnchorPrefixLength(count) {",
            "anchor.className = 'speed-reader-anchor';",
            "speedReaderEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.speedReader.aria'));",
        ] {
            assert_contains(&html, expected);
        }

    for expected in [
        r#":root[data-speed-reader="true"] .document-body a,"#,
        "color: inherit;",
        "text-decoration: none;",
        r#":root[data-speed-reader="true"] .document-body a:hover,"#,
        "color: var(--markdown-link-hover);",
        r#":root[data-speed-reader="true"] .document-body .speed-reader-anchor"#,
        "font-weight: 700;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_disables_minimap_without_leaving_empty_layout_column() {
    let html = app_shell_html();

    for expected in [
            "if (!window.leafMinimap.getEnabled()) {\n    return '';\n  }",
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            "app.innerHTML = `<div class=\"${layoutClass}\">${state.document.html}${minimapHtml}</div>`;",
        ] {
            assert_contains(&html, expected);
        }

    let css = reading_mode_css();
    assert_contains(css, ".reader-layout-no-minimap {");
    assert_contains(css, "grid-template-columns: minmax(0, 1fr);");
    assert_contains(css, "justify-items: center;");
    assert!(!css.contains("grid-template-columns: minmax(0, var(--document-measure)) 136px;"));
}

#[test]
fn app_shell_labels_minimap_setting_and_hides_decorative_marks_from_accessibility() {
    let html = app_shell_html();

    for expected in [
            r#"<label class="setting-control setting-control-inline" for="minimapEnabled">"#,
            r#"<input type="checkbox" id="minimapEnabled" aria-label="Show document minimap" aria-describedby="minimapEnabledHelp">"#,
            r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
            "minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));",
            "aria-label=\"${escapeAttr(window.leafLocale.t('minimap.aria'))}\"",
            "document-minimap-track\" aria-hidden=\"true\"",
            "document-minimap-content\" aria-hidden=\"true\"",
            "document-minimap-viewport\" aria-hidden=\"true\"",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("document-minimap-track\" tabindex"),
        "minimap track should not enter the tab order"
    );
    assert!(
        !html.contains("document-minimap\" tabindex"),
        "minimap aside should not enter the tab order"
    );
}

#[test]
fn app_shell_reacts_to_minimap_and_theme_settings() {
    let html = app_shell_html();

    let minimap_subscription_position = html
        .find("window.leafMinimap.subscribe((enabled) => {")
        .expect("app shell subscribes to minimap changes");
    let minimap_render_position = html
        .find("minimapEnabledControl.checked = enabled;\n  renderState();")
        .expect("minimap subscription rerenders document state");

    assert!(
        minimap_subscription_position < minimap_render_position,
        "minimap visibility should remain a WebView setting"
    );
    assert_contains(&html, "window.leafTheme.subscribe((theme) => {");
    assert_contains(&html, "window.leafTheme.setMode(btn.dataset.mode)");
    assert_contains(&html, "window.leafTheme.setFamily(btn.dataset.family)");
}

#[test]
fn reading_mode_css_keeps_markdown_and_code_ready_for_theme_tokens() {
    let css = reading_mode_css();

    for rule in [
        ".document-body code {",
        "background: var(--markdown-inline-code-background);",
        "color: var(--markdown-inline-code-foreground);",
        ".document-body pre {",
        "background: var(--code-block-background);",
        "color: var(--code-block-foreground);",
        ".document-body pre code {",
        "background: transparent;",
        "color: inherit;",
        ".document-body .syn-comment",
        "color: var(--syntax-comment);",
        ".document-body .syn-keyword",
        "color: var(--syntax-keyword);",
        ".document-body .syn-string",
        "color: var(--syntax-string);",
        ".document-body .syn-numeric",
        "color: var(--syntax-number);",
        ".document-body .syn-function",
        "color: var(--syntax-function);",
        ".document-body .syn-type",
        "color: var(--syntax-type);",
        ".document-body .syn-variable",
        "color: var(--syntax-variable);",
        ".document-body .syn-punctuation",
        "color: var(--syntax-punctuation);",
        ".document-body .syn-inserted",
        "background: var(--syntax-inserted-bg);",
        "color: var(--syntax-inserted);",
        ".document-body .syn-deleted",
        "background: var(--syntax-deleted-bg);",
        "color: var(--syntax-deleted);",
        ".document-body .syn-changed",
        "background: var(--syntax-changed-bg);",
        "color: var(--syntax-changed);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn code_view_colours_markdown_and_xml_delimiters() {
    // The code editor colours each construct's delimiter too, via a
    // punctuation.definition.* rule at higher specificity than the generic
    // .code-view .syn-punctuation, so `#`/`[]()`/`**`/backticks/`>` aren't grey.
    let css = reading_mode_css();

    for selector in [
        ".code-view .syn-punctuation.syn-definition.syn-heading",
        ".code-view .syn-punctuation.syn-definition.syn-bold",
        ".code-view .syn-punctuation.syn-definition.syn-italic",
        ".code-view .syn-punctuation.syn-definition.syn-raw",
        ".code-view .syn-punctuation.syn-definition.syn-link",
        ".code-view .syn-punctuation.syn-definition.syn-metadata",
        ".code-view .syn-punctuation.syn-definition.syn-blockquote",
        ".code-view .syn-entity.syn-attribute-name",
    ] {
        assert_contains(css, selector);
    }
}

#[test]
fn reading_mode_css_keeps_code_surfaces_readable_in_light_and_dark() {
    let css = reading_mode_css();

    for theme in [ResolvedTheme::Light, ResolvedTheme::Dark] {
        for foreground in [
            "--syntax-foreground",
            "--syntax-comment",
            "--syntax-keyword",
            "--syntax-string",
            "--syntax-number",
            "--syntax-function",
            "--syntax-variable",
            "--syntax-type",
            "--syntax-operator",
            "--syntax-punctuation",
            "--markdown-code-foreground",
        ] {
            let background = if foreground == "--markdown-code-foreground" {
                "--markdown-code-background"
            } else {
                "--syntax-background"
            };
            assert_contrast_at_least(css, theme, foreground, background, 4.5);
        }

        assert_contrast_at_least(css, theme, "--syntax-foreground", "--selection", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-inserted", "--syntax-inserted-bg", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-deleted", "--syntax-deleted-bg", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-changed", "--syntax-changed-bg", 4.5);
    }
}

#[test]
fn app_shell_theme_bootstrap_supports_system_light_dark_modes() {
    let html = app_shell_html();

    assert_contains(&html, r#"<meta name="color-scheme" content="light dark">"#);
    // Injected from the registry, so it can't drift from the registered sources.
    assert_contains(
        &html,
        &format!(
            "const VALID_FAMILIES = new Set({});",
            theme_family_ids_json()
        ),
    );
    assert_eq!(
        theme_family_ids_json(),
        r#"["amaranth","arabica","fern","ginger","github","goldenrod","halcyon","nightshade","pippin","sage"]"#
    );
    assert_contains(
        &html,
        "const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);",
    );
    // Seeded from the host-injected global, not localStorage (non-durable here).
    assert_contains(
        &html,
        "let familyPreference = normalizePreference(settings.themeFamily);",
    );
    assert_contains(
        &html,
        "let family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;",
    );
    assert_contains(&html, "let mode = normalizeMode(settings.themeMode);");
    // The Random preference draws a non-repeating family per launch, persisting
    // the bag through the host so the cycle survives restarts.
    assert_contains(&html, "const REAL_FAMILIES = Array.from(VALID_FAMILIES);");
    assert_contains(&html, "const RANDOM = 'random';");
    assert_contains(&html, "const drawRandomFamily = () => {");
    assert_contains(
        &html,
        "window.ipc.postMessage(JSON.stringify({ command: 'setThemeRandomBag', used: randomBag }));",
    );
    // The Leaf-owned attributes that drive the compiled theme CSS.
    assert_contains(&html, "root.dataset.leafTheme = family;");
    assert_contains(&html, "root.dataset.leafAppearance = theme.resolvedTheme;");
    assert_contains(&html, "root.dataset.themeMode = mode");
    // The dead Primer color-mode attributes are gone from the bootstrap.
    assert!(!html.contains("root.dataset.colorMode"));
    assert!(!html.contains("root.dataset.resolvedColorMode"));
    assert_contains(&html, "root.dataset.themeFamily = family;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme");
    assert_contains(&html, "getMode: () => mode");
    assert_contains(&html, "getFamily: () => familyPreference");
    assert_contains(&html, "getResolvedTheme: resolvedTheme");
    assert_contains(&html, "mode = normalizeMode(nextMode);");
    assert_contains(&html, "familyPreference = normalizePreference(nextFamily);");
    // Daylight flips light/dark by the local clock, on a rescheduling timer.
    assert_contains(
        &html,
        "if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';",
    );
    assert_contains(&html, "const scheduleDaylight = () => {");
    assert_contains(&html, "subscribe(listener)");
    assert_contains(&html, "listeners.forEach((listener) => listener(theme))");
    assert_contains(
        &html,
        "media.addEventListener('change', onSystemThemeChange)",
    );
    assert_contains(&html, "media.addListener(onSystemThemeChange)");
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert_contains(&html, "settings.theme.");
    assert!(!html.contains("themeVariant"));
    assert!(!html.contains("customTheme"));
    assert!(!html.contains("leafThemeSource"));
    assert!(!html.contains("getLightTheme"));
    assert!(!html.contains("getDarkTheme"));
}

#[test]
fn app_shell_groups_settings_menu_with_accessible_descriptions() {
    let html = app_shell_html();

    assert_contains(
        &html,
        r#"<details class="settings-menu" id="settingsMenu">"#,
    );
    assert_contains(
        &html,
        r#"<summary id="settingsSummary" class="icon-button" data-i18n-aria-label="settings.heading" data-i18n-title="settings.heading" aria-label="Settings" title="Settings">"#,
    );
    assert_contains(
        &html,
        r#"<path d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
    );
    assert_contains(
        &html,
        r#"<div class="settings-panel" role="group" aria-labelledby="settingsSummary">"#,
    );
    // Theme lives in a bottom sheet opened from a single settings row.
    assert_contains(
        &html,
        r#"<button type="button" class="setting-theme-open" id="themeSheetOpen" aria-haspopup="dialog">"#,
    );
    assert_contains(
        &html,
        r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
    );
    assert_contains(
        &html,
        "const settingsMenu = document.getElementById('settingsMenu');",
    );
    assert_contains(&html, "if (event.key === 'Escape')");
    assert_contains(&html, "settingsMenu.querySelector('summary').focus();");
    assert_contains(
        &html,
        "if (settingsMenu.open && !settingsMenu.contains(event.target))",
    );
    assert_contains(&html, r#"id="themeSheet""#);
    assert_contains(&html, r#"data-i18n="settings.theme.sheet.title""#);
    assert!(!html.contains("localeModeHelp"));
    assert!(!html.contains(r#"for="localeMode""#));
}

#[test]
fn app_shell_keeps_settings_menu_keyboard_and_pointer_polish() {
    let html = app_shell_html();

    for expected in [
        "settingsMenu.addEventListener('keydown', (event) => {",
        "if (event.key === 'Escape') {",
        "settingsMenu.open = false;",
        "settingsMenu.querySelector('summary').focus();",
        "document.addEventListener('click', (event) => {",
        "if (settingsMenu.open && !settingsMenu.contains(event.target)) {",
        "minimapEnabledControl.addEventListener('change'",
    ] {
        assert_contains(&html, expected);
    }

    let css = reading_mode_css();

    for expected in [
        ".settings-menu summary::-webkit-details-marker",
        ".settings-panel {",
        ".setting-control-inline",
        ".setting-control-inline input",
        "input:focus-visible",
        "right: 0;",
        "width: min(290px, calc(100vw - 28px));",
        "summary:focus-visible",
        ".icon-button {",
        "place-items: center;",
        "min-width: 32px;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_theme_bootstrap_resolves_manual_and_system_modes() {
    let html = app_shell_html();

    assert_contains(&html, "if (mode === 'light') return 'light';");
    assert_contains(&html, "if (mode === 'dark') return 'dark';");
    assert_contains(
        &html,
        "if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';",
    );
    assert_contains(&html, "return media && media.matches ? 'dark' : 'light';");
    assert_contains(&html, "setMode(nextMode) {");
    assert_contains(&html, "setFamily(nextFamily) {");
    assert_contains(
        &html,
        "const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };",
    );
    assert_contains(&html, "root.dataset.themeMode = mode;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme;");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme;");
}

#[test]
fn app_shell_theme_bootstrap_seeds_from_host_injected_settings() {
    let html = app_shell_html();

    for expected in [
        "const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);",
        "const settings = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};",
        "let familyPreference = normalizePreference(settings.themeFamily);",
        "let mode = normalizeMode(settings.themeMode);",
        "mode = normalizeMode(nextMode);",
        "familyPreference = normalizePreference(nextFamily);",
        "listeners.forEach((listener) => listener(theme));",
    ] {
        assert_contains(&html, expected);
    }

    // The theme path no longer touches localStorage; the host owns persistence
    // via setThemeMode / setThemeFamily. (The locale bootstrap keeps its own
    // storage, so we check theme-specific markers.)
    assert!(!html.contains("leaf.themeMode"));
    assert!(!html.contains("modeStorage"));
    assert!(html.contains("send({ command: 'setThemeMode', mode: btn.dataset.mode });"));
    assert!(html.contains("send({ command: 'setThemeFamily', family: btn.dataset.family });"));
}

#[test]
fn changed_image_files_refresh_without_a_document_re_render() {
    // Only real image files take the refresh path; a changed .md is a document
    // reload, and a stray file is neither.
    assert!(is_local_image_path(Path::new("imgs/themes/sage.png")));
    assert!(is_local_image_path(Path::new("/tmp/Diagram.SVG")));
    assert!(!is_local_image_path(Path::new("themes/sage.md")));
    assert!(!is_local_image_path(Path::new("notes.txt")));
    assert!(!is_local_image_path(Path::new("imgs/themes")));

    // The host asks the page to re-fetch, rather than re-rendering: the document
    // text is unchanged, so a reload would hash-gate itself out anyway.
    assert_eq!(image_refresh_script(), "window.leafRefreshImages();");

    let html = app_shell_html();
    for expected in [
        "window.leafRefreshImages = () => {",
        "localImageEpoch += 1;",
        "const stamped = `${base}?leaf-epoch=${localImageEpoch}`;",
        "if (img.getAttribute('src') !== stamped) img.setAttribute('src', stamped);",
        // Every render stamps a fresh epoch, so reopening a document after an
        // image was replaced on disk cannot show the cached copy.
        "    stampLocalImages();\n    decorateBlockquoteLines();",
    ] {
        assert_contains(&html, expected);
    }
    // Only images served by the host's protocol are touched; remote and data URLs
    // keep the src the document gave them.
    assert_contains(
        &html,
        "const LOCAL_IMAGE_SRC_PREFIXES = ['leaf-image://', 'http://leaf-image.', 'https://leaf-image.'];",
    );

    // The cache-busting query is inert on the way back in: the protocol handler
    // resolves the path from the URL's segments and ignores the query.
    let source_dir = fixture_source_path("images");
    let path = local_image_protocol_path(
        &format!("{}?leaf-epoch=7", local_img("diagram.png")),
        &source_dir,
    )
    .expect("stamped local image url resolves");
    assert_eq!(path, source_dir.join("diagram.png"));
}

#[test]
fn theme_mode_always_resolves_from_system_preference() {
    assert_eq!(ThemeMode::parse("system"), Some(ThemeMode::System));
    assert_eq!(ThemeMode::parse("light"), None);
    assert_eq!(ThemeMode::parse("dark"), None);
    assert_eq!(ThemeMode::parse("night"), None);
    assert_eq!(ThemeMode::parse_or_system(Some("dark")), ThemeMode::System);
    assert_eq!(
        ThemeMode::parse_or_system(Some("not-a-theme")),
        ThemeMode::System
    );
    assert_eq!(ThemeMode::parse_or_system(None), ThemeMode::System);
    assert_eq!(ThemeMode::System.storage_value(), "system");
    assert_eq!(ThemeMode::System.resolve(false), ResolvedTheme::Light);
    assert_eq!(ThemeMode::System.resolve(true), ResolvedTheme::Dark);
}

#[test]
fn locale_modes_resolve_and_fallback_safely() {
    assert_eq!(LocaleMode::parse("system"), Some(LocaleMode::System));
    assert_eq!(LocaleMode::parse("en"), Some(LocaleMode::En));
    assert_eq!(LocaleMode::parse("zh-CN"), Some(LocaleMode::ZhCn));
    assert_eq!(LocaleMode::parse("zh-cn"), None);
    assert_eq!(LocaleMode::parse_or_system(Some("en")), LocaleMode::En);
    assert_eq!(
        LocaleMode::parse_or_system(Some("not-a-locale")),
        LocaleMode::System
    );
    assert_eq!(LocaleMode::parse_or_system(None), LocaleMode::System);
    assert_eq!(LocaleMode::System.storage_value(), "system");
    assert_eq!(LocaleMode::En.storage_value(), "en");
    assert_eq!(LocaleMode::ZhCn.storage_value(), "zh-CN");
    assert_eq!(
        LocaleMode::System.resolve(Some("zh-Hans")),
        ResolvedLocale::ZhCn
    );
    assert_eq!(
        LocaleMode::System.resolve(Some("zhHans")),
        ResolvedLocale::ZhCn
    );
    assert_eq!(
        LocaleMode::System.resolve(Some("zh-TW")),
        ResolvedLocale::ZhCn
    );
    assert_eq!(
        LocaleMode::System.resolve(Some("en-US")),
        ResolvedLocale::En
    );
    assert_eq!(LocaleMode::System.resolve(None).lang(), "en");
}

#[test]
fn app_shell_locale_persistence_adapter_normalizes_state_transitions() {
    let html = app_shell_html();

    for expected in [
            "const STORAGE_KEY = 'leaf.localeMode';",
            "const MODE_FALLBACK = 'system';",
            "const createModeStorage = (storageKey) => ({",
            "const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);",
            "const storage = createModeStorage(STORAGE_KEY);\n  let mode = normalizeMode(storage.read());",
            "mode = normalizeMode(nextMode);\n      storage.write(mode);\n      apply();",
            "window.addEventListener('languagechange', () => {",
            "if (mode === 'system') {\n      apply();\n    }",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_exposes_locale_settings_translations_and_ime_guard() {
    let html = app_shell_html();

    assert_contains(&html, "leaf.localeMode");
    assert_contains(&html, "VALID_MODES = new Set(['system', 'en', 'zh-CN'])");
    assert_contains(&html, "root.lang = locale.resolvedLocale");
    assert_contains(&html, "root.dataset.localeMode = locale.mode");
    assert_contains(&html, "root.dataset.locale = locale.resolvedLocale");
    assert_contains(&html, "let mode = normalizeMode(storage.read());");
    assert_contains(&html, "mode = normalizeMode(nextMode);");
    assert_contains(&html, "const TRANSLATIONS = {");
    assert_contains(&html, "'actions.open': 'Open'");
    assert_contains(&html, "'actions.close': 'Close file'");
    assert_contains(&html, "'actions.open': '打开'");
    assert_contains(&html, "'actions.close': '关闭文件'");
    assert_contains(&html, "'settings.heading': 'Settings'");
    assert_contains(&html, "'settings.heading': '设置'");
    assert_contains(&html, "'settings.theme.label': 'Theme'");
    assert_contains(&html, "'settings.theme.system': 'System'");
    assert_contains(&html, "'settings.theme.light': 'Light'");
    assert_contains(&html, "'settings.theme.dark': 'Dark'");
    assert_contains(
        &html,
        "'errors.openFailed': 'Failed to open {path}: {reason}'",
    );
    assert_contains(&html, "'errors.openFailed': '无法打开 {path}：{reason}'");
    assert_contains(&html, "TRANSLATIONS.en[key] || key");
    assert_contains(&html, "Object.prototype.hasOwnProperty.call(values, name)");
    assert_contains(&html, "new Intl.NumberFormat(resolveLocale(), options)");
    assert_contains(&html, "new Intl.DateTimeFormat(resolveLocale(), options)");
    assert_contains(
        &html,
        "new Intl.RelativeTimeFormat(resolveLocale(), options)",
    );
    assert_contains(&html, "formatFileSize(bytes)");
    assert_contains(&html, "window.addEventListener('compositionstart'");
    assert_contains(&html, "window.addEventListener('compositionupdate'");
    assert_contains(&html, "window.addEventListener('compositionend'");
    assert_contains(&html, "if (event.isComposing || composing)");
    assert_contains(&html, "renderState();");
    assert_contains(&html, "state.document.html");
}

#[test]
fn app_shell_initializes_reader_state_before_locale_subscription_renders() {
    let html = app_shell_html();
    let state_position = html
        .find("let currentState = { recent: [], tabs: [], active: null, document: null };")
        .expect("app shell declares reader state");
    let locale_subscription_position = html
        .find("window.leafLocale.subscribe(() => {")
        .expect("app shell subscribes to locale changes");

    assert!(
        state_position < locale_subscription_position,
        "locale subscription renders immediately, so reader state must exist first"
    );
}

#[test]
fn app_shell_locale_bootstrap_keeps_initial_text_nonblank() {
    let html = app_shell_html();

    let subscription_position = html
        .find("window.leafLocale.subscribe(() => {")
        .expect("app shell subscribes to locale changes");
    let static_text_position = html
        .find("  renderStaticText();")
        .expect("locale subscription refreshes static text");
    // Anchor to the renderState() right after renderStaticText(), since other
    // renderState() calls appear elsewhere.
    let state_render_position = html[static_text_position..]
        .find("  renderState();")
        .map(|offset| static_text_position + offset)
        .expect("locale subscription renders reader state");
    let initial_state_position = html
        .find("window.leafSetState(window.__leafInitialState || { recent: [], document: null });")
        .expect("app shell renders the initial empty state");

    assert!(
        subscription_position < static_text_position
            && static_text_position < state_render_position
            && state_render_position < initial_state_position,
        "locale bootstrap must refresh shell copy before the initial empty state render"
    );

    for expected in [
            "'actions.open': 'Open'",
            "'actions.chooseFile': 'Choose file'",
            "'actions.close': 'Close file'",
            "'empty.description': 'Open any Markdown file for a calm, focused read. Turn over a new leaf.'",
            "'empty.kicker': 'Leaf Text'",
            "'empty.title': 'Readable XML and Markdown'",
            "'empty.noRecent': 'Recent files will appear here after you open a document.'",
            "'settings.heading': 'Settings'",
            "TRANSLATIONS.en[key] || key",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_routes_fragment_links_through_reader_anchor_scrolling() {
    let html = app_shell_html();

    assert_contains(&html, "window.leafScrollToFragment = (fragment) => {");
    assert_contains(
        &html,
        "const target = document.getElementById(decoded) || document.getElementById(raw);",
    );
    assert_contains(&html, "target.focus({ preventScroll: true });");
    assert_contains(&html, "function sameDocumentFragmentHref(rawHref) {");
    assert_contains(&html, "if (rawHref.startsWith('#')) {");
    assert_contains(&html, "if (rawHref.startsWith('./#')) {");
    assert_contains(&html, "return rawHref.slice(2);");
    assert_contains(&html, "if (rawHref.startsWith('.#')) {");
    assert_contains(&html, "return rawHref.slice(1);");
    assert_contains(
        &html,
        "const fragmentHref = sameDocumentFragmentHref(rawHref);",
    );
    assert_contains(&html, "if (fragmentHref) {");
    assert_contains(&html, "event.preventDefault();");
    assert_contains(
        &html,
        "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
    );
    assert_contains(
            &html,
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
    assert!(
            html.contains("if (fragmentHref) {")
                && html.contains("send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });")
                && html.contains("send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });"),
            "fragment-only links must be sent through app navigation before non-fragment links are routed"
        );
}

#[test]
fn app_shell_preserves_external_link_routing_for_native_opening() {
    let html = app_shell_html();

    assert_contains(
            &html,
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
    assert!(
        !html.contains(
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor() });"
        ),
        "external and local non-fragment links need the resolved href for native routing"
    );
}

#[test]
fn app_shell_routes_in_page_history_through_app_navigation() {
    let html = app_shell_html();

    for expected in [
        "function sendNavigationCommand(command) {",
        "send({ command, scroll_anchor: currentScrollAnchor() });",
        "backButton.disabled = !navigationState.canGoBack;",
        "forwardButton.disabled = !navigationState.canGoForward;",
        "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
    ] {
        assert_contains(&html, expected);
    }

    for removed in [
        "let inPageHistory = { back: [], forward: [] };",
        "window.history.back();",
        "window.history.forward();",
        "window.history.pushState(null, '', fragmentHref);",
        "window.addEventListener('popstate', handleInPageHistoryTraversal);",
    ] {
        assert!(
                !html.contains(removed),
                "in-page navigation must be handled by app history instead of browser history: {removed}"
            );
    }
}

#[test]
fn renders_gfm_tables_strikethrough_task_lists_and_autolinks() {
    let markdown = r#"| Left | Center | Right |
| :--- | :----: | ----: |
| a | b | c |

~~struck~~

- [ ] unchecked
- [x] checked lower
- [X] checked upper

Visit https://example.com/path?q=1 and www.example.org or email leaf@example.com.

Already linked [https://example.net](https://example.net) stays one link.
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, "<table>");
    assert_contains(&rendered.html, "<th>Left</th>");
    assert_contains(&rendered.html, "<th>Center</th>");
    assert_contains(&rendered.html, "<th>Right</th>");
    assert!(!rendered.html.contains("style="));
    assert_contains(&rendered.html, "<del>struck</del>");
    assert_contains(&rendered.html, r#"<input disabled="" type="checkbox">"#);
    assert_contains(&rendered.html, "unchecked</li>");
    assert_contains(
        &rendered.html,
        r#"<input disabled="" type="checkbox" checked="">"#,
    );
    assert_contains(&rendered.html, "checked lower</li>");
    assert_contains(&rendered.html, "checked upper</li>");
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com/path?q=1" rel="noopener noreferrer">https://example.com/path?q=1</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a href="http://www.example.org" rel="noopener noreferrer">www.example.org</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a href="mailto:leaf@example.com" rel="noopener noreferrer">leaf@example.com</a>"#,
    );
    assert_eq!(rendered.html.matches("https://example.net").count(), 2);
}

#[test]
fn renders_task_markers_inside_table_cells_as_checkboxes() {
    let markdown = r#"| Recipe | Learned | Notes |
| --- | --- | --- |
| Apple Fritters | [ ] | keep [ ] as text |
| Apple Oatmeal | [x] | checked lower |
| Beef Stew | [X] | checked upper |
| Broth | `[ ]` | code marker |
"#;

    let rendered = render_markdown_document(markdown, "recipes.md");

    assert_contains(&rendered.html, r#"<td><input disabled="" type="checkbox">"#);
    assert_contains(
        &rendered.html,
        r#"<td><input disabled="" type="checkbox" checked="">"#,
    );
    assert_eq!(
        rendered
            .html
            .matches(r#"<input disabled="" type="checkbox" checked="">"#)
            .count(),
        2
    );
    assert_contains(&rendered.html, "<td>keep [ ] as text</td>");
    assert_contains(&rendered.html, "<td><code>[ ]</code></td>");
}

// --- Source-anchored editing foundation (Markdown + XML) -------------------

#[test]
fn task_marker_offsets_map_only_list_markers_in_document_order() {
    let markdown = "\
- [ ] first
- [x] second
  - [X] nested
- plain item

| task | note |
| --- | --- |
| [ ] | table cell not a marker |
";
    let offsets = task_marker_offsets(markdown);
    assert_eq!(offsets.len(), 3);
    let bytes = markdown.as_bytes();
    assert_eq!(bytes[offsets[0]], b' ');
    assert_eq!(bytes[offsets[1]], b'x');
    assert_eq!(bytes[offsets[2]], b'X');
    assert!(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
}

#[test]
fn toggle_task_flips_the_addressed_marker_and_tracks_dirty() {
    let markdown = "- [ ] one\n- [x] two\n";
    let mut edit = EditableDocument::new(PathBuf::from("todo.md"), markdown.to_string());
    assert!(!edit.is_dirty());

    assert!(edit.toggle_task(0));
    assert_eq!(edit.text(), "- [x] one\n- [x] two\n");
    assert!(edit.is_dirty());

    assert!(!edit.toggle_task(1)); // already dirty; state unchanged
    assert_eq!(edit.text(), "- [x] one\n- [ ] two\n");

    assert!(!edit.toggle_task(0));
    assert_eq!(edit.text(), "- [ ] one\n- [ ] two\n");
    assert!(edit.is_dirty());

    assert!(edit.toggle_task(1)); // back to the saved baseline
    assert_eq!(edit.text(), markdown);
    assert!(!edit.is_dirty());

    assert!(!edit.toggle_task(9)); // out of range is a no-op
    assert_eq!(edit.text(), markdown);
}

#[test]
fn toggle_task_is_a_noop_for_xml_documents() {
    let mut edit = EditableDocument::new(PathBuf::from("doc.xml"), "<p>[ ]</p>".to_string());
    assert!(!edit.toggle_task(0));
    assert_eq!(edit.text(), "<p>[ ]</p>");
}

#[test]
fn checkbox_edits_flip_the_marker_but_record_no_undo() {
    // The auto-saving checkbox path flips the same byte as toggle_task, but leaves
    // nothing on the undo stack — a checkbox toggle is deliberately not undoable.
    let markdown = "- [ ] one\n- [ ] two\n";
    let mut edit = EditableDocument::new(PathBuf::from("todo.md"), markdown.to_string());

    assert!(edit.toggle_task_without_undo(0));
    assert_eq!(edit.text(), "- [x] one\n- [ ] two\n");
    assert!(!edit.can_undo());

    edit.replace_range_without_undo(0, 5, "- [x]");
    assert_eq!(edit.text(), "- [x] one\n- [ ] two\n");
    assert!(!edit.can_undo());
}

#[test]
fn replace_range_splices_and_clamps_safely() {
    let mut edit = EditableDocument::new(PathBuf::from("a.md"), "hello world".to_string());
    assert!(edit.replace_range(6, 11, "there"));
    assert_eq!(edit.text(), "hello there");

    // Out-of-range end is clamped to the buffer length.
    edit.replace_range(6, 9999, "friend");
    assert_eq!(edit.text(), "hello friend");

    // A start past end is treated as an insertion at start.
    let mut edit2 = EditableDocument::new(PathBuf::from("b.md"), "abc".to_string());
    edit2.replace_range(1, 0, "X");
    assert_eq!(edit2.text(), "aXbc");

    // A range that falls inside a multi-byte char snaps outward, never panics.
    let mut edit3 = EditableDocument::new(PathBuf::from("c.md"), "café".to_string());
    edit3.replace_range(3, 4, "e"); // 'é' is two bytes (3..5)
    assert_eq!(edit3.text(), "cafe");
}

#[test]
fn undo_reverts_reading_view_edits_newest_first() {
    let markdown = "# Title\n\nBody.\n\n- [ ] task\n";
    let mut edit = EditableDocument::new(PathBuf::from("doc.md"), markdown.to_string());
    assert!(!edit.can_undo());

    // An identity splice changes nothing and records no undo point.
    edit.replace_range(0, 7, "# Title");
    assert!(!edit.can_undo());

    edit.replace_range(0, 7, "# Renamed");
    edit.toggle_task(0);
    assert!(edit.text().contains("# Renamed"));
    assert!(edit.text().contains("[x]"));
    assert!(edit.can_undo());

    // Undo steps back newest-first: the toggle, then the splice.
    assert!(edit.undo());
    assert!(edit.text().contains("[ ]"));
    assert!(edit.text().contains("# Renamed"));
    assert!(edit.undo());
    assert_eq!(edit.text(), markdown);
    assert!(!edit.is_dirty());

    // Nothing left to undo.
    assert!(!edit.undo());
    assert!(!edit.can_undo());
}

#[test]
fn markdown_block_map_marks_paragraphs_and_headings_editable() {
    let markdown = "# Title\n\nA paragraph.\n\n- a list item\n\n```\ncode\n```\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|s| s.kind).collect();
    assert_eq!(kinds, vec!["heading", "paragraph", "list", "code_block"]);
    for span in &spans {
        let expected = matches!(span.kind, "heading" | "paragraph");
        assert_eq!(span.editable, expected, "kind {}", span.kind);
        // Every range slices back to real source.
        assert!(markdown.get(span.start..span.end).is_some());
    }
    // The heading range slices to the heading source.
    let heading = &spans[0];
    assert_eq!(&markdown[heading.start..heading.end], "# Title");
}

#[test]
fn opened_markdown_document_carries_editing_maps() {
    let markdown = "# Title\n\nBody with a [ ] not a task.\n\n- [ ] real task\n";
    let document = opened_document_from_markdown(markdown, "todo.md");
    assert_eq!(document.format, DocumentFormat::Markdown);
    // The raw source travels too, so blocks that don't round-trip WYSIWYG (lists,
    // tables, code) can be edited as their exact Markdown source.
    assert_eq!(document.source, markdown);
    assert_eq!(document.tasks, task_marker_offsets(markdown));
    assert_eq!(document.tasks.len(), 1);
    assert!(document
        .blocks
        .iter()
        .any(|b| b.kind == "heading" && b.editable));
}

#[test]
fn tei_block_map_anchors_paragraphs_and_headings_to_xml_ranges() {
    let xml = r#"<TEI><teiHeader><fileDesc><titleStmt>
        <title type="mainTitle" xml:lang="en">The Work</title>
        </titleStmt></fileDesc></teiHeader>
        <text><body>
        <div type="section"><head>A Section</head>
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
        </div>
        </body></text></TEI>"#;

    let spans = xml_block_source_map(xml);
    // One heading (the section head) and two paragraphs, all editable.
    assert!(spans.iter().any(|s| s.kind == "heading" && s.editable));
    assert_eq!(spans.iter().filter(|s| s.kind == "paragraph").count(), 2);
    // Ranges point at the real XML source for those nodes.
    for span in &spans {
        let slice = &xml[span.start..span.end];
        if span.kind == "paragraph" {
            assert!(
                slice.starts_with("<p>") && slice.ends_with("</p>"),
                "{slice}"
            );
        } else {
            assert!(
                slice.starts_with("<head>") && slice.ends_with("</head>"),
                "{slice}"
            );
        }
    }
}

#[test]
fn opened_tei_document_stamps_inline_ranges_and_carries_source() {
    let xml = r#"<TEI><teiHeader><fileDesc><titleStmt>
        <title type="mainTitle" xml:lang="en">The Work</title>
        </titleStmt></fileDesc></teiHeader>
        <text><body>
        <div type="section"><head>A Section</head>
        <p>First paragraph.</p>
        </div>
        </body></text></TEI>"#;

    let document = opened_document_from_xml(xml, "doc.xml");
    assert_eq!(document.format, DocumentFormat::Xml);
    assert_eq!(document.source, xml); // XML edits its exact source
                                      // The rendered HTML carries inline source ranges the reader edits against.
    assert_contains(&document.html, "data-src-start=");
    assert_contains(&document.html, "data-editable=\"true\"");
    assert_contains(&document.html, "data-block-kind=\"paragraph\"");
    // And the block map agrees with what was stamped.
    assert!(!document.blocks.is_empty());
}

#[test]
fn renders_github_issue_pull_request_and_commit_references_with_context() {
    let markdown = "Fixes #123, GH-456, ryanallen/leaf#789, and a1b2c3d.";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaftext/issues/123" rel="noopener noreferrer">#123</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaftext/issues/456" rel="noopener noreferrer">GH-456</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a class="github-ref issue-ref" href="https://github.com/ryanallen/leaf/issues/789" rel="noopener noreferrer">ryanallen/leaf#789</a>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<a class="github-ref commit-ref" href="https://github.com/ryanallen/leaftext/commit/a1b2c3d" rel="noopener noreferrer"><code>a1b2c3d</code></a>"#,
    );
}

#[test]
fn preserves_repository_scoped_references_without_context() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-no-git-{unique}"));
    fs::create_dir_all(&dir).expect("test directory is created");

    let rendered = render_markdown_document("#1 GH-2 a1b2c3d", dir.join("README.md"));
    fs::remove_dir_all(&dir).expect("test directory is removed");

    assert_contains(&rendered.html, "<p>#1 GH-2 a1b2c3d</p>");
    assert!(!rendered.html.contains("github-ref"));
    assert!(!rendered.html.contains("commit-ref"));
}

#[test]
fn renders_mentions_and_supported_emoji_shortcodes() {
    let markdown = "Thanks @octocat and @github/docs for :shipit: while :unknown: stays.";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<span class="github-mention">@octocat</span>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<span class="github-mention">@github/docs</span>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<span class="emoji" title=":shipit:" aria-label=":shipit:">🚢</span>"#,
    );
    assert_contains(&rendered.html, ":unknown: stays");
}

#[test]
fn renders_footnotes_with_backlinks() {
    let markdown = "Footnote here.[^one]\n\n[^one]: Backlinked note.";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r##"<sup class="footnote-reference" id="fnref-one"><a href="#one" rel="noopener noreferrer">1</a></sup>"##,
    );
    assert_contains(
        &rendered.html,
        r#"<div class="footnote-definition" id="one">"#,
    );
    assert_contains(
        &rendered.html,
        r##"<a class="footnote-backref" href="#fnref-one" aria-label="Back to content" rel="noopener noreferrer"><svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"##,
    );
    assert_contains(
        &rendered.html,
        r#"<path d="M9.3,15.1l-6-6M3.3,9.1l6-6M3.3,9.1h12c3.3,0,6,2.7,6,6s-2.7,6-6,6h-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>"#,
    );
    assert!(
        !rendered.html.contains(r#">↩</a>"#),
        "footnote backlinks should render the provided SVG icon instead of the text fallback"
    );
    assert_contains(&rendered.html, "Backlinked note.");
}

#[test]
fn footnote_definitions_collect_at_the_end_in_reference_order() {
    // Definitions sit mid-document with a section after them, and the notes
    // are referenced in the opposite order to how they are defined.
    let markdown = "First reference.[^second]\n\nSecond reference.[^first]\n\n\
             [^first]: Defined first.\n[^second]: Defined second.\n\n## Later\n\nTrailing prose.";

    let rendered = render_markdown_document(markdown, "README.md");
    let html = &rendered.html;

    let trailing = html
        .find("Trailing prose.")
        .expect("trailing prose rendered");
    let second_def = html
        .find(r#"<div class="footnote-definition" id="second">"#)
        .expect("second footnote definition rendered");
    let first_def = html
        .find(r#"<div class="footnote-definition" id="first">"#)
        .expect("first footnote definition rendered");

    // Both definitions are hoisted below the later section, not left where
    // they were written in the source.
    assert!(
        trailing < second_def && trailing < first_def,
        "footnote definitions should collect after the rest of the document"
    );
    // Ordered by first reference: [^second] is referenced before [^first].
    assert!(
        second_def < first_def,
        "footnote definitions should be ordered by first reference"
    );

    // Reference numbers follow the same first-referenced-first order.
    assert_contains(
        html,
        r##"<sup class="footnote-reference" id="fnref-second"><a href="#second" rel="noopener noreferrer">1</a></sup>"##,
    );
    assert_contains(
        html,
        r##"<sup class="footnote-reference" id="fnref-first"><a href="#first" rel="noopener noreferrer">2</a></sup>"##,
    );
}

#[test]
fn renders_github_alert_callouts() {
    let markdown = r#"> [!NOTE]
> Useful context.

> [!TIP]
> Try this.

> [!IMPORTANT]
> Required.

> [!WARNING]
> Risky.

> [!CAUTION]
> Dangerous.
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    for class_name in [
        "markdown-alert-note",
        "markdown-alert-tip",
        "markdown-alert-important",
        "markdown-alert-warning",
        "markdown-alert-caution",
    ] {
        assert_contains(
            &rendered.html,
            &format!(r#"<blockquote class="{class_name}">"#),
        );
    }
}

#[test]
fn renders_mermaid_and_math_with_readable_fallback_markup() {
    let markdown = r#"```mermaid
graph TD
    A --> B
```

Inline $a^2 + b^2 = c^2$.

$$
\int_0^1 x dx
$$
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="mermaid" data-language="mermaid">graph TD"#,
    );
    assert_contains(
        &rendered.html,
        r#"<span class="math math-inline">a^2 + b^2 = c^2</span>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<span class="math math-display">\int_0^1 x dx</span>"#,
    );
}

#[test]
fn renders_mermaid_xychart_frontmatter_for_webview_runtime() {
    let markdown = r#"```mermaid
---
config:
  xyChart:
    width: 700
    height: 500
    xAxis:
      labelPadding: 20
    yAxis:
      labelPadding: 40
    themeVariables:
      xyChart:
        backgroundColor: transparent
---
xychart-beta
  title "Component Adoption %"
  x-axis ["portal-ui", "contractor", "auth-ui", "acwa-ui", "ramp-ui"]
  y-axis "Adoption %" 0 --> 100
  bar [100, 93.1, 73.9, 48.8, 20.0]
```"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="mermaid" data-language="mermaid">xychart-beta"#,
    );
    assert_contains(&rendered.html, "xychart-beta");
    assert_contains(&rendered.html, r#"title "Component Adoption %""#);
    assert_contains(&rendered.html, "0 --&gt; 100");
    assert!(!rendered.html.contains("---\nconfig:"));
    assert!(!rendered
        .html
        .contains(r#"<pre class="highlight" data-language="mermaid""#));
}

#[test]
fn renders_mermaid_block_beta_after_init_directive_for_webview_runtime() {
    let markdown = r##"```mermaid
%%{init: {theme: "base"}}%%
block-beta
  columns 3
  block:legend:1
    rows 2
    lg["🟩 Core Health"]
  end
  aw2["App Worker"]
  style aw2 fill:#34a853,color:#fff
```"##;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        r#"<pre class="mermaid" data-language="mermaid">%%{init: {theme: "base"}}%%"#,
    );
    assert_contains(&rendered.html, "block-beta");
    assert_contains(&rendered.html, "block:legend:1");
    assert_contains(&rendered.html, "lg[\"🟩 Core Health\"]");
    assert_contains(&rendered.html, "style aw2 fill:#34a853,color:#fff");
    assert!(!rendered
        .html
        .contains(r#"<pre class="highlight" data-language="mermaid""#));
    assert!(!rendered.html.contains("language-mermaid"));
}

#[test]
fn strips_disallowed_raw_html_tags_and_attributes() {
    let markdown = r#"<details open onclick="alert(1)">
<summary>Deploy notes</summary>
<p style="color:red"><a href="javascript:alert(2)" onclick="bad()">bad</a> <a href="https://example.com" title="Example" target="_blank">good</a></p>
<span class="badge" title="dropped title">Span text</span>
</details>"#;

    let rendered = render_markdown_document(markdown, "README.md");

    // `<details>`/`<summary>` are allowed and boolean `open` is kept (normalized
    // to `open=""`), but the dangerous attributes go.
    assert_contains(&rendered.html, r#"<details open="">"#);
    assert_contains(&rendered.html, "<summary>Deploy notes</summary>");
    assert!(!rendered.html.contains("onclick"));
    assert!(!rendered.html.contains("target="));
    assert!(!rendered.html.contains("style="));
    assert!(!rendered.html.contains("badge"));
    assert!(!rendered.html.contains("javascript:"));
    assert_contains(&rendered.html, r#"<a rel="noopener noreferrer">bad</a>"#);
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" title="Example" rel="noopener noreferrer">good</a>"#,
    );
    assert_contains(&rendered.html, "<span>Span text</span>");
}

#[test]
fn renders_allowed_raw_markdown_html_tags_and_safe_attributes() {
    let markdown = r#"<div align="center">
<img src="images/logo.png" alt="Leaf logo" title="Logo" width="96">
<h1>Leaf</h1>
<p><span>A calm <strong>Markdown</strong> reader.</span></p>
<p><a href="https://example.com">Website</a><br>Local docs below.</p>
<hr>
<ul><li>One</li></ul>
<ol><li>Two</li></ol>
<pre><code>raw code</code></pre>
<table>
<thead><tr><th colspan="2" style="text-align:center">Head</th></tr></thead>
<tbody><tr><td colspan="2" data-extra="no">Cell</td></tr></tbody>
</table>
</div>

## Features

Markdown still works around raw HTML with **emphasis** and [relative links](docs/index.html).

| Item | Status |
| --- | --- |
| HTML | supported |

> Blockquotes continue to render.
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(&rendered.html, r#"<div align="center">"#);
    assert_contains(
        &rendered.html,
        r#"<img src="images/logo.png" alt="Leaf logo" title="Logo">"#,
    );
    assert_contains(
        &rendered.html,
        "<span>A calm <strong>Markdown</strong> reader.</span>",
    );
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" rel="noopener noreferrer">Website</a><br>Local docs below."#,
    );
    assert_contains(&rendered.html, "<hr>");
    assert_contains(&rendered.html, "<ul><li>One</li></ul>");
    assert_contains(&rendered.html, "<ol><li>Two</li></ol>");
    assert_contains(&rendered.html, "<pre><code>raw code</code></pre>");
    assert_contains(&rendered.html, r#"<th colspan="2">Head</th>"#);
    assert_contains(&rendered.html, r#"<td colspan="2">Cell</td>"#);
    assert_contains(&rendered.html, r#"<h2 id="features">Features</h2>"#);
    assert_contains(&rendered.html, "<strong>emphasis</strong>");
    assert_contains(
        &rendered.html,
        r#"<a href="docs/index.html" rel="noopener noreferrer">relative links</a>"#,
    );
    assert_contains(&rendered.html, "<table>");
    assert_contains(&rendered.html, "<blockquote>");
    assert!(!rendered.html.contains("width="));
    assert!(!rendered.html.contains("style="));
    assert!(!rendered.html.contains("data-extra"));
}

#[test]
fn renders_collapsible_and_safe_inline_raw_html() {
    let markdown = r#"<details open>
<summary>Click to expand</summary>

Hidden content with a <kbd>Ctrl</kbd> key.

</details>

Water is H<sub>2</sub>O and 2<sup>10</sup> = 1024. Some <mark>highlight</mark>,
<ins>inserted</ins>, <s>struck</s>, and an <abbr title="HyperText">HTML</abbr> note.

<dl><dt>Term</dt><dd>Definition</dd></dl>

<figure><figcaption>A caption</figcaption></figure>
"#;

    let rendered = render_markdown_document(markdown, "README.md");

    for needle in [
        r#"<details open="">"#,
        "<summary>Click to expand</summary>",
        "<kbd>Ctrl</kbd>",
        "H<sub>2</sub>O",
        "2<sup>10</sup>",
        "<mark>highlight</mark>",
        "<ins>inserted</ins>",
        "<s>struck</s>",
        r#"<abbr title="HyperText">HTML</abbr>"#,
        "<dl><dt>Term</dt><dd>Definition</dd></dl>",
        "<figure><figcaption>A caption</figcaption></figure>",
    ] {
        assert_contains(&rendered.html, needle);
    }
}

#[test]
fn preserves_safe_raw_html_alignment_in_markdown_headings() {
    let markdown = r##"# <div align="center">Words of My Perfect Teacher</div>
<div align="center">A Complete Translation of a Classic Introduction to Tibetan Buddhism</div>
<div align="RIGHT" onclick="bad()">by <a href="#patrul-rinpoche">Patrul Rinpoche</a></div>
<div align="expression(alert(1))">not aligned</div>"##;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_eq!(rendered.title, "Words of My Perfect Teacher");
    assert_contains(
        &rendered.html,
        r#"<div align="center">Words of My Perfect Teacher</div>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<div align="center">A Complete Translation of a Classic Introduction to Tibetan Buddhism</div>"#,
    );
    assert_contains(
        &rendered.html,
        r##"<div align="right">by <a href="#patrul-rinpoche" rel="noopener noreferrer">Patrul Rinpoche</a></div>"##,
    );
    assert_contains(&rendered.html, "<div>not aligned</div>");
    assert!(!rendered.html.contains("onclick"));
    assert!(!rendered.html.contains("expression(alert(1))"));
}

#[test]
fn resolves_relative_media_against_source_file_directory() {
    let markdown = "![Leaf logo](assets/logo.svg)";
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(&rendered.html, &expected_base_href(&source_path));
    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Leaf logo""#),
    );
}

#[test]
fn renders_markdown_links_and_images_for_native_link_handling() {
    let markdown = r#"[External](https://example.com)
[Sibling](./other.md#install)
[Parent](../README.md)
[Escaped](./Nested%20Guide.md#heading)
[Text file](./notes/readme.txt)
[Reference][reference]
<https://example.org/autolink>
<leaf@example.com>

![Relative image](./images/example.svg "Example SVG")

<a href="./raw doc.md#html-heading" title="Raw doc">Raw HTML doc</a>
<img src="./raw image.png" alt="Raw image" title="Raw">

[reference]: ./refs/reference.md#target
"#;
    let source_path = fixture_source_path("project/nested/current.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(&rendered.html, &expected_base_href(&source_path));
    for expected in [
        r#"<a href="https://example.com" rel="noopener noreferrer">External</a>"#,
        r##"<a href="./other.md#install" rel="noopener noreferrer">Sibling</a>"##,
        r#"<a href="../README.md" rel="noopener noreferrer">Parent</a>"#,
        r##"<a href="./Nested%20Guide.md#heading" rel="noopener noreferrer">Escaped</a>"##,
        r#"<a href="./notes/readme.txt" rel="noopener noreferrer">Text file</a>"#,
        r##"<a href="./refs/reference.md#target" rel="noopener noreferrer">Reference</a>"##,
        r#"<a href="https://example.org/autolink" rel="noopener noreferrer">https://example.org/autolink</a>"#,
        r#"<a href="mailto:leaf@example.com" rel="noopener noreferrer">leaf@example.com</a>"#,
        r##"<a href="./raw doc.md#html-heading" title="Raw doc" rel="noopener noreferrer">Raw HTML doc</a>"##,
    ] {
        assert_contains(&rendered.html, expected);
    }
    assert_contains(
        &rendered.html,
        &expected_img(
            "images/example.svg",
            r#"alt="Relative image" title="Example SVG""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img("raw%20image.png", r#"alt="Raw image" title="Raw""#),
    );
    assert!(!rendered.html.contains(r#"<a href="./images/example.svg""#));
}

#[test]
fn renders_leaf_button_link_custom_markdown() {
    let markdown = "go {{{[Filled](https://example.com)}}} now\n\nsee {{[Outline](https://example.com)}} here\n\ntry {[Ghost](https://example.com)} out\n\nA plain [link](https://example.com) is untouched.\n\nBracket wrappers are prose: [[Bracketed](https://example.com)] stays a link.\n\nA lopsided {{[Lopsided](https://example.com)} wrapper stays literal too.\n\nInline `{[x](y)}` stays literal.\n";
    let source_path = fixture_source_path("project/current.md");

    let rendered = render_markdown_document(markdown, &source_path);

    // Brace depth picks the variant: one ghost, two outline, three filled.
    assert_contains(&rendered.html, r#"class="leaf-md-button""#);
    assert_contains(
        &rendered.html,
        r#"class="leaf-md-button leaf-md-button--secondary""#,
    );
    assert_contains(
        &rendered.html,
        r#"class="leaf-md-button leaf-md-button--ghost""#,
    );
    assert_contains(&rendered.html, ">Filled</a>");
    assert_contains(&rendered.html, ">Outline</a>");
    assert_contains(&rendered.html, ">Ghost</a>");
    assert_contains(&rendered.html, r#"href="https://example.com""#);
    // The literal braces are consumed, not left around the anchor, and the
    // surrounding prose survives.
    assert!(!rendered.html.contains("go {"));
    assert!(!rendered.html.contains("see {"));
    assert!(!rendered.html.contains("try {"));
    assert!(!rendered.html.contains("</a>}}} now"));
    assert!(!rendered.html.contains("</a>}} here"));
    assert!(!rendered.html.contains("</a>} out"));
    assert_contains(&rendered.html, "go <a");
    assert_contains(&rendered.html, "</a> now");
    assert_contains(&rendered.html, "see <a");
    assert_contains(&rendered.html, "</a> here");
    assert_contains(&rendered.html, "try <a");
    assert_contains(&rendered.html, "</a> out");
    // A plain link stays a plain link (no button class).
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com" rel="noopener noreferrer">link</a>"#,
    );
    // Brackets are link syntax, never a button wrapper: the old `[[…]()]` form now
    // renders as what it literally is.
    assert_contains(&rendered.html, ">Bracketed</a>]");
    assert!(!rendered.html.contains(">Bracketed</a></a>"));
    // An unbalanced wrapper is prose, and keeps both of its braces.
    assert_contains(&rendered.html, "{{<a");
    assert_contains(&rendered.html, "</a>} wrapper");
    // The same syntax inside inline code is left untouched (no Link event there).
    assert_contains(&rendered.html, "<code>{[x](y)}</code>");

    // Buttons sitting side by side share one Text event between them, so each
    // one's trailing braces are the next one's opening run.
    let row = render_markdown_document(
        "{[G](https://example.com)} {{[O](https://example.com)}} {{{[F](https://example.com)}}}\n",
        &source_path,
    );
    assert_contains(&row.html, r#"class="leaf-md-button leaf-md-button--ghost""#);
    assert_contains(
        &row.html,
        r#"class="leaf-md-button leaf-md-button--secondary""#,
    );
    assert_contains(&row.html, r#"class="leaf-md-button" href"#);
    assert!(!row.html.contains('{'));
    assert!(!row.html.contains('}'));
}

#[test]
fn renders_heading_ids_and_preserves_markdown_and_html_fragment_links() {
    let markdown = r##"# Main Title

## Section

[Section](#section)
[Relative section](./#section)
[File section](file.md#section)
[Nested escaped section](../guides/Nested%20Guide.md#space-section)
[Space path](./raw%20doc.md#html-heading)
[External](https://example.com/path#outside)

<a href="#section">HTML section</a>
<a href="./#section">HTML relative section</a>
<a href="file.md#section" title="HTML file section">HTML file section</a>
<a href="https://example.com">HTML external</a>

## Section
"##;
    let source_path = fixture_source_path("project/nested/current.md");

    let rendered = render_markdown_document(markdown, &source_path);

    for expected in [
        r#"<h1 id="main-title">Main Title</h1>"#,
        r#"<h2 id="section">Section</h2>"#,
        r#"<h2 id="section-1">Section</h2>"#,
        r##"<a href="#section" rel="noopener noreferrer">Section</a>"##,
        r##"<a href="./#section" rel="noopener noreferrer">Relative section</a>"##,
        r##"<a href="file.md#section" rel="noopener noreferrer">File section</a>"##,
        r##"<a href="../guides/Nested%20Guide.md#space-section" rel="noopener noreferrer">Nested escaped section</a>"##,
        r##"<a href="./raw%20doc.md#html-heading" rel="noopener noreferrer">Space path</a>"##,
        r##"<a href="https://example.com/path#outside" rel="noopener noreferrer">External</a>"##,
        r##"<a href="#section" rel="noopener noreferrer">HTML section</a>"##,
        r##"<a href="./#section" rel="noopener noreferrer">HTML relative section</a>"##,
        r##"<a href="file.md#section" title="HTML file section" rel="noopener noreferrer">HTML file section</a>"##,
        r#"<a href="https://example.com" rel="noopener noreferrer">HTML external</a>"#,
    ] {
        assert_contains(&rendered.html, expected);
    }
}

#[test]
fn preserves_markdown_image_alt_and_title_after_url_resolution() {
    let markdown = r#"![Leaf logo](images/logo.svg "Leaf logo title")"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img(
            "images/logo.svg",
            r#"alt="Leaf logo" title="Leaf logo title""#,
        ),
    );
}

#[test]
fn renders_linked_github_badges_as_images() {
    let markdown = r#"[![Checkup](https://github.com/ryanallen/grid/actions/workflows/checkup.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/checkup.yml)
[![Tests](https://github.com/ryanallen/grid/actions/workflows/tests.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)
[![Lint](https://github.com/ryanallen/grid/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/ryanallen/grid/actions/workflows/lint.yml)
[![QEMU Smoke](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml/badge.svg)](https://github.com/ryanallen/grid/actions/workflows/qemu-smoke.yml)
[![Shields Tests](https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests)](https://github.com/ryanallen/grid/actions/workflows/tests.yml)"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    for (label, workflow, badge_url) in [
            (
                "Checkup",
                "checkup.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/checkup.yml?label=Checkup",
            ),
            (
                "Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
            (
                "Lint",
                "lint.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/lint.yml?label=Lint",
            ),
            (
                "QEMU Smoke",
                "qemu-smoke.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/qemu-smoke.yml?label=QEMU+Smoke",
            ),
            (
                "Shields Tests",
                "tests.yml",
                "https://img.shields.io/github/actions/workflow/status/ryanallen/grid/tests.yml?label=Tests",
            ),
        ] {
            assert_contains(
                &rendered.html,
                &format!(
                    r#"<a href="https://github.com/ryanallen/grid/actions/workflows/{workflow}" rel="noopener noreferrer"><img src="{badge_url}" alt="{label}" title="{label}"></a>"#
                ),
            );
        }

    assert!(!rendered
        .html
        .contains(r#"/actions/workflows/checkup.yml/badge.svg"#));
}

#[test]
fn keeps_safe_absolute_markdown_image_urls() {
    let source_path = fixture_source_path("project/README.md");
    let local_image_path = absolute_path_destination_for_fixture("project/assets/logo.svg");
    let local_file_url = file_url_for_fixture("project/assets/logo.svg");
    let markdown = format!(
        r#"![Remote](https://example.com/assets/logo.svg)
![Local]({local_file_url})
![Absolute path]({local_image_path})"#
    );

    let rendered = render_markdown_document(&markdown, &source_path);

    assert_contains(
        &rendered.html,
        r#"<img src="https://example.com/assets/logo.svg" alt="Remote" title="Remote">"#,
    );
    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Local" title="Local""#),
    );
    assert_contains(
        &rendered.html,
        &expected_img(
            "assets/logo.svg",
            r#"alt="Absolute path" title="Absolute path""#,
        ),
    );
}

#[test]
fn sanitizes_unsafe_markdown_image_urls() {
    let markdown = r#"![Script](javascript:alert(1))
![Data](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)
![Vbscript](vbscript:msgbox(1))"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert!(!rendered.html.contains("javascript:"));
    assert!(!rendered.html.contains("data:"));
    assert!(!rendered.html.contains("vbscript:"));
    assert_contains(&rendered.html, r#"<img alt="Script" title="Script">"#);
    assert_contains(&rendered.html, r#"<img alt="Data" title="Data">"#);
    assert_contains(&rendered.html, r#"<img alt="Vbscript" title="Vbscript">"#);
}

#[test]
fn resolves_safe_raw_html_image_sources_against_source_directory() {
    let markdown = r#"<p align="center">
<img src="images/logo.png" alt="Leaf logo" title="Leaf" width="96">
<img src=assets/badge.svg alt="Local badge">
</p>"#;
    let source_path = fixture_source_path("project/README.md");

    let rendered = render_markdown_document(markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img("images/logo.png", r#"alt="Leaf logo" title="Leaf""#),
    );
    assert_contains(
        &rendered.html,
        &expected_img("assets/badge.svg", r#"alt="Local badge""#),
    );
}

#[test]
fn preserves_safe_raw_html_image_assets_after_sanitization() {
    let source_path = fixture_source_path("project/README.md");
    let local_file_url = file_url_for_fixture("project/assets/logo.svg");
    let markdown = format!(r#"<img src="{local_file_url}" alt="Leaf logo" title="Logo">"#);

    let rendered = render_markdown_document(&markdown, &source_path);

    assert_contains(
        &rendered.html,
        &expected_img("assets/logo.svg", r#"alt="Leaf logo" title="Logo""#),
    );
}

#[test]
fn local_image_protocol_serves_rendered_markdown_image_bytes() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-local-image-{unique}"));
    let image_dir = dir.join("nested");
    let markdown_path = dir.join("README.md");
    let image_path = image_dir.join("space image.png");
    let png = tiny_png_bytes();

    fs::create_dir_all(&image_dir).expect("test image directory is created");
    fs::write(&image_path, png).expect("test png is written");

    assert_eq!(
        resolve_image_destination("nested/space%20image.png", &markdown_path),
        Some(local_img("nested/space%20image.png"))
    );
    let rendered = render_markdown_document(
        "![Space image](nested/space%20image.png \"Local\")",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let response =
        local_image_protocol_response(&local_img("nested/space%20image.png"), Some(&source_dir));

    fs::remove_dir_all(&dir).expect("test image directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img(
            "nested/space%20image.png",
            r#"alt="Space image" title="Local""#,
        ),
    );
    assert_eq!(response.status, 200);
    assert_eq!(response.content_type, "image/png");
    assert_eq!(response.body, png);
}

#[test]
fn local_image_protocol_serves_raw_html_svg_bytes() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-local-svg-{unique}"));
    let markdown_path = dir.join("README.md");
    let svg_path = dir.join("logo.svg");
    let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="green"/></svg>"#;

    fs::create_dir_all(&dir).expect("test svg directory is created");
    fs::write(&svg_path, svg).expect("test svg is written");

    let rendered = render_markdown_document(r#"<img src="logo.svg" alt="Logo">"#, &markdown_path);
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let response = local_image_protocol_response(&local_img("logo.svg"), Some(&source_dir));

    fs::remove_dir_all(&dir).expect("test svg directory is removed");

    assert_contains(&rendered.html, &expected_img("logo.svg", r#"alt="Logo""#));
    assert_eq!(response.status, 200);
    assert_eq!(response.content_type, "image/svg+xml");
    assert_eq!(response.body, svg);
}

#[test]
fn local_image_protocol_serves_requested_markdown_and_html_image_paths() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-requested-images-{unique}"));
    let docs = root.join("docs");
    let images = docs.join("imgs");
    let shared = root.join("shared");
    let markdown_path = docs.join("current.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(&images).expect("test image directory is created");
    fs::create_dir_all(&shared).expect("test shared directory is created");
    fs::write(images.join("pic.png"), png).expect("test png is written");
    fs::write(images.join("pic one.png"), png).expect("test spaced png is written");
    fs::write(shared.join("pic.png"), png).expect("test parent png is written");

    let markdown = r#"![alt](imgs/pic.png)
![alt](./imgs/pic.png)
![alt](../shared/pic.png)
![alt](imgs/pic%20one.png)
<img src="imgs/pic.png" alt="alt">
<img src="./imgs/pic.png">
![Remote](https://example.com/pic.png)"#;
    let rendered = render_markdown_document(markdown, &markdown_path);
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

    for expected in [
        expected_img("imgs/pic.png", r#"alt="alt" title="alt""#),
        expected_img("__leaf_parent__/shared/pic.png", r#"alt="alt" title="alt""#),
        expected_img("imgs/pic%20one.png", r#"alt="alt" title="alt""#),
    ] {
        assert_contains(&rendered.html, &expected);
    }
    assert_contains(
        &rendered.html,
        &format!(r#"<img src="{}">"#, local_img("imgs/pic.png")),
    );
    assert_contains(
        &rendered.html,
        r#"<img src="https://example.com/pic.png" alt="Remote" title="Remote">"#,
    );

    for path in [
        "imgs/pic.png",
        "imgs/pic%20one.png",
        "__leaf_parent__/shared/pic.png",
    ] {
        let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
        assert_eq!(response.status, 200, "expected {path} to load");
        assert_eq!(response.content_type, "image/png");
        assert_eq!(response.body, png);
    }

    fs::remove_dir_all(&root).expect("test image tree is removed");
}

#[test]
fn local_image_protocol_serves_nested_document_image_paths() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-nested-images-{unique}"));
    let nested = root.join("docs").join("nested");
    let nested_images = nested.join("imgs");
    let shared = root.join("docs").join("shared");
    let markdown_path = nested.join("current.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(&nested_images).expect("test nested image directory is created");
    fs::create_dir_all(&shared).expect("test shared image directory is created");
    fs::write(nested_images.join("pic.png"), png).expect("nested png is written");
    fs::write(shared.join("pic.png"), png).expect("shared png is written");

    let rendered = render_markdown_document(
        "![Nested](imgs/pic.png)\n![Shared](../shared/pic.png)",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");

    assert_contains(
        &rendered.html,
        &expected_img("imgs/pic.png", r#"alt="Nested" title="Nested""#),
    );
    assert_contains(
        &rendered.html,
        &expected_img(
            "__leaf_parent__/shared/pic.png",
            r#"alt="Shared" title="Shared""#,
        ),
    );

    for path in ["imgs/pic.png", "__leaf_parent__/shared/pic.png"] {
        let response = local_image_protocol_response(&local_img(path), Some(&source_dir));
        assert_eq!(response.status, 200, "expected nested {path} to load");
        assert_eq!(response.body, png);
    }

    fs::remove_dir_all(&root).expect("test nested image tree is removed");
}

#[test]
fn local_image_protocol_loads_any_depth_above_the_document_and_reports_missing_images() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-local-image-scope-{unique}"));
    let nested = root.join("docs").join("01-features");
    let markdown_path = nested.join("themes.md");
    let png = tiny_png_bytes();

    fs::create_dir_all(root.join("imgs")).expect("test image directory is created");
    fs::create_dir_all(&nested).expect("test docs directory is created");
    fs::write(root.join("imgs").join("pic.png"), png).expect("test image is written");

    // Two levels up, as the shipped docs reference their screenshots.
    let rendered = render_markdown_document(
        "![Up two](../../imgs/pic.png)\n![Missing](missing.png)",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let missing = local_image_protocol_response(&local_img("missing.png"), Some(&source_dir));
    let up_two = local_image_protocol_response(
        &local_img("__leaf_parent__/__leaf_parent__/imgs/pic.png"),
        Some(&source_dir),
    );

    fs::remove_dir_all(&root).expect("test docs directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img(
            "__leaf_parent__/__leaf_parent__/imgs/pic.png",
            r#"alt="Up two" title="Up two""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img("missing.png", r#"alt="Missing" title="Missing""#),
    );
    assert_eq!(missing.status, 404);
    assert_eq!(up_two.status, 200, "an image two levels up must load");
    assert_eq!(up_two.body, png);
}

#[test]
fn local_image_protocol_loads_absolute_paths_outside_the_document_tree() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-local-image-absolute-{unique}"));
    let docs = root.join("docs");
    let elsewhere = root.join("elsewhere");
    let markdown_path = docs.join("README.md");
    let image_path = elsewhere.join("pic.png");
    let png = tiny_png_bytes();

    fs::create_dir_all(&docs).expect("test docs directory is created");
    fs::create_dir_all(&elsewhere).expect("test image directory is created");
    fs::write(&image_path, png).expect("test image is written");

    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let url = resolve_image_destination(&image_path.to_string_lossy(), &markdown_path)
        .expect("an absolute path outside the document tree resolves to a URL");
    let response = local_image_protocol_response(&url, Some(&source_dir));

    fs::remove_dir_all(&root).expect("test directories are removed");

    assert!(
        url.contains("__leaf_absolute__"),
        "expected an absolute-path URL, got {url}"
    );
    assert_eq!(response.status, 200, "an absolute path must load");
    assert_eq!(response.body, png);
}

#[test]
fn strips_unsafe_raw_html_behavior_and_urls() {
    let markdown = r#"<script>alert('x')</script>
<style>body { color: red; }</style>
<img src="javascript:alert(1)" onerror="alert(2)" alt="bad">
<a href="javascript:alert(3)" onclick="alert(4)">bad link</a>
<p onmouseover="alert(5)">kept <script>alert(6)</script><style>.bad { color: red; }</style> text</p>
<iframe src="https://example.com"></iframe>"#;

    let rendered = render_markdown_document(markdown, "README.md");

    assert!(!rendered.html.contains("<script"));
    assert!(!rendered.html.contains("<style"));
    assert!(!rendered.html.contains("alert('x')"));
    assert!(!rendered.html.contains("alert(6)"));
    assert!(!rendered.html.contains("color: red"));
    assert!(!rendered.html.contains(".bad"));
    assert!(!rendered.html.contains("javascript:"));
    assert!(!rendered.html.contains("onerror"));
    assert!(!rendered.html.contains("onclick"));
    assert!(!rendered.html.contains("onmouseover"));
    assert!(!rendered.html.contains("<iframe"));
    assert_contains(&rendered.html, r#"<img alt="bad">"#);
    assert_contains(
        &rendered.html,
        "<a rel=\"noopener noreferrer\">bad link</a>",
    );
    assert_contains(&rendered.html, "<p>kept  text</p>");
}

#[test]
fn loading_document_preserves_source_markdown() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-preserve-{unique}.md"));
    let markdown = "# Preserve\n\n- [x] source state\n\n<script>remove()</script>\n";

    fs::write(&path, markdown).expect("test markdown is written");
    let document = load_document(&path).expect("test markdown loads");
    let preserved = fs::read_to_string(&path).expect("test markdown remains readable");
    fs::remove_file(&path).expect("test markdown is removed");

    assert_eq!(document.title, "Preserve");
    assert_contains(&document.html, "source state");
    assert!(!document.html.contains("<script"));
    assert_eq!(preserved, markdown);
}

#[test]
fn opening_document_records_recent_file_and_persists_it() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-open-document-{unique}"));
    let document_path = dir.join("Guide.md");
    let config_path = dir.join("settings").join("recent-files.json");
    fs::create_dir_all(&dir).expect("test directory is created");
    fs::write(&document_path, "# Guide\n\nReadable.").expect("test markdown is written");

    let mut recent = RecentFiles::default();
    let result = open_document_with_recent(&document_path, &mut recent, Some(&config_path))
        .expect("document opens");

    assert_eq!(result.document.title, "Guide");
    assert!(result.recent_save_error.is_none());
    assert_eq!(recent.files, vec![document_path.clone()]);
    assert_eq!(load_recent_files(&config_path).files, vec![document_path]);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn opening_missing_document_returns_typed_error_without_changing_recent_files() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("leaf-missing-document-{unique}.md"));
    let mut recent = RecentFiles {
        files: vec![PathBuf::from("already-open.md")],
    };

    let error =
        open_document_with_recent(&path, &mut recent, None).expect_err("missing file fails");

    assert_eq!(error.path(), path.as_path());
    assert_eq!(error.reason().kind(), io::ErrorKind::NotFound);
    assert_eq!(recent.files, vec![PathBuf::from("already-open.md")]);
}

#[test]
fn forget_removes_a_recent_entry_and_reports_whether_it_was_present() {
    let mut recent = RecentFiles {
        files: vec![PathBuf::from("kept.md"), PathBuf::from("gone.md")],
    };

    assert!(recent.forget(Path::new("gone.md")));
    assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
    // Forgetting something already absent is a no-op and reports false.
    assert!(!recent.forget(Path::new("gone.md")));
    assert_eq!(recent.files, vec![PathBuf::from("kept.md")]);
}

#[test]
fn recent_file_save_error_is_returned_without_blocking_open_document() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-recent-save-error-{unique}"));
    let document_path = dir.join("Release.md");
    fs::create_dir_all(&dir).expect("test directory is created");
    fs::write(&document_path, "# Release\n\nStill opens.").expect("test markdown is written");

    let mut recent = RecentFiles::default();
    let result = open_document_with_recent(&document_path, &mut recent, Some(&dir))
        .expect("document open succeeds when recent save fails");
    let save_error = result
        .recent_save_error
        .expect("recent save error is reported");

    assert_eq!(result.document.title, "Release");
    assert_eq!(recent.files, vec![document_path]);
    assert_eq!(save_error.config_path, dir);

    fs::remove_dir_all(save_error.config_path).expect("test directory is removed");
}

#[test]
fn recent_record_collapses_equivalent_path_spellings() {
    let mut recent = RecentFiles::default();

    // `app/README.md` and `app/.tmp/../README.md` resolve to the same file.
    let clean = Path::new("app").join("README.md");
    let messy = Path::new("app").join(".tmp").join("..").join("README.md");
    recent.record(clean.clone());
    recent.record(messy);

    // Both spellings resolve to the same file, so only one entry remains.
    assert_eq!(recent.files, vec![clean]);
}

#[test]
fn normalize_entries_collapses_existing_duplicate_spellings_on_load() {
    let app_readme = Path::new("app").join("README.md");
    let dharma_readme = Path::new("dharma").join("README.md");
    let mut recent = RecentFiles {
        files: vec![
            Path::new("app").join(".tmp").join("..").join("README.md"),
            dharma_readme.clone(),
            app_readme.clone(),
        ],
    };

    recent.normalize_entries();

    // The two spellings of app/README.md collapse, keeping first-seen order.
    assert_eq!(recent.files, vec![app_readme, dharma_readme]);
}

#[test]
fn recent_files_are_deduplicated_and_limited() {
    let mut recent = RecentFiles::default();

    for index in 0..10 {
        recent.record(PathBuf::from(format!("file-{index}.md")));
    }
    recent.record(PathBuf::from("file-5.md"));

    assert_eq!(recent.files.first(), Some(&PathBuf::from("file-5.md")));
    assert_eq!(recent.files.len(), MAX_RECENT_FILES);
    assert_eq!(
        recent
            .files
            .iter()
            .filter(|path| path.as_os_str() == "file-5.md")
            .count(),
        1
    );
}

#[test]
fn recent_files_persistence_round_trips_and_falls_back_safely() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-recent-persistence-{unique}"));
    let config_path = dir.join("settings").join("recent-files.json");
    let missing_path = dir.join("missing.json");

    let mut recent = RecentFiles::default();
    recent.record(PathBuf::from("first.md"));
    recent.record(PathBuf::from("second.md"));

    save_recent_files(&config_path, &recent).expect("recent files save");
    assert_eq!(load_recent_files(&config_path), recent);
    assert_eq!(load_recent_files(&missing_path), RecentFiles::default());

    fs::write(&config_path, "{not json").expect("corrupt recent files fixture is written");
    assert_eq!(load_recent_files(&config_path), RecentFiles::default());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_default_keeps_minimap_on_and_indexing_off() {
    let settings = Settings::default();
    assert!(settings.minimap_enabled);
    assert!(!settings.indexing_enabled);
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

#[test]
fn settings_persistence_round_trips_and_falls_back_safely() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-persistence-{unique}"));
    let settings_path = dir.join("config").join("settings.json");
    let missing_path = dir.join("missing.json");

    let settings = Settings {
        indexing_enabled: true,
        minimap_enabled: false,
        pager_enabled: false,
        speed_reader_enabled: true,
        line_numbers_enabled: false,
        reader_editing_enabled: false,
        theme_family: "nightshade".to_string(),
        theme_mode: "dark".to_string(),
        theme_random_used: vec!["fern".to_string(), "github".to_string()],
        library_view: LibraryView::Graph,
        graph_scope: GraphScope::Large,
        library_project_path: "C:\\Users\\rwall".to_string(),
        library_closed: true,
        library_width: 312,
        window_width: 1440,
        window_height: 960,
        window_maximized: true,
        auto_update_enabled: false,
        update_last_checked: 1_780_000_000,
        update_staged_version: "0.1.400".to_string(),
    };

    save_settings(&settings_path, &settings).expect("settings save");
    assert_eq!(load_settings(&settings_path), settings);
    // A missing file restores defaults, not the all-false zero value.
    assert_eq!(load_settings(&missing_path), Settings::default());

    fs::write(&settings_path, "{not json").expect("corrupt settings fixture is written");
    assert_eq!(load_settings(&settings_path), Settings::default());

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_load_migrates_legacy_dracula_mode_to_the_nightshade_family() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-migrate-{unique}"));
    let settings_path = dir.join("settings.json");
    fs::create_dir_all(&dir).expect("test directory is created");

    // Pre-family installs stored Dracula as a theme mode; it becomes the dark
    // half of the Nightshade family (the renamed Dracula palette) on load.
    fs::write(&settings_path, r#"{"theme_mode": "dracula"}"#)
        .expect("legacy settings fixture is written");
    let loaded = load_settings(&settings_path);
    assert_eq!(loaded.theme_family, "nightshade");
    assert_eq!(loaded.theme_mode, "dark");

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_load_tolerates_partial_json_via_serde_default() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-partial-{unique}"));
    let settings_path = dir.join("settings.json");
    fs::create_dir_all(&dir).expect("test directory is created");

    // Only one field present: the rest must fall back to their defaults.
    fs::write(&settings_path, r#"{"indexing_enabled": true}"#)
        .expect("partial settings fixture is written");
    let loaded = load_settings(&settings_path);
    assert!(loaded.indexing_enabled);
    assert!(loaded.minimap_enabled);
    assert_eq!(loaded.theme_mode, "system");
    assert_eq!(loaded.library_view, LibraryView::Project);
    assert!(!loaded.library_closed);
    assert_eq!(loaded.library_width, 240);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn settings_load_migrates_the_retired_tree_and_flat_views_to_project() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-settings-library-view-{unique}"));
    fs::create_dir_all(&dir).expect("test directory is created");

    // Both retired views load as Project. The alias matters because an unknown
    // enum value would fail the whole deserialize and reset every other setting.
    for legacy in ["tree", "flat"] {
        let settings_path = dir.join(format!("{legacy}.json"));
        fs::write(
            &settings_path,
            format!(r#"{{"library_view": "{legacy}", "minimap_enabled": false}}"#),
        )
        .expect("legacy library view fixture is written");
        let loaded = load_settings(&settings_path);
        assert_eq!(loaded.library_view, LibraryView::Project);
        assert!(!loaded.minimap_enabled);
    }

    // The frontend's own strings round-trip, and the retired names resolve too.
    assert_eq!(
        LibraryView::from_client("project"),
        Some(LibraryView::Project)
    );
    assert_eq!(LibraryView::from_client("graph"), Some(LibraryView::Graph));
    assert_eq!(LibraryView::from_client("tree"), Some(LibraryView::Project));
    assert_eq!(LibraryView::from_client("flat"), Some(LibraryView::Project));
    assert_eq!(LibraryView::from_client("nope"), None);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn app_shell_wires_library_pane_open_close_and_resize() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Markup: the resize divider on the pane edge and the library toggle button,
    // which lives in the app bar's lead (an .icon-button), left of Back.
    assert!(html.contains(r#"<div id="libraryDivider" class="library-divider" data-i18n-title="library.divider.resize" title="Resize library""#));
    assert!(html.contains(r#"<button type="button" id="libraryOpen" class="icon-button library-open" data-i18n-title="library.open" data-i18n-aria-label="library.open""#));

    // The toggle icon is the bundled asset, normalized to currentColor like the
    // other toolbar icons (no stray literal stroke color survives).
    let open_icon = normalize_svg_icon_colors(OPEN_LIBRARY_ICON_SVG);
    assert!(open_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(open_icon.trim()));

    // CSS: the collapsed-grid override and the divider hit target.
    assert!(css.contains(
        ".library-shell.library-closed {\n  grid-template-columns: 0 minmax(0, 1fr) var(--reader-gutter);\n}"
    ));
    assert!(css.contains(".library-divider {"));
    assert!(css.contains("cursor: col-resize;"));
    assert!(css.contains(".library-open:hover {"));

    // Behavior constants and the host-persisted layout report.
    assert!(html.contains("const SNAP_SHUT = 40;"));
    assert!(html.contains("const DEFAULT_PANE_WIDTH = 240;"));
    assert!(html.contains("const MIN_READER_WIDTH = 360;"));
    assert!(html.contains("send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });"));

    // State seeded from the host-injected settings, not localStorage.
    assert!(html.contains("let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;"));
    assert!(html.contains("LEAF_SETTINGS.libraryWidth"));

    // Snap-shut closes mid-drag; the divider drag is rAF-throttled.
    assert!(html.contains("if (raw < SNAP_SHUT) {"));
    assert!(html.contains("dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);"));

    // The toggle flips the pane open/closed; layout applies on boot and on resize.
    assert!(html.contains("libraryOpen.addEventListener('click', toggleLibrary);"));
    assert!(html.contains("applyPaneLayout();\nsend({ command: 'getFileTree' });"));
    assert!(html.contains("window.addEventListener('resize', () => {"));
}

#[test]
fn initial_settings_script_defines_camelcase_global() {
    let script = initial_settings_script(&Settings {
        indexing_enabled: true,
        minimap_enabled: false,
        pager_enabled: false,
        speed_reader_enabled: true,
        line_numbers_enabled: false,
        reader_editing_enabled: false,
        theme_family: "nightshade".to_string(),
        theme_mode: "dark".to_string(),
        theme_random_used: Vec::new(),
        library_view: LibraryView::Graph,
        graph_scope: GraphScope::Large,
        library_project_path: "docs".to_string(),
        library_closed: true,
        library_width: 312,
        window_width: 1440,
        window_height: 960,
        window_maximized: true,
        auto_update_enabled: true,
        update_last_checked: 1_780_000_000,
        update_staged_version: "0.1.400".to_string(),
    });
    // Window geometry is host-only (applied to the native window, not the
    // webview), so it must not leak into the injected settings global. The
    // update fields do cross: the page owns the check throttle and the button.
    assert_eq!(
        script,
        r#"window.__leafSettings = {"autoUpdateEnabled":true,"graphScope":"large","indexingEnabled":true,"libraryClosed":true,"libraryProjectPath":"docs","libraryView":"graph","libraryWidth":312,"lineNumbersEnabled":false,"minimapEnabled":false,"pagerEnabled":false,"readerEditingEnabled":false,"speedReaderEnabled":true,"themeFamily":"nightshade","themeMode":"dark","themeRandomUsed":[],"updateLastChecked":1780000000,"updateStagedVersion":"0.1.400"};"#
    );
}

#[test]
fn initial_version_script_exposes_the_package_version() {
    // The frontend's update check reads window.__leafVersion to compare against
    // the latest GitHub release, so it must carry the built package version.
    let script = initial_version_script();
    assert_eq!(
        script,
        format!("window.__leafVersion = {:?};", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn app_shell_csp_allows_github_api_for_update_check() {
    // The update check fetches api.github.com; without a connect-src grant the
    // webview's default-src 'self' blocks it. Guard against that regression.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let connect_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src"))
        .expect("CSP declares an explicit connect-src directive");
    assert!(
        connect_src.contains("https://api.github.com"),
        "connect-src must allow the GitHub API for the update check: {connect_src}"
    );
}

#[test]
fn settings_file_path_lives_in_leaftext_config() {
    let path = settings_file_path().expect("project config directory is available");
    assert!(path.ends_with("settings.json"));
    assert!(path.to_string_lossy().contains("leaftext"));
}

#[test]
fn webview_user_data_dir_uses_leaftext_local_data() {
    let path = webview_user_data_dir().expect("project data directory is available");
    let path_display = path.to_string_lossy();

    assert!(path.ends_with("webview2"));
    assert!(path_display.contains("leaftext"));
}

#[test]
fn app_data_dir_is_the_local_data_root_not_the_webview_cache() {
    let path = app_data_dir().expect("project data directory is available");
    let path_display = path.to_string_lossy();
    assert!(path_display.contains("leaftext"));
    // The manifest must not live under the WebView2-specific subfolder.
    assert!(!path.ends_with("webview2"));
}

/// These paths are where every installed copy already keeps its settings,
/// recent files, and search index, so they are a compatibility contract, not a
/// preference. They were captured from the `directories` crate's
/// `ProjectDirs::from("com", "ryanallen", "leaftext")` before that dependency
/// was replaced with the plain environment lookups in `project_config_dir` and
/// `project_data_local_dir`. Changing either shape silently orphans user data:
/// the app would start up looking clean, with the old settings still on disk.
#[test]
fn project_dirs_match_the_documented_layout() {
    let config = project_config_dir().expect("config directory is available");
    let data = project_data_local_dir().expect("data directory is available");

    #[cfg(windows)]
    {
        let roaming = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA is set"));
        let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA is set"));
        assert_eq!(
            config,
            roaming.join("ryanallen").join("leaftext").join("config")
        );
        assert_eq!(data, local.join("ryanallen").join("leaftext").join("data"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is set"));
        let support = home
            .join("Library/Application Support")
            .join("com.ryanallen.leaftext");
        // macOS draws no roaming/local distinction, so both roots are the one
        // Application Support folder.
        assert_eq!(config, support);
        assert_eq!(data, support);
    }
}

#[test]
fn app_shell_includes_library_pane_settings_and_i18n() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Layout: the shell driven by the CSS variable — rail, reader, and the gutter
    // track that holds the reader off the window frame.
    assert!(html.contains(r#"<div id="libraryShell" class="library-shell">"#));
    assert!(css.contains(
        "grid-template-columns: var(--library-width, 240px) minmax(0, 1fr) var(--reader-gutter);"
    ));
    assert!(html.contains(r#"<aside id="libraryPane" class="library-pane">"#));
    assert!(html.contains(r#"<div id="libraryTree" class="library-tree"></div>"#));
    assert!(html.contains(r#"id="libraryScanProgress""#));

    // Settings toggle + host-persisted change reporting.
    assert!(html.contains(r#"<input type="checkbox" id="indexingEnabled""#));
    assert!(html.contains("send({ command: 'setIndexingEnabled', enabled: indexingEnabled });"));
    assert!(html.contains("command: 'setLibraryState',"));
    // Two states only: the Project file list and the Graph.
    assert!(html.contains("const LIBRARY_VIEWS = ['project', 'graph'];"));
    // Markdown rows carry the leaf mark; folder rows get the enter chevron.
    assert!(html.contains(r#"${LEAF_FILE_ICON}<span class="library-file-label">"#));
    assert!(html.contains(r#"<span class="library-nav-chevron" aria-hidden="true">›</span>"#));

    // Library callbacks, the host-injected settings global it seeds from, and
    // the boot-time render + tree load.
    assert!(html.contains("window.leafSetLibraryState ="));
    assert!(html.contains("window.leafSetScanProgress ="));
    assert!(html.contains("window.leafSetSearchResults ="));
    assert!(html.contains("const LEAF_SETTINGS = (window.__leafSettings"));
    assert!(html.contains("send({ command: 'getFileTree' });"));

    // The search field, its debounced request, and the result-open + jump.
    assert!(html.contains(r#"<input id="librarySearch" class="library-search""#));
    assert!(html.contains(r#"data-i18n-placeholder="library.search.placeholder""#));
    assert!(html.contains("send({ command: 'search', query, scope: librarySearchScopePaths() });"));
    assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

    // File-derived strings are escaped before reaching the DOM (tree + hits).
    assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
    assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

    // i18n keys exist in both dictionaries.
    for key in [
        "settings.indexing.label",
        "settings.indexing.help",
        "library.title",
        "library.view.graph",
        "library.view.graph.on",
        "library.view.graph.off",
        "library.crumbs.label",
        "library.crumbs.enter",
        "library.crumbs.more",
        "library.scanning",
        "library.filesFound",
        "library.empty",
        "library.open",
        "library.divider.resize",
        "library.search.placeholder",
        "library.search.noResults",
        "library.search.count",
        "library.search.loading",
        "library.search.error",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn app_shell_wires_the_graph_view() {
    let html = app_shell_html();

    // The graph is the second of the two library views, reached by the icon in the
    // breadcrumb band, and owns its own pane container.
    assert!(html.contains("const LIBRARY_VIEWS = ['project', 'graph'];"));
    assert!(html
        .contains(r#"<button type="button" id="libraryGraphToggle" class="library-graph-toggle""#));
    assert!(html.contains("setLibraryView(libraryView === 'graph' ? 'project' : 'graph');"));
    assert!(html.contains(r#"<div id="libraryGraph" class="library-graph""#));
    assert!(html.contains(r#"id="libraryGraphCanvas""#));

    // PixiJS + d3-force load lazily from the bundled-asset protocol (no CDN).
    assert!(html.contains("const PIXI_SCRIPT_URL = '"));
    assert!(html.contains("const D3_FORCE_SCRIPT_URL = '"));
    assert!(html.contains("leaf-asset") && html.contains("pixi.min.js"));
    assert!(html.contains("d3-force.min.js"));
    assert!(html.contains("window.d3.forceSimulation"));
    // The unsafe-eval companion keeps Pixi off `new Function` so the CSP stays
    // tight; it must load after Pixi to patch it.
    assert!(html.contains("const PIXI_UNSAFE_EVAL_SCRIPT_URL = '"));
    assert!(html.contains("pixi-unsafe-eval.min.js"));
    // The CSP itself never grants 'unsafe-eval'.
    assert!(!html.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));

    // Data flows over the existing command channel and back through a callback.
    assert!(html.contains("send({ command: 'getGraph', scope: graphScope, seeds });"));
    assert!(html.contains("window.leafSetGraph ="));

    // The graph reuses the open command on node click and highlights the active
    // document; every node label is escaped before it reaches a Pixi Text.
    assert!(html.contains("send({ command: 'openRecent', path: node.path });"));
    assert!(html.contains("function graphSetActive("));

    // The i18n keys the graph surfaces exist in both dictionaries.
    for key in [
        "library.view.graph",
        "library.graph.empty",
        "library.graph.loading",
        "library.graph.error",
        "library.graph.truncated",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn bundled_asset_serves_graph_runtimes() {
    let pixi = bundled_asset_response("leaf-asset://local/pixi.min.js");
    assert_eq!(pixi.status, 200);
    assert!(pixi.content_type.contains("javascript"));
    assert!(!pixi.body.is_empty());

    let d3 = bundled_asset_response("leaf-asset://local/d3-force.min.js");
    assert_eq!(d3.status, 200);
    assert!(d3.content_type.contains("javascript"));
    assert!(!d3.body.is_empty());

    let unsafe_eval = bundled_asset_response("leaf-asset://local/pixi-unsafe-eval.min.js");
    assert_eq!(unsafe_eval.status, 200);
    assert!(unsafe_eval.content_type.contains("javascript"));
    assert!(!unsafe_eval.body.is_empty());
}

#[test]
fn library_follows_and_highlights_the_active_file() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // The active tab's path is what the library highlights as current.
    assert!(html.contains("function activeDocumentPath()"));
    // The selected row carries the marker class the CSS keys off of.
    assert!(html.contains(r#"class="library-file${selected}""#));
    assert!(css.contains(".library-file.is-selected,"));

    // Reveal helpers: locate the file in the tree, drill/expand to it.
    assert!(html.contains("function folderAncestorsOf(nodes, filePath)"));
    assert!(html.contains("function revealSelectedInLibrary()"));
    assert!(html.contains("function scrollSelectedLibraryRowIntoView()"));

    // Going to a file (open, switch, click a tab) follows it; the tree
    // arriving later runs a queued reveal. Clicking a tab always flies the
    // graph to that node; opening/switching only does so when the doc changed.
    // Clicking the tab you are already on forces a graph rebuild (resync) so a
    // stale scene in memory can't leave the view stuck.
    assert!(html.contains("followFileInLibrary(openedPath,"));
    assert!(html.contains("followFileInLibrary(switchedPath,"));
    assert!(html.contains("followFileInLibrary(tab ? tab.path || null : null, true, wasActive);"));
    assert!(html.contains("const wasActive = index === (currentState && currentState.active);"));
    assert!(html.contains(
        "if (libraryRevealPending && libraryView !== 'graph' && revealSelectedInLibrary()) return;"
    ));
}

#[test]
fn library_breadcrumbs_sit_above_the_search_box() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Its own band, above the search row, with the graph toggle at its right.
    assert!(html.contains(r#"<div class="library-crumbs" id="libraryCrumbs">"#));
    assert!(html.contains(r#"<nav class="library-crumb-trail" id="libraryCrumbTrail""#));
    assert!(html.contains("function renderLibraryCrumbs(chain)"));
    assert!(html.contains("function folderChainTo(nodes, path)"));

    // Every crumb but the last walks back out to that folder; the last is where
    // you are. A deep path elides its middle rather than overflowing the pane.
    assert!(html.contains("setLibraryFolder(crumb.dataset.crumbPath)"));
    assert!(html.contains(r#"class="library-crumb is-current" aria-current="true""#));
    // How much of the path shows is measured against the band, so widening the
    // pane reveals more crumbs; a resize refits.
    assert!(html.contains("function fitLibraryCrumbs()"));
    assert!(html.contains("libraryCrumbTrail.classList.add('is-measuring')"));
    // Every width change asks for the refit outright — a ResizeObserver alone
    // delivered its first observation in the web view and nothing after, so a
    // divider drag never re-fit the trail.
    assert!(html.contains("document.documentElement.style.setProperty('--library-rail-width', libraryWidth + 'px');\n    // The breadcrumb shows as much of the path as fits, so it refits mid-drag.\n    scheduleCrumbFit();"));
    assert!(html.contains("refitAppBar();\n  // Opening, closing, or re-clamping the pane changes the breadcrumb's room too.\n  scheduleCrumbFit();"));
    assert!(html.contains("window.addEventListener('resize', scheduleCrumbFit);"));
    assert!(html.contains("new ResizeObserver(scheduleCrumbFit)"));
    assert!(css.contains(".library-crumb-trail.is-measuring .library-crumb {"));
    // What didn't fit hides behind a "…" button that opens a menu of those
    // folders; picking one enters it.
    assert!(html.contains("data-crumb-more=\"1\""));
    assert!(html.contains("function toggleCrumbMenu(button, hidden)"));
    assert!(html.contains("setLibraryFolder(segment.path)"));
    assert!(css.contains(".crumb-menu {"));
    // A fit that would draw the same crumbs at the same width leaves the DOM alone,
    // or an indexer push would rebuild the trail under an open "…" menu.
    assert!(html.contains("function crumbFitKey(segments)"));
    assert!(html.contains("if (key === libraryCrumbFitKey) return;"));
    // Entering a folder is the same move as a crumb, so both go through one path.
    assert!(html.contains(
        "button.addEventListener('click', () => setLibraryFolder(button.dataset.navInto));"
    ));
    // A folder the current tree no longer has falls back to the root.
    assert!(html.contains("chain = [];\n    libraryProjectPath = '';"));

    // The two bands share one treatment (the pane's own surface and grain) and
    // the list starts below both.
    assert!(css.contains(".library-crumbs,\n.library-header {"));
    assert!(css.contains("--library-crumbs-height: 28px;"));
    assert!(css.contains("padding-top: var(--library-chrome-height);"));
    assert!(css.contains("top: calc(var(--library-app-bar) + var(--library-crumbs-height));"));
    assert!(css.contains(".library-graph-toggle[aria-pressed=\"true\"] {"));

    // The toggle carries the bundled graph mark, normalized to currentColor like
    // every other toolbar icon.
    let graph_icon = normalize_svg_icon_colors(GRAPH_ICON_SVG);
    assert!(graph_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(graph_icon.trim()));
}

#[test]
fn library_row_context_menu_offers_file_actions() {
    let html = app_shell_html();

    // The right-click menu is built from a list of file actions, ordered with
    // the destructive delete flagged and set apart.
    assert!(html.contains("const CONTEXT_MENU_ITEMS = ["));
    for action in [
        "'open'",
        "'cut'",
        "'copy'",
        "'copyPath'",
        "'rename'",
        "'reveal'",
        "'properties'",
        "'delete'",
    ] {
        assert!(html.contains(action), "menu missing action {action}");
    }
    assert!(html.contains("danger: true"));

    // Each action maps to the backend command that carries it out.
    assert!(html.contains("send({ command: 'copyFile', path, cut: true })"));
    assert!(html.contains("send({ command: 'copyFile', path, cut: false })"));
    assert!(html.contains("send({ command: 'copyPath', path })"));
    assert!(html.contains("send({ command: 'showProperties', path })"));
    assert!(html.contains("send({ command: 'deleteFile', path })"));
    assert!(html.contains("send({ command: 'renameFile', path, newName })"));

    // The inline rename box and the new menu labels are present.
    assert!(html.contains("function openRenameBox(path)"));
    assert!(html.contains("'actions.delete': 'Delete'"));
    assert!(html.contains("'actions.delete': '删除'"));
}

#[test]
fn code_blocks_get_a_copy_button() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Decoration runs after each document render, over code blocks but not
    // Mermaid diagrams, and copies the <code> text.
    assert!(html.contains("decorateCodeBlocks();"));
    assert!(html.contains(".document-body pre:not(.mermaid)"));
    assert!(html.contains("function copyCodeBlock(button, text)"));
    // Clipboard API with an execCommand fallback for locked-down webviews.
    assert!(html.contains("navigator.clipboard.writeText(text)"));
    assert!(html.contains("document.execCommand('copy')"));
    // The button styling and copied-state swap exist.
    assert!(css.contains(".document-body pre > .code-copy {"));
    assert!(css.contains(".code-copy.is-copied .code-copy-check {"));

    // Labels exist in both dictionaries.
    for key in ["actions.copyCode", "actions.copiedCode"] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn anchor_addressable_blocks_get_a_permalink_button() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Decoration runs after each document render, before link binding so the
    // injected anchors get wired into in-document fragment navigation.
    assert!(html.contains("function decorateAnchorLinks()"));
    let render = html
        .find("decorateAnchorLinks();")
        .expect("decorateAnchorLinks is called during render");
    let bind = html[render..]
        .find("bindDocumentLinks();")
        .map(|index| render + index)
        .expect("bindDocumentLinks is called during render");
    assert!(
        render < bind,
        "anchors must be injected before links are bound"
    );

    // Standard content blocks get ids assigned if they do not already have
    // one, then become permalink targets. Footnote definitions (which carry
    // their own back-reference) are excluded.
    assert!(html.contains("const ANCHOR_LINK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]'"));
    assert!(html.contains("function ensureAnchorLinkTargets(body)"));
    assert!(html.contains("target.id = uniqueAnchorBlockId(seen, locus);"));
    assert!(html.contains("target.classList.contains('footnote-definition')"));

    // Each block gets a short numeric address: a flat running count down the
    // page (1, 2, 3, 4 …), like a code editor's line gutter, with no reset at
    // headings. A heading keeps its slug id and carries its number through a
    // hidden alias. Navigation-outline (link-only) list items are skipped.
    assert!(html.contains("function assignLocus(target, locus, seen)"));
    assert!(html.contains("function isNavOutlineItem(el)"));
    assert!(html.contains("let line = 0;"));
    assert!(html.contains("line += 1;"));
    assert!(html.contains("assignLocus(target, '' + line, seen);"));
    assert!(html.contains("target.dataset.locus = alias.id;"));

    // The button is a real anchor link to the block's locus (dataset.locus).
    assert!(html.contains("link.href = '#' + encodeURIComponent(locus)"));

    // A bare anchor (with an inner number span) is cloned per block and its line
    // number stamped into that span, instead of building the element from scratch
    // tens of thousands of times.
    assert!(html.contains("link.firstChild.textContent = locus;"));
    assert!(html.contains("const anchorLinkTemplate = (() => {"));
    assert!(html.contains("num.className = 'heading-anchor-num';"));
    assert!(html.contains("const link = anchorLinkTemplate.cloneNode(true);"));

    // Clicking the gutter button copies its #locus so the canonical number can
    // be pasted out — the way to read the locus on touch, where there is no
    // hover tooltip. The jump still happens (the copy listener does not
    // preventDefault), and a brief is-copied flash confirms the copy.
    assert!(html.contains("function copyToClipboard(text)"));
    assert!(html.contains("copyToClipboard('#' + locus);"));
    assert!(css.contains(".document-body .heading-anchor.is-copied {"));

    // Gutter button styling exists and stays out of the horizontal scroll.
    assert!(css.contains(".document-body .heading-anchor {"));
    assert!(css.contains("overflow-x: clip;"));
    assert!(css.contains("background: var(--app-action-hover-background);"));
    assert!(css.contains(".document-body .has-anchor-link > .heading-anchor:hover,"));

    // The number hangs in the margin just left of its block (right: 100%), so
    // the block's own box — and, for a list item, its ::marker — stays exactly
    // where normal flow puts it. No per-reflow JS measuring pass, and no
    // negative-margin carve dragging list markers into the page margin.
    assert!(css.contains(".document-body .has-anchor-link {\n  position: relative;\n}"));
    assert!(!css.contains(
        ".document-body .has-anchor-link {\n  position: relative;\n  padding-left: 40px;"
    ));
    assert!(css.contains(".document-body .heading-anchor {\n  position: absolute;\n  right: 100%;"));
    assert!(
        !html.contains("positionAnchorLinks"),
        "the per-reflow anchor-positioning pass is replaced by the CSS gutter"
    );

    // A list item's number steps one list indent further left so it clears the
    // ::marker (I., II., •) and top-level list numbers share the gutter column.
    assert!(css.contains(
        ".document-body li.has-anchor-link > .heading-anchor {\n  right: calc(100% + 2em);\n}"
    ));

    // pre and table are overflow containers, so a number hung outside them would
    // be clipped invisible; they alone keep the carved-gutter scheme (40px left
    // padding pulled back with a matching negative margin, number seated inside).
    assert!(css.contains(
        ".document-body pre.has-anchor-link,\n.document-body table.has-anchor-link {\n  padding-left: 40px;\n  margin-left: -40px;\n}"
    ));
    assert!(css.contains(
        ".document-body pre.has-anchor-link > .heading-anchor,\n.document-body table.has-anchor-link > .heading-anchor {\n  right: auto;\n  left: 0;\n}"
    ));

    // A blockquote keeps its native left bar: with the number hung outside the
    // block there is no carve shifting the border-box, so no repaint is needed.
    assert!(!css.contains("blockquote.has-anchor-link {"));
    assert!(!css.contains("blockquote.has-anchor-link::after"));

    // The blockquote is the citable unit and carries the only button; its inner
    // blocks must not carve a second gutter or the quote text is dragged off the
    // column. decorateAnchorLinks skips the button on anything nested in a
    // blockquote (the block keeps its id, so #locus links still resolve).
    assert!(html
        .contains("if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;"));

    // The reader renders the whole document up front like the web reader — no
    // content-visibility, whose off-screen size estimates made scrolling flash
    // blank and the minimap viewport box jump.
    assert!(!css.contains("content-visibility: auto"));

    // Only the innermost hovered/focused block reveals its button. Without the
    // :not(:has(...)) guard, hovering a nested block would also light up every
    // ancestor block's button, stacking ghost buttons in the shared gutter.
    assert!(css.contains(
            ".document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,"
        ));
    assert!(css.contains(
            ".document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor,"
        ));

    // On pointer devices the numbers are hidden until their block is hovered
    // (opacity 0 by default). A narrow window (and touch) has no hover to reveal
    // them, so the media query restores their visibility (opacity 0.4), tucks
    // them tighter to the content edge, and shrinks the glyph — one direct tap
    // then copies the deep link.
    assert!(css.contains(
        ".document-body .heading-anchor {\n  position: absolute;\n  right: 100%;\n  top: 0;"
    ));
    assert!(css.contains("  opacity: 0;\n"));
    assert!(css.contains("@media (hover: none), (max-width: 600px) {"));
    let narrow = css
        .find("@media (hover: none), (max-width: 600px) {")
        .expect("small-screen permalink media query exists");
    assert!(css[narrow..].contains("opacity: 0.4;"));
    assert!(css[narrow..].contains("font-size: 11px;"));

    // Label exists in both dictionaries.
    let count = html.matches("'actions.anchorLink':").count();
    assert!(
        count >= 2,
        "expected EN + ZH-CN entries for actions.anchorLink, found {count}"
    );
}

#[test]
fn block_source_map_covers_top_level_blocks_in_order() {
    let markdown = "# Title\n\nA paragraph.\n\n- one\n- two\n\n```rust\nfn main() {}\n```\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(kinds, ["heading", "paragraph", "list", "code_block"]);

    // Ids are assigned in document order, and every range slices back to the
    // exact source that produced the block — the property later in-viewer
    // editing depends on.
    for (index, span) in spans.iter().enumerate() {
        assert_eq!(span.id, index);
        assert!(span.start < span.end);
        assert!(span.end <= markdown.len());
    }
    let heading = &spans[0];
    assert!(markdown[heading.start..heading.end].starts_with("# Title"));
    let code = spans.last().expect("code block span");
    assert!(markdown[code.start..code.end].contains("fn main() {}"));
}

#[test]
fn block_source_map_maps_rules_and_ignores_nested_blocks() {
    // A thematic break is a top-level block even though it has no Start/End
    // pair; list items and inline emphasis are nested, so they fold into their
    // enclosing block rather than getting their own top-level spans.
    let markdown = "Para *one*.\n\n---\n\n> quote\n";
    let kinds: Vec<&str> = block_source_map(markdown)
        .iter()
        .map(|span| span.kind)
        .collect();
    assert_eq!(kinds, ["paragraph", "rule", "blockquote"]);
}

#[test]
fn block_source_map_treats_html_wrapper_open_and_close_as_separate_blocks() {
    // A `<div align="center">` wrapper (as the README uses) opens and closes with
    // its own raw-HTML blocks, and the blocks between get their own spans. The
    // reading-view editor relies on this: it descends into the rendered wrapper to
    // reach those inner blocks, and recognizes the closing `</div>` block (which
    // renders to no element) by its `</` source so it can step over it.
    let markdown = "<div align=\"center\">\n\n# Title\n\nInside the box.\n\n</div>\n\nAfter.\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(
        kinds,
        [
            "html_block",
            "heading",
            "paragraph",
            "html_block",
            "paragraph"
        ]
    );

    // The opening wrapper slices back to just the `<div ...>` tag, and the closing
    // wrapper to `</div>` — the two ends the editor tells apart by their source.
    assert!(markdown[spans[0].start..spans[0].end].starts_with("<div"));
    assert!(markdown[spans[3].start..spans[3].end]
        .trim_start()
        .starts_with("</div"));

    // The inner heading and paragraph are ordinary editable blocks, unaffected by
    // living inside the wrapper.
    assert!(spans[1].editable);
    assert!(markdown[spans[1].start..spans[1].end].starts_with("# Title"));
    assert!(markdown[spans[2].start..spans[2].end].starts_with("Inside the box."));
}

#[test]
fn document_format_follows_extension() {
    assert_eq!(
        DocumentFormat::from_path(Path::new("notes.md")),
        DocumentFormat::Markdown
    );
    assert_eq!(
        DocumentFormat::from_path(Path::new("book.XML")),
        DocumentFormat::Xml
    );
    // Unknown / missing extensions route through the Markdown renderer, matching
    // how the loader treats everything that is not `.xml`.
    assert_eq!(
        DocumentFormat::from_path(Path::new("README")),
        DocumentFormat::Markdown
    );
}

#[test]
fn editable_document_tracks_dirty_and_save() {
    let mut doc = EditableDocument::new(PathBuf::from("notes.md"), "# Hello\n".to_string());
    assert!(!doc.is_dirty(), "a freshly opened document is clean");
    assert_eq!(doc.version(), 0);

    let flipped = doc.set_text("# Hello, edited\n".to_string());
    assert!(flipped, "set_text reports the clean -> dirty transition");
    assert!(doc.is_dirty());

    // Editing back to the saved text clears dirty without a save.
    assert!(doc.set_text("# Hello\n".to_string()));
    assert!(!doc.is_dirty());

    doc.set_text("# Hello, edited\n".to_string());
    doc.mark_saved();
    assert!(!doc.is_dirty(), "the buffer is the baseline after a save");
    assert_eq!(doc.version(), 1, "each save advances the version");

    doc.replace_range(2, 7, "Hi");
    assert!(doc.can_undo(), "reader edits create an undo step");
    doc.mark_saved();
    assert!(
        !doc.can_undo(),
        "saving makes the current buffer the undo baseline"
    );
    assert_eq!(doc.version(), 2, "a later save advances again");
}

#[test]
fn editable_document_adopts_external_change_when_clean() {
    let mut doc = EditableDocument::new(PathBuf::from("notes.md"), "original\n".to_string());
    doc.adopt_external("changed on disk\n".to_string());
    assert_eq!(doc.text(), "changed on disk\n");
    assert!(
        !doc.is_dirty(),
        "adopting an external change leaves it clean"
    );
}

#[test]
fn source_view_highlights_both_markdown_and_xml() {
    // The code view reuses the reader's Rust highlighter, which has both
    // Markdown and XML in its language table — so both formats colour, not just
    // Markdown. The output is escaped and wrapped in syntect `syn-*` spans.
    let markdown = render_source_view_html("# Heading\n", DocumentFormat::Markdown);
    assert!(markdown.contains("syn-"), "markdown source is highlighted");

    let xml = render_source_view_html("<TEI><head>Title</head></TEI>", DocumentFormat::Xml);
    assert!(xml.contains("syn-"), "xml source is highlighted");
    assert!(
        xml.contains("&lt;"),
        "angle brackets are escaped, not raw tags"
    );
}

#[test]
fn app_shell_edits_code_view_incrementally_without_whole_document_reflow() {
    // Typing in the code view must patch only the lines that changed, never
    // rewrite the whole colour layer — that whole-document rewrite is what turned
    // the document white on every keystroke and stuttered on large files.
    let html = app_shell_html();

    // The colour layer is built one block per source line, split from the flat
    // highlighter output so a single line can be recoloured on its own.
    assert!(html.contains("function highlightedHtmlToLines(html, expectedCount)"));
    assert!(html.contains("function setCodeViewColourLines(codeEl, html, text)"));

    // The per-keystroke handler diffs the lines and splices only the changed run,
    // and does NOT set the whole colour layer's text.
    assert!(html.contains("updateCodeViewLinesIncremental(code, linenums, prevText, codeViewText)"));
    assert!(!html.contains("code.textContent = codeViewText"));

    // The minimap's content observer is detached in the code view (so no
    // whole-document clone runs per keystroke); the thumbnail refreshes on the
    // debounced edit cycle instead.
    assert!(html.contains("function refreshCodeViewMinimap()"));
    assert!(html.contains("minimapBodyObserver.disconnect();"));

    // A debounced re-highlight repaints only the colour lines that changed rather
    // than rebuilding every line div, so recolour does not re-lay-out a large
    // document. The recolour compares against the tracked per-line markup.
    assert!(html.contains("function recolourCodeViewLines(codeEl, html, text)"));
    assert!(html.contains("recolourCodeViewLines(code, state.html, codeViewText)"));
}

#[test]
fn data_leaf_attribute_prefixes_survive_sanitizing() {
    // The editing model stamps blocks with source-range / identity markers; the
    // sanitizer must let the `data-leaf-*` / `data-src-*` prefixes through so
    // later in-viewer editing can find a block's source.
    let cleaned = sanitize_rendered_html(
        r#"<p data-leaf-edit-id="3" data-src-start="10" data-src-end="20">Body</p>"#,
    );
    assert!(cleaned.contains(r#"data-leaf-edit-id="3""#));
    assert!(cleaned.contains(r#"data-src-start="10""#));
    assert!(cleaned.contains(r#"data-src-end="20""#));
}

// ---------------------------------------------------------------------------
// Updates
//
// The staging code decides whether downloaded bytes are allowed to reach an
// installer, so its refusals matter more than its successes. Each test below
// covers one way a download can be wrong.
// ---------------------------------------------------------------------------

/// A scratch data directory, named per test so parallel runs cannot collide.
fn update_test_dir(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("leaf-update-{name}-{unique}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch data directory");
    dir
}

fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

/// Minimal encoder, so the decoder is tested against something independent.
fn base64_encode_for_test(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        let triple = (u32::from(first) << 16) | (u32::from(second) << 8) | u32::from(third);
        out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[test]
fn version_comparison_ignores_v_prefix_and_compares_numerically() {
    assert!(is_newer_version("v0.1.362", "0.1.361"));
    assert!(is_newer_version("0.2.0", "0.1.999"));
    // Not lexicographic: 370 beats 69.
    assert!(is_newer_version("0.1.370", "0.1.69"));
    assert!(!is_newer_version("0.1.361", "0.1.361"));
    assert!(!is_newer_version("0.1.360", "0.1.361"));
    // Missing segments read as zero, so an equal shorter prefix is not newer.
    assert!(!is_newer_version("0.1", "0.1.0"));
    assert!(is_newer_version("0.1.1", "0.1"));
    // Garbage must not read as newer, or a malformed release would prompt.
    assert!(!is_newer_version("banana", "0.1.361"));
}

#[test]
fn update_checks_are_throttled_but_never_wedged() {
    let now = 1_780_000_000;
    assert!(update_check_is_due(0, now));
    assert!(!update_check_is_due(now - 60, now));
    assert!(!update_check_is_due(now, now));
    assert!(update_check_is_due(now - UPDATE_CHECK_INTERVAL_SECS, now));
    // A clock that jumped backwards, or a settings value from the future, must
    // read as due rather than blocking every future check forever.
    assert!(update_check_is_due(now + 10_000, now));
}

#[test]
fn base64_decoding_round_trips_and_rejects_junk() {
    // Every padding case, since chunk boundaries land on all three.
    for original in [
        &b""[..],
        &b"a"[..],
        &b"ab"[..],
        &b"abc"[..],
        &b"abcd"[..],
        &[0u8, 255, 128, 1, 2, 3, 4][..],
    ] {
        let encoded = base64_encode_for_test(original);
        assert_eq!(
            decode_base64(&encoded).as_deref(),
            Some(original),
            "round trip failed for {original:?}"
        );
    }

    // A corrupted message must fail the transfer, not quietly decode to
    // different bytes than the sender hashed.
    assert_eq!(decode_base64("!!!!"), None);
    assert_eq!(decode_base64("YWJj*"), None);
    assert_eq!(decode_base64("YWJ"), None);
}

#[test]
fn a_verified_download_is_staged_and_readable_afterwards() {
    let data_dir = update_test_dir("staged");
    let payload = b"pretend this is a 6 MB installer".repeat(64);
    let digest = blake3_hex(&payload);

    let mut download = UpdateDownload::begin(
        &data_dir,
        "v0.1.362",
        "leaftext-v0.1.362-windows-x86_64.msi",
        &digest,
        payload.len() as u64,
    )
    .expect("download opens");

    // Delivered in pieces, the way the page streams it.
    for chunk in payload.chunks(100) {
        download.write_chunk(chunk).expect("chunk accepted");
    }
    let staged = download.finish().expect("download verifies");

    assert_eq!(staged.version, "0.1.362", "the v prefix is stripped");
    assert_eq!(staged.blake3, digest);
    assert_eq!(staged.size, payload.len() as u64);

    // The installer sits at its final name, with no .part left behind.
    let installer = staged.installer_path(&data_dir);
    assert_eq!(fs::read(&installer).expect("installer readable"), payload);
    assert!(!staging_dir(&data_dir, "0.1.362")
        .join("leaftext-v0.1.362-windows-x86_64.msi.part")
        .exists());

    // And a later launch can find it from the manifest alone.
    let reread = read_staged(&data_dir, "0.1.362").expect("manifest round trips");
    assert_eq!(reread, staged);
    assert_eq!(hash_file(&installer).expect("rehash"), digest);

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_download_that_fails_its_checksum_is_refused_and_deleted() {
    let data_dir = update_test_dir("badhash");
    let payload = b"tampered installer".to_vec();
    let expected = blake3_hex(b"the installer that was actually published");

    let mut download = UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext-v0.1.362-windows-x86_64.msi",
        &expected,
        payload.len() as u64,
    )
    .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");

    let error = download.finish().expect_err("mismatched hash is refused");
    assert!(error.contains("checksum"), "unhelpful message: {error}");

    // Nothing installable may survive a failed verification.
    assert!(read_staged(&data_dir, "0.1.362").is_none());
    let leftovers: Vec<_> = fs::read_dir(staging_dir(&data_dir, "0.1.362"))
        .expect("staging folder exists")
        .flatten()
        .map(|entry| entry.file_name())
        .collect();
    assert!(leftovers.is_empty(), "left behind {leftovers:?}");

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_truncated_download_is_refused() {
    let data_dir = update_test_dir("short");
    let payload = b"only the first half".to_vec();
    let digest = blake3_hex(&payload);

    let mut download = UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext.msi",
        &digest,
        payload.len() as u64 + 100,
    )
    .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");

    let error = download.finish().expect_err("short download is refused");
    assert!(
        error.contains("stopped early"),
        "unhelpful message: {error}"
    );
    assert!(read_staged(&data_dir, "0.1.362").is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_download_may_not_grow_past_its_advertised_size() {
    let data_dir = update_test_dir("oversize");
    let mut download =
        UpdateDownload::begin(&data_dir, "0.1.362", "leaftext.msi", &blake3_hex(b"x"), 4)
            .expect("download opens");

    assert!(download.write_chunk(b"aaaa").is_ok());
    let error = download
        .write_chunk(b"and then some more")
        .expect_err("overrun is refused");
    assert!(error.contains("larger"), "unhelpful message: {error}");

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn release_metadata_cannot_escape_the_staging_folder() {
    let data_dir = update_test_dir("traversal");
    let digest = blake3_hex(b"x");

    // A hostile or broken tag_name becomes a directory name, so separators and
    // dot segments must not survive into it.
    let staging = staging_dir(&data_dir, "../../evil");
    assert!(
        staging.starts_with(updates_dir(&data_dir)),
        "escaped to {}",
        staging.display()
    );

    // Asset names become file names in that folder, and are rejected outright
    // rather than rewritten: a name we had to launder is a bad sign by itself.
    for hostile in [
        "../outside.msi",
        "..\\outside.msi",
        "sub/dir.msi",
        ".hidden",
        "",
    ] {
        assert!(
            UpdateDownload::begin(&data_dir, "0.1.362", hostile, &digest, 1).is_err(),
            "accepted asset name {hostile:?}"
        );
    }

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_malformed_checksum_is_refused_before_anything_downloads() {
    let data_dir = update_test_dir("digest");
    for bad in [
        "",
        "not-a-hash",
        &"a".repeat(63),
        &"a".repeat(65),
        &"z".repeat(64),
    ] {
        assert!(
            UpdateDownload::begin(&data_dir, "0.1.362", "leaftext.msi", bad, 10).is_err(),
            "accepted digest {bad:?}"
        );
    }

    // Checksum files conventionally carry the file name after the digest, and
    // hex is case-insensitive; both must be accepted.
    let digest = blake3_hex(b"x");
    assert!(UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext.msi",
        &format!("{digest}  leaftext.msi"),
        10
    )
    .is_ok());
    assert!(UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext.msi",
        &digest.to_uppercase(),
        10
    )
    .is_ok());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn an_absurd_download_size_is_refused() {
    let data_dir = update_test_dir("huge");
    let digest = blake3_hex(b"x");
    assert!(UpdateDownload::begin(&data_dir, "0.1.362", "a.msi", &digest, 0).is_err());
    assert!(
        UpdateDownload::begin(&data_dir, "0.1.362", "a.msi", &digest, MAX_UPDATE_BYTES + 1)
            .is_err()
    );
    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn pruning_keeps_only_the_pending_version() {
    let data_dir = update_test_dir("prune");
    for version in ["0.1.358", "0.1.359", "0.1.362"] {
        fs::create_dir_all(staging_dir(&data_dir, version)).expect("staging folder");
    }

    prune_staged(&data_dir, Some("0.1.362"));
    let left: Vec<_> = fs::read_dir(updates_dir(&data_dir))
        .expect("updates folder")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec!["0.1.362".to_string()]);

    // Nothing pending clears the lot, which is what runs after an update lands
    // and takes the leftover helper copy with it.
    prune_staged(&data_dir, None);
    assert_eq!(
        fs::read_dir(updates_dir(&data_dir))
            .expect("updates folder")
            .count(),
        0
    );

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn a_staged_record_without_its_installer_reads_as_nothing_staged() {
    let data_dir = update_test_dir("halfdeleted");
    let payload = b"installer".to_vec();
    let digest = blake3_hex(&payload);
    let mut download = UpdateDownload::begin(
        &data_dir,
        "0.1.362",
        "leaftext.msi",
        &digest,
        payload.len() as u64,
    )
    .expect("download opens");
    download.write_chunk(&payload).expect("chunk accepted");
    let staged = download.finish().expect("download verifies");

    // Someone clearing out AppData must not leave the button offering a restart
    // that cannot happen.
    fs::remove_file(staged.installer_path(&data_dir)).expect("remove installer");
    assert!(read_staged(&data_dir, "0.1.362").is_none());

    let _ = fs::remove_dir_all(&data_dir);
}

#[test]
fn the_app_shell_allows_the_release_download_hosts() {
    // The page fetches release metadata from the API host and the installer
    // from the download host, which redirects to a githubusercontent CDN.
    // Without all three in connect-src the webview blocks the update silently.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let connect_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src"))
        .expect("CSP declares an explicit connect-src directive");
    for host in [
        "https://api.github.com",
        "https://github.com",
        "https://*.githubusercontent.com",
    ] {
        assert!(
            connect_src.contains(host),
            "connect-src must allow {host}: {connect_src}"
        );
    }
}

#[test]
fn the_settings_panel_exposes_the_auto_update_toggle() {
    let html = app_shell_html();
    assert!(html.contains(r#"<input type="checkbox" id="autoUpdateEnabled""#));
    assert!(html.contains(r#"data-i18n="settings.autoUpdate.label""#));

    // Both locale tables must carry every update string, or the button renders
    // blank for one of them.
    for key in [
        "update.available",
        "update.downloading",
        "update.restart",
        "update.failed",
        "settings.autoUpdate.label",
        "settings.autoUpdate.help",
    ] {
        assert_eq!(
            html.matches(&format!("'{key}':")).count(),
            2,
            "{key} is missing from a locale table"
        );
    }
}

#[test]
fn the_settings_panel_shows_the_running_version() {
    let html = app_shell_html();
    assert!(html.contains(r#"<span class="settings-version-number" id="settingsVersion">"#));
    assert!(html.contains(r#"data-i18n="settings.version""#));
    assert_eq!(
        html.matches("'settings.version':").count(),
        2,
        "settings.version is missing from a locale table"
    );
    // The number itself comes from the init script, not the markup.
    assert!(initial_version_script().contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn the_page_is_told_which_installer_this_build_takes() {
    let script = initial_update_script();
    assert!(script.starts_with("window.__leafUpdateAsset = "));
    assert!(script.contains(platform_asset_suffix()));

    // The suffix has to match what the release workflow actually publishes.
    #[cfg(windows)]
    assert_eq!(platform_asset_suffix(), "-windows-x86_64.msi");
    #[cfg(target_os = "macos")]
    assert_eq!(platform_asset_suffix(), "-macos-universal.app.zip");
}
