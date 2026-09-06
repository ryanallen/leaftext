//! Reduce motion, the curves, folding, the bottom sheet and the bars that paint while they move.

use super::*;

#[test]
fn reduce_motion_is_answered_once_and_won_back_by_name() {
    let css = reading_mode_css();

    // One blanket rule instead of a block per component, which is how fifteen of the eighteen moving transitions came to answer this setting nowhere.
    let blanket = rule_body(
        css,
        "@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before,\n  *::after {",
    );
    // `!important` or nothing: `*` has no specificity, so every class rule in the file outranks it and the block would change nothing on screen.
    assert_contains(
        blanket,
        "transition-duration: var(--lt-duration-0) !important;",
    );
    assert_contains(
        blanket,
        "animation-duration: var(--lt-duration-0) !important;",
    );
    // Never the shorthand — it sets `animation-name: none`, and the glossary sheet's waiting panel and the table's edge bands both reach their resting state through an animation rather than despite one.
    assert!(
        !blanket.contains("animation:") && !blanket.contains("transition:"),
        "the blanket rule must cut durations, not whole animations: {blanket}"
    );
    // And never the iteration count: pinned to 1, every spinner turns once and stops, which reads as a hang.
    assert!(
        !blanket.contains("animation-iteration-count"),
        "pinning the iteration count stops every spinner after one turn: {blanket}"
    );

    // What must keep moving wins it back on specificity, both being important. One rule for every .lt-spinner: six elements carry the class and three had no answer of their own.
    for won_back in [
        ".lt-spinner {\n    animation-duration: var(--lt-duration-1600) !important;",
        ".update-alert-dot.is-downloading {\n    animation-duration: var(--lt-duration-1600) !important;",
        ".library-sync.is-busy .lt-icon {\n    animation-duration: var(--lt-duration-2400) !important;",
    ] {
        assert_contains(css, won_back);
    }
    assert_contains(
        rule_body(
            css,
            "  .document-body pre.mermaid:not([data-processed=\"true\"]):not([data-diagram-wait=\"far\"])::after {\n    animation-duration:",
        ),
        "animation-duration: var(--lt-duration-1600) !important;",
    );

    // The edge bands run on the table's own sideways scroll, not a clock. A zero duration lands a scroll-driven animation on its last keyframe and holds it there — `opacity: 0` for the ahead band — so the cut edge would go unmarked on exactly the tables that need it. `auto` hands progress back to the scroll.
    assert_contains(
        css,
        ".table-lane::before,\n  .table-lane::after {\n    animation-duration: auto !important;\n  }",
    );

    // Every skeleton keeps its own block, on the shared class: the blanket rule carries no opacity and the bars have none, so bars stopped at full strength read as loaded content.
    let skeleton = rule_body(css, "  .lt-skeleton {");
    assert_contains(skeleton, "animation: none;");
    assert_contains(skeleton, "opacity: var(--lt-opacity-55);");
    // The pulse is the shared recipe's, spent from tokens, so a second waiting shape cannot grow a duration or an opacity of its own.
    assert_contains(
        css,
        "  animation: lt-skeleton-pulse var(--lt-duration-1250) var(--lt-ease-in-out) infinite;",
    );
    // Both stops named together, because `rule_body` stops at the first brace and a keyframe block has one per stop.
    assert_contains(
        css,
        "@keyframes lt-skeleton-pulse {
  0%,
  100% {
    opacity: var(--lt-opacity-38);
  }
  50% {
    opacity: var(--lt-opacity-78);
  }
}",
    );
    // The pager spends the shared recipe, so it carries no pulse of its own to drift from it.
    assert!(
        !css.contains("pager-skeleton-pulse"),
        "the pager takes the shared pulse, so its private one should be gone"
    );

    // The blocks the blanket rule replaced are gone rather than left to say the same thing twice.
    for gone in [
        ".library-shell.library-narrow .library-pane {\n    transition: none;",
        ".library-sync.is-leaving {\n    transition: none;",
        ".app-toast {\n    transition: none;",
        ".reader-loading-spinner {\n    animation-duration:",
        ".document-minimap-spinner {\n    animation-duration:",
        ".glossary-sheet-spinner {\n    animation-duration:",
    ] {
        assert!(
            !css.contains(gone),
            "the blanket rule covers this now, so it should be gone: {gone}"
        );
    }
}

#[test]
fn the_whole_window_fades_both_ways_when_another_app_takes_it() {
    let css = reading_mode_css();

    // The fade is written on the element, not inside the state that turns it on: a transition living in the state's own rule animates the way out and snaps the way back, because the rule stops matching the instant the class goes — and the way back is the half a reader is looking at, since it lands with the click that brought the window forward.
    let surface = rule_body(css, ".app-surface {");
    assert_contains(
        surface,
        "transition: filter var(--lt-duration-200) var(--lt-ease);",
    );

    let inactive = rule_body(
        css,
        "body.is-window-inactive:not(.leaf-paper):not(.leaf-paper-diagram):not(.leaf-paper-picture) .app-surface {",
    );
    assert!(
        !inactive.contains("transition"),
        "the fade is timed inside the state, so the window snaps back to full color the moment it returns: {inactive}"
    );

    // An ordinary rule and never a block of its own under a media query, which is the whole reason the Reduce Motion blanket at the foot of the file covers it by existing.
    assert!(
        !css.contains("@media (prefers-reduced-motion: reduce)")
            || !css[css
                .find("@media (prefers-reduced-motion: reduce)")
                .expect("the blanket rule is in the file")..]
                .contains("transition: filter"),
        "the inactive fade wins itself back from Reduce Motion, and a whole window moving is exactly what that setting is for"
    );
}

#[test]
fn anything_that_folds_slides_to_its_new_height_from_one_shared_rule() {
    let css = reading_mode_css();

    // The whole answer sits behind the one property that lets a height nobody set be animated at all. An engine without it gets no rule rather than half of one, so the block simply opens.
    assert_contains(css, "@supports (interpolate-size: allow-keywords) {");
    assert_contains(
        css,
        "  .folds,\n  .document-body details {\n    interpolate-size: allow-keywords;\n  }",
    );

    // Half one: the mark an ordinary box wears, so a folding box written later slides by wearing it rather than by somebody remembering.
    let marked = rule_body(css, "  .folds {");
    // Clipping rather than hiding: `overflow: hidden` is a scroll container, and a sticky code header inside a folded block would then stick to the block instead of to the page.
    assert_contains(marked, "overflow: clip;");
    assert_contains(marked, "height: auto;");
    // A flex item will not go below its own contents unless it is told it may, and without this the find bar's Replace row stays at full height for the whole travel — exactly the jump this replaces.
    assert_contains(marked, "min-height: 0;");
    // Opening from nothing needs a starting height to travel from, and `display` has to be carried discretely or the box is not there to be animated.
    assert_contains(
        css,
        "@starting-style {\n    .folds {\n      height: 0;\n    }\n  }",
    );
    let marked_shut = rule_body(css, "  .folds[hidden] {");
    assert_contains(marked_shut, "display: none;");
    assert_contains(marked_shut, "height: 0;");

    // Half two: a `details` in a document — the front matter, the outline, and whatever an author folded for themselves — covered without wearing anything.
    let folded = rule_body(css, "  .document-body details::details-content {");
    assert_contains(folded, "overflow: clip;");
    assert_contains(folded, "block-size: 0;");
    assert_contains(
        rule_body(css, "  .document-body details[open]::details-content {"),
        "block-size: auto;",
    );
    // Scoped to the document body because the update menu is a `details` too. Its panel hangs over the page, so nothing under it moves and it has nothing to travel with.
    assert!(
        !css.contains("\ndetails::details-content")
            && !css.contains("\ndetails[open]::details-content"),
        "a rule on the bare tag would reach the update menu and every other popover"
    );

    // Arriving one way, leaving the other and shorter, the way the rest of the file reads a direction.
    for open in [
        "height var(--lt-duration-260) var(--lt-ease-decelerate)",
        "block-size var(--lt-duration-260) var(--lt-ease-decelerate)",
    ] {
        assert_contains(css, open);
    }
    for shut in [
        "height var(--lt-duration-220) var(--lt-ease-accelerate)",
        "block-size var(--lt-duration-220) var(--lt-ease-accelerate)",
    ] {
        assert_contains(css, shut);
    }
    // Never the spring, however much a fold wants one: it runs a tenth of the whole travel past its mark, and a fold's travel is however tall its contents are — 533px past on a long front matter, 133px on a forty-entry outline. The sheet's rubber band refused the same curve over a full-height rise for the same reason.
    let folding = &css[rule_at(css, "@supports (interpolate-size: allow-keywords) {")..];
    let folding = &folding[..folding
        .find("\n/*")
        .expect("the folding rule should be followed by another")];
    assert!(
        !folding.contains("--lt-ease-overshoot"),
        "a fold's travel is unbounded, so a curve that springs a tenth of it lurches: {folding}"
    );

    // Nothing new for Reduce Motion: the blanket at the top of the file zeroes both durations, and a zero-length discrete transition flips at once.
    assert!(
        !folding.contains("prefers-reduced-motion"),
        "the blanket rule covers this by existing: {folding}"
    );
}

#[test]
fn a_curve_says_which_way_a_move_is_going() {
    let css = reading_mode_css();

    // Material Design 3's three, at its values: arriving, leaving, and staying put while it changes shape or place.
    for curve in [
        "--lt-ease-emphasized: cubic-bezier(0.2, 0, 0, 1);",
        "--lt-ease-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);",
        "--lt-ease-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);",
        // Arriving with spring: runs about a tenth past its mark and settles back.
        "--lt-ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);",
        // Motion off is a duration like any other, so the reduce rule reads a token.
        "--lt-duration-0: 0ms;",
    ] {
        assert_contains(css, curve);
    }
    // The drag-tuned curve stays on the sheet's rise; only its dismiss changes.
    assert_contains(css, "--lt-ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);");
}

#[test]
fn every_move_is_drawn_on_the_curve_its_direction_asks_for() {
    let css = reading_mode_css();

    // A direction per curve means the transition is declared twice: the base rule is where a thing rests and where it goes back to, so it carries the exit, and the state class carries the way in. One transition serving both directions cannot honor the rule.
    for (selector, expected) in [
        (
            ".lt-backdrop {",
            "transition: opacity var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".lt-backdrop.open {",
            "transition: opacity var(--lt-duration-200) var(--lt-ease-decelerate);",
        ),
        (
            ".leaf-sheet {\n  left: 0;",
            "transition: transform var(--lt-duration-200) var(--lt-ease-accelerate);",
        ),
        // The rise keeps the curve tuned against a real drag, which is the gesture it has to feel continuous with.
        (
            ".leaf-sheet.open {",
            "transition: transform var(--lt-duration-260) var(--lt-ease-sheet);",
        ),
        // Each direction is one animation, so its two curves are written on the keyframes each interval starts at and are pinned with them. What is left here is the drag's exit, which is one direction the whole way.
        (
            ".leaf-sheet.is-boosting {",
            "animation: sheet-boost var(--lt-duration-160) var(--lt-ease-accelerate) both;",
        ),
        (
            ".app-toast {",
            "transition: opacity var(--lt-duration-120) var(--lt-ease-accelerate), transform var(--lt-duration-120) var(--lt-ease-accelerate);",
        ),
        (
            ".app-toast.is-shown {",
            "transition: opacity var(--lt-duration-200) var(--lt-ease-decelerate), transform var(--lt-duration-200) var(--lt-ease-decelerate);",
        ),
        (
            ".library-shell.library-narrow .library-pane {",
            "transition: transform var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".library-shell.library-narrow.library-overlay .library-pane {",
            "transition: transform var(--lt-duration-220) var(--lt-ease-decelerate);",
        ),
        (
            ".flow-sheet {",
            "transition: transform var(--lt-duration-160) var(--lt-ease-accelerate), opacity var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".flow-sheet.open {",
            "transition: transform var(--lt-duration-220) var(--lt-ease-sheet), opacity var(--lt-duration-220) var(--lt-ease-decelerate);",
        ),
        // Neither arriving nor leaving: the strip rearranges around a tab, a caret turns in place, and a block steps aside without leaving the page.
        (
            ".tab {",
            "transition: max-width var(--lt-duration-120) var(--lt-ease-emphasized), transform var(--lt-duration-120) var(--lt-ease-emphasized), margin var(--lt-duration-120) var(--lt-ease-emphasized);",
        ),
        (
            "body.is-block-dragging .document-body [data-src-start] {",
            "transition: transform var(--lt-duration-140) var(--lt-ease-emphasized);",
        ),
        (
            ".document-body .document-outline-summary::before {",
            "transition: transform var(--lt-duration-150) var(--lt-ease-emphasized);",
        ),
    ] {
        assert_contains(rule_body(css, selector), expected);
    }

    // The sheet's drag exemption ties with `.open` on specificity, so it wins only by coming after it — the drag has to track the pointer exactly.
    let open = rule_at(css, ".leaf-sheet.open {");
    let dragging = rule_at(css, ".leaf-sheet.is-dragging {");
    assert!(
        open < dragging,
        "the drag exemption must follow .open to win the tie"
    );

    // A hover that only changes a color has no direction, so it keeps the symmetric curve. Anything that started saying `ease-emphasized` here would be claiming a hover arrives. A control drawn at nothing until the pointer reaches it is the other kind and does have one, so it is held to the two shared recipes by the reveal test at the foot of this file instead.
    for hover in [
        ".block-gutter .block-insert-option {",
        ".document-body pre > .code-copy {",
    ] {
        assert_contains(rule_body(css, hover), "var(--lt-ease)");
    }
}

#[test]
fn a_bottom_sheet_lands_with_a_rubber_band_and_leaves_with_a_boost() {
    let css = reading_mode_css();

    // The skirt. Riding past the seat lifts the sheet's bottom edge off the window, which would show what is behind it — so the sheet is that much taller than it looks and rests with the extra below the edge. Both halves or neither: the offset alone hangs the content off the window, the padding alone leaves the gap.
    let base = rule_body(css, ".leaf-sheet {\n  left: 0;");
    assert_contains(base, "--sheet-raise:");
    assert_contains(base, "bottom: calc(var(--sheet-raise) * -1);");
    assert_contains(base, "padding-bottom: var(--sheet-raise);");
    // The two sheets that write a `padding` shorthand of their own would drop that padding, so they carry the skirt themselves.
    for skirted in [".home-sheet {", ".theme-sheet {"] {
        assert_contains(
            rule_body(css, skirted),
            "calc(var(--lt-space-24) + var(--sheet-raise));",
        );
    }

    // A whole `@keyframes` or `@media` block: `rule_body` stops at the first closing brace, which inside a nested block is the end of its first keyframe.
    fn block<'a>(css: &'a str, opener: &str) -> &'a str {
        let start = css
            .find(opener)
            .unwrap_or_else(|| panic!("the stylesheet should define {opener}"));
        let mut depth = 0usize;
        for (at, ch) in css[start..].char_indices() {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    return &css[start..start + at + 1];
                }
            }
        }
        panic!("{opener} never closes");
    }

    // Each direction is one animation, so where the sheet is on every frame of it is written down here rather than being however long a class spent waiting on another class's end event. The landing's three marks: below the window, past the seat at the rise's share of the whole, then down onto it — and the settle takes the emphasized curve for the same reason the pull-up does, a 10px move by something already on screen.
    let land = block(css, "@keyframes sheet-land {");
    for (mark, expected) in [
        ("  0% {", "transform: translateY(100%);"),
        ("  0% {", "animation-timing-function: var(--lt-ease-sheet);"),
        (
            "  65% {",
            "transform: translateY(calc(var(--sheet-raise) * -1));",
        ),
        (
            "  65% {",
            "animation-timing-function: var(--lt-ease-emphasized);",
        ),
        ("  100% {", "transform: translateY(var(--sheet-drag, 0px));"),
    ] {
        assert_contains(rule_body(land, mark), expected);
    }
    assert_contains(
        rule_body(css, ".leaf-sheet.open.is-landing {"),
        "animation: sheet-land var(--lt-duration-400) both;",
    );

    // The leave's three: the seat, the raised mark at the pull-up's share of the whole, and gone.
    let leave = block(css, "@keyframes sheet-leave {");
    for (mark, expected) in [
        ("  0% {", "transform: translateY(var(--sheet-drag, 0px));"),
        (
            "  0% {",
            // A 10px move by something already on screen. The arriving curve spends half that in the first frame, which is the jitter itself.
            "animation-timing-function: var(--lt-ease-emphasized);",
        ),
        (
            "  43% {",
            "transform: translateY(calc(var(--sheet-drag, 0px) - var(--sheet-raise)));",
        ),
        (
            "  43% {",
            "animation-timing-function: var(--lt-ease-accelerate);",
        ),
        ("  100% {", "transform: translateY(100%);"),
    ] {
        assert_contains(rule_body(leave, mark), expected);
    }
    // A drag dismissal is the departure alone, from wherever the hand let the sheet go.
    let boost = block(css, "@keyframes sheet-boost {");
    assert_contains(
        rule_body(boost, "  from {"),
        "transform: translateY(var(--sheet-drag, 0px));",
    );
    assert_contains(rule_body(boost, "  to {"), "transform: translateY(100%);");
    assert_contains(
        rule_body(css, ".leaf-sheet.is-leaving {"),
        "animation: sheet-leave var(--lt-duration-280) both;",
    );
    // The scrim waits out the pull-up so the two leave together, rather than the window brightening under a sheet still on screen.
    assert_contains(
        rule_body(css, ".lt-backdrop.is-held {"),
        "transition-delay: var(--lt-duration-120);",
    );

    // A wide window centers the sheet with the `translate` property, which the browser composes ahead of whatever `transform` is drawing. One rule, so no state and no keyframe repeats it — written as half of a transform it had to be said on all six moving states, and a keyframe could not have said it at all.
    let wide = block(css, "@media (min-width: 760px) {\n  .leaf-sheet {");
    assert_contains(rule_body(wide, "  .leaf-sheet {"), "translate: -50%;");
    assert!(
        !wide.contains("transform"),
        "the wide window must not repeat a transform: the centering composes with the one the animations draw"
    );

    // The drag exemption ties with the boost on specificity, so it still has to come last of all the moving states — a held pointer tracks directly or it does not track at all.
    let dragging = rule_at(css, ".leaf-sheet.is-dragging {");
    for moving in [
        ".leaf-sheet.open.is-landing {",
        ".leaf-sheet.is-leaving {",
        ".leaf-sheet.is-boosting {",
    ] {
        assert!(
            rule_at(css, moving) < dragging,
            "{moving} must come before the drag exemption"
        );
    }
}

#[test]
fn the_normal_width_library_toggle_rides_the_motion_rail() {
    let css = reading_mode_css();

    // The pane's grid track, the bar's lead and the reader divider's left end all read --library-rail-width, so one var write moves the three of them — and the toggle's body classes carry the transitions: opening springs past its mark on the overshoot curve, closing slams on the accelerate one, and the settle class carries the close's bounce-out and settle-shut legs.
    for (selector, expected) in [
        (
            "body.is-library-opening .library-shell {",
            "transition: grid-template-columns var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .library-shell {",
            "transition: grid-template-columns var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .library-shell {",
            "transition: grid-template-columns var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
        (
            "body.is-library-opening .app-bar-lead {",
            "transition: width var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .app-bar-lead {",
            "transition: width var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .app-bar-lead {",
            "transition: width var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
        (
            "body.is-library-opening .app-bar::after {",
            "transition: left var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .app-bar::after {",
            "transition: left var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .app-bar::after {",
            "transition: left var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
    ] {
        assert_contains(rule_body(css, selector), expected);
    }

    // The wide grid spends the rail width itself, so the transition above has one property to interpolate; the closed state is the same rule with the var at 0px, not a second track list.
    assert_contains(
        rule_body(css, ".library-shell {"),
        "grid-template-columns: var(--library-rail-width, 240px) minmax(0, 1fr) var(--reader-minimap-column) var(--reader-gutter);",
    );
    assert!(!css.contains(".library-shell.library-closed {\n  grid-template-columns:"));

    // Never the rail: registering it as an inherited length and transitioning it off :root crashed the whole app in this web view — library-sidebar-motion's phase 0 measured it, twice. What killed it was a track relaying the window out on every frame, so the ban is on this property rather than on registration itself; the scrollbar's two are registered and drive paint only, measured in the same window (scrollbar-fade-and-hover, phase 0).
    assert!(!css.contains("@property --library-rail-width"));

    // The reader divider's left end spends the bare rail value — the same number the grid track spends — so its left transition and the grid's interpolate the same span on the same curve and the line stays attached to the pane's corner arc on every frame. A gutter floor here changed the span and detached them near zero, right where the close's bounce lives.
    assert_contains(
        rule_body(css, ".app-bar::after {"),
        "left: calc(var(--library-rail-width, 0px) + var(--lt-radius-md) - 1px);",
    );
    // The closed resting place is its own rule, landing in the same layout pass as the pane's closed corner rule, so the line and the arc jump to rest together.
    assert_contains(
        rule_body(css, ".app-bar:not(.has-rail)::after {"),
        "left: calc(var(--reader-gutter) + var(--lt-radius-md) - 1px);",
    );
    assert!(!css.contains(".app-bar.has-rail::after {"));

    // The pane's list clips sideways: rows truncate themselves, so a horizontal scrollbar on a narrow pane is noise — and it popped in and out while the pane animates.
    let scroll = rule_body(css, ".library-scroll {");
    assert_contains(scroll, "overflow-y: auto;");
    assert_contains(scroll, "overflow-x: hidden;");

    // The pane's contents fade with the travel — out over the close, and back in at the same pace on the open, where an animation is needed because the bands were display:none while closed.
    let fade_out = rule_body(css, "body.is-library-closing .library-header,");
    assert_contains(fade_out, "opacity: 0;");
    assert_contains(
        fade_out,
        "transition: opacity var(--lt-duration-260) var(--lt-ease);",
    );
    assert_contains(fade_out, "body.is-library-settling .library-scroll {");
    let fade_in = rule_body(css, "body.is-library-opening .library-header,");
    assert_contains(
        fade_in,
        "animation: leaf-library-open-arrive var(--lt-duration-260) var(--lt-ease);",
    );
    assert_contains(fade_in, "body.is-library-opening .library-scroll {");
    // The pane owns that keyframe outright, so a name only the reader defines would animate nothing.
    assert_contains(css, "@keyframes leaf-library-open-arrive {");
    assert!(!css.contains("leaf-document-arrive"));

    // A grid item's min-width is its content, which would hold the shrinking track open; the pane itself still never clips, because the corner arc on its right edge is real geometry.
    assert_contains(rule_body(css, ".library-pane {"), "min-width: 0;");

    // No component Reduce Motion block: the file's blanket rule zeroes these transitions like every other, so each motion rule appears exactly once.
    assert_eq!(
        css.matches("body.is-library-opening .library-shell {")
            .count(),
        1
    );
    assert_eq!(
        css.matches("body.is-library-closing .library-shell {")
            .count(),
        1
    );
}

#[test]
fn a_home_lists_bar_and_edges_answer_the_scroll_not_the_pointer() {
    // Asked for by name: the bar is there while the list is moving and gone a moment after it stops. Never on hover — pointing at a list on the way somewhere else is not asking to be told how long it is.
    let css = reading_mode_css();
    let box_ = rule_body(&css, ".home-list-scroll {");
    // The bar's width is held whether or not there is one, so a list too short to need it keeps the same inset as the one beside it.
    assert_contains(box_, "scrollbar-gutter: stable;");
    assert!(
        !box_.contains("scrollbar-width:") && !box_.contains("scrollbar-color:"),
        "either of those silently kills every rule painting this box's bar"
    );
    assert!(
        !css.contains(".home-list-scroll:hover") && !css.contains(".home-list-scroll:focus-within"),
        "the bar is back on the pointer"
    );
    // The list has no bar of its own: it wears .leaf-scroll, so the shared one paints it, on the same class and the same timer as the pane, the reader and a wide table.
    assert!(
        !css.contains("--home-list-thumb") && !css.contains(".home-list-box.is-scrolling"),
        "the start screen keeps a private answer to the same question"
    );

    // The soft edge is the reader's own ramp to the surface the start screen paints. It takes no pointer events, and it stops short of the right edge — a wash laid over the bar would bury the thumb, which starts at that same edge.
    let fade = rule_body(&css, ".home-list-fade {");
    assert_contains(fade, "pointer-events: none;");
    assert_contains(fade, "inset: 0 var(--reader-scrollbar) 0 0;");
    // Neither edge until there is list past it: a soft top on a list sitting at its first row says something is above it that is not.
    assert_contains(fade, "--home-list-fade-top: 0px;");
    assert_contains(fade, "--home-list-fade-bottom: 0px;");
    assert_contains(
        fade,
        "background-size: 100% var(--home-list-fade-top), 100% var(--home-list-fade-bottom);",
    );
    assert_contains(fade, "background-position: 0 0, 0 100%;");
    assert_contains(
        rule_body(&css, ".home-list-box.has-above .home-list-fade {"),
        "--home-list-fade-top: var(--reader-edge-fade-depth);",
    );
    assert_contains(
        rule_body(&css, ".home-list-box.has-below .home-list-fade {"),
        "--home-list-fade-bottom: var(--reader-edge-fade-depth);",
    );
}

#[test]
fn every_bar_in_the_app_is_painted_only_while_its_box_is_moving() {
    // Five wearers, one answer: the library pane, a document with no picture down its side, a widened table's sideways bar, any box marked .leaf-scroll — the shape picker, the theme cards, a glossary entry and the flowchart's two panes among them — and the boxes a document brings, which have nowhere to carry a class.
    let css = reading_mode_css();
    const WEARERS: [&str; 5] = [
        ".leaf-scroll",
        ".library-scroll",
        ".reader-shell:not(.has-minimap)",
        ".table-lane > table",
        ".document-body :is(pre, pre > code, .math-display, .frontmatter, table)",
    ];
    // The block is ten rules and every wearer is in all of them, named here by the first selector of each. Six paint the bar; the four in the middle sit on the box and are the only place the thumb's color and inset come from, so a wearer in the pseudo rules alone reserves a 14px gutter and never draws anything in it — `--lt-scroll-thumb` is registered with an initial value of `transparent`, which looks exactly like the work not having been done.
    const RULES: [&str; 10] = [
        ".leaf-scroll::-webkit-scrollbar,",
        ".leaf-scroll::-webkit-scrollbar-track,",
        ".leaf-scroll,",
        ".leaf-scroll.is-scrolling,",
        ".leaf-scroll.is-pointing,",
        ".app-surface.is-scrollbars-always .leaf-scroll,",
        ".leaf-scroll::-webkit-scrollbar-thumb,",
        ".leaf-scroll::-webkit-scrollbar-thumb:vertical,",
        ".leaf-scroll::-webkit-scrollbar-thumb:horizontal,",
        ".leaf-scroll::-webkit-scrollbar-corner,",
    ];
    for rule in RULES {
        let block = rule_body(&css, rule);
        for wearer in WEARERS {
            assert!(
                block.contains(wearer),
                "{wearer} is missing from the rule opening `{}`, so it wears part of the bar and not the rest",
                rule.trim_start()
            );
        }
    }

    // At rest the thumb is painted in nothing at all. A scrollbar pseudo has no box of its own to fade, so what moves is a property the thumb rule reads — which is also why the bar's width is reserved either way and nothing on the page reflows when one appears.
    let resting = rule_body(&css, ".leaf-scroll,\n.library-scroll,");
    assert_contains(resting, "--lt-scroll-thumb: transparent;");
    let moving = rule_body(&css, ".leaf-scroll.is-scrolling,");
    assert_contains(moving, "--lt-scroll-thumb: color-mix(");
    let pointed = rule_body(&css, ".leaf-scroll.is-pointing,");
    assert_contains(pointed, "--lt-scroll-thumb: color-mix(");
    for wearer in WEARERS {
        assert_contains(resting, wearer);
        assert!(
            css.contains(&format!("\n{wearer}.is-scrolling,"))
                || css.contains(&format!("\n{wearer}.is-scrolling {{")),
            "{wearer} never gets the class the watcher stamps, so its bar can never come up"
        );
        // The second reason the bar is up: the pointer in that box's own gutter.
        assert!(
            css.contains(&format!("\n{wearer}.is-pointing,"))
                || css.contains(&format!("\n{wearer}.is-pointing {{")),
            "{wearer} never gets the class the pointer stamps, so aiming at its bar does nothing"
        );
        // Never the pointer. Asked for twice: a bar on hover is still a bar nobody asked for.
        assert!(
            !css.contains(&format!("{wearer}:hover::-webkit-scrollbar"))
                && !css.contains(&format!("{wearer}:focus-within::-webkit-scrollbar")),
            "{wearer} brings its bar back on the pointer"
        );
    }

    // Either standard scrollbar property silently kills every ::-webkit-scrollbar rule on the element it sits on. Only the four boxes meaning to draw no bar at all set one: the tab strip, the reader while the picture down its side is up, the picture's own column, and an exported page while the same picture stands down its own.
    assert!(
        !css.contains("scrollbar-color:"),
        "scrollbar-color kills every rule painting the bar it is set on"
    );
    assert_eq!(
        css.matches("scrollbar-width:").count(),
        4,
        "a fifth box took a standard scrollbar property, so its bar can never be painted at all"
    );
    assert_contains(rule_body(&css, ".tab-bar {"), "scrollbar-width: none;");
    assert_contains(
        rule_body(&css, ".reader-shell.has-minimap {"),
        "scrollbar-width: none;",
    );
    // The third is the picture's own column, which is a scroller because that is how a wheel over the picture moves the page. A bar there would say what the picture beside it already says.
    assert_contains(
        rule_body(&css, ".reader-minimap {"),
        "scrollbar-width: none;",
    );
    // The fourth is that same decision on the one page that is not the app: an exported page has no reader pane, so the box the browser scrolls is the body itself and the rail down its edge is what replaces its bar. Asked of the rail rather than written flat, so a page whose script never arrived keeps the bar it still needs.
    assert_contains(
        rule_body(&css, "  body.leaf-web:has(.document-minimap) {"),
        "scrollbar-width: none;",
    );

    let thumb = rule_body(&css, ".leaf-scroll::-webkit-scrollbar-thumb,");
    assert_contains(thumb, "background-color: var(--lt-scroll-thumb);");
    // A transition here is the bug this fixes, not the fix: measured in the app's own web view, nothing written on a scrollbar part animates, so the bar blinked for as long as the fade lived on this rule.
    assert!(
        !thumb.contains("transition"),
        "the fade is back on the bar, where this engine will not run it"
    );

    // The thumb is inset by a property too, so the thickening rides the same fade rather than being a second mechanism painting the same bar.
    assert_contains(
        thumb,
        "border: var(--lt-scroll-thumb-inset) solid transparent;",
    );

    // Registered or they cannot be animated at all — an unregistered custom property has no type to interpolate. Inherited, because the thumb pseudo has no declarations of its own and reads the box's value; `inherits: false` would leave every bar painting the initial value.
    assert_contains(
        &css,
        "@property --lt-scroll-thumb {\n  syntax: \"<color>\";\n  inherits: true;\n  initial-value: transparent;\n}",
    );
    assert_contains(
        &css,
        "@property --lt-scroll-thumb-inset {\n  syntax: \"<length>\";\n  inherits: true;\n  initial-value: 0px;\n}",
    );

    // A direction per curve is declared twice: the exit in the resting rule, the enter on the state class. Both on the box, which is the whole of the fix.
    assert_contains(
        resting,
        "transition: --lt-scroll-thumb var(--lt-duration-160) var(--lt-ease-accelerate), --lt-scroll-thumb-inset var(--lt-duration-160) var(--lt-ease-accelerate);",
    );
    assert_contains(
        moving,
        "transition: --lt-scroll-thumb var(--lt-duration-200) var(--lt-ease-decelerate), --lt-scroll-thumb-inset var(--lt-duration-160) var(--lt-ease-accelerate);",
    );
    assert_contains(
        pointed,
        "transition: --lt-scroll-thumb var(--lt-duration-200) var(--lt-ease-decelerate), --lt-scroll-thumb-inset var(--lt-duration-200) var(--lt-ease-decelerate);",
    );

    // The thickening is the pointer's alone: a bar that swells every time the page moves draws attention to itself while somebody is reading. So only the pointing rule shortens the inset, and it does it inside the gutter that is reserved either way.
    assert_contains(resting, "--lt-scroll-thumb-inset: var(--lt-stroke-4);");
    assert_contains(pointed, "--lt-scroll-thumb-inset: var(--lt-stroke-2);");
    assert!(
        !moving.contains("--lt-scroll-thumb-inset:"),
        "the bar swells on every scroll, not just under the pointer"
    );
    // The pointing rule comes last, so a box that is both scrolling and pointed at keeps the thicker thumb.
    assert!(
        rule_at(&css, ".leaf-scroll.is-pointing,") > rule_at(&css, ".leaf-scroll.is-scrolling,"),
        "a box that is scrolling as well as pointed at loses the thickening it was aimed at"
    );

    // Somebody who told their operating system to always show scrollbars has the raised ink held at rest instead. The flag rides the surface, so the extra class outranks all three rules above whatever the order; it is written after them anyway, because a reader of this block should not have to count classes to know which one wins.
    const PINNED: &str = ".app-surface.is-scrollbars-always .leaf-scroll,";
    let pinned = rule_body(&css, PINNED);
    assert_contains(pinned, "--lt-scroll-thumb: color-mix(");
    assert!(
        rule_at(&css, PINNED) > rule_at(&css, ".leaf-scroll.is-pointing,"),
        "the always-on bar is written before the rules it has to beat"
    );
    // Painted, not pinned thick: the 10px grabber stays the pointer's answer, or a bar held at its widest takes room from the page for exactly the reader who asked to see it.
    assert!(
        !pinned.contains("--lt-scroll-thumb-inset:"),
        "the always-on bar sits at its widest all the time"
    );
    for wearer in WEARERS {
        assert!(
            pinned.contains(&format!(".app-surface.is-scrollbars-always {wearer}")),
            "{wearer} keeps fading while every other bar is held, so the preference reaches some of the app"
        );
    }
    // The reader with the picture down its side draws no bar at all, and this is not the rule that gives it one: two of the same control in the same place helps nobody.
    assert_eq!(
        pinned.matches(".reader-shell").count(),
        1,
        "the railed reader wears the always-on bar, so it draws the picture and a bar down the same edge"
    );

    // The pane's own fade declares a transition on the same element from a more specific rule, so it is pinned here: a later edit that drops it would take the pane's opacity ramp with it.
    assert_contains(
        rule_body(&css, "body.is-library-settling .library-scroll {"),
        "transition: opacity var(--lt-duration-260) var(--lt-ease);",
    );

    // With the fade on the box, the stylesheet's one reduced-motion block reaches it — `*` matches an element where it never matched a scrollbar part. The named block that existed only for that is dead CSS.
    assert!(
        !css.contains(
            "@media (prefers-reduced-motion: reduce) {\n  .leaf-scroll::-webkit-scrollbar-thumb,"
        ),
        "a reduced-motion block still names a scrollbar part, which the universal one now covers"
    );
}

#[test]
fn a_hover_moves_nothing_and_never_swaps_an_icons_drawing() {
    // Pointing at something answers with color and nothing else, so no hover anywhere shifts an element off where it rests — the leaf that slides and the chip drawing that rises are both refused. The swap is pinned in the same body: a mask does not interpolate, so an icon that changed drawing on hover would land in one frame beside a fill that fades.
    let css = reading_mode_css();

    for (at, _) in css.match_indices(":hover") {
        let rule = &css[at..css[at..].find('}').map_or(css.len(), |end| at + end)];
        assert!(
            !rule.contains("transform:") || rule.contains(".reader-tool-tray"),
            "a hover that moves something: pointing at a control changes its color and nothing else: {rule}"
        );
        for swap in ["-webkit-mask-image:", "mask-image:", "background-image:"] {
            if !rule.contains(swap) {
                continue;
            }
            assert!(
                !rule.contains("--lt-icon-"),
                "a hover that swaps an icon's mask lands in one frame beside a fill that fades: {rule}"
            );
        }
    }
}

/// One rule of the assembled stylesheet: its selector and its declarations.
struct CssRule<'a> {
    selector: &'a str,
    body: &'a str,
}

/// The sheet with the prose about it taken out. A rule's comment is not part of it: a comma or a full stop inside one would read as another selector or another class, and a brace inside one would close a rule that is still open.
fn without_prose(css: &str) -> String {
    let mut plain = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(at) = rest.find("/*") {
        plain.push_str(&rest[..at]);
        rest = match rest[at + 2..].find("*/") {
            Some(end) => &rest[at + 2 + end + 2..],
            None => "",
        };
    }
    plain.push_str(rest);
    plain
}

/// Every rule in the sheet, walking into `@media` and `@supports` so a reveal written inside one is read the same as a reveal outside it. Hand it `without_prose`, never the sheet itself.
fn css_rules(css: &str) -> Vec<CssRule<'_>> {
    let mut out = Vec::new();
    let bytes = css.as_bytes();
    let (mut start, mut at) = (0, 0);
    while at < bytes.len() {
        match bytes[at] {
            b'{' => {
                let selector = css[start..at].trim();
                let mut depth = 1usize;
                let mut end = at + 1;
                while end < bytes.len() && depth > 0 {
                    match bytes[end] {
                        b'{' => depth += 1,
                        b'}' => depth -= 1,
                        _ => {}
                    }
                    end += 1;
                }
                let body = &css[at + 1..end.saturating_sub(1)];
                if selector.starts_with('@') {
                    out.extend(css_rules(body));
                } else {
                    out.push(CssRule { selector, body });
                }
                at = end;
                start = end;
            }
            b'}' => {
                at += 1;
                start = at;
            }
            _ => at += 1,
        }
    }
    out
}

/// The selector with every `:not(…)` taken out, so the classes and states a rule refuses do not read as ones it wants.
fn without_refusals(selector: &str) -> String {
    let mut out = String::with_capacity(selector.len());
    let mut rest = selector;
    while let Some(at) = rest.find(":not(") {
        out.push_str(&rest[..at]);
        let mut depth = 0usize;
        let mut end = at + 4;
        for (offset, ch) in rest[at + 4..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = at + 4 + offset + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// What each comma-separated selector is actually about: the last class named in it. `.tab.is-pointed .tab-favorite` is about the heart, not the tab.
fn subjects(selector: &str) -> Vec<String> {
    without_refusals(selector)
        .split(',')
        .filter_map(|one| {
            let at = one.rfind('.')?;
            let name: String = one[at + 1..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            (!name.is_empty()).then_some(name)
        })
        .collect()
}

/// The one opacity value that means "not drawn". Anything else, a token included, is a shown state.
fn rests_at_nothing(body: &str) -> bool {
    body.contains("opacity: 0;")
}

fn reaches_for_it(selector: &str) -> bool {
    let wanted = without_refusals(selector);
    wanted.contains(":hover")
        || wanted.contains(":focus-within")
        || wanted.contains(":focus-visible")
}

#[test]
fn every_control_that_appears_under_the_pointer_leaves_the_same_way() {
    // Nine families of small control are drawn at nothing and shown when the pointer or the keyboard reaches what they belong to, and one hand crossing the window has to get one answer to the same gesture rather than one per family. Both ends of the fade are a named recipe, so a later reveal that names neither is found here rather than on screen.
    const ARRIVE: &str = "var(--lt-transition-hover-reveal-arrive)";
    const LEAVE: &str = "var(--lt-transition-hover-reveal-leave)";
    let css = reading_mode_css();
    let plain = without_prose(css);
    let rules = css_rules(&plain);

    // A subject is a hover reveal when something holds it at nothing and something else shows it under a pointer or a focus — or when the holding rule is itself written as "while nobody is reaching for this", which is how the tab's close cross is spelled.
    let shown: Vec<(&str, Vec<String>)> = rules
        .iter()
        .filter(|rule| {
            reaches_for_it(rule.selector)
                && rule.body.contains("opacity:")
                && !rests_at_nothing(rule.body)
        })
        .map(|rule| (rule.body, subjects(rule.selector)))
        .collect();
    let mut reveals: Vec<String> = Vec::new();
    for rule in &rules {
        if !rests_at_nothing(rule.body) {
            continue;
        }
        let while_unreached =
            rule.selector.contains(":not(:hover)") || rule.selector.contains(":not(:focus");
        for subject in subjects(rule.selector) {
            let met = while_unreached || shown.iter().any(|(_, theirs)| theirs.contains(&subject));
            if met && !reveals.contains(&subject) {
                reveals.push(subject);
            }
        }
    }
    // The count is the guard on the finder itself: a change that stops it seeing a family would otherwise pass by having nothing left to check. Eleven controls in the nine families — the diagram's two tool groups are one family, and so are the table's corner and the picture's.
    assert!(
        reveals.len() >= 11,
        "the controls this holds have gone from eleven to {}: {reveals:?}",
        reveals.len()
    );

    for rule in &rules {
        let mine = subjects(rule.selector);
        if !mine.iter().any(|subject| reveals.contains(subject)) {
            continue;
        }
        if rests_at_nothing(rule.body) {
            assert!(
                rule.body.contains(LEAVE),
                "a control held at nothing leaves on its own timing instead of the shared one: {} {{{}}}",
                rule.selector,
                rule.body
            );
        }
        if reaches_for_it(rule.selector) && rule.body.contains("opacity:") {
            assert!(
                rule.body.contains(ARRIVE),
                "a control shown under the pointer arrives on its own timing instead of the shared one: {} {{{}}}",
                rule.selector,
                rule.body
            );
        }
    }

    // The close cross is the one family whose arrival is written on its resting rule rather than on a hover, so the two checks above never read it. Every family owes an arrival somewhere.
    for subject in &reveals {
        assert!(
            rules.iter().any(|rule| {
                subjects(rule.selector).contains(subject) && rule.body.contains(ARRIVE)
            }),
            "{subject} is revealed with no arrival recipe anywhere, so it lands in one frame"
        );
    }

    // The code block's copy button is the deliberate exception: it rests at half strength with its whole box drawn, so it brightens rather than appears and stays findable once the pointer has gone.
    let copy = rule_body(css, ".document-body pre > .code-copy {");
    assert_contains(copy, "opacity: var(--lt-opacity-50);");
    assert!(
        !copy.contains(LEAVE),
        "the copy button never disappears, so it owes no leave recipe"
    );
}

/// Every declaration in a rule body, as the property and what it is set to.
fn declarations(body: &str) -> Vec<(&str, &str)> {
    body.split(';')
        .filter_map(|one| one.split_once(':'))
        .map(|(name, value)| (name.trim(), value.trim()))
        .filter(|(name, _)| {
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit())
        })
        .collect()
}

/// The color a declaration changes, under the name the shared hover fade times it by. The shorthand counts: `background: <a wash>` moves the same paint `background-color` would.
fn color_changed(name: &str) -> Option<&'static str> {
    match name {
        "background" | "background-color" => Some("background-color"),
        "border-color" => Some("border-color"),
        "color" => Some("color"),
        _ => None,
    }
}

/// What one comma-separated selector fades, read as an element rather than as a control: the last class in it, the bare type at its end where the last compound carries no class, and the pseudo-element where one is drawn. Both tails matter here and nowhere else — `.docs-pager a` is the link inside the box rather than the box, and a `::before` is its own paint layer, so a transition written on either never reaches the other.
fn faded_subjects(selector: &str) -> Vec<String> {
    without_refusals(selector)
        .split(',')
        .filter_map(|one| {
            let one = one.trim();
            let (rest, pseudo) = match one.find("::") {
                Some(at) => (&one[..at], &one[at..]),
                None => (one, ""),
            };
            let class_at = rest.rfind('.')?;
            let mut who: String = rest[class_at + 1..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if who.is_empty() {
                return None;
            }
            let tail = rest[class_at..].split_whitespace().last().unwrap_or("");
            if !tail.starts_with('.') {
                who.push(' ');
                who.push_str(tail.split(':').next().unwrap_or(tail));
            }
            who.push_str(pseudo);
            Some(who)
        })
        .collect()
}

/// The properties a `transition` shorthand names for itself, under the same names the color side reads: `background` is the shorthand for the fill and `all` is every one of them. A leg written as one of the reveal recipes is opacity and nothing else, so it names no color.
fn transition_legs(body: &str) -> Vec<&'static str> {
    declarations(body)
        .into_iter()
        .filter(|(name, _)| *name == "transition")
        .flat_map(|(_, value)| value.split(','))
        .filter_map(|leg| leg.trim().split_whitespace().next())
        .filter_map(|leg| match leg {
            "all" => Some("all"),
            "opacity" => Some("opacity"),
            other => color_changed(other),
        })
        .collect()
}

#[test]
fn a_control_that_writes_its_own_fade_names_every_color_it_changes() {
    // The shared hover fade at the top of the sheet is written with `:where()` and so carries no specificity: a `transition` shorthand on the element replaces it outright rather than merging with it. So a control that writes one to reveal itself, and then changes a color when the pointer arrives, has nothing left to fade that color with — it lands in one frame while every other button in the window takes a tenth of a second. Five controls answer that by naming their color legs by hand, and this is what stops the sixth forgetting.
    let css = reading_mode_css();
    let plain = without_prose(css);
    let rules = css_rules(&plain);

    // What each control times for itself, gathered across every rule about it: its resting rule, the rule that shows it, and the layer it paints its wash on all speak for the same control.
    let mut named: Vec<(String, Vec<&str>)> = Vec::new();
    for rule in &rules {
        let legs = transition_legs(rule.body);
        if !rule.body.contains("transition:") {
            continue;
        }
        for subject in faded_subjects(rule.selector) {
            match named.iter_mut().find(|(who, _)| *who == subject) {
                Some((_, mine)) => mine.extend(legs.iter().copied()),
                None => named.push((subject, legs.clone())),
            }
        }
    }

    for rule in &rules {
        if !reaches_for_it(rule.selector) {
            continue;
        }
        let changed: Vec<&str> = declarations(rule.body)
            .into_iter()
            .filter_map(|(name, _)| color_changed(name))
            .collect();
        if changed.is_empty() {
            continue;
        }
        for subject in faded_subjects(rule.selector) {
            let Some((_, legs)) = named.iter().find(|(who, _)| *who == subject) else {
                // It writes no fade of its own, so the shared one still reaches it and times all three.
                continue;
            };
            for color in &changed {
                assert!(
                    legs.contains(color) || legs.contains(&"all"),
                    "{subject} writes its own transition, so the shared hover fade never reaches it, and it changes {color} without naming a leg for it: {} {{{}}}",
                    rule.selector,
                    rule.body
                );
            }
        }
    }
}

#[test]
fn a_hover_wash_that_has_to_sit_over_a_fill_is_painted_on_a_layer_that_fades() {
    // A control that has to keep its own fill under the wash — a plate over a picture, a red that says which answer is destructive — cannot replace it, so the obvious answer is a gradient written on top of it. A background image is not an interpolable value: it goes from `none` to the picture in one frame however the control is timed, and no `transition` on that control reaches it. The wash goes on a layer of its own instead, whose background color fades like any other.
    const WASH_IMAGE: &str = "linear-gradient(var(--lt-wash-hover), var(--lt-wash-hover))";
    let css = reading_mode_css();
    let plain = without_prose(css);
    let rules = css_rules(&plain);

    for rule in &rules {
        assert!(
            !rule.body.contains(WASH_IMAGE),
            "{} paints its hover wash as a background image, which cannot be faded from nothing however it is timed: {{{}}}",
            rule.selector,
            rule.body
        );
    }

    // Every control that keeps a fill under the wash. The three corner buttons keep a picture the wash would otherwise be replaced by, and the warning's destructive answer keeps the red that says which answer it is; each lays the wash on a layer over that fill, and that layer names the leg that fades it.
    for control in [
        ".table-sheet-open",
        ".image-sheet-open",
        ".image-export-open",
        ".is-danger",
    ] {
        let layer = rules
            .iter()
            .find(|rule| {
                faded_subjects(rule.selector).contains(&format!("{}::before", &control[1..]))
                    && rule.body.contains("background:")
                    && !rule.body.contains("var(--lt-wash-hover)")
            })
            .unwrap_or_else(|| panic!("{control} paints its hover wash on nothing of its own"));
        assert!(
            transition_legs(layer.body).contains(&"background-color"),
            "{control}'s wash layer names no leg to fade its fill with: {{{}}}",
            layer.body
        );
        let hovered = rules
            .iter()
            .find(|rule| {
                rule.selector.contains(&format!("{control}:hover::before"))
                    && rule.body.contains("var(--lt-wash-hover)")
            })
            .unwrap_or_else(|| panic!("{control} never puts the wash on its layer"));
        assert!(
            !hovered.body.contains("gradient"),
            "{control} is back to a wash that cannot fade: {{{}}}",
            hovered.body
        );
    }
}

#[test]
fn the_corner_buttons_wash_layer_is_held_by_its_button_and_paints_under_its_glyph() {
    // The wash the test above puts on a layer of its own is placed absolutely, so it is drawn against whatever box holds it and painted after everything in flow. Both are load-bearing and both look removable: without the buttons' own placement the layer hangs off some ancestor and the tint is drawn at the wrong size and in the wrong corner, and without the glyph's the 16% wash is laid over the icon rather than under it. Neither shows in a value a hover reads, which is why they are named here.
    let css = reading_mode_css();

    assert_contains(
        rule_body(
            &css,
            ".table-sheet-open,\n.image-sheet-open,\n.image-export-open {",
        ),
        "position: relative;",
    );
    // The table's own is placed absolutely a rule further down, which holds the layer the same way; what matters is that none of the three is left static.
    assert_contains(
        rule_body(&css, ".table-sheet-open {"),
        "position: absolute;",
    );
    assert_contains(
        rule_body(
            &css,
            ".table-sheet-open .lt-icon,\n.image-sheet-open .lt-icon,\n.image-export-open .lt-icon {",
        ),
        "position: relative;",
    );
}

#[test]
fn the_warning_buttons_wash_layer_is_isolated_and_paints_under_its_word() {
    // The corner buttons lift their icon above a layer painted after everything in flow. The warning's destructive answer has a bare text node instead, which nothing can be given a place of its own without a wrapper, so its layer goes under the content rather than the content over the layer: the button isolates, and the layer sits at a negative depth inside it — above the button's own red background, below its word, and stopping at the button rather than dropping behind the dialog. All three look removable and none of them shows in a value a hover reads.
    let css = reading_mode_css();

    let button = rule_body(&css, ".confirm-dialog-button.is-danger {");
    assert_contains(button, "position: relative;");
    assert_contains(button, "isolation: isolate;");
    assert_contains(
        rule_body(&css, ".confirm-dialog-button.is-danger::before {"),
        "z-index: var(--lt-z-below);",
    );
}
