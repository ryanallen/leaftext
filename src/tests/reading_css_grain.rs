//! The dot grain, the one hover wash, every shadow and the scrim.

use super::*;

#[test]
fn the_home_screens_new_document_button_stays_readable_on_hover() {
    // With a color and no background of its own, the generic `button:hover` fill stays underneath and hover is one purple on another. Both states name a pair the theme compiler gates, so no theme can repeat it.
    let css = reading_mode_css();

    let rest = rule_body(&css, ".primary-new {");
    assert_contains(rest, "background: transparent;");
    assert_contains(rest, "color: var(--lt-markdown-foreground);");

    let hover = rule_body(&css, ".primary-new:hover {");
    assert_contains(
        hover,
        "background: var(--lt-navigation-button-hover-background);",
    );
    assert_contains(hover, "color: var(--lt-primary-foreground);");
}

#[test]
fn table_rows_are_grained_on_both_stripes_with_the_darker_row_darker() {
    let css = reading_mode_css();

    // Dark themes grain both stripes; light themes leave the untinted rows plain, because there a dot dark enough to see reads as a gray mesh over the table.
    assert_contains(css, "--reader-surface-grain: var(--app-bar-grain);");
    assert_contains(css, "--reader-row-grain: transparent;");
    // Lighter, not darker — the untinted row is the darkest surface in the app, so darkening it has nowhere to go and lands unevenly across theme families.
    assert_contains(css, "--reader-row-grain: var(--lt-grain-lift);");

    // The zeroed value must be the light default and the lift the dark override, not the reverse — that swap is exactly what this pins.
    let light = css
        .find("--reader-row-grain: transparent;")
        .expect("light themes zero the row grain");
    let dark = css
        .find("--reader-row-grain: var(--lt-grain-lift);")
        .expect("dark themes set the row grain");
    let dark_block = css
        .find("[data-theme=\"dark\"]")
        .expect("the dark override block");
    assert!(light < dark_block, "the zeroed value is the light default");
    assert!(dark > dark_block, "the lifted value is the dark override");

    let even = css
        .find("tr:nth-child(2n) td")
        .expect("the tinted rows are grained");
    let odd = css
        .find("tr:nth-child(2n + 1) td")
        .expect("the untinted rows are grained too");
    let frontmatter = css
        .find(".frontmatter tr td")
        .expect("the frontmatter table opts out");

    // The row grain belongs to the untinted stripe, not the tinted one.
    assert_contains(&css[odd..], "--lt-grain-dot: var(--reader-row-grain);");
    // Same 2px lattice on both, so the dots line up down the page across a stripe.
    assert_contains(&css[odd..], "background-size: 2px 2px;");

    // Source order is load-bearing: the row rules and the frontmatter opt-out tie on specificity, so the opt-out wins only by coming last.
    assert!(even < odd, "even-row grain should precede odd-row grain");
    assert!(
        odd < frontmatter,
        "the frontmatter opt-out must come after both row rules to win the tie"
    );
}

#[test]
fn every_hover_fills_with_the_one_wash() {
    // One strength for everything under the pointer, so a menu row, a file in the pane and a tool in the reading bar all lift by the same amount. A surface color instead is free to be the very value of the panel behind it, which is what left a right-click menu marking nothing in Pippin dark.
    let css = reading_mode_css();

    // The rule a selector opens, up to its closing brace. Named selectors are grouped (`.a:hover,\n.a:focus-visible {`), so the block is found from the name rather than from a whole selector list.
    let rule_after = |selector: &str| -> &str {
        let at = css
            .find(selector)
            .unwrap_or_else(|| panic!("expected a rule for {selector}"));
        let open = css[at..].find('{').expect("the rule opens");
        let close = css[at + open..].find('}').expect("the rule closes");
        &css[at + open..at + open + close]
    };

    for selector in [
        ".context-menu-item:hover",
        ".filter-menu-item.is-active",
        ".flow-menu-item:hover",
        ".library-file:hover",
        ".library-hit:hover",
        ".library-crumb:hover",
        ".library-vault-switch:hover",
        ".crumb-menu-edit:hover",
        ".reader-tool:hover",
        ".reader-subtool:hover",
        // Back and Forward are not on this list: they are chrome, and chrome under the pointer is a colored state rather than a wash. Their own test below holds it.
    ] {
        assert!(
            rule_after(selector).contains("background: var(--lt-wash-hover);"),
            "expected {selector} to fill with the hover wash"
        );
    }

    // And the wash is one mix of a color the family owns, so it can never come out the tone of what it sits on.
    assert_contains(
        css,
        "--lt-wash-hover: color-mix(in srgb, var(--lt-hover-tint) 16%, transparent);",
    );

    // The locked diagram canvas is the one rule left filling with the tinted-panel color, and it has to stay one: it is a panel, not a hover, and a transparent wash over the page would leave a locked diagram looking live.
    assert!(
        rule_after(".flow-canvas.is-disabled").contains("background: var(--lt-surface-muted);"),
        "the disabled diagram canvas is a panel and keeps its own fill"
    );
}

#[test]
fn the_history_buttons_fill_with_the_theme_rather_than_uncovering_the_bar() {
    // Back and Forward paint no grain of their own: they rest on an opaque chip, and a see-through hover wash simply stopped covering the app bar's lattice, so the pointer looked like it was switching the button off. An opaque theme fill is what covers the bar again, and it is the same fill the four chrome buttons beside them already wear.
    let css = reading_mode_css();

    let hover = rule_body(&css, ".history-button:hover:not(:disabled) {");
    assert_contains(
        hover,
        "background: var(--lt-navigation-button-hover-background);",
    );
    assert_contains(
        hover,
        "border-color: var(--lt-navigation-button-hover-background);",
    );
    // The arrow is a mask, so the button's own color paints it and the glyph inverts on the fill for free.
    assert_contains(hover, "color: var(--lt-primary-foreground);");
    assert!(
        !hover.contains("var(--lt-wash-hover)") && !hover.contains("transparent"),
        "a see-through hover is what let the bar's grain through, so neither the wash nor a transparent fill may come back"
    );

    // The rest state stays opaque for the same reason, and the disabled pair keeps saying the button cannot be pressed.
    assert_contains(
        rule_body(&css, ".history-button {"),
        "background: var(--lt-surface-elevated);",
    );
    assert_contains(
        rule_body(&css, ".history-button:disabled,"),
        "background: var(--lt-surface-elevated);",
    );
}
#[test]
fn enabled_buttons_use_the_hand_and_disabled_buttons_keep_the_arrow() {
    // The hand says "this can be pressed", so an enabled button wears it and the shared `button` rule is where it is written — a control added later takes it without anybody remembering. The rule is deliberately weak: a single-class rule still beats it, which is what leaves a control whose gesture is a drag or a draw wearing its own shape, and what leaves the app's own furniture at the top of the window wearing the arrow.
    let css = reading_mode_css();

    assert_contains(rule_body(&css, "button {"), "cursor: pointer;");
    // And the hand is still handed out from there rather than named control by control: the exception below is three rules, not the hand being withdrawn. The shared rule stays the bare element with no class or id on it and no `!important`, or the eight would need one of their own to win.
    let shared = rule_body(&css, "button {");
    assert!(
        !shared.contains('!'),
        "the shared hand must stay weak enough for a one-class rule to beat it"
    );
    assert!(
        css.contains("\nbutton {") || css.starts_with("button {"),
        "the hand is written on the bare element, so every button added later takes it"
    );
    // A control that cannot be pressed says so, and its rule outranks the shared one.
    assert_contains(rule_body(&css, "button:disabled {"), "cursor: default;");
    // A document button is an anchor drawn as a button, so it is written rather than left to the browser.
    assert_contains(
        rule_body(&css, ".document-body a.leaf-md-button {"),
        "cursor: pointer;",
    );
    // The same button with an address this app will not follow is already drawn as plain words, so the pointer says so too.
    assert_contains(
        rule_body(&css, ".document-body a.leaf-md-button.link-goes-nowhere {"),
        "cursor: default;",
    );
    // Source order is what makes that arrow win: both rules are the document button's, and the dead one takes the hand back only by coming last.
    let live = css
        .find(".document-body a.leaf-md-button {")
        .expect("the live document button writes the hand");
    let dead = css
        .find(".document-body a.leaf-md-button.link-goes-nowhere {")
        .expect("the dead document button writes the arrow");
    assert!(
        live < dead,
        "the dead document button must come after the live one to take the hand back"
    );

    // The arrows that used to sit on native buttons are gone, or they would outrank the shared rule and the hand would stop at whichever control wrote one.
    for selector in [
        ".document-body pre > .code-copy {",
        ".table-sheet-open,
.image-sheet-open,",
    ] {
        assert!(
            !rule_body(&css, selector).contains("cursor: default"),
            "`{selector}` is a button, so it may not write the arrow back"
        );
    }

    // The eight icons the app bar draws for itself are the app's own furniture rather than something a document offers, so the pointer crosses the whole row as an arrow. Each already owned a one-class rule, which is what beats the shared hand without a second selector.
    for selector in [".export-button {", ".window-control {", ".library-open {"] {
        assert_contains(rule_body(&css, selector), "cursor: default;");
    }
    // And nothing wider than those three says it, or the arrow would reach the find bar's eleven icon controls, the leaf and the two history buttons — the controls the owner keeps the hand on.
    for selector in [
        ".icon-button {",
        ".brand-button {",
        ".history-button {",
        ".find-flag {",
        ".find-action {",
    ] {
        let bodies = rule_bodies(&css, selector);
        assert!(!bodies.is_empty(), "`{selector}` opens no rule");
        for body in bodies {
            assert!(
                !body.contains("cursor:"),
                "`{selector}` reaches controls that keep the hand, so it may not write a cursor"
            );
        }
    }

    // What is not a button keeps the shape its own gesture asks for. A summary and a task checkbox are not buttons and keep the arrow; the drag, draw, resize and text shapes stay where they were.
    assert_contains(
        rule_body(&css, ".document-body summary {"),
        "cursor: default;",
    );
    assert_contains(
        rule_body(
            &css,
            ".document-body input[type=\"checkbox\"]:not([disabled]) {",
        ),
        "cursor: default;",
    );
    assert_contains(rule_body(&css, ".flow-bud {"), "cursor: crosshair;");
    assert_contains(rule_body(&css, ".flow-edge-end {"), "cursor: crosshair;");
    assert_contains(
        rule_body(&css, ".block-gutter .block-grip {"),
        "cursor: grab;",
    );
    assert_contains(rule_body(&css, ".library-divider {"), "cursor: col-resize;");
    assert_contains(
        rule_body(&css, ".document-body .leaf-editable {"),
        "cursor: text;",
    );

    // Pointing at a tab shows the arrow: a tab drags, and an open hand on every one of them said so all the time. The closed hand stays, because that one is only up while a tab is actually moving.
    for selector in [".tab {", ".tab-label {"] {
        assert!(
            !rule_body(&css, selector).contains("cursor: grab;"),
            "`{selector}` offers the open hand before anything is being dragged"
        );
    }
    assert_contains(
        rule_body(&css, ".tab-dragging .tab-label {"),
        "cursor: grabbing;",
    );
    assert_contains(rule_body(&css, ".tab-dragging {"), "cursor: grabbing;");

    // And a drag that locks the whole window has to name the buttons too, or the pointer turns into a hand every time it crosses one and the drag reads as having let go.
    for selector in [
        "body.library-resizing button {",
        "body.is-home-row-dragging button {",
        "body.is-block-dragging button {",
        ".diagram-stage.is-panning button {",
    ] {
        assert!(
            css.contains(selector),
            "`{selector}` holds the drag shape over the controls it passes"
        );
    }

    // And no fragment may hand a cursor out from the script either: the map draws its nodes on a canvas, where a cursor is a property on the shape rather than a rule.
    assert!(
        !app_shell_script().contains("'pointer'") && !app_shell_script().contains("\"pointer\""),
        "the front end must not set a pointer cursor"
    );
}

#[test]
fn reading_surfaces_carry_the_chrome_dot_grain() {
    let css = reading_mode_css();

    // The chrome's own value, not one of its own: a lighter screen made the reading panels a second texture, brighter than the pane beside them.
    assert_contains(css, "--reader-surface-grain: var(--app-bar-grain);");
    assert!(
        !css.contains("--reader-surface-grain: rgba"),
        "the reader grain must stay one value with the chrome's, not a table of its own"
    );

    // Every tinted reading surface takes the grain, on the chrome's lattice.
    for expected in [
        ".document-body .document-outline,",
        ".document-body .tei-front,",
        ".document-body pre,",
        ".document-body th,",
        ".document-body tr:nth-child(2n) td {",
        "--lt-grain-dot: var(--reader-surface-grain);",
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
    ] {
        assert_contains(css, expected);
    }

    // The grain rule has to follow the fills it grains: at equal specificity a `background:` shorthand declared later blanks the image again. Found by its own selector list, not by the first mention of the token — a surface that outranks this rule restates the grain for itself, and the first mention is one of those.
    let shared = rule_at(
        css,
        ".document-body tr:nth-child(2n) td {\n  --lt-grain-dot:",
    );
    let grain = shared
        + css[shared..]
            .find("var(--reader-surface-grain)")
            .expect("reader grain rule");
    for fill in [
        ".document-body .document-outline {",
        ".document-body pre {\n  position: relative;",
        ".document-body th {",
    ] {
        let at = rule_at(css, fill);
        assert!(at < grain, "{fill} must be declared before the grain rule");
    }

    // The code view is a whole page, not a cell — graining it dithers the editor.
    let selectors = css[..grain]
        .rfind("*/")
        .map(|at| &css[at..grain])
        .expect("the grain rule is commented");
    assert!(
        !selectors.contains(".code-view"),
        "the code view must not be in the grain rule's selector list"
    );
}

#[test]
fn the_pager_card_fills_with_the_theme_and_throws_the_halftone_instead_of_graining() {
    let css = reading_mode_css();

    // It used to fill with the heaviest lattice in the tree, which is the app's own way of saying a thing is quiet — across a card the width of the measure that read as switched off. It takes the fill the chrome buttons take instead, and the halftone it throws is what keeps it from being a slab.
    let hover = rule_body(
        css,
        ".document-body .docs-pager a:hover,\n.document-body .docs-pager a:focus-visible {",
    );
    for expected in [
        "background: var(--lt-navigation-button-hover-background);",
        "border-color: var(--lt-navigation-button-hover-background);",
        "color: var(--lt-primary-foreground);",
        "text-decoration: none;",
    ] {
        assert_contains(hover, expected);
    }
    assert!(
        !hover.contains("radial-gradient") && !hover.contains("--lt-grain-dot"),
        "the lattice is what made the card read as disabled: {hover}"
    );

    // The kicker is a gray chosen against the page, so on a saturated fill it needs the inverted ink at three quarters or it vanishes.
    let label = rule_body(
        css,
        ".document-body .docs-pager a:hover .docs-pager-label,\n.document-body .docs-pager a:focus-visible .docs-pager-label {",
    );
    assert_contains(label, "color: var(--lt-primary-foreground);");
    assert_contains(label, "opacity: var(--lt-opacity-75);");

    // The halftone rides an absolutely positioned layer, which needs a positioned host.
    assert_contains(
        rule_body(css, ".document-body .docs-pager a {"),
        "position: relative;",
    );

    // Both pager rules are scoped under the document. Unscoped they weigh the same as the blanket link rule and lose to it for sitting earlier, which underlines the page name and takes its color.
    for scoped in [
        ".document-body .docs-pager a {",
        ".document-body .docs-pager a:hover,",
    ] {
        assert_contains(css, scoped);
    }
    assert!(
        !css.contains("\n.docs-pager a"),
        "an unscoped pager rule loses the underline fight to .document-body a:hover"
    );

    // And nothing may set a background after it: at equal weight a later `background:` shorthand blanks the fill.
    let at = css
        .find(".document-body .docs-pager a:hover,")
        .expect("the pager hover rule");
    assert!(
        !css[at..].contains(".docs-pager a {"),
        "a later pager fill would blank this one"
    );
}

#[test]
fn the_pagers_halftone_sits_above_the_reading_page_rather_than_below_it() {
    let css = reading_mode_css();

    // It joins the one shared list rather than copying the geometry, and then overrides the two lines that are right for a panel hanging over the page and wrong for a card sitting inside it.
    assert_contains(css, ".document-body .docs-pager a::before {");
    let own = rule_body(
        css,
        ".document-body .docs-pager a::before {
  z-index: 0;",
    );

    // The shared depth is negative, which drops the layer behind the opaque reading and library shells — neither opens a stacking context — so it never draws at all.
    assert_contains(own, "z-index: 0;");
    assert!(
        !own.contains("var(--lt-z-below)"),
        "a negative layer inside the document body renders nowhere: {own}"
    );

    // The shared ellipse fades across the whole box, which on a card this wide leaves the whole ring in the transparent tail. These are the link card's stops, which put the fade inside the band.
    assert_contains(own, "var(--lt-mask-opaque) calc(100% - 34px),");
    assert_contains(own, "mask-image: radial-gradient(");

    // Drawn at rest and revealed, because the literal gate refuses a lattice inside a hovered rule in any ink but the hover ink — and the halftone's is the shadow ink.
    assert_contains(own, "opacity: 0;");
    assert_contains(
        rule_body(
            css,
            ".document-body .docs-pager a:hover::before,\n.document-body .docs-pager a:focus-visible::before {",
        ),
        "opacity: 1;",
    );
}

#[test]
fn the_shared_halftone_list_still_holds_every_floating_surface() {
    let css = reading_mode_css();

    // The pager joining the list may not become a rewrite of it: every surface that threw the halftone before still throws it.
    for surface in [
        ".app-overflow-panel::before,",
        ".context-menu::before,",
        ".rename-box::before,",
        ".update-panel::before,",
        ".app-toast::before,",
        ".flow-menu::before,",
        ".link-hover-tip::before,",
        ".block-drag-ghost::before,",
        ".home-row-ghost::before,",
        ".find-bar::before,",
        ".confirm-dialog::before,",
        ".leaf-sheet::before,",
    ] {
        assert_contains(css, surface);
    }
    assert_contains(css, ".document-body .docs-pager a::before {");
}

#[test]
fn every_box_shadow_is_a_stroke_a_ring_or_a_recess() {
    // Nothing in the app casts a smooth blur: a floating surface throws the dot halftone below instead. What is left in a `box-shadow` draws an edge, a focus ring, or the one recess in the reader's tool bar.
    const DRAWN_WITH: &[&str] = &[
        "var(--lt-shadow-raised)",
        "var(--lt-shadow-inset)",
        "var(--lt-shadow-hairline)",
        "var(--lt-shadow-hairline-strong)",
        "var(--lt-shadow-focus)",
        "var(--lt-shadow-ring)",
        "var(--lt-shadow-edge-strong)",
        "var(--lt-shadow-edge-accent)",
        "var(--lt-shadow-edge-link)",
        "none",
    ];
    let css = reading_mode_css();
    for (at, _) in css.match_indices("box-shadow:") {
        let value = css[at + "box-shadow:".len()..]
            .split(';')
            .next()
            .expect("a declaration should end")
            .trim();
        assert!(
            DRAWN_WITH.contains(&value),
            "box-shadow: {value} is a hand-written or blurred shadow; the app's shadow is \
             the dot halftone, and the rest of this list is strokes"
        );
    }
}

#[test]
fn every_floating_surface_throws_the_dot_halftone() {
    let css = reading_mode_css();
    // One rule for all of them, so a new panel cannot pick a different shadow.
    for surface in [
        ".app-overflow-panel::before,",
        ".context-menu::before,",
        ".rename-box::before,",
        ".update-panel::before,",
        ".app-toast::before,",
        ".flow-menu::before,",
        ".link-hover-tip::before,",
        ".block-drag-ghost::before,",
        ".find-bar::before,",
        ".leaf-sheet::before,",
    ] {
        assert_contains(css, surface);
    }
    let halftone = rule_body(css, ".app-overflow-panel::before,");
    assert_contains(
        halftone,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(halftone, "--lt-grain-dot: var(--lt-grain-dot-strong);");
    // The second mask layer punches the surface's own box out, or the dots land on its face: a negative-layer child paints above its parent's background. Subtract, not xor -- xor is the punch inside out, and a stale one would win by coming last.
    assert_contains(halftone, "mask-composite: subtract;");
    assert_contains(halftone, "-webkit-mask-composite: source-out;");
    assert!(
        !halftone.contains("mask-composite: exclude;")
            && !halftone.contains("-webkit-mask-composite: xor;"),
        "xor/exclude is the punch inside out"
    );
    assert_contains(halftone, "z-index: var(--lt-z-below);");
}

#[test]
fn the_sheet_scrim_dims_and_dots_the_page_behind_it() {
    let scrim = rule_body(reading_mode_css(), ".lt-backdrop {");
    assert_contains(scrim, "background-color: var(--lt-tint-backdrop);");
    assert_contains(
        scrim,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(scrim, "background-attachment: fixed;");
}

#[test]
fn a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot() {
    let css = reading_mode_css();

    // One rule for the whole file, because 85 of the 95 hover rules were written one at a time with nothing on them to fade with. Zero specificity is the point: anything with a transition of its own keeps it rather than fighting this.
    let shared = rule_body(
        css,
        ":where(a, button, summary, .library-crumb, .home-row-name, .code-sticky-row, .flow-ring, .github-mention) {",
    );
    for property in ["background-color", "border-color", "color"] {
        assert_contains(
            shared,
            &format!("{property} var(--lt-duration-120) var(--lt-ease)"),
        );
    }
    // One duration and one curve in both directions — a hover has no direction to say — so the transition is declared once and never paired with an in and an out.
    assert!(
        !shared.contains("--lt-ease-decelerate") && !shared.contains("--lt-ease-accelerate"),
        "a hover is not an arrival, so it takes the plain curve both ways: {shared}"
    );
    // No shadow here: it would put one on every button in the app to time the single chip that lights one.
    assert!(
        !shared.contains("box-shadow"),
        "the shared rule carries the three properties a hover changes and no more: {shared}"
    );

    // A `transition` shorthand at any weight replaces a zero-specificity one outright, so every control that reveals itself by opacity names its own colors — and the reveal's own rule names them too, since that is the only state the control can be pointed at in.
    for (selector, property) in [
        (".tab-close {", "background-color"),
        (".tab-close {", "border-color"),
        (".tab-favorite {", "background-color"),
        (
            ".tab:hover .tab-favorite,\n.tab:focus-within .tab-favorite,\n.tab.is-pointed .tab-favorite {",
            "color",
        ),
        (".crumb-menu-edit {", "background-color"),
        (
            ".crumb-menu-row:hover .crumb-menu-edit,\n.crumb-menu-row:focus-within .crumb-menu-edit {",
            "color",
        ),
        // Switching a view setting on lights a fill, an ink and a hairline together; two of the three fading would be a seam.
        (".reader-subtool {", "box-shadow"),
        // A diagram box's + handle shows with the box it belongs to, so its fill is named beside that reveal.
        (".flow-bud {", "background-color"),
    ] {
        assert_contains(
            rule_body(css, selector),
            &format!("{property} var(--lt-duration-120) var(--lt-ease)"),
        );
    }

    // The three families that once wrote a four-property shorthand to time a lift take the shared fade again, so the lift cannot come back through a timing line nobody reads as one.
    for selector in [
        ".theme-button,
.open-button,
.new-button,
.export-button {",
        ".library-file,
.library-nav-folder {",
        ".document-body a.leaf-md-button {",
    ] {
        let body = rule_body(css, selector);
        assert!(
            !body.contains("transition"),
            "{selector} answers from the shared fade, so it writes no clock of its own: {body}"
        );
    }

    // The pager card was the one control taken out by name, back when its hover swapped a dot lattice and the custom property painting it and neither interpolated. A flat fill does, so it is back on the shared fade and writes no clock of its own.
    let pager = rule_body(css, ".document-body .docs-pager a {");
    assert!(
        !pager.contains("transition"),
        "the pager fades off the shared rule now that it fills flat: {pager}"
    );

    // Its halftone is the exception, and it says so by name: the shared rule covers three colors and this is an opacity, so without its own clock the ring would snap in under a fill that was still fading.
    assert_contains(
        rule_body(
            css,
            ".document-body .docs-pager a::before {
  z-index: 0;",
        ),
        "transition: opacity var(--lt-duration-120) var(--lt-ease);",
    );

    // A plain link is the opposite: its ink fades off the shared rule, and the underline it also gains is not a color and still switches.
    let link_hover = rule_body(css, ".document-body a:hover {");
    assert_contains(link_hover, "color: var(--lt-link-hover);");
    assert_contains(link_hover, "text-decoration: underline;");
    assert!(
        !link_hover.contains("transition"),
        "a link has no transition of its own to lose the shared one to: {link_hover}"
    );
}

#[test]
fn the_confirmation_throws_the_shared_dot_shadow_rather_than_a_blur_of_its_own() {
    // Nothing in this app casts a smooth shadow: every floating surface is a name in one dot-lattice rule, and none of the shadow tokens is a cast shadow. A new surface growing its own `box-shadow` beside that rule is the drift this pins.
    let css = reading_mode_css();
    let shared = css
        .find(".app-overflow-panel::before,")
        .expect("the shared dot-shadow rule");
    let selectors = &css[shared..shared + css[shared..].find('{').expect("the rule opens")];
    assert_contains(selectors, ".confirm-dialog::before,");

    let dialog = rule_body(css, ".confirm-dialog {");
    assert!(
        !dialog.contains("box-shadow"),
        "the confirmation takes the shared lattice, not a shadow of its own"
    );
    // On the layer already named for a sheet over the sheets' own scrim, so it needs no new token.
    assert_contains(dialog, "z-index: var(--lt-z-41);");
}

#[test]
fn every_grained_surface_still_tiles_from_one_lattice_inside_the_app() {
    // The grain is anchored rather than tiled from each box, so two surfaces meeting share one lattice and the seam between them cannot show. `contain: paint` moves what "anchored" means for everything inside it — from the window to the app surface — which costs nothing while every anchored surface is inside that box, and puts one lattice out of phase with all the others the moment one is not. Four boxes tile from themselves on purpose and are named here, so a fifth is a decision somebody made rather than a drift.
    const OWN_BOX: [&str; 4] = [
        ".tab",
        ".table-lane::before",
        ".table-lane::after",
        ".home-list-scroll li.is-dropzone",
    ];
    let css = reading_mode_css();
    let lattice = "background-image: radial-gradient(circle, var(--lt-grain-dot)";
    let mut anchored = 0;
    for (at, _) in css.match_indices(lattice) {
        let opens = css[..at].rfind('}').map_or(0, |brace| brace + 1);
        let shuts = at + css[at..].find('}').expect("the rule closes");
        let rule = &css[opens..shuts];
        let selector = strip_css_comments(rule);
        let selector = selector.split('{').next().unwrap_or_default().trim();
        if !rule.contains("background-attachment: fixed;") {
            assert!(
                OWN_BOX.contains(&selector),
                "a new grained surface tiles from its own box rather than the shared lattice: {selector}"
            );
            continue;
        }
        anchored += 1;
        // The shadow band is the one grained surface outside the app, so it is the one anchored to the window: it falls on the strip of page the app is held off the window by, never meets a surface inside the app, and so has nothing to show a seam against.
        if selector == "body::before" {
            continue;
        }
        // Everything else is inside the contained box, and grain anchored to the window there would be the one lattice anchored somewhere else.
        for window in ["html", "body", ":root"] {
            assert!(
                !selector.split(',').any(|one| one.trim() == window),
                "{selector} anchors its grain to the window rather than to the app, so it falls out of phase with every surface inside the app"
            );
        }
    }
    assert!(
        anchored >= 10,
        "the stylesheet should still anchor the dot lattice on the app's surfaces ({anchored} found)"
    );
}

#[test]
fn the_window_throws_the_dot_halftone_rather_than_a_smooth_halo() {
    // The outermost edge in the app follows the same rule as every floating surface inside it: the dot lattice, never the operating system's smooth blur onto whatever is behind the window.
    let css = reading_mode_css();
    let band = rule_body(&css, "body::before {");
    // The lattice every other surface throws, in shadow ink.
    assert_contains(band, "--lt-grain-dot: var(--lt-grain-dot-strong);");
    assert_contains(
        band,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(band, "background-size: 2px 2px;");
    // Four edge gradients, intersected: nothing at the window's edge, full where the app starts, and each corner the product of two. Not the shared panel recipe's ellipse — on a box the size of a window its falloff is measured in hundreds of pixels and the band lands in the tail, where there is nothing left to draw.
    assert_eq!(band.matches("linear-gradient(to ").count(), 8);
    assert_contains(band, "mask-composite: intersect;");
    assert_contains(
        band,
        "-webkit-mask-composite: source-in, source-in, source-in;",
    );
    assert!(
        !band.contains("ellipse"),
        "the band borrowed the panel recipe's ellipse, which has nothing left to draw at this size"
    );
    // No punch layer: this is a sibling of the app surface rather than a child, so the opaque surface paints over the middle on its own.
    assert!(
        !band.contains("mask-composite: subtract;"),
        "the band punches a box out of itself, which is a child's problem and not a sibling's"
    );

    // One spread, said once, and the same one every panel inside the app throws. One class for both platforms: a Mac carries `frameless` as well as `mac-frame`.
    let frame = rule_body(&css, "body.frameless {");
    assert_contains(frame, "--app-shadow-top: 13px;");
    assert_contains(frame, "--app-shadow-side: 20px;");
    assert_contains(frame, "--app-shadow-bottom: 10px;");

    // Nothing behind a maximized Windows window or a full-screen window on either platform to cast onto, and a band there would show the desktop through a frame inside the screen edge.
    let maxed = rule_body(
        &css,
        "body.frameless:not(.mac-frame).is-maximized,\nbody.frameless.is-fullscreen {",
    );
    let page_rule = rule_body(&css, "body:has(.app-surface) {");
    for zero in [
        "--app-shadow-top: 0px;",
        "--app-shadow-side: 0px;",
        "--app-shadow-bottom: 0px;",
    ] {
        assert_contains(maxed, zero);
        // And the same three on `body` itself, which is what a page carrying neither frame class gets: a browser has no window to cast a shadow off.
        assert_contains(page_rule, zero);
    }
    // Drawn nowhere rather than masked to nothing, in all three cases.
    assert_contains(
        &css,
        "body:not(.frameless)::before,\nbody.frameless:not(.mac-frame).is-maximized::before,\nbody.frameless.is-fullscreen::before {\n  content: none;\n}",
    );
    // A Mac carries `frameless` too, and it reports maximized for a zoomed window — one that still floats over what is behind it and still casts a shadow. So every rule that takes the band away for a screen-filling window has to say `:not(.mac-frame)`.
    for flush in ["::before", " .app-surface"] {
        assert!(
            !css.contains(&format!("body.frameless.is-maximized{flush}"))
                && !css.contains(&format!("body.is-maximized{flush}")),
            "a zoomed Mac window loses its band, where there is still something behind it to cast onto"
        );
    }

    // Whatever the platform stops drawing, the app starts: the page color, the edge and the corner are all the surface's now, and `<body>` paints nothing over the whole window.
    let surface = rule_body(&css, ".app-surface {");
    assert_contains(surface, "background: var(--lt-background);");
    assert_contains(
        surface,
        "border: var(--lt-stroke-1) solid var(--lt-border);",
    );
    assert_contains(surface, "border-radius: var(--lt-radius-lg);");
    assert_contains(
        surface,
        "inset: var(--app-shadow-top) var(--app-shadow-side) var(--app-shadow-bottom);",
    );
    assert_contains(page_rule, "background: transparent;");
    assert!(
        !rule_body(&css, "html,\nbody {").contains("background:"),
        "the window is painted a page color again, which is the app drawing its own halo out to the frame"
    );
    // Maximized and in a browser the app is the whole window, so it draws neither edge nor corner — both would be a frame inside the screen edge.
    let flush = rule_body(
        &css,
        "body:not(.frameless) .app-surface,\nbody.frameless:not(.mac-frame).is-maximized .app-surface,",
    );
    assert_contains(flush, "border: 0;");
    assert_contains(flush, "border-radius: 0;");
}

#[test]
fn the_focus_ring_is_the_keyboards_and_the_mouse_takes_it_off_every_control() {
    // The engine judges who earns a ring, and it judges a clicked dropdown wrong, so the app answers it: the page marks the root while the mouse is driving and one rule reads that mark. It has to subtract rather than enable — guarding the ring rule instead would raise it above the twelve rules that put their own ring out, lighting up the find bar and every right-click menu row, and a page that never runs the app's script would lose every ring it has, which is both websites.
    let css = reading_mode_css();

    // Whatever kinds the ring rule names, the mouse rule names the same ones. Read off each other rather than written out twice, so a sixth kind added to one is refused until it is in both.
    let kinds = |list: &str| -> Vec<String> {
        let mut names: Vec<String> = list
            .split(',')
            .filter_map(|one| one.trim().strip_suffix(":focus-visible"))
            .map(|one| one.trim().to_string())
            .collect();
        names.sort();
        names
    };

    let ring_at = css
        .find("button:focus-visible,")
        .expect("the stylesheet should draw one ring for every control");
    let ring_selector =
        &css[ring_at..ring_at + css[ring_at..].find('{').expect("the ring rule opens")];
    let ring = rule_body(&css, "button:focus-visible,");
    assert_contains(
        ring,
        "outline: var(--lt-stroke-3) solid var(--lt-focus-ring);",
    );
    assert_contains(ring, "outline-offset: var(--lt-space-2);");
    assert!(
        !ring_selector.contains("data-pointer-driving"),
        "the ring rule is guarded rather than left alone, which lifts it over every rule that puts its own ring out"
    );

    let mouse_at = css
        .find(":root[data-pointer-driving=\"true\"] :is(")
        .expect("no rule puts the ring out while the mouse is driving");
    let mouse_selector =
        &css[mouse_at..mouse_at + css[mouse_at..].find('{').expect("the mouse rule opens")];
    assert!(
        mouse_at > ring_at,
        "the mouse rule stands above the ring it exists to put out"
    );
    assert_contains(
        rule_body(&css, ":root[data-pointer-driving=\"true\"] :is("),
        "outline: none;",
    );

    let inside = mouse_selector
        .split_once(":is(")
        .and_then(|(_, rest)| rest.split_once(')'))
        .map(|(list, _)| list)
        .expect("the mouse rule names its kinds in one :is()");
    let named: Vec<String> = inside
        .split(',')
        .map(|one| one.trim().to_string())
        .collect();
    let mut named_sorted = named.clone();
    named_sorted.sort();
    assert_eq!(
        kinds(ring_selector),
        named_sorted,
        "the mouse rule and the ring rule name different controls, so one of them is drawn on something the other never touches"
    );
}

#[test]
fn nothing_lifts_or_changes_shape_when_a_pointer_lands_on_it() {
    // The lift shipped twice and was refused twice. This reads the whole stylesheet rather than three named rules, so flattening one row can never be what makes it pass: no hover anywhere casts the raised shadow, and a library row keeps the corner it rests at.
    let css = reading_mode_css();

    for (at, _) in css.match_indices(":hover") {
        let rule = &css[at..css[at..].find('}').map_or(css.len(), |end| at + end)];
        assert!(
            !rule.contains("--lt-shadow-raised"),
            "a control that rises off the surface under the pointer: {rule}"
        );
    }

    // The row answers with color on the corner it already had; a shape that changes under the pointer is the pill the owner refused.
    let row = rule_body(
        css,
        ".library-file:hover,
.library-nav-folder:hover {",
    );
    assert!(
        !row.contains("border-radius"),
        "a row that changes shape under the pointer: {row}"
    );

    // Nothing hands a lift out, so nothing takes one back: a rule refusing a shadow no rule offers sends the next reader looking for the one that offers it.
    for selector in [
        ".library-file.is-selected,
.library-file.is-selected:hover {",
        ".library-nav-folder.library-nav-up {",
        ".document-body a.leaf-md-button.link-goes-nowhere {",
    ] {
        let body = rule_body(css, selector);
        assert!(
            !body.contains("box-shadow"),
            "{selector} refuses a lift nothing hands out: {body}"
        );
    }
}
