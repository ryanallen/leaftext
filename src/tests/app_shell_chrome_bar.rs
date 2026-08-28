//! The app bar: groups, gaps, dividers, the palette, the window buttons and the maximize.

use super::*;

#[test]
fn app_bar_keeps_one_gap_between_visible_groups() {
    // The bar is one sequence of places to go, so every space it declares between the leaf, the history pair and the two trailing rows is the same 16px. Unequal gaps made the same row read as loosely assembled clusters. Three groups are the exceptions: the window buttons, below, where three read as one control set rather than three more stops along the row, back and forward, which are one paired control on that same tight gap, and the tab strip, which is a list of open documents rather than a run of unrelated controls. The leaf is a fourth of another kind: the gap it declares is the row's, and the gap a reader sees is 4px wider because its mark stops short of its box, so it is the one control that hands an inset back.
    let css = reading_mode_css();

    // The two that hold groups rather than buttons: the leaf beside the library button and the history pair, and the actions beside the window controls.
    for selector in [".app-bar-lead {", ".app-trailing-items {"] {
        let body = rule_body(css, selector);
        assert!(
            body.contains("gap: var(--lt-space-16);"),
            "{selector} must run on the bar's one gap: {body}"
        );
    }

    // Back and forward are one control, not two stops along the row, so they close up to the same 4px the window buttons take. The theme switch, the folder, the plus and the page export are the same reading: one set of things to press, and the last run on the bar to join them.
    for selector in [".history-actions {", ".app-actions-items {"] {
        let body = rule_body(css, selector);
        assert!(
            body.contains("gap: var(--lt-space-4);"),
            "{selector} is a run of buttons, so it closes up rather than taking the gap between groups: {body}"
        );
    }

    // Inside the strip the tabs close up to 4px so they read as one set, while each end of the strip keeps the row's 16px: that inset is what the flares below are capped by, and the strip carries it while the two zones either side add none.
    let strip = rule_body(css, ".tab-bar {");
    assert!(
        strip.contains("gap: var(--lt-space-4);"),
        "the tabs sit tight against each other rather than on the row's gap: {strip}"
    );
    assert!(
        strip.contains("padding: var(--lt-space-4) var(--lt-space-16) 0;"),
        "the strip's side insets stay on the bar's own gap: {strip}"
    );
    // The tighter gap takes 12px off each side of the active tab's flare, so the tab buys it back itself. Without that margin the flare's page-colored fill runs onto the neighbor and the three tabs read as one block; without it in the transition, every tab to the right jumps the moment the selection moves.
    let active = rule_body(css, ".tab-active {\n  max-width: none;");
    assert!(
        active.contains("margin: 0 var(--lt-space-12);"),
        "the active tab buys back the room its flare turns in: {active}"
    );
    // At an end of the strip there is no neighbor, and the strip's own 16px inset is already wider than the 14px flare — so the margin there would only push the first tab past the 16px every other space in the row keeps. Both drop, which is also a one-tab strip losing both.
    let first = rule_body(css, ".tab-active:first-child {");
    assert!(
        first.contains("margin-left: 0;"),
        "a selected first tab leaves the strip's own inset to feed its flare: {first}"
    );
    let last = rule_body(css, ".tab-active:last-child {");
    assert!(
        last.contains("margin-right: 0;"),
        "a selected last tab leaves the strip's own inset to feed its flare: {last}"
    );
    let tab = rule_body(css, ".tab {");
    assert!(
        tab.contains("margin var(--lt-duration-120) var(--lt-ease-emphasized)"),
        "the tabs slide as that margin arrives and leaves: {tab}"
    );
    let lead = rule_body(css, ".app-bar-lead {");
    assert!(
        lead.contains("padding: 0 0 0 var(--lt-space-12);"),
        "the lead keeps its logo-aligning left inset and adds no right one: {lead}"
    );
    // Handing the inset back is a negative margin rather than less padding, so the controls after the leaf move and its own 32px hit area does not. The gap beside it measured 20.67px against every other space's 16px.
    let brand = rule_body(css, ".brand-button {");
    assert!(
        brand.contains("padding: var(--lt-space-4);")
            && brand.contains("margin-right: calc(-1 * var(--lt-space-4));"),
        "the leaf keeps its 32px box and gives its trailing inset back to the row: {brand}"
    );
    // The window buttons close up to 4px instead of taking the row's gap, so the three read as one set, and they add no lead-in of their own.
    let controls = rule_body(css, ".window-controls {");
    assert!(
        controls.contains("gap: var(--lt-space-4);") && controls.contains("margin-left: 0;"),
        "the window buttons sit tight against each other: {controls}"
    );

    // The close chip's own distance from the window edge is not part of the rhythm and does not move: 4px on a frameless window, matching the 4px the chip leaves above it.
    let trailing = rule_body(css, ".app-trailing {");
    assert!(
        trailing.contains("padding-left: 0;")
            && trailing.contains("padding-right: var(--lt-space-24);"),
        "the trailing group adds no left inset and stays off the window edge: {trailing}"
    );
    let frameless = rule_body(css, ".frameless:not(.mac-frame) .app-trailing {");
    assert!(
        frameless.contains("padding-right: var(--lt-space-4);"),
        "the close chip stays 4px off the window corner: {frameless}"
    );
    // A Mac's dot is a quarter of a Windows button, so the same 4px reads as a third of a dot and the three run together: they take twice the gap while the Windows three above keep theirs.
    let mac = rule_body(css, ".mac-frame .window-controls {");
    assert!(
        mac.contains("gap: var(--lt-space-8);") && mac.contains("margin-left: 0;"),
        "the Mac's dots take twice the Windows gap: {mac}"
    );
    // Folded into the chevron's menu the same three stack, still 12px on the same gap, so the Mac column follows the row and the shared column stays where Windows needs it.
    let mac_panel = rule_body(css, ".mac-frame .app-overflow-panel .window-controls {");
    assert!(
        mac_panel.contains("gap: var(--lt-space-8);"),
        "the Mac's stacked dots take the same widened gap: {mac_panel}"
    );
    let shared_panel = rule_body(css, ".app-overflow-panel .window-controls {");
    assert!(
        shared_panel.contains("gap: var(--lt-space-4);"),
        "the shared stacked column keeps the Windows gap: {shared_panel}"
    );

    // The room beside the active tab has to clear its flare on both sides — the strip's 4px gap plus the 12px margin above — and the strip scrolls, so a flare wider than the strip's own 16px side inset is clipped flat rather than drawn: 14px is the largest radius on the scale that still leaves daylight inside that 16px. Pinned by the declaration because the stylesheet opens .tab-active twice and a lookup by selector finds the wrong block.
    assert!(
        css.contains("--tab-flare: var(--lt-radius-2xl);")
            && !css.contains("--tab-flare: var(--lt-radius-md);")
            && !css.contains("--tab-flare: var(--lt-radius-lg);")
            && !css.contains("--tab-flare: var(--lt-radius-xl);"),
        "the join curve must be the largest that clears the bar's gap"
    );
}

#[test]
fn an_emptied_history_strip_stops_taking_a_gap() {
    // The gap above lands between every pair of the lead's children, so the strip the fold leaves behind is 16px spent on nothing at the one moment the bar has no room. `:empty` cannot see that state: the markup writes the strip over eight lines, so three whitespace text nodes stay when the two buttons go. The child combinator and the attribute are the actions group's shape rather than anything the strip needs — its arrows are `disabled` and never `hidden` — and both containers are written in it so a reader meets one question rather than two.
    let css = reading_mode_css();

    let emptied = rule_body(css, ".history-actions:not(:has(> *:not([hidden]))) {");
    assert!(
        emptied.contains("display: none;"),
        "a history strip with nothing drawn in it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".history-actions:empty") && !css.contains(".history-actions:not(:has(*))"),
        "the emptied strip must be found by drawn child, not by `:empty`, which the markup's whitespace defeats, nor by a bare `:has()`, which is the narrow shape this rule left behind"
    );
}

#[test]
fn an_emptied_actions_group_stops_taking_a_gap() {
    // The trailing zone's gap lands between the actions group and the window buttons, so the group the fold empties first is 16px spent on nothing at the one moment the bar has no room. The child combinator and the attribute are both load-bearing: the update bell stays in the group hidden, and its own summary and panel are descendants nothing marks hidden, so `:empty`, `:has(*)` and `:has(*:not([hidden]))` all fail to see the emptied group.
    let css = reading_mode_css();

    let emptied = rule_body(css, ".app-actions-items:not(:has(> *:not([hidden]))) {");
    assert!(
        emptied.contains("display: none;"),
        "an actions group with nothing drawn in it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".app-actions-items:empty") && !css.contains(".app-actions-items:not(:has(*))"),
        "the emptied group must be found by drawn child, not by `:empty` or a bare `:has()`, which the hidden update bell defeats"
    );
}

/// Every element the reader tool bar ships after its divider, as its opening tag. Depth-tracked, so the icon inside a button is not one of them.
fn reader_toolbar_tags_after_divider(html: &str) -> Vec<&str> {
    let bar = html
        .find("<div id=\"readerToolbar\"")
        .expect("the shell ships a reader tool bar");
    let rest = &html[bar..];
    let divider_at = rest
        .find("<span class=\"reader-tool-divider\"")
        .expect("the reader tool bar ships a divider");

    let mut tags = Vec::new();
    let mut depth = 0usize;
    let mut seen_divider = false;
    let mut at = 0usize;
    while let Some(open) = rest[at..].find('<') {
        let start = at + open;
        // A comment is not an element, and its text can hold a `>`.
        if rest[start..].starts_with("<!--") {
            match rest[start..].find("-->") {
                Some(shut) => at = start + shut + 3,
                None => break,
            }
            continue;
        }
        let Some(shut) = rest[start..].find('>') else {
            break;
        };
        let tag = &rest[start..start + shut + 1];
        at = start + shut + 1;
        if tag.starts_with("</") {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                break;
            }
            continue;
        }
        if depth == 1 && seen_divider {
            tags.push(tag);
        }
        if start == divider_at {
            seen_divider = true;
        }
        depth += 1;
    }
    tags
}

#[test]
fn the_reader_bar_divider_goes_when_nothing_beside_it_is_drawn() {
    // The divider stands between the view buttons and the editing ones, so an editing half with nothing drawn in it leaves the divider dividing nothing. Naming each button that can stand to its right is the markup's own list kept twice: Redo reached the markup a commit before it reached that list, and the bar drew Redo alone with no divider while every check passed. Asking whether any sibling after the divider is drawn needs no list — what it needs instead is that every element shipped after the divider can be hidden, which is what the last assertion holds and nothing else in the tree would notice.
    let css = reading_mode_css();
    let html = app_shell_html();

    let emptied = rule_body(
        css,
        ".reader-toolbar:not(:has(.reader-tool-divider ~ *:not([hidden]))) .reader-tool-divider {",
    );
    assert!(
        emptied.contains("display: none;"),
        "a divider with nothing drawn beside it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".undo-button[hidden]") && !css.contains(".redo-button[hidden]"),
        "the divider must be found by drawn sibling, not by naming each button, which the next button added beside it defeats"
    );

    let after = reader_toolbar_tags_after_divider(&html);
    assert!(
        !after.is_empty(),
        "the reader tool bar ships editing buttons after its divider"
    );
    for tag in after {
        assert!(
            tag.contains(" hidden"),
            "an element after the reader bar's divider must ship hidden, or the divider can never go: {tag}"
        );
    }
}

#[test]
fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
    let css = reading_mode_css();

    // Open, New and Export are the same button three times over, and share both rules with the theme switch rather than repeating them.
    let rest = rule_body(
        css,
        ".open-button,
.new-button,
.export-button {",
    );
    assert_contains(rest, "border-color: transparent;");
    assert_contains(rest, "background: transparent;");
    assert_contains(rest, "color: var(--lt-muted-foreground);");

    let hover = rule_body(
        css,
        ".open-button:hover,
.new-button:hover,
.export-button:hover {",
    );
    assert_contains(
        hover,
        "background: var(--lt-navigation-button-hover-background);",
    );
    assert_contains(hover, "color: var(--lt-primary-foreground);");
}

#[test]
fn app_shell_header_keeps_one_chrome_shade_with_dividers() {
    let css = reading_mode_css();

    for expected in [
        // One flat chrome shade under the dot grid. No translucent fill or backdrop blur: either makes the bar's tone depend on what sits behind it.
        "background-color: var(--lt-surface);",
        // The circles are written here rather than pulled from a variable holding the finished gradient: the ink has to resolve on the element that draws it, or a surface setting its own would silently get this one's.
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "--lt-grain-dot: var(--app-bar-grain);",
        "background-size: 2px 2px;",
        // The grain tiles from the window, so every grained surface shares one lattice and no seam between them reads as a hairline.
        "background-attachment: fixed;",
        // The bar keeps a hairline top divider in the outer border color.
        "border-top: var(--lt-stroke-1) solid var(--lt-border);",
        // The bottom divider is drawn by ::after (not border-bottom) so the active tab can paint over it and read as joined to the page below.
        ".app-bar::after {",
        "background: var(--lt-border);",
    ] {
        assert_contains(css, expected);
    }

    // No blurred fade elements hanging below the bar, and no scroll shadow.
    for absent in [".app-bar::before", ".app-bar.is-scrolled"] {
        assert!(!css.contains(absent), "app header must not draw {absent}");
    }

    // No surface derives its own shade from the token — a tint on one shows up as a tone seam where it meets its neighbor.
    assert!(!css.contains("--library-surface"));
    for tinted in [
        "color-mix(in srgb, var(--lt-surface)",
        "color-mix(in srgb, var(--lt-surface) 98%, black)",
    ] {
        assert!(!css.contains(tinted), "chrome must not tint {tinted}");
    }
}

#[test]
fn the_palette_stands_in_the_bar_where_the_gear_did() {
    let html = app_shell_page();

    // Themes were the one thing anybody opened that menu for, so they are one click. A plain icon button in the same slot, opening the same sheet.
    assert_contains(
        &html,
        r#"<button type="button" id="themeSheetOpen" class="icon-button theme-button" aria-label="Themes" title="Themes" aria-haspopup="dialog">"#,
    );
    assert_icon(&html, "theme");
    assert_contains(
        &html,
        "themeSheetOpen.addEventListener('click', openThemeSheet);",
    );
    // No label beside it, so the theme in use rides the tooltip.
    assert_contains(
        &html,
        "'Themes — ' + themeFamilyName(family) + ' · ' + (THEME_MODE_NAMES[mode] || mode);",
    );
    assert_contains(&html, r#"id="themeSheet""#);
    assert_contains(&html, r#"<span class="theme-sheet-title">Themes</span>"#);
    // No language row: the interface ships in one language.
    assert!(!html.contains("localeMode"));
    assert!(!html.contains("leafLocale"));
}

#[test]
fn the_palette_color_marks_are_wide_enough_to_see_in_the_app_bar() {
    // One viewBox unit is 0.67px inside the bar's 16px icon box, so the marks it shipped with — half-unit dots — were thinner than the outline around them. Radius, not the old string: a test that only refused `r=".5"` would pass by finding nothing.
    let svg = include_str!("../assets/theme.svg");
    let mut radii: Vec<f64> = Vec::new();

    for circle in svg.split("<circle").skip(1) {
        let r = circle
            .split("r=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("a circle carries a radius");
        radii.push(r.parse().expect("a radius is a number"));
    }
    for path in svg.split("<path").skip(1) {
        let d = path
            .split("d=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("a path carries a d");
        // A mark is a ring: nothing but a move and arcs. The palette outline draws curves too, and its size is not what this is about.
        if !d
            .chars()
            .all(|c| !c.is_alphabetic() || matches!(c, 'M' | 'm' | 'A' | 'a'))
        {
            continue;
        }
        for arc in d.split(['a', 'A']).skip(1) {
            let r = arc
                .split_whitespace()
                .next()
                .expect("an arc opens with its radius");
            radii.push(r.parse().expect("an arc radius is a number"));
        }
    }

    assert!(
        radii.len() >= 3,
        "found {} color marks in theme.svg, so this test is passing by finding nothing",
        radii.len()
    );
    for r in radii {
        assert!(
            r >= 1.0,
            "a color mark is {r} units of radius, under the 1 that reaches a visible width at 16px"
        );
    }
}

#[test]
fn the_update_bell_keeps_the_menu_keyboard_and_pointer_polish() {
    let html = app_shell_page();

    for expected in [
        r#"<summary id="updateSummary" class="icon-button" aria-label="Update" title="Update">"#,
        r#"<div class="update-panel" role="group" aria-labelledby="updateSummary">"#,
        "updateMenu.querySelector('summary').focus();",
        "if (updateMenu.open && !updateMenu.contains(event.target)) updateMenu.open = false;",
    ] {
        assert_contains(&html, expected);
    }
    assert_icon(&html, "update");

    let css = reading_mode_css();

    // The box, the radius and the focus ring the settings summary had, on the bell's.
    for expected in [
        ".update-menu summary::-webkit-details-marker",
        ".update-panel {",
        "right: 0;",
        "width: min(290px, calc(100vw - 28px));",
        "summary:focus-visible",
        ".icon-button {",
        "place-items: center;",
        "min-width: 32px;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn both_shells_draw_their_own_three_window_buttons() {
    // Two kinds of frameless, one flag each, and neither platform leaves us a native title bar to keep. Apple's dots are off, so the same three buttons and the same three commands serve both; only the look and the place differ, and the Mac's move to the bar's left end where Apple's were.
    let html = app_shell_page();
    // The guard is written twice on purpose — this is the one that draws the chrome, and the flag line alone cannot tell them apart.
    assert_contains(
        &html,
        "if (window.__leafFrameless || window.__leafMacFrame) {\n  document.body.classList.add('frameless');",
    );
    assert_contains(
        &html,
        "if (window.__leafMacFrame) document.body.classList.add('mac-frame');",
    );

    // Revealed and wired for both, not behind the Windows flag: a Mac with them hidden has no way to close the window at all now that Apple's are gone. Read over the stretch that draws them rather than over the whole script, which has its own Windows-only branches for things a Mac frame answers itself.
    let drawing_them = html
        .split("if (window.__leafFrameless || window.__leafMacFrame) {")
        .nth(1)
        .and_then(|rest| rest.split("winButton('winClose', 'windowClose');").next())
        .expect("the shell draws the three window buttons");
    assert!(
        !drawing_them.contains("if (window.__leafFrameless) {"),
        "our own three are no longer Windows-only"
    );
    assert_contains(&html, "windowControls.hidden = false;");
    assert_contains(&html, "winButton('winClose', 'windowClose');");
    // Moved into the bar's left zone rather than written into the markup twice, and before the fold reads where things came from, so unfolding puts them back at the left.
    assert_contains(
        &html,
        "const lead = window.__leafMacFrame && document.querySelector('.app-bar-lead');",
    );

    // A full-screen Mac keeps our three dots. Apple's own come back when the pointer reaches the top edge and ours cannot, so hiding ours leaves the green one as the way in and nothing as the way out.
    assert_contains(&html, "window.leafSetFullscreen = (fullscreen) => {");
    assert_contains(
        &html,
        "document.body.classList.toggle('is-fullscreen', !!fullscreen);",
    );
    assert!(
        !reading_mode_css().contains("body.mac-frame.is-fullscreen .window-controls"),
        "full screen hides the dots again, so the green one enters and never leaves"
    );
    // What full screen does take is the frame the window is held off its own edge by: no shadow, no outer line, no rounded corner.
    for rule in [
        "body.mac-frame.is-fullscreen {\n  --app-shadow-top: 0px;",
        "body.mac-frame.is-fullscreen .app-surface {\n  border: 0;\n  border-radius: 0;\n}",
        "body.mac-frame.is-fullscreen::before {\n  content: none;\n}",
    ] {
        assert_contains(reading_mode_css(), rule);
    }

    // The green dot is full screen and Option-press is zoom, the way a Mac splits them; a Windows square is zoom either way.
    assert_contains(
        &html,
        "window.__leafMacFrame && !(event.altKey && !document.body.classList.contains('is-fullscreen'))",
    );
    // And the word on it follows whichever of the two states is this shell's.
    assert_contains(
        &html,
        "leafWinMaxLabel(fullscreen ? 'Exit Full Screen' : 'Enter Full Screen')",
    );
    assert_contains(
        &html,
        "if (!window.__leafMacFrame) leafWinMaxLabel(maximized ? 'Restore' : 'Maximize');",
    );
}

#[test]
fn the_app_bar_maximizes_from_the_second_press_not_from_a_dblclick() {
    // A drag hands the window to a Windows move loop that swallows every later mouse event, so an app-bar dblclick listener is dead code.
    let html = app_shell_page();
    assert!(
        !html.contains("appBar.addEventListener('dblclick'"),
        "an app-bar dblclick can never fire once a drag starts; decide on mousedown"
    );
    let handler = html
        .split_once("bar.addEventListener('mousedown'")
        .expect("a drag bar decides window drags on mousedown")
        .1;
    let handler = &handler[..handler.find("\n    });").expect("the handler closes")];
    // The app bar is one of them. The flowchart sheet covers the whole window, so its header is the other — without it the window cannot be moved until the diagram is put away.
    assert_contains(&html, "dragWindowFrom(appBar);");
    assert_contains(
        &html,
        "dragWindowFrom(document.getElementById('flowSheetHead'));",
    );
    assert_contains(&html, "function dragWindowFrom(bar) {");
    assert!(
        handler.contains("windowToggleMaximize") && handler.contains("event.detail === 2"),
        "the second press is what maximizes: {handler}"
    );
    // A dragged window carries the page under the cursor, so a press just after a quick drag also counts as 2. Only the window's corner tells them apart.
    assert!(
        handler.contains("window.screenX"),
        "detail alone maximizes after a fast drag; check the window stayed put: {handler}"
    );
}

#[test]
fn every_element_in_the_page_sits_inside_the_one_box_that_means_the_app() {
    // The app surface is what a `position: fixed` overlay is measured from and clipped to, so anything added beside it belongs to the window instead — and once the app's edge is inset, a sheet or a scrim placed against the window runs 20px past the app's corner and paints over the shadow. Nothing in `<body>` may stand next to it.
    const VOID: [&str; 8] = ["br", "hr", "img", "input", "link", "meta", "source", "wbr"];
    let html = app_shell_html();
    let body = html
        .split_once("<body>")
        .expect("the page has a body")
        .1
        .split_once("</body>")
        .expect("the body closes")
        .0;

    let mut depth = 0usize;
    let mut surfaces = 0usize;
    let mut rest = body;
    while let Some(at) = rest.find('<') {
        rest = &rest[at..];
        if let Some(after) = rest.strip_prefix("<!--") {
            let end = after.find("-->").expect("a comment closes");
            rest = &after[end + 3..];
            continue;
        }
        let end = rest.find('>').expect("a tag closes");
        let tag = &rest[..=end];
        rest = &rest[end + 1..];
        if tag.starts_with("</") {
            depth = depth.saturating_sub(1);
            continue;
        }
        if tag.contains("id=\"appSurface\"") {
            assert_eq!(depth, 0, "the app surface is the body's own child: {tag}");
            surfaces += 1;
            depth += 1;
            continue;
        }
        assert!(
            depth >= 1,
            "this stands beside the app surface rather than inside it, so it is placed against the window rather than against the app: {tag}"
        );
        let name = tag
            .trim_start_matches('<')
            .split([' ', '>', '/'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !tag.ends_with("/>") && !VOID.contains(&name.as_str()) {
            depth += 1;
        }
    }
    assert_eq!(surfaces, 1, "one box means the app, and only one");
    assert_eq!(depth, 0, "every tag in the page closes");
}

#[test]
fn nothing_in_the_front_end_adds_a_floating_thing_to_the_window() {
    // The menus, the growl, the rename box, the link tip, the first-run bubble, the drag ghost and the breadcrumb menu are all built in script rather than declared in the page, so the markup test above cannot see them. Added to `<body>` they belong to the window: not clipped by the app, and placed against the window's own corner, which is 20px outside the app's once the app's edge is a shadow. There is one box they all go in.
    let script = app_shell_script();
    assert!(
        !script.contains("document.body.appendChild"),
        "something is added beside the app surface rather than inside it, so it is the window's rather than the app's"
    );
    assert_contains(
        script,
        "const appSurface = document.getElementById('appSurface')",
    );
    // And no divider color rides to the frame with it: the frame draws none.
    assert!(
        !script.contains("borderR:"),
        "the page still works out a divider color for a frame that draws nothing with it"
    );
    assert_contains(script, "command: 'setWindowChrome',");
}

/// Every action in the app bar rests the same way. A button that carries only the icon-button component takes that component's own fill, which is the filled primary look the bar spends on saying which view you are in — so a new action ships reading as the one thing already pressed, which is what the fourth one did. The list is read off the markup rather than written here, so the fifth is held to it without anybody remembering to add a name.
#[test]
fn every_action_in_the_app_bar_rests_muted_rather_than_filled() {
    let css = reading_mode_css();
    let html = crate::APP_SHELL_HTML;

    let group = html
        .split_once(r#"id="appActionsItems""#)
        .and_then(|(_, rest)| rest.split_once(r#"<div class="window-controls""#))
        .map(|(group, _)| group)
        .expect("the actions group");

    // Every button standing in the group. The update bell is a `<summary>` inside its own component and is only ever there when there is something to install, so it is not one of these.
    let mut found = 0;
    for piece in group.split(r#"class="icon-button "#).skip(1) {
        let classes = piece.split('"').next().expect("the class list closes");
        let class = classes.split_whitespace().next().expect("a second class");
        found += 1;
        for state in ["", ":hover"] {
            let listed = format!(".{class}{state},");
            let alone = format!(".{class}{state} {{");
            assert!(
                css.contains(&listed) || css.contains(&alone),
                ".{class} rests on the bar's own muted fill rather than the filled primary the views wear"
            );
        }
    }
    assert!(found >= 4, "the actions group holds {found} buttons");
}
