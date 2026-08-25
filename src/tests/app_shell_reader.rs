//! The reader surface: minimap interaction, scroll anchoring, in-page editing.

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
    assert_contains(&html, "line.className = 'blockquote-line';");
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
        "if (readerLayout) {\n      readerLayout.style.removeProperty('display');\n      if (arriving) fadeDocumentIn(readerLayout);\n    }",
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
fn app_shell_builds_collapsed_heading_outline_under_the_title() {
    let html = app_shell_page();

    // The builder exists, is wired into the render pipeline, and the line count skips the outline's own link-only entries rather than counting them.
    assert_contains(&html, "function buildDocumentOutline() {");
    assert_contains(&html, "buildDocumentOutline();");
    assert_contains(&html, "if (target.closest('.document-outline')) return;");
    // A title plus at least one section, inserted just under the title.
    assert_contains(&html, "if (headings.length < 2) return;");
    assert_contains(&html, "title.insertAdjacentElement('afterend', details);");
    // Collapsed <details> with an "Outline" summary, entries nested as a bulleted list (numbers overflow the panel on deep documents) that links each heading by its slug id.
    assert_contains(&html, "details.className = 'document-outline';");
    assert_contains(&html, "summaryLabel.textContent = 'Outline';");
    assert_contains(&html, "const rootList = document.createElement('ul');");
    assert!(!html.contains("const rootList = document.createElement('ol');"));
    assert_contains(&html, "link.className = 'document-outline-link';");
    assert_contains(&html, "link.href = '#' + encodeURIComponent(h.id);");
    // The summary carries how long the document is — counted, not stamped onto every block on the way to the total.
    assert_contains(&html, "summaryCount.className = 'document-outline-count';");
    assert_contains(&html, "function documentLineCount(body) {");
    assert_contains(&html, "`(${formatCount(documentLineCount(body))} lines)`");
    // The (potentially ~25k-entry) list is built lazily, only when the reader first expands the outline — not at every document render.
    assert_contains(&html, "function populateDocumentOutline(details, rest) {");
    assert_contains(&html, "details.addEventListener('toggle', () => {");
    assert_contains(
        &html,
        "if (details.open) populateDocumentOutline(details, rest);",
    );
    // The outline never opens on its own — closed until the reader expands it.
    assert!(!html.contains("details.open = true"));
    // The label and the line-count suffix are both present.
    assert_contains(&html, "summaryLabel.textContent = 'Outline';");
}

#[test]
fn app_shell_renders_interactive_document_minimap() {
    let html = app_shell_page();

    for expected in [
            "renderDocumentMinimap(state.document.minimap)",
            "function renderDocumentMinimap(model) {",
            "document-minimap-track",
            "document-minimap-content",
            "document-minimap-viewport",
            "aria-label=\"Document minimap\"",
            "aria-hidden=\"true\"><div class=\"document-minimap-content\" aria-hidden=\"true\"></div><div class=\"lt-spinner document-minimap-spinner\" aria-hidden=\"true\"></div><div class=\"document-minimap-viewport\" aria-hidden=\"true\"",
            "bindDocumentMinimap();",
            "function bindDocumentMinimap() {",
            // The rail says it is working until there is a thumbnail to show: the clone can't exist before the document has been laid out, and on a large file an empty rail beside a finished page looks broken.
            "class=\"document-minimap is-loading\"",
            "minimap.classList.remove('is-loading');",
        ] {
            assert_contains(&html, expected);
        }

    // The hold a diagram pass takes must never name that state — a wheel down a page of diagrams is a settle and a pass every few hundred milliseconds, so the box blinked all the way down. The hold itself stays: one rebuild per pass rather than one per batch of three.
    assert!(
        !html.contains("minimapPreviewHolds += 1;\n  // Say it is working"),
        "the hold a diagram pass takes must not turn the rail's loading state on"
    );
    assert_contains(
        &html,
        "function pauseMinimapPreview() {\n  minimapPreviewHolds += 1;",
    );
    // What owns it instead is the warm: until every diagram has been measured once the thumbnail is a picture of boxes, because it is a clone of the page and an undrawn diagram has nothing in the memo for the clone to take. So the rail says it is working for the whole wait and stops when the last box is measured — one state for the wait rather than one per pass.
    for expected in [
        "function markMinimapWarming() {",
        "if (mermaidWarmCandidates().length) minimap.classList.add('is-loading');",
        "else minimap.classList.remove('is-loading');",
        // And a box the page has handed back is filled from the memo before the clone goes on screen, so the picture is of the document rather than of its blanks.
        "function fillMermaidClone(preview) {",
        "fillMermaidClone(preview);",
    ] {
        assert_contains(&html, expected);
    }

    // The minimap is a real-text thumbnail: a shrunken clone of the rendered document, not an abstract canvas painting.
    assert!(
        html.contains("preview = source.cloneNode(true);"),
        "minimap must clone the document into a scaled preview"
    );
    assert!(
        !html.contains("document-minimap-canvas"),
        "minimap no longer paints an abstract canvas"
    );
}

#[test]
fn app_shell_builds_minimap_preview_from_document_clone() {
    let html = app_shell_page();
    let css = reading_mode_css();

    for expected in [
        "let minimapPreviewFrame = 0;",
        "let minimapResizeObserver = null;",
        "let minimapBodyObserver = null;",
        "let readerLayoutFrame = 0;",
        "let readerScrollAnchor = null;",
        "function bindDocumentMinimapPreview(track) {",
        // Content changes bump the version so the clone is rebuilt; geometry-only triggers (resize) skip the rebuild unless a width changed.
        "minimapBodyObserver = new MutationObserver(invalidateMinimapPreview);",
        "minimapResizeObserver = new ResizeObserver(() => {",
        "minimapResizeObserver.observe(track);",
        "image.addEventListener('load', invalidateMinimapPreview, { once: true });",
        "function invalidateMinimapPreview() {",
        "minimapContentVersion += 1;",
        "function disconnectMinimapPreviewObservers() {",
        "window.cancelAnimationFrame(minimapPreviewFrame);",
        "function scheduleMinimapPreviewUpdate() {",
        "minimapPreviewFrame = window.requestAnimationFrame(() => {",
        "function updateDocumentMinimapPreview() {",
        // The clone is skipped when nothing shaping the thumbnail changed, so a height-only resize doesn't rebuild the whole document.
        "minimapBuiltVersion === minimapContentVersion &&",
        "minimapBuiltSourceWidth === metrics.sourceWidth &&",
        "minimapBuiltPreviewWidth === previewWidth &&",
        "minimapBuiltFrameWidth === frameWidth &&",
        "preview = source.cloneNode(true);",
        "preview.classList.add('document-minimap-preview');",
        // The clone is laid out inside a frame the width of the reading layout's content box, and the frame is what scales: without it a document's container queries measure the whole window, a wide table is drawn wider than the page draws it, and the thumbnail ends short of the bottom. The content box, so the layout's inline padding — outside the container query — is not counted.
        "function minimapFrameWidth(fallbackWidth) {",
        "const layout = app.querySelector('.reader-layout');",
        "const width = layout.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);",
        "const frameWidth = minimapFrameWidth(metrics.sourceWidth);",
        "frame.className = 'document-minimap-frame';",
        "frame.style.width = `${frameWidth}px`;",
        "frame.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;",
        "frame.style.transform = `translateY(${firstTop * previewScale}px) scale(${previewScale})`;",
        "frame.appendChild(preview);",
        "content.replaceChildren(frame);",
        "updateMinimapViewport();",
        // A document taller than the rail is cloned as the slice the rail can actually show, not whole: a full clone put a second copy of every element on the page, which cost ~890ms a frame to slide on a 4MB glossary. The window is still a clone of the real rendering, so the rail keeps real text — and on any document the rail can show in full it IS the whole document, which is why nothing here is gated on a size threshold.
        "function minimapWindowCoversView(metrics, scrollTop) {",
        "function minimapVisibleDocumentRange(metrics, scrollTop) {",
        "function minimapFirstBlockPast(rows, appTop, scrollTop, offset) {",
        "const windowsIt = rows.length > 0 && metrics.scaledDocumentHeight > metrics.trackHeight;",
        "preview = buildWindowedMinimapClone(source, first, last);",
        "function minimapWindowRows(source) {",
        "function buildWindowedMinimapClone(source, first, last) {",
        "into.appendChild(rows[i].cloneNode(true));",
        // Scrolling reads no geometry at all — cached metrics, arithmetic, and CSS variable writes. Re-measuring per wheel click forced a fresh layout of the whole document, which is what made one click take ~2 seconds.
        "function minimapMetricsForScroll(track) {",
        "function invalidateMinimapMetrics() {",
        "function updateMinimapViewportFromScroll() {",
        // Glossary terms are tagged before their hrefs are stripped so the clone can re-blend them (the href-based body blend can't match once href is gone).
        "link.classList.add('glossary-term');",
    ] {
        assert_contains(&html, expected);
    }

    // The clone keeps glossary terms blended into body text like the page, instead of showing them on the generic accent link color.
    assert_contains(
        &css,
        ".document-minimap-preview a.glossary-term {\n  color: inherit;\n}",
    );

    // The thumbnail is a real-text clone, never an abstract canvas: no drawing surface of its own, no palette, no line-model rows. Named markers rather than "no 2D context anywhere" — the diagram export rasterizes one. Checked across the shell and the linked stylesheet, since the styles are not inlined.
    for forbidden in [
        "document-minimap-canvas",
        "minimapCanvas",
        "function drawDocumentMinimapCanvas() {",
        "const scaleY = cssHeight / model.line_count;",
        "readColor('--minimap-heading'",
        "minimapThemeUnsubscribe",
        "minimapResizeObserver.observe(source)",
    ] {
        assert!(
            !html.contains(forbidden) && !css.contains(forbidden),
            "minimap preview must not reintroduce the canvas or scroll-churn path: {forbidden}"
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
fn app_shell_maps_minimap_geometry_proportionally() {
    let html = app_shell_page();

    // The box and click/drag mapping derive from the reader's real scroll range, so they track the thumbnail at any length; on tall documents the thumbnail slides in the rail.
    for expected in [
            "const previewScale = contentWidth / sourceWidth;",
            "const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportDocumentTop = scrollTop * metrics.previewScale;",
            "const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;",
            "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
            "content.style.transform = `translateY(${previewTop}px)`;",
            "viewport.style.top = `${viewportTop}px`;",
            "viewport.style.height = `${boundedViewportHeight}px`;",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("function minimapViewportGeometry(metrics) {"),
        "the clone minimap replaces the canvas geometry helper"
    );
    // The reader renders in full, so the box reads the exact scroll position rather than a table of block offsets.
    assert!(
        !html.contains("minimapCloneOffsets") && !html.contains("minimapReaderTrueScrolled"),
        "the full-render minimap drops the clone-offset scroll estimate"
    );
}

#[test]
fn app_shell_loads_mermaid_and_renders_diagram_fences_after_document_insert() {
    let html = app_shell_page();

    for expected in [
        "mermaid.min.js",
        "let mermaidLoadPromise = null;",
        "renderMermaidDiagrams();",
        "function loadMermaid() {",
        "function renderMermaidDiagrams() {",
        "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])",
        "mermaid.initialize(mermaidRuntimeConfig())",
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
        // The root is the reader's own scroller, not the window: the document scrolls inside `app`.
        "{ root: app, rootMargin:",
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
    assert!(
        script.contains("function readerScrollSettled() {\n  if (mermaidWaitingNearby.size || mermaidLeavingView.size) scheduleMermaidPass();"),
        "the scroll settling must be what releases a held diagram pass"
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
        // The box goes back at exactly the height its drawing had, so recycling moves nothing on the page.
        "diagram.textContent = diagram.__mermaidSource;",
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
    assert_contains(
        &html,
        "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]):not([data-diagram-stage])",
    );
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
    assert_contains(&html, "mermaid.initialize(mermaidRuntimeConfig())");
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
        "node.classList.contains('math-display')",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_throttles_minimap_scroll_sync() {
    let html = app_shell_page();

    for expected in [
        "let minimapViewportFrame = 0;",
        "function scheduleMinimapViewportUpdate() {",
        "window.requestAnimationFrame(() => {",
        "function updateMinimapViewport() {",
        "app.addEventListener('scroll', () => {",
        "clampReaderScrollPosition();",
        "refreshReaderScrollAnchor();",
        "scheduleMinimapViewportUpdate();",
        "window.addEventListener('resize', () => {",
        "scheduleReaderLayoutUpdate();",
        "scheduleMinimapViewportUpdate();",
        "scheduleMinimapPreviewUpdate();",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_clicks_minimap_to_scroll_document() {
    let html = app_shell_page();

    for expected in [
        "const scrollToMinimapSnapshotPoint = (event) => {",
        "const content = track.querySelector('.document-minimap-content');",
        "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
        "app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));",
        "track.addEventListener('pointerdown', (event) => {",
        "if (Number.isFinite(minimapPointerOffsetY)) {",
        "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
        "} else {",
        "scrollToMinimapSnapshotPoint(event);",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_drags_minimap_to_scroll_document() {
    let html = app_shell_page();

    for expected in [
            "let minimapPointerId = null;",
            "let minimapPointerOffsetY = null;",
            "const minimapPointerOffset = (event) => {",
            "return event.clientY - viewportRect.top;",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const previewTravel = Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);",
            "const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;",
            "placeMinimapViewport(minimap, metrics, boundedScrollTop);",
            "minimapPointerOffsetY = minimapPointerOffset(event);",
            "leafHoldPointer(track, event.pointerId);",
            "track.addEventListener('pointermove', (event) => {",
            "if (event.pointerId !== minimapPointerId) {",
            "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
            "minimapPointerOffsetY = null;",
            "track.addEventListener('pointerup', endDrag);",
            "track.addEventListener('pointercancel', endDrag);",
            "track.addEventListener('lostpointercapture', endDrag);",
        ] {
            assert_contains(&html, expected);
        }

    // A grab inside the box preserves the offset (drag); a bare click centers the reader on the pointer (snapshot). The drag handler is defined before the snapshot handler in bindDocumentMinimap.
    let drag_position = html
        .find("const dragMinimapViewportToPointer = (event, pointerOffsetY) => {")
        .expect("minimap drag handler exists");
    let snapshot_position = html
        .find("const scrollToMinimapSnapshotPoint = (event) => {")
        .expect("minimap click-to-scroll handler exists");
    assert!(
        drag_position < snapshot_position,
        "drag handler is defined before the snapshot handler"
    );
    assert!(
        !html.contains("minimapDragStartScrollTop"),
        "minimap drag maps through the scroll range, not a cached start offset"
    );
}

#[test]
fn app_shell_preserves_focus_and_updates_minimap_viewport_indicator() {
    let html = app_shell_page();

    for expected in [
        "const restoreFocus = () => {",
        "const active = document.activeElement;",
        "active.focus({ preventScroll: true });",
        "event.preventDefault();",
        "viewport.style.top = ",
        "viewport.style.height = ",
        "updateMinimapViewport();",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_sizes_minimap_viewport_from_scroll_fraction() {
    let html = app_shell_page();

    // The box height is the reader window at thumbnail scale, placed from the slide plus scaled scroll top, so it tracks the visible region at any length.
    let box_height_position = html
        .find("const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);")
        .expect("viewport box height is the reader window at the thumbnail scale");
    let preview_top_position = html
            .find("const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);")
            .expect("the thumbnail slides by the scroll ratio");
    let box_top_position = html
            .find("const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));")
            .expect("box top combines the thumbnail slide and the scaled scroll top");

    assert!(
        box_height_position < preview_top_position && preview_top_position < box_top_position,
        "viewport geometry should size the box, slide the thumbnail, then place the box"
    );
    assert!(
        !html.contains("const boxTop = scrollFraction * travel;"),
        "the clone minimap replaces the canvas fraction-only box placement"
    );
}

#[test]
fn app_shell_sizes_minimap_track_to_available_reader_height() {
    let html = app_shell_page();

    for expected in [
        "function minimapAvailableHeight(minimap) {",
        "const shellRect = app.getBoundingClientRect();",
        "const minimapRect = minimap.getBoundingClientRect();",
        "return Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));",
        "function measureDocumentMinimap(track) {",
        "const scrollHeight = Math.max(1, Math.ceil(app.scrollHeight));",
        "const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));",
        "const scrollable = Math.max(0, scrollHeight - viewportHeight);",
        "const scrollTop = Math.min(scrollable, Math.max(0, app.scrollTop));",
        "const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);",
        "const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;",
        "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));",
        "track.style.height = `${trackHeight}px`;",
    ] {
        assert_contains(&html, expected);
    }

    // The track caps its height at the scaled document height, so a short document gets a short rail with no dead space below it.
    assert!(
        html.contains(
            "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));"
        ),
        "track sizing caps at the scaled thumbnail height"
    );
}

#[test]
fn app_shell_rebinds_minimap_after_document_updates() {
    let html = app_shell_page();

    for expected in [
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            // Rendered hidden, then revealed already decorated: see renderState.
            "app.innerHTML = `<div class=\"${layoutClass}\" style=\"display:none\">${state.document.html}</div>`;",
            "setMinimapMarkup(minimapHtml);",
            "bindDocumentMinimap();",
            "updateMinimapViewport();",
        ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_reader_editor_round_trips_safe_inline_html() {
    let html = app_shell_page();

    for expected in [
        "const MARKDOWN_RAW_INLINE_TAGS = new Set(['abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div']);",
        "div: ['align', 'id'],",
        "return '<' + tag + rawInlineHtmlAttributes(el, tag) + '>' + inlineDomToMarkdown(el) + '</' + tag + '>';",
        "out += '<br>';",
        "'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',",
        "out += rawInlineHtmlToMarkdown(child, tag);",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn one_find_bar_serves_both_views_and_replaces_through_the_source() {
    let html = app_shell_page();

    // The bar, its field and counter, the three how-to-match toggles and the scope one, both steps, and the replace row.
    for expected in [
        r#"<div id="findBar" class="find-bar" role="search" aria-label="Find in this document" hidden>"#,
        r#"<input id="findInput" class="find-input" type="text""#,
        r#"<span id="findCount" class="find-count" aria-live="polite">"#,
        r#"title="Match case (Alt+C)">Aa</button>"#,
        r#"title="Whole word (Alt+W)">ab|</button>"#,
        r#"title="Regular expression (Alt+R)">.*</button>"#,
        r#"title="Find in selection (Alt+L)""#,
        r#"title="Previous match (Shift+Enter)""#,
        r#"title="Next match (Enter)""#,
        // Every control on the bar carries the app bar's own icon button. The class and the stylesheet are each half of the 32px box, so both are checked.
        r#"id="findPrev" class="find-step icon-button""#,
        r#"id="findClose" class="find-step icon-button""#,
        r#"id="findMatchCase" class="find-flag icon-button""#,
        r#"id="findInSelection" class="find-flag icon-button""#,
        r#"id="findReplaceAll" class="find-action icon-button""#,
        // `folds` is the mark: the row slides down to its height rather than the bar arriving at a new one.
        r#"<div class="find-row find-replace-row folds" id="findReplaceRow" hidden>"#,
        // A cursor on every match takes hold of them, so it stands with Previous and Next on the row that is always there — the two-caret mask says more than one cursor.
        r#"<button type="button" id="findSelectAll" class="find-step icon-button" aria-label="Put a cursor on every match" title="Put a cursor on every match (Alt+Enter)"><span class="lt-icon lt-icon-select-all"></span></button>"#,
    ] {
        assert_contains(&html, expected);
    }

    // On the always-visible row, between Next and the Replace toggle — and out of the hidden replace row, which now holds only Replace and All.
    let place = |id: &str| {
        html.find(id)
            .unwrap_or_else(|| panic!("{id} is not in the page"))
    };
    let replace_row = place(r#"id="findReplaceRow""#);
    let select_all = place(r#"id="findSelectAll""#);
    assert!(
        place(r#"id="findNext""#) < select_all && select_all < place(r#"id="findReplaceToggle""#),
        "the cursor-on-every-match button does not sit between Next and Replace"
    );
    assert!(
        select_all < replace_row,
        "the cursor-on-every-match button is still in the hidden replace row"
    );

    // One keyboard path, and it reaches both views: Ctrl+F opens, Ctrl+H opens on the replace row, Escape closes, Enter steps.
    for expected in [
        "(key === 'f' || key === 'h')",
        "openFindBar({ replacing: key === 'h' });",
        "closeFindBar();",
        "else findStep(event.shiftKey ? -1 : 1);",
        "return codeViewActive && !!monacoEditor;",
    ] {
        assert_contains(&html, expected);
    }

    // The source view uses the editor's own searching, and nothing was added to the vendored bundle for it.
    for expected in [
        "const found = model.findMatches(",
        "monacoEditor.createDecorationsCollection(decorations);",
        "monacoEditor.executeEdits('leaf-find', edits);",
        "monacoEditor.setSelections(",
    ] {
        assert_contains(&html, expected);
    }

    // The reading view draws with the highlight API rather than wrapping matches in tags, which the editor would serialize back into the file.
    assert_contains(&html, "CSS.highlights.set(FIND_HIGHLIGHT_ALL, all);");

    // And a replace there is one splice over the whole document, so one undo puts every replacement back. One send, and its range is the whole buffer.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'editBlock', start: 0, end: total, text: next });",
    );
    let reading_replace = html
        .split("function replaceInReading(all) {")
        .nth(1)
        .expect("the reading view's replace is in the script");
    let body = reading_replace
        .split("\nfunction ")
        .next()
        .expect("the function has an end");
    assert_eq!(
        body.matches("sendEditCommand(").count(),
        1,
        "replace all in the reading view must write one splice, not one per match"
    );
}

#[test]
fn app_shell_save_success_clears_reader_undo_state() {
    let html = app_shell_page();

    assert_contains(&html, "window.leafSaved = (path, ok, error) => {");
    assert_contains(&html, "undoableByPath.delete(path);");
}

#[test]
fn app_shell_resets_new_documents_to_rendered_content_top() {
    let html = app_shell_page();

    for expected in [
        "let resetReaderScrollOnNextRender = false;",
        "resetReaderScrollOnNextRender = true;",
        "resetReaderScrollToContentStart();",
        "function resetReaderScrollToContentStart() {",
        "const content = correctReaderScrollOrigin(source);",
        "setReaderScrollTop(content.topOffset);",
        "refreshReaderScrollAnchor();",
        "const firstContent = source.firstElementChild;",
        "const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);",
        "const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);",
    ] {
        assert_contains(&html, expected);
    }

    assert!(
        !html.contains("app.scrollTop = 0;"),
        "new document reset should account for reader padding instead of blindly scrolling to zero"
    );
}

#[test]
fn app_shell_clamps_reader_scroll_to_rendered_content_range() {
    let html = app_shell_page();

    for expected in [
            "function measureReaderScrollRange(documentContent, viewportHeight) {",
            "minScrollTop: documentContent.topOffset,",
            "maxScrollTop: documentContent.topOffset + scrollable,",
            "function readerScrollOrigin(source) {",
            "function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {",
            "const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));",
            "source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);",
            "function clampReaderScrollTop(scrollTop) {",
            "return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));",
            "function setReaderScrollTop(scrollTop) {",
            "app.scrollTop = clampReaderScrollTop(scrollTop);",
            "function clampReaderScrollPosition() {",
            "const clampedScrollTop = clampReaderScrollTop(app.scrollTop);",
            "app.addEventListener('scroll', () => {",
            "clampReaderScrollPosition();",
            "setReaderScrollTop(app.scrollTop);",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("app.scrollTop = Math.max(0, nextScrollTop);"),
        "restored reader scroll positions must clamp to the rendered content top, not raw zero"
    );
}

#[test]
fn app_shell_preserves_reader_anchor_across_layout_reflow() {
    let html = app_shell_page();

    for expected in [
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "let readerReflowObserver = null;",
            "const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';",
            "function captureReaderScrollAnchor() {",
            // Capture and restore share one cached block list so a serialized {section, block} anchor always resolves back to the element it named.
            "readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR)).filter(",
            // And never what is inside a drawing. A mermaid label is a `<p>` in a `<foreignObject>`, so a page of diagrams grows hundreds of them the moment they land — each taking a slot in this list, above the reader, walking the restore back toward the top a batch at a time.
            "(block) => !block.closest('svg'),",
            "const blocks = readerAnchorBlockList(source);",
            "return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };",
            "function resolveReaderAnchorElement(anchor) {",
            "function restoreReaderScrollAnchor(anchor) {",
            "setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);",
            "function scheduleReaderLayoutUpdate() {",
            "correctReaderScrollOrigin();",
            "restoreReaderScrollAnchor(readerScrollAnchor || captureReaderScrollAnchor());",
            "    if (readerOffScreen()) {",
            "readerScrollAnchor = captureReaderScrollAnchor() || readerScrollAnchor;",
            "window.addEventListener('resize', () => {",
            "scheduleReaderLayoutUpdate();",
            // The reflow observer re-pins the anchor as images decode and grow, and drops the stale anchor-block cache so the re-pin resolves against the current DOM rather than detached, zero-rect entries.
            "function observeReaderReflow() {",
            "readerReflowObserver = new ResizeObserver(() => {",
            "readerAnchorBlocks = null;",
            "image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_records_the_anchor_whenever_the_minimap_moves_the_reader() {
    // The scroll listener is deliberately inert during a minimap drag, so the minimap must record the anchor itself. Without that, the anchor keeps the pre-drag position and the next late reflow — most visibly the async bottom pager landing seconds after the document — restores it and throws the reader back up the page.
    let html = app_shell_page();

    for expected in [
        "function recordReaderScrollPosition() {",
        "clampReaderScrollPosition();\n  refreshReaderScrollAnchor();",
        // Every re-record goes through the one helper, which keeps the place the reader is holding when there is nothing to measure -- a reader off screen answers against boxes that all read zero, and the search below falls through to the last block of the document.
        "function refreshReaderScrollAnchor() {\n  if (readerOffScreen()) {",
        // Rail click (pointerdown, so already flagged as dragging).
        "app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));\n    recordReaderScrollPosition();",
        // Drag release: drop the queued pass built on the pre-drag anchor first, then record where the drag landed.
        "cancelReaderLayoutUpdate();\n      recordReaderScrollPosition();",
        "function cancelReaderLayoutUpdate() {",
        "window.cancelAnimationFrame(readerLayoutFrame);",
    ] {
        assert_contains(&html, expected);
    }

    // Mid-gesture, the queued pass must not re-pin at all: its anchor predates the drag, so restoring it would fight the pointer and undo the jump. A wheel scroll is guarded for the same reason — the anchor is deliberately only refreshed once the scroll settles, so it is stale by design until then.
    let update_start = html
        .find("function scheduleReaderLayoutUpdate(")
        .expect("app shell should schedule reader layout updates");
    let update_body = &html[update_start..];
    let gesture_guard = update_body
        .find("if (minimapDragging || readerScrolling) {")
        .expect("the layout pass should bail while a drag or a scroll owns the reader");
    let repin = update_body
        .find("restoreReaderScrollAnchor(readerScrollAnchor || captureReaderScrollAnchor());")
        .expect("the layout pass should re-pin the reader anchor");
    assert!(
        gesture_guard < repin,
        "the gesture bail must come before the anchor re-pin, or a drag gets yanked back to where it started"
    );

    // The anchor is read in the frame, never captured at the call. A diagram pass holds the thread for hundreds of milliseconds, so a pass queued during it runs after the scroll that happened meanwhile has settled. An anchor taken at the call is then the reader's place *before* that scroll, and restoring it drags them back — to the top, if that is where they started reading.
    assert!(
        !html.contains("function scheduleReaderLayoutUpdate(anchor"),
        "scheduleReaderLayoutUpdate must not take an anchor at call time — a pass queued during a diagram batch would restore the reader's place from before the scroll that happened while the thread was busy"
    );

    // The clamp and the anchor capture both force a layout, which on a large document is ~400ms — too expensive to run per frame, and nothing reads either mid-gesture. They settle after the wheel stops instead.
    for expected in [
        "function settleReaderScroll() {",
        "readerScrollSettleTimer = window.setTimeout(settleReaderScroll, READER_SCROLL_SETTLE_MS);",
        "let readerScrolling = false;",
    ] {
        assert_contains(&html, expected);
    }
    // And nothing clamps per frame, or the stall is back.
    assert!(
        !html.contains(
            "readerScrollFrame = window.requestAnimationFrame(() => {\n    readerScrollFrame = 0;\n    clampReaderScrollPosition();"
        ),
        "the scroll listener must not force a layout every frame"
    );
}

#[test]
fn app_shell_disables_minimap_without_leaving_empty_layout_column() {
    let html = app_shell_page();

    for expected in [
            "if (!window.leafMinimap.getEnabled()) {\n    return '';\n  }",
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            // Rendered hidden, then revealed already decorated: see renderState.
            "app.innerHTML = `<div class=\"${layoutClass}\" style=\"display:none\">${state.document.html}</div>`;",
            // The rail is placed beside the page, not inside it. Empty markup means no rail element at all, which is what collapses the shell column — a hidden one would still satisfy :has().
            "setMinimapMarkup(minimapHtml);",
            "if (readerMinimap) readerMinimap.innerHTML = html || '';",
            r#"<div id="readerMinimap" class="reader-minimap" aria-hidden="true"></div>"#,
        ] {
            assert_contains(&html, expected);
        }

    let css = reading_mode_css();
    assert_contains(css, ".reader-layout-no-minimap {");
    assert_contains(css, "grid-template-columns: minmax(0, 1fr);");
    assert_contains(css, "justify-items: center;");
    assert!(!css.contains("grid-template-columns: minmax(0, var(--document-measure)) 136px;"));
}

#[test]
fn app_shell_routes_fragment_links_through_reader_anchor_scrolling() {
    let html = app_shell_page();

    assert_contains(&html, "window.leafScrollToFragment = (fragment) => {");
    assert_contains(
        &html,
        "const target = document.getElementById(decoded) || document.getElementById(raw);",
    );
    assert_contains(&html, "target.focus({ preventScroll: true });");
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
    assert_contains(&html, "event.preventDefault();");
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
        // The middle button raises `auxclick` and never `click`; the web view's own scroll puck opens on the mousedown before it, so both are answered.
        "app.addEventListener('auxclick', (event) => {",
        "app.addEventListener('mousedown', (event) => {",
        "const link = event.button === 1 ? documentLinkFor(event.target) : null;",
        "sendDocumentLink(link, true);",
        // A middle click only acts where there is a page to open.
        "if (!link || !isAnotherPageHref(link.getAttribute('href'))) {",
    ] {
        assert_contains(&html, expected);
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
        "if (linkHoverKind(contextMenuPath) !== 'External site') return entry;",
        "return { action: entry.action, label: 'Open in browser' };",
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

    for expected in [
        "const PAGE_MENU_ITEMS = [",
        "{ action: 'favorite', label: 'Favorite' },",
        "{ action: 'copyPath', label: 'Copy path' },",
        "{ action: 'reveal', label: 'Reveal file' },",
        "{ action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },",
        "{ action: 'delete', label: 'Delete', danger: true },",
        "showContextMenu(event.clientX, event.clientY, activeDocumentPath(), 'page');",
        "contextMenuTargetKind === 'page'",
    ] {
        assert_contains(&html, expected);
    }

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
    assert!(html.contains("navigator.clipboard.writeText(text)"));
    assert!(html.contains("document.execCommand('copy')"));
    // The button styling and copied-state swap exist.
    assert!(css.contains(".document-body pre > .code-copy {"));
    assert!(css.contains(".code-copy.is-copied .code-copy-check {"));

    // Both labels the button swaps between are present.
    assert!(html.contains("setCodeCopyLabel(button, 'Copy code');"));
    assert!(html.contains("setCodeCopyLabel(button, 'Copied');"));
}

#[test]
fn select_all_in_the_reading_view_selects_only_the_page() {
    let html = app_shell_page();

    // A native Ctrl/Cmd+A selects the whole shell — library pane, toolbar and all — so copying a page drags the chrome along. The shortcut selects just the rendered document, and stands aside for editable fields and the code view, whose native select-all is scoped already.
    assert!(html.contains("event.key.toLowerCase() === 'a'"));
    assert!(html.contains("if (!caretBlock && isEditableMouseTarget(event.target))"));
    assert!(html.contains("range.selectNodeContents(body)"));
    assert!(html.contains("selection.removeAllRanges()"));
    assert!(html.contains("selection.addRange(range)"));

    // With the caret in a block it widens a step per press instead — block, section, page — and the first press has to stay the browser's own, so the early return is what the step reaches rather than something that replaced it.
    assert!(html.contains("const caretBlock = caretBlockForSelectAll(event.target);"));
    assert!(html.contains("const wanted = selectAllTargetFor(caretBlock);"));
    assert!(html.contains("if (wanted.browser) {"));
    assert!(html.contains("selectBlockRun(wanted.section);"));
}

#[test]
fn app_shell_code_view_is_a_worker_free_monaco_with_its_own_minimap() {
    // The code view is Monaco: it renders only what's on screen, so typing never re-lays-out the whole document. Guard the load-bearing choices behind that.
    let html = app_shell_page();

    // Entering the code view mounts a Monaco container and clears the reader's own rail — Monaco draws its own minimap.
    assert!(html.contains(r#"app.innerHTML = '<div class="code-view-monaco"></div>';"#));
    assert!(html.contains("setMinimapMarkup('');"));

    // Wrapping stays on and the minimap is Monaco's own. The wrap is 'bounded' (not 'on') so applyCodeViewWrapColumn can hold the text short of the minimap — 'on' wraps flush under the minimap's drop-shadow.
    assert!(html.contains("wordWrap: 'bounded',"));
    assert!(html.contains("monacoEditor.onDidLayoutChange(() => {"));
    // A relayout re-derives the wrap column and re-checks the viewport box.
    assert!(html.contains("    clampMinimapSliderToRail();\n  });"));
    assert!(html.contains("minimap: { enabled: true"));

    // Edits relay to the host as source splices (scheduleSourceUpdate), not a whole-buffer resend per keystroke.
    assert!(html.contains("monacoEditor.onDidChangeModelContent(() => {"));
    assert!(html.contains("scheduleSourceUpdate();"));

    // The bundle loads lazily, and Monaco is handed an inert worker stub so it never spawns a worker or evaluates worker code on the main thread — the app's security policy (no 'unsafe-eval', no blob: workers) stays untouched.
    assert!(html.contains("function loadMonacoOnce()"));
    assert!(html.contains("self.MonacoEnvironment = {"));
    assert!(html.contains("getWorker() {"));
}

// The editor's add-a-cursor commands come from a contribution, not the core, so a re-bundle that drops the import from scripts/bundle-monaco.mjs takes them out with nothing on screen to show for it — Ctrl-click keeps working (the mouse handling is core) while add-a-cursor-below and add-the-next-match silently do nothing. Only a regeneration touches this file, and it is not part of `just verify`.
#[test]
fn the_vendored_editor_carries_its_add_a_cursor_commands() {
    let bundle = String::from_utf8_lossy(assets::MONACO_JS);

    for command in ["insertCursorBelow", "addSelectionToNextFindMatch"] {
        assert!(
            bundle.contains(command),
            "the vendored editor is missing {command} — re-run `just bundle-monaco` with contrib/multicursor imported"
        );
    }
}

// The code view's wrap is a column count, so it is only a width once a character has been measured — and every theme brings its own code font. Monaco measures a font when it is told to use it, which for a web font is before the face has arrived, so it measures the fallback; a font landing changes no geometry, so the layout event the column rides never fires to correct it. Uncorrected, the wrap reads as a property of the theme: text running under the minimap on some, stopping short on others, depending only on whether that font is loaded already and how wide the fallback is.
//
// The re-fit is pinned here because it has to keep working for fonts nobody has picked yet: it is driven by the web view saying "faces finished loading", which names no font and covers every source, so a new theme needs no code. Anything that starts listing font names, or fits only the fonts that ship today, fails this test.
#[test]
fn app_shell_refits_the_code_view_wrap_to_whatever_font_is_actually_measured() {
    let html = app_shell_page();

    // Forcing the measurement again is the load-bearing half — Monaco does not re-measure on its own — and the column cache has to go first, because the same count against a different font reads as "nothing changed".
    let refit = html
        .split("function refitCodeViewToFont()")
        .nth(1)
        .expect("the shell must expose the wrap re-fit");
    let refit = &refit[..refit.find("\n}").expect("re-fit body should close")];
    assert_contains(refit, "editor.remeasureFonts();");
    assert_contains(refit, "codeViewWrapColumn = 0;");
    assert_contains(refit, "applyCodeViewWrapColumn();");

    // Both things that change the measurement re-fit: the theme's own font swap, and any face finishing its load afterwards. The listener is generic on purpose — `loadingdone` fires for every font from every source and names none.
    assert_contains(&html, "if (codeFont) monacoEditor.updateOptions({ fontFamily: codeFont });\n  // A theme brings its own code font, so the wrap has to be re-fitted to it.\n  refitCodeViewToFont();");
    assert_contains(
        &html,
        "document.fonts.addEventListener('loadingdone', monacoFontsDoneHandler);",
    );
    // And it is dropped on teardown, or it re-fits an editor that no longer exists.
    assert_contains(
        &html,
        "document.fonts.removeEventListener('loadingdone', monacoFontsDoneHandler);",
    );
}

// The edge fades dissolve the top and bottom of the page so a line sliced by the app bar's edge or the card's stroke doesn't read as a rendering fault. Scrolled to either end there is no slice to hide — and Monaco puts line 1 and the last line flush against those same two edges, so the wash falls on text instead and the first line comes up half erased. The editor therefore has to hold its content clear of both edges the way the reading view's page does, which is why the clearance is READ from the reading view's own numbers rather than typed again here.
#[test]
fn app_shell_holds_the_code_view_clear_of_the_edge_fades() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The option exists at all, and is Monaco's own padding — the scroll height grows, so the ends of the document can be scrolled out of the wash.
    assert_contains(&html, "padding: monacoEditorPadding(),");

    let padding = html
        .split("function monacoEditorPadding()")
        .nth(1)
        .expect("the shell must size the code view's padding");
    let padding = &padding[..padding.find("\n}\n").expect("padding body should close")];

    // Top: the gap the reading view opens for its first block, less the bar the editor's box already starts below.
    assert_contains(padding, "READER_CONTENT_TOP_GAP - barHeight");
    assert_contains(padding, "root.getPropertyValue('--app-bar-height')");

    // Bottom: what .document-body leaves — the content pad plus the floating toolbar's room. That one is declared on <body>, not the root, so it must be read from the body or it comes back 0 and the last line sits under the bar.
    assert_contains(padding, "contentPad + toolbarSpace");
    assert_contains(padding, "root.getPropertyValue('--reader-content-pad')");
    assert_contains(
        padding,
        "getComputedStyle(document.body).getPropertyValue('--reader-toolbar-space')",
    );
    assert_contains(&css, "body:has(#readerToolbar:not([hidden])) {");

    // And the clearance actually covers the fade, whatever the three numbers become: the top gap left over after the app bar has to be at least as deep as the wash.
    let px = |name: &str| -> f64 {
        let value = css
            .split(&format!("{name}: "))
            .nth(1)
            .unwrap_or_else(|| panic!("{name} must be declared"));
        value[..value.find("px").expect("a pixel length")]
            .parse()
            .expect("a number")
    };
    let clearance = px("--reader-content-top-gap") - px("--app-bar-height");
    let fade = px("--reader-edge-fade-depth");
    assert!(
        clearance >= fade,
        "the code view's top padding is {clearance}px, which does not clear the {fade}px fade"
    );
}

#[test]
fn the_field_block_at_the_top_of_a_note_is_bound_to_the_block_not_to_a_place_on_the_page() {
    let html = app_shell_page();

    // Found by the block, never by where the block sits, so the table can later move into a sheet and the same binding reaches it. Its absence is an answer too — a note with no block is the state a first field is started from.
    assert_contains(&html, "function frontmatterBlock(root) {");
    assert_contains(&html, "return (root || app).querySelector('.frontmatter');");
    assert_contains(&html, "function bindFrontmatterFields(root) {");
    assert_contains(&html, "const block = frontmatterBlock(root);");
    assert_contains(&html, "if (!block || !readerEditingAllowed()) return;");
    assert_contains(&html, "bindFrontmatterFields(body);");

    // The value cells the renderer stamped, and the control each type asks for — never one this guesses at.
    assert_contains(&html, "block.querySelectorAll('td[data-leaf-field]')");
    assert_contains(&html, "if (kind === 'list') {");
    assert_contains(&html, "} else if (kind === 'checkbox') {");
    // A date the picker cannot read keeps the text box, rather than opening a picker that shows nothing and clears the value on the way out.
    assert_contains(
        &html,
        "} else if (kind === 'date' && frontmatterDateValue(cell.textContent.trim())) {",
    );
    assert_contains(
        &html,
        "return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : '';",
    );
    // The checkbox the renderer already drew, with its `disabled` taken off — not a second one beside it.
    assert_contains(&html, "box.disabled = false;");
    assert_contains(
        &html,
        "box.addEventListener('change', () => sendFieldEdit(key, box.checked ? 'true' : 'false'));",
    );
    // A list goes back whole, because how it is written is the file's own shape to keep — and through the reading view's own edit path, because a field write is an undoable buffer edit and the dot has to answer for it at once.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'setListField', key, items: next });",
    );

    // Enter commits, Escape abandons, leaving the box commits — the vault menu's fields, in a table cell.
    assert_contains(&html, "field.addEventListener('blur', () => finish(true));");
    assert_contains(
        &html,
        "if (write && commit && commit(field.value.trim()) === false) return;",
    );

    // The host owns every write: where a field's bytes are, whether a quote goes back on, and whether a new name would collide, are all the parser's to know.
    assert_contains(
        &html,
        "sendEditCommand({ command: 'setField', key, value });",
    );
    assert_contains(
        &html,
        "sendEditCommand({ command: 'renameField', key, to: text });",
    );

    // The cross per row and the add row under the last field, both inside the block.
    assert_contains(&html, "button.className = 'frontmatter-remove';");
    assert_contains(&html, "sendFieldEdit(key, null);");
    assert_contains(&html, "row.className = 'frontmatter-add';");
    assert_contains(
        &html,
        "if (write && key) sendFieldEdit(key, value.value.trim());",
    );

    // The names the app really reads, offered rather than typed — and one list on the page, since an input cannot hold a datalist of its own.
    assert_contains(
        &html,
        "const FRONTMATTER_KNOWN_KEYS = ['aliases', 'cssclasses', 'tags', 'leaftext-types'];",
    );
    assert_contains(
        &html,
        "if (known) field.setAttribute('list', frontmatterKnownKeyList());",
    );
}

#[test]
fn a_note_with_no_fields_starts_one_from_the_plus_that_is_already_in_the_gutter() {
    let html = app_shell_page();

    // Above everything, on an unlocked Markdown note that has no block — and nowhere else, or an insert between two paragraphs would make metadata nobody meant.
    assert_contains(&html, "function frontmatterCanStart(gap) {");
    assert_contains(&html, "&& !gap.above");
    assert_contains(&html, "&& currentDocumentFormat === 'markdown'");
    assert_contains(&html, "&& readerEditingAllowed()");
    assert_contains(&html, "&& !frontmatterBlock();");

    // The plus already there, saying what it does rather than reading as the insert menu it is not.
    assert_contains(&html, "function labelBlockAdd(startsFrontmatter) {");
    assert_contains(
        &html,
        "const what = startsFrontmatter ? 'Add frontmatter' : 'Insert a block';",
    );
    assert_contains(&html, "if (frontmatterCanStart(blockGutterGap)) {");
    assert_contains(&html, "startFrontmatterAtTop();");

    // It opens the same name-and-value pair the add row opens, and an abandoned one takes the block away again so the file never moved.
    assert_contains(&html, "function startFrontmatterAtTop() {");
    assert_contains(&html, "block.className = 'frontmatter is-editable';");
    assert_contains(
        &html,
        "const button = frontmatterAddRow(block, () => block.remove());",
    );
    assert_contains(&html, "else if (onEmpty) onEmpty();");
}
