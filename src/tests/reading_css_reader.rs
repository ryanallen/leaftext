//! The reader's grid cell, its edges, the minimap column, the floating bar and the find bar — and `rule_body`, the helper every stylesheet test reads a rule through, which the floating bar's own rule caught.

use super::*;

/// A stylesheet of the shape the compiled one has: a rule whose selector ends with a shorter rule's, that shorter rule, a rule indented inside a block, a group spelled down several lines, and one selector opening two rules.
fn made_up_stylesheet() -> &'static str {
    "body.is-embedded .reader-toolbar {
  display: none;
}
.reader-toolbar {
  bottom: var(--lt-space-16);
}
@media (prefers-reduced-motion: reduce) {
  .reader-toolbar {
    transition: none;
  }
}
.leaf-scroll,
.library-scroll {
  --lt-scroll-thumb: transparent;
}
.tab-active {
  max-width: none;
}
.tab-active {
  --tab-fill: var(--lt-background);
}
"
}

#[test]
fn a_rule_is_read_off_the_line_its_selector_opens() {
    // The fault itself: matched as a plain substring, `.reader-toolbar {` answered from seventeen characters into the embedded reader's rule, with `display: none`.
    assert_contains(
        rule_body(made_up_stylesheet(), ".reader-toolbar {"),
        "bottom: var(--lt-space-16);",
    );
}

#[test]
#[should_panic(expected = "body.is-embedded .reader-toolbar {")]
fn a_selector_that_is_only_ever_the_tail_of_a_longer_one_is_refused() {
    // Refused rather than answered, and the refusal shows the line the match landed inside — which is the only thing that tells the reader their rule is not the one they asked for.
    rule_body(made_up_stylesheet(), "embedded .reader-toolbar {");
}

#[test]
fn a_rule_indented_inside_a_block_is_answered_when_the_selector_carries_the_indent() {
    assert_contains(
        rule_body(made_up_stylesheet(), "  .reader-toolbar {"),
        "transition: none;",
    );
}

#[test]
fn a_group_spelled_down_several_lines_answers_with_its_own_body() {
    assert_contains(
        rule_body(made_up_stylesheet(), ".leaf-scroll,\n.library-scroll {"),
        "--lt-scroll-thumb: transparent;",
    );
}

#[test]
#[should_panic(expected = "opens 2 rules")]
fn a_selector_the_stylesheet_opens_twice_is_refused() {
    // Answered with the first, a rule the caller never meant reads as the rule they asked for — and the first is only first until somebody adds a rule above it.
    rule_body(made_up_stylesheet(), ".tab-active {");
}

#[test]
fn naming_the_first_declaration_says_which_of_two_rules_with_one_selector_is_meant() {
    assert_contains(
        rule_body(made_up_stylesheet(), ".tab-active {\n  --tab-fill:"),
        "--tab-fill: var(--lt-background);",
    );
}

#[test]
fn reading_every_rule_a_selector_opens_answers_absence_and_duplication_rather_than_refusing_them() {
    // The caller that composes its selector out of a class name cannot take a refusal: a class with no rule is an answer, and a class with two is two rules that both have to be read. Answered with the first, a `display` in the second is silently not there.
    assert!(rule_bodies(made_up_stylesheet(), ".no-such-class {").is_empty());
    let both = rule_bodies(made_up_stylesheet(), ".tab-active {");
    assert_eq!(both.len(), 2, "both rules the selector opens: {both:?}");
    assert!(both[0].contains("max-width: none;"), "{both:?}");
    assert!(
        both[1].contains("--tab-fill: var(--lt-background);"),
        "{both:?}"
    );
    // And it anchors the same way the single-rule read does, so a longer selector ending the same way is not one of the answers.
    assert_eq!(
        rule_bodies(made_up_stylesheet(), ".reader-toolbar {").len(),
        1,
        "the embedded reader's rule merely ends with this selector"
    );
}

#[test]
fn one_rule_sits_after_another_by_where_each_rule_opens() {
    // A comparison made on the first substring reads whichever longer selector ends the same way, which here is a rule above the one meant rather than below it.
    let css = made_up_stylesheet();

    assert!(
        rule_at(css, ".reader-toolbar {") > rule_at(css, "body.is-embedded .reader-toolbar {"),
        "the bar's own rule is written after the one that turns it off"
    );
    assert!(
        css.find(".reader-toolbar {") < css.find(".leaf-scroll,"),
        "the plain find lands inside the embedded rule, which is what a source-order comparison used to read"
    );
}

#[test]
fn reading_mode_css_offsets_document_by_measured_scroll_origin() {
    let css = reading_mode_css();

    assert_contains(
        css,
        "margin: calc(-1 * var(--reader-scroll-origin, 0px)) 0 0;",
    );
}

#[test]
fn find_matches_are_painted_without_touching_the_document() {
    let css = reading_mode_css();

    // Both names twice over: the reading view paints them through the CSS Custom Highlight API (no DOM mutation, no reflow) and the source view as Monaco decorations, which are ordinary classes.
    for expected in [
        "::highlight(leaf-find-match),\n.leaf-find-match {",
        "::highlight(leaf-find-current),\n.leaf-find-current {",
        // The match wash is the accent a search hit already takes in the pane; the one you are on is the primary, so stepping is a moving mark.
        "background-color: color-mix(in srgb, var(--lt-accent) 45%, transparent);",
        "background-color: color-mix(in srgb, var(--lt-primary) 45%, transparent);",
    ] {
        assert_contains(css, expected);
    }

    // The bar holds its place while the document scrolls under it, and its box is padded rather than being the tightest thing on screen.
    let bar_rule = rule_body(css, ".find-bar {");
    assert_contains(bar_rule, "grid-column: 2;");
    assert_contains(bar_rule, "grid-row: 1;");
    assert_contains(bar_rule, "padding: var(--lt-space-10);");
}

#[test]
fn find_bar_controls_are_the_app_bars_own_button_size() {
    // The bar's buttons wear .icon-button for their 32px box, and this rule is 4,650 lines later at the same one-class depth — so a height, a min-width or a padding here would silently win and put them back at 16px, which is an icon with no button around it.
    let css = reading_mode_css();
    let rule = rule_body(css, ".find-flag,\n.find-step,\n.find-action {");

    for absent in ["height:", "min-width:", "padding:"] {
        assert!(
            !rule.contains(absent),
            "the shared find-button rule must not set {absent} — .icon-button owns the box:\n{rule}"
        );
    }
    // The text on them matches the rest of the chrome rather than being a size smaller.
    assert_contains(rule, "font-size: var(--lt-text-12);");

    // The ones holding text win their width back, because .icon-button sets a width and 32px clips `ab|`. Anchored on the declaration: `.find-action {` on its own also matches the end of the shared selector list above.
    assert_contains(css, ".find-flag {\n  width: auto;");
    assert_contains(css, ".find-action {\n  width: auto;");

    // And the box they defer to is the 32px one, so "same as the app bar's" is a number and not a hope. At the start of a line, or the comment that quotes the selector matches first.
    let box_rule = rule_body(css, ".icon-button {");
    assert_contains(box_rule, "height: 32px;");
    assert_contains(box_rule, "min-width: 32px;");
}

#[test]
fn the_bare_button_rule_names_its_own_line_height() {
    // A `font` shorthand here once left this at `normal`, read off whichever face is loaded — on the one rule reaching every button in the app and every button a document draws.
    let css = reading_mode_css();
    assert_contains(
        rule_body(css, "button {"),
        "line-height: var(--lt-leading-1-2);",
    );
}

#[test]
fn the_find_bar_throws_the_same_dot_shadow_as_every_other_floating_panel() {
    // In the shared list, not a tenth copy of it: the spread is a fixed inset and the punch is that inset taken back off, so it fits any size of box. The reader toolbar's own copy is not a precedent — it has one mask, no punch, having no opaque face to clear.
    let css = reading_mode_css();
    let shared = rule_at(css, ".app-overflow-panel::before,");
    let selectors = &css[shared..shared + css[shared..].find('{').expect("the rule opens")];
    assert_contains(selectors, ".find-bar::before,");

    // The dots have to be the ::before and the opaque face the ::after: both children sit at --lt-z-below, so tree order is what puts the face over the dots that fall on it, and swapping them would draw a screen of dots across the bar.
    assert_contains(
        rule_body(css, ".find-bar::after {"),
        "background: var(--lt-surface-elevated);",
    );
}

#[test]
fn the_find_bar_gives_way_rather_than_running_off_a_narrow_page() {
    // Three answers, smallest step first: the field shrinks, then the row wraps, then the bar stops floating. The reading column can be 360px (MIN_READER_WIDTH) and the row wants about 370, so without these the part clipped is the field you type into.
    let css = reading_mode_css();

    let field = rule_body(css, ".find-field {");
    assert_contains(field, "flex: 1 1 auto;");
    assert_contains(field, "min-width: 120px;");
    assert_contains(rule_body(css, ".find-row {"), "flex-wrap: wrap;");

    // The cap holds the bar's border and 10px inset inside the number because the rule at the top of the stylesheet already gave it a border box.
    let bar = rule_body(css, ".find-bar {");
    assert_contains(bar, "max-width: calc(100% - var(--lt-space-16));");

    // The full-width block is the reader's own 600px, not a second number nobody can defend.
    let block = rule_body(css, "@media (max-width: 600px) {\n  .find-bar {");
    assert_contains(block, "justify-self: stretch;");
    assert_contains(block, "max-width: none;");
}

#[test]
fn reading_mode_css_pins_reader_to_its_grid_cell() {
    // The reader must be explicitly placed in the library-shell grid. Auto-placed, unhiding the .reader-loading overlay (explicitly at column 2, row 1) evicts the reader into an implicit row in the 0px library column, reflowing the whole document at zero width and turning every in-flight scroll computation into garbage — the "page jumps all over the place" bug.
    let css = reading_mode_css();
    let shell_rule = rule_body(css, ".reader-shell {");

    assert_contains(shell_rule, "grid-column: 2;");
    assert_contains(shell_rule, "grid-row: 1;");
}

#[test]
fn reading_mode_css_softens_the_readers_top_and_bottom_edges() {
    // The wash has to be a sibling in the reader's grid cell, hung off the app bar's height at the top. Inside the scroller it would be positioned against the scrolled content and slide away with the document; drawn from the cell's top it would sit behind the opaque bar and never show.
    let css = reading_mode_css();
    let rule = rule_body(css, ".reader-edge-fade {");

    assert_contains(rule, "grid-column: 2;");
    assert_contains(rule, "grid-row: 1;");
    assert_contains(rule, "pointer-events: none;");
    // The wash behind the dot screen: one band per edge, opaque at each cut and gone by the far side. It sits here rather than on the bands because those are masked, and the mask would ramp it a second time. At :root, not on this element: a widened table dissolves its own sliced ends with the same depth and the same hold, so every edge in the app is one profile.
    assert_contains(css, "  --reader-edge-fade-depth: 36px;");
    assert_contains(css, "  --reader-edge-fade-hold: 2px;");
    // The card's three hairlines are reserved with a transparent border, never a spacing value: a border width is snapped to whole device pixels and a margin is not, so a margin of the same width leaves half a device pixel of the last line un-faded at any scaling that is not a whole number.
    assert_contains(rule, "border: 0 solid transparent;");
    assert_contains(
        rule,
        "border-width: 0 var(--lt-stroke-1) var(--lt-stroke-1);",
    );
    // Which leaves the margin holding only what is not a hairline. The scrollbar belongs to the scroller, which paints it inside a box this overlay sits on top of — there is no z-index that puts it back on top, so the bands hold off its gutter instead. It closes with the minimap rail.
    assert_contains(rule, "margin-right: var(--reader-scrollbar);");
    assert!(
        !rule.contains("--lt-space-1"),
        "the edge fade should reserve the card's hairlines with a border, not a spacing value"
    );
    // The inner corner is the outer one less the border, worked out from a border snapped the way the card's is — so no hand-written correction.
    assert_contains(
        rule,
        "border-radius: 0 0 var(--lt-radius-md) var(--lt-radius-md);",
    );
    // With no rail to sit against the card is held off the left frame, and that margin is the gutter alone for the same reason.
    let closed = rule_body(css, ".library-shell.library-closed .reader-edge-fade {");
    assert_contains(closed, "margin-left: var(--reader-gutter);");
    assert_contains(css, "  --reader-scrollbar: 14px;");
    let railed = rule_body(css, "body:has(.document-minimap) {");
    assert_contains(railed, "--reader-scrollbar: 0px;");
    // Same width the scrollbar itself is set to, which stays a literal there: Chromium won't re-resolve a scrollbar pseudo-element on a :has() flip. The block is named by its first selector, not its last, because the wearer list grows at the end and a box joining it read as this rule having been deleted.
    let bar = rule_body(css, ".leaf-scroll::-webkit-scrollbar,");
    assert_contains(bar, "width: 14px;");
    // Two cuts, two washes.
    assert_eq!(rule.matches("linear-gradient(").count(), 2);
    // The wash spans the same depth as the screen over it, not its own. Given a shorter one its ramp ends where the screen's carries on, and the break in slope reads as a bright line at the halfway mark.
    assert_contains(
        rule,
        "background-size: 100% var(--reader-edge-fade-depth), 100% var(--reader-edge-fade-depth);",
    );
    assert_contains(
        rule,
        "background-position: 0 var(--app-bar-height), 0 100%;",
    );
    assert_contains(
        css,
        ".reader-edge-fade::before {\n  top: var(--app-bar-height);",
    );
    assert_contains(css, ".reader-edge-fade::after {\n  bottom: 0;");
    // No band down the sides, and nothing to hang one on. Nothing is cut there: a widened table stops 62px inside the page edge and dissolves its own ends, so a side band only ever veiled the first and last letter of every line, which is what v0.1.469 shipped.
    for gone in [
        ".reader-edge-fade-side",
        ".reader-edge-fade-left",
        ".reader-edge-fade-right",
    ] {
        assert!(
            !css.contains(gone),
            "the reader's side bands must stay out of the stylesheet: {gone} is back"
        );
        assert!(
            !app_shell_page().contains(gone),
            "the reader's side bands must stay out of the page: {gone} is back"
        );
    }
    // The code view repaints the card, so the fade has to follow that color.
    assert_contains(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
}

#[test]
fn the_pages_two_bottom_corners_keep_their_stroke() {
    // The clip is the half of this that is easy to drop: the transparent border reserves the card's straight edges, the padding-box clip reserves its curve. Without it the wash is cut at the border box and paints over both bottom arcs — the bottom-left one always, the bottom-right one whenever a minimap takes its scrollbar reserve to zero.
    let css = reading_mode_css();
    let rule = rule_body(css, ".reader-edge-fade {");
    assert_contains(rule, "background-clip: padding-box;");
    // Both halves, or the corner comes back the other way round.
    assert_contains(
        rule,
        "border-width: 0 var(--lt-stroke-1) var(--lt-stroke-1);",
    );
    // And the curve being reserved has to be the card's own, or the clip is cut to a shape nothing draws.
    let radius = "border-radius: 0 0 var(--lt-radius-md) var(--lt-radius-md);";
    let card = rule_body(css, ".reader-shell {");
    assert_contains(
        card,
        "border-bottom: var(--lt-stroke-1) solid var(--lt-border);",
    );
    assert_contains(card, radius);
    assert_contains(rule, radius);
}

#[test]
fn the_readers_edges_reuse_the_chromes_grain_and_fade_it_by_opacity() {
    // The edge is the chrome's dot screen in the page's color, so it has to be the same circle on the same lattice as the bar — and each rule has to write the circles itself. A custom property holding the whole gradient resolves its ink where it is declared, so one at `:root` outranks every `--lt-grain-dot` below it: v0.1.439 screened the chrome's dark ink over a light page, 239-255 gray where the page is 255.
    let css = reading_mode_css();
    let grain = "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);";
    assert!(
        !css.contains("--lt-grain-image:"),
        "the lattice must not go through a variable holding the whole gradient: the ink \
         inside it would resolve at the root and no override could reach it"
    );
    let bar = rule_body(css, ".app-bar {");
    assert_contains(bar, grain);
    assert_contains(bar, "background-size: 2px 2px;");

    let shared = rule_body(css, ".reader-edge-fade::before,");
    assert_contains(shared, grain);
    assert_contains(shared, "background-size: 2px 2px;");
    // And the ink is the page's own color, which is the whole point: over a flat page the screen cannot be seen, and over a tinted block at the edge it still carries the lattice.
    assert_contains(shared, "--lt-grain-dot: var(--reader-edge-fade-surface);");
    assert_contains(
        rule_body(css, ".reader-edge-fade {"),
        "--reader-edge-fade-surface: var(--lt-markdown-background);",
    );
    assert_contains(
        rule_body(css, ".reader-shell {"),
        "background: var(--lt-markdown-background);",
    );
    // Depth is one number, shared with the wash under the screen.
    assert_contains(shared, "height: var(--reader-edge-fade-depth);");
    // One window-anchored lattice across every grained surface.
    assert_contains(shared, "background-attachment: fixed;");
    // One even screen. A second dot layer is a size ramp, which reads as stacked bands. One even screen. A second dot layer is a size ramp, which reads as stacked bands.
    assert_eq!(shared.matches("radial-gradient(").count(), 1);

    // Opposite directions, and both taking their hold from the same variable the wash does: the two fades cover one span, and any daylight between their profiles comes back as a bright line where the slopes part. A transform would flip the box but also make it the containing block for its own fixed background, knocking it off the shared lattice. Anchored past the shared rule, whose own selector list ends in the same `.reader-edge-fade::after {` the bottom band's rule opens with.
    let standalone = &css[rule_at(css, ".reader-edge-fade::before {")..];
    let top = rule_body(standalone, ".reader-edge-fade::before {");
    let bottom = rule_body(standalone, ".reader-edge-fade::after {");
    assert_contains(top, "mask-image: linear-gradient(\n    to bottom,");
    assert_contains(bottom, "mask-image: linear-gradient(\n    to top,");
    for edge in [top, bottom] {
        assert_contains(
            edge,
            "var(--lt-mask-opaque) 0 var(--reader-edge-fade-hold),",
        );
        // WebView2 is Chromium, but WKWebView wants the prefix.
        assert_contains(edge, "-webkit-mask-image:");
        assert!(!edge.contains("transform:"));
    }
}

#[test]
fn app_shell_hosts_the_reader_edge_fade() {
    let html = app_shell_page();

    assert_contains(&html, "class=\"reader-edge-fade\"");
}

#[test]
fn reading_mode_css_keeps_minimap_stable_wide_enough_and_responsive() {
    let css = reading_mode_css();

    for expected in [
            ".reader-layout {",
            "--reader-layout-padding-inline: var(--reader-content-pad);",
            "grid-template-columns: minmax(0, 1fr);",
            "justify-items: center;",
            "padding: 0 var(--reader-layout-padding-inline);",
            "position: relative;",
            ".reader-layout-no-minimap",
            "justify-items: center;",
            ".document-minimap {",
            "--minimap-padding-inline: 8px;",
            "--minimap-preview-width: 68px;",
            "--minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));",
            "width: var(--minimap-width);",
            ".document-minimap-track {",
            ".document-minimap-content",
            ".document-minimap-preview",
            "left: var(--minimap-padding-inline);",
            "right: var(--minimap-padding-inline);",
            "cursor: default;",
            "touch-action: none;",
            "user-select: none;",
            "@media (max-width: 900px)",
            "--minimap-preview-width: 46px;",
            // The rail is chrome, not page: its own shell column, a lead-in holding the card's right border off it, the window gutter beyond it, and no bleed or sticky, because it does not live in the scroller it tracks.
            ".reader-minimap {",
            "grid-column: 3;",
            "padding-left: var(--reader-minimap-gap);",
            "--reader-minimap-gap: 4px;",
            "body:has(.document-minimap) {",
            "--reader-minimap-column: calc(var(--minimap-width) + var(--reader-minimap-gap));",
        ] {
            assert_contains(css, expected);
        }

    for gone in [
        "margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));",
        ".reader-layout:has(.document-minimap)",
        "position: sticky;\n  top: 0;\n  width: var(--minimap-width);",
    ] {
        assert!(
            !css.contains(gone),
            "the rail sits outside the page now, so {gone} should be gone"
        );
    }

    assert!(
        !css.contains(".document-minimap {\n    display: none;"),
        "minimap must stay visible on narrow windows so it remains the scroll affordance"
    );

    for removed_fixed_height in [
        "height: calc(100vh - 150px);",
        "min-height: 180px;",
        "max-height: 720px;",
    ] {
        assert!(
            !css.contains(removed_fixed_height),
            "minimap rail should use measured reader viewport height, not {removed_fixed_height}"
        );
    }

    assert!(
        !css.contains("--reader-layout-padding-inline: 14px;"),
        "reader side padding should follow the web reader content pad token"
    );

    assert!(
            !css.contains("padding-inline: var(--minimap-padding-inline);"),
            "minimap track padding would double-inset the preview lane and keep the viewport overlay from reading as edge-to-edge"
        );
    assert!(
            !rule_body(&css, ".document-minimap-track {").contains("border-left"),
            "minimap track border must not consume layout width because the preview lane needs exactly 8px from both minimap edges"
        );
    assert!(
        css.contains(".document-minimap-viewport {\n  position: absolute;\n  inset-inline: 0;"),
        "minimap viewport must span the full rail width"
    );
    assert!(
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: 0;\n  transform: translateY(0px);\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "the minimap thumbnail lane fills the rail inside the exact 8px padding on both edges"
        );
    // The clone is laid out inside a frame carrying the same container query the reading layout carries, so a wide table in the thumbnail measures the room the page gives it instead of the whole window — which is what left the thumbnail a fifth short of the bottom.
    assert!(
        css.contains(
            ".document-minimap-frame {\n  container-type: inline-size;\n  transform-origin: 0 0;\n}"
        ),
        "the clone's frame must carry the reading layout's container query, and the scale with it"
    );
    assert_eq!(
        css.matches("  container-type:").count(),
        3,
        "only the reading layout, the clone's frame and the start screen declare a container query"
    );
    // The frame is the transformed element now, so the clone needs a containing block of its own or every absolutely positioned part of a rendered document measures off a box the width of the layout.
    assert!(
        rule_body(&css, ".document-minimap-preview {").contains("position: relative;"),
        "the clone must stay the containing block for a document's absolutely positioned parts"
    );
    assert!(
        !rule_body(&css, ".document-minimap-preview {").contains("transform-origin"),
        "the scale is the frame's now, so the clone should not keep a transform origin"
    );
    // The slide is a transform, not `top`: the lane moves every frame, and as a layout property `top` makes the browser re-lay-out the page to move it — 128ms worst frame on a 4MB glossary against 44ms, the no-rail floor.
    assert!(
        css.contains("  will-change: transform;"),
        "the thumbnail lane must be promoted for its transform, not for `top`"
    );
    // The reader renders the whole document up front, so it must NOT use content-visibility, which flashes blocks blank and jumps the minimap box.
    assert!(
        !css.contains("content-visibility: auto"),
        "the reader must render in full (no content-visibility) so scrolling matches the web"
    );
    // Same invariant from the other side: the rail is chrome, so its column is exactly the rail plus the lead-in, and no dead strip can open up between the page's right border and the rail, or past it.
    assert_contains(
        css,
        "--reader-minimap-column: calc(var(--minimap-width) + var(--reader-minimap-gap));",
    );
    assert_contains(css, "width: var(--minimap-width);");

    // The rail is the only thing showing position while it is there, so the native bar is hidden — and has to come back when it isn't. The two branches must stay apart: `scrollbar-width` anywhere on the element would kill the ::-webkit-scrollbar rules the visible branch is built from.
    assert_contains(
        css,
        ".reader-shell.has-minimap {\n  scrollbar-width: none;\n}",
    );
    // The thumb is inset by a transparent border with the fill clipped inside it; a bare width would put it flush against the card's border and corners. How deep the inset goes is a property the pointer shrinks, so the thumb thickens under an aim.
    assert_contains(
        css,
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb",
    );
    assert_contains(
        css,
        "border: var(--lt-scroll-thumb-inset) solid transparent;\n  background-clip: padding-box;",
    );
    // Keyed off the renderer's class, never :has() — scrollbar styles do not re-resolve when a :has() match flips, so the bar outlives the rail.
    assert!(
        !css.contains(":has(.document-minimap) .reader-shell::-webkit-scrollbar"),
        "scrollbar visibility must not hang off :has()"
    );
    assert_contains(
        &app_shell_page(),
        "app.classList.toggle('has-minimap', Boolean(html));",
    );

    // The corner overlay paints chrome over the card's square corner and masks the arc back out. The mask must be unconditional: on a rule only some states match, the rest render a plain block in the corner.
    let corner = rule_body(css, ".reader-corner-tr {");
    assert!(
        corner.contains("mask-image: radial-gradient(circle at 0 100%"),
        "the corner's mask must sit on its base rule: {corner}"
    );
    // And it follows the card in when the rail takes a column beside it.
    assert!(
        corner.contains("right: calc(var(--reader-gutter) + var(--reader-minimap-column));"),
        "the corner must track the card's right edge: {corner}"
    );
    assert!(
        !css.contains(
            ".reader-shell {\n  background: var(--lt-markdown-background);\n  scrollbar-width: none;"
        ),
        "scrollbar-width must not sit on the base rule, or the thin bar can never be styled"
    );
}

#[test]
fn the_page_ends_above_the_floating_bar() {
    let css = reading_mode_css();

    // The bar floats over the foot of the page, so the page has to stop short of it — otherwise the last thing on the page sits underneath, which the Previous/Next pager makes obvious by being both last and a target.
    assert_contains(
        css,
        "  padding-bottom: calc(var(--reader-content-pad) + var(--reader-toolbar-space, 0px));",
    );
    // Room only while the bar is up: no bar, no gap at the bottom of the page.
    assert_contains(css, "  --reader-toolbar-space: 0px;");
    assert_contains(
        css,
        "body:has(#readerToolbar:not([hidden])) {\n  --reader-toolbar-space: 52px;\n}",
    );
    // The pager's own top margin still clears the app bar; this is added below it, not instead of it.
    assert_contains(css, "margin-top: var(--app-bar-height);");
}

#[test]
fn the_bar_is_measured_against_the_page_and_the_map_together() {
    let css = reading_mode_css();

    // Only the reading view opens the minimap's track, so a bar centered on the page column alone lands 31px left of where the source view draws the identical bar, and the button a reader goes back to most moves every time they switch view. The source view's own map strip is the editor's, drawn inside the page column, so it is already inside the measurement.
    let bar = rule_body(css, ".reader-toolbar {");
    assert_contains(bar, "grid-column: 2 / 4;");
    // The bar keeps the size and the centering it has always had: only which lane it is measured against changes.
    assert_contains(bar, "justify-self: center;");
    assert_contains(bar, "display: flex;");
    assert_contains(bar, "margin-right: calc(-1 * var(--reader-toolbar-edits));");
    assert_contains(css, "--reader-toolbar-edits: 0px;");
    // Column 4 is the gutter holding the page off the window frame, and the bar stops short of it the way the page does.
    assert!(!bar.contains("grid-column: 2 / 5;"));
}

#[test]
fn the_graph_size_box_uses_the_wells_inset_on_every_side() {
    let css = reading_mode_css();
    let tray = rule_body(css, ".reader-tool-tray {");
    let label = rule_body(css, ".reader-subselect {");
    let select = rule_body(css, ".reader-subselect select {");

    assert_contains(tray, "padding: var(--lt-space-2);");
    assert!(!label.contains("padding:"));
    assert_contains(select, "height: 26px;");
}

#[test]
fn both_dropdowns_use_the_apps_chevron_and_insets() {
    let css = reading_mode_css();
    let html = app_shell_page();
    let select = rule_body(css, ".leaf-select select {");
    let arrow = rule_body(css, ".leaf-select > .lt-icon-chevron-down {");

    assert_contains(select, "appearance: none;");
    assert_contains(
        select,
        "padding-inline: var(--lt-space-8) var(--lt-space-24);",
    );
    assert_contains(arrow, "right: var(--lt-space-6);");
    assert_contains(arrow, "pointer-events: none;");
    assert_contains(
        &html,
        r#"<label class="reader-subselect leaf-select" id="graphScopeTool" hidden>"#,
    );
    assert_contains(&html, r#"<label class="flow-sheet-direction leaf-select">"#);
    assert_eq!(
        html.matches(r#"<span class="lt-icon lt-icon-chevron-down" aria-hidden="true"></span>"#)
            .count(),
        2
    );
}

#[test]
fn the_map_takes_the_column_the_minimap_is_not_using() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The minimap hides in graph view, but its track is a fixed width and stays reserved — leaving an empty strip down the right of the canvas that reads as a rendering fault. Column 4 is the gutter and stays: the map is held off the window frame the way the page is.
    assert!(css.contains("grid-column: 2 / 4;"));
    assert!(html.contains(
        "document.documentElement.dataset.graphView = graphViewOpen ? 'true' : 'false';"
    ));
    // The wash over a slow load has to cover the same width, or it stops a column short and leaves a lit strip down the right of the canvas. The floating bar needs no override here: it spans both columns in every view — see the_bar_is_measured_against_the_page_and_the_map_together.
    assert_contains(
        rule_body(css, ":root[data-graph-view=\"true\"] .reader-loading {"),
        "grid-column: 2 / 4;",
    );
    assert!(css.contains(":root[data-graph-view=\"true\"] .reader-edge-fade {"));

    // And the chrome that draws the top of the card has to reach the map's right edge, not the page's. Both the bar's divider and the top-right arc are positioned off the minimap column, so the column closes in this view rather than each of them learning about the map: the stroke used to stop a rail's width short and the arc turned down in mid-air over the top of the canvas.
    assert_contains(
        css,
        ":root[data-graph-view=\"true\"] > body {\n  --reader-minimap-column: 0px;\n}",
    );
    // Set on `body`, where the rule that opens the column sets it. A custom property on an element beats one inherited from :root, however specific the :root selector is — the override would simply never apply.
    let opens = rule_at(css, "body:has(.document-minimap) {");
    let closes = rule_at(css, ":root[data-graph-view=\"true\"] > body {");
    assert!(
        opens < closes,
        "the graph-view override has to come after the rule it overrides"
    );
}
