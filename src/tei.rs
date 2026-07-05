use crate::*;

// ---------------------------------------------------------------------------
// TEI XML renderer
// ---------------------------------------------------------------------------

/// Heading level for a div, from its nesting depth.
///
/// `type="translation"` is a transparent wrapper — it holds the whole translated
/// work but is not itself a titled section, so it emits no heading and leaves the
/// depth of the sections inside it unchanged.
///
/// Every other div is a nested section whose heading level follows nesting depth
/// alone (h2 at the top, one smaller per level, floored at h6). 84000 TEI nests
/// these types in varying orders — a `section` may contain a `chapter` and a
/// `chapter` may contain a `section` — so a fixed type→level table produces
/// inversions where a nested heading renders *larger* than the heading above it.
/// Depth-based levels keep a child heading always at or below its parent's size.
pub(crate) fn tei_div_heading_level(div_type: &str, depth: usize) -> Option<u8> {
    if div_type.eq_ignore_ascii_case("translation") {
        return None;
    }
    Some((2 + depth as u8).min(6))
}

/// GitHub-compatible slug from plain text (matches slugger.js behaviour).
pub(crate) fn tei_slugify(text: &str) -> String {
    let lower = text.to_lowercase();
    let cleaned: String = lower
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_numeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    cleaned.replace(' ', "-")
}

pub(crate) struct TeiCtx {
    out: String,
    footnotes: Vec<String>,
    fn_count: usize,
    seen: HashMap<String, usize>,
}

impl TeiCtx {
    fn new() -> Self {
        Self {
            out: String::new(),
            footnotes: Vec::new(),
            fn_count: 0,
            seen: HashMap::new(),
        }
    }

    fn unique_slug(&mut self, text: &str) -> String {
        let base = tei_slugify(text);
        let count = self.seen.entry(base.clone()).or_insert(0);
        let slug = if *count == 0 {
            base.clone()
        } else {
            format!("{base}-{count}")
        };
        *count += 1;
        slug
    }

    fn push(&mut self, s: &str) {
        self.out.push_str(s);
    }
}

/// Render the inline content of a node (text + inline children).
pub(crate) fn tei_render_inline<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx) -> String {
    let mut out = String::new();
    for child in node.children() {
        if child.is_text() {
            out.push_str(&encode_text(child.text().unwrap_or("")));
        } else if child.is_element() {
            let tag = child.tag_name().name().to_lowercase();
            match tag.as_str() {
                "note" if child.attribute("place") == Some("end") => {
                    ctx.fn_count += 1;
                    let n = ctx.fn_count;
                    let fn_html = tei_render_inline(child, ctx);
                    ctx.footnotes.push(fn_html);
                    // Avoid `ref{n}` in format strings (Rust 2021 lexer issue).
                    // Match the markdown renderer's footnote reference markup so
                    // CSS and numbering are identical (plain Arabic, no brackets).
                    let refid = format!("fnref{n}");
                    out.push_str(&format!(
                        "<sup class=\"footnote-reference\" id=\"{refid}\">\
                         <a href=\"#fn{n}\">{n}</a></sup>"
                    ));
                }
                "ptr" => {
                    // 84000 TEI puts the visible cross-reference label INSIDE
                    // <ptr> (e.g. <ptr target="...">Going forth</ptr>). Keep the
                    // label text; link it only when the target is an external URL
                    // (internal #ids don't map to our heading slugs).
                    let label = tei_render_inline(child, ctx);
                    if !label.is_empty() {
                        match child.attribute("target") {
                            Some(t) if t.starts_with("http://") || t.starts_with("https://") => {
                                out.push_str(&format!(
                                    "<a href=\"{}\">{label}</a>",
                                    encode_double_quoted_attribute(t)
                                ));
                            }
                            _ => out.push_str(&label),
                        }
                    }
                }
                "milestone" | "lb" | "caesura" => {
                    // omit
                }
                _ => {
                    // term, title, ref, foreign, hi, quote, etc. → strip tag, keep text
                    out.push_str(&tei_render_inline(child, ctx));
                }
            }
        }
    }
    out
}

/// Wrap verse lines in a blockquote so they render like a Markdown `>` quote
/// (left bar + hanging indent), with each `<l>` line on its own row.
pub(crate) fn tei_verse_blockquote(lines: &[String]) -> String {
    format!(
        "<blockquote class=\"tei-verse\">\n<p>{}</p>\n</blockquote>\n",
        lines.join("<br>\n")
    )
}

/// Render a run of block-level sibling elements, coalescing consecutive `<l>`
/// lines (verse lines not wrapped in an `<lg>`) into a single quote block so
/// they still render like a Markdown `>` quote when the `<lg>` group is absent.
pub(crate) fn tei_render_block_sequence<'a>(
    siblings: &[roxmltree::Node<'a, 'a>],
    ctx: &mut TeiCtx,
    depth: usize,
) {
    let is_line = |n: &roxmltree::Node| n.tag_name().name().eq_ignore_ascii_case("l");
    let mut i = 0;
    while i < siblings.len() {
        if is_line(&siblings[i]) {
            let mut lines = Vec::new();
            while i < siblings.len() && is_line(&siblings[i]) {
                lines.push(tei_render_inline(siblings[i], ctx));
                i += 1;
            }
            ctx.push(&tei_verse_blockquote(&lines));
        } else {
            tei_render_node(siblings[i], ctx, depth);
            i += 1;
        }
    }
}

/// Render a TEI `<div>` element.
pub(crate) fn tei_render_div<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx, depth: usize) {
    let div_type = node.attribute("type").unwrap_or("");

    let heading_level = tei_div_heading_level(div_type, depth);

    if heading_level.is_none() {
        // transparent container (e.g. div[@type="translation"])
        let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
        tei_render_block_sequence(&children, ctx, depth);
        return;
    }
    let level = heading_level.unwrap();

    // Find and emit the <head> child first
    let head_node = node
        .children()
        .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("head"));
    if let Some(head) = head_node {
        // Collect ALL descendant text so inline children render too. Heads like
        // `<head>Prologue to <title>The Chapter on Going Forth</title></head>`
        // would otherwise keep only the leading "Prologue to " text node.
        let text = head
            .descendants()
            .filter(|c| c.is_text())
            .map(|c| c.text().unwrap_or(""))
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if !text.is_empty() {
            let id = ctx.unique_slug(&text);
            ctx.push(&format!(
                "<h{level} id=\"{}\">{}</h{level}>\n",
                encode_double_quoted_attribute(&id),
                encode_text(&text)
            ));
        }
    }

    // Render non-head children
    let children: Vec<_> = node
        .children()
        .filter(|c| c.is_element() && !c.tag_name().name().eq_ignore_ascii_case("head"))
        .collect();
    tei_render_block_sequence(&children, ctx, depth + 1);
}

/// Dispatch rendering for any TEI element node.
pub(crate) fn tei_render_node<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx, depth: usize) {
    if !node.is_element() {
        return;
    }
    let tag = node.tag_name().name().to_lowercase();
    match tag.as_str() {
        "div" => tei_render_div(node, ctx, depth),
        "p" => {
            let inner = tei_render_inline(node, ctx);
            ctx.push(&format!("<p>{inner}</p>\n"));
        }
        "lg" => {
            let lines: Vec<String> = node
                .children()
                .filter(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("l"))
                .map(|l| tei_render_inline(l, ctx))
                .collect();
            ctx.push(&tei_verse_blockquote(&lines));
        }
        "head" | "milestone" | "lb" | "ptr" | "caesura" => {
            // omit at top level; head is handled by renderDiv
        }
        _ => {
            // Recurse into unknown block elements, still coalescing bare `<l>`.
            let children: Vec<_> = node.children().filter(|c| c.is_element()).collect();
            tei_render_block_sequence(&children, ctx, depth);
        }
    }
}

/// Render `text > front` as a collapsed `<details>` so the summary,
/// acknowledgements, and introduction are available but out of the way by
/// default — the reader lands on the translation itself. The inner content uses
/// the same block machinery as the body, so its headings and anchors work
/// unchanged. Mirrors `renderFront` in site/tei-xml.js.
pub(crate) fn render_tei_front<'a>(front: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx) {
    // Render the front's children into `ctx.out`, then split that tail back off
    // so it can be wrapped. Slug and footnote side effects stay recorded on ctx.
    let start = ctx.out.len();
    let children: Vec<_> = front.children().filter(|c| c.is_element()).collect();
    tei_render_block_sequence(&children, ctx, 0);
    let inner = ctx.out.split_off(start);
    if inner.trim().is_empty() {
        return;
    }

    // Label the toggle with the section names it holds (e.g. "Summary,
    // Acknowledgements, Introduction"), falling back to a generic term.
    let heads: Vec<String> = front
        .children()
        .filter(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("div"))
        .filter_map(|d| {
            d.children()
                .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("head"))
        })
        .map(|head| {
            head.descendants()
                .filter(|c| c.is_text())
                .map(|c| c.text().unwrap_or(""))
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|t| !t.is_empty())
        .collect();
    let label = if heads.is_empty() {
        "Front matter".to_string()
    } else {
        heads.join(", ")
    };

    ctx.push(&format!(
        "<details class=\"tei-front\">\n\
         <summary class=\"tei-front-summary\">{}</summary>\n\
         <div class=\"tei-front-body\">\n",
        encode_text(&label)
    ));
    ctx.push(&inner);
    ctx.push("</div>\n</details>\n");
}

/// Parse TEI XML and return `(title, body_html)`.
/// Title is extracted from the `<teiHeader>` if possible.
pub(crate) fn render_tei_body(xml: &str) -> (Option<String>, String) {
    let doc = match roxmltree::Document::parse(xml) {
        Ok(d) => d,
        Err(_) => return (None, "<p><strong>XML parse error.</strong></p>".to_string()),
    };

    let root = doc.root_element();

    // Collect every `titleStmt > title` in document order. 84000 headers carry
    // a title matrix — `type` mainTitle/longTitle/otherTitle crossed with
    // `xml:lang` en / Sa-Ltn / bo / Bo-Ltn (lang casing varies) — so taking the
    // first title showed whichever language the file happened to list first.
    let titles: Vec<(String, String, String)> = root
        .descendants()
        .filter(|n| {
            n.is_element()
                && n.tag_name().name().eq_ignore_ascii_case("title")
                && n.parent()
                    .map(|p| p.tag_name().name().eq_ignore_ascii_case("titleStmt"))
                    .unwrap_or(false)
        })
        .filter_map(|n| {
            let text = n
                .children()
                .filter(|c| c.is_text())
                .map(|c| c.text().unwrap_or(""))
                .collect::<String>()
                .trim()
                .to_string();
            if text.is_empty() {
                return None;
            }
            let kind = n.attribute("type").unwrap_or("").to_ascii_lowercase();
            let lang = n
                .attributes()
                .find(|a| a.name().eq_ignore_ascii_case("lang"))
                .map(|a| a.value())
                .unwrap_or("")
                .to_ascii_lowercase();
            Some((kind, lang, text))
        })
        .collect();
    let pick = |kind: &str, lang: &str| {
        titles
            .iter()
            .find(|(k, l, _)| k == kind && l == lang)
            .map(|(_, _, text)| text.clone())
    };

    // The document title is the English main title. Fall back to the English
    // long title, then to the first title in any language except Tibetan
    // (which also covers plain untyped `<title>` elements).
    let title = pick("maintitle", "en")
        .or_else(|| pick("longtitle", "en"))
        .or_else(|| {
            titles
                .iter()
                .find(|(_, l, _)| l != "bo" && l != "bo-ltn")
                .map(|(_, _, text)| text.clone())
        });

    // Alternate-language title lines rendered under the main title, in this
    // order: Sanskrit main title, English long title, Sanskrit long title.
    // Tibetan titles are never shown. Sanskrit is set in italics; duplicates
    // of the main title or of an earlier line are dropped.
    let mut subtitles: Vec<(String, bool)> = Vec::new();
    for (text, italic) in [
        (pick("maintitle", "sa-ltn"), true),
        (pick("longtitle", "en"), false),
        (pick("longtitle", "sa-ltn"), true),
    ] {
        let Some(text) = text else { continue };
        if Some(&text) == title.as_ref() || subtitles.iter().any(|(t, _)| t == &text) {
            continue;
        }
        subtitles.push((text, italic));
    }

    // Find <text><body>
    let body = root.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name().eq_ignore_ascii_case("body")
            && n.parent()
                .map(|p| p.tag_name().name().eq_ignore_ascii_case("text"))
                .unwrap_or(false)
    });

    let Some(body) = body else {
        return (
            title,
            "<p><strong>No TEI body element found.</strong></p>".to_string(),
        );
    };

    let mut ctx = TeiCtx::new();

    // Title heading, then the alternate-language title lines beneath it.
    if let Some(ref t) = title {
        let id = ctx.unique_slug(t);
        ctx.push(&format!(
            "<h1 id=\"{}\">{}</h1>\n",
            encode_double_quoted_attribute(&id),
            encode_text(t)
        ));
    }
    if !subtitles.is_empty() {
        ctx.push("<div class=\"tei-doc-subtitles\">\n");
        for (text, italic) in &subtitles {
            let inner = encode_text(text);
            let inner = if *italic {
                format!("<em>{inner}</em>")
            } else {
                inner.into_owned()
            };
            ctx.push(&format!("<p class=\"tei-doc-subtitle\">{inner}</p>\n"));
        }
        ctx.push("</div>\n");
    }

    // Front matter (summary, acknowledgements, introduction) lives in
    // `text > front`, a sibling of `body`. Render it collapsed by default, after
    // the title and before the body.
    if let Some(front) = root.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name().eq_ignore_ascii_case("front")
            && n.parent()
                .map(|p| p.tag_name().name().eq_ignore_ascii_case("text"))
                .unwrap_or(false)
    }) {
        render_tei_front(front, &mut ctx);
    }

    let body_children: Vec<_> = body.children().filter(|c| c.is_element()).collect();
    tei_render_block_sequence(&body_children, &mut ctx, 0);

    // Append footnotes — build as a separate string to avoid borrow conflicts
    // while iterating `ctx.footnotes` and mutating `ctx.out`.
    if !ctx.footnotes.is_empty() {
        // Match the markdown renderer's footnote markup: `<div
        // class="footnote-definition">` blocks (not an `<ol>`, which would inherit
        // the upper-roman list style) with the shared SVG back-reference icon.
        let icon = footnote_backref_icon_svg();
        let mut fn_section = String::from("<section class=\"footnotes\">\n");
        for (i, fn_html) in ctx.footnotes.iter().enumerate() {
            let n = i + 1;
            // Avoid `ref{n}` in format strings (Rust 2021 lexer issue).
            let backref = format!("#fnref{n}");
            fn_section.push_str(&format!(
                "<div class=\"footnote-definition\" id=\"fn{n}\">\
                 <sup class=\"footnote-definition-label\">{n}</sup>\
                 <p>{fn_html} <a class=\"footnote-backref\" href=\"{backref}\" \
                 aria-label=\"Back to content\">{icon}</a></p></div>\n"
            ));
        }
        fn_section.push_str("</section>\n");
        ctx.out.push_str(&fn_section);
    }

    (title, ctx.out)
}
