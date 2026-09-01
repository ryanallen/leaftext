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
fn the_metadata_table_draws_each_field_as_the_thing_it_is() {
    let markdown = "---\nAuthor: Ada\npublish: true\ndraft: false\ntags: [one, two]\ncount: 42\n---\n\n# Doc\n";
    let html = render_markdown_document(markdown, "note.md").html;

    // The key keeps the case the file wrote it in. It used to arrive lowercased.
    assert!(html.contains("<th>Author</th>"), "html: {html}");
    // A checkbox as a box, checked or not, and it survives the sanitizer because a `[x]` in a table cell already renders the same element. The sanitizer is what writes these out, so the assertion is on its spelling of a boolean attribute, not ours.
    assert!(
        html.contains(r#"><input type="checkbox" disabled="" checked=""></td>"#),
        "html: {html}"
    );
    assert!(html.contains(r#"><input type="checkbox" disabled=""></td>"#));
    // A list as items, with no class on the `ul` — the sanitizer does not pass one there, so the stylesheet reaches it through the table.
    assert!(html.contains("><ul><li>one</li><li>two</li></ul></td>"));
    assert!(html.contains(">42</td>"));
}

#[test]
fn a_document_gets_the_styles_it_names_and_one_message_for_everything_that_did_not_land() {
    let markdown =
        "---\ncssclasses: [wide, midnight, comfy]\nperson:\n  name: nested\n---\n\n# Doc\n";
    let html = render_markdown_document(markdown, "note.md").html;

    // The one style it asked for that this app has — as *our* class name, never the note's own string.
    assert!(
        html.contains(r#"data-leaf-doc-classes="document-body-wide""#),
        "html: {html}"
    );
    // One message covering the whole block: the two style names with nothing behind them, and the nested line the parser refused.
    let unread = html
        .split(r#"data-leaf-unread=""#)
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("an unread message");
    assert!(unread.contains("midnight"), "unread: {unread}");
    assert!(unread.contains("comfy"), "unread: {unread}");
    assert!(
        unread.contains("nested fields are not read"),
        "unread: {unread}"
    );
    assert_eq!(html.matches("data-leaf-unread").count(), 1);

    // A note naming a class the app uses for its own chrome changes nothing: the table is the only way in, and it maps names rather than passing them through.
    let chrome = "---\ncssclasses: [app-bar, document-body-wide, frontmatter]\n---\n\n# Doc\n";
    let html = render_markdown_document(chrome, "note.md").html;
    assert!(!html.contains("data-leaf-doc-classes"), "html: {html}");

    // Nothing to say, nothing said.
    let quiet = "---\ncssclasses: [wide]\n---\n\n# Doc\n";
    let html = render_markdown_document(quiet, "note.md").html;
    assert!(html.contains("data-leaf-doc-classes"));
    assert!(!html.contains("data-leaf-unread"), "html: {html}");
}

#[test]
fn a_field_table_names_the_bytes_each_value_occupies_in_the_file() {
    // The table used to be drawn from a copy of the block with no idea where it sat, so its ranges could only point at that copy. Read them back out of the whole document: a range that addresses the copy slices the wrong text rather than failing loudly.
    let markdown =
        "\u{feff}---\ntitle: Notes\nversion: \"1.0\"\ntags: [one, two]\ndone: true\n---\n\n# Doc\n";
    let html = render_markdown_document(markdown, "note.md").html;
    let cell = |key: &str| {
        let mark = format!(r#"data-leaf-field="{key}""#);
        let at = html
            .find(&mark)
            .unwrap_or_else(|| panic!("no {key} cell: {html}"));
        let tag = &html[at..at + html[at..].find('>').expect("a closed tag")];
        let value = |name: &str| {
            let mark = format!(r#"{name}=""#);
            let start = tag
                .find(&mark)
                .unwrap_or_else(|| panic!("no {name} on {tag}"))
                + mark.len();
            tag[start..].split('"').next().expect("a closed value")
        };
        let range = |name: &str| value(name).parse::<usize>().expect("a number");
        (
            value("data-leaf-field-kind").to_string(),
            &markdown[range("data-leaf-field-start")..range("data-leaf-field-end")],
        )
    };

    // Past the byte order mark and past the opening fence, the way every other range in the document is measured.
    assert_eq!(cell("title"), ("text".to_string(), "Notes"));
    // The value as written, quotes included, so putting them back needs no guessing.
    assert_eq!(cell("version"), ("text".to_string(), "\"1.0\""));
    // A list spans its first item to its last, so one value written over it replaces the list.
    assert_eq!(cell("tags"), ("list".to_string(), "one, two"));
    assert_eq!(cell("done"), ("checkbox".to_string(), "true"));

    // Its own attributes, not the block walk's `data-src-*`: everything reading that name treats what carries it as a Markdown block, and the field block is not one.
    let table = &html[html.find("frontmatter").expect("the table")
        ..html.find("</table>").expect("the table's end")];
    assert!(!table.contains("data-src-start"), "{table}");

    // A field the file opened and put nothing in has no value bytes to name.
    let empty = render_markdown_document("---\ntags: []\n---\n\n# Doc\n", "note.md").html;
    assert!(empty.contains(r#"data-leaf-field="tags""#), "{empty}");
    assert!(!empty.contains("data-leaf-field-start"), "{empty}");
}

#[test]
fn markdown_pipeline_stages_keep_raw_rendering_before_sanitization() {
    let source_path = Path::new("README.md");
    let events = parse_markdown_source(
        "<script>alert(1)</script>\n\nVisit www.example.com.",
        MarkdownParserConfig::github_flavored(),
    );
    let events = register_markdown_extensions(events, source_path, &DesktopHost::default());
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
    // Use a dedicated subdirectory so the on-disk load and already-read render both see the same source path.
    let dir = scratch_dir("reload-parity");
    let path = dir.join("doc.md");
    let markdown = "# Reloaded\n\nBody text.\n";
    fs::write(&path, markdown).expect("test markdown is written");

    let from_disk = load_document(&path).expect("test markdown loads");
    let from_memory = opened_document_from_markdown(markdown, &path);

    fs::remove_dir_all(&dir).expect("test directory is removed");

    // Rendering the already-read string must produce the same document the on-disk loader would, so the live-reload path can read the file once.
    assert_eq!(from_memory.title, from_disk.title);
    assert_eq!(from_memory.html, from_disk.html);
    assert_eq!(from_memory.path, from_disk.path);
    assert_eq!(
        from_memory.has_visible_content,
        from_disk.has_visible_content
    );
}

#[test]
fn opened_document_starts_with_async_pager_placeholder() {
    let root = scratch_dir("async-pager");
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
fn renders_non_ascii_markdown_without_altering_source_content() {
    let markdown = r#"# Leaf 🍁 Guía de uso

Un párrafo con puntuación, emoji y un enlace: [enlace al proyecto](https://example.com/leaf).

## Función — αλφάβητο

- Leer `README.md`
- Conservar el nombre Leaf 🍁

| Función | Estado |
| --- | --- |
| Vista previa | Disponible |

```ts
const message = "¡Hola, Leaf!";
console.log(message);
```
"#;

    let rendered = render_markdown_document(markdown, "guía.md");

    assert_eq!(rendered.title, "Leaf 🍁 Guía de uso");
    assert_contains(&rendered.html, r#"<h1 id="leaf--guía-de-uso">"#);
    assert_contains(&rendered.html, "puntuación, emoji");
    assert_contains(
        &rendered.html,
        r#"<a href="https://example.com/leaf" rel="noopener noreferrer">enlace al proyecto</a>"#,
    );
    assert_contains(&rendered.html, "<li>Leer <code>README.md</code></li>");
    // The column label a card draws from is the heading's own words, accents and all.
    assert_contains(
        &rendered.html,
        r#"<td data-leaf-col="Función">Vista previa</td>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<pre class="highlight" data-language="TypeScript"><code class="language-typescript">"#,
    );
    assert_contains(&rendered.html, "¡Hola, Leaf!");
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
    // A column's alignment reaches the page as `align`: `style` never survives the sanitizer, so an inline one would center nothing.
    assert_contains(&rendered.html, "<th align=\"left\">Left</th>");
    assert_contains(&rendered.html, "<th align=\"center\">Center</th>");
    assert_contains(&rendered.html, "<th align=\"right\">Right</th>");
    assert_contains(
        &rendered.html,
        "<td align=\"left\" data-leaf-col=\"Left\">a</td>",
    );
    assert_contains(
        &rendered.html,
        "<td align=\"center\" data-leaf-col=\"Center\">b</td>",
    );
    assert_contains(
        &rendered.html,
        "<td align=\"right\" data-leaf-col=\"Right\">c</td>",
    );
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
fn table_column_labels_follow_their_headings_and_skip_missing_ones() {
    let markdown = "| [Name](https://example.com) | `Count` |\n| --- | --- |\n| Ada | 3 |\n";
    let rendered = render_markdown_document(markdown, "people.md");

    assert_contains(&rendered.html, r#"data-leaf-col="Name">Ada</td>"#);
    assert_contains(&rendered.html, r#"data-leaf-col="Count">3</td>"#);
    assert!(!rendered.html.contains("data-leaf-col=\"\""));
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

    // Every cell carries its column's heading, so a card can label the box the way the grid's heading row does.
    assert_contains(
        &rendered.html,
        r#"<td data-leaf-col="Learned"><input disabled="" type="checkbox">"#,
    );
    assert_contains(
        &rendered.html,
        r#"<td data-leaf-col="Learned"><input disabled="" type="checkbox" checked="">"#,
    );
    assert_eq!(
        rendered
            .html
            .matches(r#"<input disabled="" type="checkbox" checked="">"#)
            .count(),
        2
    );
    assert_contains(
        &rendered.html,
        r#"<td data-leaf-col="Notes">keep [ ] as text</td>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<td data-leaf-col="Learned"><code>[ ]</code></td>"#,
    );
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
    let path = scratch_dir("preserve").join("document.md");
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
