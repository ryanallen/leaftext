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

    let model = opened_document_from_tei(xml, Path::new("sutra.xml")).minimap;

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
    // Regression: matching used offsets from a lowercased copy to slice the
    // original, which panics on non-ASCII text (lowercasing can shift byte
    // boundaries). These documents are full of diacritics, so the linker
    // crashed the app instantly. Terms are (term, slug) pairs, longest-first.
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
    let from_xml = opened_document_from_tei(tei, &xml);

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
    // GitHub authors anchor targets with explicit `id=` on raw-HTML elements
    // (e.g. `<h1 id="forewordhhdl">`). Links like `[Foreword](#forewordhhdl)`
    // only scroll if that id reaches the rendered DOM, so the sanitizers must
    // keep `id` on the tags that carry these anchors.
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
    match theme {
        ResolvedTheme::Light => {
            blocks.extend(css_blocks(css, &format!("{PRIMER_LIGHT_SELECTOR} {{")));
        }
        ResolvedTheme::Dark => {
            blocks.extend(css_blocks(css, &format!("{PRIMER_DARK_SELECTOR} {{")));
        }
    };
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--bgColor-default");
            parse_hex_color(&background)
                .and_then(|background| parse_hex_color_with_alpha(&value, background))
        })
        .unwrap_or_else(|| panic!("expected {name} to resolve to a hex color"))
}

fn css_token_for_source(css: &str, source: &ThemeSource, name: &str) -> Rgb {
    let mut blocks = css_blocks(css, &format!("{} {{", source.selector));
    if source.kind == ThemeSourceKind::Primer {
        let selector = match source.id {
            "primer-light" => PRIMER_LIGHT_SELECTOR,
            "primer-dark" => PRIMER_DARK_SELECTOR,
            _ => source.selector,
        };
        blocks.extend(css_blocks(css, &format!("{selector} {{")));
    }
    let value = css_token_value(&blocks, name);

    parse_hex_color(&value)
        .or_else(|| {
            let background = css_token_value(&blocks, "--leaf-app-background");
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

    let (_title, html) = render_tei_body(xml);

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
    // A following non-<l> block ends the verse run and renders normally.
    assert_contains(&html, "<p>A prose paragraph.</p>");
    // No leftover plain verse paragraph markup.
    assert!(!html.contains("<p class=\"tei-verse\">"));
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

    let (_title, html) = render_tei_body(xml);

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
    assert_contains(&html, "<p>This is the summary.</p>");
    // The front closes before the body content, so the body is not inside it.
    let front_end = html.find("</details>").expect("front details closes");
    let body_at = html.find("<p>The body text.</p>").expect("body renders");
    assert!(front_end < body_at, "front must render before the body");
}

#[test]
fn tei_headings_shrink_with_nesting_never_invert() {
    // 84000 TEI nests a `chapter` inside a `section`. A fixed type→level table
    // (chapter=h2, section=h3) would render the nested chapter LARGER than the
    // section above it. Heading level must follow nesting depth instead.
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

    let (_title, html) = render_tei_body(xml);

    // Transparent `translation` adds no depth: top section is h2, the chapter
    // inside it h3, the section inside that h4 — strictly shrinking, no inversion.
    assert_contains(&html, r#"<h2 id="outer-section">Outer Section</h2>"#);
    assert_contains(&html, r#"<h3 id="inner-chapter">Inner Chapter</h3>"#);
    assert_contains(&html, r#"<h4 id="deeper-section">Deeper Section</h4>"#);
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
        "--bgColor-default:",
        "--bgColor-muted:",
        "--fgColor-default:",
        "--fgColor-muted:",
        "--fgColor-accent:",
        "--fgColor-success:",
        "--fgColor-attention:",
        "--fgColor-danger:",
        "--fgColor-done:",
        "--borderColor-default:",
        "--borderColor-muted:",
        "--control-bgColor-rest:",
        "--button-primary-bgColor-rest:",
        "--focus-outlineColor:",
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

    assert_contains(css, "@font-face");
    assert_contains(css, "font-family: 'Noto Sans';");
    assert_contains(css, "font-family: 'Noto Sans Mono';");
    assert_contains(css, "data:font/woff2;base64,");
    assert_contains(
        css,
        r#"[data-color-mode="light"][data-light-theme="light"]"#,
    );
    assert_contains(css, r#"[data-color-mode="auto"][data-light-theme="light"]"#);
    assert_contains(css, r#"[data-color-mode="dark"][data-dark-theme="dark"]"#);
    assert_contains(
        css,
        r#"[data-color-mode][data-color-mode="auto"][data-dark-theme="dark"]"#,
    );
    assert_contains(css, "--bgColor-default: var(--base-color-neutral-0);");
    assert_contains(css, "--fgColor-default: var(--base-color-neutral-13);");
    assert_contains(css, "--borderColor-default: var(--base-color-neutral-6);");
    assert_contains(css, "--fgColor-accent: var(--base-color-blue-5);");
    assert_contains(css, "--fgColor-success: var(--base-color-green-5);");
    assert_contains(css, "--fgColor-attention: var(--base-color-yellow-5);");
    assert_contains(css, "--fgColor-danger:");
    assert_contains(css, "--fgColor-done: var(--base-color-purple-5);");
    assert_contains(css, "--prettylights-syntax-comment:");
    assert_contains(css, "--prettylights-syntax-markup-inserted-text:");
    assert_contains(css, "/* Leaf semantic theme compiler output. */");
    assert_contains(css, "--leaf-theme-source: primer-light;");
    assert_contains(css, "--leaf-theme-source: primer-dark;");
    assert_contains(css, "--leaf-theme-source: dracula;");
    assert_contains(css, r#":root[data-leaf-theme-source="dracula"]"#);
    assert_contains(css, "--leaf-app-background: var(--bgColor-default);");
    assert_contains(
        css,
        "--leaf-syntax-comment: var(--prettylights-syntax-comment);",
    );
    assert_contains(css, "--surface-page: var(--leaf-markdown-background);");
    assert_contains(css, "--syntax-comment: var(--leaf-syntax-comment);");
    assert_contains(
        css,
        "--leaf-syntax-inserted: var(--prettylights-syntax-markup-inserted-text);",
    );
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
            "background: linear-gradient(to bottom, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 85%, transparent) 100%);",
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
    // as an ordered list that links each heading by its slug id.
    assert_contains(&html, "details.className = 'document-outline';");
    assert_contains(&html, "summary.dataset.i18n = 'outline.title';");
    assert_contains(&html, "link.className = 'document-outline-link';");
    assert_contains(&html, "link.href = '#' + encodeURIComponent(h.id);");
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
    // Localized label present in both shipped languages.
    assert_contains(&html, "'outline.title': 'Outline'");
    assert_contains(&html, "'outline.title': '大纲'");
}

#[test]
fn theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled() {
    let css = reading_mode_css();
    let sources = theme_sources();

    assert_theme_sources_cover_contract(sources);
    assert_eq!(sources.len(), 3);
    assert!(sources.iter().any(|source| source.id == "dracula"));

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

    let selectable: Vec<&str> = sources
        .iter()
        .filter(|source| source.selectable)
        .map(|source| source.id)
        .collect();
    assert_eq!(selectable, vec!["primer-light", "primer-dark", "dracula"]);

    let html = app_shell_html();
    assert_contains(&html, r#"id="themeMode""#);
    assert_contains(&html, "settings.theme.");
    // Dracula is a deliberate manual choice in the theme picker.
    assert_contains(
        &html,
        r#"<option value="dracula" data-i18n="settings.theme.dracula">Dracula</option>"#,
    );
    // It activates through its own token source attribute, not free-form CSS.
    assert!(!html.contains("customTheme"));
}

#[test]
fn theme_compiler_gates_readable_pairs_for_every_source() {
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            ("--leaf-app-foreground", "--leaf-app-background"),
            ("--leaf-app-muted-foreground", "--leaf-app-background"),
            ("--leaf-app-primary-foreground", "--leaf-app-primary"),
            ("--leaf-markdown-foreground", "--leaf-markdown-background"),
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
    // The bundled @font-face fonts are embedded as `data:` URLs. The CSP must
    // grant `font-src ... data:`, otherwise it falls back to `default-src 'self'`
    // and WebView2 silently blocks every bundled font (headings drop to Georgia,
    // body to the system sans). Guard against that regression.
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
        // The whole-document clone is skipped when nothing that shapes the
        // thumbnail changed (same content version, wrap width, and rail width),
        // so a height-only resize no longer rebuilds the entire document.
        "minimapBuiltVersion === minimapContentVersion &&",
        "minimapBuiltSourceWidth === metrics.sourceWidth &&",
        "minimapBuiltPreviewWidth === previewWidth",
        "const preview = source.cloneNode(true);",
        "preview.classList.add('document-minimap-preview');",
        "preview.style.transform = `scale(${previewScale})`;",
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
        &html,
        ".document-minimap-preview a.glossary-term {\n  color: inherit;\n}",
    );

    // The real-text clone replaces the old abstract canvas entirely (no 2D
    // context, palette, or line-model rows), and it is rebuilt only on content
    // mutations / resize / image load — never by observing the source's size,
    // which would rebuild the whole-document clone on every scroll.
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
            !html.contains(forbidden),
            "minimap preview must not reintroduce the canvas or scroll-churn path: {forbidden}"
        );
    }
}

#[test]
fn app_shell_maps_minimap_geometry_proportionally() {
    let html = app_shell_html();

    // The box and the click/drag mapping derive from the reader's real scroll
    // range and the clone's real height, so they track the thumbnail on
    // documents of any length; on tall documents the thumbnail slides in the rail.
    for expected in [
            "function minimapPreviewScale(track, metrics) {",
            "const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportDocumentTop = scrollRatio * Math.max(0, scaledDocumentHeight - boundedViewportHeight);",
            "const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const boxTravel = previewTravel > 0 ? handleRange : Math.max(0, scaledDocumentHeight - boundedViewportHeight);",
            "const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;",
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
            "send({ command: 'switchTab', index, scroll_anchor: currentScrollAnchor() });",
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
fn app_shell_header_uses_translucent_blur() {
    let css = reading_mode_css();

    for expected in [
            "background: linear-gradient(to bottom, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 85%, transparent) 100%);",
            "backdrop-filter: blur(2px);",
            "-webkit-backdrop-filter: blur(2px);",
            ".app-bar::before",
            ".app-bar::after",
        ] {
            assert_contains(css, expected);
        }

    assert!(
        !css.contains("  border-bottom: 1px solid var(--app-border);"),
        "app header must not draw a hard bottom border"
    );

    assert!(
        !css.contains(".app-bar.is-scrolled"),
        "app header must not draw a drop shadow on scroll"
    );
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
        "const clickedDocumentY = (event.clientY - contentRect.top) / previewScale;",
        "setReaderScrollTop(metrics.topOffset + targetViewportScrollTop);",
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
            "const previewScale = metrics.scrollHeight <= 0 ? 1 : minimapPreviewScale(track, metrics);",
            "const boxTravel = previewTravel > 0 ? handleRange : Math.max(0, scaledDocumentHeight - boundedViewportHeight);",
            "const targetViewportScrollTop = boxTravel <= 0 ? 0 : (targetViewportTop / boxTravel) * metrics.scrollable;",
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

    // The box height is the reader window scaled to the thumbnail; it is placed
    // from the thumbnail slide plus the scaled scroll top, so it tracks the
    // visible region on documents of any length.
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
            "function syncMinimapTrackHeight(minimap) {",
            "const shellRect = app.getBoundingClientRect();",
            "const minimapRect = minimap.getBoundingClientRect();",
            "const availableHeight = Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));",
            "const content = minimap.querySelector('.document-minimap-content');",
            "const trackHeight = contentHeight > 0 ? Math.min(availableHeight, contentHeight) : availableHeight;",
            "minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);",
            "return { availableHeight, trackHeight };",
            "const trackSize = minimap ? syncMinimapTrackHeight(minimap) : null;",
            "const shellHeight = trackSize ? trackSize.availableHeight : Math.max(1, app.clientHeight);",
            "const documentContent = correctReaderScrollOrigin(source);",
            "const trackHeight = Math.max(1, Math.ceil(track.clientHeight || trackRect.height || trackSize?.trackHeight || shellHeight));",
            "const viewportHeight = Math.max(1, Math.ceil(app.clientHeight || shellHeight));",
            "const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);",
            "const viewportScrollTop = Math.min(scrollable, Math.max(0, app.scrollTop - documentContent.topOffset));",
            "return { source, sourceWidth, documentHeight, topOffset: documentContent.topOffset, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, viewportScrollTop };",
        ] {
            assert_contains(&html, expected);
        }

    // The track caps its height at the cloned thumbnail's height, so a short
    // document gets a short rail with no dead space below it.
    assert!(
        html.contains("const contentHeight = contentRect ? Math.ceil(contentRect.height) : 0;"),
        "track sizing reads the cloned preview height"
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
            "const scrollRange = measureReaderScrollRange(documentContent, viewportHeight);",
            "const scrollable = scrollRange.scrollable;",
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
            "const blocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));",
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
            // The reflow observer re-pins the anchor as images decode and grow.
            "function observeReaderReflow() {",
            "readerReflowObserver = new ResizeObserver(() => scheduleReaderLayoutUpdate());",
            "image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });",
        ] {
            assert_contains(&html, expected);
        }
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
    // The reader renders the whole document up front like the web reader, so it
    // must NOT use content-visibility: that made blocks flash blank while
    // scrolling and the scroll-height estimate made the minimap box jump.
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
    assert_contains(&html, "themeModeControl");
    assert_contains(&html, "window.leafTheme.subscribe((theme) => {");
    assert_contains(&html, "window.leafTheme.setMode(themeModeControl.value)");
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
    assert_contains(
        &html,
        "VALID_MODES = new Set(['system', 'light', 'dark', 'dracula'])",
    );
    // Seeded from the host-injected global, not localStorage (non-durable here).
    assert_contains(&html, "window.__leafSettings.themeMode");
    assert_contains(&html, "let mode = normalizeMode(injected);");
    assert_contains(
            &html,
            "root.dataset.colorMode = mode === 'system' ? 'auto' : (mode === 'dracula' ? 'dark' : mode)",
        );
    // Dracula flips on its own token source; other modes clear it.
    assert_contains(&html, "root.dataset.leafThemeSource = 'dracula'");
    assert_contains(&html, "delete root.dataset.leafThemeSource");
    assert_contains(&html, "root.dataset.lightTheme = 'light'");
    assert_contains(&html, "root.dataset.darkTheme = 'dark'");
    assert_contains(
        &html,
        "root.dataset.resolvedColorMode = theme.resolvedTheme",
    );
    assert_contains(&html, "root.dataset.themeMode = mode");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme");
    assert_contains(&html, "getMode: () => mode");
    assert_contains(&html, "getResolvedTheme: resolvedTheme");
    assert_contains(&html, "mode = normalizeMode(nextMode);");
    assert_contains(&html, "subscribe(listener)");
    assert_contains(&html, "listeners.forEach((listener) => listener(theme))");
    assert_contains(
        &html,
        "media.addEventListener('change', onSystemThemeChange)",
    );
    assert_contains(&html, "media.addListener(onSystemThemeChange)");
    assert_contains(&html, "catch (_) {}");
    assert_contains(&html, r#"id="themeMode""#);
    assert_contains(&html, "settings.theme.");
    assert!(!html.contains("themeVariant"));
    assert!(!html.contains("customTheme"));
    assert!(!html.contains("id=\"lightTheme\""));
    assert!(!html.contains("id=\"darkTheme\""));
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
    assert_contains(
        &html,
        r#"<span class="setting-help" id="themeModeHelp" data-i18n="settings.theme.help">System follows device preference.</span>"#,
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
    assert_contains(&html, r#"for="themeMode""#);
    assert_contains(&html, "themeModeHelp");
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
        "min-width: 34px;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_theme_bootstrap_resolves_manual_and_system_modes() {
    let html = app_shell_html();

    assert_contains(&html, "if (mode === 'light') return 'light';");
    assert_contains(
        &html,
        "if (mode === 'dark' || mode === 'dracula') return 'dark';",
    );
    assert_contains(&html, "return media && media.matches ? 'dark' : 'light';");
    assert_contains(&html, "setMode(nextMode) {");
    assert_contains(
        &html,
        "const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };",
    );
    assert_contains(
            &html,
            "root.dataset.colorMode = mode === 'system' ? 'auto' : (mode === 'dracula' ? 'dark' : mode);",
        );
    assert_contains(&html, "root.dataset.lightTheme = 'light';");
    assert_contains(&html, "root.dataset.darkTheme = 'dark';");
    assert_contains(
        &html,
        "root.dataset.resolvedColorMode = theme.resolvedTheme;",
    );
    assert_contains(&html, "root.dataset.themeMode = mode;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme;");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme;");
}

#[test]
fn app_shell_theme_bootstrap_seeds_from_host_injected_settings() {
    let html = app_shell_html();

    for expected in [
        "const VALID_MODES = new Set(['system', 'light', 'dark', 'dracula']);",
        "window.__leafSettings.themeMode",
        "let mode = normalizeMode(injected);",
        "mode = normalizeMode(nextMode);",
        "listeners.forEach((listener) => listener(theme));",
    ] {
        assert_contains(&html, expected);
    }

    // The theme path no longer touches the non-durable localStorage shim
    // (its 'leaf.themeMode' key and modeStorage are gone); the host owns
    // persistence via the setThemeMode IPC message. (The locale bootstrap
    // keeps its own separate storage, so we check theme-specific markers.)
    assert!(!html.contains("leaf.themeMode"));
    assert!(!html.contains("modeStorage"));
    assert!(html.contains("send({ command: 'setThemeMode', mode: themeModeControl.value });"));
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
    let state_render_position = html
        .find("  renderState();")
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
            "'empty.title': 'Markdown, made to read.'",
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

    // `<details>`/`<summary>` are allowed and the boolean `open` is kept (the
    // sanitizer normalizes it to `open=""`, which browsers treat as expanded),
    // but the dangerous bits (onclick, style, target, javascript:, class) go.
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
fn local_image_protocol_blocks_out_of_scope_and_reports_missing_images() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("leaf-local-image-scope-{unique}"));
    let docs = root.join("docs");
    let markdown_path = docs.join("README.md");

    fs::create_dir_all(&docs).expect("test docs directory is created");

    let rendered = render_markdown_document(
        "![Secret](../../secret.png)\n![Missing](missing.png)",
        &markdown_path,
    );
    let source_dir = local_image_source_dir(&markdown_path).expect("source dir resolves");
    let missing = local_image_protocol_response(&local_img("missing.png"), Some(&source_dir));
    let escaped = local_image_protocol_response(
        &local_img("__leaf_parent__/__leaf_parent__/secret.png"),
        Some(&source_dir),
    );

    fs::remove_dir_all(&root).expect("test docs directory is removed");

    assert_contains(
        &rendered.html,
        &expected_img(
            "__leaf_parent__/__leaf_parent__/secret.png",
            r#"alt="Secret" title="Secret""#,
        ),
    );
    assert_contains(
        &rendered.html,
        &expected_img("missing.png", r#"alt="Missing" title="Missing""#),
    );
    assert_eq!(missing.status, 404);
    assert_eq!(escaped.status, 403);
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
    assert_eq!(settings.theme_mode, "system");
    assert_eq!(settings.library_view, LibraryView::Project);
    assert!(settings.library_expanded.is_empty());
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
        theme_mode: "dracula".to_string(),
        library_view: LibraryView::Tree,
        library_expanded: vec!["C:\\Users".to_string(), "C:\\Users\\rwall".to_string()],
        library_project_path: "C:\\Users\\rwall".to_string(),
        library_closed: true,
        library_width: 312,
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
    assert!(loaded.library_expanded.is_empty());
    assert!(!loaded.library_closed);
    assert_eq!(loaded.library_width, 240);

    fs::remove_dir_all(&dir).expect("test directory is removed");
}

#[test]
fn app_shell_wires_library_pane_open_close_and_resize() {
    let html = app_shell_html();

    // Markup: the resize divider on the pane edge and the open button that
    // stays reachable (positioned against the shell) when the column is 0.
    assert!(html.contains(r#"<div id="libraryDivider" class="library-divider" data-i18n-title="library.divider.resize" title="Resize library""#));
    assert!(html.contains(r#"<button type="button" id="libraryOpen" class="library-open" data-i18n-title="library.open" data-i18n-aria-label="library.open""#));

    // The open icon is the bundled asset, normalized to currentColor like the
    // other toolbar icons (no stray literal stroke color survives).
    let open_icon = normalize_svg_icon_colors(OPEN_LIBRARY_ICON_SVG);
    assert!(open_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(open_icon.trim()));

    // CSS: the collapsed-grid override, the divider hit target, and the open
    // button pinned to the shell's left edge.
    assert!(html.contains(
        ".library-shell.library-closed {\n  grid-template-columns: 0 minmax(0, 1fr);\n}"
    ));
    assert!(html.contains(".library-divider {"));
    assert!(html.contains("cursor: col-resize;"));
    assert!(html.contains(".library-shell.library-closed .library-open {"));

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

    // Open button restores the pane; layout applies on boot and on resize.
    assert!(html.contains("libraryOpen.addEventListener('click', openLibrary);"));
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
        theme_mode: "dracula".to_string(),
        library_view: LibraryView::Tree,
        library_expanded: vec!["C:\\Users".to_string()],
        library_project_path: "docs".to_string(),
        library_closed: true,
        library_width: 312,
    });
    assert_eq!(
        script,
        r#"window.__leafSettings = {"indexingEnabled":true,"libraryClosed":true,"libraryExpanded":["C:\\Users"],"libraryProjectPath":"docs","libraryView":"tree","libraryWidth":312,"minimapEnabled":false,"pagerEnabled":false,"speedReaderEnabled":true,"themeMode":"dracula"};"#
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

#[test]
fn app_shell_includes_library_pane_settings_and_i18n() {
    let html = app_shell_html();

    // Layout: the two-column shell driven by the CSS variable.
    assert!(html.contains(r#"<div id="libraryShell" class="library-shell">"#));
    assert!(html.contains("grid-template-columns: var(--library-width, 240px) minmax(0, 1fr);"));
    assert!(html.contains(r#"<aside id="libraryPane" class="library-pane">"#));
    assert!(html.contains(r#"<div id="libraryTree" class="library-tree"></div>"#));
    assert!(html.contains(r#"id="libraryScanProgress""#));

    // Settings toggle + host-persisted change reporting.
    assert!(html.contains(r#"<input type="checkbox" id="indexingEnabled""#));
    assert!(html.contains("send({ command: 'setIndexingEnabled', enabled: indexingEnabled });"));
    assert!(html.contains("command: 'setLibraryState',"));
    // The three view modes and the cycling toggle.
    assert!(html.contains("const LIBRARY_VIEWS = ['project', 'tree', 'flat'];"));
    // Markdown rows carry the leaf mark; folders in Project view get a chevron.
    assert!(html.contains(r#"<img class="library-file-icon" src="${LEAF_FILE_ICON}""#));
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
    assert!(html.contains("send({ command: 'search', query });"));
    assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

    // File-derived strings are escaped before reaching the DOM (tree + hits).
    assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
    assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

    // i18n keys exist in both dictionaries.
    for key in [
        "settings.indexing.label",
        "settings.indexing.help",
        "library.title",
        "library.view.toggle",
        "library.view.project",
        "library.view.tree",
        "library.view.all",
        "library.up",
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
fn library_follows_and_highlights_the_active_file() {
    let html = app_shell_html();

    // The active tab's path is what the library highlights as current.
    assert!(html.contains("function activeDocumentPath()"));
    // The selected row carries the marker class the CSS keys off of.
    assert!(html.contains(r#"class="library-file${selected}""#));
    assert!(html.contains(".library-file.is-selected,"));

    // Reveal helpers: locate the file in the tree, drill/expand to it.
    assert!(html.contains("function folderAncestorsOf(nodes, filePath)"));
    assert!(html.contains("function revealSelectedInLibrary()"));
    assert!(html.contains("function scrollSelectedLibraryRowIntoView()"));

    // Going to a file (open, switch, click a tab) follows it; the tree
    // arriving later runs a queued reveal.
    assert!(html.contains("followFileInLibrary(activeDocumentPath());"));
    assert!(html.contains("followFileInLibrary(tab ? tab.path || null : null);"));
    assert!(html.contains("if (libraryRevealPending && revealSelectedInLibrary()) return;"));
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

    // Decoration runs after each document render, over code blocks but not
    // Mermaid diagrams, and copies the <code> text.
    assert!(html.contains("decorateCodeBlocks();"));
    assert!(html.contains(".document-body pre:not(.mermaid)"));
    assert!(html.contains("function copyCodeBlock(button, text)"));
    // Clipboard API with an execCommand fallback for locked-down webviews.
    assert!(html.contains("navigator.clipboard.writeText(text)"));
    assert!(html.contains("document.execCommand('copy')"));
    // The button styling and copied-state swap exist.
    assert!(html.contains(".document-body pre > .code-copy {"));
    assert!(html.contains(".code-copy.is-copied .code-copy-check {"));

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

    // A bare anchor is cloned per block and its line number stamped in as text,
    // instead of building the element from scratch tens of thousands of times.
    assert!(html.contains("link.textContent = locus;"));
    assert!(html.contains("const anchorLinkTemplate = (() => {"));
    assert!(html.contains("const link = anchorLinkTemplate.cloneNode(true);"));

    // Clicking the gutter button copies its #locus so the canonical number can
    // be pasted out — the way to read the locus on touch, where there is no
    // hover tooltip. The jump still happens (the copy listener does not
    // preventDefault), and a brief is-copied flash confirms the copy.
    assert!(html.contains("function copyToClipboard(text)"));
    assert!(html.contains("copyToClipboard('#' + locus);"));
    assert!(html.contains(".document-body .heading-anchor.is-copied {"));

    // Gutter button styling exists and stays out of the horizontal scroll.
    assert!(html.contains(".document-body .heading-anchor {"));
    assert!(html.contains("overflow-x: clip;"));
    assert!(html.contains("background: var(--app-action-hover-background);"));
    assert!(html.contains(".document-body .has-anchor-link > .heading-anchor:hover,"));

    // The number hangs in the margin just left of its block (right: 100%), so
    // the block's own box — and, for a list item, its ::marker — stays exactly
    // where normal flow puts it. No per-reflow JS measuring pass, and no
    // negative-margin carve dragging list markers into the page margin.
    assert!(html.contains(".document-body .has-anchor-link {\n  position: relative;\n}"));
    assert!(!html.contains(
        ".document-body .has-anchor-link {\n  position: relative;\n  padding-left: 40px;"
    ));
    assert!(
        html.contains(".document-body .heading-anchor {\n  position: absolute;\n  right: 100%;")
    );
    assert!(
        !html.contains("positionAnchorLinks"),
        "the per-reflow anchor-positioning pass is replaced by the CSS gutter"
    );

    // A list item's number steps one list indent further left so it clears the
    // ::marker (I., II., •) and top-level list numbers share the gutter column.
    assert!(html.contains(
        ".document-body li.has-anchor-link > .heading-anchor {\n  right: calc(100% + 2em);\n}"
    ));

    // pre and table are overflow containers, so a number hung outside them would
    // be clipped invisible; they alone keep the carved-gutter scheme (40px left
    // padding pulled back with a matching negative margin, number seated inside).
    assert!(html.contains(
        ".document-body pre.has-anchor-link,\n.document-body table.has-anchor-link {\n  padding-left: 40px;\n  margin-left: -40px;\n}"
    ));
    assert!(html.contains(
        ".document-body pre.has-anchor-link > .heading-anchor,\n.document-body table.has-anchor-link > .heading-anchor {\n  right: auto;\n  left: 0;\n}"
    ));

    // A blockquote keeps its native left bar: with the number hung outside the
    // block there is no carve shifting the border-box, so no repaint is needed.
    assert!(!html.contains("blockquote.has-anchor-link {"));
    assert!(!html.contains("blockquote.has-anchor-link::after"));

    // The blockquote is the citable unit and carries the only button; its inner
    // blocks must not carve a second gutter or the quote text is dragged off the
    // column. decorateAnchorLinks skips the button on anything nested in a
    // blockquote (the block keeps its id, so #locus links still resolve).
    assert!(html
        .contains("if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;"));

    // The reader renders the whole document up front like the web reader — no
    // content-visibility, whose off-screen size estimates made scrolling flash
    // blank and the minimap viewport box jump.
    assert!(!html.contains("content-visibility: auto"));

    // Only the innermost hovered/focused block reveals its button. Without the
    // :not(:has(...)) guard, hovering a nested block would also light up every
    // ancestor block's button, stacking ghost buttons in the shared gutter.
    assert!(html.contains(
            ".document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,"
        ));
    assert!(html.contains(
            ".document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor,"
        ));

    // A narrow window (and touch) has little left margin for the number gutter,
    // so the numbers tuck tighter to the content edge (flex-end) and shrink.
    // They stay always-visible, so one direct tap copies the deep link.
    assert!(html.contains("@media (hover: none), (max-width: 600px) {"));
    let narrow = html
        .find("@media (hover: none), (max-width: 600px) {")
        .expect("small-screen permalink media query exists");
    assert!(html[narrow..].contains("justify-content: flex-end;"));

    // Label exists in both dictionaries.
    let count = html.matches("'actions.anchorLink':").count();
    assert!(
        count >= 2,
        "expected EN + ZH-CN entries for actions.anchorLink, found {count}"
    );
}
