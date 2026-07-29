//! The reader surface: minimap interaction, scroll anchoring, in-page editing.

use super::*;

#[test]
fn app_shell_decorates_blockquote_hard_break_lines_for_hanging_indent() {
    let html = app_shell_html();

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
fn app_shell_builds_collapsed_heading_outline_under_the_title() {
    let html = app_shell_html();

    // The builder exists, is wired into the render pipeline, and the line count
    // skips the outline's own link-only entries rather than counting them.
    assert_contains(&html, "function buildDocumentOutline() {");
    assert_contains(&html, "buildDocumentOutline();");
    assert_contains(&html, "if (target.closest('.document-outline')) return;");
    // A title plus at least one section, inserted just under the title.
    assert_contains(&html, "if (headings.length < 2) return;");
    assert_contains(&html, "title.insertAdjacentElement('afterend', details);");
    // Collapsed <details> with a localized "Outline" summary, entries nested
    // as a bulleted list (numbers overflow the panel on deep documents) that
    // links each heading by its slug id.
    assert_contains(&html, "details.className = 'document-outline';");
    assert_contains(&html, "summaryLabel.dataset.i18n = 'outline.title';");
    assert_contains(&html, "const rootList = document.createElement('ul');");
    assert!(!html.contains("const rootList = document.createElement('ol');"));
    assert_contains(&html, "link.className = 'document-outline-link';");
    assert_contains(&html, "link.href = '#' + encodeURIComponent(h.id);");
    // The summary carries how long the document is — counted, not stamped onto
    // every block on the way to the total.
    assert_contains(&html, "summaryCount.className = 'document-outline-count';");
    assert_contains(&html, "function documentLineCount(body) {");
    assert_contains(
        &html,
        "window.leafLocale.t('outline.lineCount', { count: documentLineCount(body) })",
    );
    // The (potentially ~25k-entry) list is built lazily, only when the reader
    // first expands the outline — not at every document render.
    assert_contains(&html, "function populateDocumentOutline(details, rest) {");
    assert_contains(&html, "details.addEventListener('toggle', () => {");
    assert_contains(
        &html,
        "if (details.open) populateDocumentOutline(details, rest);",
    );
    // The outline never opens on its own — closed until the reader expands it.
    assert!(!html.contains("details.open = true"));
    // Localized label and line-count suffix present in both shipped languages.
    assert_contains(&html, "'outline.title': 'Outline'");
    assert_contains(&html, "'outline.title': '大纲'");
    assert_contains(&html, "'outline.lineCount': '({count} lines)'");
    assert_contains(&html, "'outline.lineCount': '（{count} 行）'");
}

#[test]
fn app_shell_renders_interactive_document_minimap() {
    let html = app_shell_html();

    for expected in [
            "renderDocumentMinimap(state.document.minimap)",
            "function renderDocumentMinimap(model) {",
            "document-minimap-track",
            "document-minimap-content",
            "document-minimap-viewport",
            "window.leafLocale.t('minimap.aria')",
            "aria-hidden=\"true\"><div class=\"document-minimap-content\" aria-hidden=\"true\"></div><div class=\"document-minimap-spinner\" aria-hidden=\"true\"></div><div class=\"document-minimap-viewport\" aria-hidden=\"true\"",
            "bindDocumentMinimap();",
            "function bindDocumentMinimap() {",
            // The rail says it is working until there is a thumbnail to show: the
            // clone can't exist before the document has been laid out, and on a
            // large file an empty rail beside a finished page looks broken.
            "class=\"document-minimap is-loading\"",
            "minimap.classList.remove('is-loading');",
        ] {
            assert_contains(&html, expected);
        }

    // The minimap is a real-text thumbnail: a shrunken clone of the rendered
    // document, not an abstract canvas painting.
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
    let html = app_shell_html();
    let css = reading_mode_css();

    for expected in [
        "let minimapPreviewFrame = 0;",
        "let minimapResizeObserver = null;",
        "let minimapBodyObserver = null;",
        "let readerLayoutFrame = 0;",
        "let readerScrollAnchor = null;",
        "function bindDocumentMinimapPreview(track) {",
        // Content changes bump the version so the clone is rebuilt; geometry-only
        // triggers (resize) skip the rebuild unless a width changed.
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
        // The clone is skipped when nothing shaping the thumbnail changed, so a
        // height-only resize doesn't rebuild the whole document.
        "minimapBuiltVersion === minimapContentVersion &&",
        "minimapBuiltSourceWidth === metrics.sourceWidth &&",
        "minimapBuiltPreviewWidth === previewWidth",
        "preview = source.cloneNode(true);",
        "preview.classList.add('document-minimap-preview');",
        "preview.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;",
        "content.replaceChildren(preview);",
        "updateMinimapViewport();",
        // A document taller than the rail is cloned as the slice the rail can
        // actually show, not whole: a full clone put a second copy of every element
        // on the page, which cost ~890ms a frame to slide on a 4MB glossary. The
        // window is still a clone of the real rendering, so the rail keeps real
        // text — and on any document the rail can show in full it IS the whole
        // document, which is why nothing here is gated on a size threshold.
        "function minimapWindowCoversView(metrics, scrollTop) {",
        "function minimapVisibleDocumentRange(metrics, scrollTop) {",
        "function minimapFirstBlockPast(rows, appTop, scrollTop, offset) {",
        "const windowsIt = rows.length > 0 && metrics.scaledDocumentHeight > metrics.trackHeight;",
        "preview = buildWindowedMinimapClone(source, first, last);",
        // The code view windows too: its rows are the color lines, and the gutter
        // rows beside them are sliced at the same indices or every number would end
        // up labeling the wrong line.
        "function minimapWindowRows(source) {",
        "const code = source.querySelector('.code-view-highlight code');",
        "function buildWindowedMinimapClone(source, first, last) {",
        "into.appendChild(rows[i].cloneNode(true));",
        // Scrolling reads no geometry at all — cached metrics, arithmetic, and CSS
        // variable writes. Re-measuring per wheel click forced a fresh layout of the
        // whole document, which is what made one click take ~2 seconds.
        "function minimapMetricsForScroll(track) {",
        "function invalidateMinimapMetrics() {",
        "function updateMinimapViewportFromScroll() {",
        // Glossary terms are tagged before their hrefs are stripped so the clone can
        // re-blend them (the href-based body blend can't match once href is gone).
        "link.classList.add('glossary-term');",
    ] {
        assert_contains(&html, expected);
    }

    // The clone keeps glossary terms blended into body text like the page, instead
    // of showing them on the generic accent link color.
    assert_contains(
        &css,
        ".document-minimap-preview a.glossary-term {\n  color: inherit;\n}",
    );

    // The real-text clone replaces the old abstract canvas entirely (no 2D
    // context, palette, or line-model rows). Checked across both the shell
    // markup/script and the linked stylesheet since styles no longer inline.
    for forbidden in [
        "document-minimap-canvas",
        "canvas.getContext('2d')",
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

// Both views open the first line at the same height by different means — scroll
// origin in one, padding in the other — so the number lives in two files and has to
// agree, and has to clear the top edge fade that 16px of padding left it inside.
#[test]
fn app_shell_opens_both_views_at_the_same_content_top_gap() {
    let html = app_shell_html();
    let css = reading_mode_css();

    assert_contains(&css, "--reader-content-top-gap: 88px;");
    assert_contains(&html, "const READER_CONTENT_TOP_GAP = 88;");

    // The code view has no scroll origin, so it pays the gap the shell's app-bar
    // padding doesn't already cover. Both of its layers read the same var, so the
    // color layer and the textarea over it stay aligned. (The line numbers are a
    // counter on the color lines, so there is no third layer to keep in step.)
    assert_contains(
        &css,
        "--cv-pad-top: calc(var(--reader-content-top-gap) - var(--app-bar-height));",
    );
    assert_eq!(
        css.matches("padding: var(--cv-pad-top)").count(),
        2,
        "the code view's two aligned layers must share --cv-pad-top"
    );

    // 88px from the shell's top edge is 48px of clear air below the 40px bar, which
    // has to be more than the fade's reach or the first line opens dissolved.
    let fade = css_block(&css, ".reader-edge-fade {");
    assert!(
        fade.contains("--reader-edge-fade-depth: 36px;"),
        "the top fade's depth must stay under the content top gap's clearance"
    );
}

// The clone keeps nothing it inherited, so the elected element has to be the one
// carrying the code view's type ramp, --cv-* vars and `.syn-*` ancestor. Electing
// the `.code-view-doc` inside it shipped a thumbnail shorter than its own track.
// Pinning both halves here means moving one without the other fails.
#[test]
fn app_shell_clones_the_element_holding_the_code_views_metrics() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // Two queries, not a selector list: a list returns the first match in document
    // order, so a `.document-body` left in the DOM behind the code view would win.
    assert_contains(
        &html,
        "return app.querySelector('.code-view') || app.querySelector('.document-body');",
    );

    let code_view = css_block(&css, ".code-view {");
    for declaration in [
        "--cv-gutter:",
        "--cv-pad-x:",
        "--cv-pad-y:",
        "--cv-pad-top:",
        "font-family: var(--code-font);",
        "font-size:",
        "line-height:",
        "tab-size:",
    ] {
        assert!(
            code_view.contains(declaration),
            "the cloned element must carry the code view's {declaration} — \
             move it and minimapSourceElement() has to follow"
        );
    }

    // Cloning the page wrapper brings its fill along; the rail shows text on the
    // chrome, as the reading view's clone does.
    assert_contains(
        &css,
        ".document-minimap-preview.code-view {\n  background: transparent;\n}",
    );
}

#[test]
fn app_shell_maps_minimap_geometry_proportionally() {
    let html = app_shell_html();

    // The box and click/drag mapping derive from the reader's real scroll range,
    // so they track the thumbnail at any length; on tall documents the thumbnail
    // slides in the rail.
    for expected in [
            "const previewScale = contentWidth / sourceWidth;",
            "const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);",
            "const viewportDocumentTop = scrollTop * metrics.previewScale;",
            "const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));",
            "const dragMinimapViewportToPointer = (event, pointerOffsetY) => {",
            "const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;",
            "const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;",
            "minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);",
            "minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);",
            "minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("function minimapViewportGeometry(metrics) {"),
        "the clone minimap replaces the canvas geometry helper"
    );
    // The content-visibility-era clone-offset workaround is gone: the reader renders
    // in full, so the box reads the exact scroll position, not a block-offset table.
    assert!(
        !html.contains("minimapCloneOffsets") && !html.contains("minimapReaderTrueScrolled"),
        "the full-render minimap drops the clone-offset scroll estimate"
    );
}

#[test]
fn app_shell_loads_mermaid_and_renders_diagram_fences_after_document_insert() {
    let html = app_shell_html();

    for expected in [
        "mermaid.min.js",
        "let mermaidLoadPromise = null;",
        "renderMermaidDiagrams();",
        "function loadMermaid() {",
        "function renderMermaidDiagrams() {",
        "pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"])",
        "mermaid.initialize({",
        "securityLevel: 'strict'",
        "fontFamily: \"'Noto Sans', sans-serif\"",
        "return mermaid.run({ nodes: diagrams });",
        "diagram.dataset.mermaidRender = 'failed';",
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
fn app_shell_loads_bundled_katex_and_renders_math_after_document_insert() {
    let html = app_shell_html();

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
    let html = app_shell_html();

    for expected in [
        "let minimapViewportFrame = 0;",
        "function scheduleMinimapViewportUpdate() {",
        "window.requestAnimationFrame(() => {",
        "function updateMinimapViewport() {",
        "app.addEventListener('scroll', () => {",
        "clampReaderScrollPosition();",
        "readerScrollAnchor = captureReaderScrollAnchor();",
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
    let html = app_shell_html();

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
    let html = app_shell_html();

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
            "track.setPointerCapture(event.pointerId);",
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

    // A grab inside the box preserves the offset (drag); a bare click centers
    // the reader on the pointer (snapshot). The drag handler is defined before
    // the snapshot handler in bindDocumentMinimap.
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
    let html = app_shell_html();

    for expected in [
        "const restoreFocus = () => {",
        "const active = document.activeElement;",
        "active.focus({ preventScroll: true });",
        "event.preventDefault();",
        "minimap.style.setProperty('--minimap-viewport-top'",
        "minimap.style.setProperty('--minimap-viewport-height'",
        "updateMinimapViewport();",
    ] {
        assert_contains(&html, expected);
    }
}

#[test]
fn app_shell_sizes_minimap_viewport_from_scroll_fraction() {
    let html = app_shell_html();

    // The box height is the reader window at thumbnail scale, placed from the
    // slide plus scaled scroll top, so it tracks the visible region at any length.
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
    let html = app_shell_html();

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
        "minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);",
    ] {
        assert_contains(&html, expected);
    }

    // The track caps its height at the scaled document height, so a short document
    // gets a short rail with no dead space below it.
    assert!(
        html.contains(
            "const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));"
        ),
        "track sizing caps at the scaled thumbnail height"
    );
}

#[test]
fn app_shell_rebinds_minimap_after_document_updates() {
    let html = app_shell_html();

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
    let html = app_shell_html();

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
fn app_shell_save_success_clears_reader_undo_state() {
    let html = app_shell_html();

    assert_contains(&html, "window.leafSaved = (path, ok, error) => {");
    assert_contains(&html, "undoableByPath.delete(path);");
}

#[test]
fn app_shell_resets_new_documents_to_rendered_content_top() {
    let html = app_shell_html();

    for expected in [
        "let resetReaderScrollOnNextRender = false;",
        "resetReaderScrollOnNextRender = true;",
        "resetReaderScrollToContentStart();",
        "function resetReaderScrollToContentStart() {",
        "const content = correctReaderScrollOrigin(source);",
        "setReaderScrollTop(content.topOffset);",
        "readerScrollAnchor = captureReaderScrollAnchor();",
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
    let html = app_shell_html();

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
    let html = app_shell_html();

    for expected in [
            "let readerLayoutFrame = 0;",
            "let readerScrollAnchor = null;",
            "let readerReflowObserver = null;",
            "const READER_ANCHOR_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, table, details, figure, hr';",
            "function captureReaderScrollAnchor() {",
            // Capture and restore share one cached block list so a serialized
            // {section, block} anchor always resolves back to the element it named.
            "readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));",
            "const blocks = readerAnchorBlockList(source);",
            "return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };",
            "function resolveReaderAnchorElement(anchor) {",
            "function restoreReaderScrollAnchor(anchor) {",
            "setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);",
            "function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {",
            "correctReaderScrollOrigin();",
            "restoreReaderScrollAnchor(anchor);",
            "readerScrollAnchor = captureReaderScrollAnchor();",
            "window.addEventListener('resize', () => {",
            "scheduleReaderLayoutUpdate();",
            // The reflow observer re-pins the anchor as images decode and grow,
            // and drops the stale anchor-block cache so the re-pin resolves
            // against the current DOM rather than detached, zero-rect entries.
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
    // The scroll listener is deliberately inert during a minimap drag, so the minimap
    // must record the anchor itself. When it didn't, the anchor kept the pre-drag
    // position and the next late reflow — most visibly the async bottom pager landing
    // seconds after the document — restored it and threw the reader back up the page.
    let html = app_shell_html();

    for expected in [
        "function recordReaderScrollPosition() {",
        "clampReaderScrollPosition();\n  readerScrollAnchor = captureReaderScrollAnchor();",
        // Rail click (pointerdown, so already flagged as dragging).
        "app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));\n    recordReaderScrollPosition();",
        // Drag release: drop the queued pass built on the pre-drag anchor first,
        // then record where the drag landed.
        "cancelReaderLayoutUpdate();\n      recordReaderScrollPosition();",
        "function cancelReaderLayoutUpdate() {",
        "window.cancelAnimationFrame(readerLayoutFrame);",
    ] {
        assert_contains(&html, expected);
    }

    // Mid-gesture, the queued pass must not re-pin at all: its anchor predates the
    // drag, so restoring it would fight the pointer and undo the jump. A wheel
    // scroll is guarded for the same reason — the anchor is deliberately only
    // refreshed once the scroll settles, so it is stale by design until then.
    let update_start = html
        .find("function scheduleReaderLayoutUpdate(")
        .expect("app shell should schedule reader layout updates");
    let update_body = &html[update_start..];
    let gesture_guard = update_body
        .find("if (minimapDragging || readerScrolling) {")
        .expect("the layout pass should bail while a drag or a scroll owns the reader");
    let repin = update_body
        .find("restoreReaderScrollAnchor(anchor);")
        .expect("the layout pass should re-pin the reader anchor");
    assert!(
        gesture_guard < repin,
        "the gesture bail must come before the anchor re-pin, or a drag gets yanked back to where it started"
    );

    // The clamp and the anchor capture both force a layout, which on a large
    // document is ~400ms — too expensive to run per frame, and nothing reads either
    // mid-gesture. They settle after the wheel stops instead.
    for expected in [
        "function settleReaderScroll() {",
        "readerScrollSettleTimer = window.setTimeout(settleReaderScroll, READER_SCROLL_SETTLE_MS);",
        "let readerScrolling = false;",
    ] {
        assert_contains(&html, expected);
    }
    // The old per-frame version must be gone, or the stall comes back with it.
    assert!(
        !html.contains(
            "readerScrollFrame = window.requestAnimationFrame(() => {\n    readerScrollFrame = 0;\n    clampReaderScrollPosition();"
        ),
        "the scroll listener must not force a layout every frame"
    );
}

#[test]
fn app_shell_disables_minimap_without_leaving_empty_layout_column() {
    let html = app_shell_html();

    for expected in [
            "if (!window.leafMinimap.getEnabled()) {\n    return '';\n  }",
            "const minimapHtml = renderDocumentMinimap(state.document.minimap);",
            "const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';",
            // Rendered hidden, then revealed already decorated: see renderState.
            "app.innerHTML = `<div class=\"${layoutClass}\" style=\"display:none\">${state.document.html}</div>`;",
            // The rail is placed beside the page, not inside it. Empty markup
            // means no rail element at all, which is what collapses the shell
            // column — a hidden one would still satisfy :has().
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
    let html = app_shell_html();

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
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
    assert!(
            html.contains("if (fragmentHref) {")
                && html.contains("send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });")
                && html.contains("send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });"),
            "fragment-only links must be sent through app navigation before non-fragment links are routed"
        );
}

#[test]
fn app_shell_preserves_external_link_routing_for_native_opening() {
    let html = app_shell_html();

    assert_contains(
            &html,
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
        );
    assert!(
        !html.contains(
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor() });"
        ),
        "external and local non-fragment links need the resolved href for native routing"
    );
}

#[test]
fn app_shell_routes_in_page_history_through_app_navigation() {
    let html = app_shell_html();

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
    let html = app_shell_html();
    let css = reading_mode_css();

    // Decoration runs after each document render, over code blocks but not
    // Mermaid diagrams, and copies the <code> text.
    assert!(html.contains("decorateCodeBlocks();"));
    assert!(html.contains(".document-body pre:not(.mermaid)"));
    assert!(html.contains("function copyCodeBlock(button, text)"));
    // Clipboard API with an execCommand fallback for locked-down webviews.
    assert!(html.contains("navigator.clipboard.writeText(text)"));
    assert!(html.contains("document.execCommand('copy')"));
    // The button styling and copied-state swap exist.
    assert!(css.contains(".document-body pre > .code-copy {"));
    assert!(css.contains(".code-copy.is-copied .code-copy-check {"));

    // Labels exist in both dictionaries.
    for key in ["actions.copyCode", "actions.copiedCode"] {
        let needle = format!("'{key}':");
        let count = html.matches(&needle).count();
        assert!(
            count >= 2,
            "expected EN + ZH-CN entries for {key}, found {count}"
        );
    }
}

#[test]
fn app_shell_code_view_is_a_worker_free_monaco_with_its_own_minimap() {
    // The code view is Monaco now: it renders only what's on screen, so typing
    // never re-lays-out the whole document — the stutter the old hand-built color
    // layer fought line by line. Guard the load-bearing choices of that swap.
    let html = app_shell_html();

    // Entering the code view mounts a Monaco container and clears the reader's
    // own rail — Monaco draws its own minimap.
    assert!(html.contains(r#"app.innerHTML = '<div class="code-view-monaco"></div>';"#));
    assert!(html.contains("setMinimapMarkup('');"));

    // Wrapping stays on and the minimap is Monaco's own. The wrap is 'bounded'
    // (not 'on') so applyCodeViewWrapColumn can hold the text short of the minimap
    // — 'on' wraps flush under the minimap's drop-shadow.
    assert!(html.contains("wordWrap: 'bounded',"));
    assert!(html.contains("monacoEditor.onDidLayoutChange(applyCodeViewWrapColumn)"));
    assert!(html.contains("minimap: { enabled: true"));

    // Edits relay to the host as source splices (scheduleSourceUpdate), not a
    // whole-buffer resend per keystroke.
    assert!(html.contains("monacoEditor.onDidChangeModelContent(() => {"));
    assert!(html.contains("scheduleSourceUpdate();"));

    // The bundle loads lazily, and Monaco is handed an inert worker stub so it
    // never spawns a worker or evaluates worker code on the main thread — the
    // app's security policy (no 'unsafe-eval', no blob: workers) stays untouched.
    assert!(html.contains("function loadMonacoOnce()"));
    assert!(html.contains("self.MonacoEnvironment = {"));
    assert!(html.contains("getWorker() {"));
}

// The code view's wrap is a column count, so it is only a width once a character has
// been measured — and every theme brings its own code font. Monaco measures a font
// when it is told to use it, which for a web font is before the face has arrived, so
// it measures the fallback; a font landing changes no geometry, so the layout event
// the column rides never fires to correct it. The wrap therefore looked like a
// property of the theme: text running under the minimap on some, stopping short on
// others, depending only on whether that font was already loaded and how wide the
// fallback was.
//
// The re-fit is pinned here because it has to keep working for fonts nobody has picked
// yet: it is driven by the web view saying "faces finished loading", which names no
// font and covers every source, so a new theme needs no code. Anything that starts
// listing font names, or fits only the fonts that ship today, fails this test.
#[test]
fn app_shell_refits_the_code_view_wrap_to_whatever_font_is_actually_measured() {
    let html = app_shell_html();

    // Forcing the measurement again is the load-bearing half — Monaco does not
    // re-measure on its own — and the column cache has to go first, because the same
    // count against a different font reads as "nothing changed".
    let refit = html
        .split("function refitCodeViewToFont()")
        .nth(1)
        .expect("the shell must expose the wrap re-fit");
    let refit = &refit[..refit.find("\n}").expect("re-fit body should close")];
    assert_contains(refit, "editor.remeasureFonts();");
    assert_contains(refit, "codeViewWrapColumn = 0;");
    assert_contains(refit, "applyCodeViewWrapColumn();");

    // Both things that change the measurement re-fit: the theme's own font swap, and
    // any face finishing its load afterwards. The listener is generic on purpose —
    // `loadingdone` fires for every font from every source and names none.
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

#[test]
fn code_view_line_numbers_are_a_counter_on_the_lines_they_label() {
    // They used to be a second layer, three elements per line — 228,000 of them on
    // a 76,000-line file — kept in step with the color lines only by wrapping
    // identically. That held until a number was too wide for the gutter: at the
    // fixed 3.75em, line 10,000's fifth digit wrapped, every row past it went
    // double height, and the numbers ended a million pixels below their own text.
    // A counter on the color lines cannot drift, because there is only one layer.
    let html = app_shell_html();
    let css = reading_mode_css();

    let line = css_block(css, ".cv-line {");
    assert!(
        line.contains("counter-increment: cv-line;") && line.contains("position: relative;"),
        "each color line counts itself and hosts its own number: {line}"
    );
    assert_contains(css, "counter-reset: cv-line;");
    let number = css_block(css, ".cv-line::before {");
    for expected in [
        "content: counter(cv-line);",
        "position: absolute;",
        // Out of flow, so a wrapped line still gets one number on its first row.
        "right: 100%;",
        "white-space: nowrap;",
    ] {
        assert!(
            number.contains(expected),
            "{expected} missing from: {number}"
        );
    }
    // The second layer, and everything that maintained it, is gone.
    for absent in [
        "code-view-linenums",
        "cv-lnrow",
        "cv-lnnum",
        "cv-lntxt",
        "makeGutterRow",
    ] {
        assert!(
            !html.contains(absent) && !css.contains(absent),
            "the mirrored gutter layer is gone; found {absent}"
        );
    }

    // The gutter still has to be wide enough for the highest number, or the
    // counter's text would overflow into the line it labels.
    assert_contains(
        &html,
        "function sizeLineNumberGutter(codeView, lineCount) {",
    );
    assert_contains(
        &html,
        "codeView.style.setProperty('--cv-gutter', `max(3.75em, ${digits}ch + 1.25em)`);",
    );
    // Sized in `ch`, which is exact only because the code view is monospace.
    let code_view = css_block(css, ".code-view {");
    assert!(
        code_view.contains("font-family: var(--code-font);"),
        "the ch-based gutter assumes the code view's monospace font: {code_view}"
    );
}
