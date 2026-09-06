//! The minimap: its geometry, its drags and its viewport.

use super::*;

#[test]
fn app_shell_renders_interactive_document_minimap() {
    let html = app_shell_page();

    for expected in [
            "function renderDocumentMinimap(hasVisibleContent) {",
            "aria-label=\"Document minimap\"",
            "aria-hidden=\"true\"><div class=\"document-minimap-content\" aria-hidden=\"true\"></div><div class=\"document-minimap-fade\" data-edge=\"top\" aria-hidden=\"true\"></div><div class=\"document-minimap-fade\" data-edge=\"bottom\" aria-hidden=\"true\"></div><div class=\"lt-spinner document-minimap-spinner\" aria-hidden=\"true\"></div><div class=\"document-minimap-viewport\" aria-hidden=\"true\"",
            "function bindDocumentMinimap() {",
            // The rail says it is working until there is a thumbnail to show: the clone can't exist before the document has been laid out, and on a large file an empty rail beside a finished page looks broken.
            "class=\"document-minimap is-loading\"",
            "minimap.classList.remove('is-loading');",
        ] {
            assert_contains(&html, expected);
        }
    assert_in(
        &html,
        "function renderState(keepDetachedRender = false) {",
        "renderDocumentMinimap(state.document.has_visible_content)",
    );
    assert_in(
        &html,
        "function renderState(keepDetachedRender = false) {",
        "bindDocumentMinimap();",
    );

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
        "var minimapPreviewFrame;",
        "var minimapResizeObserver;",
        "var minimapBodyObserver;",
        "var readerLayoutFrame;",
        "function initializeMinimapState() {",
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
        "function scheduleMinimapPreviewUpdate(slack = MINIMAP_WINDOW_SLACK) {",
        "minimapPreviewFrame = window.requestAnimationFrame(() => {",
        "function updateDocumentMinimapPreview(slack = MINIMAP_WINDOW_SLACK) {",
        // The clone is skipped when nothing shaping the thumbnail changed, so a height-only resize doesn't rebuild the whole document. The first two of those are the rail's other builder's as well, so they are held in the block below rather than here.
        "minimapBuiltPreviewWidth === previewWidth &&",
        "minimapBuiltFrameWidth === frameWidth &&",
        "preview = source.cloneNode(true);",
        "preview.classList.add('document-minimap-preview');",
        // The clone is laid out inside a frame the width of the reading layout's content box, and the frame is what scales: without it a document's container queries measure the whole window, a wide table is drawn wider than the page draws it, and the thumbnail ends short of the bottom. The content box, so the layout's inline padding — outside the container query — is not counted.
        "function minimapFrameWidth(fallbackWidth) {",
        "const width = layout.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);",
        "const frameWidth = minimapFrameWidth(metrics.sourceWidth);",
        "frame.style.width = `${frameWidth}px`;",
        "frame.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;",
        "frame.style.transform = `translateY(${firstTop * previewScale}px) scale(${previewScale})`;",
    // A document taller than the rail is cloned as the slice the rail can actually show, not whole: a full clone put a second copy of every element on the page, which cost ~890ms a frame to slide on a 4MB glossary. The window is still a clone of the real rendering, so the rail keeps real text — and on any document the rail can show in full it IS the whole document, which is why nothing here is gated on a size threshold.
        "function minimapWindowCoversView(metrics, scrollTop) {",
        "function minimapVisibleDocumentRange(metrics, scrollTop) {",
        "function minimapFirstBlockPast(rows, appTop, scrollTop, offset) {",
        "const windowsIt = source.children.length > 0 && metrics.scaledDocumentHeight > metrics.trackHeight;",
        "const built = buildWindowedMinimapClone(source, window, first, last, cut);",
        "function minimapWindowRows(source, appTop, scrollTop, top, bottom) {",
        "function buildWindowedMinimapClone(source, window, first, last, cut, cutAt = 'both') {",
        "into.appendChild(node.nodeType === 3 ? document.createTextNode(node.nodeValue) : node.cloneNode(true));",
        // Scrolling reads no geometry at all — cached metrics, arithmetic, and CSS variable writes. Re-measuring per wheel click forced a fresh layout of the whole document, which is what made one click take ~2 seconds.
        "function minimapMetricsForScroll(track) {",
        "function invalidateMinimapMetrics() {",
        "function updateMinimapViewportFromScroll() {",
        // Glossary terms are tagged before their hrefs are stripped so the clone can re-blend them (the href-based body blend can't match once href is gone).
        "link.classList.add('glossary-term');",
    ] {
        assert_contains(&html, expected);
    }
    // The lines the rail's two builders share: the clone's, and the second frame a whole HTML page gets instead. Each is held in the block that writes it, so neither builder can quietly lose one.
    for expected in [
        "minimapBuiltVersion === minimapContentVersion &&",
        "minimapBuiltSourceWidth === metrics.sourceWidth &&",
        "frame.className = 'document-minimap-frame';",
        "frame.appendChild(preview);",
        "content.replaceChildren(frame);",
    ] {
        assert_in(
            &html,
            "function updateDocumentMinimapPreview(slack = MINIMAP_WINDOW_SLACK) {",
            expected,
        );
    }

    // A whole HTML page is drawn in a frame, so the rail is one more frame over the same page rather than a clone of a body the app page would restyle. It carries no script and takes no keyboard.
    for expected in [
        "frame.className = 'document-minimap-frame';",
        "preview.className = 'document-site document-minimap-preview';",
        "preview.setAttribute('sandbox', 'allow-same-origin');",
        "preview.setAttribute('srcdoc', reading.getAttribute('srcdoc') || '');",
        "preview.setAttribute('tabindex', '-1');",
        "frame.appendChild(preview);",
        "content.replaceChildren(frame);",
    ] {
        assert_in(
            &html,
            "function updateContainedPageMinimapPreview(track, content, minimap) {",
            expected,
        );
    }

    for expected in [
        "minimapPreviewFrame = 0;",
        "minimapResizeObserver = null;",
        "minimapBodyObserver = null;",
        "readerLayoutFrame = 0;",
    ] {
        assert_in(&html, "function initializeMinimapState() {", expected);
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
            "viewport.style.transform = `translateY(${viewportTop}px)`;",
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
fn app_shell_throttles_minimap_scroll_sync() {
    let html = app_shell_page();

    for expected in [
        "var minimapViewportFrame;",
        "function scheduleMinimapViewportUpdate() {",
        "function updateMinimapViewport() {",
        // A scroll schedules the sync and flags the reader as scrolling; a resize invalidates the metrics, queues the layout pass and rebuilds the thumbnail. Each of those calls alone is in the page many times over, so the pin is the pair.
        "scheduleMinimapViewportUpdate();\n  readerScrolling = true;",
        "invalidateMinimapMetrics();\n  scheduleReaderLayoutUpdate();",
        "scheduleMinimapViewportUpdate();\n  scheduleMinimapPreviewUpdate();",
    ] {
        assert_contains(&html, expected);
    }
    assert_in(
        &html,
        "function initializeMinimapState() {",
        "minimapViewportFrame = 0;",
    );

    // The sync is throttled to a frame, and the settle — not the listener, and not some other caller — is where a scroll clamps and re-pins.
    assert_in(
        &html,
        "function scheduleMinimapViewportUpdate() {",
        "window.requestAnimationFrame(() => {",
    );
    for expected in [
        "clampReaderScrollPosition();",
        "refreshReaderScrollAnchor();",
    ] {
        assert_in(&html, "function settleReaderScroll() {", expected);
    }
}

#[test]
fn app_shell_clicks_minimap_to_scroll_document() {
    let html = app_shell_page();

    for expected in [
        "const scrollToMinimapSnapshotPoint = (event) => {",
        "const content = track.querySelector('.document-minimap-content');",
        "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
        "readerScrollElement().scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));",
        "track.addEventListener('pointerdown', (event) => {",
        "if (Number.isFinite(minimapPointerOffsetY)) {",
        // A bare click falls through to the snapshot, and the arm on its own is all over the page.
        "} else {\n      scrollToMinimapSnapshotPoint(event);",
    ] {
        assert_contains(&html, expected);
    }

    // A grab inside the box drags instead; the page makes that call twice, so the press is what has to make it.
    assert_in(
        &html,
        "if (Number.isFinite(minimapPointerOffsetY)) {",
        "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
    );
}

#[test]
fn app_shell_drags_minimap_to_scroll_document() {
    let html = app_shell_page();

    for expected in [
            "var minimapPointerId;",
            "var minimapPointerOffsetY;",
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
            "track.addEventListener('pointerup', endDrag);",
            "track.addEventListener('pointercancel', endDrag);",
            "track.addEventListener('lostpointercapture', endDrag);",
        ] {
            assert_contains(&html, expected);
        }
    for expected in ["minimapPointerId = null;", "minimapPointerOffsetY = null;"] {
        assert_in(&html, "function initializeMinimapState() {", expected);
    }

    // Both of these are in the page more than once, so the move is what has to keep dragging and the release is what has to forget the offset.
    assert_in(
        &html,
        "track.addEventListener('pointermove', (event) => {",
        "dragMinimapViewportToPointer(event, minimapPointerOffsetY);",
    );
    assert_in(
        &html,
        "if (event.pointerId === minimapPointerId) {",
        "minimapPointerOffsetY = null;",
    );

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

    // A rebuild is slower than a fast hand, so the slack a moving drag asks for goes where the hand is heading. The direction comes off the two mapped positions the drag already has, so the pointer path measures no layout to find it.
    for expected in [
        "if (minimapDragScrollTop !== null && boundedScrollTop !== minimapDragScrollTop) {",
        "minimapDragDirection = boundedScrollTop > minimapDragScrollTop ? 1 : -1;",
        "minimapDragScrollTop = boundedScrollTop;",
    ] {
        assert_in(
            &html,
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            expected,
        );
    }
    assert!(
        html.find("minimapDragDirection = boundedScrollTop > minimapDragScrollTop ? 1 : -1;")
            < html.find("scheduleMinimapPreviewUpdate(MINIMAP_GESTURE_SLACK);"),
        "the drag aims the window before it asks for the rebuild that uses it"
    );

    // A grab has no travel behind it and a release has none in front, so both put the drag back on the resting window.
    for opener in [
        "function initializeMinimapState() {",
        "track.addEventListener('pointerdown', (event) => {",
        "if (event.pointerId === minimapPointerId) {",
    ] {
        for expected in ["minimapDragScrollTop = null;", "minimapDragDirection = 0;"] {
            assert_in(&html, opener, expected);
        }
    }

    // The window keeps its height and moves its weight: seven eighths of the slack ahead of the hand, an eighth behind it, and the sides swap the move after a reversal. Only a gesture's ask is aimed — a rest and a release come through with the full window and take it either side.
    for expected in [
        "const direction = slack < MINIMAP_WINDOW_SLACK ? minimapDragDirection : 0;",
        "const behindHeight = direction === 0 ? slackHeight : slackHeight * 2 * MINIMAP_GESTURE_SLACK_BEHIND;",
        "const aheadHeight = direction === 0 ? slackHeight : slackHeight * 2 * (1 - MINIMAP_GESTURE_SLACK_BEHIND);",
        "const topSlack = direction < 0 ? aheadHeight : behindHeight;",
        "const bottomSlack = direction < 0 ? behindHeight : aheadHeight;",
        "minimapWindowRows(source, appTop, scrollTop, view.top - topSlack, view.bottom + bottomSlack)",
        "const cut = { appTop, scrollTop, top: view.top - topSlack, bottom: view.bottom + bottomSlack };",
    ] {
        assert_in(
            &html,
            "function updateDocumentMinimapPreview(slack = MINIMAP_WINDOW_SLACK) {",
            expected,
        );
    }
    assert_contains(&html, "const MINIMAP_GESTURE_SLACK_BEHIND = 0.125;");
    assert!(
        !html.contains("view.top - slackHeight"),
        "no ask keeps the old symmetric cut, or a drag would still lay out the ground it has left"
    );
}

#[test]
fn app_shell_preserves_focus_and_updates_minimap_viewport_indicator() {
    let html = app_shell_page();

    for expected in [
        "const restoreFocus = () => {",
        "active.focus({ preventScroll: true });",
        "viewport.style.transform = ",
        "viewport.style.height = ",
    ] {
        assert_contains(&html, expected);
    }

    // The page holds all three of these lines in several places, so the block each is in is the claim: the focus is taken before the jump, the press keeps the page from doing its own thing with it, and the jump ends by placing the box.
    for (inside, expected) in [
        (
            "const restoreFocus = () => {",
            "const active = document.activeElement;",
        ),
        (
            "track.addEventListener('pointerdown', (event) => {",
            "event.preventDefault();",
        ),
        (
            "const scrollToMinimapSnapshotPoint = (event) => {",
            "updateMinimapViewport();",
        ),
    ] {
        assert_in(&html, inside, expected);
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
        "const minimapRect = minimap.getBoundingClientRect();",
        "return Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));",
        "function measureDocumentMinimap(track) {",
        "const scrollHeight = Math.max(1, Math.ceil(reader.scrollHeight));",
        "const scrollTop = Math.min(scrollable, Math.max(0, reader.scrollTop));",
        "const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);",
        "const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;",
        "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));",
        "track.style.height = `${trackHeight}px`;",
    ] {
        assert_contains(&html, expected);
    }

    // Each of these three measurements is taken in several places, so the two that measure the rail are named.
    assert_in(
        &html,
        "function minimapAvailableHeight(minimap) {",
        "const shellRect = app.getBoundingClientRect();",
    );
    for expected in [
        "const viewportHeight = Math.max(1, Math.ceil(reader.clientHeight));",
        "const scrollable = Math.max(0, scrollHeight - viewportHeight);",
    ] {
        assert_in(&html, "function measureDocumentMinimap(track) {", expected);
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
            "const minimapHtml = renderDocumentMinimap(state.document.has_visible_content);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            // Rendered hidden, then revealed already decorated: see renderState.
            "app.innerHTML = `<div class=\"${layoutClass}\" style=\"display:none\">${state.document.html}</div>`;",
            "setMinimapMarkup(minimapHtml);",
        ] {
        assert_contains(&html, expected);
    }
    assert_in(
        &html,
        "function renderState(keepDetachedRender = false) {",
        "bindDocumentMinimap();",
    );

    // The page places the box all over, so the rebind is the one that has to.
    assert_in(
        &html,
        "function bindDocumentMinimap() {",
        "updateMinimapViewport();",
    );
}

#[test]
fn app_shell_records_the_anchor_whenever_the_minimap_moves_the_reader() {
    // The scroll listener is deliberately inert during a minimap drag, so the minimap must record the anchor itself. Without that, the anchor keeps the pre-drag position and the next late reflow — most visibly the async bottom pager landing seconds after the document — restores it and throws the reader back up the page.
    let html = app_shell_page();

    // The clamp-then-repin pair is in the page more than once, so the one helper every re-record goes through is what has to hold it.
    assert_in(
        &html,
        "function recordReaderScrollPosition() {",
        "clampReaderScrollPosition();\n  refreshReaderScrollAnchor();",
    );

    for expected in [
        "function recordReaderScrollPosition() {",
        // Every re-record goes through the one helper, which keeps the place the reader is holding when there is nothing to measure -- a reader off screen answers against boxes that all read zero, and the search below falls through to the last block of the document.
        "function refreshReaderScrollAnchor() {\n  if (readerOffScreen()) {",
        // Rail click (pointerdown, so already flagged as dragging).
        "readerScrollElement().scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));\n    recordReaderScrollPosition();",
        // Drag release: drop the queued pass built on the pre-drag anchor first, then record where the drag landed.
        "cancelReaderLayoutUpdate();\n      recordReaderScrollPosition();",
        "function cancelReaderLayoutUpdate() {",
        "window.cancelAnimationFrame(readerLayoutFrame);",
    ] {
        assert_contains(&html, expected);
    }

    // Mid-gesture, the queued pass must not re-pin at all: its anchor predates the drag, so restoring it would fight the pointer and undo the jump. A wheel scroll is guarded for the same reason — the anchor is deliberately only refreshed once the scroll settles, so it is stale by design until then.
    let update_body = block_opened_by(&html, "function scheduleReaderLayoutUpdate() {")
        .expect("app shell should schedule reader layout updates");
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
            "const minimapHtml = renderDocumentMinimap(state.document.has_visible_content);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            // Rendered hidden, then revealed already decorated: see renderState.
            "app.innerHTML = `<div class=\"${layoutClass}\" style=\"display:none\">${state.document.html}</div>`;",
            // The rail is placed beside the page, not inside it. Empty markup means no rail element at all, which is what collapses the shell column — a hidden one would still satisfy :has().
            "setMinimapMarkup(minimapHtml);",
            "    readerMinimap.innerHTML = html || '';",
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
