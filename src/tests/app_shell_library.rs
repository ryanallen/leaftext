//! The library pane: tree, breadcrumbs, graph view, row context menu.

use super::*;

#[test]
fn a_narrow_window_opens_the_library_as_a_sliding_sheet() {
    let html = app_shell_html();

    for expected in [
        // The button used to do nothing on a narrow window: it cleared the
        // user-closed flag, but libraryTooNarrow() still forced the pane shut.
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
    let sheet = css
        .split(".library-shell.library-narrow .library-pane {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the narrow-window sheet");
    // Out of flow so the grid still gives the page the whole window, parked off
    // the left edge, and animated in rather than appearing.
    for expected in [
        "position: absolute;",
        "width: 100%;",
        "transform: translateX(-100%);",
        "transition: transform 0.22s ease;",
    ] {
        assert_contains(sheet, expected);
    }
    assert_contains(
        css,
        ".library-shell.library-narrow.library-overlay .library-pane {\n  transform: translateX(0);\n}",
    );
    // Under the app bar, or the button that opened it could not close it.
    assert!(
        sheet.contains("z-index: 5;"),
        "the sheet must stay below the app bar: {sheet}"
    );
    assert_contains(css, "@media (prefers-reduced-motion: reduce)");

    // The sheet is "closed" only to the grid, so the rule that hides the path
    // and search box on a snapped-shut pane has to be undone — it opened onto a
    // blank band otherwise.
    assert_contains(
        css,
        ".library-shell.library-narrow .library-header,\n.library-shell.library-narrow .library-crumbs {\n  display: flex;\n}",
    );
    // The page's furniture goes away with the page it belongs to.
    assert_contains(css, "body:has(.library-overlay) .app-bar::after");
    // Tabs by visibility, not display: the fold measures the strip, and a
    // collapsed one reads as "everything fits" and unfolds the whole bar.
    assert_contains(
        css,
        "body:has(.library-overlay) .tab-bar {\n  visibility: hidden;\n}",
    );
}

#[test]
fn app_bar_actions_fold_one_at_a_time_before_a_tab_is_clipped() {
    let html = app_shell_html();

    for expected in [
        // Folding is driven by the tab strip actually overflowing, not a width
        // budget: the old fit reserved a 56px sliver for the tabs and let a
        // title be sliced in half long before anything folded.
        "if (tabBar.scrollWidth <= tabBar.clientWidth + 1) break;",
        "overflowPanel.prepend(el);",
        // Rightmost first, and everything is unfolded before re-measuring so a
        // widening window puts the buttons back where they came from.
        "for (let index = overflowCandidates.length - 1; index >= 0; index -= 1) {",
        r#"<div class="app-overflow-panel" id="appOverflowPanel"></div>"#,
        // The window controls and the lead's history buttons fold too, but only
        // after every action has — which is what their place at the head of the
        // list buys.
        "{ el: document.getElementById('windowControls'), home: appTrailingItems },",
        "{ el: document.getElementById('backButton'), home: historyActions, inLead: true },",
        // Folding out of the lead frees nothing while an open library pins it to
        // the rail's width, so those are skipped rather than hidden for nothing.
        "if (inLead && leadIsPinned) continue;",
        // Restoring rebuilds each container's original order, so a button that
        // folded comes back in its own slot beside siblings that never left.
        "for (const child of children) home.appendChild(child);",
    ] {
        assert_contains(&html, expected);
    }

    // Two never fold. The brand is the way home, and the library button is the
    // only way to reach the library at all on a narrow window — behind a chevron
    // it would be unreachable exactly where the sheet matters most.
    for never_folds in ["homeButton", "libraryOpen"] {
        assert!(
            !html.contains(&format!("{{ el: {never_folds},")),
            "{never_folds} must stay on the bar"
        );
    }

    let css = reading_mode_css();
    assert_contains(css, ".app-trailing.has-overflow .overflow-toggle {");
    assert_contains(css, ".app-trailing.overflow-open .app-overflow-panel {");
    // Stacked inside the panel: it is only as wide as the chevron's corner
    // allows, and the inline three-across row overflowed it, clipping maximize
    // and close off the end.
    let folded_controls = css
        .split(".app-overflow-panel .window-controls {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet folds the window controls");
    assert_contains(folded_controls, "flex-direction: column;");
    // The tab strip's two shoulders have to match: the lead's right inset and
    // the trailing group's left one are what keep a tab from crowding the
    // actions while the first tab sits well clear of the history buttons.
    let lead_inset = css
        .split(".app-bar-lead {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines .app-bar-lead")
        .contains("padding: 0 16px 0 12px;");
    let trailing_inset = css
        .split(".app-trailing {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines .app-trailing")
        .contains("padding-left: 16px;");
    assert!(
        lead_inset && trailing_inset,
        "the tab strip's shoulders must stay symmetric"
    );

    // The panel drops under the chevron, which is the trailing group's left
    // edge — anchoring it right put it out at the window corner instead.
    let panel = css
        .split(".app-overflow-panel {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines .app-overflow-panel");
    assert!(
        panel.contains("left: 0;") && !panel.contains("right: 0;"),
        "the panel must hang off the chevron, not the far corner: {panel}"
    );
    // The all-or-nothing fold is gone, window controls and all.
    assert!(
        !css.contains(".app-trailing.collapsed"),
        "the trailing group no longer folds as one block"
    );
    // The narrow bar must not add its own inset: the lead already carries the
    // 12px that lines the logo up with the library header below it.
    assert!(
        !css.contains("  .app-bar {\n    gap: 8px;\n    padding: 0 12px;\n  }"),
        "the narrow override shifted the whole left group right"
    );
}

#[test]
fn app_shell_wires_library_pane_open_close_and_resize() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Markup: the resize divider on the pane edge and the library toggle button,
    // which lives in the app bar's lead (an .icon-button), left of Back.
    assert!(html.contains(r#"<div id="libraryDivider" class="library-divider" data-i18n-title="library.divider.resize" title="Resize library""#));
    assert!(html.contains(r#"<button type="button" id="libraryOpen" class="icon-button library-open" data-i18n-title="library.open" data-i18n-aria-label="library.open""#));

    // The toggle icon is the bundled asset, normalized to currentColor like the
    // other toolbar icons (no stray literal stroke color survives).
    let open_icon = normalize_svg_icon_colors(OPEN_LIBRARY_ICON_SVG);
    assert!(open_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(open_icon.trim()));

    // CSS: the collapsed-grid override and the divider hit target.
    assert!(css.contains(
        ".library-shell.library-closed {\n  grid-template-columns: 0 minmax(0, 1fr) var(--reader-minimap-column) var(--reader-gutter);\n}"
    ));
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
    assert!(html.contains("LEAF_SETTINGS.libraryWidth"));

    // Snap-shut closes mid-drag; the divider drag is rAF-throttled.
    assert!(html.contains("if (raw < SNAP_SHUT) {"));
    assert!(html.contains("dividerDrag.frame = requestAnimationFrame(applyPendingDividerWidth);"));

    // The toggle flips the pane open/closed; layout applies on boot and on resize.
    assert!(html.contains("libraryOpen.addEventListener('click', toggleLibrary);"));
    assert!(html
        .contains("applyPaneLayout();\nsend({ command: 'getFolder', path: libraryProjectPath });"));
    assert!(html.contains("window.addEventListener('resize', () => {"));
}

#[test]
fn app_shell_includes_library_pane_settings_and_i18n() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Layout: the shell driven by the CSS variable — rail, reader, the minimap's
    // own column (0 until a document has one), and the gutter track that holds
    // the reader off the window frame.
    assert!(html.contains(r#"<div id="libraryShell" class="library-shell">"#));
    assert!(css.contains(
        "grid-template-columns: var(--library-width, 240px) minmax(0, 1fr) var(--reader-minimap-column) var(--reader-gutter);"
    ));
    assert!(html.contains(r#"<aside id="libraryPane" class="library-pane">"#));
    assert!(html.contains(r#"<div id="libraryTree" class="library-tree"></div>"#));
    // No crawl, so nothing to report the progress of and nothing to switch on.
    assert!(!html.contains("libraryScanProgress"));
    assert!(!html.contains("indexingEnabled"));
    assert!(!html.contains("setIndexingEnabled"));
    assert!(!html.contains("settings.indexing.label"));
    assert!(html.contains("command: 'setLibraryState',"));
    // The pane has one job now: the files. The graph moved to the page.
    assert!(!html.contains("const LIBRARY_VIEWS"));
    // Markdown rows carry the leaf mark; folder rows get the enter chevron.
    assert!(html.contains(r#"${LEAF_FILE_ICON}<span class="library-file-label">"#));
    assert!(html.contains(r#"<span class="library-nav-chevron" aria-hidden="true">›</span>"#));

    // Library callbacks, the host-injected settings global it seeds from, and
    // the boot-time render + folder load. The pane is filled by
    // leafSetLibraryFolder now; there is no indexer left to report state.
    assert!(html.contains("window.leafSetLibraryFolder ="));
    assert!(!html.contains("window.leafSetLibraryState ="));
    assert!(!html.contains("window.leafSetScanProgress ="));
    assert!(html.contains("window.leafSetSearchResults ="));
    assert!(html.contains("const LEAF_SETTINGS = (window.__leafSettings"));
    assert!(html.contains("send({ command: 'getFolder', path: libraryProjectPath });"));

    // The search field, its debounced request, and the result-open + jump.
    assert!(html.contains(r#"<input id="librarySearch" class="library-search""#));
    assert!(html.contains(r#"data-i18n-placeholder="library.search.placeholder""#));
    assert!(html.contains("send({ command: 'search', query, scope: librarySearchScopePaths() });"));
    assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

    // File-derived strings are escaped before reaching the DOM (tree + hits).
    assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
    assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

    // i18n keys exist in both dictionaries.
    for key in [
        "library.title",
        "library.view.graph",
        "library.crumbs.label",
        "library.crumbs.enter",
        "library.crumbs.more",
        "library.open",
        "library.divider.resize",
        "library.search.placeholder",
        "library.search.noResults",
        "library.search.count",
        "library.search.loading",
        "library.search.error",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn changing_document_does_not_change_which_view_you_are_in() {
    let html = app_shell_html();

    // Opening a file from the pane while the map is up used to snap back to the
    // reading view, so picking what to look at also picked how. Only the two
    // gestures that mean "leave the map" close it: a node click, and a search
    // hit, whose anchor has nothing to scroll to on a canvas.
    assert!(html.contains("let graphExitPending = false;"));
    let exits = html.matches("graphExitPending = true;").count();
    assert_eq!(
        exits, 2,
        "expected exactly the node click and the search hit to leave the map, found {exits}"
    );
    assert!(html.contains("if (graphExitPending) {"));
    // And nothing else may reach for the door, bar the two states where there
    // is nothing left to map: the home screen, and a library with no vault.
    let closes = html.matches("closeGraphView();").count();
    assert_eq!(closes, 3, "expected the pending exit, the home screen and the leaving-a-vault guard to close the map, found {closes}");
    assert!(html.contains(
        "if (!currentState.document) {
    // No document, no views."
    ));

    // The same rule for source: a document opened while reading source opens in
    // source, decided host-side so the reading view never flashes on the way.
    assert!(html.contains("window.leafSetWorkspace = (state) => {"));
}

#[test]
fn the_map_waits_with_the_same_spinner_a_slow_document_does() {
    let html = app_shell_html();

    // A line of text in the corner reads as a result, not a wait. The overlay is
    // shared with the reader, so it tracks who raised it: a document rendering
    // behind the map must not throw a spinner over it, and must not take down
    // the one the map is waiting on.
    assert!(html.contains("beginReaderLoading('graph');"));
    assert!(html.contains("if (graphViewOpen && !forGraph) return;"));
    assert!(html.contains("if (readerLoadingOwner === 'graph' && owner !== 'graph') return;"));
    // Every way out of a build puts it down; the safety timeout is the backstop.
    assert!(html.matches("clearReaderLoading('graph');").count() >= 6);
    assert!(!html.contains("library.graph.loading"));
}

#[test]
fn the_map_opens_framing_everything_and_then_leaves_the_view_alone() {
    let html = app_shell_html();

    // A view parked at 1:1 on an arbitrary centre cannot answer the first thing
    // a map is asked: how much is there. Two documents sat lost in the middle of
    // an empty field. So it fits, clamped to the zoom limits the wheel obeys.
    assert!(html.contains("function fitGraphToView(scene)"));
    assert!(html.contains("autoFit: true,"));
    assert!(html.contains("if (scene.autoFit) fitGraphToView(scene);"));
    assert!(html.contains("Math.min(availableX / spanX, availableY / spanY)"));
    // Four gestures take the view, and it is not given back: pan, wheel, drag,
    // and a flight to one node.
    let releases = html.matches("scene.autoFit = false;").count();
    assert_eq!(
        releases, 4,
        "expected pan, wheel, drag and focus to end auto-fit, found {releases}"
    );
}

#[test]
fn editing_the_reading_view_is_a_padlock_on_the_document_not_a_global_switch() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // It used to be one checkbox in Settings governing every document you would
    // ever open, which is the wrong shape for the question: whether a page is
    // yours to type into is a fact about that page. Nothing of it is left.
    assert!(!html.contains("readerEditingEnabled"));
    assert!(!html.contains("settings.readerEditing"));
    assert!(!html.contains("setReaderEditingEnabled"));

    // The bar carries it instead, in a recess beside the button that turns the
    // reading view on -- the tools arrive and leave with the view, the way a
    // drawing app's pens only exist in draw mode. The source view is an editor
    // however the padlock is set, and neither tool means anything on a map.
    assert!(html.contains(r#"id="readerViewTools" class="reader-view-tools""#));
    assert!(html.contains(r#"id="readerLockButton" class="reader-subtool""#));
    assert!(html.contains(r#"id="speedReaderButton" class="reader-subtool""#));
    assert!(html.contains("readerViewTools.hidden = !onReadingView;"));
    assert!(html.contains("renderReadingTools(current === 'reading');"));
    // Sunk into the bar and grained like it, rather than laid on top of it.
    assert!(css.contains(".reader-view-tools {"));
    assert!(css.contains("  box-shadow: inset 0 1px 2px"));
    assert!(css.contains(".reader-view-tools[hidden] {"));
    // Never filled: the filled chip is how the bar says which view you are in,
    // and a setting inside a view must not wear the same badge.
    assert!(!html.contains("readerLockButton.classList.toggle('is-active'"));
    assert!(!css.contains(".reader-subtool.is-active"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"] {"));

    // Locked until you say otherwise, and only for the document in front of you.
    assert!(html.contains("const readerUnlockedByPath = new Set();"));
    assert!(html.contains("return !!path && readerUnlockedByPath.has(path);"));
    assert!(html.contains("if (readerEditingAllowed()) {"));
    // Flipping it commits whatever block was mid-edit rather than dropping it.
    assert!(html.contains("function toggleReaderLock()"));
    assert!(html.contains("  commitActiveEditingBlock();\n  if (readerUnlockedByPath.has(path))"));

    // Both glyphs ship, and the pressed state picks which one shows — swapping
    // innerHTML would rebuild the icon under the pointer on every render.
    for icon in [LOCK_CLOSED_ICON_SVG, LOCK_OPEN_ICON_SVG] {
        let icon = normalize_svg_icon_colors(icon);
        assert!(icon.contains("stroke=\"currentColor\""));
        assert!(html.contains(icon.trim()));
    }
    assert!(css.contains(".reader-subtool .reader-glyph-on,"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"] .reader-glyph-off {"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"] .reader-glyph-on {"));
    // The glyph shown is the state you are in, not the one a click would take you
    // to, so pressed (unlocked, or the speed reader running) shows the on glyph.
    assert!(html.contains("setSubtoolState(readerLockButton, unlocked,"));
    assert!(html.contains("setSubtoolState(speedReaderButton, speedReaderEnabled,"));
    assert!(html.contains("button.setAttribute('aria-pressed', String(on));"));

    // The speed reader stays one preference for the whole app -- a way of
    // reading, not a property of a document -- so the bar and the settings row
    // drive the same flag and each shows what the other did.
    for icon in [SPEED_READER_ON_ICON_SVG, SPEED_READER_OFF_ICON_SVG] {
        let icon = normalize_svg_icon_colors(icon);
        assert!(
            icon.contains("stroke=\"currentColor\""),
            "the exporter's black must be normalised"
        );
        assert!(html.contains(icon.trim()));
    }
    assert!(html.contains(
        "if (speedReaderEnabledControl) speedReaderEnabledControl.checked = speedReaderEnabled;"
    ));
    assert!(
        html.contains("send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });")
    );

    for key in [
        "toolbar.lock",
        "toolbar.unlock",
        "toolbar.speedReader",
        "toolbar.readingTools",
    ] {
        let count = html.matches(&format!("'{key}':")).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn the_graph_is_a_page_view_toggled_beside_the_code_view() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // On the page, in the reader's own cell — not in a 240px sidebar where its
    // labels cannot be read and clicking a node answers somewhere you are not
    // looking.
    assert!(html.contains(r#"<div id="readerGraph" class="reader-graph""#));
    assert!(html.contains(r#"id="readerGraphCanvas""#));
    assert!(css.contains(".reader-graph {"));
    assert!(css.contains("grid-column: 2;"));
    // Nothing of it is left in the pane.
    assert!(!html.contains("libraryGraph"));
    assert!(!css.contains(".library-graph"));

    // Toggled from the floating bar under the page, alongside reading and the
    // source: three ways of showing the same thing, so they are one group and
    // exactly one of them is pressed.
    assert!(html.contains(r#"<div id="readerToolbar" class="reader-toolbar" role="toolbar""#));
    assert!(html.contains(r#"id="viewReadingButton" class="reader-tool" data-view="reading""#));
    assert!(html.contains(r#"id="viewCodeButton" class="reader-tool" data-view="code""#));
    assert!(html.contains(r#"id="viewGraphButton" class="reader-tool" data-view="graph""#));
    assert!(
        html.contains("button.addEventListener('click', () => setReaderView(button.dataset.view))")
    );
    assert!(html.contains(
        "const current = graphViewOpen ? 'graph' : codeViewActive ? 'code' : 'reading';"
    ));
    assert!(css.contains(".reader-tool.is-active,"));
    // It floats over the page rather than scrolling with it: placed by the grid
    // in the reader's own cell, not parented to the scroller.
    assert!(css.contains(".reader-toolbar {"));
    assert!(css.contains("  align-self: end;"));
    // Save and undo came down with it, and nothing of the four is left up top.
    assert!(html.contains(r#"id="undoButton" class="reader-tool undo-button""#));
    assert!(html.contains(r#"id="saveButton" class="reader-tool-save""#));
    assert!(!html.contains("graphViewButton"));
    assert!(!html.contains("codeViewButton"));
    assert!(!html.contains(r#"class="save-button""#));
    // With a document open, a view you cannot enter greys out where it stands —
    // those states come and go as you work, and a row that reshuffles under the
    // pointer is worse than one with a dead key.
    assert!(html.contains("button.disabled = !enabled[view] && !on;"));
    assert!(css.contains(".reader-tool:disabled {"));
    // No document, no bar. Three views of one thing needs the thing; on the home
    // screen a toggle would be navigation, which the pane beside it already does.
    assert!(html.contains("readerToolbar.hidden = !hasDocument;"));
    assert!(html.contains("  if (!hasDocument) return;"));

    // One flag for the window, not a mode each tab remembers, and the host is
    // told so a file changing on disk knows whether a map is on screen.
    assert!(html.contains("let graphViewOpen = false;"));
    assert!(html.contains("send({ command: 'setGraphView', open: graphViewOpen });"));
    assert!(!html.contains("LIBRARY_VIEWS"));
    assert!(!html.contains("libraryView"));
    // Going to a document puts the document back.
    assert!(html.contains("function closeGraphView()"));
    assert!(html.contains("closeGraphView();"));

    // PixiJS + d3-force still load lazily from the bundled-asset protocol.
    assert!(html.contains("const PIXI_SCRIPT_URL = '"));
    assert!(html.contains("const D3_FORCE_SCRIPT_URL = '"));
    assert!(html.contains("leaf-asset") && html.contains("pixi.min.js"));
    assert!(html.contains("window.d3.forceSimulation"));
    assert!(html.contains("const PIXI_UNSAFE_EVAL_SCRIPT_URL = '"));
    assert!(!html.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));

    // Data still flows over the same command and callback, and a node still
    // opens its document.
    assert!(html.contains("send({ command: 'getGraph', scope: graphScope, seeds });"));
    assert!(html.contains("window.leafSetGraph ="));
    assert!(html.contains("send({ command: 'openRecent', path: node.path });"));
    assert!(html.contains("function graphSetActive("));

    for key in [
        "library.view.graph",
        "library.view.graph.on",
        "library.view.graph.off",
        "library.graph.empty",
        "library.graph.error",
        "library.graph.needsVault",
        "library.graph.truncated",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn library_follows_and_highlights_the_active_file() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // The active tab's path is what the library highlights as current.
    assert!(html.contains("function activeDocumentPath()"));
    // The selected row carries the marker class the CSS keys off of.
    assert!(html.contains(r#"class="library-file${selected}""#));
    assert!(css.contains(".library-file.is-selected,"));

    // Reveal is the host's call: only it knows the vaults, so going to a file
    // switches to the vault that owns it and opens the folder holding it.
    assert!(html.contains("send({ command: 'revealInLibrary', path: librarySelectedPath });"));
    assert!(html.contains("function revealSelectedInLibrary()"));
    assert!(html.contains("function scrollSelectedLibraryRowIntoView()"));

    // Going to a file (open, switch, click a tab) follows it. Clicking a tab
    // always flies the graph to that node; opening/switching only does so when
    // the doc changed. Clicking the tab you are already on forces a graph
    // rebuild (resync) so a stale scene in memory can't leave the view stuck.
    assert!(html.contains("followFileInLibrary(openedPath,"));
    assert!(html.contains("followFileInLibrary(switchedPath,"));
    assert!(html.contains("followFileInLibrary(tab ? tab.path || null : null, true, wasActive);"));
    assert!(html.contains("const wasActive = index === (currentState && currentState.active);"));
    // Both views follow the document — the graph's scope is the vault, so a
    // file from another one moves it too.
    assert!(html.contains("if (libraryRevealPending) revealSelectedInLibrary();"));
    assert!(!html.contains("if (libraryRevealPending && libraryView !== 'graph'"));
}

#[test]
fn library_breadcrumbs_sit_above_the_search_box() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Its own band, above the search row, with the graph toggle at its right.
    assert!(html.contains(r#"<div class="library-crumbs" id="libraryCrumbs">"#));
    assert!(html.contains(r#"<nav class="library-crumb-trail" id="libraryCrumbTrail""#));
    assert!(html.contains("function renderLibraryCrumbs(chain)"));
    // The trail arrives with the listing; the page never derives it.
    assert!(html.contains("libraryChain = Array.isArray(next.chain) ? next.chain : [];"));

    // Every crumb but the last walks back out to that folder; the last is where
    // you are. A deep path elides its middle rather than overflowing the pane.
    assert!(html.contains("setLibraryFolder(crumb.dataset.crumbPath)"));
    assert!(html.contains(r#"class="library-crumb is-current" aria-current="true""#));
    // How much of the path shows is measured against the band, so widening the
    // pane reveals more crumbs; a resize refits.
    assert!(html.contains("function fitLibraryCrumbs()"));
    assert!(html.contains("libraryCrumbTrail.classList.add('is-measuring')"));
    // Every width change asks for the refit outright — a ResizeObserver alone
    // delivered its first observation in the web view and nothing after, so a
    // divider drag never re-fit the trail.
    assert!(html.contains("document.documentElement.style.setProperty('--library-rail-width', libraryWidth + 'px');\n    // The breadcrumb shows as much of the path as fits, so it refits mid-drag.\n    scheduleCrumbFit();"));
    assert!(html.contains("refitAppBar();\n  // Opening, closing, or re-clamping the pane changes the breadcrumb's room too.\n  scheduleCrumbFit();"));
    assert!(html.contains("window.addEventListener('resize', scheduleCrumbFit);"));
    assert!(html.contains("new ResizeObserver(scheduleCrumbFit)"));
    assert!(css.contains(".library-crumb-trail.is-measuring .library-crumb {"));
    // What didn't fit hides behind a "…" button that opens a menu of those
    // folders; picking one enters it.
    assert!(html.contains("data-crumb-more=\"1\""));
    assert!(html.contains("function showCrumbMenu(button, items)"));
    assert!(html.contains("run: () => setLibraryFolder(segment.path),"));
    assert!(css.contains(".crumb-menu {"));
    // A fit that would draw the same crumbs at the same width leaves the DOM alone,
    // or an indexer push would rebuild the trail under an open "…" menu.
    assert!(html.contains("function crumbFitKey(segments)"));
    assert!(html.contains("if (key === libraryCrumbFitKey) return;"));
    // Entering a folder is the same move as a crumb, so both go through one path.
    assert!(html.contains(
        "button.addEventListener('click', () => setLibraryFolder(button.dataset.navInto));"
    ));
    // A folder that has gone missing falls back to the top level. The host
    // decides that as it reads, so the page never holds a path it cannot show.

    // The two bands share one treatment (the pane's own surface and grain) and
    // the list starts below both.
    assert!(css.contains(".library-crumbs,\n.library-header {"));
    assert!(css.contains("--library-crumbs-height: 28px;"));
    assert!(css.contains("padding-top: var(--library-chrome-height);"));
    assert!(css.contains("top: calc(var(--library-app-bar) + var(--library-crumbs-height));"));

    // The toggle carries the bundled graph mark, normalized to currentColor like
    // every other toolbar icon.
    let graph_icon = normalize_svg_icon_colors(GRAPH_ICON_SVG);
    assert!(graph_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(graph_icon.trim()));
}

#[test]
fn a_vault_row_opens_its_settings_with_the_settings_glyph() {
    let html = app_shell_html();
    // The same sliders the app's own Settings wears — that panel is this vault's
    // settings, so it should not be a second, private symbol for the same idea.
    let icon = normalize_svg_icon_colors(SETTINGS_ICON_SVG);
    assert!(html.contains(&format!("const MENU_SETTINGS_SVG = `{}`;", icon.trim())));
    assert!(html.contains("edit.innerHTML = MENU_SETTINGS_SVG;"));
    // And the placeholder really was filled: a raw `{{...}}` inside the script
    // would be a template literal the page shows as text.
    assert!(!html.contains("{{SETTINGS_ICON_SVG}}"));
}

#[test]
fn the_vault_switcher_is_its_own_button_beside_the_trail() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Its own control, left of the breadcrumb — not the first crumb. A crumb is
    // a place, and clicking a place has to go there.
    assert!(html
        .contains(r#"<button type="button" id="libraryVaultSwitch" class="library-vault-switch""#));
    assert!(html.contains("toggleCrumbMenu(libraryVaultSwitch, vaultMenuItems());"));
    assert!(css.contains(".library-vault-switch {"));
    // It wears the same glyph its menu rows do — one file, stamped in by the
    // host and inlined into the page, so the two cannot drift. A package, not a
    // folder: a vault is a whole collection, and it has to read as different
    // from the plain directories listed below it.
    for icon in [PACKAGE_OPEN_ICON_SVG, PACKAGE_ICON_SVG] {
        let icon = normalize_svg_icon_colors(icon);
        assert!(icon.contains("stroke=\"currentColor\""));
        assert!(html.contains(icon.trim()));
    }
    assert!(html.contains("const PACKAGE_OPEN_ICON_SVG = `"));
    assert!(html.contains("const PACKAGE_ICON_SVG = `"));
    // Open is the vault you are in, closed the ones you are not, so the row
    // says which it is without leaning on the tick alone.
    assert!(
        html.contains("const rootIcon = (on) => (on ? PACKAGE_OPEN_ICON_SVG : PACKAGE_ICON_SVG);")
    );
    assert!(html.contains("icon: rootIcon(vault.id === activeVaultId),"));
    // The pane still lists directories as directories.
    assert!(html.contains("const FOLDER_ICON_SVG = `"));
    assert!(html.contains(r#"<span class="library-crumb-caret" aria-hidden="true">"#));
    // Its label names the root you are in, so hovering says what would change.
    assert!(html.contains("function renderLibraryVaultSwitch()"));
    assert!(html.contains(
        "const label = window.leafLocale.t('library.vaults.switch', { name: libraryRootLabel() });"
    ));

    // The leftmost crumb is a place again: it goes to the root, and nothing in
    // the trail opens a menu.
    assert!(html.contains("[{ path: '', name: libraryRootLabel() }]"));
    assert!(!html.contains("data-crumb-switcher"));
    assert!(!html.contains("library-crumb-switcher"));
    // Its label is the vault's name, or the whole library's.
    assert!(html.contains("function libraryRootLabel()"));
    assert!(html.contains("return (vault && vault.name) || window.leafLocale.t('library.title');"));

    // The menu itself is unchanged: the whole library, every vault, New vault…
    assert!(html.contains("function vaultMenuItems()"));
    assert!(html.contains("selected: !activeVaultId,"));
    assert!(html.contains("selected: vault.id === activeVaultId,"));
    assert!(html.contains("send({ command: 'createVault' })"));
    assert!(html.contains("send({ command: 'setActiveVault', id });"));
    assert!(html.contains("if (id === activeVaultId) {\n    setLibraryFolder('');"));

    // Seeded before the first paint, so nothing flashes the wrong name.
    assert!(html.contains("const LEAF_VAULTS = (window.__leafVaults"));
    assert!(html.contains("window.leafSetVaults ="));

    for key in [
        "library.vaults.label",
        "library.vaults.switch",
        "library.vaults.all",
        "library.vaults.new",
        "library.vaults.new.help",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn each_vault_row_carries_one_button_for_everything_you_can_do_to_it() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // A visible button on the row, not a right-click: rename, re-point and
    // remove all live behind it.
    assert!(html.contains("edit: () => showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault)),"));
    assert!(html.contains(r#"edit.className = 'crumb-menu-edit';"#));
    assert!(css.contains(".crumb-menu-edit {"));
    // Clicking it opens that vault's panel rather than switching to the vault.
    assert!(html.contains("edit.addEventListener('click', (event) => {\n        event.stopPropagation();\n        entry.edit();"));
    // Nothing hangs off a contextmenu handler in the switcher.
    assert!(!html.contains("crumbMenu.addEventListener('contextmenu'"));
    // Only the crumb-trail buttons toggle the menu shut on a second click. A
    // click inside it that swaps the rows must not close it — that is the bug
    // where the pencil looked like it did nothing.
    assert!(html.contains("function toggleCrumbMenu(button, items)"));
    assert!(html.contains("toggleCrumbMenu(libraryVaultSwitch, vaultMenuItems());"));
    assert!(html.contains("toggleCrumbMenu(more, folderMenuItems(hidden));"));
    let show = html
        .split("function showCrumbMenu(button, items) {")
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the shell defines showCrumbMenu");
    assert!(
        !show.contains("hideCrumbMenu();\n    return;"),
        "showCrumbMenu must render, never close and bail: {show}"
    );

    // The panel: the name, the folder, the removal, and a way back to the list.
    assert!(html.contains("function editVaultMenuItems(vault)"));
    assert!(html.contains("send({ command: 'renameVault', id: vault.id, name });"));
    assert!(html.contains("send({ command: 'changeVaultFolder', id: vault.id })"));
    assert!(html.contains("send({ command: 'removeVault', id: vault.id })"));
    assert!(html.contains("showCrumbMenu(crumbMenuOwner, vaultMenuItems())"));
    // The name field commits on Enter or on leaving it, and Escape abandons it.
    assert!(html.contains("field.addEventListener('blur', commit);"));
    assert!(html.contains("} else if (event.key === 'Escape') {"));
    assert!(css.contains(".crumb-menu-input {"));

    for key in [
        "library.vaults.edit",
        "library.vaults.editing",
        "library.vaults.name",
        "library.vaults.changeFolder",
        "library.vaults.remove",
        "library.vaults.remove.help",
        "library.vaults.back",
    ] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn library_row_context_menu_offers_file_actions() {
    let html = app_shell_html();

    // The right-click menu is built from a list of file actions, ordered with
    // the destructive delete flagged and set apart.
    assert!(html.contains("const CONTEXT_MENU_ITEMS = ["));
    for action in [
        "'open'",
        "'cut'",
        "'copy'",
        "'copyPath'",
        "'rename'",
        "'reveal'",
        "'properties'",
        "'delete'",
    ] {
        assert!(html.contains(action), "menu missing action {action}");
    }
    assert!(html.contains("danger: true"));

    // Each action maps to the backend command that carries it out.
    assert!(html.contains("send({ command: 'copyFile', path, cut: true })"));
    assert!(html.contains("send({ command: 'copyFile', path, cut: false })"));
    assert!(html.contains("send({ command: 'copyPath', path })"));
    assert!(html.contains("send({ command: 'showProperties', path })"));
    assert!(html.contains("send({ command: 'deleteFile', path })"));
    assert!(html.contains("send({ command: 'renameFile', path, newName })"));

    // The inline rename box and the new menu labels are present.
    assert!(html.contains("function openRenameBox(path)"));
    assert!(html.contains("'actions.delete': 'Delete'"));
    assert!(html.contains("'actions.delete': '删除'"));
}
