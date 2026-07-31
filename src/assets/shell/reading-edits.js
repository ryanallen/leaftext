function utf8ByteLength(text) {
  return sourceByteEncoder.encode(text).length;
}

// Claim the caret for the next render, stamped with its document so a caret
// queued before a navigation can't land in the newly opened page.
function setPendingCaret(next) {
  pendingCaret = next ? { ...next, path: activeDocumentPath() } : null;
}

// Send a buffer-mutating reading-view command. Each lands one host undo snapshot,
// and this raises the dirty state (Save button + tab dot) optimistically.
function sendEditCommand(message) {
  const path = activeDocumentPath();
  if (path) {
    undoableByPath.set(path, true);
    setDirtyState(path, true);
    // The toggle's saved pixels no longer describe this text.
    forgetViewHandoff();
    // Undo just became available, which setDirtyState only reflects when the dirty
    // flag itself changed — on the second and later edits it has not.
    updateEditingChrome();
  }
  send(message);
}

function visibleTextLength(el) {
  return el.textContent.length;
}

// The caret's character offset inside `el`'s visible text, or null when the
// selection is missing, uncollapsed, or outside the block.
function caretTextOffsetIn(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!el.contains(caret.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(caret.startContainer, caret.startOffset);
  return before.cloneContents().textContent.length;
}

// Put the caret at a character offset inside `el`'s visible text (clamped to the
// end), walking its text nodes.
function placeCaretInBlock(el, offset) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset || 0);
  let lastNode = null;
  let placed = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue.length;
    if (remaining <= length) {
      range.setStart(node, remaining);
      placed = true;
      break;
    }
    remaining -= length;
    lastNode = node;
  }
  if (!placed) {
    if (lastNode) {
      range.setStart(lastNode, lastNode.nodeValue.length);
    } else {
      range.selectNodeContents(el);
    }
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Send an edit for `el`'s source range, only if `text` differs from the baseline
// captured when editing began (so a no-edit focus costs nothing). If the caret
// already moved into another block, carry it across this commit's re-render
// (adjusting for the splice's offset shift) so it isn't dumped out.
function commitBlockEdit(el, text) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (text === el.__editBaseline) return;
  sendEditCommand({ command: 'editBlock', start, end, text });
  const delta = utf8ByteLength(text) - (end - start);
  window.setTimeout(() => {
    if (pendingCaret) return; // a structural edit already claimed the caret
    const active = document.activeElement;
    if (!active || active === el || !active.dataset || active.dataset.srcStart == null) return;
    if (active.getAttribute('contenteditable') !== 'true') return;
    if (active.dataset.editingSource === 'true') return;
    const activeStart = Number(active.dataset.srcStart);
    if (!Number.isFinite(activeStart)) return;
    const offset = caretTextOffsetIn(active);
    setPendingCaret({
      srcStart: activeStart >= end ? activeStart + delta : activeStart,
      textOffset: offset == null ? 0 : offset,
    });
  }, 0);
}

// Commit whichever block holds an active editing session. Used before actions
// that bypass the focusout commit — e.g. a link click whose mousedown is swallowed.
function commitActiveEditingBlock() {
  const active = document.activeElement;
  if (!active || !active.__editingActive) return;
  active.__editingActive = false;
  commitBlockEdit(active, blockDomToMarkdown(active));
}

// Splice `text` over `[start, end)` for a STRUCTURAL edit (split/merge/insert).
// Unlike commitBlockEdit this always sends, and it neutralizes the block's blur
// baseline afterwards: the DOM still shows the pre-splice content, and letting
// the blur commit fire would replay a stale range against the new buffer.
function sendBlockSplice(el, start, end, text) {
  sendEditCommand({ command: 'editBlock', start, end, text });
  el.__editBaseline = blockDomToMarkdown(el);
}

// A table checkbox toggle: autosave tells the host to write to disk with no undo
// step, and the plain send avoids a dirty flash. Neutralizes the blur baseline
// like sendBlockSplice, in case the table was also being edited.
function sendCheckboxBlockEdit(el, start, end, text) {
  send({ command: 'editBlock', start, end, text, autosave: true });
  el.__editBaseline = blockDomToMarkdown(el);
}

// Enter inside a paragraph/heading: split the block at the caret into two
// blocks. The serialized halves replace the block's source range, joined by a
// blank line; the caret carries over to the start of the second block. Enter at
// the end instead opens a fresh empty paragraph below (Markdown has no empty
// block, so it stays DOM-local until first commit); Enter at the very start is
// a no-op.
function splitBlockAtCaret(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const caret = selection.getRangeAt(0);
  if (!el.contains(caret.startContainer)) return;
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(el);
  beforeRange.setEnd(caret.startContainer, caret.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  afterRange.setStart(caret.startContainer, caret.startOffset);
  const part1Inline = inlineDomToMarkdown(beforeRange.cloneContents()).trim();
  const part2Inline = inlineDomToMarkdown(afterRange.cloneContents()).trim();
  if (!part1Inline) return;
  const prefix =
    el.dataset.blockKind === 'heading' ? '#'.repeat(Number(el.tagName.substring(1)) || 1) + ' ' : '';
  const part1 = prefix + part1Inline;
  if (part2Inline) {
    // Both halves keep the block's own kind — splitting a heading yields two
    // headings at the same level, splitting a paragraph two paragraphs.
    const part2 = prefix + part2Inline;
    sendBlockSplice(el, start, end, part1 + '\n\n' + part2);
    setPendingCaret({ srcStart: start + utf8ByteLength(part1) + 2, textOffset: 0 });
  } else if (blockDomToMarkdown(el) !== el.__editBaseline) {
    // Enter at the end with unsaved text edits: commit them, then reopen the
    // empty insert paragraph on the far side of the re-render.
    sendBlockSplice(el, start, end, part1);
    setPendingCaret({ srcStart: start, insertBelow: true });
  } else {
    openInsertBlockAfter(el);
  }
}

// Backspace at the very start of a paragraph/heading: merge it into the previous
// block, Notion-style — the two texts join at a caret that stays put. Only fires
// when the previous sibling is itself a WYSIWYG paragraph/heading; anything else
// (a list, a code block, a rule) leaves Backspace inert at the boundary.
function mergeBlockIntoPrevious(el, prev) {
  const start = Number(prev.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const junction = visibleTextLength(prev);
  const merged = blockDomToMarkdown(prev) + inlineDomToMarkdown(el).trim();
  sendBlockSplice(el, start, end, merged);
  setPendingCaret({ srcStart: start, textOffset: junction });
}

// A fresh empty paragraph below `el`, ready to type into. Markdown cannot hold
// an empty block, so it exists only in the DOM until its first commit, which
// inserts `\n\n` + the typed text at the previous block's end offset. Enter
// commits and chains another empty paragraph below (continuous writing flow);
// Backspace on the empty block dissolves it back into the previous block's end;
// clicking away commits, or dissolves it if nothing was typed.
function openInsertBlockAfter(el) {
  const insertAt = Number(el.dataset.srcEnd);
  if (!Number.isFinite(insertAt)) return;
  const block = document.createElement('p');
  block.className = 'leaf-editable leaf-insert-block';
  block.dataset.blockKind = 'paragraph';
  block.setAttribute('contenteditable', 'true');
  block.setAttribute('spellcheck', 'false');
  el.insertAdjacentElement('afterend', block);
  const commit = (chainBelow) => {
    if (block.__committed) return true;
    const text = inlineDomToMarkdown(block).trim();
    if (!text) return false;
    block.__committed = true;
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: '\n\n' + text });
    if (chainBelow) setPendingCaret({ srcStart: insertAt + 2, insertBelow: true });
    return true;
  };
  block.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commit(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      block.blur();
      return;
    }
    if (event.key === 'Backspace' && !inlineDomToMarkdown(block).trim()) {
      event.preventDefault();
      block.remove();
      el.focus({ preventScroll: true });
      placeCaretInBlock(el, visibleTextLength(el));
    }
  });
  block.addEventListener('blur', () => {
    if (!commit(false)) block.remove();
  });
  block.focus({ preventScroll: true });
}

// Structural keys for a WYSIWYG block, by kind. Paragraphs and headings get the
// block-editor behaviors (Enter splits, Shift+Enter breaks the line, Backspace
// at the start merges up); lists lean on the browser's native contenteditable
// list handling (Enter makes a new item, Backspace joins items) and serialize
// whatever structure results; table cells are single-line, so Enter is inert.
function handleWysiwygKeydown(el, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    el.blur();
    return;
  }
  const kind = el.dataset.blockKind;
  if (kind === 'table') {
    if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (kind === 'blockquote') {
    // Enter inside a quote adds a quoted line (a hard break) rather than
    // splitting the quote — a native Enter would create markup the quote's
    // serializer has no `>`-form for.
    if (event.key === 'Enter') {
      event.preventDefault();
      document.execCommand('insertLineBreak');
    }
    return;
  }
  if (kind === 'list') return;
  if (event.key === 'Enter') {
    if (event.shiftKey) {
      // Shift+Enter: a line break. Natural in a paragraph (Chromium inserts a
      // <br>, serialized as a hard break); meaningless in a single-line heading.
      if (kind === 'heading') event.preventDefault();
      return;
    }
    event.preventDefault();
    splitBlockAtCaret(el);
    return;
  }
  if (event.key === 'Backspace') {
    const selection = window.getSelection();
    if (selection && selection.isCollapsed && caretTextOffsetIn(el) === 0) {
      const prev = el.previousElementSibling;
      if (
        prev &&
        prev.getAttribute &&
        prev.getAttribute('contenteditable') === 'true' &&
        (prev.dataset.blockKind === 'paragraph' || prev.dataset.blockKind === 'heading')
      ) {
        event.preventDefault();
        mergeBlockIntoPrevious(el, prev);
      }
    }
  }
}

// Make `el` an editing host. Split from the listeners below, and from the
// `.leaf-editable` class, so bindEditableBlocks can apply each in its own pass.
function markMarkdownEditable(el) {
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'false');
  el.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('contenteditable', 'false'));
}
// Wire `el` as a live Markdown editor: keep the rendered styling, edit in place,
// commit on blur. Checkboxes stay non-editable islands; focus moving within the
// block neither resets the baseline nor commits.
function wireMarkdownEditable(el) {
  // A link click is navigation, not "edit here": swallow the mousedown so the
  // block never takes focus (the delegated click still navigates), and commit the
  // block being edited first, since no focusout will fire.
  el.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('a')) {
      commitActiveEditingBlock();
      event.preventDefault();
    } else if (target.closest('input[type="checkbox"]')) {
      // Swallow the mousedown so a checkbox toggle doesn't focus the block (which
      // scrolls the clicked row to the top). The click still fires and flips it.
      event.preventDefault();
    }
  });
  el.addEventListener('focusin', () => {
    if (!el.__editingActive) {
      el.__editingActive = true;
      el.__editBaseline = blockDomToMarkdown(el);
    }
  });
  el.addEventListener('focusout', (event) => {
    if (event.relatedTarget && el.contains(event.relatedTarget)) return;
    el.__editingActive = false;
    commitBlockEdit(el, blockDomToMarkdown(el));
  });
  el.addEventListener('keydown', (event) => handleWysiwygKeydown(el, event));
}

// Wire `el` as a raw-source editor, for XML blocks and Markdown blocks that
// don't round-trip WYSIWYG. The block swaps to its exact source on focus and
// splices it back on blur; no change restores the rendered view, a real change
// triggers a host re-render. Unlike a WYSIWYG block it is not an editing host up
// front — `contenteditable` goes on at pointerdown, one block at a time.
function wireSourceEditable(el) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  el.addEventListener('pointerdown', (event) => {
    if (el.dataset.editingSource === 'true') return;
    // Let a link click navigate; source editing starts from a click on any
    // non-link part of the block.
    if (event.target && event.target.closest && event.target.closest('a')) return;
    event.preventDefault();
    // Swapping a rendered block (often a tall image) for its one-line source
    // collapses its height; pin the reader to the block above first, or a near-top
    // image shrinking the document would clamp the scroll to the top. focus() must
    // not scroll either — preventScroll keeps the caret from yanking the view.
    const aboveAnchor = anchorAboveElement(el);
    const src = sliceSourceBytes(currentDocumentSource, start, end);
    el.__editBaseline = src;
    el.__renderedHtml = el.innerHTML;
    el.dataset.editingSource = 'true';
    el.textContent = src;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.classList.add('leaf-editing-source');
    el.focus({ preventScroll: true });
    if (aboveAnchor) {
      readerScrollAnchor = aboveAnchor;
      restoreReaderScrollAnchor(aboveAnchor);
    }
  });
  el.addEventListener('blur', () => {
    if (el.dataset.editingSource !== 'true') return;
    const text = el.innerText;
    el.removeAttribute('contenteditable');
    el.classList.remove('leaf-editing-source');
    delete el.dataset.editingSource;
    // The block is about to grow back to its rendered height (an image re-decodes
    // from zero). Anchor to the stable block above so the reader holds its place.
    const aboveAnchor = anchorAboveElement(el);
    if (text === el.__editBaseline) {
      // No change: restore the rendered view (no host round-trip needed).
      el.innerHTML = el.__renderedHtml;
      stampLocalImages(el);
      if (aboveAnchor) {
        readerScrollAnchor = aboveAnchor;
        restoreReaderScrollAnchor(aboveAnchor);
      }
      return;
    }
    // Hand the host re-render (leafReloadDocument) that same above-anchor: its own
    // top-visible capture would target this block while it is momentarily zero-height.
    pendingEditAnchor = aboveAnchor;
    commitBlockEdit(el, text);
    // The host re-renders the document from the buffer, which restores styling.
  });
}

// Wire up every mapped block. Clean text blocks, tight lists, and tables edit
// WYSIWYG; every other block edits its source in place. A thematic break is left
// alone.
//
// One pass per kind of mutation, never one pass doing all of them per block.
// Interleaving a `contenteditable` write with the `.leaf-editable` class (which the
// `:focus` rules key on) makes each block force its own focus recomputation:
// unlocking a 50,000-block glossary took 148 SECONDS that way, half a second
// batched. Neither write is expensive alone; only alternating them is.
function bindEditableBlocks(format) {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const wysiwygBlocks = [];
  const sourceBlocks = [];
  body.querySelectorAll('[data-src-start]').forEach((el) => {
    if (el.dataset.srcStart == null || el.dataset.srcEnd == null) return;
    const kind = el.dataset.blockKind;
    if (kind === 'rule') return;
    const wysiwyg =
      format === 'markdown' &&
      (((kind === 'heading' || kind === 'paragraph') && markdownBlockWysiwygSafe(el)) ||
        (kind === 'list' && listWysiwygSafe(el)) ||
        (kind === 'table' && tableWysiwygSafe(el)) ||
        (kind === 'blockquote' && blockquoteWysiwygSafe(el)));
    if (wysiwyg) {
      wysiwygBlocks.push(el);
    } else if (Number.isFinite(Number(el.dataset.srcStart)) && Number.isFinite(Number(el.dataset.srcEnd))) {
      // A block with an unusable range gets neither the class nor a listener, the
      // same as before — wireSourceEditable's own guard would have dropped it.
      sourceBlocks.push(el);
    }
  });
  wysiwygBlocks.forEach(markMarkdownEditable);
  wysiwygBlocks.forEach((el) => el.classList.add('leaf-editable'));
  sourceBlocks.forEach((el) => el.classList.add('leaf-editable'));
  wysiwygBlocks.forEach(wireMarkdownEditable);
  sourceBlocks.forEach(wireSourceEditable);
}

// Land the caret carried across a structural edit's re-render: focus the
// destination block (by its post-splice offset) and restore the position, or open
// the chained empty insert paragraph. A missing target degrades to nothing.
function placePendingCaret(body) {
  const pending = pendingCaret;
  pendingCaret = null;
  if (!pending) return;
  // A caret queued for a different document must not grab focus in this page.
  if (pending.path && pending.path !== activeDocumentPath()) return;
  const target = body.querySelector(`[data-src-start="${pending.srcStart}"]`);
  if (!target) return;
  if (pending.insertBelow) {
    openInsertBlockAfter(target);
    return;
  }
  if (target.getAttribute('contenteditable') !== 'true') return;
  target.focus({ preventScroll: true });
  placeCaretInBlock(target, pending.textOffset || 0);
}

// Land a caret the render deferred. The reading view is decorated while hidden (see
// renderState) and a hidden element can't take focus, so this runs after the reveal.
function placeDeferredReadingCaret() {
  const body = app.querySelector('.document-body');
  if (body) placePendingCaret(body);
}

// Orchestrate the reading view's editing layer after each render: remember
// source/format, attach ranges, make checkboxes interactive, wire editors.
// `deferCaret` leaves the pending caret for placeDeferredReadingCaret().
function bindReadingEditor(doc, { deferCaret = false } = {}) {
  if (!doc) return;
  const body = app.querySelector('.document-body');
  if (!body) return;
  currentDocumentFormat = doc.format || 'markdown';
  currentDocumentSource = typeof doc.source === 'string' ? doc.source : '';
  // Checkboxes stay interactive on a locked page: a task toggle is a quick
  // action that auto-saves and records no undo, not text editing. Only the
  // click-to-type editable blocks are behind the padlock.
  if (currentDocumentFormat === 'markdown') {
    attachMarkdownBlockRanges(body, Array.isArray(doc.blocks) ? doc.blocks : [], currentDocumentSource);
    bindTaskCheckboxes(doc.tasks || []);
  }
  if (readerEditingAllowed()) {
    bindEditableBlocks(currentDocumentFormat);
  }
  if (currentDocumentFormat === 'markdown') {
    bindTableCheckboxes();
  }
  if (!deferCaret) placePendingCaret(body);
}

// Re-sync editing state after a buffer edit that needs no re-render (a task
// toggle). Refreshes the dirty state and adopts the toggled buffer as the source
// the raw-source editors slice from, or a later edit would revert the toggle.
window.leafBlocksResynced = (state) => {
  if (!state) return;
  if (typeof state.source === 'string') currentDocumentSource = state.source;
  const path = activeDocumentPath();
  if (path) {
    if (typeof state.canUndo === 'boolean') undoableByPath.set(path, state.canUndo);
    setDirtyState(path, !!state.dirty);
  }
};

