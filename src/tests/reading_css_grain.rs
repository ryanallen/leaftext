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
    assert_contains(
        &css[odd..],
        "background-size: var(--lt-grain-tile) var(--lt-grain-tile);",
    );

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

    // No arrow sits on a native button, or it would outrank the shared rule and the hand would stop at whichever control wrote one.
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
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 var(--lt-grain-radius), transparent var(--lt-grain-edge));",
        "background-size: var(--lt-grain-tile) var(--lt-grain-tile);",
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
fn the_minimap_tiles_grained_cells_inside_its_scaled_copy() {
    let css = reading_mode_css();
    let minimap = rule_body(
        css,
        ".document-minimap-preview.document-body .document-outline,",
    );

    for selector in [
        ".document-minimap-preview.document-body .document-outline,",
        ".document-minimap-preview.document-body .tei-front,",
        ".document-minimap-preview.document-body pre,",
        ".document-minimap-preview.document-body th,",
        ".document-minimap-preview.document-body tr:nth-child(2n) td,",
        ".document-minimap-preview.document-body tr:nth-child(2n + 1) td,",
        ".document-minimap-preview.document-body td {",
    ] {
        assert_contains(css, selector);
    }
    assert_contains(minimap, "background-attachment: scroll;");
    assert!(
        minimap.starts_with(".document-minimap-preview.document-body"),
        "the minimap rule needs two class selectors to outrank the document grain rules"
    );
}

#[test]
fn the_pager_card_fills_with_the_theme_and_throws_the_halftone_instead_of_graining() {
    let css = reading_mode_css();

    // It takes the fill the chrome buttons take, never the heaviest lattice in the tree: that lattice is the app's own way of saying a thing is quiet, and across a card the width of the measure it reads as switched off. The halftone it throws is what keeps it from being a slab.
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

    // It joins the one shared list rather than copying the geometry, and then overrides the one line that is right for a panel hanging over the page and wrong for a card sitting inside it.
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

    // And nothing else: the ring is one spread wide whatever the card's size, so a wide card has nothing left to correct.
    assert!(
        !own.contains("mask-image"),
        "the ring does not scale with the box, so this card overrides no mask: {own}"
    );

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
    //
    // The app has one light, hung overhead and centered, so a second one cannot come back through a rule nobody thought to name: every value here is an inset edge or a ring drawn at the box, and not one of them offsets anything downward.
    const DRAWN_WITH: &[&str] = &[
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
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 var(--lt-grain-radius), transparent var(--lt-grain-edge));",
    );
    assert_contains(halftone, "--lt-grain-dot: var(--lt-grain-dot-strong);");
    // The fifth mask layer punches the surface's own box out, or the dots land on its face: a negative-layer child paints above its parent's background. Subtract, not xor -- xor is the punch inside out, and a stale one would win by coming last.
    assert_contains(
        halftone,
        "mask-composite: intersect, intersect, intersect, subtract;",
    );
    assert_contains(
        halftone,
        "-webkit-mask-composite: source-in, source-in, source-in, source-out;",
    );
    assert!(
        !halftone.contains("exclude;") && !halftone.contains("xor;"),
        "xor/exclude is the punch inside out"
    );
    assert_contains(halftone, "z-index: var(--lt-z-below);");
}

#[test]
fn the_halftone_is_four_ramps_over_one_spread_with_a_rounded_punch() {
    let css = reading_mode_css();
    let halftone = rule_body(css, ".app-overflow-panel::before,");

    // Four edge ramps intersected, each running from nothing at the band's outer rim to full at the surface's own edge, so every corner is the product of two: one light, overhead and centered, weighing the same on all four sides whatever the box is.
    for direction in ["to right", "to left", "to bottom", "to top"] {
        assert_contains(
            halftone,
            &format!(
                "linear-gradient({direction}, transparent 0, var(--lt-mask-opaque) var(--lt-shadow-spread))"
            ),
        );
    }
    // The layer takes the spread as padding, which makes its content box the host's own box; the punch is clipped to that box, so the browser derives the ring's inner curve from its outer one instead of cutting a rectangle through it.
    assert_contains(halftone, "padding: var(--lt-shadow-spread);");
    assert_contains(halftone, "inset: calc(-1 * var(--lt-shadow-spread));");
    for property in [
        "mask-origin",
        "mask-clip",
        "-webkit-mask-origin",
        "-webkit-mask-clip",
    ] {
        assert_contains(
            halftone,
            &format!("{property}: border-box, border-box, border-box, border-box, content-box;"),
        );
    }
    // Both radii come from the one number the host's own border reads, plus the spread, which strikes the outer arc from the inner arc's center.
    assert_contains(
        halftone,
        "border-radius: calc(var(--lt-shadow-host-radius) + var(--lt-shadow-spread));",
    );

    // The ellipse was what made the shadow's weight a function of the surface's size, so nowhere in the compiled stylesheet may one come back.
    assert!(
        !css.contains("ellipse farthest-side"),
        "an ellipse sized to the box is what gave every surface a shadow of its own weight"
    );
}

#[test]
fn every_shadow_host_declares_one_radius_and_no_shadow_of_its_own() {
    let css = reading_mode_css();

    // The roster is read off the shared rule's own selector list rather than written out beside it, so a surface joining that list later cannot arrive with no radius for its ring to be struck from -- which draws a square corner outside a rounded one.
    let list = rule_at(css, ".app-overflow-panel::before,");
    let selectors = &css[list..list + css[list..].find('{').expect("the shared rule opens")];
    let hosts: Vec<&str> = selectors
        .split(',')
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(|one| one.trim_end_matches("::before"))
        .collect();
    assert!(
        hosts.len() >= 18,
        "the shared list lost hosts, so this reads a shorter roster than the app throws: {hosts:?}"
    );

    // Each host's own rule, or rules -- the sheet and the tray each open more than one -- and the one that declares the radius has to hand it straight back to a border.
    for host in hosts {
        let mut declared = false;
        for body in rule_bodies(css, &format!("{host} {{")) {
            if !body.contains("--lt-shadow-host-radius: var(--lt-radius-") {
                continue;
            }
            assert!(
                body.contains("border-radius: var(--lt-shadow-host-radius)")
                    || body.contains("border-top-left-radius: var(--lt-shadow-host-radius);"),
                "{host} declares a radius the shadow cannot read: {body}"
            );
            declared = true;
        }
        assert!(
            declared,
            "{host} throws the one shadow and declares no radius for its outer corner"
        );
    }

    // And the sheet's own value, which is the one host not rounded like a panel.
    let sheet = rule_body(
        css,
        ".leaf-sheet {
  left: 0;",
    );
    assert_contains(sheet, "--lt-shadow-host-radius: var(--lt-radius-2xl);");
    assert_contains(
        sheet,
        "border-top-left-radius: var(--lt-shadow-host-radius);",
    );

    // The recipe does not scale with the box, so nothing is left for a small or a wide surface to correct: no private inset, no fade of its own, and no second copy of the lattice.
    for private in [
        ".reader-toolbar::before {",
        ".selection-toolbar::before {",
        ".link-hover-tip::before {",
    ] {
        assert!(
            !css.contains(private),
            "{private} is a private copy of a shadow that is now one shared rule"
        );
    }
    // The pager card keeps the one line the shared rule cannot give it -- it sits inside the document rather than over it -- and nothing else.
    let pager = rule_body(
        css,
        ".document-body .docs-pager a::before {
  z-index: 0;",
    );
    assert_contains(pager, "z-index: 0;");
    assert!(
        !pager.contains("mask-image") && !pager.contains("inset:"),
        "the pager card overrides only its layer: {pager}"
    );
}

#[test]
fn no_shadow_in_the_app_falls_from_a_second_light() {
    let css = reading_mode_css();

    // The token that carried the second light, and every rule that spent it. It was offset a pixel downward on six surfaces, so on those the light was neither overhead nor centered.
    assert!(
        !css.contains("--lt-shadow-raised"),
        "the offset blur is back, which is a second light in a second direction"
    );
    // And no rule may write one by hand either: every `box-shadow` left in the app is an inset edge or a ring struck at the box, so none of them has a direction at all.
    for (at, _) in css.match_indices("box-shadow:") {
        let value = css[at + "box-shadow:".len()..]
            .split(';')
            .next()
            .expect("a declaration should end")
            .trim();
        assert!(
            !value.starts_with("0 ") || value.starts_with("0 0 0 "),
            "box-shadow: {value} offsets or blurs, which is a light of its own"
        );
    }
}

#[test]
fn every_control_that_floats_over_the_page_throws_the_one_shadow() {
    let css = reading_mode_css();

    // The print stylesheet names every control on the page one at a time, which makes it the roster to check a floating surface against: anything hidden there that stands over the page rather than sitting in it owes the halftone.
    let hidden = rule_body(css, "body.leaf-paper :is(.docs-pager,");
    let ring = rule_body(css, ".app-overflow-panel::before,");

    // What is hidden for paper and does not float: it sits in the window's own layout, so it has nothing to cast onto.
    const IN_THE_WINDOW: &[&str] = &[
        ".app-bar",
        ".reader-corner",
        ".library-pane",
        ".library-divider",
        ".reader-graph",
        ".reader-edge-fade",
        ".reader-minimap",
        ".reader-loading",
        // The scrim is what a sheet is read against rather than a surface of its own, and the two diagram layers are the sheet's contents.
        ".lt-backdrop",
        ".flow-sheet",
        ".crumb-menu",
        ".mermaid-tools",
        ".diagram-overlay",
        ".block-gutter",
        ".block-gap-line",
    ];

    for control in hidden.lines().flat_map(|line| line.split(',')) {
        let name = control
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_start_matches("body.leaf-paper :is(")
            .trim_end_matches(')');
        if !name.starts_with('.') || IN_THE_WINDOW.contains(&name) {
            continue;
        }
        assert!(
            ring.contains(&format!("{name}::before")) || ring.contains(&format!("{name} a::before")),
            "{name} floats over the page and throws no shadow, so it is the one surface with a light of its own"
        );
    }
}

#[test]
fn the_sheet_scrim_dims_and_dots_the_page_behind_it() {
    let scrim = rule_body(reading_mode_css(), ".lt-backdrop {");
    assert_contains(scrim, "background-color: var(--lt-tint-backdrop);");
    assert_contains(
        scrim,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 var(--lt-grain-radius), transparent var(--lt-grain-edge));",
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
fn a_site_trail_places_and_reveals_the_shared_favorite_heart() {
    let css = reading_mode_css();
    let placed = rule_body(css, ".library-crumb-trail > .tab-favorite {");
    assert_contains(placed, "position: static;");
    assert_contains(placed, "flex: none;");

    let revealed = rule_body(
        css,
        ".library-crumb-trail:hover > .tab-favorite,\n.library-crumb-trail:focus-within > .tab-favorite {",
    );
    assert_contains(revealed, "opacity: 1;");
    assert_contains(
        revealed,
        "opacity var(--lt-duration-120) var(--lt-ease-decelerate)",
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

/// Every rule whose selector is written exactly `selector`, comments taken out. Exact and not a search: `.theme-sheet-browse:hover` and `.home-sheet .home-list-fade` both write a `background:` shorthand, and neither of them touches what the sheet element itself is given.
fn rules_selected_exactly(css: &str, selector: &str) -> Vec<String> {
    let css = strip_css_comments(css);
    let mut found = Vec::new();
    for (opens, _) in css.match_indices('{') {
        // Back to the nearest brace either way: that is the head of this rule, whether it sits at the top of the file or inside a media query.
        let head = css[..opens]
            .rsplit(['{', '}'])
            .next()
            .unwrap_or_default()
            .trim();
        if head != selector {
            continue;
        }
        let shuts = css[opens..].find('}').map_or(css.len(), |end| opens + end);
        found.push(css[opens + 1..shuts].to_string());
    }
    found
}

/// The class each bottom sheet is filled by, read off the shell rather than written down here — the other token on every element whose class list holds `leaf-sheet` — so a fifth sheet is held to the same rule the day somebody adds it.
fn sheet_fill_classes(html: &str) -> Vec<String> {
    let mut classes = Vec::new();
    for (at, _) in html.match_indices("class=\"") {
        let opens = at + "class=\"".len();
        let shuts = opens + html[opens..].find('"').expect("the attribute closes");
        let list: Vec<&str> = html[opens..shuts].split_whitespace().collect();
        if !list.contains(&"leaf-sheet") {
            continue;
        }
        for token in list {
            if token != "leaf-sheet" {
                classes.push(token.to_string());
            }
        }
    }
    classes
}

#[test]
fn every_bottom_sheet_keeps_the_grain_the_shared_rule_gives_it() {
    // `.leaf-sheet` draws the lattice and each sheet writes its own color underneath. A `background:` shorthand there resets every part it does not name, so the image and the attachment go back to nothing and the sheet lands as a plain card — which is what all four did. Naming `background-color` is what leaves the shared rule standing, and `.flow-picker` is in a file concatenated after this one, so declaring the grain later cannot reach it.
    let html = app_shell_page();
    let css = reading_mode_css();

    let classes = sheet_fill_classes(&html);
    for class in &classes {
        let selector = format!(".{class}");
        let rules = rules_selected_exactly(css, &selector);
        assert!(
            !rules.is_empty(),
            "{selector} fills a bottom sheet but the stylesheet has no rule of its own for it"
        );
        assert!(
            rules.iter().any(|rule| rule.contains("background-color:")),
            "{selector} fills a bottom sheet without naming `background-color`"
        );
        for rule in &rules {
            assert!(
                !rule.contains("background:"),
                "{selector} writes its fill as a `background:` shorthand, which resets the lattice `.leaf-sheet` gives it: {rule}"
            );
        }
    }
    // The shell carries four sheets today. Reading them off the markup is what holds a fifth; counting what the reading found is what stops a change to the markup leaving this looping over nothing and reporting green.
    assert!(
        classes.len() >= 4,
        "the shell should still fill four bottom sheets ({} read)",
        classes.len()
    );
}

#[test]
fn the_shared_sheet_rule_tiles_its_grain_from_the_sheets_own_box() {
    // A sheet always carries a transform — the translate holding it below the window at rest, the one seating it when open — and a transform re-anchors a fixed background to the element itself. So an anchor written here is a promise the engine cannot keep, and the rule would claim a phase with the app bar that it has never had.
    let css = reading_mode_css();
    let rules = rules_selected_exactly(css, ".leaf-sheet");

    let grain = rules
        .iter()
        .find(|rule| rule.contains("background-image: radial-gradient(circle, var(--lt-grain-dot)"))
        .expect("the shared sheet rule still draws the lattice");
    assert!(
        !grain.contains("background-attachment:"),
        "`.leaf-sheet` anchors its grain again, which its own transform makes inert: {grain}"
    );
}

/// The `background-attachment` a rule declares, as written — one value or a list. Read off the rule with its comments taken out: every comment about the lattice in this stylesheet names the declaration in prose, and the prose has no semicolon to stop at.
fn declared_attachment(rule: &str) -> Option<String> {
    let rule = strip_css_comments(rule);
    let at = rule.find("background-attachment:")? + "background-attachment:".len();
    let end = rule[at..].find(';')? + at;
    Some(rule[at..end].trim().to_string())
}

/// Whether the dot layer of this rule is anchored to the app rather than tiled from the box. The dot gradient is always the first `background-image` layer, so the answer is the first entry of the attachment that applies — read off this rule, or off a rule naming the same selectors, which is where the table's edge bands keep theirs while the layer list lives one rule down.
fn dot_layer_is_anchored(css: &str, rule: &str, selector: &str) -> bool {
    let mut list = declared_attachment(rule);
    if list.is_none() {
        for (at, _) in css.match_indices("background-attachment:") {
            let opens = css[..at].rfind('}').map_or(0, |brace| brace + 1);
            let shuts = at + css[at..].find('}').expect("the rule closes");
            let other = &css[opens..shuts];
            let head = strip_css_comments(other);
            let head = head
                .split('{')
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            // Every selector the dot layer's rule names has to be one this rule names too, or the attachment it declares is somebody else's.
            let covers = selector
                .split(',')
                .all(|one| head.split(',').any(|other| other.trim() == one.trim()));
            if covers {
                list = declared_attachment(other);
            }
        }
    }
    list.as_deref()
        .and_then(|written| written.split(',').next())
        .is_some_and(|first| first.trim() == "fixed")
}

#[test]
fn every_grained_surface_still_tiles_from_one_lattice_inside_the_app() {
    // The grain is anchored rather than tiled from each box, so two surfaces meeting share one lattice and the seam between them cannot show. What that anchor resolves to is not `contain: paint`'s to decide: putting that containment back under the paper class, or `contain: layout`, or taking the anchoring away with `background-attachment: scroll`, each wrote a byte-identical exported picture, so containment moves neither the lattice nor what a render paints. Four boxes tile from themselves on purpose and are named here, so a fifth is a decision somebody made rather than a drift.
    const OWN_BOX: [&str; 4] = [
        ".tab",
        ".home-list-scroll li.is-dropzone",
        // The tools ride down out of the tray's nub on a transform, and the tray itself is centered by another, so a fixed attachment here is a lattice the web view cannot hold. The well floats over the tray's own ungrained face and meets no other grain, so it has no seam to show.
        ".reader-view-tools",
        // A sheet always carries a transform — the translate that holds it below the window at rest, the one that seats it when open — and a transform re-anchors a fixed background to the element itself, so the anchor could only ever have been a promise. It slides up over the page as its own surface, which is what a lattice tiled from its own box reads as.
        ".leaf-sheet",
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
        if !dot_layer_is_anchored(css, rule, selector) {
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
    assert_contains(
        rule_body(
            css,
            ".document-minimap-preview.document-body .document-outline,",
        ),
        "background-attachment: scroll;",
    );
}

#[test]
fn the_paper_class_composites_the_app_box_so_an_exported_picture_carries_the_grain() {
    // Every surface the test above anchors is painted as nothing by the render behind an exported picture and an exported PDF, unless the box holding it composites — so a table header, a tinted row, a code block and the outline all reached both files as one flat wash. The paper class is where the fix belongs: the class is on for the render and off everywhere else, so nothing in the window changes.
    let css = reading_mode_css();
    let surface = rule_body(css, "body.leaf-paper .app-surface {");
    assert_contains(surface, "will-change: transform;");

    // `will-change` alone reads as a hint somebody could drop, so the four properties measured against it in a running copy are named beside it: each wrote a byte-identical picture, and this one is what put the dots back. Without that sentence a reader reaches for `contain` and measures the same four properties over again.
    for measured in [
        "contain: layout",
        "contain: paint",
        "transform: translateZ(0)",
        "background-attachment: scroll",
    ] {
        assert_contains(surface, measured);
    }
}

#[test]
fn the_table_lane_centers_without_a_transform_so_its_cells_keep_the_page_lattice() {
    // Every cell of a wide table wears the app's lattice, and a transform anywhere above it makes the web view tile those dots from a box inside the transform — so a table scrolled sideways dragged the dots in its header along with the columns while the page behind them stayed put. CSS cannot read the used width of a `max-content` box and a box wider than its parent has its auto margins treated as zero, so the lane keeps its own box and gains a bay whose width is a length the arithmetic can name. Watched in a launched copy: with the bay the wide lane and the narrow one both landed on the pixels the transform gave them, and the header cells fell on the same lattice columns as a code block outside the lane.
    let css = reading_mode_css();

    let bay = rule_body(&css, ".document-body > .table-bay {");
    assert_contains(
        bay,
        "width: max(100%, calc(100cqi - 2 * var(--reader-lane-inset)));",
    );
    assert_contains(
        bay,
        "margin-inline: calc((100% - max(100%, 100cqi - 2 * var(--reader-lane-inset))) / 2);",
    );
    assert!(
        !bay.contains("transform"),
        "the bay is the box the arithmetic names, so it may never carry a transform: {bay}"
    );

    let lane = rule_body(&css, ".table-bay > .table-lane {");
    assert_contains(lane, "margin-inline: auto;");
    assert_contains(lane, "width: max-content;");
    assert_contains(lane, "max-width: 100%;");
    for slid in ["transform", "left:"] {
        assert!(
            !lane.contains(slid),
            "the lane centers inside its bay, so nothing here may slide or transform it: {lane}"
        );
    }
    // A carded table needs no room past the writing, so the bay stands down to the measure rather than the lane growing to the bay.
    let carded = rule_body(&css, ".document-body > .table-bay:has(table.is-cards) {");
    assert_contains(carded, "width: 100%;");
    assert_contains(carded, "margin-inline: 0;");
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
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 var(--lt-grain-radius), transparent var(--lt-grain-edge));",
    );
    assert_contains(
        band,
        "background-size: var(--lt-grain-tile) var(--lt-grain-tile);",
    );
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

    // One spread, said once and on all four sides, and the same one every panel inside the app throws — which is what a light hung overhead and centered gives. Three distances were three lights. One class for both platforms: a Mac carries `frameless` as well as `mac-frame`.
    let frame = rule_body(&css, "body.frameless {");
    assert_contains(frame, "--app-shadow-spread: var(--lt-shadow-spread);");
    assert!(
        !css.contains("--app-shadow-top")
            && !css.contains("--app-shadow-side")
            && !css.contains("--app-shadow-bottom"),
        "the band still names a side of its own, which is a second light"
    );
    // And the band spends that one distance four times, once per edge.
    assert_eq!(
        band.matches("var(--lt-mask-opaque) var(--app-shadow-spread))")
            .count(),
        8,
        "each of the four ramps, prefixed and not, runs over the one spread"
    );

    // Nothing behind a maximized Windows window or a full-screen window on either platform to cast onto, and a band there would show the desktop through a frame inside the screen edge.
    let maxed = rule_body(
        &css,
        "body.frameless:not(.mac-frame).is-maximized,\nbody.frameless.is-fullscreen {",
    );
    let page_rule = rule_body(&css, "body:has(.app-surface) {");
    assert_contains(maxed, "--app-shadow-spread: 0px;");
    // And the same on `body` itself, which is what a page carrying neither frame class gets: a browser has no window to cast a shadow off.
    assert_contains(page_rule, "--app-shadow-spread: 0px;");
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
    // The corner is read from a variable rather than written here, so the four states that change it all set one number. Windows' own figure for a top-level app window is the default it starts from.
    assert_contains(surface, "--app-window-radius: var(--lt-radius-lg);");
    assert_contains(surface, "border-radius: var(--app-window-radius);");
    assert_contains(surface, "inset: var(--app-shadow-spread);");
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
    // Taken by setting the variable the surface reads, not by writing a corner here: a `border-radius` in this block would put the window's number in four places again.
    assert_contains(flush, "--app-window-radius: 0px;");
    assert!(
        !flush.contains("border-radius:"),
        "the flush state writes a corner of its own, so the window's number is decided in two places"
    );
}

#[test]
fn a_mac_window_takes_the_macs_corner_and_a_windows_one_keeps_windows() {
    // macOS rounds a window far harder than Windows does, and on a Mac the app draws the only corner there is: the window is transparent and the app is held 20px inside it, so the system's own mask falls on a strip nothing paints.
    let css = reading_mode_css();
    let mac = rule_body(css, "body.mac-frame .app-surface {");
    assert_contains(mac, "--app-window-radius: var(--lt-radius-window);");
    // Windows and a browser are the default the surface itself declares, untouched by this rule.
    let surface = rule_body(css, ".app-surface {");
    assert_contains(surface, "--app-window-radius: var(--lt-radius-lg);");
    assert!(
        !mac.contains("--lt-radius-lg"),
        "the Mac rule names the Windows corner, so one platform's number moves the other's"
    );

    // A browser ties this rule on specificity, so order is what decides between them: a page with no window still draws no corner.
    let flush_at = css
        .find("body:not(.frameless) .app-surface,")
        .expect("the flush rule should be in the sheet");
    let mac_at = css
        .find("body.mac-frame .app-surface {")
        .expect("the Mac rule should be in the sheet");
    assert!(
        mac_at < flush_at,
        "the Mac rule sits after the flush rule it ties, so a browser page draws a Mac's corner"
    );

    // A Mac's maximize is a zoom that still floats over what is behind it, so it keeps its corner — which is the whole reason that selector says `:not(.mac-frame)`.
    assert!(
        !css.contains("body.frameless.is-maximized .app-surface")
            && !css.contains("body.is-maximized .app-surface"),
        "a zoomed Mac window is flattened to a square corner, where it is still a floating window"
    );
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
            !rule.contains("box-shadow: 0 "),
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

/// The `background:` declaration of the rule a selector opens that sets a fill. The alternating-row selector opens two rules — the fill and the grain lattice over it — and only one of them carries the shorthand.
fn alternating_row_fill(css: &str, selector: &str) -> String {
    rule_bodies(css, selector)
        .into_iter()
        .find_map(|body| {
            body.lines()
                .map(str::trim)
                .find(|line| line.starts_with("background:"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| panic!("expected a fill for {selector}"))
}

#[test]
fn the_alternating_row_is_filled_from_one_name_on_the_page_and_in_the_sheet() {
    // The table in the document and the table opened on the whole window are the same stripe to a reader, so they draw from one name. Written twice they are free to drift, and a stripe that is right in one place and gone in the other reads as the app losing the row rather than as two rules.
    let css = reading_mode_css();

    let page = alternating_row_fill(&css, ".document-body tr:nth-child(2n) td {");
    let sheet = alternating_row_fill(&css, ".table-sheet-grid tr:nth-child(2n) td {");

    assert_eq!(
        page, "background: var(--lt-markdown-table-row-background);",
        "the page's alternating row takes the themed fill"
    );
    assert_eq!(
        page, sheet,
        "the page's table and the sheet's grid fill the alternating row from one name"
    );
}

#[test]
fn the_alternating_rows_fill_is_a_name_a_family_answers_rather_than_one_color() {
    // One gray for eleven families in two appearances bands a dark page at 0.2 lightness against a light one at 6.6, because the gray lightens the row the grain darkens. The fill has to be a name each family resolves against its own page, and a color written here is that fault coming back.
    let css = reading_mode_css();

    for selector in [
        ".document-body tr:nth-child(2n) td {",
        ".table-sheet-grid tr:nth-child(2n) td {",
    ] {
        let fill = alternating_row_fill(&css, selector);
        assert!(
            fill.starts_with("background: var(--lt-") && fill.ends_with(");"),
            "expected {selector} to fill from a token, found {fill}"
        );
    }
}

#[test]
fn the_lattices_geometry_is_said_once_rather_than_written_into_every_rule() {
    // Twenty-four rules across thirteen files drew the same circle at the same size with the numbers typed into each one, so a display that cannot hold a 0.6px dot could only ever be answered twenty-four times over. The three lengths are declared once in the metrics block; a rule that writes one by hand sits outside the resolution branch and keeps drawing flat at 100%.
    let css = strip_css_comments(&reading_mode_css());

    for declared in [
        "--lt-grain-radius: 0.6px;",
        "--lt-grain-edge: 0.7px;",
        "--lt-grain-tile: 2px;",
    ] {
        assert_eq!(
            css.matches(declared).count(),
            1,
            "the lattice's geometry is declared exactly once, in the metrics block: {declared}"
        );
    }

    let head = "radial-gradient(circle, var(--lt-grain-dot)";
    let whole = "radial-gradient(circle, var(--lt-grain-dot) 0 var(--lt-grain-radius), transparent var(--lt-grain-edge))";
    let mut drawn = 0;
    for (at, _) in css.match_indices(head) {
        assert!(
            css[at..].starts_with(whole),
            "a lattice rule writes the dot by hand, so the resolution branch cannot reach it: {}",
            &css[at..(at + whole.len()).min(css.len())]
        );
        drawn += 1;
    }
    assert!(
        drawn >= 22,
        "the stylesheet should still draw the lattice on every grained surface ({drawn} found)"
    );

    let tile = "background-size: var(--lt-grain-tile) var(--lt-grain-tile)";
    assert!(
        css.matches(tile).count() >= 21,
        "every lattice rule tiles from --lt-grain-tile"
    );
    assert!(
        !css.contains("background-size: 2px 2px"),
        "a lattice rule writes the tile by hand"
    );
}

#[test]
fn a_display_at_one_hundred_percent_gets_a_lattice_it_can_draw() {
    // At 1dppx the 2px tile is two device pixels and all four of them sit 0.7071px from the dot's center, outside its 0.7px edge, so the shipped lattice paints nothing at all and every grained surface reads as a flat wash. The branch hands that display the same numbers multiplied by 1.5, which draws the device-pixel pattern a 150% display draws today; nothing above 1dppx sees a changed pixel.
    let css = strip_css_comments(&reading_mode_css());
    let at = css
        .find("@media (resolution <= 1dppx)")
        .expect("a display at 100% needs a lattice big enough to hold a dot");
    let branch = &css[at..at + css[at..].find("\n}").expect("the branch closes")];

    for declared in [
        "--lt-grain-radius: 0.9px;",
        "--lt-grain-edge: 1.05px;",
        "--lt-grain-tile: 3px;",
    ] {
        assert_contains(branch, declared);
    }
    assert!(
        branch.contains(":root {"),
        "the branch has to reach every grained surface, so it sets the properties on the root"
    );
}
