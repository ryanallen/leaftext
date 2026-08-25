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
        ".history-button:hover:not(:disabled)",
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
fn the_hand_is_left_to_links_alone() {
    // The arrow is what a desktop control shows; the hand says "this goes somewhere else". A plain link takes the hand from the browser with no rule at all, so every rule that writes one has to sit on something drawn as a link — otherwise the next control brings it back and the hand marks nothing again.
    let css = reading_mode_css();

    // The last compound of the selector names an anchor: `a`, `a[href]`, `a:not(...)`.
    let names_an_anchor = |selector: &str| {
        selector.split_whitespace().last().is_some_and(|last| {
            last.strip_prefix('a').is_some_and(|rest| {
                !rest.starts_with(|c: char| c.is_alphanumeric() || c == '-' || c == '_')
            })
        })
    };

    let mut cut = 0usize;
    while let Some(found) = css[cut..].find("cursor: pointer") {
        let at = cut + found;
        cut = at + 1;
        // The selector this declaration sits under: back past the rule's own brace, then back to the end of whatever came before it.
        let open = css[..at].rfind('{').expect("the rule opens");
        let start = css[..open].rfind(['}', '/']).map_or(0, |i| i + 1);
        let selector = css[start..open].trim();
        // A button can be drawn as a plain link, and then the hand is right on it. What says so is the link color, in the same rule that writes the hand — asked rather than listed, so the next one is held without anybody remembering.
        let close = css[at..].find('}').map_or(css.len(), |i| at + i);
        let painted_as_a_link = css[open..close].contains("color: var(--lt-link)");
        assert!(
            names_an_anchor(selector) || painted_as_a_link,
            "only something drawn as a link may write the hand, and `{selector}` is not"
        );
    }

    // And no fragment may hand one out from the script either: the map draws its nodes on a canvas, where a cursor is a property on the shape rather than a rule.
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
fn the_pager_button_grains_under_the_pointer_and_keeps_its_label_unmarked() {
    let css = reading_mode_css();

    // The fill is the page's own lattice in the one ink a hover has, on the same window-anchored grid every grained surface uses — a box-anchored one falls out of phase with the code block above it at the button's edge.
    let hover = rule_body(
        css,
        ".document-body .docs-pager a:hover,\n.document-body .docs-pager a:focus-visible {",
    );
    for expected in [
        "--lt-grain-dot: var(--lt-grain-hover);",
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
        "text-decoration: none;",
    ] {
        assert_contains(hover, expected);
    }

    // The ink is black at an alpha like every other grain, so the button sinks on a light family and a dark one alike rather than lifting on one of them.
    assert_contains(css, "--lt-grain-hover: rgba(0, 0, 0, 0.55);");

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

    // And nothing may set a background after it: at equal weight a later `background:` shorthand blanks the image.
    let at = css
        .find(".document-body .docs-pager a:hover,")
        .expect("the pager hover rule");
    assert!(
        !css[at..].contains(".docs-pager a {"),
        "a later pager fill would blank the lattice"
    );
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
        ".leaf-sheet::before {",
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
        (".tab:hover .tab-favorite,\n.tab:focus-within .tab-favorite {", "color"),
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

    // The one control taken out by name: its hover swaps a dot lattice and the custom property painting it, and neither interpolates, so a fade would drift the border and the ink around a lattice that had already snapped.
    assert_contains(
        rule_body(css, ".document-body .docs-pager a {"),
        "transition: none;",
    );
    let pager_hover = rule_body(
        css,
        ".document-body .docs-pager a:hover,\n.document-body .docs-pager a:focus-visible {",
    );
    assert_contains(pager_hover, "--lt-grain-dot: var(--lt-grain-hover);");
    assert_contains(pager_hover, "background-image: radial-gradient(");

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
fn every_chrome_surface_under_the_fine_grain_carries_the_notebook_grid_moved_by_transform() {
    // The chrome surfaces the wide grid is drawn on: the bar, the shell's gutter, the pane, its two pinned bands and the two corner patches where the bar's divider turns down into the card. One layer each, clipped by its own box — never one layer spanning the window, which painted dots into the window's own shadow band and could not be clipped back to the chrome without taking the bar and the rail with it, because the reading column runs the full height behind the bar.
    const CHROME: [&str; 6] = [
        ".app-bar::before",
        ".library-shell::before",
        ".library-pane::before",
        ".reader-corner::before",
        ".library-crumbs::before",
        ".library-header::before",
    ];
    let css = reading_mode_css();
    let grid = rule_body(&css, ".app-bar::before,");
    let selectors = grid.split('{').next().unwrap_or_default();
    for surface in CHROME {
        assert!(
            selectors.split(',').any(|one| one.trim() == surface),
            "{surface} carries the fine lattice, so it owes the wide one on a layer of its own"
        );
    }

    // Moved by transform, off the one offset the page writes while the window is moving. Shifting the same lattice by its background position instead took a real drag from 144 frames a second to 7 — five window-wide layers that cannot be cached and are re-rastered every frame — where a composited layer translated held 8 milliseconds at its worst.
    assert_contains(
        grid,
        "transform: translate3d(var(--lt-grid-offset-x), var(--lt-grid-offset-y), 0);",
    );
    // Its own box's start into the lattice, so the six read as one grid and no seam opens where two meet. This is the only thing the background position ever says.
    assert_contains(
        grid,
        "background-position: var(--lt-grid-phase-x) var(--lt-grid-phase-y);",
    );
    // Grown by one pitch up and to the left, which is as far as the whole set ever slides. What it spills onto is another chrome surface at the same phase, and `contain: paint` on the app surface stops any of it reaching the window's edge.
    assert_contains(
        grid,
        "inset: calc(-1 * var(--lt-grid-pitch)) 0 0 calc(-1 * var(--lt-grid-pitch));",
    );

    // Lift on dark, darken on light — the second grain in the app to turn this corner, because black has 5 to 8 channels of room on the darkest family and white has 21.
    assert_contains(grid, "var(--app-bar-grid)");
    assert_contains(
        rule_body(&css, ":root[data-theme=\"dark\"] {"),
        "--app-bar-grid: var(--lt-grid-dark);",
    );
}

#[test]
fn the_notebook_grid_stops_at_the_chrome_and_reaches_no_reading_surface_or_shadow() {
    // Nothing but the chrome gains a layer. The page is opaque over the middle and would hide one anyway; the window's own shadow band is a sibling of the app surface rather than a child, so a ruling drawn there would be a ruling inside a shadow.
    const NOT_CHROME: [&str; 6] = [
        ".reader-shell",
        "body::before",
        ".document-body",
        ".table-lane::before",
        ".table-lane::after",
        ".tab",
    ];
    let css = reading_mode_css();
    let grid = rule_body(&css, ".app-bar::before,");
    let selectors = grid.split('{').next().unwrap_or_default();
    for surface in NOT_CHROME {
        assert!(
            !selectors
                .split(',')
                .any(|one| one.trim().starts_with(surface)),
            "{surface} is not chrome, so the notebook grid must not reach it"
        );
    }

    // One rule draws the wide lattice and no other, so a second copy cannot open somewhere the first was kept out of.
    let drawn = css.matches("var(--app-bar-grid)").count();
    assert_eq!(
        drawn, 1,
        "the wide grid's ink is written into one rule, and {drawn} rules name it"
    );

    // And nothing anywhere moves a grid layer the slow way.
    assert!(
        !css.contains("background-position: var(--lt-grid-offset-x)"),
        "a grid layer moved by its background position is the shape that took a drag to 7 frames a second"
    );
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

    // Nothing behind a maximized window to cast onto, and a band there would show the desktop through a frame inside the screen edge.
    let maxed = rule_body(
        &css,
        "body.frameless:not(.mac-frame).is-maximized,\nbody.mac-frame.is-fullscreen {",
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
        "body:not(.frameless)::before,\nbody.frameless:not(.mac-frame).is-maximized::before,\nbody.mac-frame.is-fullscreen::before {\n  content: none;\n}",
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
