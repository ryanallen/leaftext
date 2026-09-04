//! Raw HTML in Markdown, and what the sanitizer keeps or drops.

use super::*;

#[test]
fn raw_html_anchor_ids_survive_so_in_page_links_resolve() {
    // Raw-HTML anchor targets carry an explicit `id=`; the sanitizers must keep it so `[..](#id)` links still scroll.
    let rendered = render_markdown_document(
        r#"[Foreword](#forewordhhdl) [Plate](#frontispiece-il) [Notice](#copyright) [Plate two](#gauge-plate)

<h1 id="forewordhhdl" align="center" onclick="bad()">Foreword</h1>
<p id="frontispiece-il">Plate caption.</p>
<div id="copyright">Notice.</div>
<a id="gauge-plate">Plate two.</a>
"#,
        "README.md",
    );

    assert_contains(&rendered.html, r#"id="forewordhhdl""#);
    assert_contains(&rendered.html, r#"id="frontispiece-il""#);
    assert_contains(&rendered.html, r#"id="copyright""#);
    assert_contains(&rendered.html, r#"id="gauge-plate""#);
    // The id rides through, but unsafe attributes on the same tag still go.
    assert!(!rendered.html.contains("onclick"));
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
fn strips_disallowed_raw_html_tags_and_attributes() {
    let markdown = r#"<details open onclick="alert(1)">
<summary>Deploy notes</summary>
<p style="color:red"><a href="javascript:alert(2)" onclick="bad()">bad</a> <a href="https://example.com" title="Example" target="_blank">good</a></p>
<span class="badge" title="dropped title">Span text</span>
</details>"#;

    let rendered = render_markdown_document(markdown, "README.md");

    // `<details>`/`<summary>` are allowed and boolean `open` is kept (normalized to `open=""`), but the dangerous attributes go.
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
    let markdown = r##"# <div align="center">Field Notes from the Lower Weir</div>
<div align="center">A Complete Account of Four Seasons of Readings at the Lower Weir</div>
<div align="RIGHT" onclick="bad()">by <a href="#anna-holt">Anna Holt</a></div>
<div align="expression(alert(1))">not aligned</div>"##;

    let rendered = render_markdown_document(markdown, "README.md");

    assert_eq!(rendered.title, "Field Notes from the Lower Weir");
    assert_contains(
        &rendered.html,
        r#"<div align="center">Field Notes from the Lower Weir</div>"#,
    );
    assert_contains(
        &rendered.html,
        r#"<div align="center">A Complete Account of Four Seasons of Readings at the Lower Weir</div>"#,
    );
    assert_contains(
        &rendered.html,
        r##"<div align="right">by <a href="#anna-holt" rel="noopener noreferrer">Anna Holt</a></div>"##,
    );
    assert_contains(&rendered.html, "<div>not aligned</div>");
    assert!(!rendered.html.contains("onclick"));
    assert!(!rendered.html.contains("expression(alert(1))"));
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
fn data_leaf_attribute_prefixes_survive_sanitizing() {
    // The editing model stamps blocks with source-range / identity markers; the sanitizer must let the `data-leaf-*` / `data-src-*` prefixes through so later in-viewer editing can find a block's source.
    let cleaned = sanitize_rendered_html(
        r#"<p data-leaf-edit-id="3" data-src-start="10" data-src-end="20">Body</p>"#,
    );
    assert!(cleaned.contains(r#"data-leaf-edit-id="3""#));
    assert!(cleaned.contains(r#"data-src-start="10""#));
    assert!(cleaned.contains(r#"data-src-end="20""#));
}

#[test]
fn table_column_labels_survive_sanitizing() {
    let rendered = render_markdown_document("| Name |\n| --- |\n| Ada |\n", "people.md");

    assert_contains(&rendered.html, r#"data-leaf-col="Name">Ada</td>"#);
}

#[test]
fn a_block_that_reaches_the_page_as_nothing_is_told_from_one_that_draws() {
    // The block map drops a block this answers yes for, so a yes on something the page really draws would leave an element with no source range and take the whole document's editing with it. A closing tag is the case to keep saying no to: the page steps over it itself.
    for nothing in [
        "<!-- a note -->",
        "<!-- a --> <!-- b -->",
        "<!-- x --> text",
        "<!-- unterminated",
        "<script>alert(1)</script>",
        "<style>p { color: red; }</style>",
        "<script>\nalert(1)\n",
    ] {
        assert!(
            html_block_renders_to_no_element(nothing),
            "{nothing:?} draws nothing, and it was called drawn"
        );
    }

    for drawn in [
        "<div align=\"center\">",
        "</div>",
        "<p>Body</p>",
        "<!-- a note --><div>",
        "</script>",
    ] {
        assert!(
            !html_block_renders_to_no_element(drawn),
            "{drawn:?} is not the sanitizer's to remove, and it was dropped"
        );
    }
}
#[test]
fn a_link_naming_a_file_on_this_disk_keeps_its_address() {
    // The three spellings of one file: a whole path from a drive letter either way round, and the `file:` address a reader may write instead. All three reach the page as the same address, so the click, the card and the confirmation before a program all read one shape.
    let markdown = concat!(
        "[drive](C:/Users/rwall/plan.md) ",
        "[backslashes](C:\\Users\\rwall\\plan.md) ",
        "[written whole](file:///C:/Users/rwall/plan.md) ",
        "[beside it](../sibling/plan.md) ",
        "[the web](https://example.com/)",
    );

    let rendered = render_markdown_document(markdown, "README.md");

    assert_eq!(
        rendered
            .html
            .matches(r#"href="file:///C:/Users/rwall/plan.md""#)
            .count(),
        3,
        "the three spellings did not all arrive as one address: {}",
        rendered.html
    );
    // A relative address never meets the scheme list, and a web address is not a path — neither is touched.
    assert_contains(&rendered.html, r#"href="../sibling/plan.md""#);
    assert_contains(&rendered.html, r#"href="https://example.com/""#);
}

#[test]
fn an_apps_own_scheme_and_a_phone_number_still_lose_their_address() {
    // The grant is one scheme wide, not a category: an address handing a stranger's document a line to another program is its own decision, and a phone number puts a dialer in front of a reader. Both lose the address and keep the words, which is what the page marks and says so about.
    let markdown = concat!(
        "[a vault note](obsidian://open?vault=x&file=y) ",
        "[a citation](zotero://select/items/1) ",
        "[call](tel:+15551234567) ",
        "[a page of its own](data:text/html;base64,PHNjcmlwdD4=)",
    );

    let rendered = render_markdown_document(markdown, "README.md");

    for refused in ["obsidian:", "zotero:", "tel:", "data:"] {
        assert!(
            !rendered.html.contains(refused),
            "{refused} kept its address: {}",
            rendered.html
        );
    }
    // The anchor and its words stay standing, which is the whole reason the page has to mark one.
    assert_contains(&rendered.html, ">call</a>");
}
