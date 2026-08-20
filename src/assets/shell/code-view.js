// ---- Editing: code view + save -------------------------------------------
// Source-of-truth is in Rust: the host owns the buffer and the file. The JS drives the code view — Monaco, loaded on first entry — tracks unsaved edits, and relays intent. Its mutable state is declared earlier, above the subscriptions that fire renderState() synchronously on load.

function isDocumentDirty(path) {
  return !!(path && dirtyByPath.get(path));
}

// Reflect a document's dirty state into the tab dot and, when it is the active document, the Save button — without forcing a full re-render.
function setDirtyState(path, dirty) {
  if (!path) return;
  const next = !!dirty;
  // Only touch the DOM when the answer actually changed. Every code-view keystroke calls this, and the chrome refresh below ends in refitAppBar(), which measures the tab strip and so forces a layout of the whole page — 141 ms per character on a 4 MB source. After the first character the document is already dirty and there is nothing to restate.
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

// Show/hide and style the floating bar for the active document: which view is on, and whether there is anything to save or undo.
function updateEditingChrome() {
  const path = activeDocumentPath();
  const hasDocument = !!path;
  renderReaderToolbar(hasDocument);
  if (saveButton) {
    // Nothing to save, nothing shown: the green "Save" button appears only when the active document has unsaved edits.
    saveButton.hidden = !(hasDocument && isDocumentDirty(path));
  }
  if (undoButton) {
    // Undo appears whenever the document has reading-view edits since the last successful save.
    undoButton.hidden = !(hasDocument && undoableByPath.get(path) === true);
  }
  if (redoButton) {
    // Redo appears only where an undo has left a version standing, so the pair is never a button that would do nothing.
    redoButton.hidden = !(hasDocument && redoableByPath.get(path) === true);
  }
  // Save/Undo/Redo/code-view visibility changes the action row's width — refold.
  refitAppBar();
}

// Ask the host to revert the most recent reading-view edit. Words still under the caret are committed first, so undo pressed mid-typing takes back what was just typed rather than the edit before it. The host pops its snapshot, re-renders, and resyncs the chrome, so undoing the last edit hides both buttons.
function undoLastEdit() {
  const path = activeDocumentPath();
  if (!path) return;
  commitActiveEditingBlock();
  afterActiveEditCommits(() => {
    if (activeDocumentPath() !== path || undoableByPath.get(path) !== true) return;
    send({ command: 'undoEdit' });
  });
}

// The same trip in the other direction. Words under the caret are committed first here too, because a commit is a fresh edit and ends the future.
function redoLastEdit() {
  const path = activeDocumentPath();
  if (!path) return;
  commitActiveEditingBlock();
  afterActiveEditCommits(() => {
    if (activeDocumentPath() !== path || redoableByPath.get(path) !== true) return;
    send({ command: 'redoEdit' });
  });
}

// Do `act` once every editor's commit is on the wire. A field box settles its own text through a timeout registered by the blur above, and so ahead of this one — without the wait, Save would write the file before the typed field reached the buffer.
function afterActiveEditCommits(act) {
  window.setTimeout(act, 0);
}

// The last buffer text the host was given: what the next splice is measured against, and what proves the two copies still agree.
let lastSentSourceText = null;

// Hand the host the edit rather than the buffer.
//
// Shipping the whole text on each debounce cost 243 ms of IPC per typing pause on a 4 MB file — the string is marshalled across the process boundary and parsed again on the far side, both ways. The edit itself is a handful of characters, so send those: the common prefix and suffix of the last text the host was given and the current one bracket everything that changed.
//
// Offsets are UTF-16 code units, which is what JS string indices are; the host converts against its own copy. `length` lets it prove the two buffers still agree — if they ever drift, a splice would corrupt the file silently, so a mismatch triggers a full resend instead.
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

// The editor holds the buffer; read it back before anything acts on the text.
function syncCodeViewText() {
  if (monacoEditor) codeViewText = monacoEditor.getValue();
}

function sendSourceUpdate() {
  syncCodeViewText();
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

// Push the latest buffer to the host now, canceling any pending debounce, so a save writes exactly what is on screen.
function flushSourceUpdate() {
  if (!codeViewActive) return;
  if (sourceUpdateTimer) {
    clearTimeout(sourceUpdateTimer);
    sourceUpdateTimer = 0;
  }
  sendSourceUpdate();
}

// The host's copy disagreed with ours, so stop splicing and send the whole buffer. Nothing should reach this; it exists so that if anything does, the file is rewritten from what is on screen rather than from a buffer that has drifted.
window.leafResyncSource = () => {
  if (!codeViewActive) return;
  syncCodeViewText();
  lastSentSourceText = codeViewText;
  send({ command: 'updateSource', text: codeViewText });
};

// Write the words on screen. Whatever is being typed in commits first — the dirty state is read after that, so a save whose only edit is the one still under the caret goes through instead of refusing.
function saveActiveDocument() {
  const path = activeDocumentPath();
  if (!path) return;
  commitActiveEditingBlock();
  afterActiveEditCommits(() => {
    if (activeDocumentPath() !== path || !isDocumentDirty(path)) return;
    flushSourceUpdate();
    send({ command: 'saveDocument' });
  });
}

// How far down the active view is scrolled, as a 0..1 fraction of its scrollable range. Approximate by design — the two views wrap differently — but it keeps "top is top" and "middle is middle" across the toggle. Monaco scrolls itself and the shell around it doesn't, so in the code view only Monaco knows.
function viewScrollFraction() {
  if (codeViewActive && monacoEditor) {
    const scrollable = monacoEditor.getScrollHeight() - monacoEditor.getLayoutInfo().height;
    if (scrollable <= 0) return 0;
    return Math.min(1, Math.max(0, monacoEditor.getScrollTop() / scrollable));
  }
  const scrollable = app.scrollHeight - app.clientHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, app.scrollTop / scrollable));
}

// Where the next source editor lands, as a 0..1 fraction of its scrollable range. `null` is no answer and `0` is the top, so a first source view stays at the top while a return to the top goes there. Consumed by the next editor built.
let pendingCodeViewFraction = null;
// The document the live editor holds, so a position taken off it before it is thrown away is never spent on somebody else's file.
let monacoEditorPath = null;

// The fraction the next source editor should land at, decided while the editor it replaces is still there to ask. The host sends one for a tab coming back or a launch; an in-place rebuild (the file changing on disk, a save, a field edit, a block move) deliberately sends none, so the editor being replaced is asked instead — and only for its own document, or a switch to a source tab nobody has ever scrolled would land at the place in the file it came from.
function codeViewLandingFraction(state) {
  if (state && typeof state.scrollFraction === 'number') return state.scrollFraction;
  if (!monacoEditor || monacoEditorPath == null || monacoEditorPath !== activeDocumentPath()) return null;
  return viewScrollFraction();
}

let sessionPlaceTimer = 0;
function scheduleSessionPlace() {
  clearTimeout(sessionPlaceTimer);
  sessionPlaceTimer = setTimeout(() => saveSessionPlace(), 240);
}
function saveSessionPlace() {
  if (!activeDocumentPath()) return;
  send({
    command: 'saveSessionPlace',
    scroll_anchor: codeViewActive ? null : currentScrollAnchor(),
    code_scroll: codeViewActive ? viewScrollFraction() : null,
  });
}

// Whether the active view sits at its very top. Same split as above: asking the shell in the code view always says yes, which sends every toggle back to the top.
function viewAtTop() {
  if (codeViewActive && monacoEditor) return monacoEditor.getScrollTop() <= 1;
  return app.scrollTop <= 1;
}

// The source byte offset of the block at the top of the reading viewport, or null when there's nothing to anchor to. Blocks carry their source range in data-src-start (attached for every Markdown block, stamped inline on TEI blocks), so the topmost visible block names where the reader is in the source exactly — unlike the whole-document height fraction.
function topReadingBlockSourceOffset() {
  const anchorEl = resolveReaderAnchorElement(captureReaderScrollAnchor());
  const block = anchorEl && anchorEl.closest ? anchorEl.closest('[data-src-start]') : null;
  if (!block) return null;
  const start = Number(block.dataset.srcStart);
  return Number.isFinite(start) ? start : null;
}

// The 0-based source line containing a UTF-8 byte offset. Block source ranges are byte offsets (pulldown-cmark / roxmltree), but the buffer is a UTF-16 JS string, so walk code points accumulating byte lengths until the offset is reached, counting the newlines passed. Only scans up to the offset.
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

// The 0-based index of the code view's top visible line, by binary search over the in-order color lines.
function topVisibleCodeLineIndex() {
  if (!monacoEditor) return null;
  const ranges = monacoEditor.getVisibleRanges();
  return ranges && ranges.length ? ranges[0].startLineNumber - 1 : null;
}

// The handoff record for `path`, started fresh when the document changes.
function viewHandoffFor(path) {
  if (!viewHandoff || viewHandoff.path !== path) {
    viewHandoff = {
      path,
      // Where each view sat when the toggle left it.
      readerScrollTop: null,
      codeScrollTop: null,
      // And where the toggle put it. Still equal means nobody scrolled it since.
      readerLanded: null,
      codeLanded: null,
      // Armed by the toggle, consumed by the landing render.
      restoreExact: false,
    };
  }
  return viewHandoff;
}

// A saved position is spent once the text under it moves.
function forgetViewHandoff() {
  viewHandoff = null;
}

// Read and clear the arm flag: one landing per toggle, so a live reload or a tab switch can't reuse it.
function takeExactViewRestore(path) {
  const handoff = viewHandoff && viewHandoff.path === path ? viewHandoff : null;
  if (!handoff || !handoff.restoreExact) return null;
  handoff.restoreExact = false;
  return handoff;
}

// Whether a view is still where the toggle put it. 1px of slack: the landing clamps and rounds, so the readback is not always the value written.
function viewStillLanded(now, landed) {
  return now != null && landed != null && Math.abs(now - landed) <= 1;
}

// Note where the reading view came to rest, whichever landing put it there.
function recordReaderLanded() {
  const path = activeDocumentPath();
  if (path) viewHandoffFor(path).readerLanded = app.scrollTop;
}

// Scroll the reading view so the block containing `srcOffset` sits at the top edge: the deterministic landing for leaving the code view. Falls back to no-op (caller keeps its own fallback) when the block map is missing.
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

// Swap between the rendered page and its source, carrying the reader's place across. Called from the toolbar's view group — see setReaderView.
function toggleCodeView() {
    const path = activeDocumentPath();
    if (!path) return;
    const handoff = viewHandoffFor(path);
    // Carry the current position across the toggle; the destination view's render consumes it and lands at the same relative spot.
    pendingViewScrollFraction = viewScrollFraction();
    // At the very top, land flush at the top of the other view — don't align the first block below the edge, which reads as a stray scroll-down.
    pendingViewAtTop = viewAtTop();
    // Entering the code view: remember which source line the reader is on, so it opens there. Leaving: remember which line the code view is on, so the reading view lands on that block. The fraction stays as the fallback. Either way, note where this view is now, and whether the view we're going back to can simply have its own last pixel returned — see viewHandoffFor.
    if (codeViewActive) {
      pendingCodeViewSrcOffset = null;
      handoff.codeScrollTop = monacoEditor ? monacoEditor.getScrollTop() : null;
      handoff.restoreExact =
        handoff.readerScrollTop != null && viewStillLanded(handoff.codeScrollTop, handoff.codeLanded);
      const lineIndex = topVisibleCodeLineIndex();
      syncCodeViewText();
      pendingReadingSrcOffset = lineIndex == null ? null : byteOffsetAtLineIndex(codeViewText, lineIndex);
    } else {
      pendingReadingSrcOffset = null;
      handoff.readerScrollTop = graphViewOpen ? null : app.scrollTop;
      handoff.restoreExact =
        handoff.codeScrollTop != null && viewStillLanded(handoff.readerScrollTop, handoff.readerLanded);
      // Coming from the map there is no reading position to carry, and asking for one measures a document that is not on screen.
      pendingCodeViewSrcOffset = graphViewOpen ? null : topReadingBlockSourceOffset();
    }
    // Either direction re-renders the whole view (highlighting a big source or rebuilding a big document is slow), so arm the spinner for the wait.
    beginReaderLoading();
    send({ command: codeViewActive ? 'exitCodeView' : 'enterCodeView' });
  }
if (saveButton) {
  saveButton.addEventListener('click', saveActiveDocument);
}
if (undoButton) {
  undoButton.addEventListener('click', undoLastEdit);
}
if (redoButton) {
  redoButton.addEventListener('click', redoLastEdit);
}
// Ctrl/Cmd+S saves the active document. Not gated on the dirty state: typing that has not been clicked out of yet is not dirty, and the save is what commits it — saveActiveDocument decides after that.
window.addEventListener('keydown', (event) => {
  if (!isSaveKey(event)) return;
  if (!activeDocumentPath()) return;
  event.preventDefault();
  saveActiveDocument();
});

// The save shortcut, named once: a field box swallows every other key and has to let this one out.
function isSaveKey(event) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S');
}
// The block a keystroke landed in, or null. A cell of a table is a surface of its own, so it is asked before the table around it — otherwise typing in a cell reads as the table's and the press steps back a committed edit instead.
function editableBlockAt(target) {
  return target && target.closest
    ? target.closest('td[data-cell-start].leaf-editable, [data-src-start].leaf-editable')
    : null;
}

// Whether the surface under the keystroke keeps an undo of its own. Monaco and the app's own fields do. A block does not: its typing is taken back in groups a person can use, and the web view's own group is one letter.
function nativeUndoOwnsKey(target) {
  if (!isEditableMouseTarget(target)) return false;
  if (codeViewActive) return true;
  return !editableBlockAt(target);
}

// Ctrl/Cmd+Z takes back one group of the typing in the block under the caret, and once that block's groups are spent one committed edit.
window.addEventListener('keydown', (event) => {
  const undoKey =
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'z' || event.key === 'Z');
  if (!undoKey) return;
  if (nativeUndoOwnsKey(event.target)) return;
  const block = editableBlockAt(event.target);
  if (block) {
    // The web view's letter-at-a-time undo never runs inside a block, whether or not there is a group left to take back.
    event.preventDefault();
    if (stepTypingBack(block)) return;
  }
  // Ahead of the line below, which ends the keystroke unless the open document has an edit of its own — and a file deleted from the pane usually is not that document.
  if (undoableDelete) {
    event.preventDefault();
    undoLastDelete();
    return;
  }
  const path = activeDocumentPath();
  if (!path || undoableByPath.get(path) !== true) return;
  event.preventDefault();
  undoLastEdit();
});

// Ctrl+Y and Ctrl+Shift+Z walk the same groups forward again, up to the newest words the reader typed, and once that block's groups are spent one committed edit — the mirror of the key above it.
window.addEventListener('keydown', (event) => {
  const redoKey =
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    (event.key === 'y' || event.key === 'Y' || (event.shiftKey && (event.key === 'z' || event.key === 'Z')));
  if (!redoKey) return;
  if (nativeUndoOwnsKey(event.target)) return;
  const block = editableBlockAt(event.target);
  if (block) {
    // The web view's own forward step never runs inside a block, whether or not there is a group left to walk to.
    event.preventDefault();
    if (stepTypingForward(block)) return;
  }
  const path = activeDocumentPath();
  if (!path || redoableByPath.get(path) !== true) return;
  event.preventDefault();
  redoLastEdit();
});

// The raw-source code view is Monaco (the VS Code editor): it owns line wrapping, virtualized rendering of huge files, and its own colored minimap. The vendored bundle loads lazily on first entry; edits relay back to the host as source splices. Monaco scrolls internally, so the reader shell does not scroll here and carries no rail.

// Load the vendored Monaco bundle once, over the same leaf-asset channel the other runtimes use (stylesheet linked, script injected). Monaco is handed an inert worker stub so it never spawns a background worker — nor falls back to evaluating worker code on the main thread — because colorizing and the minimap are main-thread already and nothing we use needs one, which keeps the app's security policy untouched.
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

// JSON's colors. Monaco bundles no JSON colorer — its own is inside the language service, which wants a worker — so this is a Monarch grammar, which is in the editor core and so costs nothing in the vendored bundle and needs no worker.
//
// The token names are the bundled YAML grammar's, not JSON's own: both formats are keys and values in the same view under the same theme, so a key that is one color in YAML and another in JSON reads as a bug.
//
// `//` and `/* */` are not JSON and are colored anyway. A file carrying one is the file whose reading view refuses to parse, so the code view is where its author lands.
function jsonMonarchLanguage() {
  return {
    defaultToken: '',
    tokenizer: {
      root: [
        // A key is only a key because of the colon after it, so the lookahead is what tells one from a value — and why it has to be tried first.
        [/"(?:[^"\\]|\\.)*"(?=[ \t]*:)/, 'type'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        // A quote with no closer takes the rest of its line, which is the quickest way to see where the closer went missing.
        [/".*$/, 'string'],
        [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}[\],:]/, 'delimiter'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  };
}

// Monaco keeps grammars globally, not per editor, so re-entering the code view must not hand it a second one.
let jsonColoringRegistered = false;

// Monaco itself only loads on the first entry to the code view, so this is the earliest there is anything to register the grammar with.
function registerJsonColoringOnce(monaco) {
  if (jsonColoringRegistered) return;
  jsonColoringRegistered = true;
  const known = monaco.languages.getLanguages().some((language) => language.id === 'json');
  if (!known) monaco.languages.register({ id: 'json', extensions: ['.json'], aliases: ['JSON', 'json'] });
  monaco.languages.setMonarchTokensProvider('json', jsonMonarchLanguage());
}

// ---- Colors: a square of itself before every color in the source --------------
// Monaco already draws the square and already has it switched on; what it has no answer for is where the colors are, because its own scanner sits inside the language service, which wants a worker. So the scan is written here, for the same reason the JSON grammar above is.

// Hue units, as a fraction of the circle.
const LEAF_HUE_UNITS = { deg: 360, grad: 400, rad: 2 * Math.PI, turn: 1 };

const leafClamp01 = (n) => Math.min(1, Math.max(0, n));

// One argument as a number and its unit, or null when it is not a number at all — a var(), a keyword, an empty slot.
function leafColorNumber(part) {
  const hit = /^([-+]?(?:\d+\.?\d*|\.\d+))(%|deg|grad|rad|turn)?$/.exec(part);
  return hit ? { value: Number.parseFloat(hit[1]), unit: hit[2] || '' } : null;
}

// A hex run without its '#', as an RGBA in 0..1. Null unless it is one of the four lengths — and null for a short run of digits alone, because `#123` is an issue reference in this app's own reading of a document. Every short form with a letter in it is unaffected.
function leafHexColor(digits) {
  const len = digits.length;
  if (len !== 3 && len !== 4 && len !== 6 && len !== 8) return null;
  if (len <= 4 && !/[a-f]/i.test(digits)) return null;
  const wide = len <= 4 ? digits.replace(/./g, (d) => d + d) : digits;
  const at = (i) => Number.parseInt(wide.slice(i * 2, i * 2 + 2), 16) / 255;
  return { red: at(0), green: at(1), blue: at(2), alpha: wide.length === 8 ? at(3) : 1 };
}

// Hue in turns, saturation and lightness in 0..1, to RGB in 0..1.
function leafHslToRgb(hue, sat, light) {
  const chan = (n) => {
    const k = (n + hue * 12) % 12;
    return light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { red: leafClamp01(chan(0)), green: leafClamp01(chan(8)), blue: leafClamp01(chan(4)) };
}

// What is inside an rgb()/rgba()/hsl()/hsla() call, as an RGBA in 0..1. Commas, spaces, or a slash before the alpha — modern CSS writes it either way. Null unless it is three or four numbers carrying units that belong there.
function leafFunctionColor(name, body) {
  const parts = body
    .trim()
    .split(/\s*[,/]\s*|\s+/)
    .filter(Boolean)
    .map(leafColorNumber);
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !part)) return null;
  const alphaPart = parts[3];
  if (alphaPart && alphaPart.unit && alphaPart.unit !== '%') return null;
  const alpha = alphaPart
    ? leafClamp01(alphaPart.unit === '%' ? alphaPart.value / 100 : alphaPart.value)
    : 1;
  const percentOrBare = (part) => !part.unit || part.unit === '%';
  if (name === 'rgb' || name === 'rgba') {
    if (!parts.slice(0, 3).every(percentOrBare)) return null;
    const chan = (part) => leafClamp01(part.unit === '%' ? part.value / 100 : part.value / 255);
    return { red: chan(parts[0]), green: chan(parts[1]), blue: chan(parts[2]), alpha };
  }
  const circle = LEAF_HUE_UNITS[parts[0].unit || 'deg'];
  if (!circle || !percentOrBare(parts[1]) || !percentOrBare(parts[2])) return null;
  // A hue is a bearing, so it wraps rather than clamping — and stays positive through the wrap.
  const hue = (((parts[0].value / circle) % 1) + 1) % 1;
  const rgb = leafHslToRgb(hue, leafClamp01(parts[1].value / 100), leafClamp01(parts[2].value / 100));
  return { ...rgb, alpha };
}

// Every color in `text`, each as a half-open offset range and an RGBA in 0..1. A plain function over a string, so it can be proved with no editor in front of it; the provider below is the thin wrapper that turns the offsets into the editor's own positions.
//
// A word that is a color name draws nothing. Markdown is this app's main format, and "red", "gold", "tan" and "orange" are ordinary English — a square beside every one of them in prose is noise nobody can turn off. The editor's own scanner draws the same line.
function leafColorRanges(text) {
  const found = [];
  const pattern = /#[0-9a-fA-F]+|\b(rgba?|hsla?)\(([^()]*)\)/g;
  let hit;
  while ((hit = pattern.exec(text))) {
    const start = hit.index;
    const end = start + hit[0].length;
    const before = start > 0 ? text[start - 1] : '';
    const isHex = hit[0][0] === '#';
    // A run another word runs into belongs to that word: an address ending #abcdef, a second '#', a longer run of digits, `my-rgb(1,2,3)`.
    if (isHex && (/[\w#]/.test(before) || /\w/.test(text[end] || ''))) continue;
    if (!isHex && /[-\w]/.test(before)) continue;
    const color = isHex
      ? leafHexColor(hit[0].slice(1))
      : leafFunctionColor(hit[1].toLowerCase(), hit[2]);
    if (color) found.push({ start, end, ...color });
  }
  return found;
}

// Monaco keeps providers globally, not per editor, so re-entering the code view must not hand it a second one.
let colorProvidersRegistered = false;

// Registered for every language the code view uses, not just one: a hex in a Markdown note, a YAML theme file, a JSON settings file or an XML attribute is a color the same way it is anywhere else — and the eleven theme families this repo edits are Markdown tables of hex.
function registerColorProvidersOnce(monaco) {
  if (colorProvidersRegistered) return;
  colorProvidersRegistered = true;
  const provider = {
    provideDocumentColors(model) {
      return leafColorRanges(model.getValue()).map((found) => {
        const from = model.getPositionAt(found.start);
        const to = model.getPositionAt(found.end);
        return {
          range: {
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
          },
          color: { red: found.red, green: found.green, blue: found.blue, alpha: found.alpha },
        };
      });
    },
    // The square is a mark, not a control: an empty list is nothing for the editor to write a value back through, in a view that stands behind a padlock. A reader who wants to change a color types it.
    provideColorPresentations() {
      return [];
    },
  };
  ['markdown', 'xml', 'yaml', 'json', 'plaintext'].forEach((id) =>
    monaco.languages.registerColorProvider(id, provider)
  );
}

// The Monaco language id for a code-view payload. Markdown, XML and YAML are bundled colorizers and JSON is the grammar above; anything else falls back to plain text, which still edits and minimaps.
function monacoLanguageFor(state) {
  const lang = (state.language || '').toLowerCase();
  if (lang.includes('xml') || lang === 'tei') return 'xml';
  if (lang.includes('yaml') || lang === 'yml') return 'yaml';
  if (lang.includes('json')) return 'json';
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
// Monaco can't read our CSS variables, so we translate the active theme's colors into a Monaco theme and hand it over — the same palette the reading view uses, so the code view and its minimap track every theme and light/dark change.

// Resolve any CSS color (hex, rgb(a), or a var chain) to hex WITHOUT '#', via a throwaway probe — the trick reportWindowChrome already uses. Six digits, or eight when the color carries alpha.
function leafResolveColor(value) {
  if (!value) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  appSurface.appendChild(probe);
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

// Build and register the Monaco theme for the current appearance from our palette, returning its name. Monaco's rule colors are hex without '#'; its UI colors take '#rrggbb'/'#rrggbbaa'.
function defineLeafMonacoTheme(monaco) {
  const dark = currentAppearance() === 'dark';
  const t = leafThemeToken;
  const fg = t('--lt-syntax-foreground') || (dark ? 'd4d4d4' : '2b2b2b');
  const rule = (token, color, fontStyle) =>
    color ? { token, foreground: color, ...(fontStyle ? { fontStyle } : {}) } : null;
  // Monaco's own Markdown grammar: headings and list markers are `keyword`, bold `strong`, italic `emphasis`, inline/fenced code `variable`(`.source`), links `string.link`, blockquotes/comments `comment`, rules `meta.separator`, raw HTML `tag`/`attribute`. The plain names also cover XML/YAML.
  const rules = [
    rule('', fg),
    rule('keyword', t('--lt-syntax-keyword'), 'bold'),
    rule('strong', fg, 'bold'),
    rule('emphasis', fg, 'italic'),
    rule('variable', t('--lt-syntax-string')),
    rule('variable.source', t('--lt-syntax-string')),
    rule('string', t('--lt-syntax-string')),
    rule('string.link', t('--lt-markdown-link')),
    rule('comment', t('--lt-syntax-comment'), 'italic'),
    rule('meta.separator', t('--lt-syntax-punctuation')),
    rule('tag', t('--lt-syntax-function')),
    rule('attribute.name', t('--lt-syntax-function')),
    rule('attribute.value', t('--lt-syntax-string')),
    rule('number', t('--lt-syntax-number')),
    rule('type', t('--lt-syntax-type')),
    rule('key', t('--lt-syntax-function')),
    rule('delimiter', t('--lt-syntax-punctuation')),
  ].filter(Boolean);
  const hash = (name) => {
    const v = t(name);
    return v ? '#' + v : null;
  };
  const colors = {
    'editor.background': hash('--lt-syntax-background'),
    'editor.foreground': '#' + fg,
    'editorLineNumber.foreground': hash('--lt-syntax-comment'),
    'editorLineNumber.activeForeground': '#' + fg,
    'editor.selectionBackground': hash('--lt-editor-code-selection-background'),
    'editorCursor.foreground': '#' + fg,
    // Nothing behind the map's glyphs: the rail is chrome and the shell's grain has to show between the lines (reading.css takes the fill off the editor's boxes for the same reason). Unset, this defaults to editor.background and the minimap pre-fills its canvas with it. Only the alpha matters — the glyphs are still antialiased against editor.background, so the map's text reads exactly as before.
    'minimap.background': '#00000000',
    // No scrolled-content shadow: Monaco lays it across the whole editor top, minimap included, and over the rail it reads as a smudge on the chrome.
    'scrollbar.shadow': '#00000000',
    'widget.shadow': '#00000000',
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

// Re-skin the live editor after a theme or appearance change, and re-fit the code font (per-family). No-op when the editor isn't up. Wired into leafTheme's subscription in theme.js, which fires on family, mode, and system flips.
function reskinMonacoForTheme() {
  if (!monacoEditor || !window.LeafMonaco) return;
  window.LeafMonaco.editor.setTheme(defineLeafMonacoTheme(window.LeafMonaco));
  const codeFont = getComputedStyle(document.documentElement).getPropertyValue('--code-font').trim();
  if (codeFont) monacoEditor.updateOptions({ fontFamily: codeFont });
  // A theme brings its own code font, so the wrap has to be re-fitted to it.
  refitCodeViewToFont();
  // And the pinned heading rows re-colored — see restyleStickyHeadings.
  restyleStickyHeadings();
}

// Re-fit the wrap column to whatever the code font is measuring right now.
//
// The wrap column is a count of characters; it is only a width once you know how wide a character is, and Monaco takes that measurement once — at the moment it is told which font to use. A theme swap points it at a face the web view has usually not finished loading yet, so what gets measured is the fallback standing in for it, and the fallback's width is not the width the text ends up drawn at. Too narrow a measurement and the wrap runs out under the minimap; too wide and it stops well short. Nothing else corrects it: a font arriving changes no geometry, so onDidLayoutChange never fires for it — which makes the wrap look like a property of the theme when it is really down to whether that theme's font had loaded yet.
//
// So: force the measurement again, then re-derive. The cache has to go first because it is keyed on the column number alone, and the same count against a different font reads as "nothing changed". Nothing here knows or asks which fonts exist, where they come from, or when they arrive — any face, from anywhere, is handled by having been re-measured.
function refitCodeViewToFont() {
  if (!monacoEditor || !window.LeafMonaco) return;
  window.LeafMonaco.editor.remeasureFonts();
  codeViewWrapColumn = 0;
  applyCodeViewWrapColumn();
}

// How far the last character stays clear of the rail's divider. Monaco has no right-padding option and its own 'on' wrap fills flush to the minimap's left edge, tucking the last characters under it — so the gap is bought back through the wrap column instead. This is the gap the owner asked for, and it is measured from the divider, not the minimap.
const CODE_VIEW_TEXT_DIVIDER_GAP_PX = 8;

// Which makes the gap from the minimap that plus however far the divider itself stands off the minimap — read from CSS rather than restated, so moving the divider (--cv-minimap-standoff) carries the text with it and the clearance above stays what it says it is. Converted to whole columns below.
function codeViewWrapRightGapPx() {
  const standoff = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--cv-minimap-standoff')
  );
  return CODE_VIEW_TEXT_DIVIDER_GAP_PX + (Number.isFinite(standoff) ? standoff : 0);
}

// Set the bounded wrap column so wrapped text stops codeViewWrapRightGapPx() short of the minimap, and publish the minimap's width to CSS. info.viewportColumn is Monaco's OWN natural wrap column ('on' would land there — flush to the minimap), so pulling a whole number of columns off it lands the wrap a deterministic distance short. Deriving the column from contentWidth by hand instead double-floors the pixel gap and drifts to ~1 column, leaving the text nearly touching the rail. The gap in columns is the pixel gap over the monospace char width, rounded up so it never comes out short. The minimap width goes to --cv-minimap-width because only Monaco knows it and the page frame (top divider, bottom stroke) has to stop at the minimap's left edge. Runs after create and on every layout change; only writes the column when it changed, so the updateOptions it makes doesn't loop back through onDidLayoutChange. That cache is the column number and nothing else, so anything changing what a column is WORTH — the code font — must clear it before calling here: refitCodeViewToFont.
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
// Once a file is long enough that the minimap has to scroll inside itself, Monaco stops placing the box at a straight fraction of the scroll and instead lines its top edge up with the minimap's own drawing: a whole number of minimap lines, plus the part-line the viewport happens to start on. That figure is never re-checked against the height of the rail, so at the very bottom of a long file the box's bottom edge lands a pixel or two below the editor's box — and the editor's own overflow:hidden cuts off whatever is down there. Monaco never notices, because its box is a plain translucent fill with nothing at its edges; ours has a border and rounded corners, so what goes missing is the bottom of the frame: the stroke vanishes and the two bottom corners square off. Hence bottom-only, and only on a file long enough to scroll the minimap — measured here at 1.5px over on a 76,000-line document.
//
// So pull it back in. What it moves by is the part of a minimap line that overflowed, under three pixels at any pixel ratio, so the box still reads as level with the text beside it. Nothing is re-derived: the rail's height and the box's own height are Monaco's numbers, read back off the elements it sized. A pixel clear of the bottom edge too, for the reason the right stroke keeps one (the .minimap-slider rule in reading.css). Fractional geometry: clientHeight and offsetHeight round, and the rail's height is not always whole.
const MINIMAP_SLIDER_RAIL_CLEARANCE_PX = 1;
function clampMinimapSliderToRail() {
  const rail = app.querySelector('.code-view-monaco .monaco-editor .minimap');
  const slider = rail && rail.querySelector('.minimap-slider');
  if (!slider) return;
  const railHeight = rail.getBoundingClientRect().height;
  if (!railHeight) return;
  const top = Number.parseFloat(slider.style.top);
  const limit =
    railHeight - slider.getBoundingClientRect().height - MINIMAP_SLIDER_RAIL_CLEARANCE_PX;
  if (!Number.isFinite(top) || top <= limit) return;
  slider.style.top = `${Math.max(0, limit)}px`;
}

// Monaco writes the offset to the slider's own `style`, so the mutation is the signal — no polling. Our correction trips it once more, sees the box inside, stops.
//
// But an observer only reports a *change*, and opening the code view already at the bottom positions the box in Monaco's first render — one write, nothing watching yet, so it stays cut off until a resize writes again. So check on the way in too: now, in case that render ran, and next frame in case it had not.
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
  window.requestAnimationFrame(clampMinimapSliderToRail);
}

// Room to leave above the first line and below the last one. Monaco puts line 1 flush against the top of its box and the last line flush against the bottom, and both of those edges are under .reader-edge-fade — the ~36px of page that dissolves to its own color where the document slides under the app bar and where it meets the card's stroke. Scrolled to either end there is nothing left to dissolve, so the wash lands on text that is meant to be read: the first line comes out half erased. The reading view never shows this because its page carries the same clearance as padding; this is that padding, inside the editor's own scroll height, so no line can ever sit in the wash.
//
// Both numbers are taken from the reading view rather than restated. The top gap is READER_CONTENT_TOP_GAP, measured from the shell's top edge, and the editor's box already starts below the app bar — so the bar's height comes off it. The bottom is what .document-body leaves: the content pad plus the room the floating toolbar needs, which is declared on <body> (a :has() rule), not the root, so it has to be read from there or it comes back 0 and the last line ends up under the bar.
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

// Point the live editor at the source's own padlock -- not the reading view's: unlocking the page you read is not consent to rewrite the file by hand.
function applyCodeViewReadOnly() {
  if (!monacoEditor) return;
  monacoEditor.updateOptions({ readOnly: !codeUnlocked });
}

// A refused keystroke otherwise looks like a broken editor: the cursor moves, the text does not, nothing says why. A held key refuses an edit per repeat, so the growl has a floor -- one message, not a stutter of them.
const LOCKED_GROWL_GAP_MS = 1500;
let lastLockedGrowl = 0;
function growlLockedForReading() {
  const now = Date.now();
  if (now - lastLockedGrowl < LOCKED_GROWL_GAP_MS) return;
  lastLockedGrowl = now;
  leafToast('The source is locked. Click the padlock in the toolbar to edit it.');
}

// Put a freshly built editor where the reader left off, in priority order: the exact pixel the toggle saved when nothing has moved under it, then the source line the toggle was reading, then a fraction — the host's for a tab coming back, or the one taken off the editor this render replaced. Called once the wrap column is set, because a fraction needs the scrollable range the reader will actually have rather than the one it was measured against.
function landNewCodeEditor(text) {
  const path = activeDocumentPath();
  const srcOffset = pendingCodeViewSrcOffset;
  pendingCodeViewSrcOffset = null;
  const fraction = pendingCodeViewFraction;
  pendingCodeViewFraction = null;
  const exact = takeExactViewRestore(path);
  if (exact) {
    // The reader never moved, so take the pixel back rather than re-derive it.
    monacoEditor.setScrollTop(exact.codeScrollTop);
  } else if (srcOffset != null && !pendingViewAtTop) {
    const lineIndex = lineIndexAtByteOffset(text, srcOffset);
    monacoEditor.revealLineNearTop(lineIndex + 1);
  } else if (fraction != null) {
    const scrollable = monacoEditor.getScrollHeight() - monacoEditor.getLayoutInfo().height;
    if (scrollable > 0) {
      monacoEditor.setScrollTop(Math.round(Math.min(1, Math.max(0, fraction)) * scrollable));
    }
  }
  // Read back where it settled, not what was asked for: the landing can clamp.
  viewHandoffFor(path).codeLanded = monacoEditor.getScrollTop();
  pendingViewAtTop = false;
  pendingViewScrollFraction = null;
}

// Create the editor in `container`, relay content changes to the source-splice path, and land where the reader was — see landNewCodeEditor. Skinned with the theme defineLeafMonacoTheme builds from our palette.
function createMonacoEditor(monaco, container, state, text) {
  const codeFont = getComputedStyle(document.documentElement)
    .getPropertyValue('--code-font')
    .trim();
  monacoEditor = monaco.editor.create(container, {
    value: text,
    language: monacoLanguageFor(state),
    theme: defineLeafMonacoTheme(monaco),
    // Bounded, not 'on': 'on' wraps flush to the minimap's left edge, tucking the last characters under its drop-shadow. applyCodeViewWrapColumn drives the column so the text stops short of the minimap with a right gap. The initial column is a placeholder — it is recomputed from the real width right after create, and on every layout change after.
    wordWrap: 'bounded',
    wordWrapColumn: 120,
    // The source's padlock. Read-only still scrolls, selects and copies -- it only refuses the typing, and a refusal growls (see growlLockedForReading) rather than passing in silence.
    readOnly: !codeUnlocked,
    // showSlider 'always' — the viewport box stays visible instead of only on hover.
    minimap: { enabled: true, showSlider: 'always' },
    automaticLayout: true,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    // Clears the top and bottom edge fades (and the floating toolbar) — see monacoEditorPadding.
    padding: monacoEditorPadding(),
    fontFamily: codeFont || undefined,
    fontSize: 14,
    renderWhitespace: 'none',
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
    // Not the editor's default Alt: one modifier has to mean add-a-cursor in both views, and the reading view's is Ctrl.
    multiCursorModifier: 'ctrlCmd',
    quickSuggestions: false,
    // No echoing back words already in the file: the only suggestions worth a popup are the ones the host answers (code-intel.js), on their triggers.
    wordBasedSuggestions: 'off',
    occurrencesHighlight: 'off',
    // No box/stroke around the line being edited.
    renderLineHighlight: 'none',
    // No scrollbars — the reader hides its own too; the wheel and the minimap do the scrolling. And no overview ruler, so the minimap is the rightmost thing. verticalScrollbarSize stays 0: it reserves space to the RIGHT of the minimap, so any value shoves the minimap off the window edge — the right gap is done through the wrap column instead (applyCodeViewWrapColumn).
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
  monacoEditorPath = activeDocumentPath();
  monacoChangeSub = monacoEditor.onDidChangeModelContent(() => {
    codeViewText = monacoEditor.getValue();
    const path = activeDocumentPath();
    if (path) setDirtyState(path, true);
    // The saved pixel pair described the old text; an edit moves what is under it.
    forgetViewHandoff();
    scheduleSourceUpdate();
  });
  monacoReadOnlySub = monacoEditor.onDidAttemptReadOnlyEdit(growlLockedForReading);
  monacoEditor.onDidScrollChange(() => scheduleSessionPlace());
  // Keep the wrap gap in step with the width: set it now, then on every relayout.
  monacoLayoutSub = monacoEditor.onDidLayoutChange(() => {
    applyCodeViewWrapColumn();
    // A moved edge can leave the box hanging without moving it, so no mutation fires.
    clampMinimapSliderToRail();
  });
  applyCodeViewWrapColumn();
  // And keep the viewport box off the bottom edge — see clampMinimapSliderToRail.
  watchMinimapSlider();
  // And in step with the font, which the width can't tell us about. `loadingdone` is the web view saying a batch of faces has finished loading — it fires for every font from every source, names none of them, and keeps firing for later batches, so a font this code has never heard of is covered by the same line. Whatever the editor was measuring before the face landed, it re-measures after.
  if (document.fonts && document.fonts.addEventListener) {
    monacoFontsDoneHandler = () => refitCodeViewToFont();
    document.fonts.addEventListener('loadingdone', monacoFontsDoneHandler);
  }
  landNewCodeEditor(text);
  // Typing help: completions, hover, and the broken-link pass (code-intel.js).
  setupCodeIntel(monaco);
  // And the heading trail pinned at the top edge (code-sticky.js).
  setupStickyHeadings(monaco);
  monacoEditor.focus();
}

// Dispose the editor and everything hung off it. Called on re-entry (a live reload rebuilds the view) and by renderState when leaving for the reading view.
function disposeMonacoEditor() {
  if (!monacoEditor) return;
  teardownCodeIntel();
  teardownStickyHeadings();
  if (monacoChangeSub) {
    monacoChangeSub.dispose();
    monacoChangeSub = null;
  }
  if (monacoLayoutSub) {
    monacoLayoutSub.dispose();
    monacoLayoutSub = null;
  }
  if (monacoReadOnlySub) {
    monacoReadOnlySub.dispose();
    monacoReadOnlySub = null;
  }
  if (monacoFontsDoneHandler) {
    document.fonts.removeEventListener('loadingdone', monacoFontsDoneHandler);
    monacoFontsDoneHandler = null;
  }
  if (monacoSliderObserver) {
    monacoSliderObserver.disconnect();
    monacoSliderObserver = null;
  }
  monacoEditor.dispose();
  monacoEditor = null;
  monacoEditorPath = null;
  codeViewWrapColumn = 0;
  // Drop the published minimap width so a stale value can't frame the reading view if it ever read the property.
  document.documentElement.style.removeProperty('--cv-minimap-width');
}

// Swap the reader shell over to Monaco for the active document's source. Monaco loads lazily; the spinner (armed by the toggle) stays up until the editor is on screen. Re-entering (live reload) disposes and rebuilds.
function renderCodeView(state) {
  // Asked before the editor it replaces is gone, because on an in-place rebuild that editor is the only thing that knows where the reader was — see codeViewLandingFraction.
  pendingCodeViewFraction = codeViewLandingFraction(state);
  disposeMonacoEditor();
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  // Same as a document render: what is in `app` goes, so the overlay has to be taken down rather than swept away underneath its own handlers.
  closeDiagramOverlay();
  readerAnchorBlocks = null;
  app.className = 'reader-shell has-document code-view-monaco-shell';
  // Flag the code view at the document root so the header's active tab (a sibling of the reader, not a descendant) can match the code surface color.
  document.documentElement.dataset.codeView = 'true';
  // Monaco draws its own minimap; the reader's rail does not belong here.
  setMinimapMarkup('');
  const text = state.text || '';
  lastSentSourceText = text;
  codeViewText = text;
  app.innerHTML = '<div class="code-view-monaco"></div>';
  const container = app.querySelector('.code-view-monaco');
  // runViewRender lowers the spinner right after this returns; re-raise on the next tick (only when a load is actually pending) so it stays up across the async load, then lower it once the editor is on screen.
  Promise.resolve().then(() => {
    if (codeViewActive && !window.LeafMonaco) beginReaderLoading();
  });
  loadMonacoOnce()
    .then((monaco) => {
      if (!codeViewActive || !container.isConnected) {
        clearReaderLoading();
        return;
      }
      registerJsonColoringOnce(monaco);
      registerColorProvidersOnce(monaco);
      createMonacoEditor(monaco, container, state, text);
      clearReaderLoading();
    })
    .catch((error) => {
      console.error('code view: Monaco failed to load', error);
      clearReaderLoading();
    });
}

// Enter the code view by fetching the payload the host staged. The source runs to megabytes, and handing it over as script means crossing the webview's process boundary — seconds on a large file — so the host sends only this URL. A failure leaves the reading view up rather than a half-built editor.
window.leafLoadCodeView = (url) => {
  fetch(url)
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((state) => window.leafShowCodeView(state))
    .catch((error) => {
      console.error('code view: could not load the source payload', error);
      clearReaderLoading();
    });
};

// Enter the code view: the host sends the exact buffer text, the language, and the dirty state. The source itself is the weight runViewRender is deciding about — building the editor on a few megabytes blocks, so the spinner goes up first.
window.leafShowCodeView = (state) => {
  runViewRender(state && state.text, () => {
    // The map was held until now (see setReaderView). Dropping it here means the reading view it was covering is replaced in the same breath rather than revealed, laid out, and thrown away.
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

// The host has taken a debounced edit: carry its dirty state through. Nothing about the text comes back — the editor colors what it holds.
window.leafSourceUpdated = (state) => {
  if (!codeViewActive || !state) return;
  const path = activeDocumentPath();
  if (path) setDirtyState(path, !!state.dirty);
};

// The host reports a save's outcome. On success the document is no longer dirty; on failure, keep the edits and surface the error.
window.leafSaved = (path, ok, error) => {
  if (ok) {
    // A save is the end of both directions of the history, in the buffer and so on the bar.
    undoableByPath.delete(path);
    redoableByPath.delete(path);
    setDirtyState(path, false);
  } else if (error) {
    window.leafShowOpenError(path, error);
  }
};
