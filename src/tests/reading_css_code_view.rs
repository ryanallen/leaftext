//! The code view and every diagram surface.

use super::*;

#[test]
fn an_undrawn_diagram_does_not_spin_in_the_rail() {
    let css = reading_mode_css();

    // The rail's copy is a clone of `.document-body` keeping its classes, so every rule that paints an undrawn diagram matches inside it — the spinner included. A pseudo-element survives stripMinimapClone's removal of nodes, so only a rule reaches it.
    let cancel = format!("{RAIL_UNDRAWN_DIAGRAM}::after");
    let spinner = format!("{SPINNING_UNDRAWN_DIAGRAM}::after");
    assert_contains(css, &cancel);
    assert_contains(css, &spinner);
    assert!(
        rule_body(css, &format!("{cancel} {{")).contains("content: none;"),
        "the ring is canceled by taking the pseudo-element away"
    );

    // A cancel whose text is merely present in the stylesheet can stand there without ever applying, so it is weighed against the rule it has to beat and then put after it.
    let (rail, page) = (class_level_parts(&cancel), class_level_parts(&spinner));
    assert!(
        rail >= page,
        "the rail's cancel counts {rail} class-level parts against the spinner rule's {page}, so the ring would go on turning"
    );
    assert!(
        rule_at(css, &format!("{cancel} {{")) > rule_at(css, &format!("{spinner} {{")),
        "a tie on weight is broken by source order, so the rail's cancel has to sit after the spinner rule"
    );
    // The block itself must stay in the copy: its source text is transparent in the page and is the only thing holding the block at the height the real one has.
    assert_contains(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]) {",
    );
    let undrawn = rule_body(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]) {",
    );
    assert!(
        undrawn.contains("color: transparent;"),
        "an undrawn diagram's source must stay laid out and unreadable, not removed: {undrawn}"
    );
    assert!(
        !css.contains(".document-minimap-preview pre.mermaid {\n  display: none;"),
        "hiding the block in the copy would collapse the rail's height for it"
    );
}

/// The class-level column of a selector's weight: its classes, attribute selectors and pseudo-classes. `:not()` contributes what is written inside it and nothing for itself, so dots are counted over the leading element-and-class run and brackets over the whole selector.
fn class_level_parts(selector: &str) -> usize {
    let leading = selector.split(':').next().unwrap_or(selector);
    leading.matches('.').count() + selector.matches('[').count()
}

const SHEET_UNDRAWN_DIAGRAM: &str = ".glossary-sheet-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])";

const UNDRAWN_DIAGRAM_FLOOR: &str = ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])";

const RAIL_UNDRAWN_DIAGRAM: &str = ".document-minimap-preview pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])";

const CARD_UNSHOWN_DIAGRAM: &str = ".link-hover-tip-preview-document pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])[data-card-diagram=\"unshown\"]";

const SPINNING_UNDRAWN_DIAGRAM: &str = ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])";

#[test]
fn a_glossary_entrys_undrawn_diagram_is_a_strip_rather_than_a_ring_that_never_stops() {
    let css = reading_mode_css();

    // A term's entry is rendered outside #app, so the draw pass never collects its diagrams and one of them stays undrawn for as long as the sheet is open. Both published sites draw this same sheet off this same stylesheet, so these two rules are the whole fix everywhere.
    let cancel = format!("{SHEET_UNDRAWN_DIAGRAM}::after");
    let spinner = format!("{SPINNING_UNDRAWN_DIAGRAM}::after");
    assert_contains(css, &cancel);
    assert!(
        rule_body(css, &format!("{cancel} {{")).contains("content: none;"),
        "the ring is canceled by taking the pseudo-element away"
    );
    let (sheet, page) = (class_level_parts(&cancel), class_level_parts(&spinner));
    assert!(
        sheet >= page,
        "the sheet's cancel counts {sheet} class-level parts against the spinner rule's {page}, so the ring would go on turning"
    );
    assert!(
        rule_at(css, &format!("{cancel} {{")) > rule_at(css, &format!("{spinner} {{")),
        "a tie on weight is broken by source order, so the sheet's cancel has to sit after the spinner rule"
    );

    // The height is the other half: left alone, the block keeps the height its own invisible source text laid out at, held open by the reading page's 88px floor.
    let strip = rule_body(css, &format!("{SHEET_UNDRAWN_DIAGRAM} {{"));
    assert!(
        strip.contains("min-height: 0;"),
        "the reading page's 88px floor has to go, or the strip cannot be shorter than it: {strip}"
    );
    let (held, floored) = (
        class_level_parts(SHEET_UNDRAWN_DIAGRAM),
        class_level_parts(UNDRAWN_DIAGRAM_FLOOR),
    );
    assert!(
        held >= floored,
        "the sheet's height rule counts {held} class-level parts against the floor's {floored}, so the block would stay 88px tall"
    );
    assert!(
        rule_at(css, &format!("{SHEET_UNDRAWN_DIAGRAM} {{"))
            > rule_at(css, &format!("{UNDRAWN_DIAGRAM_FLOOR} {{")),
        "a tie on weight is broken by source order, so the sheet's height rule has to sit after the floor"
    );
    let height = strip
        .lines()
        .find_map(|line| line.trim().strip_prefix("height: ")?.strip_suffix("px;"))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_else(|| panic!("the strip needs a height in pixels: {strip}"));
    // The corner label sits 8px down on a 13.2px line, so a shorter strip clips the one word still saying a drawing stood there.
    assert!(
        (22..=48).contains(&height),
        "a {height}px strip either clips its own corner word or is no longer a strip"
    );
}

#[test]
fn a_diagram_the_card_will_not_draw_is_a_strip_rather_than_a_ring_that_never_stops() {
    let css = reading_mode_css();

    let cancel = format!("{CARD_UNSHOWN_DIAGRAM}::after");
    let spinner = format!("{SPINNING_UNDRAWN_DIAGRAM}::after");
    assert_contains(css, &cancel);
    assert_contains(css, &spinner);
    assert!(
        rule_body(css, &format!("{cancel} {{")).contains("content: none;"),
        "the ring is canceled by taking the pseudo-element away"
    );

    // A cancel whose text is merely present in the stylesheet can stand there without ever applying, so this one is weighed against the rule it has to beat and then put after it.
    let (card, page) = (class_level_parts(&cancel), class_level_parts(&spinner));
    assert!(
        card >= page,
        "the card's cancel counts {card} class-level parts against the spinner rule's {page}, so the ring would go on turning"
    );
    assert!(
        rule_at(css, &format!("{cancel} {{")) > rule_at(css, &format!("{spinner} {{")),
        "a tie on weight is broken by source order, so the card's cancel has to sit after the spinner rule"
    );

    // Without both of these the block keeps the height its own invisible source text laid out at, or the reading page's floor holds it open at 88px.
    let strip = rule_body(css, &format!("{CARD_UNSHOWN_DIAGRAM} {{"));
    assert!(
        strip.contains("min-height: 0;"),
        "the reading page's 88px floor has to go, or the strip cannot be shorter than it: {strip}"
    );
    let height = strip
        .lines()
        .find_map(|line| line.trim().strip_prefix("height: ")?.strip_suffix("px;"))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or_else(|| panic!("the strip needs a height in pixels: {strip}"));
    // The corner label sits 8px down on a 13.2px line, so a shorter strip clips the one word still saying a drawing stood there.
    assert!(
        (22..=48).contains(&height),
        "a {height}px strip either clips its own corner word or is no longer a strip"
    );
    assert_contains(
        css,
        ".document-body pre.mermaid::before {
  content: attr(data-language);",
    );
}

#[test]
fn reading_mode_css_keeps_markdown_and_code_ready_for_theme_tokens() {
    let css = reading_mode_css();

    for rule in [
        ".document-body code {",
        "background: var(--lt-editor-inline-code-background);",
        "color: var(--lt-editor-inline-code-foreground);",
        ".document-body pre {",
        "background: var(--lt-editor-code-background);",
        "color: var(--lt-editor-code-foreground);",
        ".document-body pre code {",
        "background: transparent;",
        "color: inherit;",
        ".document-body .syn-comment",
        "color: var(--lt-syntax-comment);",
        ".document-body .syn-keyword",
        "color: var(--lt-syntax-keyword);",
        ".document-body .syn-string",
        "color: var(--lt-syntax-string);",
        ".document-body .syn-numeric",
        "color: var(--lt-syntax-number);",
        ".document-body .syn-function",
        "color: var(--lt-syntax-function);",
        ".document-body .syn-type",
        "color: var(--lt-syntax-type);",
        ".document-body .syn-variable",
        "color: var(--lt-syntax-variable);",
        ".document-body .syn-punctuation",
        "color: var(--lt-syntax-punctuation);",
        ".document-body .syn-inserted",
        "background: var(--lt-syntax-inserted-background);",
        "color: var(--lt-syntax-inserted);",
        ".document-body .syn-deleted",
        "background: var(--lt-syntax-deleted-background);",
        "color: var(--lt-syntax-deleted);",
        ".document-body .syn-changed",
        "background: var(--lt-syntax-changed-background);",
        "color: var(--lt-syntax-changed);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn reading_mode_css_keeps_code_surfaces_readable_in_light_and_dark() {
    let css = reading_mode_css();

    for theme in [ResolvedTheme::Light, ResolvedTheme::Dark] {
        for foreground in [
            "--lt-syntax-foreground",
            "--lt-syntax-comment",
            "--lt-syntax-keyword",
            "--lt-syntax-string",
            "--lt-syntax-number",
            "--lt-syntax-function",
            "--lt-syntax-variable",
            "--lt-syntax-type",
            "--lt-syntax-operator",
            "--lt-syntax-punctuation",
            "--lt-editor-inline-code-foreground",
        ] {
            let background = if foreground == "--lt-editor-inline-code-foreground" {
                "--lt-editor-inline-code-background"
            } else {
                "--lt-syntax-background"
            };
            assert_contrast_at_least(css, theme, foreground, background, 4.5);
        }

        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-foreground",
            "--lt-focus-selection-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-inserted",
            "--lt-syntax-inserted-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-deleted",
            "--lt-syntax-deleted-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-changed",
            "--lt-syntax-changed-background",
            4.5,
        );
    }
}

// Monaco sizes the line-number gutter to fit the widest number and right-aligns the numbers in it, so at five digits — its minimum width — the number's left edge lands exactly on the page frame's border and the two touch. The stand-off has to be a transform: the gutter's width is something Monaco measures and re-lays-out from, so anything that changes the box feeds back into its own layout.
#[test]
fn the_code_views_line_numbers_stand_off_the_page_frame() {
    let css = reading_mode_css();

    assert_contains(css, "  --cv-line-number-pad: 8px;");
    let numbers = rule_body(
        css,
        ".code-view-monaco .monaco-editor .margin-view-overlays .line-numbers {",
    );
    assert_contains(numbers, "transform: translateX(var(--cv-line-number-pad));");
    // Not padding or width — see above.
    assert!(
        !numbers.contains("padding") && !numbers.contains("width:"),
        "the stand-off must not change the box Monaco measures: {numbers}"
    );
}

// The square drawn before a color in the source is a mark, not a control: the color picker's hover participant is not in the vendored bundle, so a click on it does nothing. Monaco's own style promises otherwise with a pointer, and a hand over something that will not respond is the app lying — in a view that stands behind a padlock at that.
#[test]
fn the_code_views_color_squares_do_not_promise_a_picker() {
    let css = reading_mode_css();

    let square = rule_body(
        css,
        ".code-view-monaco .monaco-editor .colorpicker-color-decoration {",
    );
    assert_contains(square, "cursor: text;");
    // The hairline around it is the editor's and stays: it is what keeps a white or a black swatch visible against the editor's own background, on every theme.
    assert!(
        !square.contains("border"),
        "the square's hairline is the editor's, not ours: {square}"
    );
}

// The minimap rail is chrome, not page: the shell's grain runs behind it. Monaco's minimap canvas paints only the pixels its glyphs land in — it fills no background of its own — so anything opaque behind the rail is something of ours, and a page fill crossing into it is what makes the rail read as page-colored. Every layer carrying that color has to stop at the page frame's right border.
#[test]
fn the_code_views_minimap_rail_shows_the_shells_grain() {
    let css = reading_mode_css();
    let frame_edge = "calc(var(--cv-minimap-width, 0px) + var(--cv-minimap-standoff))";

    // The shell holds no fill of its own — it spans the rail as well as the page.
    let shell = rule_body(css, ".reader-shell.code-view-monaco-shell {");
    assert_contains(shell, "background: transparent;");
    // It is painted by ::before instead, which ends where the frame's border is drawn.
    let fill = rule_body(css, ".reader-shell.code-view-monaco-shell::before {");
    assert_contains(fill, &format!("inset: 0 {frame_edge} 0 0;"));
    assert_contains(fill, "background: var(--lt-syntax-background);");
    // Nor does either box of Monaco's that carries it: the editor's root, and the lines layer, whose 16,777,216px square is bounded only by the guard around the editor.
    let editor = rule_body(css, ".code-view-monaco .monaco-editor,");
    assert_contains(editor, ".monaco-editor .monaco-editor-background {");
    assert_contains(editor, "background-color: transparent;");
    // And neither does the edge wash, which would otherwise put the page's color back under the top and bottom of the map. The frame's own measure and nothing else: the border it is drawn with is reserved by the fade's own transparent one, which is snapped to device pixels where a spacing value is not.
    let fade = rule_body(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
    assert_contains(
        fade,
        "margin-right: calc(var(--cv-minimap-width, 0px) + var(--cv-minimap-standoff));",
    );
    // Monaco's own scrolled-content shadow spans the editor's whole top edge, the map included; over the rail it read as a smudge on the chrome. The theme turns it off, and widget shadows with it.
    let html = app_shell_page();
    assert!(html.contains("'scrollbar.shadow': '#00000000',"));
    assert!(html.contains("'widget.shadow': '#00000000',"));
}

#[test]
fn a_diagrams_own_drawing_is_moved_and_its_button_icons_are_not() {
    // A drawn diagram is a block holding two things that are both SVG: its own drawing, and the icons inside the corner buttons. Every rule that sizes or moves the drawing has to say `> svg`, because the descendant form takes the icons too — they fly to the pan offset and the buttons are left empty, which is what shipped the first time this was written.
    let css = reading_mode_css();
    // The full-window stage is the same shape and carries the same buttons, so it is held to the same rule.
    for block in [
        ".document-body pre.mermaid[data-processed=\"true\"]",
        ".diagram-stage",
    ] {
        for rule in css.split(block).skip(1) {
            let Some(selector) = rule.split('{').next() else {
                continue;
            };
            // Only the rules that reach an SVG inside the block.
            if !selector.contains("svg") {
                continue;
            }
            assert!(
                selector.contains("> svg"),
                "`{block}{selector}` reaches every SVG in the block, including the \
                 corner buttons' icons. Say `> svg` so it is the drawing alone."
            );
        }

        // And the rules themselves are still here to be checked.
        assert_contains(css, &format!("{block} > svg"));
        assert_contains(css, &format!("{block}.is-moved > svg"));
    }
}

#[test]
fn the_flowchart_canvas_is_dragged_by_the_stage_not_by_its_scrollbars() {
    // A diagram smaller than the pane has nothing to scroll, so scroll-panning did nothing for exactly the diagrams most likely to be hidden under the picker. The stage is moved instead, and the handles ride along because the overlay is inside it.
    let css = reading_mode_css();

    assert_contains(
        &css,
        "transform: translate(var(--flow-pan-x, 0px), var(--flow-pan-y, 0px));",
    );
    // The sheet's own corners: the panes fill it, so it has to clip them.
    let sheet = css
        .split(".flow-sheet {")
        .nth(1)
        .expect("the flowchart sheet has a rule");
    let sheet = &sheet[..sheet.find('}').expect("the rule closes")];
    assert!(
        sheet.contains("border-radius") && sheet.contains("overflow: hidden"),
        "the flowchart sheet must clip its rounded corners: {sheet}"
    );
}
