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

// Both ends of the selection as character offsets inside `el`'s visible text, or
// null unless the whole selection is inside the block. Both ends, not just the
// caret: a double-clicked word has to survive the block becoming editable under it.
function selectionTextSpanIn(el) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const upTo = (container, offset) => {
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(container, offset);
    return before.cloneContents().textContent.length;
  };
  return { start: upTo(range.startContainer, range.startOffset), end: upTo(range.endContainer, range.endOffset) };
}

// A character offset inside `el`'s visible text as a DOM point, clamped to the end.
function blockTextPoint(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset || 0);
  let lastNode = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (remaining <= node.nodeValue.length) return { node, offset: remaining };
    remaining -= node.nodeValue.length;
    lastNode = node;
  }
  return lastNode ? { node: lastNode, offset: lastNode.nodeValue.length } : null;
}

// Put the caret at a character offset inside `el`'s visible text (clamped to the
// end), walking its text nodes.
function placeCaretInBlock(el, offset) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const point = blockTextPoint(el, offset);
  if (point) range.setStart(point.node, point.offset);
  else range.selectNodeContents(el);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Put a span of `el`'s visible text back under the selection.
function selectTextSpanInBlock(el, span) {
  if (!span || span.end <= span.start) {
    placeCaretInBlock(el, span ? span.start : 0);
    return;
  }
  const selection = window.getSelection();
  const from = blockTextPoint(el, span.start);
  const to = blockTextPoint(el, span.end);
  if (!selection || !from || !to) {
    placeCaretInBlock(el, span.start);
    return;
  }
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isSourceSpaceByte(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

// Whether a block serialized to nothing. Chromium leaves a `<br>` behind in a
// contenteditable whose text has all gone, and a heading always writes its
// hashes, so neither counts as text.
function blockSerializationEmpty(text, kind) {
  const bare = String(text == null ? '' : text)
    .replace(/<br\s*\/?>/gi, '')
    .trim();
  return kind === 'heading' ? /^#*$/.test(bare) : bare === '';
}

// The range a whole-block delete covers: the block, plus the blank line after it.
// A mapped range stops short of that separator (`trim_block_end`), so splicing the
// range alone would leave the blank lines from both sides stacked. The last block
// has nothing after it and takes the run before instead.
function blockDeleteRange(source, start, end) {
  const bytes = sourceByteEncoder.encode(source || '');
  let from = Math.max(0, Math.min(start, bytes.length));
  let to = Math.max(from, Math.min(end, bytes.length));
  while (to < bytes.length && isSourceSpaceByte(bytes[to])) to += 1;
  if (to >= bytes.length) {
    while (from > 0 && isSourceSpaceByte(bytes[from - 1])) from -= 1;
  }
  return { start: from, end: to };
}

// Where the caret goes when a run of blocks is taken away: the end of the block
// above it, or the start of the one below when the run started the document. The
// offsets are post-splice — a block above keeps its own, one below moves up to
// where the run started.
function caretAfterBlockDelete(first, last, span) {
  const offsetOf = (node) => (node && node.dataset ? Number(node.dataset.srcStart) : NaN);
  const prev = first.previousElementSibling;
  if (Number.isFinite(offsetOf(prev))) {
    return { srcStart: offsetOf(prev), textOffset: visibleTextLength(prev) };
  }
  if (Number.isFinite(offsetOf(last.nextElementSibling))) {
    return { srcStart: span.start, textOffset: 0 };
  }
  // Nothing either side: the document is now empty, and bindReadingEditor opens
  // its blank pair rather than a caret landing anywhere.
  return null;
}

// The Markdown a block's kind writes in front of its text. A heading's level comes
// off the tag the renderer chose, which is where the serializer reads it too.
function blockMarkerOf(el) {
  if (!el || el.dataset.blockKind !== 'heading') return '';
  return '#'.repeat(Number(el.tagName.substring(1)) || 1) + ' ';
}

// Whether a block can lose part of itself and be rebuilt from what is left. Only a
// paragraph and a heading round-trip from their rendered DOM back to source
// (`kind_is_editable`), so every other kind a selection touches goes whole rather
// than becoming a half the app cannot claim to write.
function blockCanBeCutInHalf(el) {
  const kind = el.dataset.blockKind;
  return (kind === 'paragraph' || kind === 'heading') && markdownBlockWysiwygSafe(el);
}

// A block typed empty is a block taken away, not a `##` or a `<br>` written into
// the file. Only a paragraph or a heading committing its whole range: a fence
// commits a narrower one, where empty means an empty fence and not a missing one.
// It goes through sendBlockSplice because the DOM still shows the emptied block,
// and a later blur replaying that range against the new buffer is what that stops.
function deleteEmptiedBlock(el, text) {
  const kind = el.dataset.blockKind;
  if (kind !== 'paragraph' && kind !== 'heading') return false;
  if (!blockSerializationEmpty(text, kind)) return false;
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  // A zero-length range is a block that is only in the DOM — nothing to delete.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const span = blockDeleteRange(currentDocumentSource, start, end);
  const landing = caretAfterBlockDelete(el, el, span);
  sendBlockSplice(el, span.start, span.end, '');
  if (landing) setPendingCaret(landing);
  return true;
}

// The blocks a selection covers, first to last, as one run of siblings — or null,
// which leaves the key to the browser. Two ends can have different parents because
// a raw-HTML wrapper nests the blocks after it, and a zero-length range is a block
// that is only in the DOM, with no offset in the buffer to splice from.
function blockRunForDelete(first, last) {
  if (!first || !last || first === last) return null;
  const parent = first.parentElement;
  if (!parent || last.parentElement !== parent) return null;
  const siblings = Array.from(parent.children).filter(blockHasSource);
  const from = siblings.indexOf(first);
  const to = siblings.indexOf(last);
  if (from < 0 || to <= from) return null;
  const elements = siblings.slice(from, to + 1);
  const ranges = blockRunRanges(elements);
  return ranges ? { elements, ranges } : null;
}

// The mapped block one end of a selection sits in. Not `selectionEditableBlock`,
// which matches only an editing host — a code fence or an image at either end is
// invisible to it, and the delete would then take half of one.
function selectionBlockAt(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !el.closest) return null;
  const block = el.closest('[data-src-start]');
  return block && app.contains(block) ? block : null;
}

// What survives at one end of the selection: the part of the block outside it, as
// Markdown and as the count of visible characters, which is what a caret is measured
// in. A block that cannot be cut in half survives as nothing and goes whole.
function survivingHalf(el, container, offset, keepStart) {
  if (!blockCanBeCutInHalf(el)) return { markdown: '', text: 0 };
  const part = document.createRange();
  part.selectNodeContents(el);
  if (keepStart) part.setEnd(container, offset);
  else part.setStart(container, offset);
  const contents = part.cloneContents();
  return { markdown: inlineDomToMarkdown(contents).trim(), text: contents.textContent.trim().length };
}

// The one splice a cross-block delete makes: the first block's start to the last
// one's end, carrying the surviving halves joined into a single block. Everything
// between them is never serialized — it is simply not in the replacement. The kind
// comes from the first block that keeps any of its own text, so a run whose first
// block went whole does not leave the last one's heading as body text.
function crossBlockDeletePlan(source, first, last, head, tail) {
  const joined = head.markdown + tail.markdown;
  if (!joined) {
    const span = blockDeleteRange(source, first.start, last.end);
    return { start: span.start, end: span.end, text: '' };
  }
  return { start: first.start, end: last.end, text: (head.markdown ? first.marker : last.marker) + joined };
}

// Delete or Backspace over a selection that leaves the block it started in. Each
// block is its own editing host, so the browser has no answer here — and letting it
// try would edit the DOM under the splice and leave a focused block's blur
// replaying a range the buffer no longer has.
function handleBlockRunDeleteKey(event) {
  if (event.isComposing) return;
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  if (codeViewActive || currentDocumentFormat !== 'markdown' || !readerEditingAllowed()) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const run = blockRunForDelete(
    selectionBlockAt(range.startContainer),
    selectionBlockAt(range.endContainer),
  );
  if (!run) return;
  event.preventDefault();
  deleteBlockRun(run, range);
}

// Splice a run of blocks away, keeping whatever the selection left at each end.
function deleteBlockRun({ elements, ranges }, range) {
  const first = elements[0];
  const last = elements[elements.length - 1];
  const head = survivingHalf(first, range.startContainer, range.startOffset, true);
  const tail = survivingHalf(last, range.endContainer, range.endOffset, false);
  const plan = crossBlockDeletePlan(
    currentDocumentSource,
    { start: ranges[0][0], marker: blockMarkerOf(first) },
    { end: ranges[ranges.length - 1][1], marker: blockMarkerOf(last) },
    head,
    tail,
  );
  sendBlockSplice(first, plan.start, plan.end, plan.text);
  // Every block in the run still shows its pre-splice content, so each one's blur
  // baseline is neutralized — not just the one the splice was sent against.
  for (const el of elements) el.__editBaseline = blockDomToMarkdown(el);
  const landing = plan.text
    ? { srcStart: plan.start, textOffset: head.markdown ? head.text : 0 }
    : caretAfterBlockDelete(first, last, plan);
  if (landing) setPendingCaret(landing);
}

// Registered once, at the fragment's top level. Every other listener in this
// fragment is per block and re-bound on each render, so one inside
// bindReadingEditor would stack a copy per render.
window.addEventListener('keydown', handleBlockRunDeleteKey);

// The run of blocks a heading owns: the nearest heading at or above `el`, down to
// the next heading of ANY level or the end of the document. So deleting a `##`
// leaves a `###` under it standing, and the section is never more than what was on
// screen when it was picked. A block with no heading above it takes the run from the
// first block down to the first heading.
function blockSectionRun(el) {
  const parent = el && el.parentElement;
  if (!parent) return null;
  const siblings = Array.from(parent.children).filter(blockHasRange);
  const index = siblings.indexOf(el);
  if (index < 0) return null;
  const isHeading = (node) => node.dataset.blockKind === 'heading';
  let from = index;
  while (from > 0 && !isHeading(siblings[from])) from -= 1;
  if (!isHeading(siblings[from])) from = 0;
  let to = from;
  while (to + 1 < siblings.length && !isHeading(siblings[to + 1])) to += 1;
  return siblings.slice(from, to + 1);
}

// Highlight a run of blocks. The browser paints a selection across blocks on its
// own, so there is nothing to draw.
function selectBlockRun(elements) {
  const selection = window.getSelection();
  if (!selection || !elements || !elements.length) return false;
  const range = document.createRange();
  range.setStartBefore(elements[0]);
  range.setEndAfter(elements[elements.length - 1]);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// Which step Ctrl+A is on, read off what is already selected rather than counted:
// so a caret moved between two presses starts again by itself, with nothing to
// reset. 1 — the block is not selected yet, so the browser does it. 2 — the whole
// block is, so the section is next. 3 — the selection has already left the block.
function selectAllStep(spans, covers, whole) {
  if (spans) return 3;
  return whole > 0 && covers < whole ? 1 : 2;
}

// The block the caret is in, for Ctrl+A's stepping — an editing host in the
// document, the only place a caret can be. A locked page has none, and a block
// showing its raw source keeps the browser's own select-all, so both take Ctrl+A the
// way they always have: one press, the whole page.
function caretBlockForSelectAll(target) {
  const block = selectionBlockAt(target);
  if (!block || block.dataset.editingSource === 'true') return null;
  return block.getAttribute('contenteditable') === 'true' ? block : null;
}

// What Ctrl+A does with the caret in `block`: leave it to the browser, take the
// block's section, or take the whole page. A heading with nothing under it has no
// section worth a press of its own — its section is the block the first press
// already selected — so it goes straight to the page.
function selectAllTargetFor(block) {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  const spans =
    !!range &&
    (selectionBlockAt(range.startContainer) !== block || selectionBlockAt(range.endContainer) !== block);
  const step = selectAllStep(spans, range ? range.toString().trim().length : 0, block.textContent.trim().length);
  if (step === 1) return { browser: true };
  if (step === 2) {
    const section = blockSectionRun(block);
    if (section && !(section.length === 1 && section[0] === block)) return { section };
  }
  return { page: true };
}

// Send an edit for `el`'s source range, only if `text` differs from the baseline
// captured when editing began (so a no-edit focus costs nothing). If the caret
// already moved into another block, carry it across this commit's re-render
// (adjusting for the splice's offset shift) so it isn't dumped out.
//
// `range` overrides the block's own: a fenced code block edits the inside of its
// fences, so what it writes back is narrower than the block.
function commitBlockEdit(el, text, range) {
  // A block the page has already replaced describes a buffer that has moved on —
  // a re-render blurs it, and that blur must not splice yesterday's offsets.
  if (!el.isConnected) return;
  const start = range ? range.start : Number(el.dataset.srcStart);
  const end = range ? range.end : Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (text === el.__editBaseline) return;
  if (!range && deleteEmptiedBlock(el, text)) return;
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
  const prefix = blockMarkerOf(el);
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

// An editable block that exists only in the DOM: no source range yet, because
// Markdown has no empty block to give it one. `placeholder` is the gray wording
// it shows while it is blank — carried on a `data-` attribute the stylesheet
// prints, and switched off by the first keystroke rather than by `:empty`, which
// a contenteditable's leftover `<br>` would defeat.
//
// `insertAt` is where the block's first commit will splice, stamped as a
// zero-length source range so the block gutter can find the block and offer its
// plus. Zero length is also how the gutter knows not to offer the grip: a block
// with no text in the buffer has nothing to drag.
function makeBlankBlock(tag, kind, placeholder, insertAt) {
  const block = document.createElement(tag);
  block.className = 'leaf-editable leaf-insert-block';
  block.dataset.blockKind = kind;
  block.dataset.blank = 'true';
  block.dataset.srcStart = String(insertAt);
  block.dataset.srcEnd = String(insertAt);
  if (placeholder) block.dataset.placeholder = placeholder;
  block.setAttribute('contenteditable', 'true');
  block.setAttribute('spellcheck', 'false');
  block.addEventListener('input', () => {
    block.dataset.blank = block.textContent.trim() ? 'false' : 'true';
  });
  return block;
}

// The blocks the insert row OPENS rather than writes: an empty block of that
// kind, showing gray wording, with nothing in the buffer until the first
// keystroke — `marker` is the Markdown that keystroke commits behind. Splicing
// the word "Heading" in instead leaves it there when you change your mind.
// A line Enter opened rather than the row: it says nothing, because you are
// already writing and being told to write would be noise.
const PLAIN_LINE_SPEC = { tag: 'p', kind: 'paragraph', placeholder: '', marker: '' };
// An empty line asked for by name gets one of these instead of one fixed word,
// rolled per line the way the home screen rolls its palm-leaf facts. Same voice,
// shorter: this one sits in the document, where a sentence would read as text
// somebody left behind.
const BLANK_LINE_PROMPTS = [
  'Write on...',
  'Turn over a new leaf...',
  'The leaf is blank...',
  'Say it here...',
  'Begin anywhere...',
  'Straight onto the leaf...',
];
const BLANK_BLOCK_SPECS = {
  text: { tag: 'p', kind: 'paragraph', prompts: BLANK_LINE_PROMPTS, marker: '' },
  heading: { tag: 'h2', kind: 'heading', placeholder: 'Name this part...', marker: '## ' },
  list: { tag: 'li', kind: 'list', placeholder: 'First of a list...', marker: '- ', wrap: 'ul' },
  quote: { tag: 'blockquote', kind: 'blockquote', placeholder: 'Someone else’s words...', marker: '> ' },
};

// A list item has to stand in a list to look like one, so a spec may ask for a
// wrapper. `host` is what goes in the page; `block` is what you type in.
function makeBlankHost(spec, insertAt) {
  const wording = spec.prompts
    ? spec.prompts[Math.floor(Math.random() * spec.prompts.length)]
    : spec.placeholder;
  const block = makeBlankBlock(spec.tag, spec.kind, wording, insertAt);
  if (!spec.wrap) return { host: block, block };
  const host = document.createElement(spec.wrap);
  host.appendChild(block);
  return { host, block };
}

// A fresh empty block, ready to type into. Markdown cannot hold an empty block,
// so it exists only in the DOM until its first commit, which splices `separator`
// + the spec's marker + the typed text in at `insertAt`. Enter commits and chains
// another below (continuous writing flow); Backspace on the empty block dissolves
// it back into `previous`; clicking away commits, or dissolves it if nothing was
// typed -- unless `keepEmpty`, since an empty document has no other block to
// click into and removing this one would leave nowhere to type.
function openInsertBlock(
  insertAt,
  { spec = PLAIN_LINE_SPEC, separator = '\n\n', suffix = '', place, previous = null, keepEmpty = false },
) {
  const { host, block } = makeBlankHost(spec, insertAt);
  const prefix = separator + spec.marker;
  place(host);
  const commit = (chainBelow, chainSpec) => {
    if (block.__committed) return true;
    const text = inlineDomToMarkdown(block).trim();
    if (!text) return false;
    block.__committed = true;
    sendEditCommand({
      command: 'editBlock',
      start: insertAt,
      end: insertAt,
      text: prefix + text + suffix,
    });
    if (chainBelow) {
      setPendingCaret({
        srcStart: insertAt + utf8ByteLength(separator),
        insertBelow: true,
        blockSpec: chainSpec,
      });
    }
    return true;
  };
  // What the block gutter's plus does here. This block is not in the buffer, so
  // an insert "after" it has nothing to be after: the one splice has to carry
  // whatever was typed AND the new block, or pressing plus mid-sentence would
  // drop the sentence.
  block.__insertBlockWith = (option) => {
    if (block.__committed) return;
    block.__committed = true;
    const typed = inlineDomToMarkdown(block).trim();
    const lead = (typed ? prefix + typed + '\n\n' : separator);
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: lead + option.text + suffix });
    if (option.caret) {
      setPendingCaret({ srcStart: insertAt + utf8ByteLength(lead) });
    }
  };
  // What the format bar does here. This line is not in the buffer, so its own commit
  // carries the marker — a splice from outside lands beside the words, and the blur
  // commit then writes them again.
  block.__commitAs = (marker) => {
    if (block.__committed) return;
    const typed = inlineDomToMarkdown(block).trim();
    if (!typed) return;
    block.__committed = true;
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: separator + marker + typed + suffix });
    setPendingCaret({ srcStart: insertAt + utf8ByteLength(separator), textOffset: 0 });
  };
  // The plus pressed on this very line: it is empty, so it becomes the kind that
  // was picked rather than growing a second block beside it.
  block.__becomeBlock = (specId) => {
    const next = BLANK_BLOCK_SPECS[specId];
    if (!next || block.__committed || inlineDomToMarkdown(block).trim()) return;
    host.remove();
    openInsertBlock(insertAt, { spec: next, separator, suffix, place, previous, keepEmpty });
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
      if (!previous) return;
      host.remove();
      previous.focus({ preventScroll: true });
      placeCaretInBlock(previous, visibleTextLength(previous));
    }
  });
  // What the block gutter's plus does when the line below is what was pressed:
  // save this one and open the next, the same as Enter.
  block.__lineBelow = (specId) => {
    if (!commit(true, specId)) block.focus({ preventScroll: true });
  };
  block.addEventListener('blur', (event) => {
    // The gutter has the focus, not the page: this block's words are about to be
    // saved by whatever was pressed there.
    if (blockGutterHoldsFocus(event.relatedTarget)) return;
    if (!commit(false) && !keepEmpty) host.remove();
  });
  block.focus({ preventScroll: true });
}
function openInsertBlockAfter(el, specId) {
  const insertAt = Number(el.dataset.srcEnd);
  if (!Number.isFinite(insertAt)) return;
  openInsertBlock(insertAt, {
    spec: BLANK_BLOCK_SPECS[specId] || PLAIN_LINE_SPEC,
    place: (host) => el.insertAdjacentElement('afterend', host),
    previous: el,
  });
}
// A document with nothing in it opens the way a blank page should read: a title,
// then a line to start writing — and the title IS the first `# heading`, so the
// name of the piece is part of the piece rather than a field beside it.
//
// Neither block is in the source yet, so the pair commits as ONE splice at offset
// zero. That is the whole reason they are handled together: two DOM-only blocks
// each holding "insert at 0" would overwrite each other, whichever committed second.
//
// Placed ahead of the pager placeholder, so the writing starts at the top of the
// page rather than under its footer.
function openMediumStart(body) {
  const title = makeBlankBlock('h1', 'heading', 'Name the leaf...', 0);
  // The line under the title is a paragraph until the insert row says otherwise:
  // pick Heading or List there and this becomes one, since an empty line is the
  // kind it is told to be rather than a thing to write a word into.
  let storyHost = makeBlankBlock('p', 'paragraph', 'Turn over a new leaf...', 0);
  let story = storyHost;
  let storyMarker = '';
  let titleMarker = '# ';
  body.insertBefore(storyHost, body.firstChild);
  body.insertBefore(title, body.firstChild);
  let committed = false;
  // The one splice the pair makes. `chainBelow` continues the writing flow —
  // after it, reopen an empty paragraph under the story line the way Enter does
  // anywhere else. `extra` is the block gutter's plus arriving instead: the same
  // splice, with the chosen block on the end, so pressing plus with a title typed
  // keeps the title.
  const commit = (chainBelow, extra, chainSpec) => {
    if (committed) return true;
    const titleText = inlineDomToMarkdown(title).trim();
    const storyText = inlineDomToMarkdown(story).trim();
    if (!titleText && !storyText && !extra) return false;
    committed = true;
    const parts = [];
    if (titleText) parts.push(titleMarker + titleText);
    if (storyText) parts.push(storyMarker + storyText);
    const lead = parts.length ? parts.join('\n\n') + '\n\n' : '';
    const text = extra ? lead + extra.text : parts.join('\n\n');
    sendEditCommand({ command: 'editBlock', start: 0, end: 0, text });
    if (extra) {
      if (extra.caret) {
        setPendingCaret({ srcStart: utf8ByteLength(lead) });
      }
    } else if (chainBelow && parts.length) {
      // Under the last thing written, whichever of the pair that was: a title on
      // its own is still something to carry on below.
      setPendingCaret({
        srcStart: utf8ByteLength(text) - utf8ByteLength(parts[parts.length - 1]),
        insertBelow: true,
        blockSpec: chainSpec,
      });
    }
    return true;
  };
  title.__insertBlockWith = (option) => commit(false, option);
  // Clicking the space below the pair. Neither block is in the buffer yet, so it
  // has to go through this same one splice — an insert of its own would be undone
  // by the pair's own save a moment later, and the new line would flash and vanish
  // on a document's first one.
  title.__lineBelow = (specId) => {
    if (!commit(true, null, specId)) story.focus({ preventScroll: true });
  };
  // The plus on the story line, which is empty by definition: it becomes the kind
  // that was picked. Nothing is written — this line is not in the buffer yet.
  title.__becomeBlock = (specId) => {
    const next = BLANK_BLOCK_SPECS[specId];
    if (!next || committed || inlineDomToMarkdown(story).trim()) return;
    const made = makeBlankHost(next, 0);
    storyHost.replaceWith(made.host);
    storyHost = made.host;
    story = made.block;
    storyMarker = next.marker;
    wireStartBlock(story);
    story.focus({ preventScroll: true });
  };
  // The format bar on either of the pair. All it can do is change the marker that
  // line commits with — neither is in the buffer for a splice to land on.
  title.__commitAs = (marker, target) => {
    if (committed) return;
    if (target === title) titleMarker = marker;
    else storyMarker = marker;
    commit(false);
  };
  const carryPairHooks = (block) => {
    block.__insertBlockWith = title.__insertBlockWith;
    block.__lineBelow = title.__lineBelow;
    block.__becomeBlock = title.__becomeBlock;
    block.__commitAs = title.__commitAs;
  };
  const inPair = (node) => !!node && (title.contains(node) || story.contains(node));
  const wireStartBlock = (block) => {
    carryPairHooks(block);
    block.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        block.blur();
        return;
      }
      // Backspace on an empty story line steps back up into the title, the
      // mirror of Enter walking down.
      if (event.key === 'Backspace' && block === story && !inlineDomToMarkdown(story).trim()) {
        event.preventDefault();
        title.focus({ preventScroll: true });
        placeCaretInBlock(title, visibleTextLength(title));
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      // Enter in the title walks down to the story line rather than committing —
      // a title with no story under it is not a document yet.
      if (block === title) {
        story.focus({ preventScroll: true });
        placeCaretInBlock(story, visibleTextLength(story));
        return;
      }
      commit(true);
    });
    // Leaving the pair for anything outside it writes whatever was typed. Nothing
    // typed leaves both blocks standing: an empty document has nowhere else for
    // the caret to go, and removing them would leave the page untypable.
    block.addEventListener('focusout', (event) => {
      if (inPair(event.relatedTarget)) return;
      // The gutter has the focus: what was pressed there writes this pair itself.
      if (blockGutterHoldsFocus(event.relatedTarget)) return;
      commit(false);
    });
  };
  wireStartBlock(title);
  wireStartBlock(story);
  title.focus({ preventScroll: true });
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
      // The class, not `contenteditable`: the block above is only a host once it has
      // been clicked into, and merging up must work the first time.
      if (
        prev &&
        prev.classList &&
        prev.classList.contains('leaf-editable') &&
        (prev.dataset.blockKind === 'paragraph' || prev.dataset.blockKind === 'heading')
      ) {
        event.preventDefault();
        mergeBlockIntoPrevious(el, prev);
      }
    }
  }
}

// Mark `el` editable — the class and the checkbox islands, not `contenteditable`.
// **A block is not an editing host until it is clicked into.** A host confines a
// selection to itself, so making every block one meant a drag could never leave the
// block it started in and there was nothing to select, copy or delete across two of
// them. The page is plain text until you point at a line, which is also why nothing
// is written per block at unlock any more.
function markMarkdownEditable(el) {
  el.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('contenteditable', 'false'));
}

// Whether `el` is open for typing right now.
function blockIsEditingHost(el) {
  return !!el && !!el.getAttribute && el.getAttribute('contenteditable') === 'true';
}

// Open `el` for typing and put `span` back under the selection — a caret where a
// click landed, or the word a double-click took. Turning the attribute on moves the
// selection, so where it was is captured before and restored after.
function openWysiwygBlock(el, span) {
  if (blockIsEditingHost(el)) return;
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'false');
  el.focus({ preventScroll: true });
  selectTextSpanInBlock(el, span);
}

// Hand the block back to the page, so the next drag can leave it.
function closeWysiwygBlock(el) {
  el.removeAttribute('contenteditable');
  el.removeAttribute('spellcheck');
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
  // The press that opens the block, decided on release rather than on the way down:
  // only then is it known whether this was a click or a drag. Both ends of the
  // selection inside this block means the pointer never left it, so it is this
  // block's to open; a drag that reached another block leaves both alone and stands
  // as the cross-block selection it is.
  el.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || blockIsEditingHost(el)) return;
    const target = event.target;
    if (target && target.closest && target.closest('a, input[type="checkbox"]')) return;
    const span = selectionTextSpanIn(el);
    if (!span) return;
    openWysiwygBlock(el, span);
  });
  el.addEventListener('focusin', () => {
    if (!el.__editingActive) {
      el.__editingActive = true;
      el.__editBaseline = blockDomToMarkdown(el);
    }
  });
  el.addEventListener('focusout', (event) => {
    if (event.relatedTarget && el.contains(event.relatedTarget)) return;
    // The selection bar's link box has the focus. Committing now would re-render
    // the page out from under the very selection the URL is about to wrap. The
    // block gutter is the same bargain: what was pressed there saves this block
    // itself, in the order that keeps the offsets true.
    if (selectionToolbarHoldsFocus(event.relatedTarget)) return;
    if (blockGutterHoldsFocus(event.relatedTarget)) return;
    el.__editingActive = false;
    commitBlockEdit(el, blockDomToMarkdown(el));
    // Back to being page rather than editor, so the next drag can leave it.
    closeWysiwygBlock(el);
  });
  el.addEventListener('keydown', (event) => handleWysiwygKeydown(el, event));
}

// A fenced code block's inside, as offsets into `src`. The fences are what make it a
// code block, so offering them for editing puts one backspace between the reader and
// a broken document. Null unless BOTH are found — this range is spliced verbatim, so
// an indented or unterminated block falls back to editing the whole thing.
function fencedCodeInnerSpan(src) {
  const open = /^[ \t]*(`{3,}|~{3,})[^\n]*\n/.exec(src);
  if (!open) return null;
  const fence = open[1];
  // Matched at the end so a fence drawn inside the code cannot be taken for the
  // one that closes the block, and only by a run at least as long as the opener's.
  const close = new RegExp('\\n[ \\t]*' + fence[0] + '{' + fence.length + ',}[ \\t]*$').exec(src);
  if (!close) return null;
  const from = open[0].length;
  // close.index is the newline ending the last code line, which belongs to the
  // separator. Below `from` it is the opener's own: an empty fence, no range to edit.
  if (close.index < from) return null;
  return { from, to: close.index };
}

// Wire `el` as a raw-source editor, for XML blocks and Markdown blocks that
// don't round-trip WYSIWYG. The block swaps to its exact source on focus and
// splices it back on blur; no change restores the rendered view, a real change
// triggers a host re-render. Unlike a WYSIWYG block it is not an editing host up
// front — `contenteditable` goes on at pointerdown, one block at a time.
function wireSourceEditable(el) {
  const blockStart = Number(el.dataset.srcStart);
  const blockEnd = Number(el.dataset.srcEnd);
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return;
  let start = blockStart;
  let end = blockEnd;
  if (el.dataset.blockKind === 'code_block') {
    const src = sliceSourceBytes(currentDocumentSource, blockStart, blockEnd);
    const span = fencedCodeInnerSpan(src);
    // The span counts characters and the buffer counts bytes, and the code inside can
    // be anything — so both ends are converted rather than assumed ASCII.
    if (span) {
      start = blockStart + utf8ByteLength(src.slice(0, span.from));
      end = blockStart + utf8ByteLength(src.slice(0, span.to));
    }
  }
  // Held on the block so a control elsewhere can open the same edit: a drawn
  // diagram is dragged to pan, so its source comes from a corner button instead
  // (decorate.js). Everything else still opens on a press.
  el.__startSourceEdit = () => {
    if (el.dataset.editingSource === 'true') return;
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
  };
  el.addEventListener('pointerdown', (event) => {
    if (el.dataset.editingSource === 'true') return;
    // Let a link click navigate; source editing starts from a click on any
    // non-link part of the block.
    if (event.target && event.target.closest && event.target.closest('a')) return;
    if (el.dataset.processed === 'true' && el.classList.contains('mermaid')) return;
    event.preventDefault();
    el.__startSourceEdit();
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
    commitBlockEdit(el, text, { start, end });
    // The host re-renders the document from the buffer, which restores styling.
  });
}

// A block opened from somewhere other than a press on it. Silent on a block that
// was never wired: a diagram in a locked document has no edit to open.
function startBlockSourceEdit(el) {
  if (el && typeof el.__startSourceEdit === 'function') el.__startSourceEdit();
}

// Wire up every mapped block. Clean text blocks, tight lists, and tables edit
// WYSIWYG; every other block edits its source in place. A thematic break is left
// alone.
//
// One pass per kind of mutation, never one pass doing all of them per block.
// Interleaving a `contenteditable` write with the `.leaf-editable` class (which the
// `:focus` rules key on) made each block force its own focus recomputation:
// unlocking a 50,000-block glossary took 148 SECONDS that way, half a second
// batched. No block is made an editing host at unlock at all now — that happens on
// the click that opens one — so the passes stay separate on the same principle
// rather than because either is still expensive.
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
      // A block with an unusable range gets neither the class nor a listener;
      // wireSourceEditable's own guard would drop it anyway.
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
  if (pending.emptyDocument) {
    openMediumStart(body);
    return;
  }
  const target = body.querySelector(`[data-src-start="${pending.srcStart}"]`);
  if (!target) return;
  if (pending.insertBelow) {
    openInsertBlockAfter(target, pending.blockSpec);
    return;
  }
  // The block is not a host until something opens it, and landing a caret is one of
  // the things that does — the edit before this one was typed, so typing carries on.
  if (!target.classList.contains('leaf-editable') || target.dataset.editingSource === 'true') return;
  const offset = pending.textOffset || 0;
  openWysiwygBlock(target, { start: offset, end: offset });
  if (blockIsEditingHost(target)) {
    target.focus({ preventScroll: true });
    placeCaretInBlock(target, offset);
  }
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
    // An unlocked document with no blocks in it -- a new one -- has nothing to
    // click into. Open its first line, or the page is unlocked and untypable.
    if (currentDocumentFormat === 'markdown' && !pendingCaret && !body.querySelector('[data-src-start]')) {
      setPendingCaret({ emptyDocument: true });
    }
  }
  if (currentDocumentFormat === 'markdown') {
    bindTableCheckboxes();
    bindFrontmatterFields(body);
  }
  // The gutter and the selection bar read the format and the unlock, so they bind
  // after both are set.
  bindBlockControls();
  bindSelectionToolbar();
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

