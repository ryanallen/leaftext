//! CommonMark, GFM, and document titles.

use super::*;

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
        "document render should not synchronously scan pager neighbors"
    );
    assert_contains(&pager, "Next Page");
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
