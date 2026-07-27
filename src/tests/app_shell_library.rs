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
    assert!(html.contains(r#"id="libraryScanProgress""#));

    // Settings toggle + host-persisted change reporting.
    assert!(html.contains(r#"<input type="checkbox" id="indexingEnabled""#));
    assert!(html.contains("send({ command: 'setIndexingEnabled', enabled: indexingEnabled });"));
    assert!(html.contains("command: 'setLibraryState',"));
    // Two states only: the Project file list and the Graph.
    assert!(html.contains("const LIBRARY_VIEWS = ['project', 'graph'];"));
    // Markdown rows carry the leaf mark; folder rows get the enter chevron.
    assert!(html.contains(r#"${LEAF_FILE_ICON}<span class="library-file-label">"#));
    assert!(html.contains(r#"<span class="library-nav-chevron" aria-hidden="true">›</span>"#));

    // Library callbacks, the host-injected settings global it seeds from, and
    // the boot-time render + tree load.
    assert!(html.contains("window.leafSetLibraryState ="));
    assert!(html.contains("window.leafSetScanProgress ="));
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
        "settings.indexing.label",
        "settings.indexing.help",
        "library.title",
        "library.view.graph",
        "library.view.graph.on",
        "library.view.graph.off",
        "library.crumbs.label",
        "library.crumbs.enter",
        "library.crumbs.more",
        "library.scanning",
        "library.filesFound",
        "library.empty",
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
fn app_shell_wires_the_graph_view() {
    let html = app_shell_html();

    // The graph is the second of the two library views, reached by the icon in the
    // breadcrumb band, and owns its own pane container.
    assert!(html.contains("const LIBRARY_VIEWS = ['project', 'graph'];"));
    assert!(html
        .contains(r#"<button type="button" id="libraryGraphToggle" class="library-graph-toggle""#));
    assert!(html.contains("setLibraryView(libraryView === 'graph' ? 'project' : 'graph');"));
    assert!(html.contains(r#"<div id="libraryGraph" class="library-graph""#));
    assert!(html.contains(r#"id="libraryGraphCanvas""#));

    // PixiJS + d3-force load lazily from the bundled-asset protocol (no CDN).
    assert!(html.contains("const PIXI_SCRIPT_URL = '"));
    assert!(html.contains("const D3_FORCE_SCRIPT_URL = '"));
    assert!(html.contains("leaf-asset") && html.contains("pixi.min.js"));
    assert!(html.contains("d3-force.min.js"));
    assert!(html.contains("window.d3.forceSimulation"));
    // The unsafe-eval companion keeps Pixi off `new Function` so the CSP stays
    // tight; it must load after Pixi to patch it.
    assert!(html.contains("const PIXI_UNSAFE_EVAL_SCRIPT_URL = '"));
    assert!(html.contains("pixi-unsafe-eval.min.js"));
    // The CSP itself never grants 'unsafe-eval'.
    assert!(!html.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));

    // Data flows over the existing command channel and back through a callback.
    assert!(html.contains("send({ command: 'getGraph', scope: graphScope, seeds });"));
    assert!(html.contains("window.leafSetGraph ="));

    // The graph reuses the open command on node click and highlights the active
    // document; every node label is escaped before it reaches a Pixi Text.
    assert!(html.contains("send({ command: 'openRecent', path: node.path });"));
    assert!(html.contains("function graphSetActive("));

    // The i18n keys the graph surfaces exist in both dictionaries.
    for key in [
        "library.view.graph",
        "library.graph.empty",
        "library.graph.loading",
        "library.graph.error",
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

    // Reveal: the file's folder is a string operation on its own path, then the
    // pane asks for that folder. Nothing walks a tree, because there isn't one.
    assert!(html.contains("function parentFolderOf(filePath)"));
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
    // A reveal resolves at once now: the file's folder is known from its path, so
    // there is no queued reveal waiting for a tree to arrive.
    assert!(html.contains("if (folder && folder !== libraryProjectPath) {"));
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
    assert!(css.contains(".library-graph-toggle[aria-pressed=\"true\"] {"));

    // The toggle carries the bundled graph mark, normalized to currentColor like
    // every other toolbar icon.
    let graph_icon = normalize_svg_icon_colors(GRAPH_ICON_SVG);
    assert!(graph_icon.contains("stroke=\"currentColor\""));
    assert!(html.contains(graph_icon.trim()));
}

#[test]
fn the_leftmost_crumb_stays_put_and_opens_the_vault_switcher() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Same crumb, same place at the head of the same trail — what changed is
    // that it opens a menu rather than walking to the root. It carries no
    // data-crumb-path, so it cannot navigate.
    assert!(html.contains("[{ path: '', name: libraryRootLabel(), switcher: true }]"));
    assert!(html.contains(r#"data-crumb-switcher="1""#));
    assert!(html.contains("toggleCrumbMenu(switcher, vaultMenuItems());"));
    assert!(css.contains(".library-crumb.library-crumb-switcher {"));
    // Its label is the active vault's name, or the whole library's.
    assert!(html.contains("function libraryRootLabel()"));
    assert!(html.contains("return (vault && vault.name) || window.leafLocale.t('library.title');"));
    // Reachable from the graph too, or picking that view would strand you in a
    // vault with no way out.
    assert!(html.contains("const root = crumbSegments([])[0];"));

    // The menu: the whole library as it is today, every vault, then New vault…
    // which asks the host for a folder picker.
    assert!(html.contains("function vaultMenuItems()"));
    assert!(html.contains("selected: !activeVaultId,"));
    assert!(html.contains("selected: vault.id === activeVaultId,"));
    assert!(html.contains("send({ command: 'createVault' })"));
    assert!(html.contains("send({ command: 'setActiveVault', id });"));
    // Picking the entry you are in lands on its root rather than doing nothing.
    assert!(html.contains("if (id === activeVaultId) {\n    setLibraryFolder('');"));

    // Seeded before the first paint, so the crumb never flashes the wrong name.
    assert!(html.contains("const LEAF_VAULTS = (window.__leafVaults"));
    assert!(html.contains("window.leafSetVaults ="));

    for key in [
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
    assert!(html.contains("toggleCrumbMenu(switcher, vaultMenuItems());"));
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
