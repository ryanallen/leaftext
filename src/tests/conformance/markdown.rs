//! CommonMark and GFM against the HTML their specifications print.
//!
//! A byte comparison is the wrong instrument here: most of what differs is
//! something this app does on purpose. So the comparison normalizes first, and
//! **the normalizer is the written record of how we differ from CommonMark** —
//! every rule in `normalize` is one deliberate addition, and there was nowhere
//! else that list existed.
//!
//! Only property 5 lives here. Markdown has no byte ranges in this tree (the
//! reading view's Markdown blocks are stamped by the renderer, not the parser) and
//! no verdict to give: every input renders to something.

use super::*;

/// What we add to a link and the specification does not.
const OUR_REL: &str = " rel=\"noopener noreferrer\"";

/// Chapters `rawhtml.rs` owns on purpose. Raw HTML in a document is a security
/// boundary, and what survives the filter is our decision, not CommonMark's.
const SANITIZED: [&str; 2] = ["Raw HTML", "HTML blocks"];

/// Whether the input carries a raw HTML tag, wherever in the specification the
/// example sits. Those two chapters are not the boundary — an example about
/// emphasis or hard line breaks written with `<a href="…">` in it is still a
/// question about what the sanitizer keeps, and `rawhtml.rs` answers that.
///
/// An autolink is not a tag: `<irc://host>` has a scheme where a tag has a name.
fn mentions_raw_html(markdown: &str) -> bool {
    let bytes = markdown.as_bytes();
    for (at, byte) in bytes.iter().enumerate() {
        if *byte != b'<' {
            continue;
        }
        let mut end = at + 1;
        if bytes.get(end) == Some(&b'/') {
            end += 1;
        }
        let name = end;
        while bytes.get(end).is_some_and(u8::is_ascii_alphanumeric) {
            end += 1;
        }
        if end == name {
            continue;
        }
        if matches!(bytes.get(end), Some(b' ' | b'>' | b'/' | b'\t' | b'\n')) {
            return true;
        }
    }
    false
}

/// Both sides reduced to what a reader would actually see differently.
///
/// **Every rule here is one thing this app does on purpose**, and this list is the
/// only written record of them:
///
/// 1. Every heading carries an `id`, so a table of contents and an in-document
///    link have something to point at. The specification's headings carry none.
/// 2. Links carry `rel="noopener noreferrer"`.
/// 3. `#5` becomes a link to that issue — a GitHub extra, not CommonMark.
/// 4. A local image's `src` is rewritten to the protocol the web view can fetch
///    it over, since a file path is not a URL the page may load.
/// 5. HTML5, not XHTML: `<hr>` where the specification writes `<hr />`.
/// 6. Entities are written out — `&quot;` and `"` are one character, and a
///    non-breaking space is a character to us and an entity to the specification.
/// 7. An HTML comment does not survive the sanitizer, and a comment is not
///    content.
/// 8. Whitespace between two tags, and at the end of a line, is not content.
fn normalize(html: &str) -> String {
    let mut out = without_heading_ids(html);
    out = out.replace(OUR_REL, "");
    out = unwrap_issue_links(&out);
    out = out.replace(&format!("\"{}", local_image_url_prefix()), "\"");
    out = out.replace(" />", ">");
    for (entity, character) in [
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&nbsp;", "\u{a0}"),
    ] {
        out = out.replace(entity, character);
    }
    out = without_comments(&out);
    out = without_highlight_marks(&out);
    out = without_alt_as_title(&out);
    collapse_between_tags(out.trim())
}

/// An image with no title of its own is given its alt text as one, so hovering
/// says what the picture is. The specification leaves the title off.
fn without_alt_as_title(html: &str) -> String {
    let mut out = html.to_string();
    let mut from = 0;
    while let Some(at) = out[from..].find("<img ").map(|at| from + at) {
        let Some(close) = out[at..].find('>').map(|end| at + end) else {
            break;
        };
        let tag = out[at..close].to_string();
        match (attribute(&tag, "alt"), attribute(&tag, "title")) {
            (Some(alt), Some(title)) if alt == title => {
                let mark = format!(" title=\"{title}\"");
                let trimmed = tag.replace(&mark, "");
                out.replace_range(at..close, &trimmed);
            }
            _ => {}
        }
        from = at + 5;
    }
    out
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let open = format!(" {name}=\"");
    let at = tag.find(&open)? + open.len();
    let end = tag[at..].find('"')? + at;
    Some(tag[at..end].to_string())
}

/// A highlighted code block wears the language it was highlighted as. Syntax
/// highlighting is ours; the specification prints a bare `<pre>`.
fn without_highlight_marks(html: &str) -> String {
    let mut out = html.replace("<pre class=\"highlight\"", "<pre");
    while let Some(at) = out.find(" data-language=\"") {
        let after = at + " data-language=\"".len();
        let Some(end) = out[after..].find('"') else {
            break;
        };
        out.replace_range(at..after + end + 1, "");
    }
    out
}

/// Whitespace between two tags is not content, so `</pre>\n</blockquote>` and
/// `</pre></blockquote>` are one thing. Inside `<pre>` it *is* content, which is
/// the whole reason this walks the string rather than replacing.
///
/// Byte by byte is safe here: `<`, `>` and ASCII whitespace never appear inside a
/// multi-byte character.
fn collapse_between_tags(html: &str) -> String {
    let bytes = html.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut in_pre = false;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'<' {
            if html[index..].starts_with("<pre") {
                in_pre = true;
            } else if html[index..].starts_with("</pre") {
                in_pre = false;
            }
        }
        if bytes[index] == b'>' && !in_pre {
            out.push(b'>');
            let mut next = index + 1;
            while next < bytes.len() && bytes[next].is_ascii_whitespace() {
                next += 1;
            }
            // Only when a tag follows. Whitespace before text is content.
            if next < bytes.len() && bytes[next] == b'<' {
                index = next;
            } else {
                out.extend_from_slice(&bytes[index + 1..next]);
                index = next;
            }
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| html.to_string())
}

/// What a local image's destination gets prefixed with, asked of the app rather
/// than written down here — the two must never disagree.
fn local_image_url_prefix() -> String {
    let sample = local_image_webview_url("<name>");
    sample.strip_suffix("<name>").unwrap_or(&sample).to_string()
}

fn without_heading_ids(html: &str) -> String {
    let mut out = html.to_string();
    for level in 1..=6 {
        let open = format!("<h{level} id=\"");
        while let Some(at) = out.find(&open) {
            let after = at + open.len();
            let Some(end) = out[after..].find("\">") else {
                break;
            };
            out.replace_range(at..after + end + 2, &format!("<h{level}>"));
        }
    }
    out
}

/// `<a class="github-ref …">#5</a>` back to `#5`.
fn unwrap_issue_links(html: &str) -> String {
    let mut out = html.to_string();
    while let Some(at) = out.find("<a class=\"github-ref") {
        let Some(open_end) = out[at..].find('>').map(|end| at + end + 1) else {
            break;
        };
        let Some(close) = out[open_end..].find("</a>").map(|end| open_end + end) else {
            break;
        };
        let text = out[open_end..close].to_string();
        out.replace_range(at..close + 4, &text);
    }
    out
}

fn without_comments(html: &str) -> String {
    let mut out = html.to_string();
    while let Some(start) = out.find("<!--") {
        let Some(end) = out[start..].find("-->").map(|end| start + end + 3) else {
            break;
        };
        out.replace_range(start..end, "");
    }
    out
}

fn rendered(source: &str) -> String {
    let path = markdown_stand_in_path();
    render_markdown_body(MarkdownSource {
        markdown: source,
        source_path: &path,
        host: &DesktopHost::default(),
    })
}

fn compare(suite: Suite) {
    let all = cases(suite);
    if all.is_empty() {
        return;
    }
    let mut report = Report::new(suite, Property::Meaning);
    let mut set_aside = 0;
    for case in &all {
        let Some(expected) = &case.expected else {
            continue;
        };
        let section = case.section.as_deref().unwrap_or_default();
        if SANITIZED.contains(&section) || mentions_raw_html(&case.source) {
            set_aside += 1;
            continue;
        }
        let wrong = (normalize(&rendered(&case.source)) != normalize(expected))
            .then(|| format!("renders differently from the specification ({section})"));
        report.record(&case.name, wrong);
    }
    // Said out loud: a suite that quietly skipped a third of itself would read as
    // full coverage.
    println!(
        "conformance {} meaning: {set_aside} cases set aside as raw HTML",
        suite.label()
    );
    report.finish();
}

#[test]
fn commonmark_renders_what_the_specification_prints() {
    compare(Suite::CommonMark);
}

#[test]
fn gfm_renders_what_the_specification_prints() {
    compare(Suite::Gfm);
}

#[test]
fn the_normalizer_only_ever_erases_a_difference_we_chose() {
    // Each rule proved on its own, so a rule that stops being true is caught here
    // rather than by hundreds of cases quietly starting to pass.
    assert_eq!(
        normalize(&format!("<a href=\"/x\"{OUR_REL}>y</a>")),
        "<a href=\"/x\">y</a>"
    );
    assert_eq!(normalize("<p>&quot;x&quot;</p>"), "<p>\"x\"</p>");
    assert_eq!(normalize("<p>a&nbsp;b</p>"), "<p>a\u{a0}b</p>");
    assert_eq!(normalize("<p>x</p>  \n\n"), "<p>x</p>");
    assert_eq!(normalize("<h2 id=\"a-b\">a b</h2>"), "<h2>a b</h2>");
    assert_eq!(
        normalize("<a class=\"github-ref issue-ref\" href=\"/x\">#5</a>"),
        "#5"
    );
    assert_eq!(normalize("<hr />"), "<hr>");
    assert_eq!(normalize("<p>a<!-- x -->b</p>"), "<p>ab</p>");
    assert_eq!(
        normalize(&format!(
            "<img src=\"{}train.jpg\">",
            local_image_url_prefix()
        )),
        "<img src=\"train.jpg\">"
    );
    // And it erases nothing else: a real divergence still reads as one.
    assert_ne!(normalize("<p>a</p>"), normalize("<p>b</p>"));
}
