var minimapViewportFrame;
var minimapPreviewFrame;
// Rebuilding the thumbnail clones the whole document, so only rebuild when the content, wrap width, or rail width changed. minimapContentVersion bumps on mutation; the minimapBuilt* values record the last clone's inputs, so a height-only resize reuses the existing clone.
var minimapContentVersion;
var minimapBuiltVersion;
var minimapBuiltSourceWidth;
var minimapBuiltPreviewWidth;
// The reading layout's own width, which the clone is laid out against. It moves without the body's moving — the body stops at the text measure and the layout keeps growing — so a widening window has to rebuild on this alone or a wide table stays drawn at the old room.
var minimapBuiltFrameWidth;
var minimapDragging;
var minimapPointerId;
var minimapPointerOffsetY;
// Document geometry captured once at the start of a minimap drag (it doesn't change while dragging, and re-measuring forces a synchronous layout). Then map pointer -> scrollTop with pure math.
var minimapDragMetrics;
var minimapResizeObserver;
var minimapBodyObserver;
// The document range the built clone holds, or null when it holds all of it — the clone is a window on long documents, so scrolling out of range is a third reason to rebuild (see updateDocumentMinimapPreview).
var minimapBuiltRange;
// The rows the built clone was sliced from. A rebuild that would slice the same two cannot change anything, so it keeps the thumbnail and stops asking for another.
var minimapBuiltFirstRow;
var minimapBuiltLastRow;
var minimapBuiltRowPath;
// How much slack the built clone holds, as the multiple of a screen it was asked for. The skip guard counts it, which is what lets a wider rebuild over the same rows through.
var minimapBuiltSlack;
// The widest slack anything has asked the booked frame to build with. A scroll and a keystroke landing in the same frame get one rebuild, and it is the scroll's, because the scroll is the one that needs room either side.
var minimapPendingSlack;
// The quiet turn a narrow rebuild books behind itself to put the slack back.
var minimapWidenTimer;
// One rebuild the rail owes itself, withheld while a hand is on the wheel or the position box. The whole of a rebuild is the browser laying a fresh slice out, and on a frame the gesture is moving that is the stutter the reader feels — so the standing thumbnail is left up and the debt is paid once the gesture stops, at the position it stopped at. One answer and not one a movement: a fling passes hundreds of positions and only the last of them is looked at.
var minimapPreviewOwed;
// Rail geometry, cached for the scroll path: scrolling changes none of it, and re-measuring per wheel click forces a fresh layout of the whole document.
var minimapScrollMetrics;
// The last position the column's scroll wrote onto the reader. The two mirror each other, so without it the reader's answering event would carry the column straight back — and a plain flag cannot do the job: a scroll event lands a frame after the write that caused it, by which time the gliding column has moved again and would spend the flag on its own real move. A value is the whole of what has to be recognized.
var minimapMirroredScrollTop;
// The same, the other way round: the last position the reader's scroll wrote onto the column. Without it a page mid-glide is dragged back a frame by the column's answering event, which cancels the animation drawing it — a trackpad's stream keeps the position moving frame after frame, so that happens ten or eleven times a second of scrolling. A value and not a flag for the reason above.
var minimapMirroredColumnScrollTop;
var minimapSpacerFrame;
var readerLayoutFrame;
var readerScrollSettleTimer;
var readerReflowObserver;
var readerAnchorBlocksCount;
// The `.document-body` the cache was built against. A re-render swaps in a fresh body node, so comparing identity catches that immediately instead of relying on the child-count heuristic alone.
var readerAnchorBlocksSource;

function initializeMinimapState() {
  minimapViewportFrame = 0;
  minimapPreviewFrame = 0;
  minimapContentVersion = 0;
  minimapBuiltVersion = -1;
  minimapBuiltSourceWidth = -1;
  minimapBuiltPreviewWidth = -1;
  minimapBuiltFrameWidth = -1;
  minimapDragging = false;
  minimapPointerId = null;
  minimapPointerOffsetY = null;
  minimapDragMetrics = null;
  minimapResizeObserver = null;
  minimapBodyObserver = null;
  minimapBuiltRange = null;
  minimapBuiltFirstRow = -1;
  minimapBuiltLastRow = -1;
  minimapBuiltRowPath = '';
  minimapBuiltSlack = -1;
  minimapPendingSlack = 0;
  minimapWidenTimer = 0;
  minimapPreviewOwed = false;
  minimapScrollMetrics = null;
  minimapMirroredScrollTop = -1;
  minimapMirroredColumnScrollTop = -1;
  minimapSpacerFrame = 0;
  readerLayoutFrame = 0;
  readerScrollSettleTimer = 0;
  readerReflowObserver = null;
  readerAnchorBlocksCount = -1;
  readerAnchorBlocksSource = null;
}

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

// Measure Monaco's narrow letter and widest digit in one layout pass.
const MONACO_MEASURE_RUN = 32;
const MONACO_MEASURE_GLYPHS = ['n', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
let monacoFontRulers = null;
function prepareMonacoFontRulers() {
  if (monacoFontRulers) return;
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue('--code-font')
    .trim();
  if (!family || !document.body) return;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;top:-9999px;left:-9999px;white-space:pre';
  for (const glyph of MONACO_MEASURE_GLYPHS) {
    const ruler = document.createElement('span');
    ruler.style.cssText = `white-space:pre;font:${MONACO_FONT_SIZE}px ${family}`;
    ruler.textContent = glyph.repeat(MONACO_MEASURE_RUN);
    holder.appendChild(ruler);
  }
  appSurface.appendChild(holder);
  monacoFontRulers = holder;
}
function readMonacoFontRulers() {
  if (!monacoFontRulers) return null;
  const runs = Array.from(monacoFontRulers.children).map(
    (ruler) => ruler.getBoundingClientRect().width / MONACO_MEASURE_RUN
  );
  const char = runs[0] || 0;
  let digit = 0;
  for (let index = 1; index < runs.length; index += 1) digit = Math.max(digit, runs[index]);
  return char > 0 && digit > 0 ? { char, digit } : null;
}
function clearMonacoFontRulers() {
  if (!monacoFontRulers) return;
  monacoFontRulers.remove();
  monacoFontRulers = null;
}
// Keep rulers through the reading stage; removal is a later write.
let monacoFontRulersHeld = false;
function monacoCodeFontWidths() {
  if (monacoFontRulersHeld) return readMonacoFontRulers();
  prepareMonacoFontRulers();
  const widths = readMonacoFontRulers();
  clearMonacoFontRulers();
  return widths;
}

// How wide the editor is in the code view — the whole reader area, since the rail's column collapses there. Measured off the window's own grid rather than the reading view's shell, which is narrower by exactly the rail this is sizing.
function codeViewEditorWidth() {
  if (!libraryShell) return 0;
  const root = getComputedStyle(document.documentElement);
  const library = Number.parseFloat(root.getPropertyValue('--library-rail-width'));
  const gutter = Number.parseFloat(root.getPropertyValue('--reader-gutter'));
  const width =
    leafShellWidth() -
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

// Keep the reading and style write separate for the launch pass.
function applyMinimapWidth(width) {
  if (width > 0) {
    document.documentElement.style.setProperty('--minimap-width', `${width}px`);
  }
}
function syncMinimapWidthToCodeView() {
  applyMinimapWidth(monacoMinimapWidth());
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
// The rail reads the pane written in round zero, so it runs in round one.
onSettle({
  round: 1,
  prepare: () => {
    prepareMonacoFontRulers();
    monacoFontRulersHeld = true;
  },
  read: monacoMinimapWidth,
  apply: (width) => {
    monacoFontRulersHeld = false;
    clearMonacoFontRulers();
    applyMinimapWidth(width);
  },
});

// The rail starts loading: the thumbnail clones the rendered document, so it can't exist until the document is laid out — on a large file, long enough that an empty rail beside a finished page looks broken rather than busy.
function documentMinimapMarkup() {
  return `<aside class="document-minimap is-loading" aria-label="Document minimap"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="lt-spinner document-minimap-spinner" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>`;
}
function renderDocumentMinimap(hasVisibleContent) {
  if (!window.leafMinimap.getEnabled()) {
    return '';
  }
  if (!hasVisibleContent) {
    return '';
  }
  return documentMinimapMarkup();
}
// The rail lives beside the page rather than inside it, so every render has to place it here instead of in its own markup. Empty means no rail at all — the shell's :has(.document-minimap) collapses the column it would occupy.
//
// The scroller is told directly rather than left to :has(): scrollbar styles do not re-resolve when a :has() match flips, so the bar outlives the rail.
function setMinimapMarkup(html) {
  if (readerMinimap) {
    readerMinimap.innerHTML = html || '';
    // The column's travel, and a sibling of the rail rather than a child of it: the rail is pinned to the top of the column, so anything inside it is pinned too and there would be nothing left to scroll. No rail means no spacer, so the column has no travel at all and a notch there is left to the web view exactly as it was.
    if (html) {
      const spacer = document.createElement('div');
      spacer.className = 'reader-minimap-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      readerMinimap.appendChild(spacer);
      scheduleMinimapSpacerResize();
    }
  }
  if (app) app.classList.toggle('has-minimap', Boolean(html));
}
function currentMinimap() {
  return readerMinimap ? readerMinimap.querySelector('.document-minimap') : null;
}
function minimapSpacer() {
  return readerMinimap ? readerMinimap.querySelector('.reader-minimap-spacer') : null;
}
// The column has to travel exactly as far as the reader can, or a notch over the rail carries the page a different distance than the same notch over the page — which is the one thing the wheel already got right. Corrected against what the column reads back rather than computed and trusted: the column's own padding, the rail's height and the browser's rounding all count towards its range, and none of them is knowable from here. Twice is enough to land it; a third pass would only be answering a layout that is still moving. Re-measured on every change to the page on purpose: 97 of these over the 29 KB Mermaid fixture cost 4.3 ms in all and 0.2 ms at worst, so remembering the last target range buys less than a reader can feel and owes a reset every time the spacer is replaced.
function resizeMinimapSpacer() {
  const spacer = minimapSpacer();
  if (!readerMinimap || !spacer) {
    return;
  }
  // An unscrollable reader gets no travel, so the column is not a scroller and the notch stays the web view's.
  const target = Math.max(0, app.scrollHeight - app.clientHeight);
  for (let pass = 0; pass < 2; pass += 1) {
    const height = Math.max(0, parseFloat(spacer.style.height) || 0);
    const reached = Math.max(0, readerMinimap.scrollHeight - readerMinimap.clientHeight);
    const next = Math.max(0, height + (target - reached));
    if (next === height) {
      break;
    }
    spacer.style.height = `${next}px`;
  }
  syncMinimapColumnToReader();
}
function scheduleMinimapSpacerResize() {
  if (minimapSpacerFrame) {
    return;
  }
  minimapSpacerFrame = window.requestAnimationFrame(() => {
    minimapSpacerFrame = 0;
    resizeMinimapSpacer();
  });
}
// Everything that moves the reader without touching the column — a click on the rail, a drag on the box, the keyboard, a tab switch, a reflow re-pin — leaves the column behind, and the next notch there would jump the page back. Never a write while the two already agree: writing a position a scroller has already reached cancels an animation it has in flight, which is the glide this whole path exists for. What is written is recorded, because the column answers a frame later and the handler there has to tell this echo from a hand on the rail.
function syncMinimapColumnToReader() {
  const reader = readerScrollElement();
  if (!readerMinimap || Math.round(readerMinimap.scrollTop) === Math.round(reader.scrollTop)) {
    return;
  }
  minimapMirroredColumnScrollTop = reader.scrollTop;
  readerMinimap.scrollTop = reader.scrollTop;
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
    readerScrollElement().scrollTop = boundedScrollTop;
    const minimap = track.closest('.document-minimap');
    if (minimap) {
      placeMinimapViewport(minimap, metrics, boundedScrollTop);
      // A drag can cross the whole document, so the window is left behind almost at once. Laying the next slice out here is 12 to 63ms on the frame the hand is moving, and the drag crosses every position between its ends — so the debt is remembered and endDrag pays it where the box was let go.
      if (!minimapWindowCoversView(metrics, boundedScrollTop)) {
        noteMinimapPreviewOwed();
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
    readerScrollElement().scrollTop = Math.min(metrics.scrollable, Math.max(0, clickedDocumentY - metrics.viewportHeight / 2));
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
    // The drag writes the reader's position itself, so the column's own scroll stands aside until it is over: a notch landing mid-drag would fight the box being held.
    if (readerMinimap) readerMinimap.classList.add('is-scroll-held');
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
      // The column stood aside for the drag and so fell behind it; hand its scroll back where the reader now is, or the first notch after the release would jump the page to where the drag began.
      if (readerMinimap) readerMinimap.classList.remove('is-scroll-held');
      syncMinimapColumnToReader();
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
  return readingDocumentRoot();
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
  cancelMinimapWiden();
  minimapPendingSlack = 0;
  // A different document is coming: force the next update to rebuild the clone.
  minimapBuiltVersion = -1;
  minimapBuiltSourceWidth = -1;
  minimapBuiltPreviewWidth = -1;
  minimapBuiltFrameWidth = -1;
  minimapBuiltRange = null;
  minimapBuiltFirstRow = -1;
  minimapBuiltLastRow = -1;
  minimapBuiltRowPath = '';
  minimapBuiltSlack = -1;
  invalidateMinimapMetrics();
}
// Drop the cached rail geometry. Everything that can change it calls this; the scroll handler, which cannot, is the one path that reads the cache.
//
// Anything that changes the rail's geometry changes the document's height, and the column's travel is that height — so the spacer follows from here rather than from a second list of the same triggers. Asked for a frame rather than done here, because this is called from a render before the new document has been laid out and the answer is a layout read.
function invalidateMinimapMetrics() {
  minimapScrollMetrics = null;
  scheduleMinimapSpacerResize();
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
    // Only the write earns a second read, and that read is the expensive one: 27ms on a 224,478px page, because it is the layout the write just moved. Without a write nothing between the two reads can move anything — the first read already forced the flush — so returning it is the same answer for free.
    return measureDocumentContent(source);
  }
  return content;
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
  // A contained page is clamped against its own scroller and nothing else. The origin correction below is Leaftext's own answer to the room its bar takes over its own layout, and inside somebody else's page there is no such room to cancel.
  const contained = siteFrameScroller();
  if (contained) {
    const room = Math.max(0, contained.scrollHeight - contained.clientHeight);
    return Math.min(room, Math.max(0, nextScrollTop));
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
  readerScrollElement().scrollTop = clampReaderScrollTop(scrollTop);
}
function clampReaderScrollPosition() {
  if (!currentState?.document) {
    return false;
  }
  const reader = readerScrollElement();
  const clampedScrollTop = clampReaderScrollTop(reader.scrollTop);
  if (Math.abs(clampedScrollTop - reader.scrollTop) < 0.5) {
    return false;
  }
  reader.scrollTop = clampedScrollTop;
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
// The section the line a document is read from falls in, as its heading id — null above the first one, and null in a document with no headings. Published rather than worked out: it is the answer the binary search above already reached on its way to placing the reader, so anything that wants to show where somebody is reading costs nothing per scroll.
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
// Drop a queued layout pass whose captured `anchor` has been superseded. The column's travel goes with it: the document that height was going to be read off has been taken away, and the render replacing it drops the rail's geometry again.
function cancelReaderLayoutUpdate() {
  if (readerLayoutFrame) {
    window.cancelAnimationFrame(readerLayoutFrame);
    readerLayoutFrame = 0;
  }
  if (minimapSpacerFrame) {
    window.cancelAnimationFrame(minimapSpacerFrame);
    minimapSpacerFrame = 0;
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
      // A resize changes geometry; the paths that replace blocks clear their membership cache themselves.
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
  // A contained page scrolls inside its own frame, so every number below is that scroller's rather than the shell's — the shell holding it never moves a pixel.
  const contained = siteFrameScroller();
  const reader = contained || app;
  const sourceRect = source ? source.getBoundingClientRect() : null;
  const sourceWidth = sourceRect ? Math.max(1, Math.ceil(sourceRect.width)) : 1;
  const content = minimap ? minimap.querySelector('.document-minimap-content') : null;
  const contentWidth = content ? Math.max(1, Math.ceil(content.getBoundingClientRect().width)) : sourceWidth;
  const trackRect = track.getBoundingClientRect();
  const scrollHeight = Math.max(1, Math.ceil(reader.scrollHeight));
  const viewportHeight = Math.max(1, Math.ceil(reader.clientHeight));
  const scrollable = Math.max(0, scrollHeight - viewportHeight);
  const scrollTop = Math.min(scrollable, Math.max(0, reader.scrollTop));
  // Where the document content begins in the scroll container (top gap included); the thumbnail starts here too so its top lines up with the real content. A contained page begins at its own top, and its rect is measured in the frame rather than in the shell, so the two coordinate spaces are never subtracted from each other.
  const sourceTop = contained
    ? 0
    : (sourceRect ? Math.max(0, Math.round(sourceRect.top - appRect.top + app.scrollTop)) : 0);
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
// Extra document to keep either side of the visible slice, as a multiple of it. One each way means a whole rail's worth of scrolling before a rebuild.
const MINIMAP_WINDOW_SLACK = 1;
// How long the rail waits for the typing to stop before it puts the slack back. Longer than a gap between two keystrokes, or the widening lands in the middle of a sentence and is thrown away by the next word.
const MINIMAP_WIDEN_REST_MS = 400;
// How much slack the rebuild is asked for, rather than a constant it reads where it stands: the whole of a rebuild is the browser laying the slice out, and that falls with the rows in it. Three screens is 13.7ms on a long config and one screen about 5, so a change to the words asks for none of it.
function scheduleMinimapPreviewUpdate(slack = MINIMAP_WINDOW_SLACK) {
  // Whatever raised it, a rebuild going ahead is the rebuild a withheld gesture was owed.
  minimapPreviewOwed = false;
  minimapPendingSlack = Math.max(minimapPendingSlack, slack);
  if (minimapPreviewFrame || minimapPreviewHolds) {
    return;
  }
  minimapPreviewFrame = window.requestAnimationFrame(() => {
    minimapPreviewFrame = 0;
    const asked = minimapPendingSlack;
    minimapPendingSlack = 0;
    updateDocumentMinimapPreview(asked);
  });
}
// A gesture left the built window. Remember that one rebuild is owed rather than starting it here: the reader is holding the wheel or the box, and the slice this would lay out is left behind by the next movement anyway.
function noteMinimapPreviewOwed() {
  minimapPreviewOwed = true;
}
function cancelMinimapWiden() {
  if (minimapWidenTimer) {
    window.clearTimeout(minimapWidenTimer);
    minimapWidenTimer = 0;
  }
}
// A narrow rebuild leaves the rail nothing to scroll into, so one quiet turn behind it puts the slack back — off the typing path, where three screens of layout cost nobody a pause. Another change to the words cancels it and books its own, so the rail never widens onto a document that has moved on.
function bookMinimapWiden() {
  cancelMinimapWiden();
  minimapWidenTimer = window.setTimeout(() => {
    minimapWidenTimer = 0;
    scheduleMinimapPreviewUpdate(MINIMAP_WINDOW_SLACK);
  }, MINIMAP_WIDEN_REST_MS);
}
// The document content changed: mark the clone stale and schedule a rebuild. Geometry-only triggers (resize) call scheduleMinimapPreviewUpdate directly and let the width check decide whether a rebuild is needed.
//
// No slack, because nothing is scrolling while the words are landing: the rail draws the screen it can show and the booked turn above brings the rest back.
function invalidateMinimapPreview() {
  minimapContentVersion += 1;
  invalidateMinimapMetrics();
  cancelMinimapWiden();
  scheduleMinimapPreviewUpdate(0);
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
// Does the built clone still hold everything the rail is showing?
function minimapWindowCoversView(metrics, scrollTop) {
  if (!minimapBuiltRange) {
    return true;
  }
  const view = minimapVisibleDocumentRange(metrics, scrollTop);
  return view.top >= minimapBuiltRange.top && view.bottom <= minimapBuiltRange.bottom;
}
// Would a rebuild clone the same rows out of the same document at the same widths, with at least the slack it is asking for? Then it puts back what is already there, and asking again cannot change the guard's answer. The slack has to be counted or the turn that widens a narrow clone is refused as a rebuild that changes nothing, and the rail stays a screen wide for good.
function minimapRebuildWouldChangeNothing(metrics, previewWidth, frameWidth, first, last, rowPath = '', slack = MINIMAP_WINDOW_SLACK) {
  return minimapBuiltVersion === minimapContentVersion
    && minimapBuiltSourceWidth === metrics.sourceWidth
    && minimapBuiltPreviewWidth === previewWidth
    && minimapBuiltFrameWidth === frameWidth
    && minimapBuiltFirstRow === first
    && minimapBuiltLastRow === last
    && minimapBuiltRowPath === rowPath
    && minimapBuiltSlack >= slack;
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
// Descend through a row taller than the window, keeping the wrappers the slice must wear.
function minimapWindowRows(source, appTop, scrollTop, top, bottom) {
  let holder = source;
  const wrappers = [];
  const path = [];
  // The top-level run, kept from the first pass: the rows the asked range reaches before anything descends. Where the search then goes inside a block, these are the rows on the far side of it and the clone has to carry them.
  let topFirst = 0;
  let topLast = -1;
  while (true) {
    // The live list, never a copy of it: every reader here and downstream takes an index, and copying a description list of 40,000 children was 2.8 ms of a 3.4 ms call. That is safe only while nothing writes into the reading body between this line and the last read of `rows` — the clone below is built with cloneNode into a detached wrapper, the strip and the diagram fill touch that copy alone, and the rail is written after both index reads. A step added in that stretch that moves a row breaks it.
    const rows = holder.children;
    let first = minimapFirstBlockPast(rows, appTop, scrollTop, top);
    let last = Math.min(rows.length - 1, minimapFirstBlockPast(rows, appTop, scrollTop, bottom));
    if (holder === source) {
      topFirst = first;
      topLast = last;
    }
    const windowHeight = Math.max(0, bottom - top);
    let deeper = -1;
    // Only an end of the run can be taller than the window: a row between them has a window row above it and another below it, so it cannot reach past both edges. Asking all 1,552 rows of a window into a description list of 40,000 children cost 13.7 ms of a typing pause where these two reads cost none of it. The first is checked before the last so the document-order answer is the one that survives.
    if (first <= last) {
      const firstEdges = minimapBlockEdges(rows[first], appTop, scrollTop);
      if (rows[first].children.length && firstEdges.bottom - firstEdges.top > windowHeight) {
        deeper = first;
      } else if (last !== first) {
        const lastEdges = minimapBlockEdges(rows[last], appTop, scrollTop);
        if (rows[last].children.length && lastEdges.bottom - lastEdges.top > windowHeight) deeper = last;
      }
    }
    if (deeper < 0) {
      // Where the run reached an end of the block it descended into, the asked range runs off that edge and the rows past it are the document's own top-level ones rather than any of the block's. Naming them here is what lets buildWindowedMinimapClone hold both sides of the edge; without them the rail draws nothing for a rail-height past every long table, whatever the slice says.
      const block = path.length ? path[0] : -1;
      return {
        holder,
        rows,
        wrappers,
        path: path.join('/'),
        first,
        last,
        beforeFirst: block > 0 && first === 0 && topFirst < block ? topFirst : -1,
        afterLast: block >= 0 && last >= rows.length - 1 && topLast > block ? topLast : -1,
      };
    }
    path.push(deeper);
    wrappers.push(rows[deeper]);
    holder = rows[deeper];
  }
}
// A clone holding rows `first..last` only.
function buildWindowedMinimapClone(source, window, first, last) {
  const resetPadding = (node) => {
    node.style.paddingTop = '0';
    node.style.paddingBottom = '0';
  };
  const slice = (from, into) => {
    const firstNode = window.rows[first];
    const lastNode = window.rows[Math.min(last, window.rows.length - 1)];
    const fromIndex = Array.prototype.indexOf.call(from.childNodes, firstNode);
    const throughIndex = Array.prototype.indexOf.call(from.childNodes, lastNode);
    for (let i = fromIndex; i >= 0 && i <= throughIndex; i += 1) {
      const node = from.childNodes[i];
      into.appendChild(node.nodeType === 3 ? document.createTextNode(node.nodeValue) : node.cloneNode(true));
    }
  };
  // cloneNode(false) keeps the body's own classes and attributes, so every `.document-body x` rule still matches inside the clone.
  const preview = source.cloneNode(false);
  resetPadding(preview);
  // The rows on the far side of the block, beside the wrapper chain rather than inside it, since that is where they sit in the document. They land at the offset they really have because the descended slice reaches the block's own edge in exactly the case that asks for them: run off the block's foot and the slice ends on its last row, so what follows sits straight after it; run off its head and the slice starts on its first row, so what comes before sits straight above and the clone is placed at the first of those rows instead.
  const block = window.path === '' ? -1 : Number(window.path.split('/')[0]);
  const carry = (from, through) => {
    for (let index = from; index <= through; index += 1) {
      preview.appendChild(source.children[index].cloneNode(true));
    }
  };
  if (window.beforeFirst >= 0) carry(window.beforeFirst, block - 1);
  let into = preview;
  for (const wrapper of window.wrappers) {
    const clone = wrapper.cloneNode(false);
    resetPadding(clone);
    into.appendChild(clone);
    into = clone;
  }
  slice(window.holder, into);
  if (window.afterLast >= 0) carry(block + 1, window.afterLast);
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
// The rail over a whole HTML page: one more frame carrying the same page, scaled to the rail. It is a second layout of the whole document rather than a windowed slice — a frame cannot be cut in half — so it is built once per render and left alone, and scrolling only moves the box over it.
//
// The frame carries the reading frame's own `srcdoc`, which costs nothing to hand over: it is the string the page was already drawn from. It takes no pointer events and no keyboard, and it runs no script for the same reason the reading frame does not.
function updateContainedPageMinimapPreview(track, content, minimap) {
  const metrics = measureDocumentMinimap(track);
  const reading = documentSiteFrame();
  if (!reading) return;
  const built = content.querySelector('.document-minimap-preview');
  if (built && minimapBuiltVersion === minimapContentVersion && minimapBuiltSourceWidth === metrics.sourceWidth) {
    updateMinimapViewport();
    return;
  }
  const frame = document.createElement('div');
  frame.className = 'document-minimap-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.width = `${metrics.sourceWidth}px`;
  frame.style.transform = `scale(${metrics.previewScale})`;
  const preview = document.createElement('iframe');
  preview.className = 'document-site document-minimap-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.setAttribute('tabindex', '-1');
  preview.setAttribute('sandbox', 'allow-same-origin');
  preview.style.width = `${metrics.sourceWidth}px`;
  preview.style.height = `${metrics.scrollHeight}px`;
  preview.setAttribute('srcdoc', reading.getAttribute('srcdoc') || '');
  frame.appendChild(preview);
  content.replaceChildren(frame);
  minimapBuiltVersion = minimapContentVersion;
  minimapBuiltSourceWidth = metrics.sourceWidth;
  minimapBuiltPreviewWidth = Math.max(1, Math.ceil(content.getBoundingClientRect().width));
  minimapBuiltFrameWidth = metrics.sourceWidth;
  minimapBuiltRange = null;
  minimapBuiltFirstRow = -1;
  minimapBuiltLastRow = -1;
  minimapBuiltRowPath = '';
  minimapBuiltSlack = MINIMAP_WINDOW_SLACK;
  markMinimapWarming();
  placeMinimapViewport(minimap, metrics, null);
}
// Build the thumbnail: clone the document, strip ids/links, shrink to the rail width with a transform. Rebuilt on content changes and when scrolling leaves the window it was built for; scroll otherwise just repositions the box and slides it.
//
// The clone holds only the slice the rail can show. Cloning the whole document put a second copy of every element on the page — 99.9% of it off-screen — which cost ~890ms a frame to slide on a 4MB glossary. It is still a clone of the real rendering, so the rail keeps real text rather than a synthesized line pattern.
function updateDocumentMinimapPreview(slack = MINIMAP_WINDOW_SLACK) {
  const minimap = currentMinimap();
  const track = minimap ? minimap.querySelector('.document-minimap-track') : null;
  const content = track ? track.querySelector('.document-minimap-content') : null;
  const source = minimapSourceElement();
  if (!track || !content || !source) {
    return;
  }
  // A whole HTML page has no rows to window and no clone that would draw: a copy of its body dropped into the app page is laid out by the app's rules rather than by its own, so the rail is a second frame over the same prepared page, scaled.
  if (readingIsContainedPage()) {
    updateContainedPageMinimapPreview(track, content, minimap);
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
    minimapBuiltSlack >= slack &&
    minimapWindowCoversView(metrics, scrollTop)
  ) {
    updateMinimapViewport();
    return;
  }
  const view = minimapVisibleDocumentRange(metrics, scrollTop);
  const windowsIt = source.children.length > 0 && metrics.scaledDocumentHeight > metrics.trackHeight;
  const appTop = windowsIt ? app.getBoundingClientRect().top : 0;
  const slackHeight = view.height * slack;
  const window = minimapWindowRows(source, appTop, scrollTop, view.top - slackHeight, view.bottom + slackHeight);
  const rows = window.rows;
  let first = 0;
  let last = rows.length - 1;
  if (windowsIt) {
    first = window.first;
    last = window.last;
    // Keep the clone already on the page and — unlike the skip above — do not ask for another: a guard that cannot be satisfied would otherwise rebuild every frame.
    if (
      content.querySelector('.document-minimap-preview') &&
      minimapRebuildWouldChangeNothing(metrics, previewWidth, frameWidth, first, last, window.path, slack)
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
    minimapBuiltRowPath = '';
    // The whole document is in the clone, which is more than any slack could ask for.
    minimapBuiltSlack = MINIMAP_WINDOW_SLACK;
  } else {
    preview = buildWindowedMinimapClone(source, window, first, last);
    stripMinimapClone(preview);
    preview.style.width = `${metrics.sourceWidth}px`;
    const topRows = source.children;
    // Where rows before the block were carried in, the clone starts at the first of them rather than at the block's own first row.
    if (window.beforeFirst >= 0) {
      firstTop = minimapBlockEdges(topRows[window.beforeFirst], appTop, scrollTop).top;
    } else if (first < rows.length) {
      firstTop = minimapBlockEdges(rows[first], appTop, scrollTop).top;
    }
    frame.style.transform = `translateY(${firstTop * previewScale}px) scale(${previewScale})`;
    // At the ends of the run the range takes the ends of whatever the search stopped inside — the outermost wrapper where it descended into a block, the document itself where it did not. The padding argument holds either way: above the first row and below the last there is only the holder's own padding, which no clone of the rows can hold, so row edges there fail the guard at every top and every foot and every failure asks for another rebuild. A wrapper has that padding as much as the document does. Taking the document's ends after a descent is what left the slice claiming ground the clone holds no rows for, so the guard answered yes over an empty rail and nothing ever asked for it back.
    const outerEdges = window.wrappers.length ? minimapBlockEdges(window.wrappers[0], appTop, scrollTop) : null;
    minimapBuiltRange = {
      top: window.beforeFirst >= 0
        ? (window.beforeFirst === 0 ? 0 : firstTop)
        : (first === 0 ? (outerEdges ? outerEdges.top : 0) : firstTop),
      bottom: window.afterLast >= 0
        ? (window.afterLast >= topRows.length - 1 ? metrics.scrollHeight : minimapBlockEdges(topRows[window.afterLast], appTop, scrollTop).bottom)
        : (last >= rows.length - 1
          ? (outerEdges ? outerEdges.bottom : metrics.scrollHeight)
          : minimapBlockEdges(rows[last], appTop, scrollTop).bottom),
    };
    minimapBuiltFirstRow = first;
    minimapBuiltLastRow = last;
    minimapBuiltRowPath = window.path;
    minimapBuiltSlack = slack;
  }
  frame.appendChild(preview);
  content.replaceChildren(frame);
  content.style.height = `${metrics.scaledDocumentHeight}px`;
  // A windowed clone starts mid-document, so its first block's top margin has nothing above it to collapse against and lands off by that margin — enough to shift the thumbnail on every rebuild. Cheaper to measure the miss than to model the collapsing. One read, on the rebuild path, never on scroll.
  if (minimapBuiltRange) {
    let clonedFirst = preview;
    // Down to the row firstTop names: through the wrapper chain to the sliced rows, or one step where the clone starts on a carried row instead.
    const depthToFirst = window.beforeFirst >= 0 ? 0 : window.wrappers.length;
    for (let depth = 0; depth <= depthToFirst && clonedFirst; depth += 1) {
      clonedFirst = clonedFirst.firstElementChild;
    }
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
  // A clone built short of the full slack has a rail's worth of scrolling missing from either end of it, so book the quiet turn that puts it back.
  if (minimapBuiltSlack < MINIMAP_WINDOW_SLACK) {
    bookMinimapWiden();
  }
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
  // A jump (a rail click, a drag landing, a restored anchor) can leave the slice the clone was built for; rebuild for where the rail now points. This is also where a gesture's withheld rebuild is paid — settleReaderScroll and endDrag both end here, so the wheel and the position box need no timer of their own. The debt is asked as well as the coverage, because the gesture answered coverage off the cached scroll geometry and this reads it fresh.
  if (minimapPreviewOwed || !minimapWindowCoversView(metrics, metrics.scrollTop)) {
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
    // A fling leaves the window on its first notches and would rebuild on every one of them after that — 120 to 184ms a rebuild on a long document, five of them in one drive. The debt waits for settleReaderScroll; a scroll that has already stopped rebuilds where it stands.
    if (readerScrolling) {
      noteMinimapPreviewOwed();
    } else {
      scheduleMinimapPreviewUpdate();
    }
  }
}
// Place the viewport box and, on tall documents, slide the thumbnail inside the rail. Position is driven by the exact reader scroll and the box height is the viewport at thumbnail scale, so it tracks the visible region at any length. scrollTopOverride pins to a specific offset (a drag); null reads live scrollTop. Mirrors site/minimap.js's updateViewport().
function placeMinimapViewport(minimap, metrics, scrollTopOverride) {
  const content = minimap.querySelector('.document-minimap-content');
  const viewport = minimap.querySelector('.document-minimap-viewport');
  const scaledDocumentHeight = metrics.scaledDocumentHeight;
  // Written plainly on the scroll path: this web view drops an identical inline write before the attribute is touched, so reading the value back to skip one costs 0.30µs against the write's 0.148µs — the frame's pair measured 1.72µs compared first against 1.56µs written straight.
  if (content) {
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
    // A transform, not `top`, for the same reason the lane beside it is on one: this moves every frame with a new number, and as a layout property `top` left the rail's own subtree to be laid out again to draw it — 12.0 to 21.0µs a frame against 3.5 to 4.0 written as a transform. The stylesheet's `top: 0%` stays as the origin this is measured from, and the box lands 0.006px from where `top` put it.
    viewport.style.transform = `translateY(${viewportTop}px)`;
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
  // The settle that was going to pay the withheld rebuild has gone with the document it was scrolling, so the debt goes too — paid on the next page it would clone a slice for a position the reader is no longer at.
  minimapPreviewOwed = false;
}
// A wheel over the rail moves the page the way a wheel over the page moves it, because the rail's column is a scroller and the web view is the one doing the scrolling. Nothing of ours is on that path: a notch answered by writing the reader's position outright lands as one whole jump where the page glides.
//
// What is here is the mirror. The column's scroll writes the reader's, one to one, and the column travels exactly as far as the reader can — so the distance a notch carries is the page's own, and a notch at either end stops where the page stops. What a notch counted in lines or in pages is worth is the web view's arithmetic, and so is the curve.
if (readerMinimap) {
  readerMinimap.addEventListener('scroll', () => {
    const top = readerMinimap.scrollTop;
    // The column is simply where the mirror put it, a frame ago while the page was gliding. A hand on the rail lands it somewhere the mirror never wrote.
    if (Math.round(top) === Math.round(minimapMirroredColumnScrollTop)) {
      return;
    }
    if (Math.round(app.scrollTop) === Math.round(top)) {
      return;
    }
    minimapMirroredScrollTop = top;
    app.scrollTop = top;
  }, { passive: true });
}
app.addEventListener('scroll', () => {
  // A minimap drag owns the scroll (clamped scrollTop, box pinned via CSS vars, endDrag re-captures on release), so do nothing here during a drag — the forced layouts would be exactly the stutter this avoids.
  if (minimapDragging) {
    return;
  }
  // The reader is already where the column's scroll put it, so there is nothing to carry back. Everything else that moves it — a click on the rail, the keyboard, a tab switch, a reflow re-pin — leaves the column behind and has to bring it along.
  if (Math.round(app.scrollTop) !== Math.round(minimapMirroredScrollTop)) {
    syncMinimapColumnToReader();
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
// A write the disk refused. Its own words, because the reader is looking at the document and the one thing they need to know is that the buffer still holds what they typed.
window.leafShowSaveError = (path, reason) => {
  window.leafShowError(`${path} was not saved: ${reason}. Your edits are still here.`);
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
// Settle layout before the first render.
runSettlePass();
// Every fragment is loaded, so a render from here on is a page somebody could use — which is what the startup card is waiting to be replaced by.
window.__leafBooted = true;
// And the host is told, before the initial state is drawn: this is the first moment a render sent from outside would land on hooks that exist, and the files a launch was asked for are waiting on it. The page-load-finished callback fires while this script has not been appended yet, so a render sent on that one names a tab over the home screen.
send({ command: 'frontEndReady' });
window.leafSetState(window.__leafInitialState || { recent: [], favorites: [], document: null });
window.leafSetNavigation({ canGoBack: false, canGoForward: false });
// The three launch facts, said one after the other through the queueing door rather than through the replacing one: they share the single growl slot, and a fact that is only true at launch has nowhere else to go. The order below is the reading order, chosen rather than inherited.
//
// Came up on defaults because the settings file would not read. Nothing on screen distinguishes that from a first launch, so say it; the file is left alone for its owner to look at. First of the three, because it is the only one written down nowhere else and the only one a reader who misses it acts on -- they start setting their choices again over a file that still holds them.
if (window.__leafSettingsUnreadable) {
  leafQueueToast('Your settings file could not be read, so Leaftext started with its defaults. Your saved choices are still in the file.', 'error');
}
// A failed install relaunches the build that was already there, so the window coming back looks exactly like one that updated. Second: it is about the build in front of the reader, and the journal has it if they miss it.
if (window.__leafUpdateFailed) {
  const failed = window.__leafUpdateFailed;
  // The applier names no version when the staging path was malformed, and a bare "v" is worse than saying nothing.
  const opening = failed.version ? `Updating to v${failed.version} failed` : 'Updating failed';
  // Our own installer's codes are already sentences; an MSI's is a bare number, and both arrive without a full stop.
  const why = String(failed.message || '').replace(/\.$/, '');
  const still = LEAF_VERSION ? ` You are still on v${LEAF_VERSION}.` : '';
  leafQueueToast(`${opening}${why ? `: ${why}` : ''}.${still}`, 'error');
}
// The run before this one never reached the close that saves, so the window it had went without saving anything. Says only that, because the marker knows only that: naming a cause the app did not watch would be a guess, and the journal beside it is where a reason would be if there is one. Last of the three, because it is the only one about a launch the reader is no longer in.
if (window.__leafClosedUnexpectedly) {
  leafQueueToast('Leaftext closed unexpectedly last time. The journal may say why.', 'error');
}
// The vault list came in on the window rather than through its callback, so nothing has asked about its repository yet.
requestActiveVaultStatus();
// The first-run bubble, a frame later: a hint measures the control it points at, and a control the page has not laid out yet has no rectangle to measure.
window.requestAnimationFrame(runHintPass);
