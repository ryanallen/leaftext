// ---- Code editor: the large-document input path ----------------------------
// Editable text is what makes the code view slow, however it is spelled: a
// document-sized <textarea> costs seconds per keystroke on a 4 MB file, and a
// small one anywhere inside the document-tall scroller still taxes every
// page-wide restyle. The display-only color layer is essentially free. So past
// CODE_EDITOR_MAX_TEXTAREA_CHARS the code view keeps the full color layer as
// the only document-sized surface — it stays the minimap's clone source — and
// routes input through a tiny fixed-position textarea that never holds the
// document, drawing its own caret and selection. Small documents keep the
// textarea path untouched.
//
// The layer is grouped into .cv-chunk wrappers because Blink walks every
// sibling of a mutated line on the next layout: 76,000 flat lines cost ~68 ms
// per keystroke, chunked ones ~1 ms. Line numbers here come from a per-line
// data-ln attribute, not the CSS counter the small path uses: Blink maintains
// counters as one document-wide tree, so ANY line insertion re-resolves it
// (~410 ms on 76k lines) and even rewriting a single counter-reset costs
// ~60 ms — measured, both scale with the document, not the change. attr()
// content depends on the line alone. After an edit changes the line count,
// numbers past it are stale by the delta until cvRenumberStep's idle sweep
// rewrites them a few thousand lines a frame — a beat of off-by-one far from
// the caret, instead of half a second added to every Enter.

// Above this many UTF-16 units the code view switches to the drawn-caret path.
// Matches the host's MAX_LIVE_HIGHLIGHT_BYTES (UTF-8 bytes >= UTF-16 units), so
// a chunked document never receives a live re-highlight — recolorCodeViewLines
// only ever sees the flat small-document layer.
const CODE_EDITOR_MAX_TEXTAREA_CHARS = 256 * 1024;
// Lines per chunk: small enough that one chunk's relayout/renumber is a frame,
// large enough that the chunk list stays short.
const CV_CHUNK_LINES = 256;
// A chunk that outgrows this splits back into CV_CHUNK_LINES pieces.
const CV_CHUNK_SPLIT_AT = CV_CHUNK_LINES * 4;
// Lines re-numbered per animation frame by the deferred sweep.
const CV_RENUMBER_PER_FRAME = 4000;
// Undo entries kept (matches the host's reading-view cap in spirit).
const CV_UNDO_CAP = 500;

// The editor state (cvEd) and hidden input (cvInput) are declared in theme.js
// with the other editing globals: renderState() calls cvTeardownEditor()
// synchronously on load, before this fragment's top level has run.

// The one hidden input: a 2px fixed textarea parked at the caret's screen
// position, permanently on <body> like the app bar's own fields (outside the
// scroller, where inputs are measured free). It holds a zero-width-space
// sentinel, always selected, so copy/cut/paste events always fire and typing
// always replaces — the typed text is read out of the value and the sentinel
// restored.
const CV_SENTINEL = '​';

function cvEnsureInput() {
  if (cvInput) return cvInput;
  cvInput = document.createElement('textarea');
  cvInput.className = 'cv-hidden-input';
  cvInput.setAttribute('aria-label', 'Source editor');
  cvInput.setAttribute('autocapitalize', 'off');
  cvInput.setAttribute('autocorrect', 'off');
  cvInput.setAttribute('autocomplete', 'off');
  cvInput.setAttribute('spellcheck', 'false');
  cvInput.value = CV_SENTINEL;
  document.body.appendChild(cvInput);
  cvInput.addEventListener('keydown', cvKeydown);
  cvInput.addEventListener('input', cvInputEvent);
  cvInput.addEventListener('compositionstart', () => {
    if (cvEd) cvEd.composing = true;
  });
  cvInput.addEventListener('compositionend', (event) => {
    if (!cvEd) return;
    cvEd.composing = false;
    const text = (event.data || '').replace(/​/g, '');
    if (text) cvInsertText(text);
    cvResetSentinel();
  });
  cvInput.addEventListener('copy', (event) => {
    if (!cvEd) return;
    // Always claim the event: the default would copy the invisible sentinel
    // over whatever the clipboard held.
    event.preventDefault();
    const text = cvSelectedText();
    if (text !== null) event.clipboardData.setData('text/plain', text);
  });
  cvInput.addEventListener('cut', (event) => {
    if (!cvEd) return;
    event.preventDefault();
    const text = cvSelectedText();
    if (text === null) return;
    event.clipboardData.setData('text/plain', text);
    cvInsertText('');
  });
  cvInput.addEventListener('paste', (event) => {
    if (!cvEd) return;
    event.preventDefault();
    const text = (event.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (text) cvInsertText(text);
  });
  cvInput.addEventListener('focus', () => {
    if (cvEd) cvEd.doc.classList.add('cv-focused');
  });
  cvInput.addEventListener('blur', () => {
    if (cvEd) cvEd.doc.classList.remove('cv-focused');
  });
  return cvInput;
}

function cvResetSentinel() {
  if (!cvInput) return;
  cvInput.value = CV_SENTINEL;
  cvInput.setSelectionRange(0, CV_SENTINEL.length);
}

// Typed text arrives here (including through autocorrect-style replacements):
// whatever replaced the selected sentinel is the insertion.
function cvInputEvent() {
  if (!cvEd || cvEd.composing) return;
  const text = cvInput.value.replace(/​/g, '');
  if (text) cvInsertText(text);
  cvResetSentinel();
}

// ---- editor lifecycle -------------------------------------------------------

// Build the chunked color layer inside `code` and wire the editor. `inner` is
// the per-line markup from computeColorInner.
function cvSetupEditor(code, doc, text, inner) {
  cvTeardownEditor();
  const lines = text.split('\n');
  const parts = [];
  for (let i = 0; i < inner.length; i += CV_CHUNK_LINES) {
    const end = Math.min(i + CV_CHUNK_LINES, inner.length);
    const rows = [];
    for (let j = i; j < end; j += 1) {
      rows.push(`<div class="cv-line" data-ln="${j + 1}">${inner[j]}</div>`);
    }
    parts.push(`<div class="cv-chunk">${rows.join('')}</div>`);
  }
  code.innerHTML = parts.join('');
  const chunks = Array.from(code.children, (el) => ({ el, count: el.children.length }));

  const selHolder = document.createElement('div');
  selHolder.className = 'cv-selection';
  const caretEl = document.createElement('div');
  caretEl.className = 'cv-caret';
  // Selection paints under the text (the highlight <pre> is a later sibling in
  // the same stacking layer), the caret above it.
  doc.insertBefore(selHolder, doc.firstChild);
  doc.appendChild(caretEl);

  cvEd = {
    code,
    doc,
    lines,
    chunks,
    caret: { line: 0, col: 0 },
    anchor: null,
    goalX: null,
    selHolder,
    caretEl,
    undo: [],
    redo: [],
    composing: false,
    textDirty: false,
    gutterDigits: String(lines.length).length,
    renumberFrom: null,
    renumberFrame: 0,
    renumberTimer: 0,
    drag: null,
    resizeObserver: null,
  };

  doc.addEventListener('pointerdown', cvPointerDown);
  doc.addEventListener('pointermove', cvPointerMove);
  doc.addEventListener('pointerup', cvPointerUp);
  doc.addEventListener('pointercancel', cvPointerUp);
  if (window.ResizeObserver) {
    // Wrap width changed (window resize, pane drag): every caret/selection
    // rect is stale.
    cvEd.resizeObserver = new ResizeObserver(() => {
      if (cvEd) window.requestAnimationFrame(() => cvEd && cvRenderCaretSel());
    });
    cvEd.resizeObserver.observe(doc);
  }
  const input = cvEnsureInput();
  cvResetSentinel();
  input.focus({ preventScroll: true });
  cvRenderCaretSel();
}

function cvTeardownEditor() {
  // The code view is Monaco now; dispose it wherever the old editor was torn
  // down (renderCodeView re-entry, and renderState when leaving for the reader).
  if (monacoEditor) {
    if (monacoChangeSub) {
      monacoChangeSub.dispose();
      monacoChangeSub = null;
    }
    monacoEditor.dispose();
    monacoEditor = null;
  }
  if (!cvEd) return;
  if (cvEd.renumberTimer) window.clearTimeout(cvEd.renumberTimer);
  if (cvEd.renumberFrame) window.cancelAnimationFrame(cvEd.renumberFrame);
  if (cvEd.resizeObserver) cvEd.resizeObserver.disconnect();
  if (cvEd.drag && cvEd.drag.scrollFrame) window.cancelAnimationFrame(cvEd.drag.scrollFrame);
  if (cvInput && document.activeElement === cvInput) cvInput.blur();
  cvEd = null;
}

// The code view's buffer, rejoined only when something is about to read it —
// joining 76,000 lines per keystroke is exactly the O(document) trap.
function cvSyncCodeViewText() {
  // Monaco is authoritative when it's up: read the live buffer so a save (or the
  // debounced splice) sends exactly what's on screen.
  if (monacoEditor) {
    codeViewText = monacoEditor.getValue();
    return;
  }
  if (cvEd && cvEd.textDirty) {
    codeViewText = cvEd.lines.join('\n');
    cvEd.textDirty = false;
  }
}

// ---- line/chunk bookkeeping -------------------------------------------------

function cvLineEl(index) {
  let i = index;
  for (const chunk of cvEd.chunks) {
    if (i < chunk.count) return chunk.el.children[i];
    i -= chunk.count;
  }
  const last = cvEd.chunks[cvEd.chunks.length - 1];
  return last ? last.el.children[last.count - 1] : null;
}

function cvChunkAt(index) {
  let i = index;
  for (let c = 0; c < cvEd.chunks.length; c += 1) {
    const chunk = cvEd.chunks[c];
    if (i < chunk.count || c === cvEd.chunks.length - 1) return { c, local: Math.min(i, chunk.count) };
    i -= chunk.count;
  }
  return { c: 0, local: 0 };
}

// Replace `removeCount` line elements starting at `start` with fresh plain-text
// lines (the debounced host re-highlight never runs at this size, so typed
// lines keep plain text — same as the shipped >256 KB behavior).
function cvSpliceLineEls(start, removeCount, texts) {
  const { c, local } = cvChunkAt(start);
  const chunks = cvEd.chunks;
  let chunkIdx = c;
  let node = chunks[chunkIdx].el.children[local] || null;
  let removed = 0;
  while (removed < removeCount) {
    while (!node && chunkIdx + 1 < chunks.length) {
      chunkIdx += 1;
      node = chunks[chunkIdx].el.children[0] || null;
    }
    if (!node) break;
    const next = node.nextSibling;
    node.remove();
    const holder = chunks[chunkIdx];
    holder.count -= 1;
    removed += 1;
    node = next;
  }
  // Insert into the starting chunk, before whatever now follows the removal
  // point there (or at its end when the removal crossed into later chunks).
  const home = chunks[c];
  const ref = home.el.children[local] || null;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < texts.length; i += 1) {
    const el = makeColorLine(texts[i]);
    el.dataset.ln = String(start + i + 1);
    frag.appendChild(el);
  }
  home.el.insertBefore(frag, ref);
  home.count += texts.length;
  // Drop chunks the removal emptied (never the last one standing).
  for (let i = chunks.length - 1; i >= 0 && chunks.length > 1; i -= 1) {
    if (chunks[i].count === 0) {
      chunks[i].el.remove();
      chunks.splice(i, 1);
    }
  }
  if (home.count > CV_CHUNK_SPLIT_AT) cvSplitChunk(chunks.indexOf(home));
  // Numbers only shift when the line count did.
  if (texts.length !== removeCount) cvScheduleRenumber(start + texts.length);
}

// Split an oversized chunk back into CV_CHUNK_LINES pieces.
function cvSplitChunk(index) {
  const holder = cvEd.chunks[index];
  const rows = Array.from(holder.el.children);
  const replacements = [];
  for (let i = CV_CHUNK_LINES; i < rows.length; i += CV_CHUNK_LINES) {
    const el = document.createElement('div');
    el.className = 'cv-chunk';
    for (let j = i; j < Math.min(i + CV_CHUNK_LINES, rows.length); j += 1) {
      el.appendChild(rows[j]);
    }
    replacements.push({ el, count: el.children.length });
  }
  holder.count = holder.el.children.length;
  let after = holder.el;
  for (const piece of replacements) {
    after.insertAdjacentElement('afterend', piece.el);
    after = piece.el;
  }
  cvEd.chunks.splice(index + 1, 0, ...replacements);
}

// Rewrite stale data-ln attributes after a line-count change, from `fromLine`
// on, a slice per frame once typing pauses.
function cvScheduleRenumber(fromLine) {
  cvEd.renumberFrom =
    cvEd.renumberFrom === null ? fromLine : Math.min(cvEd.renumberFrom, fromLine);
  if (cvEd.renumberTimer) window.clearTimeout(cvEd.renumberTimer);
  cvEd.renumberTimer = window.setTimeout(() => {
    if (cvEd) {
      cvEd.renumberTimer = 0;
      cvRenumberStep();
    }
  }, 250);
}

function cvRenumberStep() {
  if (!cvEd || cvEd.renumberFrom === null) return;
  const from = Math.max(0, cvEd.renumberFrom);
  let index = 0;
  let updated = 0;
  outer: for (const chunk of cvEd.chunks) {
    if (index + chunk.count <= from) {
      index += chunk.count;
      continue;
    }
    let node = chunk.el.children[Math.max(0, from - index)];
    index = Math.max(index, from);
    while (node) {
      if (updated >= CV_RENUMBER_PER_FRAME) break outer;
      const want = String(index + 1);
      if (node.dataset.ln !== want) node.dataset.ln = want;
      node = node.nextElementSibling;
      index += 1;
      updated += 1;
    }
  }
  if (index < cvLineCount()) {
    cvEd.renumberFrom = index;
    cvEd.renumberFrame = window.requestAnimationFrame(() => {
      if (cvEd) {
        cvEd.renumberFrame = 0;
        cvRenumberStep();
      }
    });
  } else {
    cvEd.renumberFrom = null;
  }
}

function cvLineCount() {
  let count = 0;
  for (const chunk of cvEd.chunks) count += chunk.count;
  return count;
}

// ---- positions and geometry ---------------------------------------------------

function cvClampPos(pos) {
  const lines = cvEd.lines;
  const line = Math.max(0, Math.min(pos.line, lines.length - 1));
  return { line, col: Math.max(0, Math.min(pos.col, lines[line].length)) };
}

function cvPosLessEq(a, b) {
  return a.line < b.line || (a.line === b.line && a.col <= b.col);
}

function cvOrderedSelection() {
  if (!cvEd.anchor) return null;
  const a = cvEd.anchor;
  const b = cvEd.caret;
  if (a.line === b.line && a.col === b.col) return null;
  return cvPosLessEq(a, b) ? { start: a, end: b } : { start: b, end: a };
}

function cvSelectedText() {
  const sel = cvOrderedSelection();
  if (!sel) return null;
  return cvTextRange(sel.start, sel.end);
}

function cvTextRange(start, end) {
  const lines = cvEd.lines;
  if (start.line === end.line) return lines[start.line].slice(start.col, end.col);
  const parts = [lines[start.line].slice(start.col)];
  for (let i = start.line + 1; i < end.line; i += 1) parts.push(lines[i]);
  parts.push(lines[end.line].slice(0, end.col));
  return parts.join('\n');
}

// Viewport rect of the caret position, from the layer's own layout (the browser
// wrapped the text; ask it rather than recompute).
function cvCaretRect(pos) {
  const lineEl = cvLineEl(pos.line);
  if (!lineEl) return null;
  const nodes = codeLineTextNodes(lineEl);
  let remaining = pos.col;
  let target = null;
  for (const node of nodes) {
    if (remaining <= node.data.length) {
      target = { node, offset: remaining };
      break;
    }
    remaining -= node.data.length;
  }
  if (!target && nodes.length) {
    const last = nodes[nodes.length - 1];
    target = { node: last, offset: last.data.length };
  }
  if (!target) {
    const rect = lineEl.getBoundingClientRect();
    return { left: rect.left, top: rect.top, height: rect.height || 20 };
  }
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  const rect = range.getClientRects()[0];
  if (rect) return { left: rect.left, top: rect.top, height: rect.height || 20 };
  const lineRect = lineEl.getBoundingClientRect();
  return { left: lineRect.left, top: lineRect.top, height: lineRect.height || 20 };
}

// Map a viewport point to {line, col}: bisect the line by element rects, then
// the column by collapsed-Range rects. document.caretPositionFromPoint costs
// ~130 ms a call on this layer; this costs ~0.
function cvPosFromPoint(x, y) {
  const lineCount = cvEd.lines.length;
  let lo = 0;
  let hi = lineCount - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const el = cvLineEl(mid);
    if (el && el.getBoundingClientRect().bottom >= y) hi = mid;
    else lo = mid + 1;
  }
  const line = lo;
  const lineEl = cvLineEl(line);
  if (!lineEl) return { line: 0, col: 0 };
  const text = cvEd.lines[line];
  if (!text.length) return { line, col: 0 };
  const nodes = codeLineTextNodes(lineEl);
  const rectAt = (offset) => {
    let rem = offset;
    for (const node of nodes) {
      if (rem <= node.data.length) {
        const r = document.createRange();
        r.setStart(node, rem);
        r.collapse(true);
        return r.getClientRects()[0] || null;
      }
      rem -= node.data.length;
    }
    return null;
  };
  let a = 0;
  let b = text.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    const rect = rectAt(mid);
    if (!rect) break;
    if (rect.top > y || (rect.bottom >= y && rect.left >= x)) b = mid;
    else a = mid + 1;
  }
  // Land on the nearer side of the character boundary.
  if (a > 0) {
    const here = rectAt(a);
    const prev = rectAt(a - 1);
    if (here && prev && prev.bottom >= y && prev.top <= y) {
      if (Math.abs(prev.left - x) < Math.abs(here.left - x)) a -= 1;
    }
  }
  // Never split a surrogate pair.
  const codeUnit = text.charCodeAt(a - 1);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && a < text.length) a -= 1;
  return { line, col: a };
}

// ---- caret & selection rendering ---------------------------------------------

function cvRenderCaretSel() {
  if (!cvEd) return;
  const docRect = cvEd.doc.getBoundingClientRect();
  const rect = cvCaretRect(cvEd.caret);
  if (rect) {
    cvEd.caretEl.style.transform = `translate(${rect.left - docRect.left}px, ${rect.top - docRect.top}px)`;
    cvEd.caretEl.style.height = `${rect.height}px`;
    // Restart the blink so the caret is solid right after it moves.
    cvEd.caretEl.style.animation = 'none';
    void cvEd.caretEl.offsetWidth;
    cvEd.caretEl.style.animation = '';
    // Park the hidden input under the caret so IME candidate windows and the
    // OS emoji panel open where typing happens.
    if (cvInput) {
      cvInput.style.left = `${Math.max(0, Math.min(window.innerWidth - 4, rect.left))}px`;
      cvInput.style.top = `${Math.max(0, Math.min(window.innerHeight - 24, rect.top))}px`;
    }
  }
  cvRenderSelection(docRect);
}

function cvRenderSelection(docRect) {
  const holder = cvEd.selHolder;
  const sel = cvOrderedSelection();
  if (!sel) {
    if (holder.firstChild) holder.textContent = '';
    return;
  }
  const rects = [];
  const pushRangeRects = (line, fromCol, toCol) => {
    const lineEl = cvLineEl(line);
    if (!lineEl) return;
    const nodes = codeLineTextNodes(lineEl);
    if (!nodes.length) {
      const r = lineEl.getBoundingClientRect();
      rects.push({ left: r.left, top: r.top, width: 6, height: r.height });
      return;
    }
    const locate = (col) => {
      let rem = col;
      for (const node of nodes) {
        if (rem <= node.data.length) return { node, offset: rem };
        rem -= node.data.length;
      }
      const last = nodes[nodes.length - 1];
      return { node: last, offset: last.data.length };
    };
    const from = locate(fromCol);
    const to = locate(toCol);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const list = range.getClientRects();
    for (let i = 0; i < list.length && i < 60; i += 1) {
      const r = list[i];
      if (r.width > 0 || r.height > 0) {
        rects.push({ left: r.left, top: r.top, width: Math.max(r.width, 2), height: r.height });
      }
    }
  };
  if (sel.start.line === sel.end.line) {
    pushRangeRects(sel.start.line, sel.start.col, sel.end.col);
  } else {
    pushRangeRects(sel.start.line, sel.start.col, cvEd.lines[sel.start.line].length);
    pushRangeRects(sel.end.line, 0, sel.end.col);
    if (sel.end.line - sel.start.line > 1) {
      // One band covers every fully-selected line; per-line rects would be
      // 76,000 elements on select-all.
      const firstMid = cvLineEl(sel.start.line + 1);
      const lastMid = cvLineEl(sel.end.line - 1);
      const codeRect = cvEd.code.getBoundingClientRect();
      if (firstMid && lastMid) {
        const top = firstMid.getBoundingClientRect().top;
        const bottom = lastMid.getBoundingClientRect().bottom;
        rects.push({ left: codeRect.left, top, width: codeRect.width, height: bottom - top });
      }
    }
  }
  const parts = [];
  for (const r of rects) {
    parts.push(
      `<div style="left:${r.left - docRect.left}px;top:${r.top - docRect.top}px;width:${r.width}px;height:${r.height}px"></div>`
    );
  }
  holder.innerHTML = parts.join('');
}

function cvScrollCaretIntoView() {
  const rect = cvCaretRect(cvEd.caret);
  if (!rect) return;
  const appRect = app.getBoundingClientRect();
  const margin = 24;
  if (rect.top < appRect.top + margin) {
    app.scrollTop -= appRect.top + margin - rect.top;
  } else if (rect.top + rect.height > appRect.bottom - margin) {
    app.scrollTop += rect.top + rect.height - (appRect.bottom - margin);
  }
}

// ---- edits ---------------------------------------------------------------------

// End position of `text` inserted at (line, col).
function cvEndOf(line, col, text) {
  const nl = text.lastIndexOf('\n');
  if (nl === -1) return { line, col: col + text.length };
  const count = text.split('\n').length - 1;
  return { line: line + count, col: text.length - nl - 1 };
}

// The one mutation everything funnels through: replace [start, end) with
// `inserted`, patch only the touched lines, keep undo/dirty/debounce in step.
function cvApplyEdit(start, end, inserted, record, coalesce) {
  const lines = cvEd.lines;
  const removed = cvTextRange(start, end);
  if (removed === inserted && record) return;
  const caretBefore = { line: cvEd.caret.line, col: cvEd.caret.col };
  const insLines = inserted.split('\n');
  const lineCountBefore = lines.length;
  if (start.line === end.line && insLines.length === 1) {
    const oldText = lines[start.line];
    const newText = oldText.slice(0, start.col) + inserted + oldText.slice(end.col);
    lines[start.line] = newText;
    const lineEl = cvLineEl(start.line);
    if (lineEl && colorLineText(lineEl) === oldText) {
      patchColorLineText(lineEl, oldText, newText);
    } else if (lineEl) {
      lineEl.textContent = newText === '' ? CODE_VIEW_BLANK : newText;
    }
  } else {
    const replacement = insLines.slice();
    replacement[0] = lines[start.line].slice(0, start.col) + replacement[0];
    replacement[replacement.length - 1] += lines[end.line].slice(end.col);
    const removeCount = end.line - start.line + 1;
    if (replacement.length < 10000) {
      lines.splice(start.line, removeCount, ...replacement);
    } else {
      // Spreading 100k arguments overflows the stack; rebuild instead.
      cvEd.lines = lines
        .slice(0, start.line)
        .concat(replacement, lines.slice(start.line + removeCount));
    }
    cvSpliceLineEls(start.line, removeCount, replacement);
  }
  const caretAfter = cvEndOf(start.line, start.col, inserted);
  cvEd.caret = caretAfter;
  cvEd.anchor = null;
  cvEd.goalX = null;

  if (record) {
    cvEd.redo.length = 0;
    const last = cvEd.undo[cvEd.undo.length - 1];
    const t = Date.now();
    if (
      coalesce === 'type' &&
      last &&
      last.coalesce === 'type' &&
      last.removed === '' &&
      removed === '' &&
      !inserted.includes('\n') &&
      last.line === start.line &&
      last.col + last.inserted.length === start.col &&
      t - last.t < 1000
    ) {
      last.inserted += inserted;
      last.caretAfter = caretAfter;
      last.t = t;
    } else if (
      coalesce === 'backspace' &&
      last &&
      last.coalesce === 'backspace' &&
      last.inserted === '' &&
      inserted === '' &&
      !removed.includes('\n') &&
      start.line === last.line &&
      start.col + removed.length === last.col &&
      t - last.t < 1000
    ) {
      last.line = start.line;
      last.col = start.col;
      last.removed = removed + last.removed;
      last.caretAfter = caretAfter;
      last.t = t;
    } else {
      cvEd.undo.push({
        line: start.line,
        col: start.col,
        removed,
        inserted,
        caretBefore,
        caretAfter,
        coalesce,
        t,
      });
      if (cvEd.undo.length > CV_UNDO_CAP) cvEd.undo.shift();
    }
  }

  cvEd.textDirty = true;
  if (cvEd.lines.length !== lineCountBefore) {
    const digits = String(cvEd.lines.length).length;
    if (digits !== cvEd.gutterDigits) {
      cvEd.gutterDigits = digits;
      sizeLineNumberGutter(app.querySelector('.code-view'), cvEd.lines.length);
    }
  }
  const path = activeDocumentPath();
  if (path) setDirtyState(path, true);
  scheduleSourceUpdate();
  refreshCodeViewMinimap();
  cvRenderCaretSel();
  cvScrollCaretIntoView();
}

function cvInsertText(text) {
  const sel = cvOrderedSelection();
  const start = sel ? sel.start : cvEd.caret;
  const end = sel ? sel.end : cvEd.caret;
  const coalesce = !sel && text.length === 1 && text !== '\n' ? 'type' : null;
  cvApplyEdit(cvClampPos(start), cvClampPos(end), text, true, coalesce);
}

function cvUndo() {
  const entry = cvEd.undo.pop();
  if (!entry) return;
  const start = { line: entry.line, col: entry.col };
  const end = cvEndOf(entry.line, entry.col, entry.inserted);
  cvApplyEdit(start, end, entry.removed, false, null);
  cvEd.caret = cvClampPos(entry.caretBefore);
  cvEd.redo.push(entry);
  cvRenderCaretSel();
  cvScrollCaretIntoView();
}

function cvRedo() {
  const entry = cvEd.redo.pop();
  if (!entry) return;
  const start = { line: entry.line, col: entry.col };
  const end = cvEndOf(entry.line, entry.col, entry.removed);
  cvApplyEdit(start, end, entry.inserted, false, null);
  cvEd.caret = cvClampPos(entry.caretAfter);
  cvEd.undo.push(entry);
  cvRenderCaretSel();
  cvScrollCaretIntoView();
}

// ---- movement -------------------------------------------------------------------

const CV_WORD_RE = /[\p{L}\p{N}_]/u;

function cvPosBefore(pos) {
  if (pos.col > 0) {
    const text = cvEd.lines[pos.line];
    let col = pos.col - 1;
    const unit = text.charCodeAt(col);
    if (unit >= 0xdc00 && unit <= 0xdfff && col > 0) col -= 1;
    return { line: pos.line, col };
  }
  if (pos.line > 0) return { line: pos.line - 1, col: cvEd.lines[pos.line - 1].length };
  return pos;
}

function cvPosAfter(pos) {
  const text = cvEd.lines[pos.line];
  if (pos.col < text.length) {
    let col = pos.col + 1;
    const unit = text.charCodeAt(pos.col);
    if (unit >= 0xd800 && unit <= 0xdbff && col < text.length) col += 1;
    return { line: pos.line, col };
  }
  if (pos.line < cvEd.lines.length - 1) return { line: pos.line + 1, col: 0 };
  return pos;
}

function cvWordLeft(pos) {
  let p = pos;
  if (p.col === 0) return cvPosBefore(p);
  const text = cvEd.lines[p.line];
  let col = p.col;
  while (col > 0 && !CV_WORD_RE.test(text[col - 1])) col -= 1;
  while (col > 0 && CV_WORD_RE.test(text[col - 1])) col -= 1;
  return { line: p.line, col };
}

function cvWordRight(pos) {
  const text = cvEd.lines[pos.line];
  if (pos.col >= text.length) return cvPosAfter(pos);
  let col = pos.col;
  while (col < text.length && !CV_WORD_RE.test(text[col])) col += 1;
  while (col < text.length && CV_WORD_RE.test(text[col])) col += 1;
  return { line: pos.line, col };
}

function cvWordRangeAt(pos) {
  const text = cvEd.lines[pos.line];
  if (!text.length) return { start: { line: pos.line, col: 0 }, end: { line: pos.line, col: 0 } };
  let from = Math.min(pos.col, text.length - 1);
  if (!CV_WORD_RE.test(text[from]) && from > 0 && CV_WORD_RE.test(text[from - 1])) from -= 1;
  let to = from;
  if (CV_WORD_RE.test(text[from])) {
    while (from > 0 && CV_WORD_RE.test(text[from - 1])) from -= 1;
    while (to < text.length && CV_WORD_RE.test(text[to])) to += 1;
  } else {
    to = Math.min(from + 1, text.length);
  }
  return { start: { line: pos.line, col: from }, end: { line: pos.line, col: to } };
}

function cvMoveCaret(pos, extend) {
  if (extend) {
    if (!cvEd.anchor) cvEd.anchor = { line: cvEd.caret.line, col: cvEd.caret.col };
  } else {
    cvEd.anchor = null;
  }
  cvEd.caret = cvClampPos(pos);
  cvRenderCaretSel();
  cvScrollCaretIntoView();
}

// Vertical movement goes through geometry so wrapped rows behave like rows.
function cvMoveVertical(direction, extend, page) {
  const rect = cvCaretRect(cvEd.caret);
  if (!rect) return;
  if (cvEd.goalX === null) cvEd.goalX = rect.left;
  const appRect = app.getBoundingClientRect();
  let targetY;
  if (page) {
    const jump = app.clientHeight;
    app.scrollTop += direction * jump;
    void app.scrollHeight;
    const after = cvCaretRect(cvEd.caret);
    targetY = (after ? after.top : rect.top) + direction * jump + rect.height / 2;
    targetY = Math.max(appRect.top + 2, Math.min(appRect.bottom - 2, targetY));
  } else {
    targetY = direction > 0 ? rect.top + rect.height * 1.5 : rect.top - rect.height * 0.5;
  }
  const goal = cvEd.goalX;
  const pos = cvPosFromPoint(goal, targetY);
  const atStart = cvEd.caret.line === 0 && cvEd.caret.col === 0;
  const lastLine = cvEd.lines.length - 1;
  const atEnd = cvEd.caret.line === lastLine && cvEd.caret.col === cvEd.lines[lastLine].length;
  if (pos.line === cvEd.caret.line && pos.col === cvEd.caret.col) {
    if (direction > 0 && !atEnd) {
      cvMoveCaret({ line: lastLine, col: cvEd.lines[lastLine].length }, extend);
    } else if (direction < 0 && !atStart) {
      cvMoveCaret({ line: 0, col: 0 }, extend);
    }
    cvEd.goalX = goal;
    return;
  }
  cvMoveCaret(pos, extend);
  cvEd.goalX = goal;
}

// ---- keyboard --------------------------------------------------------------------

function cvKeydown(event) {
  if (!cvEd || cvEd.composing) return;
  const key = event.key;
  const mod = event.ctrlKey || event.metaKey;
  const sel = cvOrderedSelection();
  const done = () => event.preventDefault();

  if (mod && !event.altKey) {
    const lower = key.toLowerCase();
    if (lower === 'a') {
      cvEd.anchor = { line: 0, col: 0 };
      const last = cvEd.lines.length - 1;
      cvEd.caret = { line: last, col: cvEd.lines[last].length };
      cvRenderCaretSel();
      return done();
    }
    if (lower === 'z' && !event.shiftKey) {
      cvUndo();
      return done();
    }
    if (lower === 'y' || (lower === 'z' && event.shiftKey)) {
      cvRedo();
      return done();
    }
    if (lower === 'home') {
      cvMoveCaret({ line: 0, col: 0 }, event.shiftKey);
      return done();
    }
    if (lower === 'end') {
      const last = cvEd.lines.length - 1;
      cvMoveCaret({ line: last, col: cvEd.lines[last].length }, event.shiftKey);
      return done();
    }
    // Ctrl+C/X/V/S fall through: clipboard events and the global save handler.
  }

  switch (key) {
    case 'ArrowLeft': {
      const target = mod
        ? cvWordLeft(cvEd.caret)
        : sel && !event.shiftKey
          ? sel.start
          : cvPosBefore(cvEd.caret);
      cvMoveCaret(target, event.shiftKey);
      return done();
    }
    case 'ArrowRight': {
      const target = mod
        ? cvWordRight(cvEd.caret)
        : sel && !event.shiftKey
          ? sel.end
          : cvPosAfter(cvEd.caret);
      cvMoveCaret(target, event.shiftKey);
      return done();
    }
    case 'ArrowUp':
      cvMoveVertical(-1, event.shiftKey, false);
      return done();
    case 'ArrowDown':
      cvMoveVertical(1, event.shiftKey, false);
      return done();
    case 'PageUp':
      cvMoveVertical(-1, event.shiftKey, true);
      return done();
    case 'PageDown':
      cvMoveVertical(1, event.shiftKey, true);
      return done();
    case 'Home':
      cvMoveCaret({ line: cvEd.caret.line, col: 0 }, event.shiftKey);
      return done();
    case 'End':
      cvMoveCaret(
        { line: cvEd.caret.line, col: cvEd.lines[cvEd.caret.line].length },
        event.shiftKey
      );
      return done();
    case 'Backspace': {
      if (sel) cvApplyEdit(sel.start, sel.end, '', true, null);
      else {
        const from = mod ? cvWordLeft(cvEd.caret) : cvPosBefore(cvEd.caret);
        if (from.line !== cvEd.caret.line || from.col !== cvEd.caret.col) {
          cvApplyEdit(from, cvEd.caret, '', true, mod ? null : 'backspace');
        }
      }
      return done();
    }
    case 'Delete': {
      if (sel) cvApplyEdit(sel.start, sel.end, '', true, null);
      else {
        const to = mod ? cvWordRight(cvEd.caret) : cvPosAfter(cvEd.caret);
        if (to.line !== cvEd.caret.line || to.col !== cvEd.caret.col) {
          cvApplyEdit(cvEd.caret, to, '', true, null);
        }
      }
      return done();
    }
    case 'Enter':
      cvInsertText('\n');
      return done();
    case 'Tab':
      if (!event.shiftKey && !mod && !event.altKey) {
        cvInsertText('\t');
        return done();
      }
      return undefined;
    default:
      return undefined;
  }
}

// ---- mouse -----------------------------------------------------------------------

function cvPointerDown(event) {
  if (!cvEd || event.button !== 0) return;
  // Keep focus in the hidden input and native selection out of the layer.
  event.preventDefault();
  cvEnsureInput().focus({ preventScroll: true });
  const pos = cvPosFromPoint(event.clientX, event.clientY);
  const clicks = event.detail % 3 === 0 && event.detail > 0 ? 3 : event.detail % 3;
  const mode = clicks === 2 ? 'word' : clicks === 3 ? 'line' : 'char';
  if (mode === 'word') {
    const range = cvWordRangeAt(pos);
    cvEd.anchor = range.start;
    cvEd.caret = range.end;
  } else if (mode === 'line') {
    cvEd.anchor = { line: pos.line, col: 0 };
    cvEd.caret =
      pos.line < cvEd.lines.length - 1
        ? { line: pos.line + 1, col: 0 }
        : { line: pos.line, col: cvEd.lines[pos.line].length };
  } else if (event.shiftKey) {
    if (!cvEd.anchor) cvEd.anchor = { line: cvEd.caret.line, col: cvEd.caret.col };
    cvEd.caret = pos;
  } else {
    cvEd.anchor = null;
    cvEd.caret = pos;
  }
  cvEd.goalX = null;
  cvEd.drag = {
    pointerId: event.pointerId,
    mode,
    origin: pos,
    lastX: event.clientX,
    lastY: event.clientY,
    moveFrame: 0,
    scrollFrame: 0,
  };
  try {
    cvEd.doc.setPointerCapture(event.pointerId);
  } catch (error) {
    // Capture is an optimization; selection still follows pointermove.
  }
  cvRenderCaretSel();
}

function cvDragUpdate() {
  const drag = cvEd && cvEd.drag;
  if (!drag) return;
  const appRect = app.getBoundingClientRect();
  const y = Math.max(appRect.top + 1, Math.min(appRect.bottom - 1, drag.lastY));
  const pos = cvPosFromPoint(drag.lastX, y);
  if (drag.mode === 'word') {
    const range = cvWordRangeAt(pos);
    if (cvPosLessEq(drag.origin, pos)) {
      cvEd.anchor = cvWordRangeAt(drag.origin).start;
      cvEd.caret = range.end;
    } else {
      cvEd.anchor = cvWordRangeAt(drag.origin).end;
      cvEd.caret = range.start;
    }
  } else if (drag.mode === 'line') {
    if (pos.line >= drag.origin.line) {
      cvEd.anchor = { line: drag.origin.line, col: 0 };
      cvEd.caret =
        pos.line < cvEd.lines.length - 1
          ? { line: pos.line + 1, col: 0 }
          : { line: pos.line, col: cvEd.lines[pos.line].length };
    } else {
      cvEd.anchor = {
        line: drag.origin.line < cvEd.lines.length - 1 ? drag.origin.line + 1 : drag.origin.line,
        col:
          drag.origin.line < cvEd.lines.length - 1 ? 0 : cvEd.lines[drag.origin.line].length,
      };
      cvEd.caret = { line: pos.line, col: 0 };
    }
  } else {
    if (!cvEd.anchor) cvEd.anchor = drag.origin;
    cvEd.caret = pos;
  }
  cvRenderCaretSel();
  // Dragging past an edge keeps scrolling until the pointer returns.
  const above = drag.lastY < appRect.top + 16;
  const below = drag.lastY > appRect.bottom - 16;
  if ((above || below) && !drag.scrollFrame) {
    const step = () => {
      if (!cvEd || !cvEd.drag) return;
      const d = cvEd.drag;
      const r = app.getBoundingClientRect();
      const overshoot = d.lastY < r.top + 16 ? d.lastY - (r.top + 16) : d.lastY > r.bottom - 16 ? d.lastY - (r.bottom - 16) : 0;
      if (!overshoot) {
        d.scrollFrame = 0;
        return;
      }
      app.scrollTop += Math.max(-60, Math.min(60, overshoot / 2));
      const yy = Math.max(r.top + 1, Math.min(r.bottom - 1, d.lastY));
      cvEd.caret = cvPosFromPoint(d.lastX, yy);
      cvRenderCaretSel();
      d.scrollFrame = window.requestAnimationFrame(step);
    };
    drag.scrollFrame = window.requestAnimationFrame(step);
  }
}

function cvPointerMove(event) {
  const drag = cvEd && cvEd.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  if (!drag.moveFrame) {
    drag.moveFrame = window.requestAnimationFrame(() => {
      if (cvEd && cvEd.drag) cvEd.drag.moveFrame = 0;
      cvDragUpdate();
    });
  }
}

function cvPointerUp(event) {
  const drag = cvEd && cvEd.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.moveFrame) window.cancelAnimationFrame(drag.moveFrame);
  if (drag.scrollFrame) window.cancelAnimationFrame(drag.scrollFrame);
  cvEd.drag = null;
}
