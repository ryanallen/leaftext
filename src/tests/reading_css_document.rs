//! A document's own typography, rhythm, tables and paper.

use super::*;

#[test]
fn a_note_that_asked_for_a_full_width_page_gets_the_whole_lane() {
    let css = reading_mode_css();

    // Two classes deep, so it out-specifies `.document-body`'s own measure without a `!important`.
    let wide = css
        .find(".document-body.document-body-wide {")
        .expect("the full-width page rule");
    let measure = css
        .find(".document-body {")
        .expect("the reading measure rule");
    assert!(
        measure < wide,
        "the wide rule has to come after the measure it overrides"
    );
    assert_contains(&css[wide..], "width: 100%;");

    // A list-valued field is reached through the table, because `class` does not survive the sanitizer on a `ul`.
    let list = css
        .find(".document-body .frontmatter td ul {")
        .expect("the list-valued field rule");
    assert_contains(&css[list..], "list-style: none;");
}

#[test]
fn reading_mode_css_defines_document_typography() {
    let css = reading_mode_css();

    for rule in [
            "--reader-content-pad: 32px;",
            "--type-measure-body: 75ch;",
            "--type-base: max(0.875rem, calc(1rem + (100vw - 1280px) / 140));",
            "--type-spacing: calc(var(--type-base) * 1.5);",
            "--type-spacing-sm: var(--type-base);",
            "--type-body-size: var(--type-base);",
            "--type-display-size: calc(var(--type-base) * 3.2);",
            "--type-h1-size: calc(var(--type-base) * 2.2);",
            "--type-h2-size: calc(var(--type-base) * 2);",
            "--type-h3-size: calc(var(--type-base) * 1.8);",
            "--type-h4-size: calc(var(--type-base) * 1.6);",
            "--type-h5-size: calc(var(--type-base) * 1.4);",
            "--type-h6-size: calc(var(--type-base) * 1.2);",
            "--type-caption-size: calc(var(--type-base) * 0.8125);",
            "--type-display-line: 1.2;",
            "--type-h1-line: 1.25;",
            "--type-h2-line: 1.25;",
            "--type-h3-line: 1.25;",
            "--type-h4-line: 1.25;",
            "--type-body-line: 1.6;",
            "--type-caption-line: 1.6;",
            ".reader-layout {\n  --reader-layout-padding-inline: var(--reader-content-pad);\n  container-type: inline-size;",
            "width: min(var(--type-measure-body), 100%);",
            "padding: var(--reader-content-pad) 0;",
            "font-size: var(--type-body-size);",
            "line-height: var(--type-body-line);",
            "word-wrap: break-word;",
            ".document-body h1,",
            ".document-body h6 {",
            "font-family: var(--heading-font);",
            "font-weight: var(--type-h1-weight);",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            "font-size: var(--type-h1-size);",
            "font-size: var(--type-h2-size);",
            "font-size: var(--type-h3-size);",
            "font-size: var(--type-h4-size);",
            "font-size: var(--type-h5-size);",
            "font-size: var(--type-h6-size);",
        ] {
            assert_contains(css, rule);
        }

    for old_reader_specific_layout in [
        "--type-h1-measure",
        "--type-h2-measure",
        "--type-h3-measure",
        "--type-heading-measure",
        "text-wrap: balance;",
        "text-box-trim: trim-both;",
    ] {
        assert!(
                !css.contains(old_reader_specific_layout),
                "rendered Markdown should keep the web reader layout instead of {old_reader_specific_layout}"
            );
    }
}

#[test]
fn reading_mode_css_uses_web_reader_document_rhythm() {
    let css = reading_mode_css();

    for rule in [
            ".document-body p,\n.document-body ul,\n.document-body ol,\n.document-body blockquote,\n.document-body table,\n.document-body pre {\n  margin: 0 0 var(--type-spacing);\n}",
            ".document-body h1,\n.document-body h2,\n.document-body h3,\n.document-body h4,\n.document-body h5,\n.document-body h6 {",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            ".document-body strong {\n  font-weight: var(--lt-weight-600);\n}",
            ".document-body ul,\n.document-body ol {\n  padding-left: 2em;\n}",
            ".document-body li + li {\n  margin-top: 0.25em;\n}",
            ".document-body li > ul,\n.document-body li > ol {\n  margin: 0.25em 0 0;\n}",
            ".document-body input[type=\"checkbox\"] {\n  accent-color: var(--lt-checkbox-accent);\n  margin-right: 0.4em;\n}",
            ".document-body blockquote {\n  border-left: 0.25em solid var(--lt-markdown-blockquote-border);\n  color: var(--lt-markdown-blockquote-foreground);\n  padding: 0 1em;\n}",
            ".document-body blockquote:not(.markdown-alert) p {\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body blockquote:not(.markdown-alert) p.blockquote-lines {\n  padding-left: 0;\n  text-indent: 0;\n}",
            ".document-body blockquote:not(.markdown-alert) .blockquote-line {\n  display: block;\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body code {",
            "font-size: 0.875em;\n  padding: 0.2em 0.4em;",
            ".document-body pre {",
            "line-height: var(--lt-leading-1-45);",
            "padding: 1em;",
            ".document-body table {",
            "overflow: auto;",
            "width: max-content;",
            ".document-body th,\n.document-body td {\n  border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);\n  padding: 0.375em 0.8125em;\n}",
            ".document-body hr {\n  border: 0;\n  height: 1px;\n  margin: var(--type-spacing) 0;",
            "@media (max-width: 600px) {\n  :root {\n    --reader-content-pad: 16px;",
        ] {
            assert_contains(css, rule);
        }

    for old_rhythm in [
        ".document-body > * {\n  margin-block: 0 var(--lt-space-16);\n}",
        "margin-block-start: calc(var(--type-base) * 4);",
        "margin-block-start: calc(var(--type-base) * 1.5);",
        "padding-top: var(--lt-space-136);",
        "padding: var(--lt-space-320) 0 var(--lt-space-88);",
    ] {
        assert!(
            !css.contains(old_rhythm),
            "rendered Markdown rhythm should match the web reader instead of {old_rhythm}"
        );
    }
}

#[test]
fn a_wrapped_run_of_document_buttons_does_not_touch() {
    let css = reading_mode_css();
    let button = rule_body(&css, ".document-body a.leaf-md-button {");

    // A paragraph's spacing is under the paragraph rather than between its lines, so a run of buttons that wraps had nothing at all between the boxes: two fills in one green, measured meeting at exactly 0px, read as one control with a seam. The button is an `inline-flex` box, which is an atomic inline and so keeps a vertical margin, and 4px on each side meets its neighbor's to make 8px. Nothing on the left, or the first button leaves the text column.
    assert_contains(
        button,
        "margin: var(--lt-space-4) var(--lt-space-4) var(--lt-space-4) 0;",
    );
    assert_contains(button, "display: inline-flex;");
}

#[test]
fn the_print_block_hands_the_whole_document_to_the_paper() {
    let css = reading_mode_css();
    // The rules are on a class rather than in a media block, because the page has to be able to measure the layout it is about to ask a sheet for.
    let print = &css[css
        .find("body.leaf-paper:has(.app-surface) {")
        .expect("the paper rules")..];

    // The three things pinning this page to one screen, and a print that leaves any of them gives a single sheet. The surface is a fixed box with `contain: paint`, so it is what every overlay is measured from and clipped to; the reader carries its own scroller, which is what holds a whole document inside a window's height; and the window's own overflow is what stops the page scrolling at all.
    let surface = rule_body(print, "body.leaf-paper .app-surface {");
    assert_contains(surface, "position: static;");
    assert_contains(surface, "contain: none;");
    let reader = rule_body(print, "body.leaf-paper .library-shell .reader-shell {");
    assert_contains(reader, "overflow: visible;");
    assert_contains(reader, "height: auto;");
    let paper_body = rule_body(print, "body.leaf-paper:has(.app-surface) {");
    assert_contains(paper_body, "overflow: visible;");
    // The sheet always outlives the layout by the rounding slack, so the body wears the page's own color: painted, the slack is the page; unpainted, it is a white strip under the last line.
    assert_contains(paper_body, "background: var(--lt-markdown-background);");
    assert_contains(paper_body, "print-color-adjust: exact;");

    // A print render drops every painted background unless it is told otherwise, so a dark theme would reach the file as dark ink on white paper. Both boxes the theme's page color lands on force it instead, on both desktops, which is why no reader is ever asked.
    for painted in [
        "body.leaf-paper .app-surface {",
        "body.leaf-paper .library-shell .reader-shell {",
    ] {
        let body = rule_body(print, painted);
        assert_contains(body, "print-color-adjust: exact;");
        assert_contains(body, "-webkit-print-color-adjust: exact;");
    }

    // No page rule of our own: the app sizes the page to the whole document when it renders one, and a CSS page margin outranks what it sets, so the last inch of a document would be pushed onto a second sheet.
    assert!(
        !print.contains("@page"),
        "the print block leaves the page box to whatever is doing the rendering"
    );

    // Every control on the page, named one at a time. Never written as "whatever the reader does not hold": the reader holds controls too — a block's gutter, the toolbar a selection raises, a diagram's corner and its opened stage — and a rule keeping the reader's children would print those onto the paper.
    let hidden = rule_body(print, "body.leaf-paper :is(.docs-pager,");
    for control in [
        // A way to somewhere else, which paper has none of. Its own waiting state was still pulsing on a sheet a reader was handed.
        "body.leaf-paper :is(.docs-pager,",
        // The first-run bubble floats over the window rather than sitting in it, which is how it printed onto a sheet after every control in the window was hidden.
        ".hint-bubble,",
        ".app-bar,",
        ".app-overflow-panel,",
        ".reader-corner,",
        ".library-pane,",
        ".library-divider,",
        ".filter-menu,",
        ".reader-graph,",
        ".reader-toolbar,",
        ".find-bar,",
        ".reader-edge-fade,",
        ".reader-minimap,",
        ".reader-loading,",
        ".lt-backdrop,",
        ".leaf-sheet,",
        ".flow-sheet,",
        ".confirm-dialog,",
        ".context-menu,",
        ".crumb-menu,",
        ".rename-box,",
        ".link-hover-tip,",
        ".app-toast,",
        ".block-gutter,",
        ".block-gap-line,",
        ".block-drag-ghost,",
        ".selection-toolbar,",
        ".mermaid-tools,",
        ".diagram-overlay) {",
    ] {
        assert_contains(hidden, control);
    }
    assert_contains(hidden, "display: none;");

    // The shadow band the app throws over the strip of window it is held off by. Paper has no window to be held off.
    assert_contains(
        rule_body(print, "body.leaf-paper:has(.app-surface)::before {"),
        "display: none;",
    );

    // The room the page keeps at its foot for the floating toolbar, which nothing draws here. The height the page sends already has it taken off, so leaving it laid out makes the sheet shorter than what is on it.
    assert_contains(
        rule_body(print, "body.leaf-paper .document-body {"),
        "padding-bottom: var(--reader-content-pad);",
    );

    // The break-out lanes are what shrank the paper: the print render measures overflow on the untransformed box, so a lane slid half a measure right hung past the sheet and the renderer shrank the whole page to fit the phantom width — the foot of the sheet unpainted. On paper a lane is a plain block at the width the page wrote down, centered by margins, nothing slid and nothing transformed.
    let lanes = rule_body(
        print,
        "body.leaf-paper .document-body > :is(.table-lane, p.image-lane) {",
    );
    assert_contains(lanes, "position: static;");
    assert_contains(lanes, "transform: none;");
    assert_contains(lanes, "width: var(--leaf-paper-lane, 100%);");
    assert_contains(
        lanes,
        "margin-left: calc((100% - var(--leaf-paper-lane, 100%)) / 2);",
    );
    assert_contains(
        rule_body(print, "body.leaf-paper .home-list-grid {"),
        "transform: none;",
    );

    // The exported page wears `leaf-paper` for ever — no script runs there to take it off — so `leaf-web` hands its lanes back the screen width. Inside the screen media on purpose: the class cannot come off for a print, and a print that got this rule shrank the whole page to fit a slid lane's phantom width.
    let adjacency = "@media screen {\n  body.leaf-paper.leaf-web .document-body > :is(.table-lane, p.image-lane) {";
    assert_contains(print, adjacency);
    let web_lanes = rule_body(print, adjacency);
    assert_contains(web_lanes, "position: relative;");
    assert_contains(
        web_lanes,
        "max-width: max(100%, calc(100cqi - 2 * var(--reader-lane-inset)));",
    );
    assert_contains(web_lanes, "margin-left: 0;");
}

#[test]
fn the_table_edge_bands_animate_only_where_a_scroll_can_drive_them() {
    // A browser without scroll-driven animations drops only the timeline line, leaving a zero-second clock animation whose fill mode holds the last keyframe — the left band stuck on for ever over a table nobody scrolled, which is how an exported page looked in Firefox. Behind the guard such a browser keeps the bands' resting opacity and shows no band at all.
    let css = reading_mode_css();
    let bands = rule_body(&css, ".table-lane::before,\n.table-lane::after {");
    assert_contains(bands, "opacity: 0;");
    assert!(
        !bands.contains("animation-"),
        "the bands' resting rule must carry no animation of its own: {bands}"
    );
    let guard = "@supports (animation-timeline: scroll()) {";
    let opens = css.find(guard).expect("the support guard exists");
    let shuts = opens + css[opens..].find("\n}").expect("the guard closes");
    let guarded = &css[opens..shuts];
    assert_contains(guarded, "animation-timeline: --lt-table-scroll;");
    for name in ["lt-table-edge-behind", "lt-table-edge-ahead"] {
        let line = format!("animation-name: {name};");
        assert_eq!(
            css.matches(line.as_str()).count(),
            1,
            "{name} is named exactly once, so nothing animates it outside the guard"
        );
        assert_contains(guarded, &line);
    }
}
