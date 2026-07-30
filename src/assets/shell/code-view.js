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
  if (monacoEditor) {
    const ranges = monacoEditor.getVisibleRanges();
    return ranges && ranges.length ? ranges[0].startLineNumber - 1 : null;
  }
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

// The raw-source code view is Monaco (the VS Code editor): it owns line
// wrapping, virtualized rendering of huge files, and its own colored minimap.
// The vendored bundle loads lazily on first entry; edits relay back to the host
// as source splices (the same IPC the old editor used). Monaco scrolls
// internally, so the reader shell does not scroll here and carries no rail.

// Load the vendored Monaco bundle once, over the same leaf-asset channel the
// other runtimes use (stylesheet linked, script injected). Monaco is handed an
// inert worker stub so it never spawns a background worker — nor falls back to
// evaluating worker code on the main thread — because colorizing and the minimap
// are main-thread already and nothing we use needs one, which keeps the app's
// security policy untouched.
function loadMonacoOnce() {
  if (window.LeafMonaco) return Promise.resolve(window.LeafMonaco);
  if (monacoLoadPromise) return monacoLoadPromise;
  monacoLoadPromise = new Promise((resolve, reject) => {
    if (!self.MonacoEnvironment) {
      self.MonacoEnvironment = {
        getWorker() {
          return {
            postMessage() {},
            addEventListener() {},
            removeEventListener() {},
            terminate() {},
            onmessage: null,
            onerror: null,
          };
        },
      };
    }
    if (!document.getElementById('monacoStylesheet')) {
      const link = document.createElement('link');
      link.id = 'monacoStylesheet';
      link.rel = 'stylesheet';
      link.href = MONACO_CSS_URL;
      document.head.appendChild(link);
    }
    loadScriptOnce(MONACO_SCRIPT_URL)
      .then(() =>
        window.LeafMonaco
          ? resolve(window.LeafMonaco)
          : reject(new Error('Monaco loaded without exposing LeafMonaco'))
      )
      .catch(reject);
  });
  return monacoLoadPromise;
}

// The Monaco language id for a code-view payload. Only the colorizers bundled
// (Markdown, XML, YAML) are registered; anything else — including JSON until its
// grammar is bundled — falls back to plain text, which still edits and minimaps.
function monacoLanguageFor(state) {
  const lang = (state.language || '').toLowerCase();
  if (lang.includes('xml') || lang === 'tei') return 'xml';
  if (lang.includes('yaml') || lang === 'yml') return 'yaml';
  if (lang.includes('markdown') || lang === 'md' || lang === '') return 'markdown';
  return 'plaintext';
}

// Light or dark, from the appearance the theme bootstrap stamps on :root.
function currentAppearance() {
  return document.documentElement.getAttribute('data-leaf-appearance') === 'dark'
    ? 'dark'
    : 'light';
}

// ---- Theme: paint Monaco with our colors --------------------------------------
// Monaco can't read our CSS variables, so we translate the active theme's colors
// into a Monaco theme and hand it over — the same palette the reading view uses,
// so the code view and its minimap track every theme and light/dark change.

// Resolve any CSS color (hex, rgb(a), or a var chain) to hex WITHOUT '#', via a
// throwaway probe — the trick reportWindowChrome already uses. Six digits, or
// eight when the color carries alpha.
function leafResolveColor(value) {
  if (!value) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const parts = resolved.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  const hex = (n) => Math.round(Number(n)).toString(16).padStart(2, '0');
  const rgb = hex(parts[0]) + hex(parts[1]) + hex(parts[2]);
  return parts.length >= 4 && Number(parts[3]) < 1 ? rgb + hex(Number(parts[3]) * 255) : rgb;
}

// One theme token's resolved color (hex, no '#'), or null when unset.
function leafThemeToken(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? leafResolveColor(raw) : null;
}

// Build and register the Monaco theme for the current appearance from our
// palette, returning its name. Monaco's rule colors are hex without '#'; its UI
// colors take '#rrggbb'/'#rrggbbaa'.
function defineLeafMonacoTheme(monaco) {
  const dark = currentAppearance() === 'dark';
  const t = leafThemeToken;
  const fg = t('--leaf-syntax-foreground') || (dark ? 'd4d4d4' : '2b2b2b');
  const rule = (token, color, fontStyle) =>
    color ? { token, foreground: color, ...(fontStyle ? { fontStyle } : {}) } : null;
  // Monaco's own Markdown grammar: headings and list markers are `keyword`, bold
  // `strong`, italic `emphasis`, inline/fenced code `variable`(`.source`), links
  // `string.link`, blockquotes/comments `comment`, rules `meta.separator`, raw
  // HTML `tag`/`attribute`. The plain names also cover XML/YAML.
  const rules = [
    rule('', fg),
    rule('keyword', t('--leaf-syntax-keyword'), 'bold'),
    rule('strong', fg, 'bold'),
    rule('emphasis', fg, 'italic'),
    rule('variable', t('--leaf-syntax-string')),
    rule('variable.source', t('--leaf-syntax-string')),
    rule('string', t('--leaf-syntax-string')),
    rule('string.link', t('--leaf-markdown-link')),
    rule('comment', t('--leaf-syntax-comment'), 'italic'),
    rule('meta.separator', t('--leaf-syntax-punctuation')),
    rule('tag', t('--leaf-syntax-function')),
    rule('attribute.name', t('--leaf-syntax-function')),
    rule('attribute.value', t('--leaf-syntax-string')),
    rule('number', t('--leaf-syntax-number')),
    rule('type', t('--leaf-syntax-type')),
    rule('key', t('--leaf-syntax-function')),
    rule('delimiter', t('--leaf-syntax-punctuation')),
  ].filter(Boolean);
  const hash = (name) => {
    const v = t(name);
    return v ? '#' + v : null;
  };
  const colors = {
    'editor.background': hash('--leaf-syntax-background'),
    'editor.foreground': '#' + fg,
    'editorLineNumber.foreground': hash('--leaf-syntax-comment'),
    'editorLineNumber.activeForeground': '#' + fg,
    'editor.selectionBackground': hash('--leaf-editor-code-selection-background'),
    'editorCursor.foreground': '#' + fg,
    // Nothing behind the map's glyphs: the rail is chrome and the shell's grain has to
    // show between the lines (reading.css takes the fill off the editor's boxes for the
    // same reason). Unset, this defaults to editor.background and the minimap pre-fills
    // its canvas with it. Only the alpha matters — the glyphs are still antialiased
    // against editor.background, so the map's text reads exactly as before.
    'minimap.background': '#00000000',
    // No blue focus ring poking through the card's rounded corners.
    focusBorder: '#00000000',
    contrastBorder: '#00000000',
  };
  Object.keys(colors).forEach((key) => {
    if (colors[key] == null) delete colors[key];
  });
  const name = dark ? 'leaf-dark' : 'leaf-light';
  monaco.editor.defineTheme(name, { base: dark ? 'vs-dark' : 'vs', inherit: true, rules, colors });
  return name;
}

// Re-skin the live editor after a theme or appearance change, and re-fit the code
// font (per-family). No-op when the editor isn't up. Wired into leafTheme's
// subscription in theme.js, which fires on family, mode, and system flips.
function reskinMonacoForTheme() {
  if (!monacoEditor || !window.LeafMonaco) return;
  window.LeafMonaco.editor.setTheme(defineLeafMonacoTheme(window.LeafMonaco));
  const codeFont = getComputedStyle(document.documentElement).getPropertyValue('--code-font').trim();
  if (codeFont) monacoEditor.updateOptions({ fontFamily: codeFont });
  // A theme brings its own code font, so the wrap has to be re-fitted to it.
  refitCodeViewToFont();
}

// Re-fit the wrap column to whatever the code font is measuring right now.
//
// The wrap column is a count of characters; it is only a width once you know how
// wide a character is, and Monaco takes that measurement once — at the moment it is
// told which font to use. A theme swap points it at a face the web view has usually
// not finished loading yet, so what gets measured is the fallback standing in for it,
// and the fallback's width is not the width the text ends up drawn at. Too narrow a
// measurement and the wrap runs out under the minimap; too wide and it stops well
// short. Nothing corrected it afterwards: a font arriving changes no geometry, so
// onDidLayoutChange never fires for it. That is the whole of why the wrap looked like
// a property of the theme — it was really down to whether that theme's font happened
// to be loaded already, and how close the fallback was.
//
// So: force the measurement again, then re-derive. The cache has to go first because
// it is keyed on the column number alone, and the same count against a different font
// reads as "nothing changed". Nothing here knows or asks which fonts exist, where
// they come from, or when they arrive — any face, from anywhere, is handled by having
// been re-measured.
function refitCodeViewToFont() {
  if (!monacoEditor || !window.LeafMonaco) return;
  window.LeafMonaco.editor.remeasureFonts();
  codeViewWrapColumn = 0;
  applyCodeViewWrapColumn();
}

// How far the last character stays clear of the rail's divider. Monaco has no
// right-padding option and its own 'on' wrap fills flush to the minimap's left
// edge, tucking the last characters under it — so the gap is bought back through
// the wrap column instead. This is the gap the owner asked for, and it is measured
// from the divider, not the minimap.
const CODE_VIEW_TEXT_DIVIDER_GAP_PX = 8;

// Which makes the gap from the minimap that plus however far the divider itself
// stands off the minimap — read from CSS rather than restated, so moving the
// divider (--cv-minimap-standoff) carries the text with it and the clearance above
// stays what it says it is. Converted to whole columns below.
function codeViewWrapRightGapPx() {
  const standoff = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--cv-minimap-standoff')
  );
  return CODE_VIEW_TEXT_DIVIDER_GAP_PX + (Number.isFinite(standoff) ? standoff : 0);
}

// Set the bounded wrap column so wrapped text stops codeViewWrapRightGapPx()
// short of the minimap, and publish the minimap's width to CSS. info.viewportColumn
// is Monaco's OWN natural wrap column ('on' would land there — flush to the
// minimap), so pulling a whole number of columns off it lands the wrap a
// deterministic distance short. Deriving the column from contentWidth by hand
// instead double-floored the pixel gap and drifted to ~1 column, leaving the text
// nearly touching the rail. The gap in columns is the pixel gap over the monospace
// char width, rounded up so it never comes out short. The minimap width goes to
// --cv-minimap-width because only Monaco knows it and the page frame (top divider,
// bottom stroke) has to stop at the minimap's left edge. Runs after create and on
// every layout change; only writes the column when it changed, so the updateOptions
// it makes doesn't loop back through onDidLayoutChange. That cache is the column
// number and nothing else, so anything changing what a column is WORTH — the code
// font — must clear it before calling here: refitCodeViewToFont.
function applyCodeViewWrapColumn() {
  if (!monacoEditor || !window.LeafMonaco) return;
  const info = monacoEditor.getLayoutInfo();
  if (!info) return;
  if (info.minimap) {
    document.documentElement.style.setProperty(
      '--cv-minimap-width',
      `${info.minimap.minimapWidth}px`
    );
  }
  const font = monacoEditor.getOption(window.LeafMonaco.editor.EditorOption.fontInfo);
  const charWidth = font && font.typicalHalfwidthCharacterWidth;
  if (!charWidth || !info.viewportColumn) return;
  const gapColumns = Math.ceil(codeViewWrapRightGapPx() / charWidth);
  const column = Math.max(1, info.viewportColumn - gapColumns);
  if (column === codeViewWrapColumn) return;
  codeViewWrapColumn = column;
  monacoEditor.updateOptions({ wordWrapColumn: column });
}

// Keep the minimap's viewport box inside the rail.
//
// Once a file is long enough that the minimap has to scroll inside itself, Monaco
// stops placing the box at a straight fraction of the scroll and instead lines its
// top edge up with the minimap's own drawing: a whole number of minimap lines, plus
// the part-line the viewport happens to start on. That figure is never re-checked
// against the height of the rail, so at the very bottom of a long file the box's
// bottom edge lands a pixel or two below the editor's box — and the editor's own
// overflow:hidden cuts off whatever is down there. Monaco never notices, because its
// box is a plain translucent fill with nothing at its edges; ours has a border and
// rounded corners, so what goes missing is the bottom of the frame: the stroke
// vanishes and the two bottom corners square off. Hence bottom-only, and only on a
// file long enough to scroll the minimap — measured here at 1.5px over on a
// 76,000-line document.
//
// So pull it back in. What it moves by is the part of a minimap line that overflowed,
// under three pixels at any pixel ratio, so the box still reads as level with the
// text beside it. Nothing is re-derived: the rail's height and the box's own height
// are Monaco's numbers, read back off the elements it sized.
function clampMinimapSliderToRail() {
  const rail = app.querySelector('.code-view-monaco .monaco-editor .minimap');
  const slider = rail && rail.querySelector('.minimap-slider');
  if (!slider || !rail.clientHeight) return;
  const top = Number.parseFloat(slider.style.top);
  const limit = rail.clientHeight - slider.offsetHeight;
  if (!Number.isFinite(top) || top <= limit) return;
  slider.style.top = `${Math.max(0, limit)}px`;
}

// Watch for Monaco moving the box. It writes the offset to the slider's own `style`
// on every scroll, so the mutation is the signal — no polling, and no guessing where
// in the frame Monaco's render lands. Our own correction trips the observer once
// more; that pass sees the box already inside and does nothing, so it settles.
// Monaco builds the minimap during create(), so the rail is there to observe.
function watchMinimapSlider() {
  const rail = app.querySelector('.code-view-monaco .monaco-editor .minimap');
  if (!rail) return;
  monacoSliderObserver = new MutationObserver(clampMinimapSliderToRail);
  monacoSliderObserver.observe(rail, {
    attributes: true,
    attributeFilter: ['style'],
    subtree: true,
  });
  clampMinimapSliderToRail();
}

// Room to leave above the first line and below the last one. Monaco puts line 1
// flush against the top of its box and the last line flush against the bottom, and
// both of those edges are under .reader-edge-fade — the ~36px of page that
// dissolves to its own color where the document slides under the app bar and where
// it meets the card's stroke. Scrolled to either end there is nothing left to
// dissolve, so the wash lands on text that is meant to be read: the first line came
// out half erased. The reading view never shows this because its page carries the
// same clearance as padding; this is that padding, inside the editor's own scroll
// height, so no line can ever sit in the wash.
//
// Both numbers are taken from the reading view rather than restated. The top gap is
// READER_CONTENT_TOP_GAP, measured from the shell's top edge, and the editor's box
// already starts below the app bar — so the bar's height comes off it, exactly as
// --cv-pad-top did. The bottom is what .document-body leaves: the content pad plus
// the room the floating toolbar needs, which is declared on <body> (a :has() rule),
// not the root, so it has to be read from there or it comes back 0 and the last
// line ends up under the bar.
function monacoEditorPadding() {
  const px = (value) => Number.parseFloat(value) || 0;
  const root = getComputedStyle(document.documentElement);
  const barHeight = px(root.getPropertyValue('--app-bar-height'));
  const contentPad = px(root.getPropertyValue('--reader-content-pad'));
  const toolbarSpace = px(
    getComputedStyle(document.body).getPropertyValue('--reader-toolbar-space')
  );
  return {
    top: Math.max(0, READER_CONTENT_TOP_GAP - barHeight),
    bottom: contentPad + toolbarSpace,
  };
}

// Create the editor in `container`, relay content changes to the source-splice
// path, and land where the reader was if a source offset was carried across the
// toggle. Skinned for now with Monaco's own light/dark theme — the Leaf theme
// converter comes next.
function createMonacoEditor(monaco, container, state, text) {
  const codeFont = getComputedStyle(document.documentElement)
    .getPropertyValue('--code-font')
    .trim();
  monacoEditor = monaco.editor.create(container, {
    value: text,
    language: monacoLanguageFor(state),
    theme: defineLeafMonacoTheme(monaco),
    // Bounded, not 'on': 'on' wraps flush to the minimap's left edge, tucking the
    // last characters under its drop-shadow. applyCodeViewWrapColumn drives the
    // column so the text stops short of the minimap with a right gap. The initial
    // column is a placeholder — it is recomputed from the real width right after
    // create, and on every layout change after.
    wordWrap: 'bounded',
    wordWrapColumn: 120,
    // showSlider 'always' — the viewport box stays visible instead of only on hover.
    minimap: { enabled: true, showSlider: 'always' },
    automaticLayout: true,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    // Clears the top and bottom edge fades (and the floating toolbar) — see
    // monacoEditorPadding.
    padding: monacoEditorPadding(),
    fontFamily: codeFont || undefined,
    fontSize: 14,
    renderWhitespace: 'none',
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    quickSuggestions: false,
    occurrencesHighlight: 'off',
    // No box/stroke around the line being edited.
    renderLineHighlight: 'none',
    // No scrollbars — the reader hides its own too; the wheel and the minimap do
    // the scrolling. And no overview ruler, so the minimap is the rightmost thing.
    // verticalScrollbarSize stays 0: it reserves space to the RIGHT of the
    // minimap, so any value shoves the minimap off the window edge — the right gap
    // is done through the wrap column instead (applyCodeViewWrapColumn).
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'hidden',
      verticalScrollbarSize: 0,
      horizontalScrollbarSize: 0,
      handleMouseWheel: true,
    },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
  });
  monacoChangeSub = monacoEditor.onDidChangeModelContent(() => {
    codeViewText = monacoEditor.getValue();
    const path = activeDocumentPath();
    if (path) setDirtyState(path, true);
    scheduleSourceUpdate();
  });
  // Keep the wrap gap in step with the width: set it now, then on every relayout.
  monacoLayoutSub = monacoEditor.onDidLayoutChange(applyCodeViewWrapColumn);
  applyCodeViewWrapColumn();
  // And keep the viewport box off the bottom edge — see clampMinimapSliderToRail.
  watchMinimapSlider();
  // And in step with the font, which the width can't tell us about. `loadingdone` is
  // the web view saying a batch of faces has finished loading — it fires for every
  // font from every source, names none of them, and keeps firing for later batches,
  // so a font this code has never heard of is covered by the same line. Whatever the
  // editor was measuring before the face landed, it re-measures after.
  if (document.fonts && document.fonts.addEventListener) {
    monacoFontsDoneHandler = () => refitCodeViewToFont();
    document.fonts.addEventListener('loadingdone', monacoFontsDoneHandler);
  }
  const srcOffset = pendingCodeViewSrcOffset;
  pendingCodeViewSrcOffset = null;
  if (srcOffset != null && !pendingViewAtTop) {
    const lineIndex = lineIndexAtByteOffset(text, srcOffset);
    monacoEditor.revealLineNearTop(lineIndex + 1);
  }
  pendingViewAtTop = false;
  pendingViewScrollFraction = null;
  monacoEditor.focus();
}

// Swap the reader shell over to Monaco for the active document's source. Monaco
// loads lazily; the spinner (armed by the toggle) stays up until the editor is
// on screen. Re-entering (live reload) disposes and rebuilds.
function renderCodeView(state) {
  cvTeardownEditor();
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  readerAnchorBlocks = null;
  app.className = 'reader-shell has-document code-view-monaco-shell';
  // Flag the code view at the document root so the header's active tab (a sibling
  // of the reader, not a descendant) can match the code surface color.
  document.documentElement.dataset.codeView = 'true';
  // Monaco draws its own minimap; the reader's rail does not belong here.
  setMinimapMarkup('');
  const text = state.text || '';
  lastSentSourceText = text;
  codeViewText = text;
  app.innerHTML = '<div class="code-view-monaco"></div>';
  const container = app.querySelector('.code-view-monaco');
  // runViewRender lowers the spinner right after this returns; re-raise on the
  // next tick (only when a load is actually pending) so it stays up across the
  // async load, then lower it once the editor is on screen.
  Promise.resolve().then(() => {
    if (codeViewActive && !window.LeafMonaco) beginReaderLoading();
  });
  loadMonacoOnce()
    .then((monaco) => {
      if (!codeViewActive || !container.isConnected) {
        clearReaderLoading();
        return;
      }
      createMonacoEditor(monaco, container, state, text);
      clearReaderLoading();
    })
    .catch((error) => {
      console.error('code view: Monaco failed to load', error);
      clearReaderLoading();
    });
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

