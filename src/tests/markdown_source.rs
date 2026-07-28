//! The code view's Markdown color layer, built from the reading view's own parse.

use super::*;

fn colored(markdown: &str) -> String {
    render_source_view_html(markdown, DocumentFormat::Markdown)
}

/// The source text with every tag removed and entities decoded — what the code
/// view actually shows the reader.
fn text_of(html: &str) -> String {
    let mut text = String::new();
    let mut inside_tag = false;
    for char in html.chars() {
        match char {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            char if !inside_tag => text.push(char),
            _ => {}
        }
    }
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

#[test]
fn the_color_layer_shows_the_source_byte_for_byte() {
    // The layer sits under the textarea the reader types into and the minimap
    // clones it, so a dropped or duplicated character is visible corruption —
    // and the edit path splices by offsets that assume the two agree.
    for markdown in [
        "# Title\n\nSome *emphasis* and `code` and [a link](https://x.y).\n",
        "> quoted one\n> quoted two\n\n- item one\n- item two\n",
        "```rust\nlet x = 1;\n```\n",
        "```rust\n```\n",
        "~~~js\nlet a = 1;\n~~~\n",
        "```\nplain body\n```\n",
        "```rust\nunclosed fence\n",
        "    indented\n    block\n",
        "![img](p.png) and ~~struck~~ and **bold [link](u)**\n",
        "Title\n=====\n\nBody\n",
        "- a\n  - b\n    - c\n",
        "- [x] done\n- [ ] todo\n",
        "Text[^1]\n\n[^1]: note\n",
        "---\ntitle: x\n---\n\n# H\n",
        "<div class=\"x\">raw</div>\n\ntext\n",
        "5 < 6 & \"quoted\" 'x'\n",
        "# H\r\n\r\ntext\r\n",
        "$x^2$ and $$y$$\n",
        "<https://x.y> and https://a.b\n",
        "a  \nb\n",
        "| a | b |\n|---|---|\n| 1 | 2 |\n",
        "trailing spaces   \n\n\n",
        "",
        "\n\n\n",
        "héllo — ünïcode ✓ 中文\n",
    ] {
        assert_eq!(
            text_of(&colored(markdown)),
            markdown,
            "the color layer must show exactly the source: {markdown:?}"
        );
    }
}

#[test]
fn every_line_closes_the_spans_it_opens() {
    // The page splits this markup one line per element; a span left open would
    // leak its color into the next line, or its markup into the line's text.
    let markdown = "# Heading\n\n> a quote\n> over lines\n\n```rust\nfn main() {}\n```\n\n**bold\nacross lines**\n";
    let html = colored(markdown);

    for line in html.lines() {
        assert_eq!(
            line.matches("<span").count(),
            line.matches("</span>").count(),
            "spans must balance on every line: {line}"
        );
    }
}

#[test]
fn a_heading_colors_its_marker_and_its_text_apart() {
    let html = colored("## Great Buoyancy\n");

    assert_contains(
        &html,
        r#"<span class="syn-definition syn-heading syn-markup syn-punctuation">##</span>"#,
    );
    assert_contains(
        &html,
        r#"<span class="syn-entity syn-heading syn-markup syn-section">Great Buoyancy</span>"#,
    );
}

#[test]
fn inline_constructs_carry_their_delimiter_rules() {
    let html = colored("*one* **two** ~~three~~ `four`\n");

    for expected in [
        r#"<span class="syn-definition syn-italic syn-markup syn-punctuation">*</span>"#,
        r#"<span class="syn-bold syn-definition syn-markup syn-punctuation">**</span>"#,
        r#"<span class="syn-markup syn-punctuation syn-strikethrough">~~</span>"#,
        r#"<span class="syn-definition syn-markup syn-punctuation syn-raw">`</span>"#,
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn a_link_colors_its_brackets_label_and_destination() {
    let html = colored("[label](https://x.y)\n");

    // The label's brackets and the destination's parens are separate rules, so
    // `[label](url)` reads as one unit rather than gray punctuation.
    assert_contains(
        &html,
        r#"<span class="syn-definition syn-link syn-meta syn-punctuation">[</span>"#,
    );
    assert_contains(
        &html,
        r#"<span class="syn-definition syn-link syn-meta syn-metadata syn-punctuation">(</span>"#,
    );
    assert_contains(
        &html,
        r#"<span class="syn-link syn-markup syn-meta syn-underline">https://x.y</span>"#,
    );
}

#[test]
fn a_quote_and_a_list_color_their_line_markers() {
    let quote = colored("> quoted one\n> quoted two\n");
    // Both lines get the marker, not just the one pulldown reports the block on.
    assert_eq!(
        quote
            .matches(r#"<span class="syn-markup syn-punctuation syn-quote">&gt; </span>"#)
            .count(),
        2
    );

    let list = colored("- item\n1. numbered\n");
    assert_contains(
        &list,
        r#"<span class="syn-list_item syn-punctuation">-</span>"#,
    );
    assert_contains(
        &list,
        r#"<span class="syn-list_item syn-punctuation">1.</span>"#,
    );
}

#[test]
fn a_fenced_block_colors_its_fences_and_its_body_as_that_language() {
    // The fence body goes through the language's own syntax the way it does in the
    // reading view, so a Rust fence in a Markdown file reads as Rust.
    let html = colored("```rust\npub fn main() {}\n```\n");

    assert_contains(
        &html,
        r#"<span class="syn-definition syn-markup syn-punctuation syn-raw">```</span>"#,
    );
    assert_contains(
        &html,
        r#"<span class="syn-constant syn-markup syn-raw">rust</span>"#,
    );
    assert_contains(&html, "syn-storage");
    // Both fences, opening and closing.
    assert_eq!(
        html.matches(
            r#"<span class="syn-definition syn-markup syn-punctuation syn-raw">```</span>"#
        )
        .count(),
        2
    );
}

#[test]
fn a_fence_in_an_unknown_language_still_colors_its_fences() {
    let html = colored("```nonsense\nraw body\n```\n");

    assert_contains(
        &html,
        r#"<span class="syn-definition syn-markup syn-punctuation syn-raw">```</span>"#,
    );
    assert_contains(&html, "raw body");
}

#[test]
fn table_pipes_are_punctuation() {
    let html = colored("| a | b |\n|---|---|\n| 1 | 2 |\n");

    assert_contains(&html, r#"<span class="syn-punctuation">"#);
    assert_contains(&html, "syn-punctuation");
}

#[test]
fn prose_and_blank_lines_carry_no_element() {
    // The reason this is fast enough to run on a multi-megabyte file: the bulk of
    // a document is unstyled and needs nothing wrapped around it.
    let html = colored("just a plain sentence with no markup\n\nand another\n");

    assert!(
        !html.contains("<span"),
        "unstyled prose should carry no span:\n{html}"
    );
}

#[test]
fn raw_html_in_the_source_is_escaped_not_served() {
    // The color layer is set with innerHTML, so a tag in the source has to arrive
    // as text.
    let html = colored("<script>alert(1)</script>\n\n<div onerror=x>\n");

    assert!(!html.contains("<script>"), "script tag leaked:\n{html}");
    assert!(!html.contains("<div onerror"), "div leaked:\n{html}");
    assert_contains(&html, "&lt;script&gt;");
}

#[test]
fn the_data_formats_still_go_through_syntect() {
    // Only Markdown moved off the tokenizer; XML, JSON and YAML tokenize fast
    // enough there and have no second parser to read them with.
    let xml = render_source_view_html("<root enabled=\"true\" />\n", DocumentFormat::Xml);
    assert_contains(&xml, "syn-");

    let json = render_source_view_html("{ \"a\": 1 }\n", DocumentFormat::Json);
    assert_contains(&json, "syn-");

    let yaml = render_source_view_html("key: value\n", DocumentFormat::Yaml);
    assert_contains(&yaml, "syn-");
}
