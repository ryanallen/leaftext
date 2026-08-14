use crate::*;

// ---------------------------------------------------------------------------
// TEI XML renderer
// ---------------------------------------------------------------------------

/// Heading level for a div, from nesting depth (h2 at top, one smaller per level, floored at h6). Depth-based rather than type-based because 84000 TEI nests div types in varying orders, so a type→level table would invert sizes. `type="translation"` is a transparent wrapper: no heading, depth unchanged.
pub(crate) fn tei_div_heading_level(div_type: &str, depth: usize) -> Option<u8> {
    if div_type.eq_ignore_ascii_case("translation") {
        return None;
    }
    Some((2 + depth as u8).min(6))
}

/// GitHub-compatible slug from plain text (matches slugger.js behavior).
pub(crate) fn tei_slugify(text: &str) -> String {
    let lower = text.to_lowercase();
    let cleaned: String = lower
        .chars()
        .filter(|c| c.is_alphabetic() || c.is_numeric() || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    cleaned.replace(' ', "-")
}

pub(crate) struct TeiCtx {
    pub(crate) out: String,
    footnotes: Vec<String>,
    fn_count: usize,
    seen: HashMap<String, usize>,
    /// Source-anchored editing map: one entry per editable block in document order, tying it to its roxmltree node's byte range. The range is stamped inline as the element is emitted, so nesting depth doesn't matter.
    pub(crate) blocks: Vec<BlockSpan>,
    next_block_id: usize,
}

impl TeiCtx {
    fn new() -> Self {
        Self {
            out: String::new(),
            footnotes: Vec::new(),
            fn_count: 0,
            seen: HashMap::new(),
            blocks: Vec::new(),
            next_block_id: 0,
        }
    }

    /// Record a `kind` block for `node` and return the `data-*` attribute string to stamp on its opening tag. Ranges come from roxmltree's `Node::range()`.
    fn block_attrs(&mut self, kind: &'static str, node: roxmltree::Node) -> String {
        let range = node.range();
        let id = self.next_block_id;
        self.next_block_id += 1;
        self.blocks
            .push(BlockSpan::new(id, kind, range.start, range.end));
        format!(
            " data-block-id=\"{id}\" data-src-start=\"{}\" data-src-end=\"{}\" data-block-kind=\"{kind}\"{}",
            range.start,
            range.end,
            if kind_is_editable(kind) {
                " data-editable=\"true\""
            } else {
                ""
            }
        )
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
                    // `fnref{n}` split out to avoid the Rust 2021 `ref{n}` lexer issue; markup matches the markdown renderer's footnotes.
                    let refid = format!("fnref{n}");
                    out.push_str(&format!(
                        "<sup class=\"footnote-reference\" id=\"{refid}\">\
                         <a href=\"#fn{n}\">{n}</a></sup>"
                    ));
                }
                "ptr" => {
                    // 84000 puts the cross-reference label inside <ptr>. Keep the text; link it only for external URLs (internal #ids don't map to our heading slugs).
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
                    // term/title/ref/foreign/hi/quote/etc. → strip tag, keep text
                    out.push_str(&tei_render_inline(child, ctx));
                }
            }
        }
    }
    out
}

/// Wrap verse lines in a blockquote so they render like a Markdown `>` quote (left bar + hanging indent), with each `<l>` line on its own row.
pub(crate) fn tei_verse_blockquote(lines: &[String]) -> String {
    format!(
        "<blockquote class=\"tei-verse\">\n<p>{}</p>\n</blockquote>\n",
        lines.join("<br>\n")
    )
}

/// Render a run of block-level siblings, coalescing consecutive `<l>` lines (verse lines not wrapped in an `<lg>`) into a single quote block so they still render like a Markdown `>` quote when the `<lg>` group is absent.
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
        let children: Vec<_> = node.children().filter(is_block_node).collect();
        tei_render_block_sequence(&children, ctx, depth);
        return;
    }
    let level = heading_level.unwrap();

    // Find and emit the <head> child first
    let head_node = node
        .children()
        .find(|c| c.is_element() && c.tag_name().name().eq_ignore_ascii_case("head"));
    if let Some(head) = head_node {
        // Collect all descendant text so inline children (e.g. a nested `<title>`) render, not just the leading text node.
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
            let attrs = ctx.block_attrs("heading", head);
            ctx.push(&format!(
                "<h{level}{attrs} id=\"{}\">{}</h{level}>\n",
                encode_double_quoted_attribute(&id),
                encode_text(&text)
            ));
        }
    }

    // Render non-head children
    let children: Vec<_> = node
        .children()
        .filter(|c| is_block_node(c) && !c.tag_name().name().eq_ignore_ascii_case("head"))
        .collect();
    tei_render_block_sequence(&children, ctx, depth + 1);
}

/// Dispatch rendering for any TEI node standing between blocks.
pub(crate) fn tei_render_node<'a>(node: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx, depth: usize) {
    if node.is_comment() {
        let attrs = ctx.block_attrs("comment", node);
        let html = xml_comment_html(&attrs, node.text().unwrap_or(""));
        ctx.push(&html);
        return;
    }
    if !node.is_element() {
        return;
    }
    let tag = node.tag_name().name().to_lowercase();
    match tag.as_str() {
        "div" => tei_render_div(node, ctx, depth),
        "p" => {
            let inner = tei_render_inline(node, ctx);
            let attrs = ctx.block_attrs("paragraph", node);
            ctx.push(&format!("<p{attrs}>{inner}</p>\n"));
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
            let children: Vec<_> = node.children().filter(is_block_node).collect();
            tei_render_block_sequence(&children, ctx, depth);
        }
    }
}

/// Render `text > front` as a collapsed `<details>` so front matter is out of the way by default and the reader lands on the translation. Uses the same block machinery as the body.
pub(crate) fn render_tei_front<'a>(front: roxmltree::Node<'a, 'a>, ctx: &mut TeiCtx) {
    // Render into `ctx.out`, then split that tail off to wrap it; slug and footnote side effects stay recorded on ctx.
    let start = ctx.out.len();
    let children: Vec<_> = front.children().filter(is_block_node).collect();
    tei_render_block_sequence(&children, ctx, 0);
    let inner = ctx.out.split_off(start);
    if inner.trim().is_empty() {
        return;
    }

    // Label the toggle with the section names it holds, or a generic fallback.
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

/// Render a parsed TEI document into reading HTML and the block source map in a single traversal, returning the title and the fully populated context (`ctx.out` is the HTML, `ctx.blocks` the source map).
pub(crate) fn render_tei_inner<'a>(doc: &'a roxmltree::Document<'a>) -> (Option<String>, TeiCtx) {
    let mut ctx = TeiCtx::new();
    let root = doc.root_element();

    // Collect every `titleStmt > title` in document order. 84000 headers carry a matrix of titles (type × language), so we pick by type/lang below rather than taking whichever the file lists first.
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

    // The document title is the English main title. Fall back to the English long title, then to the first title in any language except Tibetan (which also covers plain untyped `<title>` elements).
    let title = pick("maintitle", "en")
        .or_else(|| pick("longtitle", "en"))
        .or_else(|| {
            titles
                .iter()
                .find(|(_, l, _)| l != "bo" && l != "bo-ltn")
                .map(|(_, _, text)| text.clone())
        });

    // Alternate-language title lines rendered under the main title, in this order: Sanskrit main title, English long title, Sanskrit long title. Tibetan titles are never shown. Sanskrit is set in italics; duplicates of the main title or of an earlier line are dropped.
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
        ctx.push("<p><strong>No TEI body element found.</strong></p>");
        return (title, ctx);
    };

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

    // Front matter (summary, acknowledgments, introduction) lives in `text > front`, a sibling of `body`. Render it collapsed by default, after the title and before the body.
    if let Some(front) = root.descendants().find(|n| {
        n.is_element()
            && n.tag_name().name().eq_ignore_ascii_case("front")
            && n.parent()
                .map(|p| p.tag_name().name().eq_ignore_ascii_case("text"))
                .unwrap_or(false)
    }) {
        render_tei_front(front, &mut ctx);
    }

    let body_children: Vec<_> = body.children().filter(is_block_node).collect();
    tei_render_block_sequence(&body_children, &mut ctx, 0);

    // Append footnotes — built as a separate string to avoid borrowing `ctx.footnotes` while mutating `ctx.out`.
    if !ctx.footnotes.is_empty() {
        // `footnote-definition` blocks (not an `<ol>`, which would inherit the upper-roman list style), matching the markdown renderer.
        let icon = footnote_backref_icon_svg();
        let mut fn_section = String::from("<section class=\"footnotes\">\n");
        for (i, fn_html) in ctx.footnotes.iter().enumerate() {
            let n = i + 1;
            // Split out to avoid the Rust 2021 `ref{n}` lexer issue.
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

    (title, ctx)
}
