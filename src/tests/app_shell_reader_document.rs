//! What the reader draws: decorations, diagrams, math, links and the right-click menus.

use super::*;

#[test]
fn app_shell_decorates_blockquote_hard_break_lines_for_hanging_indent() {
    let html = app_shell_page();

    assert_contains(&html, "function decorateBlockquoteLines(root = app) {");
    assert_contains(
        &html,
        "root.querySelectorAll('blockquote:not(.markdown-alert) p').forEach((paragraph) => {",
    );
    assert_contains(
        &html,
        "if (!children.some((node) => node.nodeName === 'BR')) return;",
    );
    assert_in(
        &html,
        "function decorateBlockquoteLines(root = app) {",
        "line.className = 'blockquote-line';",
    );
    assert_contains(&html, "paragraph.classList.add('blockquote-lines');");
    assert_contains(&html, "decorateBlockquoteLines();");
}

#[test]
fn a_document_fades_in_when_it_is_a_different_document() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The class goes on at the reveal, not before it: the document is decorated hidden, and everything past that line measures the page.
    assert_contains(
        &html,
        "if (readerLayout) {\n      readerLayout.style.removeProperty('display');",
    );
    // A page sliding in from one side carries its own opacity, so it is not faded as well.
    assert_contains(
        &html,
        "if (arriving && !leavingCopy) fadeDocumentIn(readerLayout);",
    );
    // A fresh open and a tab switch fade; committing an inline edit re-renders the same path and does not.
    assert_contains(
        &html,
        "const arriving = renderedPath !== lastRenderedDocumentPath;",
    );
    assert_contains(&html, "lastRenderedDocumentPath = renderedPath;");
    // Cleared on the home screen, so reopening the document just closed is an arrival.
    assert_contains(
        &html,
        "lastRenderedDocumentPath = null;\n  document.title = 'Leaftext';",
    );
    // `var`, because theme.js runs renderState() as it loads and reaches that clear — a `let` would still be in its dead zone, and even the write would throw.
    assert_contains(&html, "var lastRenderedDocumentPath = null;");

    // Taken off again on animationend, and guarded on the target: animation events bubble, so a table's edge bands finishing their scroll would otherwise strip the fade off the page part-way through.
    assert_contains(&html, "function fadeDocumentIn(layout) {");
    assert_contains(&html, "layout.classList.add('is-arriving');");
    assert_contains(&html, "if (event.target !== layout) return;");
    assert_contains(
        &html,
        "layout.removeEventListener('animationend', settled);",
    );
    assert_contains(&html, "layout.classList.remove('is-arriving');");

    // Opacity only: a transform on this box changes geometry the scroll restore lands on, and makes it the containing block for anything fixed inside it.
    let arrive = rule_body(css, ".reader-layout.is-arriving {");
    assert_contains(
        arrive,
        "animation: leaf-document-arrive var(--lt-duration-160) var(--lt-ease-decelerate) both;",
    );
    assert!(
        !arrive.contains("transform"),
        "the arrival must not move the page: {arrive}"
    );
    assert_contains(
        css,
        "@keyframes leaf-document-arrive {\n  from {\n    opacity: 0;\n  }\n}",
    );
    // The fill mode is what makes the blanket reduced-motion rule land it at full opacity on the first frame rather than leaving the page invisible.
    assert_contains(
        css,
        "animation: leaf-document-arrive var(--lt-duration-160) var(--lt-ease-decelerate) both;",
    );
}

#[test]
fn the_page_being_left_slides_out_while_the_new_one_arrives() {
    let html = app_shell_page();
    let css = reading_mode_css();
    let swap = "function startReaderSwap(arriving, copy, direction, leftAt) {";

    // A copy, taken before the write that throws the live page away. A clone carries no listener, no editing binding and no observer, which is the whole reason that write can afford to be as blunt as it is.
    assert_contains(
        &html,
        "const leavingCopy = moving ? outgoing.cloneNode(true) : null;",
    );
    assert_contains(&html, "const leftAt = moving ? app.scrollTop : 0;");
    // Mounted after the live layer in the page, so the fifty single-element queries that ask for the document all keep answering with the one that works.
    assert_in(&html, swap, "app.appendChild(copy);");
    assert_in(&html, swap, "copy.inert = true;");
    assert_in(&html, swap, "copy.setAttribute('aria-hidden', 'true');");
    // Held where the reader left it, so the page going away carries the words they were reading out with it.
    assert_in(
        &html,
        swap,
        "copy.style.setProperty('--reader-leaving-offset', `${-leftAt}px`);",
    );
    // Last of all, after every pass that measures the page: a transform changes what an element says its box is.
    assert_contains(
        &html,
        "if (leavingCopy && readerLayout) startReaderSwap(readerLayout, leavingCopy, going, leftAt);",
    );
    // Nothing the landing scrolls into view may shove the reader sideways while both pages are traveling.
    assert_in(&html, swap, "if (app.scrollLeft) app.scrollLeft = 0;");
    // The copy's own animation ends the move, and a run nothing announced the end of is ended by hand.
    assert_in(
        &html,
        swap,
        "copy.addEventListener('animationend', (event) => {",
    );
    assert!(html.contains("const READER_SWAP_FALLBACK_MS = 500;"));
    assert_in(
        &html,
        swap,
        "readerSwapTimer = window.setTimeout(settled, READER_SWAP_FALLBACK_MS);",
    );
    // Every render takes a move down first, so a second one landing on one still running drops the older copy rather than leaving two pages up.
    assert_contains(
        &html,
        "const going = spendNavigationDirection();\n  endReaderSwap();",
    );
    assert_in(
        &html,
        "function endReaderSwap() {",
        "readerSwapCopy.remove();",
    );
    assert_in(
        &html,
        "function endReaderSwap() {",
        "app.classList.remove('is-swapping');",
    );
    assert_in(
        &html,
        "function endReaderSwap() {",
        "delete app.dataset.going;",
    );
    // The rail belongs to the page it names: while a still copy of the last one is on screen it must not already be the new one's.
    assert_contains(
        &html,
        "readerLayout.style.removeProperty('display');\n      // With the page it names, never before it: while a still copy of the last page is on screen the rail beside it belongs to that page, not to the one arriving behind it.\n      setMinimapMarkup(minimapHtml);",
    );

    // One cell holds both, and only while the move runs — a page at rest is the plain block it has always been.
    let swapping = rule_body(css, ".reader-shell.is-swapping {");
    assert!(swapping.contains("display: grid;"));
    assert!(swapping.contains("grid-template-columns: 1fr;"));
    // The arriving page's rightward travel was measured to widen the reader's own scroll.
    assert!(swapping.contains("overflow-x: hidden;"));
    assert!(
        rule_body(css, ".reader-shell.is-swapping > .reader-layout {")
            .contains("grid-area: 1 / 1;")
    );
    // Arriving settles hard, leaving accelerates away, and the sign of the travel is the only difference between the two directions.
    assert!(rule_body(
        css,
        ".reader-shell.is-swapping > .reader-layout.is-swapping-in {"
    )
    .contains(
        "animation: leaf-reader-arrive var(--lt-duration-220) var(--lt-ease-decelerate) both;"
    ));
    let leaving = rule_body(
        css,
        ".reader-shell.is-swapping > .reader-layout.is-leaving {",
    );
    assert!(leaving.contains("pointer-events: none;"));
    assert!(leaving.contains(
        "animation: leaf-reader-leave var(--lt-duration-220) var(--lt-ease-accelerate) both;"
    ));
    assert!(
        rule_body(css, ".reader-shell.is-swapping[data-going='forward'] {")
            .contains("--reader-swap-travel: 12%;")
    );
    assert!(
        rule_body(css, ".reader-shell.is-swapping[data-going='back'] {")
            .contains("--reader-swap-travel: -12%;")
    );
    // The copy travels sideways from where the reader left it, never from its own top.
    assert!(css.contains("@keyframes leaf-reader-leave {\n  from {\n    transform: translateY(var(--reader-leaving-offset));"));
    assert!(css.contains("@keyframes leaf-reader-arrive {"));
}

#[test]
fn only_going_somewhere_moves_the_page_and_every_way_of_going_says_which_way() {
    let html = app_shell_page();

    // The word somebody spent is the whole gate: only a press that sends the reader somewhere writes one, so an edit commit, a save, a watcher tick, the padlock and a tab click all stay exactly as immediate as they were, with nothing new deciding it. And the page has to change, or a jump inside the document already open would move it.
    assert_contains(
        &html,
        "const moving = going && arriving && outgoing && !readerOffScreen();",
    );
    assert_contains(
        &html,
        "const arriving = renderedPath !== lastRenderedDocumentPath;",
    );
    // Not the open path's own flag. A tab switch clears it, and Back and Forward across two documents come back on that same path — so a move gated on it would leave the reader's own Back the one gesture that never moved.
    assert!(!html.contains("resetReaderScrollOnNextRender && outgoing"));

    // Back and Forward are the two the reader presses by name.
    assert_contains(
        &html,
        "setNavigationDirection(command === 'goBack' ? 'back' : 'forward');",
    );
    // And every other press that puts a different document on screen says so too, or one way in would sit still while the rest moved.
    assert_in(
        &html,
        "function bindSearchHits() {",
        "setNavigationDirection('forward');",
    );
    assert_contains(
        &html,
        "setNavigationDirection('forward');\n      send({ command: 'openRecent', path: button.dataset.path });",
    );
    assert_contains(
        &html,
        "case 'open': setNavigationDirection('forward'); send({ command: 'openRecent', path }); break;",
    );
    // A document link is a step in. A page opened behind is not: nothing on screen changes, so a word written for it would move whatever render came next.
    assert_contains(&html, "if (!newPage) setNavigationDirection('forward');");
}

#[test]
fn the_outline_draws_a_shallower_heading_more_strongly_than_the_ones_under_it() {
    let css = reading_mode_css();

    // Every depth the pane can draw has a size, a weight and an ink of its own, so no level falls back to whatever the pane happened to inherit.
    let mut scale = Vec::new();
    for depth in 0..=5 {
        let selector = format!(".library-outline-depth-{depth} {{");
        let block = css
            .split_once(&selector)
            .unwrap_or_else(|| panic!("the stylesheet has no rule for outline depth {depth}"))
            .1
            .split_once('}')
            .expect("the depth rule closes")
            .0;
        let size = [
            "--lt-text-14",
            "--lt-text-13",
            "--lt-text-12",
            "--lt-text-11",
        ]
        .iter()
        .position(|token| block.contains(token))
        .unwrap_or_else(|| panic!("outline depth {depth} takes no text size from the scale"));
        let weight = ["--lt-weight-600", "--lt-weight-500", "--lt-weight-400"]
            .iter()
            .position(|token| block.contains(token))
            .unwrap_or_else(|| panic!("outline depth {depth} takes no weight from the scale"));
        let quiet = if block.contains("--lt-muted-foreground") {
            1
        } else if block.contains("--lt-markdown-foreground") {
            0
        } else {
            panic!("outline depth {depth} takes neither the body ink nor the quiet one");
        };
        scale.push((size, weight, quiet));
    }

    // Reading down the list, nothing ever gets louder: a heading nested under another is the same strength or weaker, never stronger.
    for depth in 1..scale.len() {
        let (size, weight, quiet) = scale[depth];
        let (above_size, above_weight, above_quiet) = scale[depth - 1];
        assert!(
            size >= above_size && weight >= above_weight && quiet >= above_quiet,
            "outline depth {depth} reads more strongly than the level it is nested under"
        );
    }
    // And the shallowest is genuinely stronger than the deepest, so the hierarchy is visible and not just consistent.
    assert!(
        scale[0] < scale[scale.len() - 1],
        "the shallowest heading reads no more strongly than the deepest"
    );

    // The gallery's own sample shows the scale, so a look at it answers what a nested heading does without opening a document.
    let components = include_str!("../../design/components.md");
    let sample = components
        .lines()
        .find(|line| line.starts_with("| Library pane |"))
        .expect("components.md has a Library pane row");
    assert!(
        sample.contains("headings</span>"),
        "the pane sample still counts something other than headings"
    );
    let drawn = (0..=5)
        .filter(|depth| sample.contains(&format!("library-outline-depth-{depth}")))
        .count();
    assert!(
        drawn > 1,
        "the pane sample draws {drawn} outline level(s), so the gallery cannot show the scale"
    );
}

#[test]
fn app_shell_draws_the_documents_headings_in_the_library_pane() {
    let html = app_shell_page();

    // The walk that reads the headings is apart from whatever draws them: a title plus at least one section, each row carrying its level, its words and the id a jump lands on.
    assert_contains(&html, "function documentOutlineHeadings(body) {");
    assert_contains(&html, "function collectDocumentOutlineRows(body) {");
    assert_contains(&html, "if (headings.length < 2) return [];");
    assert_contains(&html, "if (!h.id) h.id = 'section-' + (i + 1);");
    assert_contains(
        &html,
        "return rest.map((h) => ({ level: Number(h.tagName.slice(1)) || 1, text: readOutlineHeadingText(h), id: h.id }));",
    );
    // Read on every render and handed on, so a document with no headings clears what the last one left.
    assert_contains(&html, "function publishDocumentOutline() {");
    assert_contains(&html, "publishDocumentOutline();");
    assert_contains(
        &html,
        "setDocumentOutlineRows(body ? collectDocumentOutlineRows(body) : []);",
    );

    // The pane draws them, in the box it already swaps the file list for.
    assert_contains(&html, "function renderLibraryOutline() {");
    assert_contains(&html, "library-outline-row library-outline-depth-${depth}");
    assert_contains(&html, "data-outline-section=");
    // The line naming the list counts the headings it is drawing, read off the rows it already has rather than off the document under them.
    assert_contains(&html, "${formatCount(rows.length)} headings");
    assert_contains(&html, "On this page");
    // None of the block counter's four names may come back, or the number drifts to document length.
    for absent in [
        "DOCUMENT_LINE_SELECTOR",
        "openDocumentLineCount",
        "documentLineCount",
        "isNavOutlineItem",
    ] {
        assert!(
            !html.contains(absent),
            "the outline counts headings, not blocks; found {absent}"
        );
    }
    // One decision over three lists, in a fixed order, rather than a `hidden` written per list.
    assert_contains(&html, "function renderLibraryLists() {");
    assert_contains(
        &html,
        "const outlining = !searching && libraryOutlineShowing();",
    );
    assert_contains(&html, "libraryTree.hidden = searching || outlining;");
    // Building the rows is layout, so it waits for the frame after the document paints.
    assert_contains(
        &html,
        "libraryOutlineFrame = window.requestAnimationFrame(() => {",
    );

    // Nothing is drawn between a title and its first sentence: no box, no lazy populate, no summary.
    for absent in [
        "buildDocumentOutline",
        "populateDocumentOutline",
        "details.className = 'document-outline'",
        "insertAdjacentElement('afterend', details)",
        "summaryLabel.textContent = 'Outline'",
        "document-outline-count",
        "if (target.closest('.document-outline')) return;",
    ] {
        assert!(
            !html.contains(absent),
            "the outline is out of the page; found {absent}"
        );
    }
}

// Both views open the first line at the same height by different means — scroll origin in one, padding in the other — so the number lives in two files and has to agree, and has to clear the top edge fade that 16px of padding left it inside.
#[test]
fn app_shell_opens_both_views_at_the_same_content_top_gap() {
    let html = app_shell_page();
    let css = reading_mode_css();

    assert_contains(&css, "--reader-content-top-gap: 88px;");
    assert_contains(&html, "const READER_CONTENT_TOP_GAP = 88;");

    // The code view has no scroll origin of its own: the editor is handed the gap the shell's app-bar padding doesn't already cover, as padding inside its own scroll height, so no line can sit in the fade at either end.
    assert_contains(
        &html,
        "top: Math.max(0, READER_CONTENT_TOP_GAP - barHeight),",
    );

    // 88px from the shell's top edge is 48px of clear air below the 40px bar, which has to be more than the fade's reach or the first line opens dissolved. The depth is at :root — every edge in the app, and a widened table's own ends, run to one profile.
    assert!(
        css.contains("\n  --reader-edge-fade-depth: 36px;"),
        "the top fade's depth must stay under the content top gap's clearance"
    );
}

#[test]
fn app_shell_loads_mermaid_and_renders_diagram_fences_after_document_insert() {
    let html = app_shell_page();

    for expected in [
        "mermaid.min.js",
        "let mermaidLoadPromise = null;",
        "function loadMermaid() {",
        "function renderMermaidDiagrams() {",
        "securityLevel: 'strict'",
        "await mermaid.run({ nodes: batch });",
        "diagram.dataset.mermaidRender = 'failed';",
        // Nearest the reader first, a few at a time: a page of sixty diagrams must not freeze the window while they are drawn.
        "diagrams.sort((a, b) => mermaidReaderDistance(a) - mermaidReaderDistance(b));",
        "const MERMAID_BATCH_SIZE = 3;",
        // And only the ones the reader is near are queued on the way to the words — sixty drawn on open cost three and a half seconds of stalled window. The whole document follows once the page is quiet, which is the second argument.
        "function drawMermaidDiagrams(candidates, warming) {",
        "watchMermaidDiagrams(candidates);",
        // The structural colors of a diagram are the page's tokens. Mermaid's own light/dark palette stays underneath, never `base`, which recomputes the categorical scale out of our reach — see decorate.js.
        "theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',",
        "function mermaidThemeVariables() {",
        "const MERMAID_COLOR_MAP = {",
        // The ink for text inside a fill is measured against that fill, not assumed.
        "function inkOn(style, fills) {",
        "const MERMAID_INK_CANDIDATES = [",
        // Every categorical entry is named, and they all weigh the same, so one ink reads on all twelve.
        "function mermaidCategoricalScale(style, darkMode) {",
        "function colorAtLuminance(hue, saturation, luminance) {",
        "variables['cScaleLabel' + index] = inkOn(style, [color]);",
        // One variable, four differently colored gantt bars: only CSS can say that.
        "function mermaidGanttStateCss(style) {",
        "themeCSS: [mermaidGanttStateCss(style), mermaidC4RelationCss(style)]",
        // A theme switch cannot recolor an SVG, so the diagram is drawn again.
        "function repaintMermaidDiagrams() {",
        "attributeFilter: ['data-theme', 'data-leaf-theme'],",
    ] {
        assert_contains(&html, expected);
    }

    // The page holds all three of these lines in several places, so which block each is in is the claim: a render asks for the sweep, the sweep names the undrawn fences, and the batch draw starts mermaid.
    assert_in(
        &html,
        "function renderState() {",
        "renderMermaidDiagrams();",
    );
    assert_in(
        &html,
        "function renderMermaidDiagrams() {",
        "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])",
    );
    assert_in(
        &html,
        "function drawMermaidBatches(diagrams, generation, warming) {",
        "mermaid.initialize(mermaidRuntimeConfig())",
    );

    // Mermaid and KaTeX are served from the bundled-asset protocol, never a CDN.
    assert!(
        !html.contains("cdn.jsdelivr"),
        "runtimes must be self-hosted, not loaded from a CDN"
    );
    assert!(html.contains(LOCAL_ASSET_PROTOCOL));
}

#[test]
fn only_the_diagrams_near_the_reader_are_drawn() {
    let script = app_shell_script();

    for expected in [
        // One window of margin either way, so a diagram is drawn before it is reached rather than after.
        "const MERMAID_NEAR_SCREENS = 1;",
        "rootMargin: `${MERMAID_NEAR_SCREENS * 100}% 0px`",
        // A box says which of the two it is, and the stylesheet spins only the one waiting its turn.
        "diagram.dataset.diagramWait = near ? 'near' : 'far';",
        // The height it drew to, so a box refilled at that height moves nothing above the reader. Keyed on the reading column's width as well as the theme: a drawing wider than the column is scaled to fit it, so its height is only true at that width.
        "const mermaidDrawnHeights = new Map();",
        "mermaidDrawnHeights.set(mermaidHeightKey(diagram.__mermaidSource), height);",
        "function mermaidHeightKey(source) {",
        // Exact, and the stylesheet's floor off with it: 19 of the 60 diagrams in the test document draw shorter than their own source text, and `min-height` cannot make a block shorter.
        "diagram.style.height = `${known}px`;",
        "diagram.style.minHeight = '0px';",
        // The whole document is drawn once the page is quiet, so nothing in it resizes afterwards. The pass hands nothing back itself — a finished drawing already asks to be watched, and the watcher puts a far one back at its drawn height.
        "function mermaidWarmCandidates() {",
        "function scheduleMermaidWarmPass() {",
        "if (queue.length) drawMermaidDiagrams(queue, true);",
        // A document past the memo's cap is left as it ships: past it both memos empty wholesale, so warming is a redraw of the document on every scroll.
        "if (mermaidDocumentPastMemory()) return [];",
        // Their gesture comes first, and the pass stops where it is rather than keeping a queue: the next attempt re-derives it from what has no measured height.
        "if (warming && readerScrolling) return;",
        // The column's width is half the key, so a change to it re-marks every waiting box and warms again rather than leaving one pinned to a height measured at another width.
        "function mermaidColumnWidthChanged() {",
        // No `requestIdleCallback` anywhere: the front end asks for idle time nowhere, and whether the Mac web view has it at all is not a thing this repo can answer offline.
        "await new Promise((resolve) => window.setTimeout(resolve, 0));",
        // The words stay where they are: a block whose bottom edge was already at or above the reader's top edge shoves what they can see, and what it gains is paid back in the same task as the draw.
        "function mermaidBlocksAboveReader(batch) {",
        "function mermaidRepayGrowthAbove(above) {",
        "setReaderScrollTop(app.scrollTop + gain);",
        // Drawing swaps a diagram's source out for its labels, so a search pointing into it re-walks and re-lands.
        "function mermaidPageTextChanged() {",
        "  refreshFind();",
        // A render swaps in a fresh body, so the boxes the watcher held are detached.
        "function forgetMermaidWatch() {",
        // A drawing off screen stops painting, and is handed the exact height it drew to so the block keeps its place while it is away. Both are written only after that height has been measured — the skip is what would otherwise make the measurement the placeholder's own size.
        "function skipMermaidPaintOffScreen(diagram, height) {",
        "diagram.style.containIntrinsicSize = `auto ${Math.max(0, Math.round(height - edges))}px`;",
        "diagram.style.contentVisibility = 'auto';",
        "skipMermaidPaintOffScreen(diagram, height);",
        // A box has no drawing to skip, so it goes back to painting like anything else.
        "function drawMermaidPaintAlways(diagram) {",
    ] {
        assert!(
            script.contains(expected),
            "the front-end should contain {expected}"
        );
    }

    // The root is the reader's own scroller, not the window: the document scrolls inside `app`. Scoped, because the watcher that puts a far diagram back writes the same margin.
    assert_in(
        script,
        "function watchMermaidDiagrams(candidates) {",
        "{ root: app, rootMargin:",
    );

    // The height is measured before the skip is written, or a drawing off screen measures the size it was standing in for and remembers that instead.
    let finish = script
        .split("function finishMermaidDiagram(diagram) {")
        .nth(1)
        .expect("the front-end finishes a drawing");
    let finish = &finish[..finish.find("\n}\n").expect("that function closes")];
    let measured = finish
        .find("const height = Math.round(diagram.getBoundingClientRect().height);")
        .expect("the drawing is measured");
    let skipped = finish
        .find("skipMermaidPaintOffScreen(diagram, height);")
        .expect("the drawing then stops painting off screen");
    assert!(
        measured < skipped,
        "the height must be read before the paint is skipped: {finish}"
    );

    // The drain waits for the gesture to stop: a diagram growing above the reader mid-scroll shifts the page under their thumb, and the re-pin that would put it back stands aside while they scroll.
    let drain = script
        .split("function scheduleMermaidPass() {")
        .nth(1)
        .expect("the front-end schedules a scroll-triggered pass");
    let drain = &drain[..drain.find("\n}\n").expect("the drain closes")];
    assert!(
        drain.contains("READER_SCROLL_SETTLE_MS"),
        "the draw must wait the same 120ms the reader already counts: {drain}"
    );
    assert!(
        drain.contains("if (readerScrolling) return;"),
        "a draw landing mid-gesture must stand down rather than run: {drain}"
    );
    assert!(
        !drain.contains("scheduleMermaidPass();"),
        "the pass must wait to be told the scroll settled, not set itself another timer: {drain}"
    );
    // And the settle is what tells it, only when something is actually held back.
    let settled = script
        .split("function readerScrollSettled() {")
        .nth(1)
        .expect("the front-end hears the reader's scroll settle");
    let settled = &settled[..settled.find("\n}\n").expect("that function closes")];
    assert!(
        settled.contains(
            "if (mermaidWaitingNearby.size || mermaidLeavingView.size) scheduleMermaidPass();"
        ),
        "the scroll settling must be what releases a held diagram pass: {settled}"
    );
    // An export holds every drawing on the page until the reader scrolls again, because the save window and the render both come after the pass; the settle is what lets the recycler back in.
    assert!(
        settled.contains("mermaidExportHolding = false;"),
        "the reader's next scroll is what ends an export's hold on the recycler: {settled}"
    );
    let settle = script
        .split("function settleReaderScroll() {")
        .nth(1)
        .expect("the front-end settles the reader's scroll");
    assert!(
        settle[..settle.find("\n}\n").expect("that function closes")]
            .contains("readerScrollSettled();"),
        "the reader's own settle must be what calls it"
    );
    // The undrawn box keeps its source text, so Ctrl+F still finds the words inside a diagram nobody has drawn.
    assert!(
        !script.contains("diagram.textContent = ''"),
        "an undrawn diagram's source is what Ctrl+F reads; it must stay in the page"
    );

    let css = reading_mode_css();
    // The rail is one shrunken slice of the page, so every cloned block is a few pixels tall — and a clone cloned with the skip on it skips its own contents outright, which blanked all 54 drawings in the thumbnail.
    assert_contains(css, ".document-minimap-preview pre.mermaid {");
    assert_contains(css, "content-visibility: visible !important;");
    // A box too far away to be queued does not spin, in both motion settings.
    assert_contains(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-wait=\"far\"])::after {",
    );
    assert_contains(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-diagram-wait=\"far\"])::after {",
    );
}

#[test]
fn a_diagram_scrolled_well_past_goes_back_to_a_box_only_past_the_memo_cap() {
    let script = app_shell_script();

    for expected in [
        // Three screens, against the one that queues a drawing: two screens of slack, so nothing flips back and forth at the edge of a band.
        "const MERMAID_FAR_SCREENS = 3;",
        "rootMargin: `${MERMAID_FAR_SCREENS * 100}% 0px`",
        "function recycleMermaidDiagram(diagram) {",
        "markMermaidWait(diagram, false);",
        // One reading of "more diagrams than the memos hold", spent by the warm pass and by the hand-back alike.
        "function mermaidDocumentPastMemory() {",
        "return !!body && body.querySelectorAll('pre.mermaid').length > MERMAID_CACHE_CAP;",
        "  if (mermaidDocumentPastMemory()) return [];",
    ] {
        assert!(
            script.contains(expected),
            "the front-end should contain {expected}"
        );
    }

    // The box goes back at exactly the height its drawing had, so recycling moves nothing on the page. Scoped, because the repaint after a theme change puts the same source text back.
    assert_in(
        script,
        "function recycleMermaidDiagram(diagram) {",
        "diagram.textContent = diagram.__mermaidSource;",
    );

    let may = script
        .split("function mermaidMayRecycle(diagram) {")
        .nth(1)
        .expect("the front-end decides what may be taken back");
    let may = &may[..may.find("\n}\n").expect("the guard closes")];
    // A diagram you have already read stays on the page: nothing is handed back on a document the memos can hold, which is what answers the empty box. Past their cap they empty wholesale — a box put back there is a redraw from scratch, and a 250-diagram page holding every drawing gives up a whole second in one frame.
    assert!(
        may.contains("if (!mermaidDocumentPastMemory()) return false;"),
        "a document the memos can hold must keep every drawing it makes: {may}"
    );
    // Editing it, or holding it anywhere other than where the page put it, is work of the reader's that a recycle would throw away.
    for kept in [
        "diagram.dataset.editingSource === 'true'",
        "diagram.classList.contains('is-moved')",
        "diagram.classList.contains('is-panning')",
        // The full-window view is a picture of the block, and its edit buttons act on the block: recycling it under the overlay hands back a box.
        "overlay.__diagramBlock === diagram",
    ] {
        assert!(
            may.contains(kept),
            "a diagram in this state must keep its drawing: {kept} — {may}"
        );
    }
    // Past 200 distinct diagrams the picture memo empties wholesale (MERMAID_CACHE_CAP), so a box refilled after that draws from scratch. Recycling one whose picture is gone would turn every scroll into a full redraw, which is worse than the stylesheet the drawing carries. The height has to be known at this column width, not just known: a box put back at a height measured in a narrower window is the jolt again with extra steps.
    for known in [
        "mermaidRenderCache.has(mermaidCacheKey(diagram.__mermaidSource))",
        "mermaidDrawnHeights.has(mermaidHeightKey(diagram.__mermaidSource))",
    ] {
        assert!(
            may.contains(known),
            "a diagram may only go back to a box when its picture and its height are both still known: {known} — {may}"
        );
    }

    // Both halves run off one settle, boxes first: a recycled box holds its drawing's height, so the drawings the pass then makes are the only thing that can move the page.
    let pass = script
        .split("function scheduleMermaidPass() {")
        .nth(1)
        .expect("the front-end schedules a scroll-triggered pass");
    let pass = &pass[..pass.find("\n}\n").expect("the pass closes")];
    let recycles = pass
        .find("recycleMermaidDiagram")
        .expect("the pass takes boxes back");
    let draws = pass
        .find("drawMermaidDiagrams")
        .expect("the pass draws what came near");
    assert!(
        recycles < draws,
        "boxes must go back before the pass draws: {pass}"
    );
    // A render swaps the body, so both watchers have to let go or they hold detached blocks.
    let forget = script
        .split("function forgetMermaidWatch() {")
        .nth(1)
        .expect("the front-end drops the watchers on a fresh document");
    let forget = &forget[..forget.find("\n}\n").expect("the reset closes")];
    for gone in [
        "mermaidViewObserver.disconnect()",
        "mermaidRecycleObserver.disconnect()",
    ] {
        assert!(
            forget.contains(gone),
            "a fresh document must drop both watchers: {gone}"
        );
    }
}

#[test]
fn a_drawn_diagram_opens_on_the_whole_window() {
    let html = app_shell_page();

    for expected in [
        // The fourth button sits with the zoom group, so a locked document gets it too, and only the block in the page carries it.
        "const MERMAID_FULL_BUTTON = ['full', 'Open it on the whole window', `<span class=\"lt-icon lt-icon-expand\"></span>`];",
        "row.appendChild(mermaidZoomGroup(MERMAID_ZOOM_BUTTONS.concat([MERMAID_FULL_BUTTON]), 'Diagram view'));",
        "if (step === 'full') openDiagramOverlay(diagram, zoomButton);",
        "function openDiagramOverlay(diagram, opener) {",
        "function closeDiagramOverlay() {",
        // The stage is the shape the delegated handlers already answer, built inside `app` because that is what they are bound to.
        "stage.className = 'mermaid diagram-stage';",
        "stage.dataset.diagramStage = 'true';",
        "app.appendChild(overlay);",
        // Escape, the X and the scrim, and focus back to the button that opened it.
        "document.addEventListener('keydown', onDiagramOverlayKey, true);",
        "close.addEventListener('click', closeDiagramOverlay);",
        "scrim.addEventListener('click', closeDiagramOverlay);",
        "leafFocusForKeyboard(overlay.__diagramOpener);",
    ] {
        assert_contains(&html, expected);
    }
    // Both sweeps leave the stage alone: it is a `pre.mermaid` inside `app` like any other, and an overlay-sized SVG in the render memo would come back in the page at that size.
    for sweep in [
        "function renderMermaidDiagrams() {",
        "function mermaidWarmCandidates() {",
    ] {
        assert_in(&html, sweep, "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-stage])");
    }
    assert_contains(
        &html,
        "app.querySelectorAll('pre.mermaid:not([data-diagram-stage])')",
    );
    // So the stage is drawn by name instead, on a theme change and nowhere near the memo.
    assert_contains(&html, "repaintDiagramOverlay();");
    assert_contains(&html, "await mermaid.run({ nodes: [stage] });");
    let script = app_shell_script();
    let fragment = script
        .split("function openDiagramOverlay")
        .nth(1)
        .expect("the full-window diagram fragment");
    assert!(
        !fragment.contains("mermaidRenderCache."),
        "the overlay must never write its own SVG into the render memo"
    );
    // A render empties `app`, which would take the overlay with it and leave the Escape handler listening for a diagram that is gone.
    for entry in [
        "function renderState() {",
        "function renderCodeView(state) {",
    ] {
        let body = script.split(entry).nth(1).expect(entry);
        let head = &body[..body
            .find("app.innerHTML")
            .expect("the render that empties app")];
        assert!(
            head.contains("closeDiagramOverlay();"),
            "{entry} empties app without taking the overlay down first"
        );
    }
    // It opens at Fit: a zoom number counts from what the box laid out, so the page's own would mean a different size here.
    assert_contains(&html, "stage.__mermaidNatural = null;");
    assert_contains(&html, "stage.__mermaidView = null;");
}

#[test]
fn the_full_window_diagram_carries_the_edit_buttons_on_an_unlocked_markdown_document() {
    let script = app_shell_script();
    let tools = script
        .split("function addDiagramStageTools(stage) {")
        .nth(1)
        .expect("the overlay's edit buttons");
    let tools = &tools[..tools.find("\n}\n").expect("the function closes")];

    // The same two conditions the block in the page is held to, so a locked document or a JSON file gets neither button.
    assert_contains(
        tools,
        "if (!block || currentDocumentFormat !== 'markdown' || !readerEditingAllowed()) return;",
    );
    assert_contains(
        tools,
        "if (!Number.isFinite(Number(block.dataset.srcStart)) || !Number.isFinite(Number(block.dataset.srcEnd))) return;",
    );
    // The same two buttons, built by the same maker rather than a second copy of them.
    assert_contains(tools, "mermaidToolButton('source',");
    assert_contains(tools, "mermaidToolButton('sheet',");
    // Both hand the document back to the page, so the overlay goes first and the block is what they act on.
    assert_contains(tools, "closeDiagramOverlay();");
    assert_contains(tools, "startBlockSourceEdit(block);");
    assert_contains(tools, "openMermaidBlockSheet(block);");
    assert!(
        !tools.contains("(stage)"),
        "the stage has no place in the file behind it; both buttons act on the block"
    );
    // Listened to here, not by the delegated handler in decorate.js — which would hand it the stage.
    assert_contains(tools, "event.stopPropagation();");
}

#[test]
fn a_diagram_bound_for_a_picture_puts_its_labels_in_text() {
    // A mermaid label is a `<foreignObject>` holding a `<div>`, and an SVG loaded as an image drops one outright — which came out as boxes with nothing written in them. Stated on every call, not only the picture's: initialize merges, so a config quiet about it leaves that answer behind for the page.
    let html = app_shell_page();

    // The picture's own call is in the flowchart editor, at the head of the script.
    assert_contains(
        app_shell_script(),
        "mermaid.initialize(mermaidRuntimeConfig({ htmlLabels: false }));",
    );
    assert_contains(&html, "    htmlLabels,\n    flowchart: { htmlLabels },");
    // The page's own draw leaves the answer alone, and the bare call is made in several places.
    assert_in(
        &html,
        "function drawMermaidBatches(diagrams, generation, warming) {",
        "mermaid.initialize(mermaidRuntimeConfig())",
    );
}

#[test]
fn app_shell_loads_bundled_katex_and_renders_math_after_document_insert() {
    let html = app_shell_page();

    for expected in [
        "katex/katex.min.js",
        "katex/katex.min.css",
        "let katexLoadPromise = null;",
        "function loadKatex() {",
        "function renderMathElements() {",
        "renderMathElements();",
    ] {
        assert_contains(&html, expected);
    }

    // Both places that read it are in the one render, so that is what has to hold it.
    assert_in(
        &html,
        "function renderMathElements() {",
        "node.classList.contains('math-display')",
    );
}

#[test]
fn app_shell_routes_fragment_links_through_reader_anchor_scrolling() {
    let html = app_shell_page();

    assert_contains(&html, "window.leafScrollToFragment = (fragment) => {");
    assert_contains(
        &html,
        "const target = document.getElementById(decoded) || document.getElementById(raw);",
    );
    assert_in(
        &html,
        "window.leafScrollToFragment = (fragment) => {",
        "target.focus({ preventScroll: true });",
    );
    assert_contains(&html, "function sameDocumentFragmentHref(rawHref) {");
    assert_contains(&html, "if (rawHref.startsWith('#')) {");
    assert_contains(&html, "if (rawHref.startsWith('./#')) {");
    assert_contains(&html, "return rawHref.slice(2);");
    assert_contains(&html, "if (rawHref.startsWith('.#')) {");
    assert_contains(&html, "return rawHref.slice(1);");
    assert_contains(
        &html,
        "const fragmentHref = sameDocumentFragmentHref(rawHref);",
    );
    assert_contains(&html, "if (fragmentHref) {");
    // The page swallows a default all over, so the link binding is the one that has to here.
    assert_in(
        &html,
        "function bindDocumentLinks() {",
        "event.preventDefault();",
    );
    assert_contains(
        &html,
        "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
    );
    assert_contains(
            &html,
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });",
        );
    assert!(
            html.contains("if (fragmentHref) {")
                && html.contains("send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });")
                && html.contains("send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });"),
            "fragment-only links must be sent through app navigation before non-fragment links are routed"
        );
}

#[test]
fn app_shell_sends_a_link_the_way_its_author_wrote_it() {
    let html = app_shell_page();

    assert_contains(
            &html,
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });",
        );
    // A published site is one page, so an href the browser resolved names a document at the top of the site rather than one beside the document being read. Both hosts resolve a written href against the open document, which is the only thing that knows where it sits.
    for resolved in ["documentLinkHref", "href: link.href || rawHref"] {
        assert!(
            !html.contains(resolved),
            "a document link must be sent as written, never as the browser resolved it: {resolved}"
        );
    }
}

#[test]
fn app_shell_opens_a_held_or_middle_click_as_a_page_of_its_own() {
    let html = app_shell_page();

    // A bail on a held key returns before the preventDefault below it, which leaves the click to the web view's own link handling.
    assert!(
        !html.contains("event.button !== 0 || event.altKey || event.ctrlKey"),
        "a modified click on a document link must be canceled, not handed to the web view"
    );

    for expected in [
        "function newPageModifierHeld(event) {",
        "return isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;",
        "sendDocumentLink(link, newPageModifierHeld(event));",
        "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });",
        "app.addEventListener('mousedown', (event) => {",
        // A middle click only acts where there is a page to open.
        "if (!link || !isAnotherPageHref(link.getAttribute('href'))) {",
    ] {
        assert_contains(&html, expected);
    }

    // The middle button raises `auxclick` and never `click`; the web view's own scroll puck opens on the mousedown before it, so both are answered. All three of these lines are in the page more than once, so the link binding is what has to carry them.
    for expected in [
        "app.addEventListener('auxclick', (event) => {",
        "const link = event.button === 1 ? documentLinkFor(event.target) : null;",
        "sendDocumentLink(link, true);",
    ] {
        assert_in(&html, "function bindDocumentLinks() {", expected);
    }

    // One platform test for the whole front-end, shared out of state.js — the menu reads it for Ctrl-click and the link handler for which key opens a page.
    assert_eq!(
        html.matches("const isMacPlatform =").count(),
        1,
        "isMacPlatform belongs to state.js once, not to each fragment reading it"
    );
}

#[test]
fn app_shell_gives_a_document_link_its_own_right_click_menu() {
    let html = app_shell_page();

    for expected in [
        "const LINK_MENU_ITEMS = [",
        "{ action: 'openLink', label: 'Open' },",
        "{ action: 'openLinkInNewPage', label: 'Open in new page', pageOnly: true },",
        "{ action: 'copyLink', label: 'Copy link' },",
        "{ action: 'copyLinkText', label: 'Copy link text' },",
        "{ action: 'revealLink', label: 'Reveal file', fileBehind: true },",
        "{ action: 'copyLinkPath', label: 'Copy path', fileBehind: true },",
        "showContextMenu(event.clientX, event.clientY, href, 'link', documentLink);",
        // An external link and an in-page jump have no page here to open, so the items that would need one are left out rather than shown dead.
        "!entry.pageOnly || isAnotherPageHref(contextMenuPath)",
        // The two that act on the file want one behind the link rather than somewhere in the app to go, so a saved page or a PDF beside the note carries them.
        "if (entry.fileBehind) return linkHasAFileBehindIt(contextMenuPath);",
        // The one item that leaves the app says where it is sending you, in the words the hover tip over that same link already uses.
        "const LINK_OPEN_LABELS = { 'External site': 'Open in browser', 'Opens in another app': 'Open in another app', 'Email link': 'Open in your mail app' };",
        "const label = LINK_OPEN_LABELS[linkHoverKind(contextMenuPath)];",
        "return { action: entry.action, label };",
        // The two copies are the page's own; only a real path has to go to the host.
        "function copyPlainText(text) {",
        "case 'copyLink': copyPlainText(path); break;",
        "send({ command: 'revealLink', href: path })",
        "send({ command: 'copyLinkPath', href: path })",
    ] {
        assert_contains(&html, expected);
    }

    // The link branch answers ahead of the pane's rows, which know nothing about a link and would otherwise take the right-click first.
    let link_branch = html
        .find("const documentLink = documentLinkFor(event.target);")
        .expect("the contextmenu handler tests for a document link");
    let row_branch = html
        .find("const row = event.target.closest('[data-reveal-path]');")
        .expect("the contextmenu handler tests for a pane row");
    assert!(
        link_branch < row_branch,
        "a link in the document must be matched before the library pane's rows"
    );
}

#[test]
fn app_shell_gives_the_reading_page_its_file_actions_right_click_menu() {
    let html = app_shell_page();

    assert_contains(&html, "const PAGE_MENU_ITEMS = [");
    assert_contains(
        &html,
        "showContextMenu(event.clientX, event.clientY, activeDocumentPath(), 'page');",
    );

    // Every one of these rows is in the pane's own menu too, so the page's list is the one that has to hold them.
    for row in [
        "{ action: 'favorite', label: 'Favorite' },",
        "{ action: 'copyPath', label: 'Copy path' },",
        "{ action: 'reveal', label: 'Reveal file' },",
        "{ action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },",
        "{ action: 'delete', label: 'Delete', danger: true },",
    ] {
        assert_in(&html, "const PAGE_MENU_ITEMS = [", row);
    }
    // And the menu the page opens is picked by that kind, in the one place that picks a list.
    assert_in(
        &html,
        "function contextMenuEntries() {",
        "contextMenuTargetKind === 'page'",
    );

    let link_branch = html
        .find("const documentLink = documentLinkFor(event.target);")
        .expect("the contextmenu handler tests for a document link");
    let row_branch = html
        .find("const row = event.target.closest('[data-reveal-path]');")
        .expect("the contextmenu handler tests for a pane row");
    let page_branch = html
        .find("event.target.closest('.reader-layout')")
        .expect("the contextmenu handler tests for the reading page");
    assert!(
        link_branch < row_branch && row_branch < page_branch,
        "a link and a pane row must keep their own right-click menus before the page menu"
    );

    assert!(html.contains("if (!editable && event.target.closest('.reader-layout'))"));
    assert!(
        !html.contains("if (!editable && event.target.closest('.document-body'))"),
        "the reader layout includes the page gutter beyond the document body"
    );
    assert!(
        html.contains("if (!path) {\n    return;\n  }"),
        "a start screen with no active document must not open a menu"
    );

    let page_items = html
        .find("const PAGE_MENU_ITEMS = [")
        .expect("the page has its own menu items");
    let delete = html[page_items..]
        .find("{ action: 'delete', label: 'Delete', danger: true },")
        .expect("the page menu ends in delete");
    let close = html[page_items..]
        .find("];\nfunction hideContextMenu")
        .expect("the page menu closes after its entries");
    assert!(
        delete < close,
        "Delete is the last action in the page menu behind its separator"
    );
    let page_menu = &html[page_items..page_items + close];
    assert!(
        page_menu
            .ends_with("  'separator',\n  { action: 'delete', label: 'Delete', danger: true },\n"),
        "Delete is separated from the other page actions and comes last"
    );
}

#[test]
fn app_shell_routes_in_page_history_through_app_navigation() {
    let html = app_shell_page();

    for expected in [
        "function sendNavigationCommand(command) {",
        "send({ command, scroll_anchor: currentScrollAnchor() });",
        "backButton.disabled = !navigationState.canGoBack;",
        "forwardButton.disabled = !navigationState.canGoForward;",
        "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
    ] {
        assert_contains(&html, expected);
    }

    for removed in [
        "let inPageHistory = { back: [], forward: [] };",
        "window.history.back();",
        "window.history.forward();",
        "window.history.pushState(null, '', fragmentHref);",
        "window.addEventListener('popstate', handleInPageHistoryTraversal);",
    ] {
        assert!(
                !html.contains(removed),
                "in-page navigation must be handled by app history instead of browser history: {removed}"
            );
    }
}

#[test]
fn code_blocks_get_a_copy_button() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // Decoration runs after each document render, over code blocks but not Mermaid diagrams, and copies the <code> text.
    assert!(html.contains("decorateCodeBlocks();"));
    assert!(html.contains(".document-body pre:not(.mermaid)"));
    assert!(html.contains("function copyCodeBlock(button, text)"));
    // Clipboard API with an execCommand fallback for locked-down webviews.
    assert_in(
        &html,
        "function copyCodeBlock(button, text) {",
        "navigator.clipboard.writeText(text)",
    );
    assert!(html.contains("document.execCommand('copy')"));
    // The button styling and copied-state swap exist.
    assert!(css.contains(".document-body pre > .code-copy {"));
    assert!(css.contains(".code-copy.is-copied .code-copy-check {"));

    // Both labels the button swaps between are present.
    assert_in(
        &html,
        "function decorateCodeBlocks() {",
        "setCodeCopyLabel(button, 'Copy code');",
    );
    assert!(html.contains("setCodeCopyLabel(button, 'Copied');"));
}

#[test]
fn select_all_in_the_reading_view_selects_only_the_page() {
    let html = app_shell_page();

    // A native Ctrl/Cmd+A selects the whole shell — library pane, toolbar and all — so copying a page drags the chrome along. The shortcut selects just the rendered document, and stands aside for editable fields and the code view, whose native select-all is scoped already.
    assert!(html.contains("event.key.toLowerCase() === 'a'"));
    assert!(html.contains("if (!caretBlock && isEditableMouseTarget(event.target))"));
    assert!(html.contains("range.selectNodeContents(body)"));
    // The page makes both calls all over, so the shortcut's own branch is what has to.
    for expected in ["selection.removeAllRanges()", "selection.addRange(range)"] {
        assert_in(
            &html,
            "if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {",
            expected,
        );
    }

    // With the caret in a block it widens a step per press instead — block, section, page — and the first press has to stay the browser's own, so the early return is what the step reaches rather than something that replaced it.
    assert!(html.contains("const caretBlock = caretBlockForSelectAll(event.target);"));
    assert!(html.contains("const wanted = selectAllTargetFor(caretBlock);"));
    assert!(html.contains("if (wanted.browser) {"));
    assert!(html.contains("selectBlockRun(wanted.section);"));
}
