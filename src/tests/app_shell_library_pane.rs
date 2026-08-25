//! The pane: opening, resizing, folding, breadcrumbs, rows and the row menu.

use super::*;

#[test]
fn a_narrow_window_opens_the_library_as_a_sliding_sheet() {
    let html = app_shell_page();

    for expected in [
        // Clearing the user-closed flag is not enough on a narrow window: libraryTooNarrow() still forces the pane shut, so the sheet is what opens.
        "if (libraryTooNarrow()) {\n    librarySheetOpen = !librarySheetOpen;",
        // View state, not a preference — a window opened wide has no sheet.
        "let librarySheetOpen = false;",
        "if (!narrow) librarySheetOpen = false;",
        "libraryShell.classList.toggle('library-overlay', narrow && librarySheetOpen);",
        // Picking a document dismisses it, the way a mobile menu does.
        "closeLibrarySheet();",
    ] {
        assert_contains(&html, expected);
    }

    let css = reading_mode_css();
    let sheet = rule_body(css, ".library-shell.library-narrow .library-pane {");
    // Out of flow so the grid still gives the page the whole window, parked off the left edge, and animated in rather than appearing.
    for expected in [
        "position: absolute;",
        "width: 100%;",
        "transform: translateX(-100%);",
        // The base rule is where the sheet rests and where it goes back to, so the curve here is the way out — every_move_is_drawn_on_the_curve_its_direction_asks_for pins both halves.
        "transition: transform var(--lt-duration-160) var(--lt-ease-accelerate);",
    ] {
        assert_contains(sheet, expected);
    }
    assert_contains(
        css,
        ".library-shell.library-narrow.library-overlay .library-pane {\n  transform: translateX(0);",
    );
    // Under the app bar, or the button that opened it could not close it.
    assert!(
        sheet.contains("z-index: 5;"),
        "the sheet must stay below the app bar: {sheet}"
    );
    // Reduce Motion is answered by the file's one blanket rule now, not by a block of the pane's own — see reduce_motion_is_answered_once_and_won_back_by_name.
    assert!(
        !css.contains(".library-shell.library-narrow .library-pane {\n    transition: none;"),
        "the pane must not keep a reduced-motion block of its own"
    );

    // The sheet is "closed" only to the grid, so the rule that hides the path and search box on a snapped-shut pane has to be undone — it opened onto a blank band otherwise.
    assert_contains(
        css,
        ".library-shell.library-narrow .library-header,\n.library-shell.library-narrow .library-crumbs {\n  display: flex;\n}",
    );
    // The page's furniture goes away with the page it belongs to.
    assert_contains(css, "body:has(.library-overlay) .app-bar::after");
    // Tabs by visibility, not display: the fold measures the strip, and a collapsed one reads as "everything fits" and unfolds the whole bar.
    assert_contains(
        css,
        "body:has(.library-overlay) .tab-bar {\n  visibility: hidden;\n}",
    );
}

#[test]
fn app_bar_actions_fold_one_at_a_time_before_a_tab_is_clipped() {
    let html = app_shell_page();

    for expected in [
        // Folding is driven by the strip or the bar actually overflowing, not a width budget: a budget reserves a sliver for the tabs and lets a title be sliced in half long before anything folds. Both are asked, because an empty strip cannot overflow — and that is the case where the window's own buttons ran off the right edge.
        "if (tabBar.scrollWidth <= tabBar.clientWidth + 1 && appBar.scrollWidth <= appBar.clientWidth + 1) break;",
        // The chevron is a button wide and is drawn only once something has folded, so the pass that raises it measured a bar without it. The bar is pinned to both window edges, so nothing resizes and no observer fires to finish the job — that pass measures again, once.
        "    if (foldAppBar()) foldAppBar();",
        "overflowPanel.prepend(el);",
        // Rightmost first, and everything is unfolded before re-measuring so a widening window puts the buttons back where they came from.
        "for (let index = overflowCandidates.length - 1; index >= 0; index -= 1) {",
        r#"<div class="app-overflow-panel" id="appOverflowPanel"></div>"#,
        // The window controls and the lead's history buttons fold too, but only after every action has — which is what their place at the head of the list buys. Their container is read off the page, never named here: a Mac stands them at the bar's left end, and naming the other one left them stuck in the menu until the app was quit.
        "    home: windowControls && windowControls.parentElement,",
        "{ el: document.getElementById('backButton'), home: historyActions, inLead: true },",
        // Folding out of the lead frees nothing while an open library pins it to the rail's width, so those are skipped rather than hidden for nothing.
        "if (inLead && leadIsPinned) continue;",
        // Restoring rebuilds each container's original order, so a button that folded comes back in its own slot beside siblings that never left.
        "for (const child of children) home.appendChild(child);",
        // Folding order and menu order are separate. Each item has to leave the bar before the next measurement, so they go in rightmost-first; the panel is then laid out in its own order, which puts the window buttons at the foot instead of on top. check-shell reads the resulting order back.
        "  ...overflowCandidates.filter((entry) => entry.el.id === 'windowControls'),",
        "    if (el.parentElement === overflowPanel) overflowPanel.appendChild(el);",
    ] {
        assert_contains(&html, expected);
    }

    // Two never fold. The brand is the way home, and the library button is the only way to reach the library at all on a narrow window — behind a chevron it would be unreachable exactly where the sheet matters most.
    for never_folds in ["homeButton", "libraryOpen"] {
        assert!(
            !html.contains(&format!("{{ el: {never_folds},")),
            "{never_folds} must stay on the bar"
        );
    }

    let css = reading_mode_css();
    assert_contains(css, ".app-trailing.has-overflow .overflow-toggle {");
    assert_contains(css, ".app-trailing.overflow-open .app-overflow-panel {");
    // Staying off the fold list is only half of it: a squeezed zone shrank the button out from under the tab strip instead, so it refuses to give up any of its box.
    let library_open = rule_body(css, ".library-open {");
    assert_contains(library_open, "flex-shrink: 0;");
    // Stacked inside the panel: everything else in the menu is one button per line, and an inline three-across row would make the whole menu three times its own width for one item.
    let folded_controls = rule_body(css, ".app-overflow-panel .window-controls {");
    assert_contains(folded_controls, "flex-direction: column;");
    // The tab strip's two shoulders have to match: both are zero, so each end of the strip is the strip's own gap and a tab comes no closer to the actions than the first one comes to the history buttons.
    let lead_inset =
        rule_body(css, ".app-bar-lead {").contains("padding: 0 0 0 var(--lt-space-12);");
    let trailing_inset = rule_body(css, ".app-trailing {").contains("padding-left: 0;");
    assert!(
        lead_inset && trailing_inset,
        "the tab strip's shoulders must stay symmetric"
    );

    // Nothing folds as one block — the window controls fold like every other item.
    assert!(
        !css.contains(".app-trailing.collapsed"),
        "the trailing group no longer folds as one block"
    );
    // The narrow bar must not add its own inset: the lead already carries the 12px that lines the logo up with the library header below it.
    assert!(
        !css.contains(
            "  .app-bar {\n    gap: var(--lt-space-8);\n    padding: 0 var(--lt-space-12);\n  }"
        ),
        "the narrow override shifted the whole left group right"
    );
}

// Measured from the trailing group's left edge the menu grows off the app: fully folded that edge is the app's last 32px, so 45.3px of menu gets 36.7px of room and the surface's paint containment slices the right border and the right of every icon away. The chevron's right edge grows it inward instead, on either platform whatever inset the group carries.
#[test]
fn the_folded_header_menu_is_drawn_inside_the_apps_own_edge() {
    let css = reading_mode_css();
    let panel = overflow_panel_rule(css);
    assert!(
        !panel.contains("left: 0;"),
        "the menu must not be anchored to the group's left edge: {panel}"
    );
    assert!(
        panel.contains("right: calc(100% - 32px);"),
        "the menu must be measured from the chevron's right edge: {panel}"
    );
}

// That 32px is the chevron's own width written a second time, so it is read back off the component rather than typed here as well: an icon button that changes size fails this instead of quietly dragging the menu off the button it drops from.
#[test]
fn the_folded_header_menu_hangs_off_the_chevrons_own_width() {
    let css = reading_mode_css();
    let icon_button = rule_body(css, ".icon-button {");
    let width = icon_button
        .lines()
        .find_map(|line| line.trim().strip_prefix("width:"))
        .and_then(|value| value.trim().strip_suffix(';'))
        .expect(".icon-button sets its own width")
        .trim();
    let panel = overflow_panel_rule(css);
    assert!(
        panel.contains(&format!("right: calc(100% - {width});")),
        "the menu's right edge must sit one icon button ({width}) in from the group's: {panel}"
    );
}

fn overflow_panel_rule(css: &str) -> &str {
    rule_body(css, ".app-overflow-panel {")
}

#[test]
fn a_shut_pane_leaves_the_bars_left_zone_sized_by_its_own_buttons() {
    let css = reading_mode_css();

    let lead = rule_body(css, ".app-bar-lead {");
    // Open, the zone still follows the rail so the tabs begin at the pane's edge.
    assert_contains(lead, "width: var(--library-rail-width, 240px);");
    // Shut, it sizes from content instead. The keyword is the floor only until the front end has measured the zone and written that number over it: a Mac reads `fit-content` as no floor at all and squeezes the library button out under the tab strip, and the button is the only way back to the pane.
    assert_contains(lead, "min-width: fit-content;");
    assert_contains(
        css,
        ".app-bar:not(.has-rail) .app-bar-lead {\n  width: auto;\n}",
    );

    // The close's motion is untouched: the rail still goes to zero, and the zone's three legs still animate its width, so the flip to auto rides in behind them with the closed class.
    let html = app_shell_page();
    assert_contains(
        &html,
        "document.documentElement.style.setProperty('--library-rail-width', '0px');",
    );
    for leg in [
        "body.is-library-opening .app-bar-lead {",
        "body.is-library-closing .app-bar-lead {",
        "body.is-library-settling .app-bar-lead {",
    ] {
        assert_contains(css, leg);
    }
}

#[test]
fn app_shell_wires_library_pane_open_close_and_resize() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Markup: the resize divider on the pane edge and the library toggle button, which lives in the app bar's lead (an .icon-button), left of Back.
    assert!(
        html.contains(r#"<div id="libraryDivider" class="library-divider" title="Resize library""#)
    );
    assert!(html.contains(r#"<button type="button" id="libraryOpen" class="icon-button library-open" title="Toggle library""#));

    // The toggle icon is the bundled asset, normalized to currentColor like the other toolbar icons (no stray literal stroke color survives).
    assert_icon(&html, "open-library");

    // One rule for open and closed: the first track reads the rail var, which applyPaneLayout writes as 0px when closed, so the toggle's transition can interpolate between them.
    assert!(!css.contains(".library-shell.library-closed {\n  grid-template-columns:"));
    assert!(css.contains(".library-divider {"));
    assert!(css.contains("cursor: col-resize;"));
    assert!(css.contains(".library-open:hover {"));

    // Behavior constants and the host-persisted layout report.
    assert!(html.contains("const SNAP_SHUT = 40;"));
    assert!(html.contains("const DEFAULT_PANE_WIDTH = 240;"));
    assert!(html.contains("const MIN_READER_WIDTH = 360;"));
    assert!(html.contains("send({ command: 'setLibraryLayout', closed: libraryUserClosed, width: Math.round(libraryWidth) });"));

    // State seeded from the host-injected settings, not localStorage.
    assert!(html.contains("let libraryUserClosed = LEAF_SETTINGS.libraryClosed === true;"));
    assert!(html.contains(
        "let libraryWidth = Number.isFinite(LEAF_SETTINGS.libraryWidth) && LEAF_SETTINGS.libraryWidth > 0"
    ));

    // Snap-shut closes mid-drag; the divider drag is rAF-throttled.
    assert!(html.contains("if (raw < SNAP_SHUT) {"));
    assert!(html.contains("dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);"));

    // A pane opens no narrower than the bar's left zone, and that zone is measured rather than written down a second time: it is sized to the pane, so its own width is only readable with the pane's out of it for the one read.
    assert_contains(
        &html,
        "function openPaneFloor(width) {\n  return Math.max(width, appBarLeadWidth());\n}",
    );
    // The zone's own floor comes off for that read beside the pane's pin: with a pixel floor standing, a zone that had just lost a button would measure its own stale floor and never come back down.
    assert_contains(&html, "  appBarLead.style.width = 'auto';\n  appBarLead.style.minWidth = '0px';\n  appBarLeadOwnWidth = appBarLead.getBoundingClientRect().width;\n  appBarLead.style.width = pinned;\n  appBarLead.style.minWidth = floored;");
    // And that measurement is written back as the zone's own floor, because `fit-content` is the one thing in the stylesheet's rule that is not a value — a Mac reads it as no floor at all and draws the tab strip over the leaf, the library button and both arrows.
    assert_contains(
        &html,
        "  if (width) appBarLead.style.minWidth = `${width}px`;",
    );
    // Rewritten wherever the measurement behind it is thrown away, so a fold takes the floor down with the buttons and an unfold brings it back — behind the pane-motion guard, since the read itself is what stops the zone traveling.
    assert_contains(
        &html,
        "      forgetAppBarLeadWidth();\n      floorAppBarLead();",
    );
    // Both paths a pane opens through: the width it comes back at, and the width the toggle opens it at.
    assert_contains(
        &html,
        "if (libraryWidth === DEFAULT_PANE_WIDTH) libraryWidth = openPaneFloor(libraryWidth);",
    );
    assert_contains(&html, "libraryWidth = openPaneFloor(DEFAULT_PANE_WIDTH);");
    // And nowhere else: flooring the drag at that zone takes every narrow pane away from a platform that never had the fault, so the drag reads the plain clamp and the snap is the snap.
    assert_contains(&html, "dividerDrag.pendingWidth = clampOpenPaneWidth(raw);");
    assert!(!html.contains("openPaneFloor(raw)"));

    // The toggle flips the pane open/closed; layout applies on boot and on resize.
    assert!(html.contains("libraryOpen.addEventListener('click', toggleLibrary);"));
    assert!(html
        .contains("applyPaneLayout();\nsend({ command: 'getFolder', path: libraryProjectPath });"));
    // Several fragments watch a resize, so the pane's own is named by the frame it throttles itself to.
    assert!(html.contains(
        "window.addEventListener('resize', () => {
  if (paneResizeFrame) return;"
    ));
}

#[test]
fn the_normal_width_toggle_moves_the_pane_bar_and_page_together() {
    let html = app_shell_page();

    // Opening is two steps: the open classes land with the rail at the reader's padding — the closed card's resting edge, so the first frame draws the same pixels — then the flushed width write eases everything out together.
    assert_contains(
        &html,
        "document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');\n    applyPaneLayout(true);\n    void libraryShell.offsetWidth;\n    startLibraryMotion('is-library-opening', null);\n    applyPaneLayout();",
    );
    assert_contains(&html, "function applyPaneLayout(holdRail) {");
    // Closing slams to the reader's padding — the motion's floor; the pane must never pass it to touch the window edge — and the closed class plus the bar's no-rail state land through the deferred layout pass when the whole run ends, drawing the same pixels the seat already shows.
    assert_contains(
        &html,
        "startLibraryMotion('is-library-closing', applyPaneLayout);\n    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');",
    );
    // The floor is the stylesheet's own gutter token, read where it is spent.
    assert_contains(&html, "function readerGutterPx() {");
    // Every motion class always comes off, and whatever the close deferred always runs. The three are named once, where both the fragment that stands them up and the fragment that reads them can spend the same list.
    assert_contains(
        &html,
        "const LIBRARY_MOTION_CLASSES = ['is-library-opening', 'is-library-closing', 'is-library-settling'];",
    );
    assert_contains(
        &html,
        "document.body.classList.remove(...LIBRARY_MOTION_CLASSES);",
    );
    // transitionend bubbles, so only the shell's own track may advance the motion — the lead's width ending must not cut the grid off mid-move.
    assert_contains(&html, "if (event.target !== libraryShell || event.propertyName !== 'grid-template-columns') return;");
    // The close chains three legs — slam to the padding, bounce off it once, seat back on it — because one curve can cross its target once but cannot come back out of it; the open overshoots in a single leg on its own curve.
    assert_contains(&html, "const LIBRARY_BOUNCE_PX = 16;");
    assert_contains(
        &html,
        "libraryMotionStage = direction === 'is-library-closing' ? 'slam' : '';",
    );
    assert_contains(&html, "  if (libraryMotionStage === 'slam') {");
    assert_contains(&html, "    document.body.classList.remove('is-library-closing');\n    document.body.classList.add('is-library-settling');\n    document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + LIBRARY_BOUNCE_PX + 'px');");
    assert_contains(&html, "  if (libraryMotionStage === 'bounce') {");
    assert_contains(&html, "document.documentElement.style.setProperty('--library-rail-width', readerGutterPx() + 'px');\n    return;");
    // Reduce Motion runs every leg at zero duration and zero-duration transitions never fire transitionend, so a timeout behind the whole run lands the final classes — through the same full layout pass, so ending mid-bounce still seats everything.
    assert_contains(&html, "const LIBRARY_MOTION_FALLBACK_MS = 600;");
    assert_contains(
        &html,
        "libraryMotionTimer = window.setTimeout(endLibraryMotion, LIBRARY_MOTION_FALLBACK_MS);",
    );
    // A re-toggle mid-move settles the old state first, so the new transition retargets from wherever the rail visually is.
    assert_contains(
        &html,
        "function startLibraryMotion(direction, done) {\n  // Settle any motion still running, so a re-toggle retargets from where the rail is. Told it is arming another, so it leaves the zone unmeasured.\n  endLibraryMotion(true);",
    );
    // The minimap's width write reacts to the reader resizing one frame in; mid-toggle it would change a grid column and retarget the pane's transition, so it is dropped and the motion's own end asks again. Re-arming it here instead drew a frame for every frame of the gesture.
    assert_contains(&html, "if (libraryPaneIsMoving()) return;");
    assert!(
        !html.contains("      scheduleMinimapWidthSync();\n      return;"),
        "the rail's width must wait to be told, not ask every frame"
    );
    // And the one place the motion classes come off is the one place that tells it.
    let ending = html
        .split("function endLibraryMotion(restarting) {")
        .nth(1)
        .expect("the front-end ends a library motion");
    assert!(
        ending[..ending.find("\n}\n").expect("that function closes")]
            .contains("scheduleMinimapWidthSync();"),
        "the pane finishing its motion must ask for the rail width it held back"
    );
    // The bar's left zone is measured by putting `width: auto` on it for a layout pass, and a width transition cannot start from `auto` — so a refit landing inside the open left the tab strip standing at its resting place while the page overshot past it. The refit holds the pair back while a motion class is up, and this is the one other place that takes it, beside the rail width and for the same reason.
    assert!(
        ending[..ending.find("\n}\n").expect("that function closes")].contains(
            "if (!restarting) {\n    forgetAppBarLeadWidth();\n    floorAppBarLead();\n  }"
        ),
        "the pane finishing its motion must take the zone measurement it held back"
    );
    // And the settle that arms the next motion must not: that read lands between the flush and the class going up, snapping the strip left on the open's first frame and killing the close's travel outright.
    assert_eq!(
        html.matches("endLibraryMotion(true);").count(),
        1,
        "only the settle inside startLibraryMotion may skip the zone measurement"
    );
    assert_contains(
        &html,
        "if (!libraryPaneIsMoving()) {\n      forgetAppBarLeadWidth();\n      floorAppBarLead();\n    }",
    );
    assert_eq!(
        html.matches("floorAppBarLead()").count(),
        3,
        "the definition, the refit's guarded call and the motion's end are the only mentions"
    );
    // Only the toggle's two branches start a motion: the divider drag and the resize re-clamp write the rail with no motion class up, so they stay immediate.
    assert_eq!(
        html.matches("startLibraryMotion(").count(),
        3,
        "the toggle's two branches and the definition are the only mentions"
    );
    // Never a registered rail property: animating a registered inherited length off :root crashed the whole app in this web view (library-sidebar-motion, phase 0).
    assert!(!html.contains("registerProperty"));
}

#[test]
fn app_shell_includes_library_pane_settings_and_wording() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Layout: the shell driven by the CSS variable — rail, reader, the minimap's own column (0 until a document has one), and the gutter track that holds the reader off the window frame.
    assert!(html.contains(r#"<div id="libraryShell" class="library-shell">"#));
    assert!(css.contains(
        "grid-template-columns: var(--library-rail-width, 240px) minmax(0, 1fr) var(--reader-minimap-column) var(--reader-gutter);"
    ));
    assert!(html.contains(r#"<aside id="libraryPane" class="library-pane">"#));
    assert!(html.contains(r#"<div id="libraryTree" class="library-tree"></div>"#));
    // No crawl, so nothing to report the progress of and nothing to switch on.
    assert!(!html.contains("libraryScanProgress"));
    assert!(!html.contains("indexingEnabled"));
    assert!(!html.contains("setIndexingEnabled"));
    assert!(!html.contains("settings.indexing.label"));
    assert!(html.contains("command: 'setLibraryState',"));
    // The pane has one job: the files. The graph lives on the page.
    assert!(!html.contains("const LIBRARY_VIEWS"));
    // Markdown rows carry the leaf mark; folder rows get the enter chevron.
    assert!(html.contains(r#"${LEAF_FILE_ICON}<span class="library-file-label">"#));
    assert!(html.contains(r#"<span class="library-nav-chevron" aria-hidden="true">›</span>"#));

    // Library callbacks, the host-injected settings global it seeds from, and the boot-time render + folder load. The pane is filled by leafSetLibraryFolder, and nothing reports scan state.
    assert!(html.contains("window.leafSetLibraryFolder ="));
    assert!(!html.contains("window.leafSetLibraryState ="));
    assert!(!html.contains("window.leafSetScanProgress ="));
    assert!(html.contains("window.leafSetSearchResults ="));
    assert!(html.contains("const LEAF_SETTINGS = (window.__leafSettings"));
    // Several places ask for a folder; the boot's is the one paired with the first paint.
    assert!(html
        .contains("applyPaneLayout();\nsend({ command: 'getFolder', path: libraryProjectPath });"));

    // The search field, its debounced request, and the result-open + jump.
    assert!(html.contains(r#"<input id="librarySearch" class="library-search""#));
    assert!(html.contains(r#"placeholder="Search files...""#));
    assert!(html.contains(r#"<button type="button" id="librarySearchClear" class="library-search-clear" aria-label="Clear search" title="Clear search" hidden>"#));
    assert!(html.contains("librarySearchClear.addEventListener('click', clearLibrarySearch);"));
    assert!(css.contains(".library-search-clear {"));
    assert!(html.contains("send({ command: 'search', query, today: localDateStamp() });"));
    // The line under the box: what the filter was read as, and any field name the vault has never set.
    assert!(html.contains(r#"<p class="library-search-note">"#));
    assert!(html.contains(r#"<span class="library-search-unknown">"#));
    assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

    // File-derived strings are escaped before reaching the DOM (tree + hits).
    assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
    assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

    // Every string the pane shows is present, so none of it renders blank. The vault menu carries that word too, so the pane's own label is named where it is decided.
    assert_in(&html, "function libraryRootLabel() {", "'Library'");
    for wording in [
        "aria-label=\"Folder path\"",
        "`Open ${segment.name}`",
        "`Skipped folders: ${names.join(' › ')}`",
        "title=\"Resize library\"",
        "placeholder=\"Search files...\"",
        ">No matches.</p>",
        // A cut list says what it was cut to — files, since one file can hold three rows — rather than printing a count that reads like a whole one. Both counts say "so far" while the vault is still being read: the cap is over what has been read, not over the vault. Both also carry what the walk never went into.
        "results in the first ${formatCount(files)} files${read}${skippedClause()}`",
        "} results${librarySearchPartial ? ' so far' : ''}${skippedClause()}`",
        "} ${folders} of generated files not read`",
        "' read so far'",
        "Searching…",
        "'Search failed.'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn a_search_row_lands_on_the_match_not_the_heading_above_it() {
    let html = app_shell_page();

    // The row carries the line the match is on, and the jump uses it: without it a hit near the foot of a long section opens at the top of that section.
    for expected in [
        r#"data-line="${escapeAttr(String(line))}""#,
        "pendingSearchJump = anchor || line ? { path, anchor, line } : null;",
        "scrollReadingToSrcOffset(byteOffsetAtLineIndex(currentDocumentSource, jump.line - 1));",
        // The heading is still there for a document whose source the page does not hold — only Markdown carries the block ranges the offset needs.
        "if (!landed && jump.anchor && activeDocumentPath() === jump.path) {",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn library_follows_and_highlights_the_active_file() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The active tab's path is what the library highlights as current.
    assert!(html.contains("function activeDocumentPath()"));
    // The selected row carries the marker class the CSS keys off of.
    assert!(html.contains(r#"class="library-file${selected}""#));
    assert!(css.contains(".library-file.is-selected,"));

    // Reveal is the host's call: only it knows the vaults, so going to a file switches to the vault that owns it and opens the folder holding it.
    assert!(html.contains("send({ command: 'revealInLibrary', path: librarySelectedPath });"));
    assert!(html.contains("function revealSelectedInLibrary()"));
    assert!(html.contains("function scrollSelectedLibraryRowIntoView()"));

    // Going to a file (open, switch, click a tab) follows it. Clicking a tab always flies the graph to that node; opening/switching only does so when the doc changed. Clicking the tab you are already on forces a graph rebuild (resync) so a stale scene in memory can't leave the view stuck.
    assert!(html.contains("followFileInLibrary(openedPath,"));
    assert!(html.contains("followFileInLibrary(switchedPath,"));
    assert!(html.contains("followFileInLibrary(tab ? tab.path || null : null, true, wasActive);"));
    assert!(html.contains("const wasActive = index === (currentState && currentState.active);"));
    // Both views follow the document — the graph's scope is the vault, so a file from another one moves it too.
    assert!(html.contains("if (libraryRevealPending) revealSelectedInLibrary();"));
    assert!(!html.contains("if (libraryRevealPending && libraryView !== 'graph'"));
}

#[test]
fn library_breadcrumbs_sit_above_the_search_box() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Its own band, above the search row, with the graph toggle at its right.
    assert!(html.contains(r#"<div class="library-crumbs" id="libraryCrumbs">"#));
    assert!(html.contains(r#"<nav class="library-crumb-trail" id="libraryCrumbTrail""#));
    assert!(html.contains("function renderLibraryCrumbs(chain)"));
    // The trail arrives with the listing; the page never derives it.
    assert!(html.contains("libraryChain = Array.isArray(next.chain) ? next.chain : [];"));

    // Every crumb but the last walks back out to that folder; the last is where you are. A deep path elides its middle rather than overflowing the pane.
    assert!(html.contains("setLibraryFolder(crumb.dataset.crumbPath)"));
    assert!(html.contains(r#"class="library-crumb is-current" aria-current="true""#));
    // How much of the path shows is measured against the band, so widening the pane reveals more crumbs; a resize refits.
    assert!(html.contains("function fitLibraryCrumbs()"));
    assert!(html.contains("libraryCrumbTrail.classList.add('is-measuring')"));
    // Every width change asks for the refit outright — a ResizeObserver alone delivers its first observation in the web view and nothing after, so a divider drag never re-fits the trail.
    assert!(html.contains("document.documentElement.style.setProperty('--library-rail-width', libraryWidth + 'px');\n    // The breadcrumb shows as much of the path as fits, so it refits mid-drag.\n    scheduleCrumbFit();"));
    assert!(html.contains("refitAppBar();\n  // Opening, closing, or re-clamping the pane changes the breadcrumb's room too.\n  scheduleCrumbFit();"));
    assert!(html.contains("window.addEventListener('resize', scheduleCrumbFit);"));
    assert!(html.contains("new ResizeObserver(scheduleCrumbFit)"));
    assert!(css.contains(".library-crumb-trail.is-measuring .library-crumb {"));
    // What didn't fit hides behind a "…" button that opens a menu of those folders; picking one enters it.
    assert!(html.contains("data-crumb-more=\"1\""));
    assert!(html.contains("function showCrumbMenu(button, items)"));
    assert!(html.contains("run: () => setLibraryFolder(segment.path),"));
    assert!(css.contains(".crumb-menu {"));
    // A fit that would draw the same crumbs at the same width leaves the DOM alone, or a watcher tick would rebuild the trail under an open "…" menu.
    assert!(html.contains("function crumbFitKey(segments)"));
    assert!(html.contains("if (key === libraryCrumbFitKey) return;"));
    // Entering a folder and opening a file both act on the mouse's press — a watcher rebuild between press and release replaces the button and swallows the click — while keyboard, touch and pen keep the click path. One helper serves both: the two kinds of row sit in one rebuilt list, and a file row left on the click while its neighbors moved to the press is exactly how this came back.
    assert!(html
        .contains("libraryTree.querySelectorAll('[data-open-path]').forEach(bindLibraryFileRow);"));
    assert!(html
        .contains("libraryTree.querySelectorAll('[data-nav-into]').forEach(bindFolderEntryRow);"));
    assert!(html.contains("function bindLibraryRowPress(button, act) {"));
    assert!(html.contains("if (event.pointerType !== 'mouse' || event.button !== 0) return;"));
    assert!(html.contains("button.leafPressEntered = true;\n    act();"));
    // The click that completes a press the helper already handled is the only one suppressed; a stable row must not act twice and a keyboard click must never be ignored.
    assert!(html.contains("if (button.leafPressEntered) {\n      button.leafPressEntered = false;\n      return;\n    }\n    act();"));
    assert!(html
        .contains("bindLibraryRowPress(button, () => setLibraryFolder(button.dataset.navInto));"));
    assert!(html.contains("send({ command: 'openRecent', path: button.dataset.openPath });"));
    // And a read describing what is already drawn leaves those rows standing, so an unchanged re-read cannot take one out from under a press in the first place.
    assert!(html.contains("if (html === libraryTreeHtml) return false;"));
    // A folder that has gone missing falls back to the top level. The host decides that as it reads, so the page never holds a path it cannot show.

    // The two bands share one treatment (the pane's own surface and grain) and the list starts below both.
    assert!(css.contains(".library-crumbs,\n.library-header {"));
    assert!(css.contains("--library-crumbs-height: 28px;"));
    assert!(css.contains("padding-top: var(--library-chrome-height);"));
    assert!(css.contains("top: calc(var(--library-app-bar) + var(--library-crumbs-height));"));

    assert_icon(&html, "graph");
    // Active, it swaps to the bolder drawing rather than thickening a stroke a mask does not have.
    assert!(reading_mode_css().contains("--lt-icon-graph-heavy:"));
}

#[test]
fn library_row_context_menu_offers_file_actions() {
    let html = app_shell_page();

    // The right-click menu is built from a list of file actions, ordered with the destructive delete flagged and set apart.
    assert!(html.contains("const CONTEXT_MENU_ITEMS = ["));
    // The whole row, inside that one list: a bare `'open'` is all over the page and holds nothing, and some of these rows are in a second menu as well.
    for row in [
        "{ action: 'open', label: 'Open' },",
        "{ action: 'cut', label: 'Cut' },",
        "{ action: 'copy', label: 'Copy' },",
        "{ action: 'copyPath', label: 'Copy path' },",
        "{ action: 'rename', label: 'Rename' },",
        "{ action: 'reveal', label: 'Reveal file' },",
        "{ action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },",
        "{ action: 'delete', label: 'Delete', danger: true },",
    ] {
        assert_in(&html, "const CONTEXT_MENU_ITEMS = [", row);
    }

    // Each action maps to the backend command that carries it out.
    assert!(html.contains("send({ command: 'copyFile', path, cut: true })"));
    assert!(html.contains("send({ command: 'copyFile', path, cut: false })"));
    assert!(html.contains("send({ command: 'copyPath', path })"));
    assert!(html.contains("send({ command: 'showProperties', path })"));
    // Delete is the one item that does not send when it is picked: it asks first, and the command is what the answer runs.
    assert!(html.contains("() => send({ command: 'deleteFile', path })"));
    assert!(html.contains("send({ command: 'renameFile', path, newName })"));

    // The inline rename box and the new menu labels are present.
    assert!(html.contains("function openRenameBox(path, anchor)"));
}

#[test]
fn a_mouse_press_never_leaves_a_focus_ring_behind() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // One helper, and it is the only way focus is handed about: a menu closing gives it back to whatever opened it, and a menu opening puts it on the first row — both for the keyboard only. Handed about any other way, clicking the switcher and picking a vault leaves a ring on the button.
    assert!(html.contains("function leafFocusForKeyboard(target) {"));
    assert!(html.contains("if (!leafKeyboardDriving || !target || !target.isConnected || !target.focus) return false;"));
    assert!(html.contains(
        "window.addEventListener('pointerdown', () => { leafKeyboardDriving = false; document.documentElement.dataset.pointerDriving = 'true'; }, true);"
    ));

    // Nothing that closes or opens a floating thing may call focus directly, or the rule is one site from being wrong again.
    for site in [
        "crumbMenuOwner.focus()",
        "firstFocusable.focus()",
        "first.focus()",
        "glossarySheetClose.focus()",
        "glossaryLastFocus.focus()",
        "flowLastFocus.focus()",
    ] {
        assert!(
            !html.contains(site),
            "{site} must go through leafFocusForKeyboard"
        );
    }

    // And the ring itself is the keyboard's too. The engine is what decides who earns a `:focus-visible`, and it counts a clicked dropdown as keyboard-driven, so the same two listeners write the answer on the root and one rule beside the ring rule reads it back.
    assert!(css.contains("button:focus-visible,"));
    assert!(
        css.contains(":root[data-pointer-driving=\"true\"] :is("),
        "nothing puts the ring out while the mouse is driving, so a click on the map view's size box lights it up again"
    );
}

#[test]
fn the_whole_library_wears_the_machine_it_reads() {
    let html = app_shell_page();

    // The first row of the switcher is not a vault: it is everything on this machine, drive roots and all, so a box was the one wrong shape for it.
    assert_icon(&html, "computer");
    assert!(html.contains("if (!id) return COMPUTER_ICON_SVG;"));
    // And it is what the button carries before anything has been switched to.
    assert!(html.contains(
        r#"id="libraryVaultSwitch" class="library-vault-switch" aria-haspopup="menu" aria-expanded="false" title="Vaults" aria-label="Vaults"><span class="library-crumb-caret" aria-hidden="true">▾</span><span class="lt-icon lt-icon-computer"></span>"#
    ));
}

#[test]
fn deleting_a_file_asks_before_it_goes() {
    // Delete asks before it sends, and the question is in the page before anything can need it: sending on the pick means one click on the wrong row empties it out of the folder with nothing asked.
    let html = app_shell_page();

    // The frame is in the boot HTML, and it starts hidden.
    assert!(html.contains(r#"<div id="confirmDialog" class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-describedby="confirmDialogDetail" hidden>"#));
    assert!(html.contains(r#"<div id="confirmBackdrop" class="lt-backdrop" hidden></div>"#));

    // Cancel is where the pointer lands and Delete is the red one, in that order.
    let cancel = html.find("confirmDialogCancel").expect("a cancel button");
    let accept = html.find("confirmDialogAccept").expect("an accept button");
    assert!(cancel < accept, "Cancel comes before Delete");
    assert!(html.contains(r#"class="confirm-dialog-button is-danger">Delete<"#));

    // It names the file and says where the file goes, which is what makes it a question rather than a formality.
    assert!(html.contains("`Delete “${fileBaseName(path)}”?`"));
    assert!(html.contains("'It goes to the Recycle Bin, so you can put it back.'"));
    assert!(html.contains("'It goes to the Trash, so you can put it back.'"));

    // Escape and a click on the scrim cancel; Enter answers yes unless Cancel holds the focus.
    assert!(html.contains("leafOnEscape(closeConfirm, window);"));
    assert!(html.contains("confirmBackdrop.addEventListener('click', closeConfirm);"));
    assert!(html.contains("if (document.activeElement === confirmDialogCancel) return;"));

    // Focus lands on the destructive button and goes back where it came from.
    assert!(html.contains("leafFocusForKeyboard(confirmDialogAccept);"));
    assert!(html.contains("leafFocusForKeyboard(confirmReturnFocus);"));
}

#[test]
fn canceling_a_delete_sends_nothing_and_the_item_sends_one_command() {
    // Two failures worth pinning: an answer of no that deletes anyway, and a question whose yes fires twice.
    let html = app_shell_page();

    // Cancel closes and nothing else — the command lives on the accept path alone.
    assert!(html.contains("confirmDialogCancel.addEventListener('click', closeConfirm);"));
    assert!(html.contains("confirmDialogAccept.addEventListener('click', acceptConfirm);"));

    // The pending action is cleared before it runs, so a second yes has nothing left to fire.
    assert!(html.contains("function acceptConfirm() {\n  const action = confirmAction;\n  closeConfirm();\n  if (action) action();\n}"));
    assert!(html.contains("  confirmAction = null;\n  leafFocusForKeyboard(confirmReturnFocus);"));

    // Exactly one place in the page sends the delete.
    assert_eq!(
        html.matches("command: 'deleteFile'").count(),
        1,
        "the delete is sent from one place"
    );
}

#[test]
fn a_delete_can_be_taken_back_while_its_message_is_up() {
    // The offer and the message are the same thing: a delete that says nothing at all leaves no moment in which to change your mind.
    let html = app_shell_page();

    // The host arms it, not the asking — so a build with nothing behind the delete never draws an offer it could not keep.
    assert!(html.contains("window.leafFileDeleted = (path, name) => {"));
    assert!(html.contains("undoableDelete = path;"));
    assert!(html.contains("leafToast(`Deleted ${name}`, 'ok', {"));
    assert!(html.contains("label: 'Undo',"));

    // The offer expires with the message rather than on a timer of its own.
    assert!(html.contains("gone: () => { undoableDelete = null; },"));
    assert!(html.contains("toastGone = action.gone || null;"));

    // One delete is undone once: the state is cleared before the command goes out, so a second press and a Ctrl+Z chasing the same message cannot both spend it.
    assert!(html.contains("function undoLastDelete() {\n  const path = undoableDelete;\n  if (!path) return;\n  undoableDelete = null;\n  send({ command: 'undoDelete', path });\n}"));

    // The button is the first pressable thing a toast has ever carried.
    assert!(html.contains("button.className = 'app-toast-action';"));
}

#[test]
fn ctrl_z_undoes_the_delete_only_when_nothing_is_being_typed() {
    // Three claims on one key, in a fixed order: whatever is being typed in wins it, then the delete, then the reading view's own edit. Get the order wrong and the key either does nothing or undoes the wrong thing.
    let script = app_shell_script();

    // Measured from the handler onward: the same early return guards the Undo button higher up the file, and the first match is that one.
    let handler = script
        .find("  if (nativeUndoOwnsKey(event.target)) return;")
        .expect("the editor's claim on the key");
    let rest = &script[handler..];
    let delete = rest
        .find("  if (undoableDelete) {")
        .expect("the delete's claim");
    let document_edit = rest
        .find("  if (!path || undoableByPath.get(path) !== true) return;")
        .expect("the reading view's early return");

    assert!(delete > 0, "typing takes the key before the delete");
    assert!(
        delete < document_edit,
        "the delete is checked ahead of the return that ends the keystroke unless the open document has an edit of its own"
    );

    // And it is the delete that runs, not a second copy of the command.
    assert!(script.contains("    undoLastDelete();\n    return;"));
    assert_eq!(
        script.matches("command: 'undoDelete'").count(),
        1,
        "the undo is sent from one place"
    );
}
