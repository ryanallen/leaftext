// ---- Editing: code view + save -------------------------------------------
// Source-of-truth is in Rust: the host owns the buffer and re-highlights. The JS
// only drives the code view (a textarea over a highlight layer), tracks unsaved
// edits, and relays intent. Its mutable state is declared earlier, above the
// subscriptions that fire renderState() synchronously on load.

function isDocumentDirty(path) {
  return !!(path && dirtyByPath.get(path));
}

// Reflect a document's dirty state into the tab dot and, when it is the active
// document, the Save button — without forcing a full re-render.
function setDirtyState(path, dirty) {
  if (!path) return;
  if (dirty) dirtyByPath.set(path, true);
  else dirtyByPath.delete(path);
  document.querySelectorAll('.tab').forEach((tabEl) => {
    if (tabEl.dataset.tabPath === path) {
      tabEl.classList.toggle('tab-modified', !!dirty);
    }
  });
  updateEditingChrome();
}

// Show/hide and style the code-view toggle and Save button for the active
// document. Both are hidden on the home screen; Save enables (and greens) only
// when the active document has unsaved edits.
function updateEditingChrome() {
  const path = activeDocumentPath();
  const hasDocument = !!path;
  if (codeViewButton) {
    codeViewButton.hidden = !hasDocument;
    codeViewButton.setAttribute('aria-pressed', codeViewActive ? 'true' : 'false');
    codeViewButton.classList.toggle('is-active', codeViewActive);
  }
  if (saveButton) {
    // Nothing to save, nothing shown: the green "Save" button appears only when
    // the active document has unsaved edits.
    saveButton.hidden = !(hasDocument && isDocumentDirty(path));
  }
  if (undoButton) {
    // Undo appears whenever the document has reading-view edits since the last
    // successful save.
    undoButton.hidden = !(hasDocument && undoableByPath.get(path) === true);
  }
  // Save/Undo/code-view visibility changes the action row's width — refold.
  refitAppBar();
}

// Ask the host to revert the most recent reading-view edit. The host pops its
// snapshot, re-renders, and resyncs the chrome, so undoing the last edit hides
// both buttons.
function undoLastEdit() {
  const path = activeDocumentPath();
  if (!path || undoableByPath.get(path) !== true) return;
  send({ command: 'undoEdit' });
}

// The last buffer text handed to the host, so a stale re-highlight response
// (typing continued after it was sent) is ignored rather than regressing.
let lastSentSourceText = null;

// One right-aligned number per source line, paired with a transparent copy of
// the line's text so the row wraps to the same height as the colour layer —
// keeping numbers aligned once lines wrap. Rebuilt when the text changes.
function buildLineNumbers(container, text) {
  const lines = text.split('\n');
  container.innerHTML = lines
    .map(
      (line, index) =>
        `<div class="cv-lnrow"><span class="cv-lnnum">${index + 1}</span><span class="cv-lntxt">${escapeText(line) || '​'}</span></div>`
    )
    .join('');
}

// A zero-width space stands in for an empty source line so its box keeps a full
// row's height, aligning the colour layer and gutter with the textarea.
const CODE_VIEW_BLANK = '​';

// Split the flat highlighter output into one HTML string per source line, closing
// and re-opening any span that straddles a line break so colour carries across
// without leaking markup. Returns null unless the split yields exactly
// `expectedCount` lines, so the caller can fall back to a plain render.
function highlightedHtmlToLines(html, expectedCount) {
  const lines = [];
  const openStack = [];
  let current = '';
  const tokenRe = /<span\b[^>]*>|<\/span>|[^<]+/g;
  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[0];
    if (token[0] === '<') {
      if (token[1] === '/') {
        openStack.pop();
        current += '</span>';
      } else {
        openStack.push(token);
        current += token;
      }
    } else {
      let start = 0;
      for (let i = 0; i < token.length; i += 1) {
        if (token[i] === '\n') {
          current += token.slice(start, i);
          current += '</span>'.repeat(openStack.length);
          lines.push(current);
          current = openStack.join('');
          start = i + 1;
        }
      }
      current += token.slice(start);
    }
  }
  lines.push(current);
  if (expectedCount != null && lines.length !== expectedCount) {
    return null;
  }
  return lines;
}

// The inner HTML each colour-layer line currently shows, one per source line. A
// recolour compares against this to touch only changed lines; a keystroke sets an
// edited line's entry to plain text so the next recolour repaints it.
let codeViewColourHtml = [];

// The inner markup for one colour-layer line: the highlighted line when the
// per-line split lined up, a zero-width space for a blank line (so its box keeps a
// row's height), or plain-escaped text as a fallback.
function colourLineInner(lineText, colouredLine) {
  if (lineText === '') {
    return CODE_VIEW_BLANK;
  }
  return colouredLine != null ? colouredLine : escapeText(lineText);
}

// The per-line inner markup for a whole buffer, coloured from `html` (falling back
// to plain-escaped text if the split doesn't line up 1:1). The single source both
// the full build and the incremental recolour compute their line HTML from.
function computeColourInner(html, text) {
  const lineTexts = text.split('\n');
  const coloured = highlightedHtmlToLines(html || '', lineTexts.length);
  return lineTexts.map((lineText, index) =>
    colourLineInner(lineText, coloured ? coloured[index] : null)
  );
}

// Rebuild the whole colour layer, one `<div class="cv-line">` per source line.
// Used on entry and as a self-heal; the keystroke/recolour paths patch instead.
function setCodeViewColourLines(codeEl, html, text) {
  const inner = computeColourInner(html, text);
  codeEl.innerHTML = inner.map((line) => `<div class="cv-line">${line}</div>`).join('');
  codeViewColourHtml = inner;
}

// Repaint after a debounced re-highlight by replacing only the lines whose markup
// changed (edited lines, plus any whose colour shifted from multi-line state like
// a fence). Diffs against the authoritative full highlight, so unchanged lines
// stay in place and the whole document never re-lays-out.
function recolourCodeViewLines(codeEl, html, text) {
  const inner = computeColourInner(html, text);
  if (
    codeViewColourHtml.length !== inner.length ||
    codeEl.children.length !== inner.length
  ) {
    // Line structure drifted from the highlight; rebuild once to resync.
    setCodeViewColourLines(codeEl, html, text);
    return;
  }
  for (let i = 0; i < inner.length; i += 1) {
    if (codeViewColourHtml[i] !== inner[i]) {
      codeEl.children[i].innerHTML = inner[i];
      codeViewColourHtml[i] = inner[i];
    }
  }
}

// A single colour-layer line element. Freshly typed lines show as plain text (via
// textContent, so no markup leaks); the debounced re-highlight recolours them.
function makeColourLine(text) {
  const div = document.createElement('div');
  div.className = 'cv-line';
  div.textContent = text === '' ? CODE_VIEW_BLANK : text;
  return div;
}

// A single gutter row: the right-aligned number plus a transparent copy of the
// line's text (so the row wraps to the same height as the colour line).
function makeGutterRow(text, index) {
  const row = document.createElement('div');
  row.className = 'cv-lnrow';
  const num = document.createElement('span');
  num.className = 'cv-lnnum';
  num.textContent = String(index + 1);
  const txt = document.createElement('span');
  txt.className = 'cv-lntxt';
  txt.textContent = text === '' ? CODE_VIEW_BLANK : text;
  row.append(num, txt);
  return row;
}

// Replace a contiguous run of `container`'s children (its line elements are 1:1
// with source lines) — remove `removeCount` starting at `start`, then insert one
// element per entry in `newTexts`, built by `makeEl(text, index)`.
function spliceLineElements(container, start, removeCount, newTexts, makeEl) {
  let node = container.children[start] || null;
  for (let i = 0; i < removeCount && node; i += 1) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < newTexts.length; i += 1) {
    frag.appendChild(makeEl(newTexts[i], start + i));
  }
  container.insertBefore(frag, node);
}

// The text nodes of one colour-layer line, in document order. Their concatenated
// data equals the line's text; the elements around them are the colour spans.
function codeLineTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

// Delete `len` chars at column `start` from a colour line's text nodes, leaving
// the colour spans in place. Offsets are read before any node is edited, so
// mutating one doesn't disturb the others.
function deleteCodeLineRange(root, start, len) {
  if (len <= 0) return;
  const end = start + len;
  let offset = 0;
  for (const node of codeLineTextNodes(root)) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    node.data = node.data.slice(0, from) + node.data.slice(to);
  }
}

// Insert `str` at column `at`, inside the colour run to its left so typed text
// inherits that colour (a char added in a blue link stays blue).
function insertCodeLineText(root, at, str) {
  if (!str) return;
  const nodes = codeLineTextNodes(root);
  if (nodes.length === 0) {
    root.appendChild(document.createTextNode(str));
    return;
  }
  let offset = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    if (at <= nodeEnd && (at > nodeStart || i === 0)) {
      const local = at - nodeStart;
      node.data = node.data.slice(0, local) + str + node.data.slice(local);
      return;
    }
    offset = nodeEnd;
  }
  const last = nodes[nodes.length - 1];
  last.data += str;
}

// Edit one coloured line's DOM in place so its colours survive the keystroke:
// diff old vs new text to the changed span, then delete/insert only those chars
// among the text nodes. The debounced re-highlight corrects boundary shifts after.
// Stops the edited line dropping to plain text between keystroke and re-highlight.
function patchColourLineText(lineEl, oldText, newText) {
  if (newText === '') {
    lineEl.innerHTML = CODE_VIEW_BLANK;
    return;
  }
  if (oldText === '') {
    // The line was blank (a zero-width space), so there's no colouring to
    // preserve — show the typed text plainly.
    lineEl.textContent = newText;
    return;
  }
  const maxCommon = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxCommon && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  deleteCodeLineRange(lineEl, prefix, oldText.length - prefix - suffix);
  insertCodeLineText(lineEl, prefix, newText.slice(prefix, newText.length - suffix));
}

// The line text a colour-layer element is currently showing, mapping the blank
// line's zero-width-space placeholder back to an empty string.
function colourLineText(lineEl) {
  const text = lineEl.textContent;
  return text === CODE_VIEW_BLANK ? '' : text;
}

// Patch only the lines a keystroke changed. A textarea edit is one contiguous
// splice, so the shared prefix/suffix of the old and new line arrays is untouched
// and only the range between them is rebuilt — keeping large documents from
// re-rendering on every keystroke.
function updateCodeViewLinesIncremental(codeEl, gutterEl, prevText, nextText) {
  const prev = prevText.split('\n');
  const next = nextText.split('\n');
  const maxCommon = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < maxCommon && prev[prefix] === next[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < maxCommon - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removeCount = prev.length - suffix - prefix;
  const inserted = next.slice(prefix, next.length - suffix);
  // The overwhelmingly common edit — typing within a single line — replaces one
  // line with one line. Keep that line's existing coloured element and edit only
  // the changed characters into it, so its colours never drop to plain text. Fall
  // back to a plain rebuild only if the element's text has drifted from what we
  // expect (then the debounced recolour restores it).
  if (removeCount === 1 && inserted.length === 1) {
    const lineEl = codeEl.children[prefix];
    if (lineEl && colourLineText(lineEl) === prev[prefix]) {
      patchColourLineText(lineEl, prev[prefix], inserted[0]);
      codeViewColourHtml[prefix] = lineEl.innerHTML;
    } else {
      spliceLineElements(codeEl, prefix, removeCount, inserted, makeColourLine);
      codeViewColourHtml.splice(prefix, removeCount, ...inserted.map(() => null));
    }
    // The gutter mirror is transparent (it only sets each row's height), so a
    // plain rebuild of the one changed row is fine.
    spliceLineElements(gutterEl, prefix, removeCount, inserted, makeGutterRow);
    return;
  }
  spliceLineElements(codeEl, prefix, removeCount, inserted, makeColourLine);
  spliceLineElements(gutterEl, prefix, removeCount, inserted, makeGutterRow);
  // Keep the recolour bookkeeping in step: the edited lines now show plain text,
  // so mark them (null) to guarantee the next recolour repaints them.
  codeViewColourHtml.splice(prefix, removeCount, ...inserted.map(() => null));
  // Inserting or removing lines shifts every following line's number; renumber the
  // suffix rows the splice left in place. A same-line edit skips this entirely.
  if (prev.length !== next.length) {
    const rows = gutterEl.children;
    for (let i = prefix; i < rows.length; i += 1) {
      const num = rows[i].firstChild;
      if (num) {
        num.textContent = String(i + 1);
      }
    }
  }
}

// Rebuild the code view's minimap thumbnail now. The per-keystroke DOM edits do
// NOT drive the minimap — its content mutation observer is deliberately detached
// in the code view (see renderCodeView) so a full-document clone does not run on
// every character. Instead we refresh it on the debounced edit cycle.
function refreshCodeViewMinimap() {
  if (!codeViewActive) {
    return;
  }
  invalidateMinimapPreview();
}

function scheduleSourceUpdate() {
  if (sourceUpdateTimer) clearTimeout(sourceUpdateTimer);
  sourceUpdateTimer = setTimeout(() => {
    sourceUpdateTimer = 0;
    lastSentSourceText = codeViewText;
    send({ command: 'updateSource', text: codeViewText });
  }, 180);
}

// Push the latest buffer to the host now, cancelling any pending debounce, so a
// save writes exactly what is in the textarea.
function flushSourceUpdate() {
  if (!codeViewActive) return;
  if (sourceUpdateTimer) {
    clearTimeout(sourceUpdateTimer);
    sourceUpdateTimer = 0;
  }
  lastSentSourceText = codeViewText;
  send({ command: 'updateSource', text: codeViewText });
}

// The code view reuses the reader's own minimap (the scaled document clone in a
// sticky rail, bound by bindDocumentMinimap / updated by updateMinimapViewport).
// That machinery finds its content via minimapSourceElement(), which matches the
// code view's document container too — no separate code-view minimap exists.

function saveActiveDocument() {
  const path = activeDocumentPath();
  if (!path || !isDocumentDirty(path)) return;
  flushSourceUpdate();
  send({ command: 'saveDocument' });
}

// How far down the reader shell is scrolled, as a 0..1 fraction of its
// scrollable range. Approximate by design — the two views wrap differently —
// but it keeps "top is top" and "middle is middle" across the toggle.
function viewScrollFraction() {
  const scrollable = app.scrollHeight - app.clientHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, app.scrollTop / scrollable));
}

// The source byte offset of the block at the top of the reading viewport, or
// null when there's nothing to anchor to. Blocks carry their source range in
// data-src-start (attached for every Markdown block, stamped inline on TEI
// blocks), so the topmost visible block names where the reader is in the
// source exactly — unlike the whole-document height fraction.
function topReadingBlockSourceOffset() {
  const anchorEl = resolveReaderAnchorElement(captureReaderScrollAnchor());
  const block = anchorEl && anchorEl.closest ? anchorEl.closest('[data-src-start]') : null;
  if (!block) return null;
  const start = Number(block.dataset.srcStart);
  return Number.isFinite(start) ? start : null;
}

// The 0-based source line containing a UTF-8 byte offset. Block source ranges
// are byte offsets (pulldown-cmark / roxmltree), but the buffer is a UTF-16 JS
// string, so walk code points accumulating byte lengths until the offset is
// reached, counting the newlines passed. Only scans up to the offset.
function lineIndexAtByteOffset(text, byteOffset) {
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;
  let bytes = 0;
  let line = 0;
  for (let i = 0; i < text.length && bytes < byteOffset; ) {
    const cp = text.codePointAt(i);
    if (cp === 0x0a) line += 1;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return line;
}

// The inverse: UTF-8 byte offset of the start of a 0-based source line.
function byteOffsetAtLineIndex(text, lineIndex) {
  if (!Number.isFinite(lineIndex) || lineIndex <= 0) return 0;
  let bytes = 0;
  let line = 0;
  for (let i = 0; i < text.length && line < lineIndex; ) {
    const cp = text.codePointAt(i);
    if (cp === 0x0a) line += 1;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes;
}

// The 0-based index of the code view's top visible gutter line, by binary
// search over the in-order line rows.
function topVisibleCodeLineIndex() {
  const rows = app.querySelectorAll('.cv-lnrow');
  if (!rows.length) return null;
  const topEdge = app.getBoundingClientRect().top + 1;
  let lo = 0;
  let hi = rows.length - 1;
  let found = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > topEdge) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

// Scroll the reading view so the block containing `srcOffset` sits at the top
// edge: the deterministic landing for leaving the code view. Falls back to
// no-op (caller keeps its own fallback) when the block map is missing.
function scrollReadingToSrcOffset(srcOffset) {
  const body = app.querySelector('.document-body');
  if (!body) return false;
  const blocks = body.querySelectorAll('[data-src-start]');
  if (!blocks.length) return false;
  let target = null;
  for (const el of blocks) {
    const start = Number(el.dataset.srcStart);
    if (!Number.isFinite(start) || start > srcOffset) break;
    target = el;
  }
  if (!target) target = blocks[0];
  correctReaderScrollOrigin();
  const shellRect = app.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  setReaderScrollTop(app.scrollTop + rect.top - shellRect.top);
  return true;
}

if (codeViewButton) {
  codeViewButton.addEventListener('click', () => {
    if (!activeDocumentPath()) return;
    // Carry the current position across the toggle; the destination view's
    // render consumes it and lands at the same relative spot.
    pendingViewScrollFraction = viewScrollFraction();
    // At the very top, land flush at the top of the other view — don't align the
    // first block below the edge, which reads as a stray scroll-down.
    pendingViewAtTop = app.scrollTop <= 1;
    // Entering the code view: remember which source line the reader is on, so
    // it opens there. Leaving: remember which line the code view is on, so the
    // reading view lands on that block. The fraction stays as the fallback.
    if (codeViewActive) {
      pendingCodeViewSrcOffset = null;
      const lineIndex = topVisibleCodeLineIndex();
      pendingReadingSrcOffset = lineIndex == null ? null : byteOffsetAtLineIndex(codeViewText, lineIndex);
    } else {
      pendingReadingSrcOffset = null;
      pendingCodeViewSrcOffset = topReadingBlockSourceOffset();
    }
    // Either direction re-renders the whole view (highlighting a big source or
    // rebuilding a big document is slow), so arm the spinner for the wait.
    beginReaderLoading();
    send({ command: codeViewActive ? 'exitCodeView' : 'enterCodeView' });
  });
}
if (saveButton) {
  saveButton.addEventListener('click', saveActiveDocument);
}
if (undoButton) {
  undoButton.addEventListener('click', undoLastEdit);
}
// Ctrl/Cmd+S saves the active document when there is something to save.
window.addEventListener('keydown', (event) => {
  const saveKey = (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S');
  if (!saveKey) return;
  if (!activeDocumentPath() || !isDocumentDirty(activeDocumentPath())) return;
  event.preventDefault();
  saveActiveDocument();
});
// Ctrl/Cmd+Z steps back one committed reading-view edit — but only when the
// keystroke is NOT inside a live editing surface, whose own native undo still
// covers uncommitted typing keystroke by keystroke.
window.addEventListener('keydown', (event) => {
  const undoKey =
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'z' || event.key === 'Z');
  if (!undoKey) return;
  if (isEditableMouseTarget(event.target)) return;
  const path = activeDocumentPath();
  if (!path || undoableByPath.get(path) !== true) return;
  event.preventDefault();
  undoLastEdit();
});

// Build the wrapped raw-source code view: three exactly-aligned layers (colour,
// line-number mirror, transparent textarea) that the reader shell (#app)
// scrolls as one — the same scroller the reading view uses, whose native
// scrollbar is already hidden. The document never scrolls sideways: long lines
// wrap, and the line numbers stay pinned to their lines.
//
// The rail on the right is the reader's own document minimap — identical markup
// and machinery (bindDocumentMinimap, updateMinimapViewport, the clone-based
// thumbnail). It renders here regardless of the reading view's minimap setting
// because it is the code view's vertical scroll affordance.
function renderCodeView(state) {
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  readerAnchorBlocks = null;
  // If the code view is already on screen (live reload, tab reorder), remember
  // where it sits so an in-place re-render doesn't jump to the top. An explicit
  // restored fraction or a pending toggle fraction still wins over this.
  const priorCodeScroll = app.querySelector('.code-view-input') ? viewScrollFraction() : null;
  app.className = 'reader-shell has-document code-view-shell';
  // Flag the code view at the document root so the header's active tab (a sibling
  // of the reader, not a descendant) can match the code surface color.
  document.documentElement.dataset.codeView = 'true';
  const text = state.text || '';
  lastSentSourceText = text;
  app.innerHTML = `
    <div class="code-view" data-language="${escapeAttr(state.displayName || '')}">
      <div class="code-view-doc">
        <pre class="code-view-highlight" aria-hidden="true"><code class="language-${escapeAttr(state.language || '')}"></code></pre>
        <div class="code-view-linenums" aria-hidden="true"></div>
        <textarea class="code-view-input" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"></textarea>
      </div>
    </div>`;
  // The code view always carries a rail, whatever the reading view's setting.
  setMinimapMarkup(documentMinimapMarkup());
  const textarea = app.querySelector('.code-view-input');
  const highlight = app.querySelector('.code-view-highlight');
  const code = highlight.querySelector('code');
  const linenums = app.querySelector('.code-view-linenums');
  textarea.value = text;
  setCodeViewColourLines(code, state.html, text);
  buildLineNumbers(linenums, text);
  // Tab edits the document — insert a tab character at the caret — instead of
  // moving focus to the next control. Inserted via execCommand so the
  // textarea's native undo stack keeps working. Shift+Tab is left alone as the
  // standard keyboard escape out of the editor.
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  });
  textarea.addEventListener('input', () => {
    const prevText = codeViewText;
    codeViewText = textarea.value;
    // Patch only the changed lines into the colour layer and gutter. A within-line
    // edit splices chars into the existing spans so the line never drops to plain
    // text; the debounced re-highlight corrects boundary shifts after.
    updateCodeViewLinesIncremental(code, linenums, prevText, codeViewText);
    const path = activeDocumentPath();
    if (path) setDirtyState(path, true);
    scheduleSourceUpdate();
  });
  // Wire the reader's minimap to this DOM: rail drag/click, the resize observer,
  // and the first thumbnail build. The global #app scroll listener keeps the
  // viewport box in sync while scrolling.
  bindDocumentMinimap();
  // Detach the minimap's mutation observer: the document mutates on every
  // keystroke here, and re-cloning it each time stuttered on large files. The
  // thumbnail refreshes on the debounced edit cycle instead.
  if (minimapBodyObserver) {
    minimapBodyObserver.disconnect();
    minimapBodyObserver = null;
  }
  // Setting .value parks the caret at the end, and focus() would scroll it into
  // view (yanking to the bottom). Park at the start, focus without scrolling,
  // then land where we should: an explicit restored position (returning to a
  // tab left in code view), else a pending toggle fraction, else the position
  // the code view already held (in-place re-render).
  textarea.setSelectionRange(0, 0);
  textarea.focus({ preventScroll: true });
  const explicit = typeof state.scrollFraction === 'number' ? state.scrollFraction : null;
  const srcOffset = pendingCodeViewSrcOffset;
  pendingCodeViewSrcOffset = null;
  const atTop = pendingViewAtTop;
  pendingViewAtTop = false;
  let positioned = false;
  // Landing on the reader's exact source line wins over any fraction, but only
  // when this render isn't restoring an explicit saved position (a tab reopened
  // in the code view) and wasn't toggled from the very top — there we skip the
  // block landing and let the fraction (0) fall through to a flush-top landing.
  if (explicit == null && !atTop && srcOffset != null) {
    const lineIndex = lineIndexAtByteOffset(text, srcOffset);
    const row = linenums.children[Math.min(lineIndex, linenums.children.length - 1)];
    if (row) {
      const shellRect = app.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      // Land the target line just below the top edge, echoing the reading gap.
      app.scrollTop = Math.max(0, app.scrollTop + (rowRect.top - shellRect.top) - 12);
      positioned = true;
    }
  }
  if (!positioned) {
    let fraction = explicit;
    if (fraction == null) fraction = pendingViewScrollFraction;
    if (fraction == null) fraction = priorCodeScroll;
    const scrollable = Math.max(0, app.scrollHeight - app.clientHeight);
    app.scrollTop = (fraction || 0) * scrollable;
  }
  pendingViewScrollFraction = null;
  window.requestAnimationFrame(() => updateMinimapViewport());
}

// Enter the code view: the host sends the highlighted source, the exact buffer
// text, the language, and the dirty state.
window.leafShowCodeView = (state) => {
  runViewRender(state && state.html, () => {
    codeViewActive = true;
    codeViewText = (state && state.text) || '';
    renderCodeView(state || {});
    const path = activeDocumentPath();
    if (path) setDirtyState(path, !!(state && state.dirty));
    updateEditingChrome();
  });
};

// Refresh the code view's colour layer and dirty state after a debounced
// re-highlight. Only recolour when the buffer still matches what was sent, or
// stale HTML would hide newer keystrokes.
window.leafSourceUpdated = (state) => {
  if (!codeViewActive || !state) return;
  if (lastSentSourceText === null || codeViewText === lastSentSourceText) {
    const code = app.querySelector('.code-view-highlight code');
    if (code) recolourCodeViewLines(code, state.html, codeViewText);
  }
  const path = activeDocumentPath();
  if (path) setDirtyState(path, !!state.dirty);
  // The document settled — refresh the thumbnail once, not per keystroke.
  refreshCodeViewMinimap();
};

// The host reports a save's outcome. On success the document is no longer dirty;
// on failure, keep the edits and surface the error.
window.leafSaved = (path, ok, error) => {
  if (ok) {
    undoableByPath.delete(path);
    setDirtyState(path, false);
  } else if (error) {
    window.leafShowOpenError(path, error);
  }
};

