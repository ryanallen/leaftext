//! GitHub extras: references, mentions, emoji, footnotes, alerts, Mermaid.

use super::*;

#[test]
fn renders_github_issue_and_pull_request_references_with_context() {
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
}

#[test]
fn leaves_bare_hex_runs_alone_instead_of_linking_them_as_commits() {
    // Hex is too ordinary to claim: `f0f0f0f` is a color, not a commit.
    let markdown = "Colors f0f0f0f and ffffff, plus a1b2c3d and \
         0123456789abcdef0123456789abcdef01234567.";

    let rendered = render_markdown_document(markdown, "README.md");

    assert_contains(
        &rendered.html,
        "Colors f0f0f0f and ffffff, plus a1b2c3d and 0123456789abcdef0123456789abcdef01234567.",
    );
    assert!(!rendered.html.contains("/commit/"));
    assert!(!rendered.html.contains("commit-ref"));
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

    // Front matter reaches mermaid, which is what reads it. Cutting it here made
    // the page and the flowchart sheet draw one block two ways.
    assert_contains(
        &rendered.html,
        r#"<pre class="mermaid" data-language="mermaid">---"#,
    );
    assert_contains(&rendered.html, "config:\n  xyChart:\n    width: 700");
    assert_contains(&rendered.html, "xychart-beta");
    assert_contains(&rendered.html, r#"title "Component Adoption %""#);
    assert_contains(&rendered.html, "0 --&gt; 100");
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
    // Brackets are link syntax, never a button wrapper, so `[[…]()]` renders as
    // what it literally is.
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
