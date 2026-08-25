//! Hiding, the one contained box, the page frame, the start screen's own width and the folded list.

use super::*;

#[test]
fn anything_that_hides_itself_is_allowed_to() {
    // `display` on a class outranks the user agent's `[hidden] { display: none }`, so an element that sets one and relies on the other is simply always visible. That is how the floating toolbar came to sit over the home screen: the attribute was set, the rule ignored it, and nothing failed.
    let html = app_shell_page();
    let css = reading_mode_css();

    for element in html.split('<').skip(1) {
        let Some(tag) = element.split('>').next() else {
            continue;
        };
        // Only elements that start hidden — the ones a stale `display` would strand on screen.
        if !(tag.ends_with(" hidden") || tag.contains(" hidden ")) {
            continue;
        }
        let Some(classes) = tag
            .split_once("class=\"")
            .and_then(|(_, rest)| rest.split_once('"').map(|(classes, _)| classes.to_string()))
        else {
            continue;
        };
        for class in classes.split_whitespace() {
            let rule = format!(".{class} {{");
            let Some(body) = css
                .split(&rule)
                .nth(1)
                .and_then(|rest| rest.split('}').next())
            else {
                continue;
            };
            if !body.contains("display:") {
                continue;
            }
            let escape = format!(".{class}[hidden]");
            assert!(
                css.contains(&escape),
                ".{class} sets `display`, so the `hidden` attribute on it does \
                 nothing. Add `{escape} {{ display: none; }}`."
            );
        }
    }
}

#[test]
fn anything_marked_hidden_is_actually_hidden() {
    // A rule that matches `[hidden]` and then sets a `display` of its own beats the browser's own `[hidden] { display: none }` and leaves the thing on the page — laid out, invisible, and still taking clicks. That is how a stray comment between two selectors put the glossary backdrop across the bottom fifth of the home screen and ate every link under it.
    let css = reading_mode_css();

    for rule in css.split('}') {
        let Some((selector, body)) = rule.split_once('{') else {
            continue;
        };
        // Only the selector itself, never a comment sitting above it. Comments are cut out of the selector rather than cut off before it: a comment *between* two selectors is exactly how this went wrong, and reading only what follows it would hide the half that matters.
        let mut selector = selector.to_string();
        while let Some(opens) = selector.find("/*") {
            let Some(shuts) = selector[opens..].find("*/") else {
                break;
            };
            selector.replace_range(opens..opens + shuts + 2, " ");
        }
        let selector = selector.trim();
        // `:not([hidden])` is the opposite claim — it matches what is showing.
        if !selector.replace(":not([hidden])", "").contains("[hidden]") {
            continue;
        }
        let display = body
            .split(';')
            .map(str::trim)
            .find(|line| line.starts_with("display:"));
        assert_eq!(
            display,
            Some("display: none"),
            "`{selector}` matches a hidden element but sets {display:?}"
        );
    }
}

#[test]
fn a_theme_card_holds_its_name_to_one_line_height() {
    let css = reading_mode_css();

    // The swatch block above the name is a fixed height and the padding either side of it is a fixed step, so the name's line box is the only part of a card a font can resize — and the card sets its type with a `font` shorthand, which leaves the line height at `normal`, read off whichever face is loaded. Unset, the previews arriving grow the sheet 2px under the reader, and the drop as the picker closes moves it back.
    assert_contains(
        rule_body(css, ".theme-item-name {"),
        "line-height: var(--lt-leading-1-3);",
    );
    // The swap is the face alone. A line height on this side would be one the resting card does not have, which is the same fault with a different sign.
    let swap = rule_body(css, ".theme-item.font-ready .theme-item-name {");
    assert!(
        !swap.contains("line-height"),
        "the font-ready swap must change nothing but the face"
    );
}

#[test]
fn the_macs_three_dots_are_ours_and_take_the_themes_colors() {
    let css = reading_mode_css();

    // The bar reserves nothing for Apple's dots. A native view pinned to the window cannot fold, so a fixed 86px left zone is spent whether the bar has the room or not — a quarter of a narrow bar, pushing the tab strip right.
    assert!(
        !css.contains("--app-bar-mac-dots"),
        "the bar must not reserve room for dots it draws itself"
    );

    // Round, and in the theme's own stop, careful and good — never three fixed hex values, which was the one thing Apple's dots got wrong.
    let dot = rule_body(css, ".mac-frame .window-control {");
    assert_contains(dot, "border-radius: 50%;");
    assert_contains(dot, "background: var(--lt-warning);");
    // No mark until the pointer is on it, the way a Mac's has none.
    assert_contains(dot, "color: transparent;");
    assert_contains(
        rule_body(css, ".mac-frame .window-control-close {"),
        "background: var(--lt-danger);",
    );
    assert_contains(
        rule_body(css, ".mac-frame #winMaximize {"),
        "background: var(--lt-success);",
    );
    // Apple's order out of markup that runs minimize, maximize, close: only the close moves.
    assert_contains(
        rule_body(css, ".mac-frame .window-control-close {"),
        "order: -1;",
    );
    // Stacked in the chevron menu they read top to bottom, so that order turns over: zoom at the top, close at the foot and farthest from the pointer that opened it.
    assert_contains(
        rule_body(css, ".mac-frame .app-overflow-panel #winMaximize {"),
        "order: -1;",
    );
    assert_contains(
        rule_body(
            css,
            ".mac-frame .app-overflow-panel .window-control-close {",
        ),
        "order: 1;",
    );
    // Hovering shows the mark in the bar's own color, and the dot keeps its own — the square Windows chip must not take over.
    assert_contains(
        rule_body(css, ".mac-frame .window-control:hover {"),
        "color: var(--lt-surface);",
    );

    // The flush close chip owns the window's corner only where we are the ones drawing it; on a Mac that end of the bar is an ordinary toolbar.
    assert_contains(css, ".frameless:not(.mac-frame) .app-trailing {");
    assert!(
        !css.contains("\n.frameless .app-trailing {"),
        "the frameless trailing inset must exempt the Mac shell"
    );
}

#[test]
fn the_first_run_bubble_never_takes_the_pointer() {
    let css = reading_mode_css();

    // The owner asked for this by name, on the built thing: the box is a message with nothing in it to press, so a pointer crossing it on the way somewhere else must not lose the words mid-sentence, and it must not stand between the pointer and whatever it is laid over. The bubble registers no listeners of its own either — see `the vault hint shows once, and being met is permanent` in the front-end check — and this is the half of the rule that lives in the stylesheet.
    let rule = rule_body(css, ".hint-bubble {");
    assert_contains(rule, "pointer-events: none;");
    // Over the page and out of the layout: wedged into a row it would be pinched against the pane's edge, and nothing on screen may move to make room for it. The layer is the line above read on a menu — it points at the pane's folder switch, and a right-click on a folder row below opens one into the same space.
    assert_contains(rule, "position: fixed;");
    assert_contains(rule, "z-index: var(--lt-z-44);");

    // The chevron carries the box's own edge and fill rather than a second set, so the two cannot drift apart.
    let tail = rule_body(css, ".hint-bubble-tail {");
    assert_contains(tail, "background: var(--lt-surface-elevated);");
    assert_contains(
        tail,
        "border-left: var(--lt-stroke-1) solid var(--lt-border);",
    );

    // One placement class per side, each aiming the chevron at the edge that faces the target.
    for side in ["is-right", "is-left", "is-above", "is-below"] {
        assert_contains(css, &format!(".hint-bubble.{side} .hint-bubble-tail {{"));
    }
}

/// Every `@media` block whose condition is about width, with the CSS inside it. Written by hand because the check is exactly "does any of these mention that screen".
fn width_media_blocks(css: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut rest = css;
    while let Some(at) = rest.find("@media") {
        let after = &rest[at..];
        let open = after.find('{').expect("a media block opens");
        if after[..open].contains("width") {
            let mut depth = 0usize;
            let mut end = open;
            for (offset, byte) in after[open..].bytes().enumerate() {
                if byte == b'{' {
                    depth += 1;
                } else if byte == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        end = open + offset;
                        break;
                    }
                }
            }
            blocks.push(&after[open..end]);
        }
        rest = &after[open..];
    }
    blocks
}

#[test]
fn the_start_screen_folds_on_its_own_width_and_never_on_the_windows() {
    // The library pane is a remembered width the reader column shrinks under, and it can be dragged to the window less the reader's minimum — so a 1160px window can leave this section 320px wide while an 880px one with the pane shut leaves it 720px. A window breakpoint would call both of those the same thing. One container query on the section sets the column count, and it is the only thing allowed to.
    let css = reading_mode_css();
    let column = rule_body(&css, ".reader-shell.empty {");
    assert_contains(column, "container-type: inline-size;");
    assert_contains(column, "container-name: home;");
    assert_contains(&css, "@container home (min-width: 600px) {");
    let grid = rule_body(&css, ".home-list-grid {");
    // One column until the query says two, so the fold and the column count are one number in one place.
    assert_contains(grid, "grid-template-columns: minmax(0, 1fr);");
    // The writing's own width, growing past it only where a path needs the room and never past the reader. Stretched to the reader it left two thin columns at opposite edges of an empty screen; held to its content it was narrower than the writing above it.
    assert_contains(grid, "width: max-content;");
    assert_contains(grid, "min-width: 100%;");
    assert_contains(
        grid,
        "max-width: max(100%, calc(100cqi - 2 * var(--reader-lane-inset)));",
    );
    // And the list fills its column, so the fill under the pointer ends where the list ends.
    assert_contains(rule_body(&css, ".home-list {"), "width: 100%;");
    assert_contains(grid, "transform: translateX(-50%);");
    // Each list is a box of its own rather than a section of the writing, so nothing draws a rule across the screen above them.
    let card = rule_body(&css, ".home-list {");
    assert_contains(card, "border: var(--lt-stroke-1) solid var(--lt-border);");
    assert_contains(card, "border-radius: var(--lt-radius-lg);");
    // With nothing kept the screen is prod's own: the plain recent block, its own rules, its own color.
    assert_contains(
        rule_body(&css, ".recent {"),
        "border-top: var(--lt-stroke-1) solid var(--lt-navigation-recent-border);",
    );
    assert_contains(
        rule_body(&css, ".recent button {"),
        "overflow-wrap: anywhere;",
    );

    for block in width_media_blocks(&css) {
        for named in [".home-list", ".home-row", ".home-list-grid", ".empty-state"] {
            assert!(
                !block.contains(named),
                "a width media block names {named}; this screen measures itself"
            );
        }
    }
}

#[test]
fn a_folded_list_shows_five_and_hands_the_rest_to_the_sheet() {
    // The way out is drawn only where the columns have folded: wide, the box scrolls and a button saying "show all" would be offering what is already on screen. The button is in the markup either way, so this rule is the whole of the mode.
    let css = reading_mode_css();
    assert_contains(rule_body(&css, ".home-showall {"), "display: none;");
    let folded = &css[rule_at(&css, "@container home (max-width: 599px) {")..];
    let folded = &folded[..folded.find("\n}\n").expect("the query closes")];
    assert_contains(folded, "display: block;");
    // Five rows, and no scroll box: a nested scroller inside a page that also scrolls takes a wheel meant for the page.
    assert_contains(folded, "max-height: calc(var(--home-row-height) * 5);");
    assert_contains(folded, "overflow-y: hidden;");
    // And no soft edge either — a fade over a box that cannot scroll says there is more below when there is not.
    assert_contains(folded, ".home-list-fade {\n    display: none;\n  }");

    // In the sheet the same box is uncapped, because the sheet's own ceiling is what bounds it.
    let inside = rule_body(&css, ".home-sheet .home-list-scroll {");
    assert_contains(inside, "max-height: none;");
    // The sheet dissolves to its own surface rather than the reader's, or the ramp ends on a color that is not under it.
    assert_contains(
        rule_body(&css, ".home-sheet .home-list-fade {"),
        "--home-list-surface: var(--lt-background);",
    );
}

#[test]
fn the_app_is_one_contained_box_and_nothing_takes_the_whole_window() {
    // `contain: paint` is the whole of what makes this element mean "the app": it is what a fixed child is positioned from and what one is clipped to. Without it every overlay in the page goes back to being placed against the window, and the shadow band would have sheets and scrims sitting on top of it.
    let css = reading_mode_css();
    let surface = rule_body(&css, ".app-surface {");
    assert_contains(surface, "position: fixed;");
    assert_contains(surface, "contain: paint;");
    // Nothing measures itself against the window: past the app's own inset the window is edge the app does not paint, so a box given the window's height is a box hanging into the shadow.
    assert!(
        !css.contains("100vh"),
        "something still takes the whole window's height rather than the app surface's"
    );
}

#[test]
fn a_page_that_is_not_the_app_keeps_its_own_scroll() {
    let css = reading_mode_css();

    // Both published sites are handed this whole file. Where the root element's overflow is `visible` a browser takes the viewport's from `body`, so a bare `body { overflow: hidden }` leaves the page with no scrollport at all — which is what held leaftext.com and empty.guru to their first screenful from v1.5.0. `position` and `touch-action` are here for the same reason: unscoped, either one unmoors or freezes a page this stylesheet was only ever meant to give a document its look.
    for selector in ["\nbody {", "\nhtml,\nbody {", "\n:root {"] {
        let mut rest = css;
        while let Some(at) = rest.find(selector) {
            let opened = &rest[at + selector.len()..];
            let rule = &opened[..opened.find('}').expect("the rule should close")];
            for taken in ["\n  overflow:", "\n  position:", "\n  touch-action:"] {
                assert!(
                    !rule.contains(taken),
                    "`{}` takes the frame with `{}` from every page handed this stylesheet, published sites included",
                    selector.trim(),
                    taken.trim()
                );
            }
            rest = opened;
        }
    }
}

#[test]
fn the_app_window_still_hides_its_own_overflow() {
    // The window does not scroll: the app surface is a fixed box the page is clipped to, and a scrollport behind it would slide the app inside its own frame. So the rule is scoped rather than dropped, and its key is the one box only the app's own page carries.
    assert_contains(
        rule_body(reading_mode_css(), "body:has(.app-surface) {"),
        "overflow: hidden;",
    );
    assert_contains(crate::APP_SHELL_HTML, r#"class="app-surface""#);
}
