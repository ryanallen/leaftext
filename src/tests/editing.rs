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
