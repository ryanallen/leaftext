function documentMinimapMarkup() {
  return `<aside class="document-minimap" aria-label="${escapeAttr(window.leafLocale.t('minimap.aria'))}"><div class="document-minimap-track" aria-hidden="true"><div class="document-minimap-content" aria-hidden="true"></div><div class="document-minimap-viewport" aria-hidden="true"></div></div></aside>`;
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
// The rail lives beside the page rather than inside it, so every render has to
// place it here instead of in its own markup. Empty means no rail at all — the
// shell's :has(.document-minimap) collapses the column it would occupy.
//
// The scroller is told directly rather than left to :has(): scrollbar styles do
// not re-resolve when a :has() match flips, so the bar outlives the rail.
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
  // Dragging the handle keeps the grabbed point of the box under the cursor and
  // converts the box's new position back into a scroll offset — the inverse of
  // placeMinimapViewport()'s box placement, so the box and the thumbnail slide stay
  // under the cursor even on documents taller than the rail.
  const dragMinimapViewportToPointer = (event, pointerOffsetY) => {
    // Use the geometry captured at pointerdown — never re-measure mid-drag (that
    // forces a layout each move; see minimapDragMetrics).
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
    // Invert placeMinimapViewport()'s box placement (box top = scrollTop times a
    // slope), so a box position divides back into a scroll offset. Fall back to
    // the handle-range ratio when that slope is non-positive.
    const previewTravel = Math.max(0, metrics.scaledDocumentHeight - metrics.trackHeight);
    const viewportTopPerScrollPixel = metrics.previewScale - previewTravel / metrics.scrollable;
    const targetViewportScrollTop = viewportTopPerScrollPixel > 0
      ? targetViewportTop / viewportTopPerScrollPixel
      : (handleRange <= 0 ? 0 : (targetViewportTop / handleRange) * metrics.scrollable);
    // Set scrollTop against the cached range, then pin the box + thumbnail. The
    // scroll handler skips its update while dragging; pointerup settles once.
    const boundedScrollTop = Math.min(metrics.scrollable, Math.max(0, targetViewportScrollTop));
    app.scrollTop = boundedScrollTop;
    const minimap = track.closest('.document-minimap');
    if (minimap) {
      placeMinimapViewport(minimap, metrics, boundedScrollTop);
    } else {
      updateMinimapViewport();
    }
  };
  // A plain click on the rail centers the reader on the clicked point of the
  // thumbnail (mapped straight through the preview scale).
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
    track.setPointerCapture(event.pointerId);
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
      // A pass queued mid-drag holds the pre-drag anchor, so drop it before recording
      // where the drag landed; either omission snaps the reader back to the start.
      cancelReaderLayoutUpdate();
      recordReaderScrollPosition();
      // Settle the box/thumbnail onto the true reading position; content that
      // streamed in keeps settling via the reflow observer.
      updateMinimapViewport();
    }
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  bindDocumentMinimapPreview(track);
}
// The minimap is a shrunken clone of the rendered document, so the rail shows
// real text. The clone rebuilds only on content changes, never on scroll (which
// only moves the viewport box and, on tall documents, the thumbnail's slide).
// The element it mirrors: the reading view's document body, or the code view's
// page wrapper — one shared lookup lets the pipeline serve both views.
// It has to be `.code-view` and not the `.code-view-doc` inside it: the clone is
// reparented into the rail, so only what sits on the cloned element survives, and
// `.code-view` holds the editor's metrics, its --cv-* vars and the ancestor half of
// every `.syn-*` rule. Cloning the inner element wrapped the thumbnail at the wrong
// measure and rendered it shorter than the track the box is placed over.
// Two queries, not a selector list: a list matches in document order, so a stray
// `.document-body` behind the code view would win.
function minimapSourceElement() {
  return app.querySelector('.code-view') || app.querySelector('.document-body');
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
    // Watch the rail, not the document: its width changes at the responsive
    // breakpoints (which the source's resize would miss), and it never fires on scroll.
    minimapResizeObserver = new ResizeObserver(() => {
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
  // >=2px dead-band: the ideal origin can fall on a half-pixel with no integer fixed
  // point, flipping 1px each frame (e.g. 177<->178) and driving an endless relayout
  // loop via the minimap ResizeObserver. Sub-2px jitter is invisible; ignore it.
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
  // Coalesce: back-to-back renders each scheduling a reset must not run it
  // twice — the second pass would see the toggle fraction already consumed
  // and hard-reset a mid-document reader to the top.
  if (resetReaderScrollFrame) {
    return;
  }
  resetReaderScrollFrame = window.requestAnimationFrame(() => {
    resetReaderScrollFrame = 0;
    const source = app.querySelector('.document-body');
    const content = correctReaderScrollOrigin(source);
    // Leaving the code view carries its scroll fraction here so the reading view
    // lands at the same relative position; other resets have none.
    const fraction = pendingViewScrollFraction;
    pendingViewScrollFraction = null;
    if (fraction) {
      const viewportHeight = Math.max(1, Math.ceil(app.clientHeight));
      const range = measureReaderScrollRange(content, viewportHeight);
      setReaderScrollTop(content.topOffset + fraction * range.scrollable);
    } else {
      setReaderScrollTop(content.topOffset);
    }
    readerScrollAnchor = captureReaderScrollAnchor();
    updateMinimapViewport();
  });
}
// Describe the reader's position as a render-independent anchor: nearest heading
// slug above the top edge, block ordinal within that section (heading = block 0),
// and the signed offset from that block's top (signed to keep the reading-mode
// top gap). Measuring from the section keeps the landing stable when earlier
// sections grow (live reload). Anchor blocks are in document order, so the
// topmost-visible one is found by binary search rather than scanning all ~25k.
function readerAnchorBlockList(source) {
  const count = source.childElementCount;
  // Rebuild when the body was replaced, the child count shifted, or either end
  // of the cached list detached. Checking the last block too catches async DOM
  // swaps (Mermaid, KaTeX, code decoration) that leave detached, zero-rect
  // entries — those break the binary search's document-order assumption.
  const stale =
    !readerAnchorBlocks ||
    readerAnchorBlocksSource !== source ||
    readerAnchorBlocksCount !== count ||
    !readerAnchorBlocks.length ||
    !readerAnchorBlocks[0].isConnected ||
    !readerAnchorBlocks[readerAnchorBlocks.length - 1].isConnected;
  if (stale) {
    readerAnchorBlocks = Array.from(source.querySelectorAll(READER_ANCHOR_SELECTOR));
    readerAnchorBlocksCount = count;
    readerAnchorBlocksSource = source;
  }
  return readerAnchorBlocks;
}
// Turn a block-list index into the serializable {section, block, offsetY} anchor:
// nearest heading slug above it, the block's ordinal within that section, and its
// signed offset from the reader's top edge. Shared by the top-visible capture and
// the anchor-above fallback used while editing a block whose height swings.
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
function captureReaderScrollAnchor() {
  const source = app.querySelector('.document-body');
  if (!currentState?.document || !source) {
    return null;
  }
  const blocks = readerAnchorBlockList(source);
  if (!blocks.length) {
    return null;
  }
  const shellRect = app.getBoundingClientRect();
  const topEdge = shellRect.top + 1;
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
// Settle the reader where it now sits and re-record that as the anchor. Every reflow
// re-pin restores readerScrollAnchor, so anything moving app.scrollTop itself must
// call this — a stale anchor turns the next late layout change (an image decoding,
// the async pager landing) into a yank back to the pre-jump position. The scroll
// listener covers user scrolls; the minimap, which it ignores, calls this instead.
function recordReaderScrollPosition() {
  clampReaderScrollPosition();
  readerScrollAnchor = captureReaderScrollAnchor();
}
// Anchor to the nearest anchorable block strictly above `el`, keeping its offset
// from the top edge. Blocks above a block never move when it resizes, so this
// holds the reader steady while an image collapses to source and re-decodes on
// commit — at worst landing on the line directly above the image, never the top.
// Null when `el` is the first block (nothing above it to anchor to).
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
    // Skip the edited block itself and any nested anchor blocks it contains (a
    // blockquote/table maps as one editable block but its rows are in the list).
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
// Re-resolve a serializable anchor against the current DOM: the same Markdown
// renders the same blocks, so it points at the original element after a re-render.
function resolveReaderAnchorElement(anchor) {
  const source = app.querySelector('.document-body');
  if (!source || !anchor) {
    return null;
  }
  // Resolve against the same list capture used, so a serialized {section, block}
  // pair always points back at the element it named. A divergent list here would
  // shift the index and land the restore on the wrong block.
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
  // Settle the origin before measuring — the clamp's own correction would shift
  // the layout after these rects are read and land off by the change.
  correctReaderScrollOrigin();
  const shellRect = app.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const offsetY = Number.isFinite(anchor?.offsetY) ? anchor.offsetY : 0;
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top + offsetY);
}
function scheduleReaderLayoutUpdate(anchor = readerScrollAnchor || captureReaderScrollAnchor()) {
  if (readerLayoutFrame) {
    return;
  }
  readerLayoutFrame = window.requestAnimationFrame(() => {
    readerLayoutFrame = 0;
    correctReaderScrollOrigin();
    // A minimap drag owns the scroll: `anchor` predates it (the drag skips the
    // refresh to keep layout reads off the pointer path), so re-pinning would throw
    // the reader back to where the drag started. Leave the box alone too; endDrag
    // settles both.
    if (minimapDragging) {
      return;
    }
    restoreReaderScrollAnchor(anchor);
    readerScrollAnchor = captureReaderScrollAnchor();
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
// Keep the reader pinned to its anchor as the document settles: images decode a
// few frames late and grow content above the reader, so re-pinning on every
// reflow and image load holds the reader on the same block until layout is final.
function observeReaderReflow() {
  disconnectReaderReflowObserver();
  const source = app.querySelector('.document-body');
  if (!source) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    readerReflowObserver = new ResizeObserver(() => {
      // A resize means the block set may have changed (images decoding,
      // Mermaid/KaTeX/code decoration swapping nodes in). Drop the cached anchor
      // list so the next capture reflects the current DOM. Cheap: resizes are rare.
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
// Everything the preview and viewport renderers need, in one layout read. The
// reader renders in full, so app.scrollTop/scrollHeight/clientHeight are exact.
// Mirrors the web minimap's measure() (site/minimap.js).
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
  // Where the document content begins in the scroll container (top gap included);
  // the thumbnail starts here too so its top lines up with the real content.
  const sourceTop = sourceRect ? Math.max(0, Math.round(sourceRect.top - appRect.top + app.scrollTop)) : 0;
  const previewScale = contentWidth / sourceWidth;
  const scaledDocumentHeight = Math.max(1, scrollHeight * previewScale);
  // Size the rail to the thumbnail, capped at the space below its top: a short
  // document gets a short rail, a long one fills the screen and slides inside.
  const availableHeight = minimap ? minimapAvailableHeight(minimap) : viewportHeight;
  const trackHeight = Math.max(1, Math.min(availableHeight, scaledDocumentHeight));
  if (minimap) {
    minimap.style.setProperty('--minimap-track-height', `${trackHeight}px`);
  }
  return { source, sourceWidth, contentWidth, sourceTop, trackRect, trackHeight, viewportHeight, scrollHeight, scrollable, scrollTop, previewScale, scaledDocumentHeight };
}
function scheduleMinimapPreviewUpdate() {
  if (minimapPreviewFrame) {
    return;
  }
  minimapPreviewFrame = window.requestAnimationFrame(() => {
    minimapPreviewFrame = 0;
    updateDocumentMinimapPreview();
  });
}
// The document content changed: mark the clone stale and schedule a rebuild.
// Geometry-only triggers (resize) call scheduleMinimapPreviewUpdate directly and
// let the width check decide whether a rebuild is needed.
function invalidateMinimapPreview() {
  minimapContentVersion += 1;
  scheduleMinimapPreviewUpdate();
}
// Any <details> open/close (outline, settings, library folders) changes document
// height, so the minimap clone goes stale. The body MutationObserver misses the
// bare `open` flip; `toggle` catches both — in capture phase, since it doesn't bubble.
document.addEventListener('toggle', invalidateMinimapPreview, true);
// Build the thumbnail: clone the document, strip ids/links (nothing focusable or
// duplicated for a11y), shrink to the rail width with a transform. Rebuilt only on
// content changes; scroll just repositions the box and slides the clone.
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
  // Skip the clone when nothing shaping the thumbnail changed: same content
  // version, wrap width, and rail width. The common resize (height-only, or a
  // width change within the capped column) just repositions the box off the
  // existing clone — the cloneNode below is what made resize feel like a reload.
  if (
    content.querySelector('.document-minimap-preview') &&
    minimapBuiltVersion === minimapContentVersion &&
    minimapBuiltSourceWidth === metrics.sourceWidth &&
    minimapBuiltPreviewWidth === previewWidth
  ) {
    updateMinimapViewport();
    return;
  }
  const preview = source.cloneNode(true);
  preview.removeAttribute('id');
  // Drop the code view's focusable textarea from the clone; its text is invisible
  // anyway (the colour layer shows).
  preview.querySelectorAll('textarea').forEach((node) => node.remove());
  preview.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  preview.querySelectorAll('a[href]').forEach((link) => {
    // Glossary terms blend into the body text via an href-based rule; stripping
    // the href for a11y would drop that blend, so tag them first for a class-based
    // rule to re-blend in the clone.
    const href = link.getAttribute('href') || '';
    if (/^glossary:/i.test(href) || /GLOSSARY\.md#/i.test(href)) {
      link.classList.add('glossary-term');
    }
    link.removeAttribute('href');
  });
  preview.classList.add('document-minimap-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${metrics.sourceWidth}px`;
  // Scale to the rail width, then nudge the clone down by the top gap (sourceTop)
  // so the thumbnail sits where the real content sits in the scroll range.
  preview.style.transform = `translateY(${metrics.sourceTop * previewScale}px) scale(${previewScale})`;
  content.replaceChildren(preview);
  content.style.height = `${metrics.scaledDocumentHeight}px`;
  minimapBuiltVersion = minimapContentVersion;
  minimapBuiltSourceWidth = metrics.sourceWidth;
  minimapBuiltPreviewWidth = previewWidth;
  updateMinimapViewport();
}
function scheduleMinimapViewportUpdate() {
  if (minimapViewportFrame) {
    return;
  }
  minimapViewportFrame = window.requestAnimationFrame(() => {
    minimapViewportFrame = 0;
    updateMinimapViewport();
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
  placeMinimapViewport(minimap, measureDocumentMinimap(track), null);
}
// Place the viewport box and, on tall documents, slide the thumbnail inside the
// rail. Position is driven by the exact reader scroll and the box height is the
// viewport at thumbnail scale, so it tracks the visible region at any length.
// scrollTopOverride pins to a specific offset (a drag); null reads live scrollTop.
// Mirrors site/minimap.js's updateViewport().
function placeMinimapViewport(minimap, metrics, scrollTopOverride) {
  const content = minimap.querySelector('.document-minimap-content');
  const scaledDocumentHeight = metrics.scaledDocumentHeight;
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
  minimap.style.setProperty('--minimap-viewport-top', `${viewportTop}px`);
  minimap.style.setProperty('--minimap-viewport-height', `${boundedViewportHeight}px`);
  minimap.style.setProperty('--minimap-preview-top', `${previewTop}px`);
}
// The scroll listener must stay cheap: scroll fires many times per frame, so a
// forced layout here stutters the page. clampReaderScrollPosition() and
// captureReaderScrollAnchor() both force a reflow, so the listener is passive and
// coalesces that work into one rAF per frame. scheduleMinimapViewportUpdate() is
// just a flag + rAF, safe on the event. The anchor is consumed asynchronously, so
// updating it a frame late costs nothing.
let readerScrollFrame = 0;
app.addEventListener('scroll', () => {
  // A minimap drag owns the scroll (clamped scrollTop, box pinned via CSS vars,
  // endDrag re-captures on release), so do nothing here during a drag — the
  // forced layouts would be exactly the stutter this avoids.
  if (minimapDragging) {
    return;
  }
  scheduleMinimapViewportUpdate();
  if (readerScrollFrame) {
    return;
  }
  readerScrollFrame = window.requestAnimationFrame(() => {
    readerScrollFrame = 0;
    clampReaderScrollPosition();
    readerScrollAnchor = captureReaderScrollAnchor();
  });
}, { passive: true });
window.addEventListener('resize', () => {
  scheduleReaderLayoutUpdate();
  scheduleMinimapViewportUpdate();
  scheduleMinimapPreviewUpdate();
});
window.leafShowError = (message) => leafToast(message, 'error');
window.leafShowOpenError = (path, reason) => {
  window.leafShowError(window.leafLocale.t('errors.openFailed', { path, reason }));
};
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function escapeAttr(value) {
  return escapeText(value).replace(/`/g, '&#96;');
}
window.leafSetState(window.__leafInitialState || { recent: [], document: null });
window.leafSetNavigation({ canGoBack: false, canGoForward: false });
// The vault list came in on the window rather than through its callback, so
// nothing has asked about its repository yet.
requestActiveVaultStatus();
