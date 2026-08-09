//! Source-anchored editing: block maps, splices, undo.

use super::*;

#[test]
fn data_blocks_never_take_the_markdown_wysiwyg_path() {
    // `editable` drives the Markdown path, which edits a block as rendered text and would write `hi` where `"hi"` belongs. Data blocks are edited as source instead, so the flag stays false and the kinds stay out of Markdown's vocabulary (`paragraph`/`heading`), which that path switches on.
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
fn the_code_view_is_colored_by_the_active_themes_own_tokens() {
    // The editor brings its own default palette; handing it one built from the theme's tokens is what keeps the source view looking like the rest of the app when the theme changes. Rules and UI colors both, since Monaco takes them from different halves of a theme definition.
    let html = app_shell_page();

    for expected in [
        "rule('keyword', t('--lt-syntax-keyword'), 'bold')",
        "rule('comment', t('--lt-syntax-comment'), 'italic')",
        "'editor.background': hash('--lt-syntax-background')",
        "'editor.selectionBackground': hash('--lt-editor-code-selection-background')",
        // A theme or light/dark flip re-skins the open editor in place.
        "window.LeafMonaco.editor.setTheme(defineLeafMonacoTheme(window.LeafMonaco));",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn toggle_task_flips_the_addressed_marker_and_tracks_dirty() {
    let markdown = "- [ ] one\n- [x] two\n";
    let mut edit = EditableDocument::new(
        PathBuf::from("todo.md"),
        SourceText::utf8(markdown.to_string()),
    );
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
    let mut edit = EditableDocument::new(
        PathBuf::from("doc.xml"),
        SourceText::utf8("<p>[ ]</p>".to_string()),
    );
    assert!(!edit.toggle_task(0));
    assert_eq!(edit.text(), "<p>[ ]</p>");
}

#[test]
fn checkbox_edits_flip_the_marker_but_record_no_undo() {
    // The auto-saving checkbox path flips the same byte as toggle_task, but leaves nothing on the undo stack — a checkbox toggle is deliberately not undoable.
    let markdown = "- [ ] one\n- [ ] two\n";
    let mut edit = EditableDocument::new(
        PathBuf::from("todo.md"),
        SourceText::utf8(markdown.to_string()),
    );

    assert!(edit.toggle_task_without_undo(0));
    assert_eq!(edit.text(), "- [x] one\n- [ ] two\n");
    assert!(!edit.can_undo());

    edit.replace_range_without_undo(0, 5, "- [x]");
    assert_eq!(edit.text(), "- [x] one\n- [ ] two\n");
    assert!(!edit.can_undo());
}

#[test]
fn replace_range_splices_and_clamps_safely() {
    let mut edit = EditableDocument::new(
        PathBuf::from("a.md"),
        SourceText::utf8("hello world".to_string()),
    );
    assert!(edit.replace_range(6, 11, "there"));
    assert_eq!(edit.text(), "hello there");

    // Out-of-range end is clamped to the buffer length.
    edit.replace_range(6, 9999, "friend");
    assert_eq!(edit.text(), "hello friend");

    // A start past end is treated as an insertion at start.
    let mut edit2 =
        EditableDocument::new(PathBuf::from("b.md"), SourceText::utf8("abc".to_string()));
    edit2.replace_range(1, 0, "X");
    assert_eq!(edit2.text(), "aXbc");

    // A range that falls inside a multi-byte char snaps outward, never panics.
    let mut edit3 =
        EditableDocument::new(PathBuf::from("c.md"), SourceText::utf8("café".to_string()));
    edit3.replace_range(3, 4, "e"); // 'é' is two bytes (3..5)
    assert_eq!(edit3.text(), "cafe");
}

#[test]
fn moving_a_block_rotates_the_text_and_leaves_the_separators_alone() {
    let markdown = "# Title\n\nFirst.\n\nSecond.\n";
    let mut edit = EditableDocument::new(
        PathBuf::from("doc.md"),
        SourceText::utf8(markdown.to_string()),
    );
    // The three blocks, as the reading view stamps them: heading, then two paragraphs. The blank lines between them are not in any range.
    let ranges = [(0, 7), (9, 15), (17, 24)];

    // Drag the last paragraph to the top: the texts rotate, the `\n\n` gaps and the trailing newline stay exactly where they were.
    assert!(edit.move_blocks(&ranges, 2, 0));
    assert_eq!(edit.text(), "Second.\n\n# Title\n\nFirst.\n");
    assert!(edit.can_undo());

    // One undo puts the whole move back — a drag is one edit, not three splices.
    assert!(edit.undo());
    assert_eq!(edit.text(), markdown);
}

#[test]
fn moving_a_block_refuses_a_range_list_it_cannot_trust() {
    let mut edit = EditableDocument::new(
        PathBuf::from("doc.md"),
        SourceText::utf8("# Title\n\nBody.\n".to_string()),
    );
    let good = [(0, 7), (9, 14)];

    // A no-op, a slot that isn't there, and a run of one have nothing to move.
    assert!(!edit.move_blocks(&good, 0, 0));
    assert!(!edit.move_blocks(&good, 0, 9));
    assert!(!edit.move_blocks(&[(0, 7)], 0, 0));
    // Overlapping, out of order, and past the end of the buffer: a drifted map must not get to shred the file.
    assert!(!edit.move_blocks(&[(0, 9), (5, 14)], 1, 0));
    assert!(!edit.move_blocks(&[(9, 14), (0, 7)], 1, 0));
    assert!(!edit.move_blocks(&[(0, 7), (9, 99)], 1, 0));
    assert_eq!(edit.text(), "# Title\n\nBody.\n");
    assert!(!edit.can_undo());
}

#[test]
fn moving_a_field_in_a_structured_file_keeps_its_commas_in_place() {
    // JSON separators live between the ranges, so rotating the values through their own slots is the one move that can't invalidate the syntax.
    let json = "{\n  \"a\": 1,\n  \"b\": 2\n}\n";
    let mut edit = EditableDocument::new(
        PathBuf::from("doc.json"),
        SourceText::utf8(json.to_string()),
    );
    let a = json.find("\"a\"").expect("key a is in the source");
    let b = json.find("\"b\"").expect("key b is in the source");
    assert!(edit.move_blocks(&[(a, a + 6), (b, b + 6)], 1, 0));
    assert_eq!(edit.text(), "{\n  \"b\": 2,\n  \"a\": 1\n}\n");
}

#[test]
fn undo_reverts_reading_view_edits_newest_first() {
    let markdown = "# Title\n\nBody.\n\n- [ ] task\n";
    let mut edit = EditableDocument::new(
        PathBuf::from("doc.md"),
        SourceText::utf8(markdown.to_string()),
    );
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
    // The raw source travels too, so blocks that don't round-trip WYSIWYG (lists, tables, code) can be edited as their exact Markdown source.
    assert_eq!(document.source, markdown);
    assert_eq!(document.tasks, task_marker_offsets(markdown));
    assert_eq!(document.tasks.len(), 1);
    assert!(document
        .blocks
        .iter()
        .any(|b| b.kind == "heading" && b.editable));
}

#[test]
fn the_reading_view_has_no_gutter_line_numbers() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The gutter permalink numbers are gone: three elements per addressable block (150,000 on a large glossary, tripling it) to show one number on hover, behind a setting that was off by default.
    for absent in [
        "decorateAnchorLinks",
        "ensureAnchorLinkTargets",
        "anchorLinkTemplate",
        "assignLocus",
        "uniqueAnchorBlockId",
        "heading-anchor",
        "has-anchor-link",
        "locus-alias",
        "dataset.locus",
        "lineNumbersEnabled",
        "lineNumbersButton",
        "setLineNumbersEnabled",
        "actions.anchorLink",
        "toolbar.lineNumbers",
        "settings.lineNumbers",
        "data-line-numbers-enabled",
    ] {
        assert!(
            !html.contains(absent) && !css.contains(absent),
            "the reading view's line numbers are gone; found {absent}"
        );
    }

    // What the numbers were nice for survives: the outline still reports how long the document is. Counted rather than stamped onto every block.
    assert!(html.contains("function documentLineCount(body)"));
    assert!(html.contains("const DOCUMENT_LINE_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]'"));
    assert!(html
        .contains("summaryCount.textContent = `(${formatCount(documentLineCount(body))} lines)`;"));
    // Link-only outline entries and footnote definitions are not body lines.
    assert!(html.contains("function isNavOutlineItem(el)"));
    assert!(html.contains("target.classList.contains('footnote-definition')"));
    // Headings keep their slug ids, so the TOC and #slug deep links still resolve.
    assert!(html.contains("if (!h.id) h.id = 'section-' + (i + 1);"));
}

#[test]
fn block_source_map_covers_top_level_blocks_in_order() {
    let markdown = "# Title\n\nA paragraph.\n\n- one\n- two\n\n```rust\nfn main() {}\n```\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(kinds, ["heading", "paragraph", "list", "code_block"]);

    // Ids are assigned in document order, and every range slices back to the exact source that produced the block — the property later in-viewer editing depends on.
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
fn block_source_map_leaves_out_a_leading_field_block() {
    // The renderer draws the field block from its own parse, so the page has one skipped div where this map would otherwise report two spans: the opening `---` reads as a rule, and the lines under it plus the closing fence read as a setext heading. One span the walk cannot pair with drops every range in the document, so a note that starts with fields had no editable block at all.
    let markdown = super::web_core::MARKDOWN_FIXTURE;
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert!(!kinds.contains(&"rule"), "{kinds:?}");
    assert_eq!(kinds.first(), Some(&"heading"), "{kinds:?}");
    assert_eq!(&markdown[spans[0].start..spans[0].end], "# Heading");
}

#[test]
fn block_source_map_keeps_file_offsets_past_a_field_block() {
    // The body is parsed on its own, so every range would address the body and not the file until the block's own length goes back on. Read the ranges back out of the whole document: an unshifted span would slice the wrong text rather than fail loudly.
    let markdown = "---\ntitle: Notes\n---\n\n# Heading\n\nA paragraph.\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(kinds, ["heading", "paragraph"]);
    assert_eq!(&markdown[spans[0].start..spans[0].end], "# Heading");
    assert_eq!(&markdown[spans[1].start..spans[1].end], "A paragraph.");
}

#[test]
fn block_source_map_takes_only_the_leading_fences() {
    // A `---` in the body is a thematic break a reader can see and edit around, and an empty field block is still a field block. Trimming by "drop anything that looks like a fence" would take the first and miss the second.
    let with_rule = "---\ntitle: Notes\n---\n\nBefore.\n\n---\n\nAfter.\n";
    let kinds: Vec<&str> = block_source_map(with_rule)
        .iter()
        .map(|span| span.kind)
        .collect();
    assert_eq!(kinds, ["paragraph", "rule", "paragraph"]);

    let empty_block = "---\n---\n\nJust a paragraph.\n";
    let spans = block_source_map(empty_block);
    assert_eq!(spans.len(), 1, "{spans:?}");
    assert_eq!(
        &empty_block[spans[0].start..spans[0].end],
        "Just a paragraph."
    );
}

#[test]
fn block_source_map_maps_rules_and_ignores_nested_blocks() {
    // A thematic break is a top-level block even though it has no Start/End pair; list items and inline emphasis are nested, so they fold into their enclosing block rather than getting their own top-level spans.
    let markdown = "Para *one*.\n\n---\n\n> quote\n";
    let kinds: Vec<&str> = block_source_map(markdown)
        .iter()
        .map(|span| span.kind)
        .collect();
    assert_eq!(kinds, ["paragraph", "rule", "blockquote"]);
}

#[test]
fn block_source_map_treats_html_wrapper_open_and_close_as_separate_blocks() {
    // A `<div align="center">` wrapper (as the README uses) opens and closes with its own raw-HTML blocks, and the blocks between get their own spans. The reading-view editor relies on this: it descends into the rendered wrapper to reach those inner blocks, and recognizes the closing `</div>` block (which renders to no element) by its `</` source so it can step over it.
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

    // The opening wrapper slices back to just the `<div ...>` tag, and the closing wrapper to `</div>` — the two ends the editor tells apart by their source.
    assert!(markdown[spans[0].start..spans[0].end].starts_with("<div"));
    assert!(markdown[spans[3].start..spans[3].end]
        .trim_start()
        .starts_with("</div"));

    // The inner heading and paragraph are ordinary editable blocks, unaffected by living inside the wrapper.
    assert!(spans[1].editable);
    assert!(markdown[spans[1].start..spans[1].end].starts_with("# Title"));
    assert!(markdown[spans[2].start..spans[2].end].starts_with("Inside the box."));
}

#[test]
fn block_source_map_leaves_out_a_comment_between_two_paragraphs() {
    // The comment is stripped before the page ever sees it, so a span for it is one the walk cannot pair with — and one unpaired span drops every range in the document, which is how a single comment line took editing away from a whole file.
    let markdown = "Before.\n\n<!-- a note -->\n\nAfter.\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(kinds, ["paragraph", "paragraph"], "{spans:?}");
    assert_eq!(&markdown[spans[0].start..spans[0].end], "Before.");
    assert_eq!(&markdown[spans[1].start..spans[1].end], "After.");
    assert_eq!(
        spans[1].id, 1,
        "ids stay in document order with none missing"
    );
}

#[test]
fn block_source_map_leaves_a_table_its_span_under_a_comment() {
    // The shape table-scanner's comment finder was written for: a comment touching a table, with and without a blank line between them. The table keeps the range a cell write rides on either way.
    for markdown in [
        "<!-- schema -->\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
        "<!-- schema -->\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
    ] {
        let spans = block_source_map(markdown);
        let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
        assert_eq!(kinds, ["table"], "{markdown:?} gave {spans:?}");
        assert!(markdown[spans[0].start..spans[0].end].starts_with("| a | b |"));
    }
}

#[test]
fn block_source_map_leaves_out_a_comment_sharing_its_line() {
    // Two comments on one line are one block, and a comment with text after it is one block whose survivor is a bare text node — not an element, so neither can be stamped and neither may take the document's other blocks with it.
    for markdown in [
        "Before.\n\n<!-- a --> <!-- b -->\n\nAfter.\n",
        "Before.\n\n<!-- x --> text\n\nAfter.\n",
    ] {
        let kinds: Vec<&str> = block_source_map(markdown)
            .iter()
            .map(|span| span.kind)
            .collect();
        assert_eq!(kinds, ["paragraph", "paragraph"], "{markdown:?}");
    }
}

#[test]
fn block_source_map_leaves_out_a_script_or_style_block() {
    // The sanitizer removes these two with their contents, so they reach the page as nothing exactly as a comment does — the same fault, not a comment-only one.
    for markdown in [
        "Before.\n\n<script>alert(1)</script>\n\nAfter.\n",
        "Before.\n\n<style>p { color: red; }</style>\n\nAfter.\n",
        "Before.\n\n<script>\nalert(1)\n",
    ] {
        let kinds: Vec<&str> = block_source_map(markdown)
            .iter()
            .map(|span| span.kind)
            .collect();
        assert!(
            !kinds.contains(&"html_block"),
            "{markdown:?} gave {kinds:?}"
        );
    }
}

#[test]
fn block_source_map_reports_a_footnote_where_the_page_draws_it() {
    // The renderer moves every definition to the foot of the page in reference order; this map is built straight off the parser, in written order. The page pairs the two lists by position, so any disagreement stamps one block's bytes on another block's element — the way a click into the paragraph under a footnote once opened the footnote's own text and wrote the keystrokes over it. This is the one test that fails if the two orderings ever part company.
    let markdown = "First.[^second]\n\nSecond.[^first]\n\n[^first]: Defined first.\n\n[^second]: Defined second.\n\n## Later\n\nTrailing prose.\n";
    let document = opened_document_from_markdown(markdown, "note.md");

    // The label off each footnote span, in the order the host reports them.
    let mapped: Vec<&str> = document
        .blocks
        .iter()
        .filter(|span| span.kind == "footnote_definition")
        .map(|span| {
            let source = &markdown[span.start..span.end];
            let inner = source
                .strip_prefix("[^")
                .expect("a footnote span starts at its label");
            &inner[..inner.find(']').expect("the label closes")]
        })
        .collect();

    // The label off each definition the page draws, in the order it draws them.
    let mut drawn: Vec<&str> = Vec::new();
    let mut rest = document.html.as_str();
    while let Some(at) = rest.find(r#"<div class="footnote-definition" id=""#) {
        rest = &rest[at + r#"<div class="footnote-definition" id=""#.len()..];
        drawn.push(&rest[..rest.find('"').expect("the id closes")]);
    }

    assert_eq!(drawn, ["second", "first"], "{}", document.html);
    assert_eq!(mapped, drawn);

    // Both of them come after everything the file was written with, because that is where they are drawn.
    let kinds: Vec<&str> = document.blocks.iter().map(|span| span.kind).collect();
    assert_eq!(
        kinds,
        [
            "paragraph",
            "paragraph",
            "heading",
            "paragraph",
            "footnote_definition",
            "footnote_definition"
        ]
    );
}

#[test]
fn block_source_map_keeps_every_block_under_a_footnote_on_its_own_bytes() {
    // The shape this was measured on: a footnote written in the middle of a note, with a maths line, a rule and a last paragraph under it. Every one of those was stamped with the block above it — the maths line showed the footnote's source, and the last paragraph inherited the rule's kind, which is the one kind the page never opens for editing.
    let markdown = "# Title\n\nOpening words.\n\n```mermaid\nflowchart TB\n    A --> B\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```rust\nfn main() {}\n```\n\n> A quote.\n\n## Middle\n\n- one\n- two\n\n### Note\n\nReferencing prose.[^1]\n\n[^1]: The note's own words.\n\n$$\nE = mc^2\n$$\n\n---\n\nThe last words in the file.\n";
    let spans = block_source_map(markdown);
    let kinds: Vec<&str> = spans.iter().map(|span| span.kind).collect();
    assert_eq!(
        kinds,
        [
            "heading",
            "paragraph",
            "code_block",
            "table",
            "code_block",
            "blockquote",
            "heading",
            "list",
            "heading",
            "paragraph",
            "paragraph",
            "rule",
            "paragraph",
            "footnote_definition"
        ],
        "{spans:?}"
    );

    let slice = |index: usize| &markdown[spans[index].start..spans[index].end];
    assert_eq!(slice(10), "$$\nE = mc^2\n$$");
    assert_eq!(slice(11), "---");
    assert_eq!(slice(12), "The last words in the file.");
    assert_eq!(slice(13), "[^1]: The note's own words.");

    // The last block of the file edits in place again: it is a paragraph, not the rule above it.
    assert!(spans[12].editable);

    // The id is a block's place in this list, which the move would otherwise leave pointing at where the footnote was written.
    let ids: Vec<usize> = spans.iter().map(|span| span.id).collect();
    assert_eq!(ids, (0..spans.len()).collect::<Vec<usize>>());
}

/// Every element drawn at the top level of the rendered body, named the way the page tells them apart, with the reader's own additions left out — the list the page pairs the block map against.
fn drawn_top_level_elements(html: &str) -> Vec<String> {
    const BODY: &str = r#"<article class="document-body">"#;
    let start = html.find(BODY).expect("a rendered body") + BODY.len();
    let inner = &html[start..];
    let inner = inner.strip_suffix("</article>").unwrap_or(inner);
    let mut drawn = Vec::new();
    let mut depth = 0usize;
    let mut rest = inner;
    while let Some(open) = rest.find('<') {
        rest = &rest[open + 1..];
        let close = rest.find('>').expect("a tag closes");
        let (tag, after) = (&rest[..close], &rest[close + 1..]);
        rest = after;
        if tag.starts_with('!') {
            continue;
        }
        if tag.starts_with('/') {
            depth = depth.saturating_sub(1);
            continue;
        }
        if depth == 0 {
            let name = tag.split([' ', '\n']).next().unwrap_or("");
            // The one class the page reads off an element it is pairing.
            drawn.push(if tag.contains(r#"class="footnote-definition""#) {
                format!("{name}.footnote-definition")
            } else {
                name.to_string()
            });
        }
        depth += 1;
    }
    // The Previous/Next strip is the reader's, not the document's; the page steps past it.
    drawn.retain(|name| name != "nav");
    drawn
}

#[test]
fn block_source_map_reports_a_footnote_written_inside_a_quote() {
    // The renderer lifts a footnote out of the quote it was written in and draws it at the foot as a top-level element, while the map only ever recorded top-level blocks — so the page had one element more than it had blocks, threw every range in the document away, and the whole note went read-only with nothing on screen saying why. This is the test that fails the moment a nested definition goes unmapped again.
    let markdown = "Text [^x] here.\n\n> a quote line\n>\n> [^x]: the note\n\nAfter the quote.\n";
    let document = opened_document_from_markdown(markdown, "note.md");

    assert_eq!(
        drawn_top_level_elements(&document.html),
        ["p", "blockquote", "p", "div.footnote-definition"],
        "{}",
        document.html
    );
    let kinds: Vec<&str> = document.blocks.iter().map(|span| span.kind).collect();
    assert_eq!(
        kinds,
        [
            "paragraph",
            "blockquote",
            "paragraph",
            "footnote_definition"
        ],
        "{:?}",
        document.blocks
    );
}

#[test]
fn block_source_map_reports_a_footnote_nested_in_every_shape_that_hides_one() {
    // The other three shapes that lift a definition out of a container: a quote holding nothing but the note, a list item holding nothing but the note, and a GitHub alert holding one. Each draws its container without the footnote *and* the footnote's own div, so each was one element over.
    for markdown in [
        "Text [^x] here.\n\n> [^x]: the note\n",
        "Text [^x] here.\n\n- [^x]: the note\n",
        "Text [^x] here.\n\n> [!NOTE]\n> a note\n>\n> [^x]: the note\n",
    ] {
        let document = opened_document_from_markdown(markdown, "note.md");
        let drawn = drawn_top_level_elements(&document.html);
        assert_eq!(
            drawn.len(),
            document.blocks.len(),
            "{markdown:?} draws {drawn:?} against {:?}",
            document.blocks
        );
        assert_eq!(
            drawn.last().map(String::as_str),
            Some("div.footnote-definition"),
            "{markdown:?}"
        );
        assert_eq!(
            document.blocks.last().map(|span| span.kind),
            Some("footnote_definition"),
            "{markdown:?}"
        );
    }
}

#[test]
fn block_source_map_marks_the_block_a_footnote_was_written_inside() {
    // The page draws that quote without the footnote, so anything writing it back has to put the footnote's line on again — and the mark is how it knows to. The footnote's own span is its own line and nothing of the quote's markers around it: an edit that only changes the words must not splice away the blank quote line the parser's range runs on into.
    let markdown =
        "Text [^x] here.\n\n> first line\n>\n> [^x]: the note\n>\n> last line\n\nAfter.\n";
    let spans = block_source_map(markdown);
    let slice = |index: usize| &markdown[spans[index].start..spans[index].end];

    assert_eq!(
        slice(1),
        "> first line\n>\n> [^x]: the note\n>\n> last line"
    );
    assert_eq!(slice(3), "[^x]: the note");

    let marked: Vec<bool> = spans.iter().map(|span| span.holds_footnote).collect();
    assert_eq!(marked, [false, true, false, false], "{spans:?}");

    // Every shape that hides one is marked, and the footnote's own span never carries a container marker.
    for markdown in [
        "Text [^x] here.\n\n> a quote line\n>\n> [^x]: the note\n",
        "Text [^x] here.\n\n- item\n\n  [^x]: the note\n",
        "Text [^x] here.\n\n> [^x]: the note\n",
        "Text [^x] here.\n\n- [^x]: the note\n",
    ] {
        let spans = block_source_map(markdown);
        assert!(spans[1].holds_footnote, "{markdown:?} {spans:?}");
        assert_eq!(&markdown[spans[2].start..spans[2].end], "[^x]: the note");
    }

    // A footnote written at the top level hides nothing: it is written where it is drawn.
    let plain = block_source_map("Text [^x] here.\n\n[^x]: the note\n");
    assert!(plain.iter().all(|span| !span.holds_footnote), "{plain:?}");
}

#[test]
fn a_dropped_block_really_does_reach_the_page_as_nothing() {
    // The whole fix rests on the sanitizer removing these, so read it back out of the render rather than trusting the reading of its configuration: the page is handed a document with two paragraphs and nothing between them.
    for markdown in [
        "Before.\n\n<!-- a note -->\n\nAfter.\n",
        "Before.\n\n<!-- x --> <!-- y -->\n\nAfter.\n",
        "Before.\n\n<script>alert(1)</script>\n\nAfter.\n",
        "Before.\n\n<style>p { color: red; }</style>\n\nAfter.\n",
    ] {
        let html = render_markdown_document(markdown, "notes.md").html;
        assert!(!html.contains("<!--"), "{markdown:?} kept a comment");
        assert!(!html.contains("alert(1)"), "{markdown:?} kept a script");
        assert!(!html.contains("color: red"), "{markdown:?} kept a style");
        // Anything the block did draw would sit between the two paragraphs, so what is between them has to be whitespace and nothing else.
        let start = html.find("Before.</p>").expect("the first paragraph") + "Before.</p>".len();
        let end = html.find("<p>After.").expect("the second paragraph");
        assert!(
            html[start..end].trim().is_empty(),
            "{markdown:?} drew something between the paragraphs: {:?}",
            &html[start..end]
        );
    }
}

#[test]
fn editable_document_tracks_dirty_and_save() {
    let mut doc = EditableDocument::new(
        PathBuf::from("notes.md"),
        SourceText::utf8("# Hello\n".to_string()),
    );
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
    let mut doc = EditableDocument::new(
        PathBuf::from("notes.md"),
        SourceText::utf8("original\n".to_string()),
    );
    doc.adopt_external(SourceText::utf8("changed on disk\n".to_string()));
    assert_eq!(doc.text(), "changed on disk\n");
    assert!(
        !doc.is_dirty(),
        "adopting an external change leaves it clean"
    );
}

#[test]
fn a_code_view_splice_lands_on_the_same_bytes_the_page_meant() {
    // The page sends UTF-16 offsets (JS string indices) and the host converts them against its own copy. Byte offsets diverge from those the moment there is a diacritic or an emoji, and a splice landing one byte off corrupts the file. The offsets here are exactly what sourceSpliceSince computes on the page.
    fn splice_of(before: &str, after: &str) -> (usize, usize, String) {
        let b: Vec<u16> = before.encode_utf16().collect();
        let a: Vec<u16> = after.encode_utf16().collect();
        let max = b.len().min(a.len());
        let mut prefix = 0;
        while prefix < max && b[prefix] == a[prefix] {
            prefix += 1;
        }
        let mut suffix = 0;
        while suffix < max - prefix && b[b.len() - 1 - suffix] == a[a.len() - 1 - suffix] {
            suffix += 1;
        }
        let inserted = String::from_utf16(&a[prefix..a.len() - suffix]).expect("valid utf-16");
        (prefix, b.len() - suffix - prefix, inserted)
    }

    for (before, after) in [
        ("hello world", "hello brave world"),
        // an edit after multi-byte text, where byte and UTF-16 offsets differ
        ("*āśā*, Skt. one", "*āśā*, Skt. two"),
        (
            "Bhūtaḍāmara maṇḍala she is one",
            "Bhūtaḍāmara maṇḍala she was one",
        ),
        // astral plane: one char, two UTF-16 units, four bytes
        ("a 😀 b", "a 😀 xb"),
        ("emoji 😀😀 tail", "emoji 😀 tail"),
        ("abcdef", "abf"),
        ("whole", "different"),
        ("", "first text"),
        ("goes away", ""),
        ("line one\nline two\n", "line one\nline 2\nline two\n"),
    ] {
        let (start, removed, inserted) = splice_of(before, after);
        let mut edit =
            EditableDocument::new(PathBuf::from("x.md"), SourceText::utf8(before.to_string()));
        edit.splice_utf16_without_undo(start, removed, &inserted);
        assert_eq!(
            edit.text(),
            after,
            "splice start={start} removed={removed} of {before:?} should give {after:?}"
        );
        // The length check the host uses to notice the two copies drifting apart.
        assert_eq!(edit.utf16_len(), after.encode_utf16().count());
    }

    // Typing in the code view is covered by the textarea's own undo, so a splice records none of its own.
    let mut edit =
        EditableDocument::new(PathBuf::from("x.md"), SourceText::utf8("abc".to_string()));
    edit.splice_utf16_without_undo(1, 1, "X");
    assert_eq!(edit.text(), "aXc");
    assert!(
        !edit.can_undo(),
        "code-view typing records no reader undo step"
    );
}

/// Every part of one table's map, read back out of the source it was built from.
fn table_map_slices<'a>(source: &'a str, table: &TableMap) -> Vec<(&'static str, &'a str)> {
    let mut slices = vec![
        ("table", &source[table.table.clone()]),
        ("delimiter", &source[table.delimiter.clone()]),
    ];
    for (index, row) in std::iter::once(&table.head)
        .chain(table.rows.iter())
        .enumerate()
    {
        let name: &'static str = if index == 0 { "head" } else { "row" };
        slices.push((name, &source[row.row.clone()]));
        for cell in &row.cells {
            slices.push(("cell", &source[cell.span.clone()]));
        }
    }
    slices
}

#[test]
fn a_table_map_cuts_exactly_the_bytes_it_claims() {
    // Frontmatter on the front so the ranges are proved to be the file's, not the body's; hand padding so a claim about spacing is a claim about real spacing; an escaped pipe because that is what an earlier plan believed the parser could not carry.
    let source =
        "---\ntitle: T\n---\n\n| id  | title      |\n| --- | ---------: |\n| 1   | The \\| Bar |\n";
    let maps = table_source_map(source);
    assert_eq!(maps.len(), 1);
    let table = &maps[0];
    assert!(table.top_level);
    assert_eq!(table.alignments, vec![Alignment::None, Alignment::Right]);
    assert_eq!(
        table_map_slices(source, table),
        vec![
            (
                "table",
                "| id  | title      |\n| --- | ---------: |\n| 1   | The \\| Bar |\n"
            ),
            ("delimiter", "| --- | ---------: |\n"),
            ("head", "| id  | title      |\n"),
            ("cell", " id  "),
            ("cell", " title      "),
            ("row", "| 1   | The \\| Bar |\n"),
            ("cell", " 1   "),
            ("cell", " The \\| Bar "),
        ]
    );
    for row in std::iter::once(&table.head).chain(table.rows.iter()) {
        for cell in &row.cells {
            assert!(cell.written, "{cell:?}");
        }
    }
}

#[test]
fn a_header_only_table_maps_its_delimiter_row() {
    // No body row to close the gap, so the table's own end has to.
    let source = "| id |\n| --- |\n";
    let maps = table_source_map(source);
    assert_eq!(maps.len(), 1);
    assert_eq!(&source[maps[0].delimiter.clone()], "| --- |\n");
    assert!(maps[0].rows.is_empty());
}

#[test]
fn cells_gfm_invented_to_fill_a_short_row_are_unwritable() {
    let source = "| a | b | c |\n| - | - | - |\n| 1 |\n";
    let maps = table_source_map(source);
    let row = &maps[0].rows[0];
    assert_eq!(row.cells.len(), 3);
    assert_eq!(&source[row.cells[0].span.clone()], " 1 ");
    assert!(row.cells[0].written);
    // Both invented cells sit at one offset, so writing to either would write to the other's place.
    assert_eq!(row.cells[1].span, row.cells[2].span);
    assert!(!row.cells[1].written && !row.cells[2].written);
    assert_eq!(
        maps[0].writable_cell(1, 0, 3),
        Some(row.cells[0].span.clone())
    );
    assert_eq!(maps[0].writable_cell(1, 1, 3), None);
    // A row the page draws at a different width is a row this map is not describing.
    assert_eq!(maps[0].writable_cell(1, 0, 2), None);
    assert_eq!(maps[0].writable_cell(9, 0, 3), None);
}

#[test]
fn a_table_inside_a_blockquote_keeps_its_cells_and_loses_its_rows() {
    let source = "> | a | b |\n> | - | - |\n> | c | d |\n";
    let maps = table_source_map(source);
    assert_eq!(maps.len(), 1);
    let table = &maps[0];
    assert!(!table.top_level, "the `> ` markers sit between the rows");
    assert_eq!(&source[table.head.cells[0].span.clone()], " a ");
    assert_eq!(&source[table.rows[0].cells[1].span.clone()], " d ");
}

#[test]
fn a_malformed_table_produces_no_map() {
    for source in [
        "| a | b\n| ragged\n",
        "| a | b |\n",
        "just a paragraph\n",
        "",
        "| |\n|-|\n| |\n",
    ] {
        let maps = table_source_map(source);
        for table in &maps {
            // Whatever it found, every range it stamped has to be a range this source actually has.
            for (_, slice) in table_map_slices(source, table) {
                let _ = slice;
            }
        }
    }
    assert!(table_source_map("| a | b\n| ragged\n").is_empty());
    assert!(table_source_map("| a | b |\n").is_empty());
}

/// A hand-padded table, and a document with something either side of it so a splice that overran would show.
const PADDED_TABLE_DOC: &str = "# Prices

| item   | cost |
| :----- | ---: |
| apple  |    1 |
| cherry |   12 |

After.
";

fn padded_table_doc() -> EditableDocument {
    EditableDocument::new(
        PathBuf::from("prices.md"),
        SourceText::utf8(PADDED_TABLE_DOC.to_string()),
    )
}

/// Where the one table in `PADDED_TABLE_DOC` starts, as the page reads it off the block map.
fn padded_table_start(edit: &EditableDocument) -> usize {
    edit.block_source_map()
        .into_iter()
        .find(|block| block.kind == "table")
        .expect("the document has a table")
        .start
}

#[test]
fn writing_one_cell_leaves_every_other_byte_of_the_document_alone() {
    let mut edit = padded_table_doc();
    let start = padded_table_start(&edit);

    // The head row, then a body cell: the padding each was written with stays, so the pipes move only by what the text itself changed.
    assert!(edit.replace_table_cell(start, 0, 1, 2, "price", true));
    assert!(edit.replace_table_cell(start, 2, 0, 2, "banana", true));
    assert_eq!(
        edit.text(),
        "# Prices

| item   | price |
| :----- | ---: |
| apple  |    1 |
| banana |   12 |

After.
"
    );

    // The delimiter row is untouched, and so is everything outside the table.
    assert!(edit.text().contains("| :----- | ---: |"));
    assert!(edit.text().starts_with(
        "# Prices

"
    ));
    assert!(edit.text().ends_with(
        "

After.
"
    ));
    // One undo per edit, like any other reading-view edit.
    assert!(edit.undo() && edit.undo());
    assert_eq!(edit.text(), PADDED_TABLE_DOC);
}

#[test]
fn a_cell_that_gains_a_pipe_keeps_the_row_it_is_in() {
    let mut edit = padded_table_doc();
    let start = padded_table_start(&edit);
    // The page escapes the pipe before it sends the cell; what this proves is that the escaped text lands between the cell's own pipes and the row still parses at two columns wide.
    assert!(edit.replace_table_cell(start, 1, 0, 2, "a \\| b", true));
    assert!(edit.text().contains("| a \\| b  |    1 |"));
    let maps = table_source_map(edit.text());
    assert_eq!(maps[0].rows[0].cells.len(), 2);
    assert_eq!(
        &edit.text()[maps[0].rows[0].cells[0].span.clone()],
        " a \\| b  "
    );
}

#[test]
fn a_checkbox_in_a_cell_rewrites_that_cell_and_nothing_else() {
    let markdown = "| done   | task    |
| ------ | ------- |
| [ ]    | Write   |
| [x]    | Ship    |
";
    let mut edit = EditableDocument::new(
        PathBuf::from("tasks.md"),
        SourceText::utf8(markdown.to_string()),
    );
    let start = padded_table_start(&edit);
    // The auto-saving path: no undo step, exactly like the list checkbox it sits beside.
    assert!(edit.replace_table_cell(start, 1, 0, 2, "[x]", false));
    assert_eq!(
        edit.text(),
        "| done   | task    |
| ------ | ------- |
| [x]    | Write   |
| [x]    | Ship    |
"
    );
    assert!(!edit.can_undo());
}

#[test]
fn a_cell_the_map_cannot_prove_is_left_to_the_whole_table_rewrite() {
    let mut edit = EditableDocument::new(
        PathBuf::from("short.md"),
        SourceText::utf8(
            "| a | b | c |
| - | - | - |
| 1 |
"
            .to_string(),
        ),
    );
    let start = padded_table_start(&edit);
    let before = edit.text().to_string();
    for (row, column, columns) in [
        (1, 1, 3), // a cell GFM invented to fill the short row: no bytes of its own
        (1, 0, 2), // a row the page drew at another width
        (9, 0, 3), // a row that is not there
    ] {
        assert!(!edit.replace_table_cell(start, row, column, columns, "x", true));
    }
    // A table start that names nothing, and a document with no table at all.
    assert!(!edit.replace_table_cell(999, 0, 0, 3, "x", true));
    assert_eq!(edit.text(), before);
    assert!(!edit.can_undo());

    let mut prose = EditableDocument::new(
        PathBuf::from("prose.md"),
        SourceText::utf8(
            "Just a paragraph.
"
            .to_string(),
        ),
    );
    assert!(!prose.replace_table_cell(0, 0, 0, 1, "x", true));
    assert_eq!(
        prose.text(),
        "Just a paragraph.
"
    );
}

#[test]
fn a_written_cell_keeps_the_spacing_it_was_written_with() {
    // The left pipe never moves; the right one moves only by what the text changed. A cell holding nothing but space is the one that gets padding invented for it.
    assert_eq!(table_cell_replacement("  id   ", "ident"), "  ident   ");
    assert_eq!(table_cell_replacement(" a ", "b"), " b ");
    assert_eq!(table_cell_replacement("x", "y"), "y");
    assert_eq!(table_cell_replacement("   ", "new"), " new ");
    assert_eq!(table_cell_replacement(" old ", "  padded  "), " padded ");
}

#[test]
fn a_table_finds_the_lone_comments_touching_it() {
    // One above with no blank line, one below with one: both touch, and each says which side it is on. A table can carry a schema over it and a formula line under it at once, which is what the two tickets waiting on this map want.
    let source = "<!-- leaf:table id -->
| a |
| - |
| 1 |

<!-- TBLFM: @2=1 -->
";
    let maps = table_source_map(source);
    assert_eq!(maps.len(), 1);
    let comments = &maps[0].comments;
    assert_eq!(comments.len(), 2);
    assert!(comments[0].before);
    assert_eq!(comments[0].inner, " leaf:table id ");
    assert_eq!(&source[comments[0].span.clone()], "<!-- leaf:table id -->");
    assert!(!comments[1].before);
    assert_eq!(comments[1].inner, " TBLFM: @2=1 ");
    // The range cuts the comment whole, so writing over it replaces the comment and nothing around it.
    assert_eq!(&source[comments[1].span.clone()], "<!-- TBLFM: @2=1 -->");
}

#[test]
fn a_comment_sharing_its_block_or_standing_apart_is_not_the_tables() {
    for source in [
        // Text on the same line: the block's range is not the comment's, so there is nothing to write over.
        "<!-- x --> text

| a |
| - |
",
        // A block of its own between the two.
        "<!-- x -->

A paragraph.

| a |
| - |
",
        "| a |
| - |

A paragraph.

<!-- x -->
",
    ] {
        let maps = table_source_map(source);
        assert_eq!(maps.len(), 1, "{source:?}");
        assert!(maps[0].comments.is_empty(), "{source:?}");
    }
}
