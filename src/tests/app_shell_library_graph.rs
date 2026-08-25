//! The map, the view you are in, and the padlock over both editable views.

use super::*;

#[test]
fn changing_document_does_not_change_which_view_you_are_in() {
    let html = app_shell_page();

    // Opening a file while the map is up must not snap back to the reading view: picking what to look at is not picking how. That holds for the pane and for the map's own nodes — clicking one is a hop, and the map redraws around what opened. Only a gesture that *means* "leave the map" closes it: a search hit (whose anchor has nothing to scroll to on a canvas) and pressing the source button. Each holds the map until its destination is ready rather than dropping it and laying out the reading view in between.
    assert!(html.contains("let graphExitPending = false;"));
    let exits = html.matches("graphExitPending = true;").count();
    assert_eq!(
        exits, 2,
        "expected the search hit and the source button to leave the map, found {exits}"
    );
    assert!(html.contains("if (graphExitPending) {"));
    // And nothing else may reach for the door, bar the one state where there is nothing left to map: the home screen. Leaving a vault is not such a state — the open document answers for the map instead of the map closing.
    let closes = html.matches("closeGraphView();").count();
    assert_eq!(
        closes, 3,
        "expected the two pending exits and the home screen to close the map, found {closes}"
    );
    assert!(html.contains(
        "if (!currentState.document) {
    // No document, no views."
    ));

    // The same rule for source: a document opened while reading source opens in source, decided host-side so the reading view never flashes on the way.
    assert!(html.contains("window.leafSetWorkspace = (state) => {"));
}

#[test]
fn the_map_waits_with_the_same_spinner_a_slow_document_does() {
    let html = app_shell_page();

    // A line of text in the corner reads as a result, not a wait. The overlay is shared with the reader, so it tracks who raised it: a document rendering behind a map that is *staying* must not throw a spinner over it, and must not take down the one the map is waiting on. Leaving the map is the exception — see `leaving_the_map_for_a_document_shows_the_spinner`.
    assert!(html.contains("beginReaderLoading('graph');"));
    assert!(html.contains("if (graphViewOpen && !graphExitPending && !forGraph) return;"));
    assert!(html.contains("if (readerLoadingOwner === 'graph' && owner !== 'graph') return;"));
    // Every way out of a build puts it down; the safety timeout is the backstop.
    assert!(html.matches("clearReaderLoading('graph');").count() >= 6);
    assert!(!html.contains("library.graph.loading"));
}

#[test]
fn the_map_opens_framing_everything_and_then_leaves_the_view_alone() {
    let html = app_shell_page();

    // A view parked at 1:1 on an arbitrary center cannot answer the first thing a map is asked: how much is there. Two documents sit lost in the middle of an empty field. So it fits, clamped to the zoom limits the wheel obeys.
    assert!(html.contains("function fitGraphToView(scene, follow)"));
    assert!(html.contains("autoFit: carried ? carried.autoFit : true,"));
    // While it settles the camera follows only what leaves the frame. A force layout breathes, and refitting on every tick puts that pumping on screen.
    assert!(html.contains("if (scene.autoFit) fitGraphToView(scene, true);"));
    assert!(
        html.contains("if (follow && graphBoundsInView(scene, minX, minY, maxX, maxY)) return;")
    );
    assert!(html.contains("Math.min(availableX / spanX, availableY / spanY)"));
    // Four gestures take the view, and it is not given back: pan, wheel, drag, and a flight to one node.
    let releases = html.matches("scene.autoFit = false;").count();
    assert_eq!(
        releases, 4,
        "expected pan, wheel, drag and focus to end auto-fit, found {releases}"
    );
}

#[test]
fn a_redraw_of_the_same_map_is_not_a_redraw() {
    let html = app_shell_page();

    // The host redraws the graph for any change to the vault's text, so the page is handed the same picture over and over while someone reads it. Tearing the scene down for one of those is a WebGL context thrown away, a layout restarted, and a camera reset -- the map visibly bouncing for a change that was not one. So a payload is identified by what it draws and compared.
    assert!(html.contains("function graphSignature(data)"));
    assert!(html
        .contains("if (graphScene && graphScene.signature === graphSignature(graphData)) return;"));
    assert!(html.contains("signature: graphSignature(data),"));

    // A real change still rebuilds, but inherits the layout: every node keeps its place, the simulation starts warm rather than laying the vault out again, and a framing the reader chose survives.
    assert!(html.contains("function carryGraphLayout(scene)"));
    assert!(html.contains(
        "const carried = graphScene ? carryGraphLayout(graphScene) : keptGraphCameraFor(data);"
    ));
    // No scene to carry from means the map is being entered, not redrawn, and the camera the last one was left at is the answer -- for one build, and only where the payload draws the same picture.
    assert!(html.contains("function keptGraphCameraFor(data)"));
    assert!(html.contains("keptGraphCamera = null;"));
    assert!(html.contains("if (seat) { node.x = seat.x; node.y = seat.y; }"));
    assert!(html.contains("if (carried && carried.positions.size) sim.alpha(GRAPH_WARM_ALPHA);"));

    // And a burst of writes -- a sync, a checkout, several saves -- builds once, at the end, instead of once per delivery.
    assert!(html.contains("const GRAPH_REBUILD_COALESCE_MS = "));
    assert!(html.contains("if (graphRebuildTimer) clearTimeout(graphRebuildTimer);"));
    // Except the first, which is what the reader is actually waiting for.
    assert!(html.contains("if (!graphScene) {\n    buildGraphScene();"));
}

#[test]
fn only_a_document_that_moved_redraws_the_map() {
    let source = include_str!("../app/vaults.rs");

    // A vault is a folder someone works in: the watcher reports `.git` writing an index, a saved image, a temp file coming and going. None of them can change the corpus, so none of them may reach the page as a fresh graph.
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

    // And the answer it gives gates the redraw: the vault's text is a cache, so "nothing moved" means the map on screen cannot have changed.
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
    // A document's own map has no cache to compare against, so it cannot answer that question — but it still refuses to redraw for a path that is not a document at all, which is most of what the watcher reports.
    assert!(
        body.contains("if !crate::is_supported_document_path(changed) {"),
        "a document map must not rebuild for a path that is not a document"
    );
}

#[test]
fn editing_is_one_padlock_in_the_bar_governing_both_editable_views() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Not a checkbox buried in Settings: the bar carries it, in a recess beside the view buttons, so the answer to "can I type here" is where the typing is. Nothing of the old Settings switch is left.
    assert!(!html.contains("readerEditingEnabled"));
    assert!(!html.contains("settings.readerEditing"));
    assert!(!html.contains("setReaderEditingEnabled"));

    // One recess, whose contents follow the view you are in. The padlock stands in both editable views because it is one switch for both; the speed reader belongs to the reading view and the wand to the source view. The map's one setting is how big a graph to draw, so the recess stands there too — with the dropdown in it and none of the three buttons.
    assert!(html.contains(r#"id="readerViewTools" class="reader-view-tools""#));
    assert!(html.contains(r#"<label class="reader-subselect" id="graphScopeTool" hidden>"#));
    assert!(html.contains(r#"id="readerLockButton" class="reader-subtool""#));
    assert!(html.contains(r#"id="speedReaderButton" class="reader-subtool""#));
    assert!(html.contains(r#"id="codeIntelButton" class="reader-subtool""#));
    assert!(html.contains("const editable = current === 'reading' || current === 'code';"));
    assert!(html.contains("const onGraph = current === 'graph';"));
    assert!(html.contains("readerViewTools.hidden = !editable && !onGraph;"));
    assert!(html.contains("graphScopeTool.hidden = !onGraph;"));
    // Four named sizes, read rather than clicked through, and the help sentence the panel spelled out is the dropdown's tooltip now.
    assert!(html.contains(r#"<option value="small">Focus</option>"#));
    assert!(html.contains(r#"<option value="xl">Everything</option>"#));
    assert!(html.contains(r#"title="How many documents the graph view draws. Smaller is faster.""#));
    // Wired where the rest of the graph lives, not in the speed reader.
    assert!(html.contains("send({ command: 'setGraphScope', scope: graphScope });"));
    assert!(css.contains(".reader-subselect select {"));
    // And the reading half of it stands only where the page proved a range to open, so a message whose words are packed into the file meets no padlock rather than one that answers a press with nothing.
    assert!(html.contains(
        "readerLockButton.hidden = !editable || (current === 'reading' && !currentDocumentBindsAnything);"
    ));
    assert!(html.contains("speedReaderButton.hidden = current !== 'reading';"));
    assert!(html.contains("codeIntelButton.hidden = !onCodeView;"));
    assert!(html.contains("renderViewTools(current);"));
    // Sunk into the bar and grained like it, rather than laid on top of it.
    assert!(css.contains(".reader-view-tools {"));
    assert!(css.contains("  box-shadow: var(--lt-shadow-inset);"));
    assert!(css.contains(".reader-view-tools[hidden] {"));
    // Both the recess and the buttons in it set a display of their own, which beats the browser's rule for [hidden] unless it is restated.
    assert!(css.contains(".reader-subtool[hidden] {"));
    // Never blue: the blue chip is how the bar says which view you are in, and a setting inside a view must not wear the same badge. It is lit instead -- a fill pushed off the page color, in a hairline frame, so which tools are on is answered without reading the glyphs.
    assert!(!html.contains("readerLockButton.classList.toggle('is-active'"));
    assert!(!css.contains(".reader-subtool.is-active"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"],\n"));
    assert!(css.contains(
        "  background: color-mix(in srgb, var(--lt-background) 88%, var(--lt-foreground));\n  box-shadow: var(--lt-shadow-edge-strong);"
    ));

    // Two padlocks, both locked until you say otherwise, each a saved setting rather than an answer you give again on every file you open. Unlocking the page you read must not also hand over the file's own text.
    assert!(html.contains("let readingUnlocked = LEAF_SETTINGS.readingUnlocked === true;"));
    assert!(html.contains("let codeUnlocked = LEAF_SETTINGS.codeUnlocked === true;"));
    assert!(html.contains("  return readingUnlocked;"));
    assert!(html.contains("if (readerEditingAllowed()) {"));
    assert!(html.contains("send({ command: 'setReadingUnlocked', enabled: readingUnlocked });"));
    assert!(html.contains("send({ command: 'setCodeUnlocked', enabled: codeUnlocked });"));
    // One button, holding whichever one the view you are in belongs to.
    assert!(html.contains("    if (codeViewActive) setCodeUnlocked(!codeUnlocked);\n    else setReadingUnlocked(!readingUnlocked);"));
    assert!(html.contains("onCodeView ? codeUnlocked : readingUnlocked,"));
    // Flipping the page's commits whatever block was mid-edit rather than dropping it; the source's is an option, because rebuilding the editor would throw away the undo stack and the place in the file.
    assert!(html.contains("function setReadingUnlocked(unlocked)"));
    assert!(html.contains("  commitActiveEditingBlock();\n  readingUnlocked = next;"));
    // And the page stays where the reader left it. The same words are on screen either way, so the rebuild that binds the blocks must not double as a jump to the top — renderState() alone replaces the body and the scroll with it.
    assert!(html.contains(
        "  send({ command: 'setReadingUnlocked', enabled: readingUnlocked });\n  renderStateKeepingPlace();"
    ));
    assert!(html.contains("function renderStateKeepingPlace() {"));
    assert!(html.contains("    restoreReaderScrollAnchor(anchor);"));
    assert!(html.contains("monacoEditor.updateOptions({ readOnly: !codeUnlocked });"));
    assert!(html.contains("readOnly: !codeUnlocked,"));
    // And a refused keystroke says so, rather than reading as a dead editor.
    assert!(html.contains("monacoEditor.onDidAttemptReadOnlyEdit(growlLockedForReading)"));
    assert!(html.contains(
        "leafToast('The source is locked. Click the padlock in the toolbar to edit it.');"
    ));

    // Both glyphs ship, and the pressed state picks which one shows — swapping innerHTML would rebuild the icon under the pointer on every render.
    for icon in ["lock-closed", "lock-open"] {
        assert_icon(&html, icon);
    }
    assert!(css.contains(".reader-subtool .reader-glyph-on,"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"] .reader-glyph-off {"));
    assert!(css.contains(".reader-subtool[aria-pressed=\"true\"] .reader-glyph-on {"));
    // The glyph shown is the state you are in, not the one a click would take you to, so pressed (unlocked, or the speed reader running) shows the on glyph.
    assert!(html.contains("      viewLockTooltip(onCodeView)\n"));
    assert!(html.contains("setSubtoolState(speedReaderButton, speedReaderEnabled,"));
    assert!(html.contains("button.setAttribute('aria-pressed', String(on));"));

    // The speed reader stays one preference for the whole app -- a way of reading, not a property of a document -- driven from the reading toolbar's own control alone.
    for icon in ["speed-reader-on", "speed-reader-off"] {
        assert_icon(&html, icon);
    }
    assert!(
        html.contains("send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });")
    );

    // The tooltip names which padlock this is, or one button standing for two switches would say the same thing whichever one it is holding.
    for wording in [
        "'The page is unlocked. Click to lock it for reading.'",
        "'The page is locked. Click to unlock and edit it here.'",
        "'The source is unlocked. Click to lock it for reading.'",
        "'The source is locked. Click to unlock and edit the text.'",
        "'Speed reader'",
        r#"aria-label="Editing tools""#,
    ] {
        assert!(html.contains(wording), "missing wording: {wording}");
    }
}

#[test]
fn the_graph_is_a_page_view_toggled_beside_the_code_view() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // On the page, in the reader's own cell — not in a 240px sidebar where its labels cannot be read and clicking a node answers somewhere you are not looking.
    assert!(html.contains(r#"<div id="readerGraph" class="reader-graph""#));
    assert!(html.contains(r#"id="readerGraphCanvas""#));
    assert!(css.contains(".reader-graph {"));
    assert!(css.contains("grid-column: 2;"));
    // Nothing of it is left in the pane.
    assert!(!html.contains("libraryGraph"));
    assert!(!css.contains(".library-graph"));

    // Toggled from the floating bar under the page, alongside reading and the source: three ways of showing the same thing, so they are one group and exactly one of them is pressed.
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
    // It floats over the page rather than scrolling with it: placed by the grid in the reader's own cell, not parented to the scroller.
    assert!(css.contains(".reader-toolbar {"));
    assert!(css.contains("  align-self: end;"));
    // Save and undo sit in the same bar; none of the four is up in the app bar.
    assert!(html.contains(r#"id="undoButton" class="reader-tool undo-button""#));
    assert!(html.contains(r#"id="saveButton" class="reader-tool-save""#));
    assert!(!html.contains("graphViewButton"));
    assert!(!html.contains("codeViewButton"));
    assert!(!html.contains(r#"class="save-button""#));
    // With the bar up, all three are enterable — there is no dead key, and no grayed-out state for one to sit in. The map is of the open document, and the bar is only up when there is one.
    assert!(!html.contains("button.disabled = unavailable;"));
    assert!(!css.contains(".reader-tool:disabled {"));
    assert!(!html.contains("VIEW_UNAVAILABLE_REASON"));
    assert!(!html.contains("titleEnterable"));
    assert!(!html.contains("Pick a vault"));
    // No document, no bar. Three views of one thing needs the thing; on the home screen a toggle would be navigation, which the pane beside it already does.
    assert!(html.contains("readerToolbar.hidden = !hasDocument;"));
    assert!(html.contains("  if (!hasDocument) return;"));

    // One flag for the window, not a mode each tab remembers, and the host is told so a file changing on disk knows whether a map is on screen.
    assert!(html.contains("let graphViewOpen = false;"));
    assert!(html.contains("send({ command: 'setGraphView', open: graphViewOpen });"));
    assert!(!html.contains("LIBRARY_VIEWS"));
    assert!(!html.contains("libraryView"));
    // Going to a document puts the document back.
    assert!(html.contains("function closeGraphView()"));
    assert!(html.contains("closeGraphView();"));

    // PixiJS + d3-force still load lazily from the bundled-asset protocol, whose URLs are injected on window.__lt rather than written into the fragment.
    assert!(html.contains("pixi: PIXI_SCRIPT_URL,"));
    assert!(html.contains("d3Force: D3_FORCE_SCRIPT_URL,"));
    assert!(html.contains("pixiUnsafeEval: PIXI_UNSAFE_EVAL_SCRIPT_URL,"));
    assert!(html.contains("} = window.__lt.assets;"));
    assert!(html.contains(r#""pixi":"#) && html.contains("pixi.min.js"));
    assert!(html.contains("leaf-asset"));
    assert!(html.contains("window.d3.forceSimulation"));
    assert!(!html.contains("script-src 'self' 'unsafe-inline' 'unsafe-eval'"));

    // Data still flows over the same command and callback, and a node still opens its document.
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
    let html = app_shell_page();

    // What the map is of is the open document, so that — and only that — is what entering it requires. No vault appears in this test: a document outside every vault still links to things, and those links are written in the document itself.
    assert!(html.contains("const next = Boolean(open) && Boolean(activeDocumentPath());"));
    assert!(!html.contains("graphHasBoundedRoot"));

    // And nothing refuses on the way in: showGraph asks, and the host always answers, vault or no vault.
    assert!(html.contains("function showGraph() {\n  graphActivePath = activeDocumentPath();\n  if (!graphRequested) {"));

    // Leaving a vault re-reads the map rather than closing it: closing here is what throws the reader out of the graph on opening a file from outside their vault.
    assert!(html.contains("refreshGraphForScope();"));
    assert!(!html.contains("if (!graphHasBoundedRoot()) closeGraphView();"));

    // And going to another document refetches at every size when the map is of a document rather than a vault: the picture itself changed, so moving the highlight inside the old one would leave the reader on a map that need not even contain the file they are on. A vault's map is the same picture for all of its documents, so that case still refetches only for Focus.
    assert!(html.contains(
        "const seedChanged =\n    (graphScope === 'small' || !activeVaultId) &&\n    graphScope + '|' + graphSeeds().join('\\n') !== graphSeedKey;"
    ));
}

#[test]
fn a_web_address_is_a_node_drawn_as_a_ring_and_opened_in_the_browser() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // A ring rather than a disc, so it reads as "not one of your files" before you have read the domain under it.
    assert!(html.contains("if (node.external) {"));
    assert!(html.contains(
        "gfx.circle(0, 0, radius).stroke({ width: 1.5, color: 0xffffff, alignment: 0.5 });"
    ));
    // With a dot at the middle for the edge to end behind: edges draw under the nodes, so a bare ring lets the line run through the hollow and stop in mid-air.
    assert!(html.contains("gfx.circle(0, 0, Math.max(1.6, radius * 0.36)).fill(0xffffff);"));
    assert!(css.contains("radial-gradient(circle at center, var(--lt-border) 1.6px"));

    // An edge points the way the link was written; a pair that links each other gets one line with a head at both ends. Heads drop on a dense map and at a far zoom, where they are ink per frame and nothing else.
    assert!(html.contains("drawGraphArrow(scene, t, s, color, alpha);"));
    assert!(html.contains("if (link.mutual) drawGraphArrow(scene, s, t, color, alpha);"));
    assert!(html.contains("mutual: !!e.mutual }));"));
    assert!(html.contains(
        "scene.nodes.length <= GRAPH_ARROW_MAX_NODES && scene.world.scale.x >= GRAPH_ARROW_MIN_ZOOM;"
    ));
    // Backed off by the target's radius *and* its scale, or the head hides under the active node — the one node whose incoming links you most want to read.
    assert!(html
        .contains("const clear = graphNodeRadius(at.degree) * (at.gfx ? at.gfx.scale.x : 1) + 1;"));
    // And its own resting tint, quieter than a document's, so the documents are still what the eye lands on.
    assert!(html.contains("external: cssVarColor('--lt-border', 0x3a3f4b),"));
    assert!(html.contains("let color = node.external ? colors.external : colors.node;"));

    // Clicking one opens the browser and leaves the map exactly as it is. Nothing replaced the page, so exiting the view would throw away the picture the reader is working through.
    assert!(html.contains("send({ command: 'openExternal', url: node.path });"));
    assert!(html.contains("if (!moved && node.external) {"));
    // A document keeps the map too, and for the same reason: the picture is what the reader is working through. It redraws around what opened instead of closing.
    assert!(html.contains("        send({ command: 'openRecent', path: node.path });"));

    // The key shows up only when there are two kinds of node to tell apart, and vanishes with the scene.
    assert!(html.contains(r#"<p id="readerGraphLegend" class="reader-graph-legend" hidden>"#));
    assert!(html.contains("setGraphLegend(data.nodes.some((node) => node.external));"));
    assert!(html.contains("function teardownGraphScene() {\n  setGraphLegend(false);"));
    assert!(css.contains(".reader-graph-legend {"));
    // Flex, so the attribute that hides it has to be spelled out.
    assert!(css.contains(".reader-graph-legend[hidden] {"));
    assert!(css.contains(".graph-key-external {"));
}

#[test]
fn leaving_the_map_for_a_document_shows_the_spinner() {
    // A search hit navigates out of the map, and the map deliberately holds until the document is ready rather than flashing the file you were on. The wait is a whole document being read, so with the spinner suppressed the map just sits there looking frozen.
    let html = app_shell_page();

    // The gesture arms the exit before the request goes out.
    assert!(html
        .contains("      graphExitPending = true;\n      send({ command: 'openRecent', path });"));
    assert!(html.contains("const READER_LOADING_COMMANDS = new Set(['openRecent']);"));

    // So the spinner is only withheld while the map is staying up.
    assert!(html.contains("if (graphViewOpen && !graphExitPending && !forGraph) return;"));

    // A node click is the other side of it: the map stays, so the document's spinner is withheld and the map raises its own while the new slice builds.
    assert!(html.contains("  beginReaderLoading('graph');\n  send({ command: 'getGraph'"));

    // And the map stepping aside must not pull down the spinner the document raised, or the wait comes back as a blink mid-handover.
    assert!(html.contains("clearReaderLoading('graph');"));
    assert!(html.contains("if (owner === 'graph' && readerLoadingOwner !== 'graph') return;"));
}

#[test]
fn going_from_the_map_to_the_source_does_not_lay_out_the_reading_view_on_the_way() {
    // The map covers the reading view with `hidden`, so revealing it lays out the whole document — and going map -> source by dropping the map first means laying out a document only to replace it a moment later, which shows up as the reading view flashing under a spinner between the two views.
    let html = app_shell_page();

    // The map is held, exactly as a node click holds it.
    assert!(html.contains("if (graphViewOpen && view === 'code' && !codeViewActive) {"));
    // ...and dropped by the source render itself, in the same breath as the swap, so the reading view underneath is replaced rather than revealed.
    let render = html
        .split("window.leafShowCodeView = (state) => {")
        .nth(1)
        .and_then(|rest| rest.split("codeViewActive = true;").next())
        .expect("the code view's render entry");
    assert!(
        render.contains("graphExitPending = false;") && render.contains("closeGraphView();"),
        "the source render must drop the held map before it renders: {render}"
    );
    // Nothing measures a document that is not on screen for a position to carry: out of the map both of these spend the place taken before the hiding instead.
    assert!(html.contains(
        "pendingCodeViewSrcOffset = graphViewOpen ? handoff.graphReaderSrcOffset : topReadingBlockSourceOffset();"
    ));
    assert!(html.contains(
        "handoff.readerScrollTop = graphViewOpen ? handoff.graphReaderScrollTop : app.scrollTop;"
    ));
    // And the place itself is taken as the map goes up, which is the last moment there is anything to measure.
    assert!(html.contains("  if (next) takeGraphExitPlace();"));
    assert!(html.contains("function takeGraphExitPlace() {"));
}
