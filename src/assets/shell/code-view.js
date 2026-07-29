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
  const next = !!dirty;
  // Only touch the DOM when the answer actually changed. Every code-view keystroke
  // calls this, and the chrome refresh below ends in refitAppBar(), which measures
  // the tab strip and so forces a layout of the whole page — 141 ms per character
  // on a 4 MB source. After the first character the document is already dirty and
  // there is nothing to restate.
  if ((dirtyByPath.get(path) === true) === next) return;
  if (next) dirtyByPath.set(path, true);
  else dirtyByPath.delete(path);
  document.querySelectorAll('.tab').forEach((tabEl) => {
    if (tabEl.dataset.tabPath === path) {
      tabEl.classList.toggle('tab-modified', next);
    }
  });
  updateEditingChrome();
}

// Show/hide and style the floating bar for the active document: which view is
// on, and whether there is anything to save or undo.
function updateEditingChrome() {
  const path = activeDocumentPath();
  const hasDocument = !!path;
  renderReaderToolbar(hasDocument);
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

// A CSS counter draws the numbers, so the only thing left to set is the gutter's
// width: too narrow and the number wraps, making every row past 9,999 lines taller
// than the line it labels. Monospace, so `ch` sizes it exactly.
function sizeLineNumberGutter(codeView, lineCount) {
  if (!codeView) return;
  const digits = String(Math.max(1, lineCount)).length;
  codeView.style.setProperty('--cv-gutter', `max(3.75em, ${digits}ch + 1.25em)`);
}

// A zero-width space stands in for an empty source line so its box keeps a full
// row's height, aligning the color layer and gutter with the textarea.
const CODE_VIEW_BLANK = '​';

// Split the flat highlighter output into one HTML string per source line. The
// highlighter closes its spans at every line break, so the straddle handling here
// is a safety net rather than the usual path — it closes and re-opens anything
// still open so a line's markup never leaks into the next. Returns null unless the
// split yields exactly `expectedCount` lines, so the caller can fall back to a
// plain render.
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

// The inner HTML each color-layer line currently shows, one per source line. A
// recolor compares against this to touch only changed lines; a keystroke sets an
// edited line's entry to plain text so the next recolor repaints it.
let codeViewColorHtml = [];

// The inner markup for one color-layer line: the highlighted line when the
// per-line split lined up, a zero-width space for a blank line (so its box keeps a
// row's height), or plain-escaped text as a fallback.
function colorLineInner(lineText, coloredLine) {
  if (lineText === '') {
    return CODE_VIEW_BLANK;
  }
  return coloredLine != null ? coloredLine : escapeText(lineText);
}

// The per-line inner markup for a whole buffer, colored from `html` (falling back
// to plain-escaped text if the split doesn't line up 1:1). The single source both
// the full build and the incremental recolor compute their line HTML from.
function computeColorInner(html, text) {
  const lineTexts = text.split('\n');
  const colored = highlightedHtmlToLines(html || '', lineTexts.length);
  return lineTexts.map((lineText, index) =>
    colorLineInner(lineText, colored ? colored[index] : null)
  );
}

// Rebuild the whole color layer, one `<div class="cv-line">` per source line.
// Used on entry and as a self-heal; the keystroke/recolor paths patch instead.
function setCodeViewColorLines(codeEl, html, text) {
  const inner = computeColorInner(html, text);
  codeEl.innerHTML = inner.map((line) => `<div class="cv-line">${line}</div>`).join('');
  codeViewColorHtml = inner;
}

// Repaint after a debounced re-highlight by replacing only the lines whose markup
// changed (edited lines, plus any whose color shifted from multi-line state like
// a fence). Diffs against the authoritative full highlight, so unchanged lines
// stay in place and the whole document never re-lays-out.
function recolorCodeViewLines(codeEl, html, text) {
  const inner = computeColorInner(html, text);
  if (
    codeViewColorHtml.length !== inner.length ||
    codeEl.children.length !== inner.length
  ) {
    // Line structure drifted from the highlight; rebuild once to resync.
    setCodeViewColorLines(codeEl, html, text);
    return;
  }
  for (let i = 0; i < inner.length; i += 1) {
    if (codeViewColorHtml[i] !== inner[i]) {
      codeEl.children[i].innerHTML = inner[i];
      codeViewColorHtml[i] = inner[i];
    }
  }
}

// A single color-layer line element. Freshly typed lines show as plain text (via
// textContent, so no markup leaks); the debounced re-highlight recolors them.
function makeColorLine(text) {
  const div = document.createElement('div');
  div.className = 'cv-line';
  div.textContent = text === '' ? CODE_VIEW_BLANK : text;
  return div;
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

// The text nodes of one color-layer line, in document order. Their concatenated
// data equals the line's text; the elements around them are the color spans.
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

// Delete `len` chars at column `start` from a color line's text nodes, leaving
// the color spans in place. Offsets are read before any node is edited, so
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

// Insert `str` at column `at`, inside the color run to its left so typed text
// inherits that color (a char added in a blue link stays blue).
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

// Edit one colored line's DOM in place so its colors survive the keystroke:
// diff old vs new text to the changed span, then delete/insert only those chars
// among the text nodes. The debounced re-highlight corrects boundary shifts after.
// Stops the edited line dropping to plain text between keystroke and re-highlight.
function patchColorLineText(lineEl, oldText, newText) {
  if (newText === '') {
    lineEl.innerHTML = CODE_VIEW_BLANK;
    return;
  }
  if (oldText === '') {
    // The line was blank (a zero-width space), so there's no coloring to
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

// The line text a color-layer element is currently showing, mapping the blank
// line's zero-width-space placeholder back to an empty string.
function colorLineText(lineEl) {
  const text = lineEl.textContent;
  return text === CODE_VIEW_BLANK ? '' : text;
}

// Patch only the lines a keystroke changed. A textarea edit is one contiguous
// splice, so the shared prefix/suffix of the old and new line arrays is untouched
// and only the range between them is rebuilt — keeping large documents from
// re-rendering on every keystroke.
function updateCodeViewLinesIncremental(codeEl, prevText, nextText) {
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
  // line with one line. Keep that line's existing colored element and edit only
  // the changed characters into it, so its colors never drop to plain text. Fall
  // back to a plain rebuild only if the element's text has drifted from what we
  // expect (then the debounced recolor restores it).
  if (removeCount === 1 && inserted.length === 1) {
    const lineEl = codeEl.children[prefix];
    if (lineEl && colorLineText(lineEl) === prev[prefix]) {
      patchColorLineText(lineEl, prev[prefix], inserted[0]);
      codeViewColorHtml[prefix] = lineEl.innerHTML;
    } else {
      spliceLineElements(codeEl, prefix, removeCount, inserted, makeColorLine);
      codeViewColorHtml.splice(prefix, removeCount, ...inserted.map(() => null));
    }
    return;
  }
  spliceLineElements(codeEl, prefix, removeCount, inserted, makeColorLine);
  // Keep the recolor bookkeeping in step: the edited lines now show plain text,
  // so mark them (null) to guarantee the next recolor repaints them.
  codeViewColorHtml.splice(prefix, removeCount, ...inserted.map(() => null));
}

// Rebuild the thumbnail once typing has actually stopped. The 180 ms edit debounce
// is still mid-sentence, and rebuilding there cost ~66 ms in every pause; a
// thumbnail can lag a second behind without anyone being able to tell.
const CODE_VIEW_MINIMAP_IDLE_MS = 1200;
let codeViewMinimapTimer = 0;
function refreshCodeViewMinimap() {
  if (!codeViewActive) {
    return;
  }
  if (codeViewMinimapTimer) window.clearTimeout(codeViewMinimapTimer);
  codeViewMinimapTimer = window.setTimeout(() => {
    codeViewMinimapTimer = 0;
    if (codeViewActive) invalidateMinimapPreview();
  }, CODE_VIEW_MINIMAP_IDLE_MS);
}

// Hand the host the edit rather than the buffer.
//
// Shipping the whole text on each debounce cost 243 ms of IPC per typing pause on
// a 4 MB file — the string is marshalled across the process boundary and parsed
// again on the far side, both ways. The edit itself is a handful of characters, so
// send those: the common prefix and suffix of the last text the host was given and
// the current one bracket everything that changed.
//
// Offsets are UTF-16 code units, which is what JS string indices are; the host
// converts against its own copy. `length` lets it prove the two buffers still
// agree — if they ever drift, a splice would corrupt the file silently, so a
// mismatch triggers a full resend instead.
function sourceSpliceSince(previous, next) {
  const max = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < max && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  // Never split a surrogate pair: back off until both ends sit on whole code points.
  while (prefix > 0 && prefix < previous.length && prefix < next.length) {
    const c = next.charCodeAt(prefix - 1);
    if (c >= 0xd800 && c <= 0xdbff) prefix -= 1;
    else break;
  }
  return {
    start: prefix,
    removed: previous.length - suffix - prefix,
    inserted: next.slice(prefix, next.length - suffix),
    length: next.length,
  };
}

function sendSourceUpdate() {
  // The editor path defers rejoining its line array until the buffer is read.
  cvSyncCodeViewText();
  if (lastSentSourceText === null) {
    lastSentSourceText = codeViewText;
    send({ command: 'updateSource', text: codeViewText });
    return;
  }
  if (lastSentSourceText === codeViewText) return;
  const splice = sourceSpliceSince(lastSentSourceText, codeViewText);
  lastSentSourceText = codeViewText;
  send({
    command: 'spliceSource',
    start: splice.start,
    removed: splice.removed,
    inserted: splice.inserted,
    length: splice.length,
  });
}

function scheduleSourceUpdate() {
  if (sourceUpdateTimer) clearTimeout(sourceUpdateTimer);
  sourceUpdateTimer = setTimeout(() => {
    sourceUpdateTimer = 0;
    sendSourceUpdate();
  }, 180);
}

// Push the latest buffer to the host now, canceling any pending debounce, so a
// save writes exactly what is in the textarea.
function flushSourceUpdate() {
  if (!codeViewActive) return;
  if (sourceUpdateTimer) {
    clearTimeout(sourceUpdateTimer);
    sourceUpdateTimer = 0;
  }
  sendSourceUpdate();
}

// The host's copy disagreed with ours, so stop splicing and send the whole buffer.
// Nothing should reach this; it exists so that if anything does, the file is
// rewritten from what is on screen rather than from a buffer that has drifted.
window.leafResyncSource = () => {
  if (!codeViewActive) return;
  cvSyncCodeViewText();
  lastSentSourceText = codeViewText;
  send({ command: 'updateSource', text: codeViewText });
};

// The code view reuses the reader's own minimap (the scaled document clone in a
// sticky rail, bound by bindDocumentMinimap / updated by updateMinimapViewport).
// That machinery finds its content via minimapSourceElement(), which matches the
// .code-view wrapper below too — no separate code-view minimap exists.

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

// The 0-based index of the code view's top visible line, by binary search over
// the in-order color lines.
function topVisibleCodeLineIndex() {
  const rows = app.querySelectorAll('.cv-line');
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

// Swap between the rendered page and its source, carrying the reader's place
// across. Named rather than inline on a listener: the floating bar's view group
// calls it, and so did the button that used to live in the app bar.
function toggleCodeView() {
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
      cvSyncCodeViewText();
      pendingReadingSrcOffset = lineIndex == null ? null : byteOffsetAtLineIndex(codeViewText, lineIndex);
    } else {
      pendingReadingSrcOffset = null;
      // Coming from the map there is no reading position to carry, and asking for
      // one measures a document that is not on screen.
      pendingCodeViewSrcOffset = graphViewOpen ? null : topReadingBlockSourceOffset();
    }
    // Either direction re-renders the whole view (highlighting a big source or
    // rebuilding a big document is slow), so arm the spinner for the wait.
    beginReaderLoading();
    send({ command: codeViewActive ? 'exitCodeView' : 'enterCodeView' });
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

// Build the wrapped raw-source code view: three exactly-aligned layers (color,
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
  cvTeardownEditor();
  readerAnchorBlocks = null;
  // If the code view is already on screen (live reload, tab reorder), remember
  // where it sits so an in-place re-render doesn't jump to the top. An explicit
  // restored fraction or a pending toggle fraction still wins over this.
  const priorCodeScroll = app.querySelector('.code-view') ? viewScrollFraction() : null;
  app.className = 'reader-shell has-document code-view-shell';
  // Flag the code view at the document root so the header's active tab (a sibling
  // of the reader, not a descendant) can match the code surface color.
  document.documentElement.dataset.codeView = 'true';
  const text = state.text || '';
  lastSentSourceText = text;
  // Past the gate the document-sized textarea is the whole cost of the view
  // (seconds per keystroke, ~135 ms per restyle); the editor path draws its own
  // caret instead and no editable element ever holds the document.
  const useEditor = text.length > CODE_EDITOR_MAX_TEXTAREA_CHARS;
  app.innerHTML = `
    <div class="code-view${useEditor ? ' code-view-editor' : ''}" data-language="${escapeAttr(state.displayName || '')}">
      <div class="code-view-doc">
        <pre class="code-view-highlight" aria-hidden="true"><code class="language-${escapeAttr(state.language || '')}"></code></pre>
        ${useEditor ? '' : '<textarea class="code-view-input" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"></textarea>'}
      </div>
    </div>`;
  // The code view always carries a rail, whatever the reading view's setting.
  setMinimapMarkup(documentMinimapMarkup());
  const textarea = app.querySelector('.code-view-input');
  const highlight = app.querySelector('.code-view-highlight');
  const code = highlight.querySelector('code');
  if (useEditor) {
    const inner = computeColorInner(state.html, text);
    codeViewColorHtml = inner;
    cvSetupEditor(code, app.querySelector('.code-view-doc'), text, inner);
  } else {
    textarea.value = text;
    setCodeViewColorLines(code, state.html, text);
  }
  sizeLineNumberGutter(app.querySelector('.code-view'), useEditor ? cvEd.lines.length : text.split('\n').length);
  if (textarea) {
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
      // Patch only the changed lines into the color layer and gutter. A within-line
      // edit splices chars into the existing spans so the line never drops to plain
      // text; the debounced re-highlight corrects boundary shifts after.
      updateCodeViewLinesIncremental(code, prevText, codeViewText);
      const path = activeDocumentPath();
      if (path) setDirtyState(path, true);
      scheduleSourceUpdate();
    });
  }
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
  // the code view already held (in-place re-render). The editor path focused
  // its own input in cvSetupEditor.
  if (textarea) {
    textarea.setSelectionRange(0, 0);
    textarea.focus({ preventScroll: true });
  }
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
    const row = cvEd
      ? cvLineEl(Math.min(lineIndex, cvEd.lines.length - 1))
      : code.children[Math.min(lineIndex, code.children.length - 1)];
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

// Enter the code view by fetching the payload the host staged. The colored source
// is megabytes, and handed over as script it had to cross the webview's process
// boundary — seconds on a large file — so the host sends only this URL. A failure
// leaves the reading view up rather than a half-built editor.
window.leafLoadCodeView = (url) => {
  fetch(url)
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((state) => window.leafShowCodeView(state))
    .catch((error) => {
      console.error('code view: could not load the source payload', error);
      clearReaderLoading();
    });
};

// Enter the code view: the host sends the highlighted source, the exact buffer
// text, the language, and the dirty state.
window.leafShowCodeView = (state) => {
  runViewRender(state && state.html, () => {
    // The map was held until now (see setReaderView). Dropping it here means the
    // reading view it was covering is replaced in the same breath rather than
    // revealed, laid out, and thrown away.
    if (graphExitPending) {
      graphExitPending = false;
      closeGraphView();
    }
    codeViewActive = true;
    codeViewText = (state && state.text) || '';
    renderCodeView(state || {});
    const path = activeDocumentPath();
    if (path) setDirtyState(path, !!(state && state.dirty));
    updateEditingChrome();
  });
};

// Refresh the code view's color layer and dirty state after a debounced
// re-highlight. Only recolor when the buffer still matches what was sent, or
// stale HTML would hide newer keystrokes.
window.leafSourceUpdated = (state) => {
  if (!codeViewActive || !state) return;
  // Null html: the host skipped the re-highlight (buffer too large to color
  // between keystrokes), so keep the plain-text patch the edited lines already have.
  if (state.html != null && (lastSentSourceText === null || codeViewText === lastSentSourceText)) {
    const code = app.querySelector('.code-view-highlight code');
    if (code) recolorCodeViewLines(code, state.html, codeViewText);
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

