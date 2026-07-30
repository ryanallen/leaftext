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
    assert!(
        html.contains(r#"<div id="libraryDivider" class="library-divider" title="Resize library""#)
    );
    assert!(html.contains(r#"<button type="button" id="libraryOpen" class="icon-button library-open" title="Toggle library""#));

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
fn app_shell_includes_library_pane_settings_and_wording() {
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
    assert!(html.contains(r#"placeholder="Search files...""#));
    assert!(html.contains("send({ command: 'search', query, scope: librarySearchScopePaths() });"));
    assert!(html.contains("window.leafScrollToFragment('#' + jump.anchor);"));

    // File-derived strings are escaped before reaching the DOM (tree + hits).
    assert!(html.contains(r#"data-open-path="${escapeAttr(node.path)}""#));
    assert!(html.contains(r#"data-open-path="${escapeAttr(path)}""#));

    // Every string the pane shows is present, so none of it renders blank.
    for wording in [
        "'Library'",
        "aria-label=\"Folder path\"",
        "`Open ${segment.name}`",
        "`Skipped folders: ${names.join(' › ')}`",
        "title=\"Resize library\"",
        "placeholder=\"Search files...\"",
        ">No matches.</p>",
        "} results</p>`",
        "Searching…",
        "'Search failed.'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn changing_document_does_not_change_which_view_you_are_in() {
    let html = app_shell_html();

    // Opening a file from the pane while the map is up used to snap back to the
    // reading view, so picking what to look at also picked how. Only a gesture
    // that *means* "leave the map" closes it: a node click, a search hit (whose
    // anchor has nothing to scroll to on a canvas), and pressing the source
    // button. Each holds the map until its destination is ready rather than
    // dropping it and laying out the reading view in between.
    assert!(html.contains("let graphExitPending = false;"));
    let exits = html.matches("graphExitPending = true;").count();
    assert_eq!(
        exits, 3,
        "expected the node click, the search hit and the source button to leave the map, found {exits}"
    );
    assert!(html.contains("if (graphExitPending) {"));
    // And nothing else may reach for the door, bar the one state where there is
    // nothing left to map: the home screen. Leaving a vault is no longer such a
    // state — the open document answers for the map instead of the map closing.
    let closes = html.matches("closeGraphView();").count();
    assert_eq!(
        closes, 3,
        "expected the two pending exits and the home screen to close the map, found {closes}"
    );
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
    // behind a map that is *staying* must not throw a spinner over it, and must
    // not take down the one the map is waiting on. Leaving the map is the
    // exception — see `leaving_the_map_for_a_document_shows_the_spinner`.
    assert!(html.contains("beginReaderLoading('graph');"));
    assert!(html.contains("if (graphViewOpen && !graphExitPending && !forGraph) return;"));
    assert!(html.contains("if (readerLoadingOwner === 'graph' && owner !== 'graph') return;"));
    // Every way out of a build puts it down; the safety timeout is the backstop.
    assert!(html.matches("clearReaderLoading('graph');").count() >= 6);
    assert!(!html.contains("library.graph.loading"));
}

#[test]
fn the_map_opens_framing_everything_and_then_leaves_the_view_alone() {
    let html = app_shell_html();

    // A view parked at 1:1 on an arbitrary center cannot answer the first thing
    // a map is asked: how much is there. Two documents sat lost in the middle of
    // an empty field. So it fits, clamped to the zoom limits the wheel obeys.
    assert!(html.contains("function fitGraphToView(scene, follow)"));
    assert!(html.contains("autoFit: carried ? carried.autoFit : true,"));
    // While it settles the camera follows only what leaves the frame. A force
    // layout breathes, and refitting on every tick put that pumping on screen.
    assert!(html.contains("if (scene.autoFit) fitGraphToView(scene, true);"));
    assert!(
        html.contains("if (follow && graphBoundsInView(scene, minX, minY, maxX, maxY)) return;")
    );
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
fn a_redraw_of_the_same_map_is_not_a_redraw() {
    let html = app_shell_html();

    // The host redraws the graph for any change to the vault's text, so the page
    // is handed the same picture over and over while someone reads it. Tearing
    // the scene down for one of those is a WebGL context thrown away, a layout
    // restarted, and a camera reset -- the map visibly bouncing for a change that
    // was not one. So a payload is identified by what it draws and compared.
    assert!(html.contains("function graphSignature(data)"));
    assert!(html
        .contains("if (graphScene && graphScene.signature === graphSignature(graphData)) return;"));
    assert!(html.contains("signature: graphSignature(data),"));

    // A real change still rebuilds, but inherits the layout: every node keeps its
    // place, the simulation starts warm rather than laying the vault out again,
    // and a framing the reader chose survives.
    assert!(html.contains("function carryGraphLayout(scene)"));
    assert!(html.contains("const carried = graphScene ? carryGraphLayout(graphScene) : null;"));
    assert!(html.contains("if (seat) { node.x = seat.x; node.y = seat.y; }"));
    assert!(html.contains("if (carried && carried.positions.size) sim.alpha(GRAPH_WARM_ALPHA);"));

    // And a burst of writes -- a sync, a checkout, several saves -- builds once,
    // at the end, instead of once per delivery.
    assert!(html.contains("const GRAPH_REBUILD_COALESCE_MS = "));
    assert!(html.contains("if (graphRebuildTimer) clearTimeout(graphRebuildTimer);"));
    // Except the first, which is what the reader is actually waiting for.
    assert!(html.contains("if (!graphScene) {\n    buildGraphScene();"));
}

#[test]
fn only_a_document_that_moved_redraws_the_map() {
    let source = include_str!("../app/vaults.rs");

    // A vault is a folder someone works in: the watcher reports `.git` writing an
    // index, a saved image, a temp file coming and going. None of them can change
    // the corpus, and every one of them used to reach the page as a fresh graph.
    let patch = source
        .find("fn patch_vault_corpus(")
        .expect("the watcher patches the corpus a file at a time");
    let body = &source[patch..];
    let covers = body
        .find("if !corpus.covers(changed) {")
        .expect("a path that is not a document is answered before anything is paid for");
    let make_mut = body
        .find("Arc::make_mut(corpus).refresh(changed)")
        .expect("the corpus is patched through make_mut");
    assert!(
        covers < make_mut,
        "the cheap check has to come before the clone make_mut may pay for"
    );

    // And the answer it gives gates the redraw: the vault's text is a cache, so
    // "nothing moved" means the map on screen cannot have changed.
    let refresh = source
        .find("pub(crate) fn refresh_corpus_path(")
        .expect("the watcher hands the changed path here");
    let body = &source[refresh..];
    assert!(
        body.contains("let corpus_moved = patch_vault_corpus(state, changed);"),
        "the redraw has to be decided by whether the patch moved anything"
    );
    assert!(
        body.contains("state.corpus.clone().filter(|_| corpus_moved)"),
        "a refresh that changed nothing must not reach the vault graph rebuild"
    );
    // A document's own map has no cache to compare against, so it cannot answer
    // that question — but it still refuses to redraw for a path that is not a
    // document at all, which is most of what the watcher reports.
    assert!(
        body.contains("if !crate::is_supported_document_path(changed) {"),
        "a document map must not rebuild for a path that is not a document"
    );
}

#[test]
fn saving_the_document_you_are_reading_still_updates_the_sync_count() {
    let source = include_str!("../app/event_loop.rs");

    // A change to the open document takes the live-reload branch; a change to
    // anything else takes the other one. The status refresh sat in the second,
    // so the commonest edit there is -- saving the file you are looking at --
    // left the header's count stale until something else happened to move.
    let refresh = source
        .find("refresh_vault_status(&vault_state, &proxy, vault_state.active);")
        .expect("the watcher refreshes the vault's status");
    let branch = source
        .find("if is_active_document {")
        .expect("the watcher splits on the active document");
    assert!(
        refresh < branch,
        "the status refresh must run before the branch, or it only fires for          files you are not editing"
    );

    // And nothing between the event and the refresh. A containment check lived
    // here and discarded every event: the watcher reports paths under what it
    // watched, and that was canonicalised — a `\?\` verbatim prefix on
    // Windows, which does not share a component with the plain `C:\…` the vault
    // registry holds. One `git status` off the loop is cheaper than being wrong.
    assert!(!source.contains("changed.starts_with(root)"));
}

#[test]
fn one_growl_serves_every_thing_worth_saying_in_passing() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // There was already an error growl; this is that one generalized rather than
    // a second thing in the same corner doing the same job.
    assert!(html.contains("function leafToast(message, tone) {"));
    assert!(html.contains("window.leafShowError = (message) => leafToast(message, 'error');"));
    assert!(!html.contains("error.className = 'app-error';"));
    assert!(css.contains(".app-toast {"));
    assert!(css.contains(".app-toast.is-error {"));

    // One slot, replaced. A stack is a thing that then needs managing.
    assert!(html.contains("document.querySelector('.app-toast')"));
    // A failure holds longer than a success: one is read at a glance and never
    // again, the other has to be finished and acted on.
    assert!(html.contains("const TOAST_MS = 5000;"));
    assert!(html.contains("const TOAST_ERROR_MS = 8000;"));
    // It rises into place; something that simply appears in a corner has been
    // half-missed by the time the eye arrives.
    assert!(css.contains(".app-toast.is-shown {"));
    assert!(css.contains("@media (prefers-reduced-motion: reduce) {"));
}

#[test]
fn a_vault_with_work_to_send_says_so_in_its_own_header() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Two clicks down a settings panel is where a control goes to be forgotten.
    // This one lives at the end of the vault's crumb row, and only exists while
    // there is something to press it for.
    assert!(html.contains(r#"id="librarySyncButton" class="library-sync""#));
    assert!(html.contains("function renderVaultSyncButton()"));
    assert!(html.contains("if (!activeVaultId || (!waiting && !spinning)) {"));
    assert!(html.contains("send({ command: 'syncVault', id: activeVaultId });"));
    assert!(css.contains(".library-sync {"));
    assert!(css.contains(".library-sync[hidden] {"));
    // A count, not a dot: "3" is a reason to press it.
    assert!(html.contains("(repo.changed || 0) + (repo.ahead || 0)"));
    assert!(css.contains(".library-sync.is-busy svg {"));

    // The count is read off disk, on a path that never asks the network. The
    // panel's reading is the one that runs `gh auth status`; doing that on every
    // save would put a token check behind Ctrl+S.
    assert!(html.contains("send({ command: 'getVaultStatus', id: activeVaultId });"));
    assert!(html.contains("window.leafSetVaultStatus = (id, repo) => {"));

    // There are two ways the page learns which vault is active and they share no
    // path: a switch mid-session comes through `leafSetVaults`, but a cold launch
    // never calls that -- the list is already on the window as `__leafVaults` and
    // read straight out of it. Asking from only one of them is a button that
    // works all session and is missing every time the app starts.
    assert!(html.contains("function requestActiveVaultStatus() {"));
    assert_eq!(
        html.matches("requestActiveVaultStatus();").count(),
        2,
        "expected both callers to ask: the vault switch and the bootstrap"
    );
    let bootstrap = html
        .rfind("window.leafSetNavigation({ canGoBack: false, canGoForward: false });")
        .expect("the shell ends by bootstrapping itself");
    assert!(
        html[bootstrap..].contains("requestActiveVaultStatus();"),
        "the bootstrap has to ask too, or a cold launch never does"
    );

    // A push that finishes in a tenth of a second still has to look like work,
    // and whatever happened has to reach you whether or not the panel is open --
    // starting a sync from here used to fail silently with the panel shut.
    assert!(html.contains("const SYNC_MIN_SPIN_MS = 700;"));
    assert!(html.contains("syncSpinUntil = performance.now() + SYNC_MIN_SPIN_MS;"));
    assert!(html.contains("librarySyncButton.classList.toggle('is-busy', spinning);"));

    // Once it turns it does not stop until the answer is in. Anything else
    // redrawing the button mid-push -- a watcher tick was enough -- used to end
    // the turn, and a spinner that pauses reads as a failure at the one moment
    // it must not. Only a finished job releases it.
    assert!(html.contains("let syncInFlight = false;"));
    assert!(html.contains("    syncInFlight = true;"));
    assert!(
        html.contains("const spinning = syncInFlight || Boolean(state && state.busy) || held > 0;")
    );
    assert!(html.contains("  if (!state.busy) syncInFlight = false;"));
    // A watcher tick carries the folder's state and nothing about the job, so it
    // must not claim the job is over.
    assert!(!html.contains("{ repo, busy: false }"));
    // And it leaves still turning, rather than blinking out mid-thought.
    assert!(html.contains("librarySyncButton.classList.add('is-leaving');"));
    assert!(css.contains(".library-sync.is-leaving {"));
    // An <svg> takes its transform origin from its own box, so a spin that does
    // not say so orbits the corner instead of turning.
    assert!(css.contains("  transform-origin: 50% 50%;"));
    assert!(html.contains("leafToast(syncOutcomeText(state), state.error ? 'error' : 'ok');"));
    // Reading the folder carries no message, so opening the panel is silent.
    assert!(html.contains("  if (state.message) {"));

    for wording in [
        "`Sync ${waiting} to GitHub`",
        "`Pushed ${committed} to ${remote}.`",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn a_vault_that_reaches_github_wears_a_cloud() {
    let html = app_shell_html();

    // Where a box says "a collection, here", a cloud says "and somewhere else as
    // well" -- which is the whole of what syncing buys, and the one thing worth
    // knowing at a glance about a vault you are not currently in.
    let cloud = normalize_svg_icon_colors(CLOUD_ICON_SVG);
    assert!(cloud.contains("stroke=\"currentColor\""));
    assert!(html.contains(cloud.trim()));
    assert!(html.contains("const CLOUD_ICON_SVG = `"));
    assert!(html.contains("function vaultGlyph(current, id) {"));
    assert!(html.contains("  if (vaultSyncs(id)) return CLOUD_ICON_SVG;"));

    // A repository with no remote is a pile of commits on one disk, which is not
    // what a cloud promises.
    assert!(html.contains("return Boolean(repo && repo.atRoot && repo.remote);"));

    // One cloud, not an open and a closed one: open/closed says which vault you
    // are standing in, and a cloud is about where the thing lives. The tick still
    // marks the current row.
    assert_eq!(html.matches("CLOUD_ICON_SVG;").count(), 1);
    assert!(html.contains("return current ? PACKAGE_OPEN_ICON_SVG : PACKAGE_ICON_SVG;"));

    // The menu is where vaults are compared, so every one of them is asked about
    // -- not only the one in use. Cached, so it costs once per vault.
    assert!(html.contains("function requestKnownVaultStatuses() {"));
    assert!(html.contains(
        "if (!vaultGitByVault.has(vault.id)) send({ command: 'getVaultStatus', id: vault.id });"
    ));

    // And the switcher button wears the mark of the vault it stands for; only
    // the glyph is replaced, the caret beside it is ours.
    assert!(html.contains("if (glyph) glyph.outerHTML = vaultGlyph(true, activeVaultId);"));
}

#[test]
fn a_vault_can_be_put_on_github_from_its_own_settings() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Opening the panel reads the folder; everything after that is a button.
    assert!(html.contains("window.leafSetVaultGit = (state) => {"));
    assert!(html.contains("window.leafVaultGitBusy = (id) => {"));
    assert!(html.contains("send({ command: 'syncVault', id: vault.id }),"));
    assert!(html.contains("send({ command: 'createVaultRepo', id: vault.id }),"));
    assert!(html.contains("command: 'linkVaultRemote', id: vault.id, url"));

    // Git is the one hard requirement, and it is named rather than assumed.
    assert!(html.contains("if (!state.tooling.git) {"));
    assert!(html.contains("https://git-scm.com/downloads"));
    // Without gh the browser does the authenticated half and hands back a URL,
    // so nothing here ever holds a token.
    assert!(html.contains("if (state.tooling.gh) {"));
    assert!(html.contains("https://github.com/new?name="));
    assert!(html.contains("visibility=private"));
    assert!(!html.contains("ghp_"));
    assert!(!html.contains("Authorization"));

    // The two things git needs that only bite at commit or push time, which is
    // too late to be told about them.
    assert!(html.contains("if (!state.tooling.identity) {"));
    assert!(html.contains("if (!state.tooling.credentialHelper) {"));

    // A repo one folder down is reported, not silently swallowed, and a vault
    // inside someone else's repo is told that is what it is.
    assert!(html.contains("Already repositories, and left alone:"));
    assert!(html.contains("A repository here is separate from it."));

    // Work happens in the panel, so the panel stays up to report it.
    assert!(html.contains("if (!entry.keepOpen) hideCrumbMenu();"));
    assert!(html.contains("keepOpen: true,"));
    assert!(css.contains(".crumb-menu-note {"));
    assert!(css.contains(".crumb-menu-item:disabled {"));

    for wording in [
        "heading: 'GitHub'",
        "'Syncing needs git, which is not installed.'",
        "'Create a private repo'",
        "'Paste the repository address'",
        "'git has no way to sign in to GitHub, so a push will fail.'",
        "`Pushed ${committed} changed.`",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
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
    // reading, not a property of a document -- driven now from the reading
    // toolbar's own control alone.
    for icon in [SPEED_READER_ON_ICON_SVG, SPEED_READER_OFF_ICON_SVG] {
        let icon = normalize_svg_icon_colors(icon);
        assert!(
            icon.contains("stroke=\"currentColor\""),
            "the icon's stroke must be normalized to currentColor"
        );
        assert!(html.contains(icon.trim()));
    }
    assert!(
        html.contains("send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });")
    );

    for wording in [
        "'Lock this page (read-only)'",
        "'Unlock to edit this page'",
        "'Speed reader'",
        r#"aria-label="Reading tools""#,
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
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
    // With the bar up, all three are enterable — there is no dead key, and no
    // grayed-out state for one to sit in. The map used to be of a vault, so a
    // document outside one had a view it could not get into; it is of the open
    // document now, and the bar is only up when there is one.
    assert!(!html.contains("button.disabled = unavailable;"));
    assert!(!css.contains(".reader-tool:disabled {"));
    assert!(!html.contains("VIEW_UNAVAILABLE_REASON"));
    assert!(!html.contains("titleEnterable"));
    assert!(!html.contains("Pick a vault"));
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

    for wording in [
        r#"aria-label="Graph""#,
        r#"title="Show how these documents link""#,
        "'No links to graph yet.'",
        "const GRAPH_ERROR = 'Graph failed to load.';",
        "most-linked documents.`",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn the_graph_needs_a_document_and_never_a_vault() {
    let html = app_shell_html();

    // What the map is of is the open document, so that — and only that — is what
    // entering it requires. There is no vault in the test any more, which is the
    // whole fix: a document outside every vault still links to things, and those
    // links are written in the document itself.
    assert!(html.contains("const next = Boolean(open) && Boolean(activeDocumentPath());"));
    assert!(!html.contains("graphHasBoundedRoot"));

    // And nothing refuses on the way in. showGraph used to tear the scene down and
    // print a sentence whenever there was no vault; now it asks and the host
    // always answers.
    assert!(html.contains("function showGraph() {\n  graphActivePath = activeDocumentPath();\n  if (!graphRequested) {"));

    // Leaving a vault re-reads the map rather than closing it. This is what threw
    // the reader out of the graph on opening any file from outside their vault.
    assert!(html.contains("refreshGraphForScope();"));
    assert!(!html.contains("if (!graphHasBoundedRoot()) closeGraphView();"));

    // And going to another document refetches at every size when the map is of a
    // document rather than a vault: the picture itself changed, so moving the
    // highlight inside the old one would leave the reader on a map that need not
    // even contain the file they are on. A vault's map is the same picture for all
    // of its documents, so that case still refetches only for Focus.
    assert!(html.contains(
        "const seedChanged =\n    (graphScope === 'small' || !activeVaultId) &&\n    graphScope + '|' + graphSeeds().join('\\n') !== graphSeedKey;"
    ));
}

#[test]
fn a_web_address_is_a_node_drawn_as_a_ring_and_opened_in_the_browser() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // A ring rather than a disc, so it reads as "not one of your files" before you
    // have read the domain under it.
    assert!(html.contains("if (node.external) {"));
    assert!(html.contains(
        "gfx.circle(0, 0, radius).stroke({ width: 1.5, color: 0xffffff, alignment: 0.5 });"
    ));
    // With a dot at the middle for the edge to end behind: edges draw under the
    // nodes, so a bare ring let the line run through the hollow and stop in mid-air.
    assert!(html.contains("gfx.circle(0, 0, Math.max(1.6, radius * 0.36)).fill(0xffffff);"));
    assert!(css.contains("radial-gradient(circle at center, var(--app-border) 1.6px"));

    // An edge points the way the link was written; a pair that links each other gets
    // one line with a head at both ends. Heads drop on a dense map and at a far
    // zoom, where they are ink per frame and nothing else.
    assert!(html.contains("drawGraphArrow(scene, t, s, color, alpha);"));
    assert!(html.contains("if (link.mutual) drawGraphArrow(scene, s, t, color, alpha);"));
    assert!(html.contains("mutual: !!e.mutual }));"));
    assert!(html.contains(
        "scene.nodes.length <= GRAPH_ARROW_MAX_NODES && scene.world.scale.x >= GRAPH_ARROW_MIN_ZOOM;"
    ));
    // Backed off by the target's radius *and* its scale, or the head hides under the
    // active node — the one node whose incoming links you most want to read.
    assert!(html
        .contains("const clear = graphNodeRadius(at.degree) * (at.gfx ? at.gfx.scale.x : 1) + 1;"));
    // And its own resting tint, quieter than a document's, so the documents are
    // still what the eye lands on.
    assert!(html.contains("external: cssVarColor('--app-border', 0x3a3f4b),"));
    assert!(html.contains("let color = node.external ? colors.external : colors.node;"));

    // Clicking one opens the browser and leaves the map exactly as it is. Nothing
    // replaced the page, so exiting the view would throw away the picture the
    // reader is working through.
    assert!(html.contains("send({ command: 'openExternal', url: node.path });"));
    assert!(html.contains("if (!moved && node.external) {"));
    // A document still leaves the map, and still holds it until the document lands.
    assert!(html.contains(
        "graphExitPending = true;\n        send({ command: 'openRecent', path: node.path });"
    ));

    // The key shows up only when there are two kinds of node to tell apart, and
    // vanishes with the scene.
    assert!(html.contains(r#"<p id="readerGraphLegend" class="reader-graph-legend" hidden>"#));
    assert!(html.contains("setGraphLegend(data.nodes.some((node) => node.external));"));
    assert!(html.contains("function teardownGraphScene() {\n  setGraphLegend(false);"));
    assert!(css.contains(".reader-graph-legend {"));
    // Flex, so the attribute that hides it has to be spelled out.
    assert!(css.contains(".reader-graph-legend[hidden] {"));
    assert!(css.contains(".graph-key-external {"));
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
    // Open is the vault you are in, closed the ones you are not, so the row says
    // which it is without leaning on the tick alone — until a vault reaches
    // GitHub, at which point where it lives is the more useful thing to show.
    assert!(html.contains("const rootIcon = (on, id) => vaultGlyph(on, id);"));
    assert!(html.contains("icon: rootIcon(vault.id === activeVaultId, vault.id),"));
    // The pane still lists directories as directories.
    assert!(html.contains("const FOLDER_ICON_SVG = `"));
    assert!(html.contains(r#"<span class="library-crumb-caret" aria-hidden="true">"#));
    // Its label names the root you are in, so hovering says what would change.
    assert!(html.contains("function renderLibraryVaultSwitch()"));
    assert!(html.contains("const label = `Switch vault (in ${libraryRootLabel()})`;"));

    // The leftmost crumb is a place again: it goes to the root, and nothing in
    // the trail opens a menu.
    assert!(html.contains("[{ path: '', name: libraryRootLabel() }]"));
    assert!(!html.contains("data-crumb-switcher"));
    assert!(!html.contains("library-crumb-switcher"));
    // Its label is the vault's name, or the whole library's.
    assert!(html.contains("function libraryRootLabel()"));
    assert!(html.contains("return (vault && vault.name) || 'Library';"));

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

    for wording in [
        r#"aria-label="Vaults""#,
        "`Switch vault (in ${libraryRootLabel()})`",
        "'Everything the library has indexed'",
        "'New vault…'",
        "'Choose a folder to use as a library root'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn each_vault_row_carries_one_button_for_everything_you_can_do_to_it() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // A visible button on the row, not a right-click: rename, re-point and
    // remove all live behind it.
    assert!(html.contains("showCrumbMenu(crumbMenuOwner, editVaultMenuItems(vault));"));
    // Opening the panel asks about the folder's repository straight away, so the
    // answer is there by the time anyone has read down to it.
    assert!(html.contains("send({ command: 'getVaultGit', id: vault.id });"));
    assert!(html.contains(r#"edit.className = 'crumb-menu-edit';"#));
    assert!(css.contains(".crumb-menu-edit {"));
    // Pressing it opens that vault's panel rather than switching to the vault --
    // on the press, so a redraw mid-click cannot swallow it.
    assert!(html.contains("edit.addEventListener('pointerdown', (event) => {"));
    assert!(html.contains("entry.edit();"));
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

    for wording in [
        "`Edit ${entry.label}`",
        "`Editing ${vault.name || ''}`",
        "'Vault name'",
        "'Change folder…'",
        "'Remove vault'",
        "'Forgets the vault. The folder and its files are left alone.'",
        "label: 'Back'",
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
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
    assert!(html.contains("{ action: 'delete', label: 'Delete', danger: true }"));
}

#[test]
fn leaving_the_map_for_a_document_shows_the_spinner() {
    // Clicking a node navigates out of the map, and the map deliberately holds
    // until the document is ready rather than flashing the file you were on. The
    // wait is a whole document being read, so with the spinner suppressed the map
    // just sits there looking frozen — which is what it did.
    let html = app_shell_html();

    // The gesture arms the exit before the request goes out.
    assert!(html.contains("        graphExitPending = true;"));
    assert!(html.contains("send({ command: 'openRecent', path: node.path });"));
    assert!(html.contains("const READER_LOADING_COMMANDS = new Set(['openRecent']);"));

    // So the spinner is only withheld while the map is staying up.
    assert!(html.contains("if (graphViewOpen && !graphExitPending && !forGraph) return;"));

    // And the map stepping aside must not pull down the spinner the document
    // raised, or the wait comes back as a blink mid-handover.
    assert!(html.contains("clearReaderLoading('graph');"));
    assert!(html.contains("if (owner === 'graph' && readerLoadingOwner !== 'graph') return;"));
}

#[test]
fn going_from_the_map_to_the_source_does_not_lay_out_the_reading_view_on_the_way() {
    // The map covers the reading view with `hidden`, so revealing it lays out the
    // whole document — and going map -> source dropped the map first, which meant
    // laying out a document only to replace it a moment later. That showed up as
    // the reading view flashing under a spinner between the two views.
    let html = app_shell_html();

    // The map is held, exactly as a node click holds it.
    assert!(html.contains("if (graphViewOpen && view === 'code' && !codeViewActive) {"));
    // ...and dropped by the source render itself, in the same breath as the swap,
    // so the reading view underneath is replaced rather than revealed.
    let render = html
        .split("window.leafShowCodeView = (state) => {")
        .nth(1)
        .and_then(|rest| rest.split("codeViewActive = true;").next())
        .expect("the code view's render entry");
    assert!(
        render.contains("graphExitPending = false;") && render.contains("closeGraphView();"),
        "the source render must drop the held map before it renders: {render}"
    );
    // Nothing measures a document that is not on screen for a position to carry.
    assert!(html.contains(
        "pendingCodeViewSrcOffset = graphViewOpen ? null : topReadingBlockSourceOffset();"
    ));
}
