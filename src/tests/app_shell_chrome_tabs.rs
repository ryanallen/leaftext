//! Tabs: their close cross, their padding, and the heart on one.

use super::*;

#[test]
fn an_unsaved_tab_does_not_resize_when_you_reach_for_it() {
    // The dot was in the tab's row and hidden on hover, so pointing at a modified tab deleted 13px of content: the tab shrank and its label jumped, and the dot had been shoving the close button away from the name the whole time. Sharing the button's corner means the swap costs no layout.
    let css = reading_mode_css();

    let dot = rule_body(css, ".tab-dirty-dot {");
    assert!(
        dot.contains("position: absolute;"),
        "the dot must be out of flow or showing it resizes the tab: {dot}"
    );
    assert!(
        !dot.contains("margin"),
        "an out-of-flow dot has no margin to push the row with: {dot}"
    );
    assert!(
        dot.contains("pointer-events: none;"),
        "the close button underneath stays the click target: {dot}"
    );

    // The close button sits in the same corner, so the two swap in place.
    let close = rule_body(css, ".tab-close {");
    assert!(close.contains("position: absolute;"));
    assert!(close.contains("top: 2px;") && close.contains("right: 2px;"));

    // One corner, one occupant — and the keyboard can still get to the button.
    assert_contains(
        css,
        ".tab-modified:hover .tab-dirty-dot,\n.tab-modified:focus-within .tab-dirty-dot {\n  display: none;\n}",
    );
    // Hiding the cross at rest is every tab's rule now, held by `the_close_cross_waits_until_you_reach_the_tab`. A rule keyed on the active tab's hover resizes the tab, and covers only that one tab.
    assert!(
        !css.contains(".tab-active:hover .tab-dirty-dot"),
        "the hover rule that resized the tab is gone"
    );

    // Swapping one for the other costs no layout either way, both being out of flow — and the tab's inset is even, since neither corner is bought from the row.
    let tab = rule_body(css, ".tab {");
    assert!(
        tab.contains("padding: 0 var(--lt-space-4);"),
        "the tab reserves nothing for either corner button: {tab}"
    );
}

#[test]
fn the_close_cross_waits_until_you_reach_the_tab() {
    // The cross was reserving a corner on every tab whether anyone was offering it or not. Hidden at rest it costs nothing, so the name gets the room back.
    let css = reading_mode_css();

    // Markup still builds one on every tab: hiding it is the stylesheet's job, never the renderer's, or the keyboard would have nothing to reach.
    assert_contains(
        &app_shell_page(),
        r#"<span class="lt-icon lt-icon-tab-close"></span>"#,
    );

    let close = rule_body(css, ".tab-close {");
    // A wash behind it, since it now lands on the last letters of the name rather than in cleared space. On the selected tab that wash follows the contained page's own color; everywhere else it falls back to the surface.
    assert!(
        close.contains("background: var(--tab-corner-fill, var(--lt-surface));"),
        "the cross needs a wash to read over the name: {close}"
    );
    // In decelerating, out accelerating after a hold — the heart's timing in the opposite corner, every value a token. The colors ride behind the opacity leg; `a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot` holds those.
    assert_contains(
        &close.to_string(),
        "transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate),",
    );
    // The pointed state stands in for a hover the pointer never made again: the strip is rewritten whole under a still hand, and the cross is on a new element.
    assert_contains(
        css,
        ".tab:not(:hover):not(:focus-within):not(.is-pointed) .tab-close {\n  opacity: 0;\n  transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300);\n}",
    );
    // Keyed on the tab, not on the modified tab: the narrow rule this generalizes must not survive beside it.
    assert!(
        !css.contains(".tab-modified:not(:hover):not(:focus-within) .tab-close"),
        "the modified-only hide rule is gone; one rule covers every tab"
    );
}

#[test]
fn tabs_keep_full_filenames_and_balanced_padding() {
    let css = reading_mode_css();
    let rule = |head: &str| rule_body(css, head);
    let tab = rule(".tab {");
    let label = rule(".tab-label {");
    assert!(tab.contains("max-width: 132px;"), "{tab}");
    assert!(tab.contains("padding: 0 var(--lt-space-4);"), "{tab}");
    assert!(
        label.contains("padding: var(--lt-space-6) var(--lt-space-14);"),
        "{label}"
    );
    assert!(
        label.contains("overflow: hidden;"),
        "an inactive tab must clip its label: {label}"
    );
    assert!(
        label.contains("mask-image: linear-gradient(to right, var(--lt-mask-opaque) calc(100% - 33px), transparent calc(100% - 15px));"),
        "an inactive tab must fade to the same right inset as its left inset: {label}"
    );
    let name = rule(".file-name-stem {");
    assert!(
        name.contains("flex: 1;") && name.contains("overflow: hidden;"),
        "only a library filename may clip before its badge: {name}"
    );
    let stem = rule(".library-file .file-name-stem {");
    assert!(
        stem.contains("mask-image: linear-gradient(to right, var(--lt-mask-opaque) calc(100% - 18px), transparent);"),
        "a library filename must fade before its badge: {stem}"
    );
    let active = rule(".tab-active .tab-label {");
    assert!(active.contains("max-width: none;"), "{active}");
    assert!(active.contains("mask-image: none;"), "{active}");
}

#[test]
fn both_corner_buttons_sit_above_the_name_they_cover() {
    // The whole label fades under the corner controls.
    let css = reading_mode_css();
    let script = app_shell_script();

    for corner in [".tab-favorite {", ".tab-close {"] {
        let rule = rule_body(css, corner);
        assert!(
            rule.contains("z-index: 1;"),
            "{corner} must outrank the masked label or its click goes to the tab: {rule}"
        );
    }
    let label = rule_body(css, ".tab-label {");
    assert!(
        label.contains("mask-image: linear-gradient(to right,"),
        "{label}"
    );
    // Both corners are answered on the press and the label on the click after it, so a press that lands on either is taken before anything can rewrite the strip under it, and never falls through to switching tabs.
    let press_at = script
        .find("tabBar.addEventListener('pointerdown', (event) => {\n  if (event.button !== 0) return;")
        .expect("the strip answers a press on its corner controls");
    let click_at = script
        .find("tabBar.addEventListener('click', (event) => {")
        .expect("the strip answers a click");
    let close_at = script
        .find("event.target.closest('[data-tab-close]')")
        .expect("the strip answers the close button");
    let mark_at = script
        .find("event.target.closest('[data-tab-favorite]')")
        .expect("the strip answers the heart");
    let label_at = script
        .find("event.target.closest('[data-tab-index]')")
        .expect("the strip answers the label");
    assert!(
        press_at < close_at && close_at < mark_at && mark_at < click_at,
        "both corner arms belong to the press listener"
    );
    assert!(
        click_at < label_at,
        "the label arm belongs to the click listener, so a press that begins a drag never switches tabs"
    );
    // Only the primary button: a click never came from the others, and a right-press on a corner opens the menu.
    assert_contains(
        script,
        "  if (event.button !== 0) return;\n  const close = event.target.closest('[data-tab-close]');",
    );
}

#[test]
fn a_tab_carries_the_heart_and_the_menu_marks_everything_else() {
    let page = app_shell_page();

    // The tab of whatever you are reading, the right-click item for everything that is not open, and the Favorites column on the start screen, where the heart is the mark and the way off the list at once.
    for expected in [
        r#"<button type="button" class="tab-favorite${favorite ? ' is-on' : ''}""#,
        r#"<span class="lt-icon lt-icon-favorite-${favorite ? 'on' : 'off'}"></span>"#,
        "return { action: entry.action, label: 'Unfavorite' };",
        r#"<button type="button" class="home-row-heart" data-home-unfavorite="${attr}""#,
    ] {
        assert_contains(&page, expected);
    }
    // Two menus carry that row, so the one for a file is the one this test is about.
    assert_in(
        &page,
        "const CONTEXT_MENU_ITEMS = [",
        "{ action: 'favorite', label: 'Favorite' },",
    );

    // Not in the pane, where a row really is one button and a second control inside it is not markup.
    assert!(
        !page.contains("library-file-favorite"),
        "a mark in a pane row was turned down: each of those is one button"
    );
}

#[test]
fn marking_from_the_tab_and_from_the_menu_take_the_same_path() {
    let script = app_shell_script();

    // One function, so the heart and the menu item can never disagree about what marking means — and it flips the page's own copy before it tells the host, which is what makes the change instant.
    assert_eq!(script.matches("function toggleFavorite(").count(), 1);
    // The declaration, the tab and trail hearts, the menu item, and the favorite row's heart — which calls it twice, once to unfavorite and once to take that back. Four gestures, one path.
    assert_eq!(script.matches("toggleFavorite(").count(), 6);
    assert_contains(
        script,
        "send({ command: 'toggleFavorite', path, kind: kind || 'document' });",
    );
    assert_contains(
        script,
        "  renderTabs(currentState);\n  send({ command: 'toggleFavorite'",
    );
    // That rewrite destroys the button the press was delivered to, which is why the heart is answered on the press rather than on the click after it: a rewrite landing between a press going down and coming up leaves the browser nothing to resolve a click onto, and no click is dispatched at all.
    let mark_at = script
        .find("const mark = event.target.closest('[data-tab-favorite]');")
        .expect("the strip answers the heart");
    let click_at = script
        .find("tabBar.addEventListener('click', (event) => {")
        .expect("the strip answers a click");
    assert!(
        mark_at < click_at,
        "the heart must be answered before the click listener is even declared"
    );
}

#[test]
fn a_marked_tab_is_the_width_of_an_unmarked_one() {
    let css = reading_mode_css();

    // Out of the label's flow, like the close button in the corner opposite, so a mark costs the tab nothing.
    let mark = rule_body(css, ".tab-favorite {");
    assert!(mark.contains("position: absolute;"));
    assert!(mark.contains("top: 2px;") && mark.contains("left: 2px;"));
    assert!(
        !mark.contains("margin"),
        "an out-of-flow heart has no margin to push the row with: {mark}"
    );
    // Never drawn at rest, and every value of the fade a token: in decelerating, then a hold, then a shorter exit that accelerates. The colors ride behind the opacity leg in both rules; `a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot` holds those.
    //
    // The pointed state is the third way in: the strip is rewritten whole when a mark is made, so the control under a still hand is a new element the pointer has never crossed, and without this the heart a reader just filled fades out under their finger.
    assert!(mark.contains("opacity: 0;"));
    assert_contains(
        &mark.to_string(),
        "transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300),",
    );
    assert_contains(
        css,
        ".tab:hover .tab-favorite,\n.tab:focus-within .tab-favorite,\n.tab.is-pointed .tab-favorite {\n  opacity: 1;\n  transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate),",
    );
    // A mark adds nothing to the tab's own padding, which is even: it is out of flow, and so is the cross in the opposite corner.
    let tab = rule_body(css, ".tab {");
    assert_contains(&tab.to_string(), "padding: 0 var(--lt-space-4);");
}
