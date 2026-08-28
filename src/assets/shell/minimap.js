// ---- The rail's width: whatever the code view's map comes out as -------------
//
// The code view's minimap is Monaco's, and Monaco has no width setting — it works one out from the room the window can spare it. The rail does the same arithmetic here, so both views' pages end at the same place without the code view ever having been opened. Monaco's own figures, and its defaults for the parts the code view leaves alone; the last one is the only guess, and it moves the answer by a fraction of a pixel.
const MONACO_FONT_SIZE = 14;
const MONACO_MINIMAP_MAX_COLUMN = 120;
// The map's own left inset, and the character it draws a column with: one pixel of the screen over the pixel ratio, doubled on the sharpest screens.
const MONACO_MINIMAP_INSET = 8;
function monacoMinimapCharWidth() {
  const ratio = window.devicePixelRatio || 1;
  return (ratio >= 2 ? 2 : 1) / ratio;
}
// The three gutters left of the text: the icon margin (a line tall), the line numbers (five digits at least), and the fold arrows' lane.
const MONACO_LINE_NUMBER_MIN_DIGITS = 5;
const MONACO_DECORATIONS_WIDTH = 10 + 16;
const MONACO_LINE_HEIGHT_RATIO = 1.35;

// The code font at Monaco's size, measured the way Monaco measures it: the width of an 'n', and of the widest digit. Off the page in a run of copies, divided back down, so the answer keeps its fractions. Measured on demand rather than kept, because a theme brings its own code font and a face lands after the page has asked for it.
const MONACO_MEASURE_RUN = 32;
function monacoCodeFontWidths() {
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue('--code-font')
    .trim();
  if (!family || !document.body) return null;
  const ruler = document.createElement('span');
  ruler.style.cssText = `position:absolute;top:-9999px;left:-9999px;white-space:pre;font:${MONACO_FONT_SIZE}px ${family}`;
  appSurface.appendChild(ruler);
  const runWidth = (glyph) => {
    ruler.textContent = glyph.repeat(MONACO_MEASURE_RUN);
    return ruler.getBoundingClientRect().width / MONACO_MEASURE_RUN;
  };
  const char = runWidth('n');
  let digit = 0;
  for (const glyph of '0123456789') digit = Math.max(digit, runWidth(glyph));
  ruler.remove();
  return char > 0 && digit > 0 ? { char, digit } : null;
}

// How wide the editor is in the code view — the whole reader area, since the rail's column collapses there. Measured off the window's own grid rather than the reading view's shell, which is narrower by exactly the rail this is sizing.
function codeViewEditorWidth() {
  if (!libraryShell) return 0;
  const root = getComputedStyle(document.documentElement);
  const library = Number.parseFloat(root.getPropertyValue('--library-rail-width'));
  const gutter = Number.parseFloat(root.getPropertyValue('--reader-gutter'));
  const width =
    libraryShell.clientWidth -
    (Number.isFinite(library) ? library : 0) -
    (Number.isFinite(gutter) ? gutter : 0);
  return width > 0 ? width : 0;
}

// Monaco's minimap width for that editor: a hundred and twenty of its columns, or the share of the leftover room it is willing to spend, whichever is smaller. The leftover is the editor less the gutters; nothing is taken off for a scrollbar, because the code view turns Monaco's off.
function monacoMinimapWidth() {
  const editor = codeViewEditorWidth();
  const font = monacoCodeFontWidths();
  if (!editor || !font) return 0;
  const column = monacoMinimapCharWidth();
  const gutters =
    Math.round(MONACO_LINE_HEIGHT_RATIO * MONACO_FONT_SIZE) +
    Math.round(MONACO_LINE_NUMBER_MIN_DIGITS * font.digit) +
    MONACO_DECORATIONS_WIDTH;
  const spare = Math.max(0, Math.floor(((editor - gutters - 2) * column) / (font.char + column)));
  return Math.min(
    Math.floor(MONACO_MINIMAP_MAX_COLUMN * column),
    spare + MONACO_MINIMAP_INSET
  );
}

// Hand it to the stylesheet, which sizes the rail and the page's column from it. Left alone when it can't be worked out, so the stylesheet's own figure stands.
function syncMinimapWidthToCodeView() {
  const width = monacoMinimapWidth();
  if (width > 0) {
    document.documentElement.style.setProperty('--minimap-width', `${width}px`);
  }
}

// The window resizing, the library pane being dragged, and a code font arriving all change the answer, and none of them announces itself the same way.
let minimapWidthFrame = 0;
function scheduleMinimapWidthSync() {
  if (minimapWidthFrame) return;
  minimapWidthFrame = requestAnimationFrame(() => {
    minimapWidthFrame = 0;
    // Mid library-toggle this write changes a grid column and retargets the pane's transition, desyncing it from the bar. Drop it — the motion's own end asks again. Re-arming here instead keeps the page drawing frames for the whole gesture.
    if (libraryPaneIsMoving()) return;
    syncMinimapWidthToCodeView();
  });
}
window.addEventListener('resize', scheduleMinimapWidthSync);
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', scheduleMinimapWidthSync);
}
// The reader, not the window's grid: dragging the pane resizes this and leaves the grid alone. Its own width is not read above, so setting the rail can't feed back in.
if (window.ResizeObserver && app) {
  new ResizeObserver(scheduleMinimapWidthSync).observe(app);
}
syncMinimapWidthToCodeView();

// The rail starts loading: the thumbnail clones the rendered document, so it can't exist until the document is laid out — on a large file, long enough that an empty rail beside a finished page looks broken rather than busy.
function documentMinimapMarkup() {
  return `<aside class="document-minimap is-loading" aria-label="Document minimap"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="lt-spinner document-minimap-spinner" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>`;
}
function renderDocumentMinimap(model) {
  if (!window.leafMinimap.getEnabled()) {
    return '';
  }
  if (!model || !Number.isFinite(model.line_count) || model.line_count <= 0) {
    return '';
  }
  return documentMinimapMarkup();
}
// The rail lives beside the page rather than inside it, so every render has to place it here instead of in its own markup. Empty means no rail at all — the shell's :has(.document-minimap) collapses the column it would occupy.
//
// The scroller is told directly rather than left to :has(): scrollbar styles do not re-resolve when a :has() match flips, so the bar outlives the rail.
function setMinimapMarkup(html) {
  if (readerMinimap) readerMinimap.innerHTML = html || '';
  if (app) app.classList.toggle('has-minimap', Boolean(html));
}
function currentMinimap() {
  return readerMinimap ? readerMinimap.querySelector('.document-minimap') : null;
}
function bindDocumentMinimap() {
  const minimap = currentMinimap();
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  if (!track) {
    return;
  }
  const restoreFocus = () => {
    const active = document.activeElement;
    return () => {
      if (active && typeof active.focus === 'function' && document.contains(active)) {
        active.focus({ preventScroll: true });
      }
    };
  };
  const minimapPointerOffset = (event) => {
    const viewport = track.querySelector('.document-minimap-viewport');
    const viewportRect = viewport ? viewport.getBoundingClientRect() : null;
    if (!viewportRect || event.clientY < viewportRect.top || event.clientY > viewportRect.bottom) {
      return null;
    }
    return event.clientY - viewportRect.top;
  };
  // Dragging the handle keeps the grabbed point of the box under the cursor and converts the box's new position back into a scroll offset — the inverse of placeMinimapViewport()'s box placement, so the box and the thumbnail slide stay under the cursor even on documents taller than the rail.
  const dragMinimapViewportToPointer = (event, pointerOffsetY) => {
    // Use the geometry captured at pointerdown — never re-measure mid-drag (that forces a layout each move; see minimapDragMetrics).
    const metrics = minimapDragMetrics || measureDocumentMinimap(track);
    const rect = metrics.trackRect;
    if (rect.height <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const boundedViewportHeight = Math.min(metrics.trackHeight, Math.max(22, metrics.viewportHeight * metrics.previewScale));
    const handleRange = Math.max(0, metrics.trackHeight - boundedViewportHeight);
    const offsetY = Number.isFinite(pointerOffsetY) ? pointerOffsetY : boundedViewportHeight / 2;
    const targetViewportTop = Math.min(handleRange, Math.max(0, event.clientY - rect.top - offsetY));
    // Invert placeMinimapViewport()'s box placement (box top = scrollTop times a slope), so a box position divides back into a scroll offset. Fall back to the handle-range ratio when that slope is non-positive.
    const previewTravel = Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);
    const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;
    const targetViewportScrollTop = viewportTopPerScrollPixel > 0
      ? targetViewportTop / viewportTopPerScrollPixel
      : (handleRange <= 0 ? 0 : (targetViewportTop / handleRange) * metrics.scrollable);
    // Set scrollTop against the cached range, then pin the box + thumbnail. The scroll handler skips its update while dragging; pointerup settles once.
    const boundedScrollTop = Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop));
    app.scrollTop = boundedScrollTop;
    const minimap = track.closest('.document-minimap');
    if (minimap) {
      placeMinimapViewport(minimap, metrics, boundedScrollTop);
      // A drag can cross the whole document, so the window follows it or the rail slides onto a blank stretch. Coalesced to one rebuild a frame.
      if (!minimapWindowCoversView(metrics, boundedScrollTop)) {
        scheduleMinimapPreviewUpdate();
      }
    } else {
      updateMinimapViewport();
    }
  };
  // A plain click on the rail centers the reader on the clicked point of the thumbnail (mapped straight through the preview scale).
  const scrollToMinimapSnapshotPoint = (event) => {
    const metrics = measureDocumentMinimap(track);
    const content = track.querySelector('.document-minimap-content');
    const contentRect = content ? content.getBoundingClientRect() : null;
    if (!contentRect || contentRect.height <= 0 || metrics.previewScale <= 0 || metrics.scrollable <= 0) {
      updateMinimapViewport();
      return;
    }
    const clickedDocumentY = (event.clientY - contentRect.top) / metrics.previewScale;
    app.scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));
    recordReaderScrollPosition();
    updateMinimapViewport();
  };
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const focusAfterJump = restoreFocus();
    event.preventDefault();
    minimapPointerId = event.pointerId;
    minimapDragging = true;
    minimapPointerOffsetY = minimapPointerOffset(event);
    // Measure the document geometry ONCE for the whole drag (see minimapDragMetrics).
    minimapDragMetrics = measureDocumentMinimap(track);
    leafHoldPointer(track, event.pointerId);
    if (Number.isFinite(minimapPointerOffsetY)) {
      dragMinimapViewportToPointer(event, minimapPointerOffsetY);
    } else {
      scrollToMinimapSnapshotPoint(event);
    }
    focusAfterJump();
  });
  track.addEventListener('pointermove', (event) => {
    if (event.pointerId !== minimapPointerId) {
      return;
    }
    event.preventDefault();
    dragMinimapViewportToPointer(event, minimapPointerOffsetY);
  });
  const endDrag = (event) => {
    if (event.pointerId === minimapPointerId) {
      minimapPointerId = null;
      minimapPointerOffsetY = null;
      minimapDragging = false;
      minimapDragMetrics = null;
      // A pass queued mid-drag holds the pre-drag anchor, so drop it before recording where the drag landed; either omission snaps the reader back to the start.
      cancelReaderLayoutUpdate();
      recordReaderScrollPosition();
      // Settle the box/thumbnail onto the true reading position; content that streamed in keeps settling via the reflow observer.
      updateMinimapViewport();
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  bindDocumentMinimapPreview(track);
}
// The minimap is a shrunken clone of the rendered document, so the rail shows real text. The clone rebuilds only on content changes, never on scroll (which only moves the viewport box and, on tall documents, the thumbnail's slide). The element it mirrors: the reading view's document body. The rail is a reading-view affordance — the code view has the editor's own minimap instead.
function minimapSourceElement() {
  return app.querySelector('.document-body');
}
function bindDocumentMinimapPreview(track) {
  disconnectMinimapPreviewObservers();
  const source = minimapSourceElement();
  if (!source) {
    return;
  }
  minimapBodyObserver = new MutationObserver(invalidateMinimapPreview);
  minimapBodyObserver.observe(source, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  if (window.ResizeObserver) {
    // Watch the rail, not the document: its width changes at the responsive breakpoints (which the source's resize would miss), and it never fires on scroll.
    minimapResizeObserver = new ResizeObserver(() => {
      invalidateMinimapMetrics();
      scheduleReaderLayoutUpdate();
      scheduleMinimapPreviewUpdate();
    });
    minimapResizeObserver.observe(track);
  }
  source.querySelectorAll('img').forEach((image) => {
    if (image.complete) {
      return;
    }
    image.addEventListener('load', invalidateMinimapPreview, { once: true });
    image.addEventListener('error', invalidateMinimapPreview, { once: true });
  });
  scheduleMinimapPreviewUpdate();
}
function disconnectMinimapPreviewObservers() {
  if (minimapBodyObserver) {
    minimapBodyObserver.disconnect();
    minimapBodyObserver = null;
  }
  if (minimapResizeObserver) {
    minimapResizeObserver.disconnect();
    minimapResizeObserver = null;
  }
  if (minimapPreviewFrame) {
    window.cancelAnimationFrame(minimapPreviewFrame);
    minimapPreviewFrame = 0;
  }
  // A different document is coming: force the next update to rebuild the clone.
  minimapBuiltVersion = -1;
  minimapBuiltSourceWidth = -1;
  minimapBuiltPreviewWidth = -1;
  minimapBuiltFrameWidth = -1;
  minimapBuiltRange = null;
  minimapBuiltFirstRow = -1;
  minimapBuiltLastRow = -1;
  invalidateMinimapMetrics();
}
// Drop the cached rail geometry. Everything that can change it calls this; the scroll handler, which cannot, is the one path that reads the cache.
function invalidateMinimapMetrics() {
  minimapScrollMetrics = null;
}
function minimapMetricsForScroll(track) {
  if (minimapScrollMetrics && minimapScrollMetrics.track === track) {
    return minimapScrollMetrics;
  }
  minimapScrollMetrics = Object.assign({ track }, measureDocumentMinimap(track));
  return minimapScrollMetrics;
}
function measureDocumentContent(source) {
  if (!source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const shellRect = app.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const firstContent = source.firstElementChild;
  const firstContentRect = firstContent ? firstContent.getBoundingClientRect() : sourceRect;
  const rawTopOffset = Math.ceil(app.scrollTop + firstContentRect.top - shellRect.top);
  const topOffset = Math.max(0, rawTopOffset - READER_CONTENT_TOP_GAP);
  const sourceTop = Math.max(0, app.scrollTop + sourceRect.top - shellRect.top);
  const sourceBottom = sourceTop + Math.max(source.scrollHeight, sourceRect.height);
  const height = Math.max(1, Math.ceil(sourceBottom - topOffset));
  return { rawTopOffset, topOffset, height };
}
function readerScrollOrigin(source) {
  if (!source) {
    return 0;
  }
  const value = Number.parseFloat(source.style.getPropertyValue('--reader-scroll-origin'));
  return Number.isFinite(value) ? value : 0;
}
function correctReaderScrollOrigin(source = app.querySelector('.document-body')) {
  if (!currentState?.document || !source) {
    return { rawTopOffset: 0, topOffset: 0, height: 1 };
  }
  const content = measureDocumentContent(source);
  const origin = readerScrollOrigin(source);
  const nextOrigin = Math.max(0, Math.ceil(content.rawTopOffset + origin - READER_CONTENT_TOP_GAP));
  // >=2px dead-band: the ideal origin can fall on a half-pixel with no integer fixed point, flipping 1px each frame (e.g. 177<->178) and driving an endless relayout loop via the minimap ResizeObserver. Sub-2px jitter is invisible; ignore it.
  if (Math.abs(nextOrigin - origin) >= 2) {
    source.style.setProperty('--reader-scroll-origin', `${nextOrigin}px`);
  }
  return measureDocumentContent(source);
}
function measureReaderScrollRange(documentContent, viewportHeight) {
  const scrollHeight = Math.max(documentContent.height, Math.ceil(app.scrollHeight - documentContent.topOffset));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollHeight,
    scrollable,
    minScrollTop: documentContent.topOffset,
    maxScrollTop: documentContent.topOffset + scrollable,
  };
}
function clampReaderScrollTop(scrollTop) {
  const nextScrollTop = Number(scrollTop);
  if (!Number.isFinite(nextScrollTop)) {
    return 0;
  }
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return Math.max(0, nextScrollTop);
  }
  const content = correctReaderScrollOrigin(source);
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
  const range = measureReaderScrollRange(content, viewportHeight);
  return Math.min(range.maxScrollTop, Math.max(range.minScrollTop, nextScrollTop));
}
function setReaderScrollTop(scrollTop) {
  app.scrollTop = clampReaderScrollTop(scrollTop);
}
function clampReaderScrollPosition() {
  if (!currentState?.document) {
    return false;
  }
  const clampedScrollTop = clampReaderScrollTop(app.scrollTop);
  if (Math.abs(clampedScrollTop - app.scrollTop) < 0.5) {
    return false;
  }
  app.scrollTop = clampedScrollTop;
  return true;
}
let resetReaderScrollFrame = 0;
function resetReaderScrollToContentStart() {
  dropViewLandingsFromAnotherDocument(activeDocumentPath());
  // Coalesce: back-to-back renders each scheduling a reset must not run it twice — the second pass would see the toggle fraction already consumed and hard-reset a mid-document reader to the top.
  if (resetReaderScrollFrame) {
    return;
  }
  resetReaderScrollFrame = window.requestAnimationFrame(() => {
    resetReaderScrollFrame = 0;
    const source = app.querySelector('.document-body');
    const content = correctReaderScrollOrigin(source);
    // Leaving the code view carries its scroll fraction here so the reading view lands at the same relative position; other resets have none.
    const fraction = pendingViewScrollFraction;
    pendingViewScrollFraction = null;
    if (fraction) {
      const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
      const range = measureReaderScrollRange(content, viewportHeight);
      setReaderScrollTop(content.topOffset + fraction * range.scrollable);
    } else {
      setReaderScrollTop(content.topOffset);
    }
    recordReaderLanded();
    refreshReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Describe the reader's position as a render-independent anchor: nearest heading slug above the top edge, block ordinal within that section (heading = block 0), and the signed offset from that block's top (signed to keep the reading-mode top gap). Measuring from the section keeps the landing stable when earlier sections grow (live reload). Anchor blocks are in document order, so the topmost-visible one is found by binary search rather than scanning all ~25k.
function readerAnchorBlockList(source) {
  const count = source.childElementCount;
  // Rebuild when the body was replaced, the child count shifted, or either end of the cached list detached. Checking the last block too catches async DOM swaps (Mermaid, KaTeX, code decoration) that leave detached, zero-rect entries — those break the binary search's document-order assumption.
  const stale =
    !readerAnchorBlocks ||
    readerAnchorBlocksSource !== source ||
    readerAnchorBlocksCount !== count ||
    !readerAnchorBlocks.length ||
    !readerAnchorBlocks[0].isConnected ||
    !readerAnchorBlocks[readerAnchorBlocks.length - 1].isConnected;
  if (stale) {
    // Never what is inside a drawing. A mermaid label is a `<p>` in a `<foreignObject>`, so diagrams landing add hundreds of slots to this list; the reader's place is "the nth block after this heading", and slots appearing above it walk the restore back toward the top.
    readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR)).filter(
      (block) => !block.closest('svg'),
    );
    readerAnchorBlocksCount = count;
    readerAnchorBlocksSource = source;
  }
  return readerAnchorBlocks;
}
// Turn a block-list index into the serializable {section, block, offsetY} anchor: nearest heading slug above it, the block's ordinal within that section, and its signed offset from the reader's top edge. Shared by the top-visible capture and the anchor-above fallback used while editing a block whose height swings.
function anchorForBlockIndex(blocks, targetIndex, shellRect) {
  let sectionIndex = -1;
  let section = null;
  for (let i = targetIndex; i >= 0; i--) {
    const element = blocks[i];
    if (/^H[1-6]$/.test(element.tagName) && element.id) {
      section = element.id;
      sectionIndex = i;
      break;
    }
  }
  const target = blocks[targetIndex];
  const rect = target.getBoundingClientRect();
  const offsetY = shellRect.top - rect.top;
  return { section, block: targetIndex - (sectionIndex < 0 ? 0 : sectionIndex), offsetY };
}
// Whether the reader is off screen. The map hides `#app` outright, and a hidden element measures zero on every box it has — so a place read while this answers true is not a bad reading of where the reader is, it is a reading of nothing at all.
function readerOffScreen() {
  return !app || app.hidden === true;
}
// Re-record where the reader is now. A reader that is off screen has no answer to give, so the anchor it was holding before it went stands; a reader on screen with nothing to anchor to genuinely has no place, and that null is the truth.
function refreshReaderScrollAnchor() {
  if (readerOffScreen()) {
    return;
  }
  readerScrollAnchor = captureReaderScrollAnchor();
  announceReaderSection();
}
// The heading the line a document is read from is under, as its id — null above the first one, and null in a document with no headings. Published rather than worked out: it is the answer the binary search above already reached on its way to placing the reader, so anything that wants to show where somebody is reading costs nothing per scroll.
function readerSectionAtReadingLine() {
  return readerScrollAnchor ? readerScrollAnchor.section : null;
}
// What was last said. Undefined until the first answer, so a document opening above its own first heading still says its null once.
let readerSectionSaid;
// Say which section the reader is in, where it has changed since the last time. A scroll within one section says nothing, which is most scrolls.
function announceReaderSection() {
  const section = readerSectionAtReadingLine();
  if (section === readerSectionSaid) {
    return;
  }
  readerSectionSaid = section;
  lightLibraryOutlineSection(section);
}
// Forget what was said, so the next announcement lands however the anchor compares. A fresh document is the case: its first section can be the same id the last document's was.
function forgetReaderSection() {
  readerSectionSaid = undefined;
}
function captureReaderScrollAnchor() {
  const source = app.querySelector('.document-body');
  // No answer rather than a wrong one: every block's box reads zero while the reader is hidden, so the search below clears none of them and falls through to its seed — the last block of the document, which is the very bottom of the page.
  if (readerOffScreen() || !currentState?.document || !source) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  const shellRect = app.getBoundingClientRect();
  // Where reading starts, not where the shell does: the app bar covers the strip between them, so a block ending in there has left the page and would otherwise name the section the reader can no longer see.
  const topEdge = shellRect.top + READER_CONTENT_TOP_GAP;
  let lo = 0;
  let hi = blocks.length - 1;
  let targetIndex = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > topEdge) {
      targetIndex = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return anchorForBlockIndex(blocks, targetIndex, shellRect);
}
// Settle the reader where it now sits and re-record that as the anchor. Every reflow re-pin restores readerScrollAnchor, so anything moving app.scrollTop itself must call this — a stale anchor turns the next late layout change (an image decoding, the async pager landing) into a yank back to the pre-jump position. The scroll listener covers user scrolls; the minimap, which it ignores, calls this instead.
function recordReaderScrollPosition() {
  clampReaderScrollPosition();
  refreshReaderScrollAnchor();
}
// Anchor to the nearest anchorable block strictly above `el`, keeping its offset from the top edge. Blocks above a block never move when it resizes, so this holds the reader steady while an image collapses to source and re-decodes on commit — at worst landing on the line directly above the image, never the top. Null when `el` is the first block (nothing above it to anchor to).
function anchorAboveElement(el) {
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source || !el) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  const elTop = el.getBoundingClientRect().top;
  let chosenIndex = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Skip the edited block itself and any nested anchor blocks it contains (a blockquote/table maps as one editable block but its rows are in the list).
    if (el.contains(block) || block.contains(el)) {
      continue;
    }
    if (block.getBoundingClientRect().top < elTop - 0.5) {
      chosenIndex = i;
    } else {
      break;
    }
  }
  if (chosenIndex < 0) {
    return null;
  }
  return anchorForBlockIndex(blocks, chosenIndex, app.getBoundingClientRect());
}
// Re-resolve a serializable anchor against the current DOM: the same Markdown renders the same blocks, so it points at the original element after a re-render.
function resolveReaderAnchorElement(anchor) {
  const source = app.querySelector('.document-body');
  if (!source || !anchor) {
    return null;
  }
  // Resolve against the same list capture used, so a serialized {section, block} pair always points back at the element it named. A divergent list here would shift the index and land the restore on the wrong block.
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  let start = 0;
  if (anchor.section) {
    const index = blocks.findIndex((element) => element.id === anchor.section && /^H[1-6]$/.test(element.tagName));
    if (index >= 0) {
      start = index;
    }
  }
  const block = Math.max(0, Math.floor(Number(anchor.block) || 0));
  return blocks[Math.min(start + block, blocks.length - 1)] || blocks[blocks.length - 1];
}
function restoreReaderScrollAnchor(anchor) {
  const element = resolveReaderAnchorElement(anchor);
  if (!element || !element.isConnected) {
    clampReaderScrollPosition();
    return;
  }
  // Settle the origin before measuring — the clamp's own correction would shift the layout after these rects are read and land off by the change.
  correctReaderScrollOrigin();
  const shellRect = app.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const offsetY = Number.isFinite(anchor?.offsetY) ? anchor.offsetY : 0;
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);
}
// The anchor is read in the frame, never at the call. A diagram pass holds the thread long enough that this frame can run after a scroll that came later, and an anchor taken at the call is the place before it — the top, often enough.
function scheduleReaderLayoutUpdate() {
  if (readerLayoutFrame) {
    return;
  }
  readerLayoutFrame = window.requestAnimationFrame(() => {
    readerLayoutFrame = 0;
    // Nothing to pin while the reader is off screen, and nothing honest to measure either: hidden, it reads as flush at the top, so every line below would write the top of the document over the place the reader is holding.
    if (readerOffScreen()) {
      return;
    }
    // The origin write below can change the document's height, so the rail's cached geometry can't outlive it.
    invalidateMinimapMetrics();
    correctReaderScrollOrigin();
    // A minimap drag owns the scroll: the drag skips the refresh to keep layout reads off the pointer path, so re-pinning would throw the reader back to where the drag started. Leave the box alone too; endDrag settles both. A wheel gesture owns it for the same reason — readerScrollAnchor is deliberately only refreshed once the scroll settles, so re-pinning to it mid-gesture would drag the reader back.
    if (minimapDragging || readerScrolling) {
      return;
    }
    // Past the guard, settleReaderScroll has run, so the anchor is current.
    restoreReaderScrollAnchor(readerScrollAnchor || captureReaderScrollAnchor());
    // Keep the anchor we hold when the capture has nothing to say: a pass queued by the map's reveal lands after the source editor has replaced the document, and its null would be the reader's place written away.
    readerScrollAnchor = captureReaderScrollAnchor() || readerScrollAnchor;
    updateMinimapViewport();
  });
}
// Drop a queued layout pass whose captured `anchor` has been superseded.
function cancelReaderLayoutUpdate() {
  if (readerLayoutFrame) {
    window.cancelAnimationFrame(readerLayoutFrame);
    readerLayoutFrame = 0;
  }
}
function disconnectReaderReflowObserver() {
  if (readerReflowObserver) {
    readerReflowObserver.disconnect();
    readerReflowObserver = null;
  }
}
// Keep the reader pinned to its anchor as the document settles: images decode a few frames late and grow content above the reader, so re-pinning on every reflow and image load holds the reader on the same block until layout is final.
function observeReaderReflow() {
  disconnectReaderReflowObserver();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    readerReflowObserver = new ResizeObserver(() => {
      // A resize means the block set may have changed (images decoding, Mermaid/KaTeX/code decoration swapping nodes in). Drop the cached anchor list so the next capture reflects the current DOM. Cheap: resizes are rare.
      readerAnchorBlocks = null;
      scheduleReaderLayoutUpdate();
    });
    readerReflowObserver.observe(source);
  }
  source.querySelectorAll('img').forEach((image) => {
    if (image.complete) {
      return;
    }
    image.addEventListener('load', () => scheduleReaderLayoutUpdate(), { once: true });
    image.addEventListener('error', () => scheduleReaderLayoutUpdate(), { once: true });
  });
}
function minimapAvailableHeight(minimap) {
  const shellRect = app.getBoundingClientRect();
  const minimapRect = minimap.getBoundingClientRect();
  return Math.max(1, Math.floor(shellRect.bottom - minimapRect.top));
}
// Everything the preview and viewport renderers need, in one layout read. The reader renders in full, so app.scrollTop/scrollHeight/clientHeight are exact. Mirrors the web minimap's measure() (site/minimap.js).
function measureDocumentMinimap(track) {
  const minimap = track.closest('.document-minimap');
  const source = minimapSourceElement();
  const appRect = app.getBoundingClientRect();
  const sourceRect = source ? source.getBoundingClientRect() : null;
  const sourceWidth = sourceRect ? Math.max(1, Math.ceil(sourceRect.width)) : 1;
  const content = minimap ? minimap.querySelector('.document-minimap-content') : null;
  const contentWidth = content ? Math.max(1, Math.ceil(content.getBoundingClientRect().width)) : sourceWidth;
  const trackRect = track.getBoundingClientRect();
  const scrollHeight = Math.max(1, Math.ceil(app.scrollHeight));
  const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  const scrollTop = Math.min(scrollable, Math.max(0, app.scrollTop));
  // Where the document content begins in the scroll container (top gap included); the thumbnail starts here too so its top lines up with the real content.
  const sourceTop = sourceRect ? Math.max(0, Math.round(sourceRect.top - appRect.top + app.scrollTop)) : 0;
  const previewScale = contentWidth / sourceWidth;
  const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);
  // Size the rail to the thumbnail, capped at the space below its top: a short document gets a short rail, a long one fills the screen and slides inside.
  const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;
  const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));
  // Straight onto the track, never a custom property on the rail's root: a custom property inherits, so one write there re-resolves style across every element of the clone under it — 91.73ms measured against 0.13ms for this.
  track.style.height = `${trackHeight}px`;
  return { source, sourceWidth, contentWidth, sourceTop, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, scrollTop, previewScale, scaledDocumentHeight };
}
// A diagram pass rebuilds the document a batch at a time, and each batch would otherwise rebuild the clone — cloning every SVG in the rail's window, over and over. Hold the rail for the pass and build it once at the end: a moment stale, never wrong. Counted, so one pass finishing cannot release another's hold.
let minimapPreviewHolds = 0;
function pauseMinimapPreview() {
  minimapPreviewHolds += 1;
  // The loading state is not this hold's to set. It hides the position box outright, which is right for a thumbnail about to be replaced wholesale — and that case never comes through here: it is the class a fresh render's own markup carries, off again when the thumbnail lands. A diagram pass changes three blocks a screen away, and on a wheel down a long document that is a settle every few hundred milliseconds, so the box blinked all the way down.
  if (minimapPreviewFrame) {
    window.cancelAnimationFrame(minimapPreviewFrame);
    minimapPreviewFrame = 0;
  }
}
function resumeMinimapPreview() {
  if (!minimapPreviewHolds) {
    return;
  }
  minimapPreviewHolds -= 1;
  if (!minimapPreviewHolds) {
    scheduleMinimapPreviewUpdate();
  }
}
function scheduleMinimapPreviewUpdate() {
  if (minimapPreviewFrame || minimapPreviewHolds) {
    return;
  }
  minimapPreviewFrame = window.requestAnimationFrame(() => {
    minimapPreviewFrame = 0;
    updateDocumentMinimapPreview();
  });
}
// The document content changed: mark the clone stale and schedule a rebuild. Geometry-only triggers (resize) call scheduleMinimapPreviewUpdate directly and let the width check decide whether a rebuild is needed.
function invalidateMinimapPreview() {
  minimapContentVersion += 1;
  invalidateMinimapMetrics();
  scheduleMinimapPreviewUpdate();
}
// Any <details> open/close (outline, settings, library folders) changes document height, so the minimap clone goes stale. The body MutationObserver misses the bare `open` flip; `toggle` catches both — in capture phase, since it doesn't bubble.
//
// Never the rail's own clone. Inserting a clone holding an open <details> fires `toggle` on it, and this listener is on the document — so answering it is the rail calling its own thumbnail a change to the page: 234 rebuilds in 29 frames at 48ms with nothing scrolling. The test must be `.document-minimap`; the clone is a cloned `.document-body`, so that class is true of both. Not inside invalidateMinimapPreview, which is also the body watcher's callback and both image callbacks, none of them handed an event.
function invalidateMinimapPreviewForToggle(event) {
  const target = event && event.target;
  if (target && typeof target.closest === 'function' && target.closest('.document-minimap')) {
    return;
  }
  invalidateMinimapPreview();
}
document.addEventListener('toggle', invalidateMinimapPreviewForToggle, true);
// Where the rail's top and bottom edges fall in the document, in document pixels. Mirrors placeMinimapViewport's previewTop, which is what actually slides the thumbnail — the two must agree or the clone would be built for the wrong slice.
function minimapVisibleDocumentRange(metrics, scrollTop) {
  const ratio = metrics.scrollable === 0
    ? 0
    : Math.min(1, Math.max(0, scrollTop / metrics.scrollable));
  const previewTop = -ratio * Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);
  const top = metrics.previewScale > 0 ? -previewTop / metrics.previewScale : 0;
  const height = metrics.previewScale > 0 ? metrics.trackHeight / metrics.previewScale : 0;
  return { top, bottom: top + height, height };
}
// Extra document to keep either side of the visible slice, as a multiple of it. One each way means a whole rail's worth of scrolling before a rebuild.
const MINIMAP_WINDOW_SLACK = 1;
// Does the built clone still hold everything the rail is showing?
function minimapWindowCoversView(metrics, scrollTop) {
  if (!minimapBuiltRange) {
    return true;
  }
  const view = minimapVisibleDocumentRange(metrics, scrollTop);
  return view.top >= minimapBuiltRange.top && view.bottom <= minimapBuiltRange.bottom;
}
// Would a rebuild clone the same rows out of the same document at the same widths? Then it puts back what is already there, and asking again cannot change the guard's answer.
function minimapRebuildWouldChangeNothing(metrics, previewWidth, frameWidth, first, last) {
  return minimapBuiltVersion === minimapContentVersion
    && minimapBuiltSourceWidth === metrics.sourceWidth
    && minimapBuiltPreviewWidth === previewWidth
    && minimapBuiltFrameWidth === frameWidth
    && minimapBuiltFirstRow === first
    && minimapBuiltLastRow === last;
}
// Document offset of an element's top/bottom edge, on the same basis as metrics.sourceTop (the scroll container's content coordinates).
function minimapBlockEdges(el, appTop, scrollTop) {
  const rect = el.getBoundingClientRect();
  return { top: rect.top - appTop + scrollTop, bottom: rect.bottom - appTop + scrollTop };
}
// Index of the first row whose bottom edge is past `offset`. Rows are in document order, so a binary search finds it without measuring all 50,000.
function minimapFirstBlockPast(rows, appTop, scrollTop, offset) {
  let lo = 0;
  let hi = rows.length - 1;
  let found = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (minimapBlockEdges(rows[mid], appTop, scrollTop).bottom > offset) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}
// The rows a windowed clone slices, in document order: the body's blocks.
function minimapWindowRows(source) {
  return Array.from(source.children);
}
// A clone holding rows `first..last` only.
function buildWindowedMinimapClone(source, first, last) {
  const slice = (from, into) => {
    const rows = from.children;
    for (let i = first; i <= last && i < rows.length; i += 1) {
      into.appendChild(rows[i].cloneNode(true));
    }
    // The layer's own top padding belongs at the start of the document, not at the start of a window into the middle of it; the caller's translate places the first row instead.
    into.style.paddingTop = '0';
    into.style.paddingBottom = '0';
  };
  // cloneNode(false) keeps the body's own classes and attributes, so every `.document-body x` rule still matches inside the clone.
  const preview = source.cloneNode(false);
  slice(source, preview);
  return preview;
}
// Strip the clone: nothing focusable, nothing with a duplicate id, no second copy of every link for a screen reader to find.
function stripMinimapClone(preview) {
  preview.removeAttribute('id');
  // Nothing focusable in the clone: a block being edited in place is a textarea, and a second copy of it in the rail is another tab stop holding stale text.
  preview.querySelectorAll('textarea').forEach((node) => node.remove());
  preview.querySelectorAll('[id]').forEach((node) => {
    // Everything except the inside of a diagram. Mermaid scopes an SVG's colors by that SVG's own id (`#mermaid-7 .node rect { fill: … }`) and points its arrowheads at markers by id, so stripping those ids leaves every shape at the SVG default: black fills and no arrowheads, all down the rail on a page full of diagrams. Keeping them duplicates ids the page never looks up, and the markers they resolve to are the originals — the same geometry, drawn at a different scale.
    if (node.closest('svg')) return;
    node.removeAttribute('id');
  });
  preview.querySelectorAll('a[href]').forEach((link) => {
    // Glossary terms blend into the body text via an href-based rule; stripping the href for a11y would drop that blend, so tag them first for a class-based rule to re-blend in the clone.
    const href = link.getAttribute('href') || '';
    if (/^glossary:/i.test(href) || /GLOSSARY\.md#/i.test(href)) {
      link.classList.add('glossary-term');
    }
    link.removeAttribute('href');
  });
  // A diagram the page has handed back is a blank box, and cloning it clones the blank. The memo still has the drawing.
  fillMermaidClone(preview);
  preview.classList.add('document-minimap-preview');
  preview.setAttribute('aria-hidden', 'true');
}
// The room the page lays the document out in, which the clone has to be given or anything measuring itself against the reading layout's container query measures the whole window instead — a wide table drawn wider than the page draws it, so the thumbnail wrapped less and ended a fifth short of its track. The content box, not clientWidth: the layout's inline padding is outside the container query, and counting it would hand the clone room the page never gives it. Read on the rebuild path only; the scroll path reads no geometry at all.
function minimapFrameWidth(fallbackWidth) {
  const layout = app.querySelector('.reader-layout');
  if (!layout) {
    return fallbackWidth;
  }
  const style = window.getComputedStyle(layout);
  const width = layout.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  return width > 0 ? width : fallbackWidth;
}
// Build the thumbnail: clone the document, strip ids/links, shrink to the rail width with a transform. Rebuilt on content changes and when scrolling leaves the window it was built for; scroll otherwise just repositions the box and slides it.
//
// The clone holds only the slice the rail can show. Cloning the whole document put a second copy of every element on the page — 99.9% of it off-screen — which cost ~890ms a frame to slide on a 4MB glossary. It is still a clone of the real rendering, so the rail keeps real text rather than a synthesized line pattern.
function updateDocumentMinimapPreview() {
  const minimap = currentMinimap();
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  const content = track ? track.querySelector('.document-minimap-content') : null;
  const source = minimapSourceElement();
  if (!track || !content || !source) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  const contentRect = content.getBoundingClientRect();
  const previewWidth = Math.max(1, Math.ceil(contentRect.width));
  const previewScale = previewWidth / metrics.sourceWidth;
  const frameWidth = minimapFrameWidth(metrics.sourceWidth);
  const scrollTop = metrics.scrollTop;
  // Skip the clone when nothing shaping the thumbnail changed: same content version, wrap width, rail width, layout room, and the window still covers the view. The common resize (height-only) just repositions the box off the existing clone — the cloneNode below is what makes resize feel like a reload.
  if (
    content.querySelector('.document-minimap-preview') &&
    minimapBuiltVersion === minimapContentVersion &&
    minimapBuiltSourceWidth === metrics.sourceWidth &&
    minimapBuiltPreviewWidth === previewWidth &&
    minimapBuiltFrameWidth === frameWidth &&
    minimapWindowCoversView(metrics, scrollTop)
  ) {
    updateMinimapViewport();
    return;
  }
  const rows = minimapWindowRows(source);
  const view = minimapVisibleDocumentRange(metrics, scrollTop);
  const windowsIt = rows.length > 0 && metrics.scaledDocumentHeight > metrics.trackHeight;
  const appTop = windowsIt ? app.getBoundingClientRect().top : 0;
  let first = 0;
  let last = rows.length - 1;
  if (windowsIt) {
    const slack = view.height * MINIMAP_WINDOW_SLACK;
    first = minimapFirstBlockPast(rows, appTop, scrollTop, view.top - slack);
    last = Math.min(
      rows.length - 1,
      minimapFirstBlockPast(rows, appTop, scrollTop, view.bottom + slack),
    );
    // Keep the clone already on the page and — unlike the skip above — do not ask for another: a guard that cannot be satisfied would otherwise rebuild every frame.
    if (
      content.querySelector('.document-minimap-preview') &&
      minimapRebuildWouldChangeNothing(metrics, previewWidth, frameWidth, first, last)
    ) {
      markMinimapWarming();
      placeMinimapViewport(minimap, metrics, null);
      return;
    }
  }
  // The clone is laid out inside the frame, which is the page's own room; the frame is what scales, so the clone keeps the width the body has on the page.
  const frame = document.createElement('div');
  frame.className = 'document-minimap-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.width = `${frameWidth}px`;
  let preview;
  // Where the clone lands. Kept apart from the built range below, which widens to the document's ends: landing the clone at a widened top drags the thumbnail off the text.
  let firstTop = metrics.sourceTop;
  if (!windowsIt) {
    preview = source.cloneNode(true);
    stripMinimapClone(preview);
    preview.style.width = `${metrics.sourceWidth}px`;
    // Scale to the rail width, then nudge the clone down by the top gap (sourceTop) so the thumbnail sits where the real content sits in the scroll range.
    frame.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;
    minimapBuiltRange = null;
    minimapBuiltFirstRow = -1;
    minimapBuiltLastRow = -1;
  } else {
    preview = buildWindowedMinimapClone(source, first, last);
    stripMinimapClone(preview);
    preview.style.width = `${metrics.sourceWidth}px`;
    if (first < rows.length) {
      firstTop = minimapBlockEdges(rows[first], appTop, scrollTop).top;
    }
    frame.style.transform = `translateY(${firstTop * previewScale}px) scale(${previewScale})`;
    // At the ends of the document the range takes the document's own ends: above the first row and below the last there is only the layout's padding, which no clone of the rows can hold. Row edges there fail the guard at every scroll top and every foot, and every failure asks for another rebuild.
    minimapBuiltRange = {
      top: first === 0 ? 0 : firstTop,
      bottom: last >= rows.length - 1
        ? metrics.scrollHeight
        : minimapBlockEdges(rows[last], appTop, scrollTop).bottom,
    };
    minimapBuiltFirstRow = first;
    minimapBuiltLastRow = last;
  }
  frame.appendChild(preview);
  content.replaceChildren(frame);
  if (content.style.height !== `${metrics.scaledDocumentHeight}px`) {
    content.style.height = `${metrics.scaledDocumentHeight}px`;
  }
  // A windowed clone starts mid-document, so its first block's top margin has nothing above it to collapse against and lands off by that margin — enough to shift the thumbnail on every rebuild. Cheaper to measure the miss than to model the collapsing. One read, on the rebuild path, never on scroll.
  if (minimapBuiltRange) {
    const clonedFirst = preview.firstElementChild;
    if (clonedFirst) {
      const wanted = firstTop * previewScale;
      const landedAt = clonedFirst.getBoundingClientRect().top - content.getBoundingClientRect().top;
      const delta = wanted - landedAt;
      if (Math.abs(delta) > 0.5) {
        frame.style.transform = `translateY(${wanted + delta}px) scale(${previewScale})`;
      }
    }
  }
  // There is a thumbnail now, but it is a picture of boxes until every diagram has been measured, so the rail asks whether it is still warming rather than clearing outright.
  markMinimapWarming();
  minimapBuiltVersion = minimapContentVersion;
  minimapBuiltSourceWidth = metrics.sourceWidth;
  minimapBuiltPreviewWidth = previewWidth;
  minimapBuiltFrameWidth = frameWidth;
  updateMinimapViewport();
}
function scheduleMinimapViewportUpdate() {
  if (minimapViewportFrame) {
    return;
  }
  minimapViewportFrame = window.requestAnimationFrame(() => {
    minimapViewportFrame = 0;
    updateMinimapViewportFromScroll();
  });
}
function updateMinimapViewport() {
  const minimap = currentMinimap();
  if (!minimap) {
    return;
  }
  const track = minimap.querySelector('.document-minimap-track');
  if (!track) {
    return;
  }
  const metrics = measureDocumentMinimap(track);
  placeMinimapViewport(minimap, metrics, null);
  // A jump (a rail click, a drag landing, a restored anchor) can leave the slice the clone was built for; rebuild for where the rail now points.
  if (!minimapWindowCoversView(metrics, metrics.scrollTop)) {
    scheduleMinimapPreviewUpdate();
  }
}
// The scroll handler's version: cached geometry and CSS-variable writes only, so a wheel click never forces a layout. A scroll past the clone's window schedules a rebuild off this path, leaving the existing clone up until it lands.
function updateMinimapViewportFromScroll() {
  const minimap = currentMinimap();
  if (!minimap) {
    return;
  }
  const track = minimap.querySelector('.document-minimap-track');
  if (!track) {
    return;
  }
  const metrics = minimapMetricsForScroll(track);
  const scrollTop = app.scrollTop;
  placeMinimapViewport(minimap, metrics, scrollTop);
  if (!minimapWindowCoversView(metrics, scrollTop)) {
    scheduleMinimapPreviewUpdate();
  }
}
// Place the viewport box and, on tall documents, slide the thumbnail inside the rail. Position is driven by the exact reader scroll and the box height is the viewport at thumbnail scale, so it tracks the visible region at any length. scrollTopOverride pins to a specific offset (a drag); null reads live scrollTop. Mirrors site/minimap.js's updateViewport().
function placeMinimapViewport(minimap, metrics, scrollTopOverride) {
  const content = minimap.querySelector('.document-minimap-content');
  const viewport = minimap.querySelector('.document-minimap-viewport');
  const scaledDocumentHeight = metrics.scaledDocumentHeight;
  // Guarded because an identical inline write still dirties the element, and this runs on the scroll path.
  if (content && content.style.height !== `${scaledDocumentHeight}px`) {
    content.style.height = `${scaledDocumentHeight}px`;
  }
  const scrollTop = Math.min(metrics.scrollable, Math.max(0, scrollTopOverride === null ? metrics.scrollTop : scrollTopOverride));
  const scrollRatio = metrics.scrollable === 0 ? 0 : Math.min(1, Math.max(0, scrollTop / metrics.scrollable));
  const viewportHeight = Math.max(22, metrics.viewportHeight * metrics.previewScale);
  const boundedViewportHeight = Math.min(metrics.trackHeight, viewportHeight);
  const previewTop = -scrollRatio * Math.max(0, scaledDocumentHeight - metrics.trackHeight);
  const viewportDocumentTop = scrollTop * metrics.previewScale;
  const viewportTop = Math.min(Math.max(0, metrics.trackHeight - boundedViewportHeight), Math.max(0, previewTop + viewportDocumentTop));
  // Onto the two elements that draw, never a custom property on the rail's root. Neither `transform` nor `top` inherits, so neither reaches the clone; a custom property does, and one write on the rail re-resolves style across every element of the thumbnail — 78ms a write against 0.13ms for these.
  if (content) {
    content.style.transform = `translateY(${previewTop}px)`;
  }
  if (viewport) {
    viewport.style.top = `${viewportTop}px`;
    viewport.style.height = `${boundedViewportHeight}px`;
  }
}
// The scroll listener must stay cheap. clampReaderScrollPosition() and captureReaderScrollAnchor() each force a layout — ~400ms on a 4MB glossary, which is the wheel taking two seconds to answer — and once a frame is still too often. Nothing reads either mid-gesture (the anchor serves the reflow re-pin and tab switches; the clamp only has to hold at rest), so they settle after the wheel stops and the handler itself reads no geometry at all.
function settleReaderScroll() {
  readerScrollSettleTimer = 0;
  readerScrolling = false;
  clampReaderScrollPosition();
  refreshReaderScrollAnchor();
  // The clamp may have moved the reader; the rail follows it.
  updateMinimapViewport();
  // Diagrams stand aside while the reader scrolls, so this is where they are told they can draw.
  readerScrollSettled();
}
// A render places the reader deliberately, so a settle queued by a scroll of the OUTGOING document must not land on the new one — it would overwrite the anchor being restored, and hold the reflow re-pin off while the fresh page settles.
function cancelReaderScrollSettle() {
  if (readerScrollSettleTimer) {
    window.clearTimeout(readerScrollSettleTimer);
    readerScrollSettleTimer = 0;
  }
  readerScrolling = false;
}
// A wheel over the rail scrolls the page the same distance that notch moves it over the page. Nothing else can: the rail is chrome, so it stands in a grid column beside the box that scrolls, and the window's own scroll is gone (`base.css`) — so a notch here has nothing above it to move, in the one strip the app draws in place of a scrollbar and the one a click or a drag leaves the pointer on.
//
// On the column, not the track: the column runs the height of the window and the track only as far as the thumbnail reaches, so a listener on the track leaves the whole stretch below it dead. The column is permanent, so this binds once instead of being rebound on every render.
//
// A wheel in lines or pages is converted rather than added raw. This host reports pixels, so raw is right here; the same fragment runs the app in a browser this tree does not choose, where a mouse reporting lines would move the reader three pixels a notch.
const MINIMAP_WHEEL_FALLBACK_LINE = 16;
let minimapWheelLineHeight = 0;
function minimapWheelPixels(event, metrics) {
  // A page is the reader's own height, already in the cached metrics.
  if (event.deltaMode === 2) {
    return event.deltaY * metrics.viewportHeight;
  }
  if (event.deltaMode !== 1) {
    return event.deltaY;
  }
  if (!minimapWheelLineHeight) {
    // Read once, off the reading body, and kept: the wheel path may read no layout (see settleReaderScroll).
    const source = minimapSourceElement();
    const measured = parseFloat(getComputedStyle(source || app).getPropertyValue('line-height'));
    minimapWheelLineHeight = Number.isFinite(measured) && measured > 0 ? measured : MINIMAP_WHEEL_FALLBACK_LINE;
  }
  return event.deltaY * minimapWheelLineHeight;
}
if (readerMinimap) {
  readerMinimap.addEventListener('wheel', (event) => {
    // A zoom or a sideways gesture over the rail stays the web view's, exactly as it is over the page.
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!event.deltaY) return;
    const minimap = currentMinimap();
    const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
    if (!track) return;
    // Never a fresh scrollHeight: that layout read is ~400ms on a large glossary, which is the wheel taking two seconds to answer. Scrolling cannot change this geometry, so the scroll path's cache is the right read.
    const metrics = minimapMetricsForScroll(track);
    if (!metrics || metrics.scrollable <= 0) return;
    // The drag owns the scroll while it stands; a notch must not fight the box being held.
    if (minimapDragging) return;
    event.preventDefault();
    app.scrollTop = Math.min(metrics.scrollable, Math.max(0, app.scrollTop + minimapWheelPixels(event, metrics)));
  }, { passive: false });
}
app.addEventListener('scroll', () => {
  // A minimap drag owns the scroll (clamped scrollTop, box pinned via CSS vars, endDrag re-captures on release), so do nothing here during a drag — the forced layouts would be exactly the stutter this avoids.
  if (minimapDragging) {
    return;
  }
  scheduleMinimapViewportUpdate();
  readerScrolling = true;
  if (readerScrollSettleTimer) {
    window.clearTimeout(readerScrollSettleTimer);
  }
  readerScrollSettleTimer = window.setTimeout(settleReaderScroll, READER_SCROLL_SETTLE_MS);
}, { passive: true });
window.addEventListener('resize', () => {
  invalidateMinimapMetrics();
  scheduleReaderLayoutUpdate();
  scheduleMinimapViewportUpdate();
  scheduleMinimapPreviewUpdate();
});
window.leafShowError = (message) => leafToast(message, 'error');
// The other half: something the person asked for that worked, said where they are looking rather than left silent.
window.leafShowNotice = (message) => leafToast(message, 'ok');
// A file was written where the person asked for it, and the path is pressable: the thing they wanted next is to look at it, and going and finding it is the step this saves.
window.leafFileWritten = (path) => {
  leafToast('Saved ', 'ok', null, {
    text: path,
    run: () => send({ command: 'openExternal', url: path }),
  });
};
window.leafShowOpenError = (path, reason) => {
  window.leafShowError(`Failed to open ${path}: ${reason}`);
};
// A file went to the bin, and can come back. Sent by the host once the delete has actually happened, which is what keeps the app from ever drawing an offer it could not keep. The offer and the message are the same thing, so it expires with it — nothing here counts down on its own.
window.leafFileDeleted = (path, name) => {
  undoableDelete = path;
  leafToast(`Deleted ${name}`, 'ok', {
    label: 'Undo',
    run: undoLastDelete,
    gone: () => { undoableDelete = null; },
  });
};
// Put back whatever the last delete took. Cleared first, so a second press and a Ctrl+Z chasing the same message cannot ask for it twice.
function undoLastDelete() {
  const path = undoableDelete;
  if (!path) return;
  undoableDelete = null;
  send({ command: 'undoDelete', path });
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function escapeAttr(value) {
  return escapeText(value).replace(/`/g, '&#96;');
}
// Thousands separators, so a big count reads as "2,000" rather than "2000".
function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : String(value);
}
// The one place a counted sentence chooses its word, so a count of one never reads as a plural. Whole labels, because the pair is sometimes "match is" against "matches are".
function formatCountLabel(value, singular, plural) {
  return `${formatCount(value)} ${Number(value) === 1 ? singular : plural}`;
}
window.leafSetState(window.__leafInitialState || { recent: [], favorites: [], document: null });
window.leafSetNavigation({ canGoBack: false, canGoForward: false });
// Came up on defaults because the settings file would not read. Nothing on screen distinguishes that from a first launch, so say it; the file is left alone for its owner to look at.
if (window.__leafSettingsUnreadable) {
  window.leafShowError('Your settings file could not be read, so Leaftext started with its defaults. Your saved choices are still in the file.');
}
// A failed install relaunches the build that was already there, so the window coming back looks exactly like one that updated. Second of the two boot growls on purpose: they share one slot, and this is the one nobody could work out for themselves.
if (window.__leafUpdateFailed) {
  const failed = window.__leafUpdateFailed;
  // The applier names no version when the staging path was malformed, and a bare "v" is worse than saying nothing.
  const opening = failed.version ? `Updating to v${failed.version} failed` : 'Updating failed';
  // Our own installer's codes are already sentences; an MSI's is a bare number, and both arrive without a full stop.
  const why = String(failed.message || '').replace(/\.$/, '');
  const still = LEAF_VERSION ? ` You are still on v${LEAF_VERSION}.` : '';
  window.leafShowError(`${opening}${why ? `: ${why}` : ''}.${still}`);
}
// The vault list came in on the window rather than through its callback, so nothing has asked about its repository yet.
requestActiveVaultStatus();
// The first-run bubble, a frame later: a hint measures the control it points at, and a control the page has not laid out yet has no rectangle to measure.
window.requestAnimationFrame(runHintPass);
