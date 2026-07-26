//! Source-anchored editing: block maps, splices, undo.

use super::*;

#[test]
fn data_blocks_never_take_the_markdown_wysiwyg_path() {
    // `editable` drives the Markdown path, which edits a block as rendered text
    // and would write `hi` where `"hi"` belongs. Data blocks are edited as source
    // instead, so the flag stays false and the kinds stay out of Markdown's
    // vocabulary (`paragraph`/`heading`), which that path switches on.
    let yaml = "name: Release\nshell: bash\n";
    for blocks in [
        render_json_document(PACKAGE_JSON, None).2,
        render_yaml_document(yaml, None).2,
    ] {
        assert!(!blocks.is_empty());
        for block in blocks {
            assert!(!block.editable, "{block:?}");
            assert!(block.kind.starts_with("data_"), "{block:?}");
        }
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

    // A table is its own overflow container, so a number hung outside it would be
    // clipped invisible; it alone keeps the carved-gutter scheme (40px left
    // padding pulled back with a matching negative margin, number seated inside).
    assert!(css.contains(
        ".document-body table.has-anchor-link {\n  padding-left: 40px;\n  margin-left: -40px;\n}"
    ));
    assert!(css.contains(
        ".document-body table.has-anchor-link > .heading-anchor {\n  right: auto;\n  left: 0;\n}"
    ));

    // A code block must not: the carve dragged its whole box off the reading
    // column's left edge. Its scroll moves to the <code> so the number can hang in
    // the shared gutter, sized and nudged to the code's first-line baseline.
    assert!(!css.contains("pre.has-anchor-link {\n  padding-left: 40px;"));
    assert!(!css.contains("pre.has-anchor-link,"));
    assert!(css.contains(
        ".document-body pre.has-anchor-link > .heading-anchor {\n  top: 1em;\n  font-size: 0.875em;\n}"
    ));
    assert!(css
        .contains(".document-body pre:has(> code) {\n  clip-path: none;\n  overflow: visible;\n}"));
    assert!(css.contains(
        ".document-body pre:has(> code) > code {\n  display: block;\n  overflow-x: auto;\n}"
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
