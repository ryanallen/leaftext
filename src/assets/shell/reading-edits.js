function utf8ByteLength(text) {
  return sourceByteEncoder.encode(text).length;
}

// Claim the caret for the next render, stamped with its document so a caret queued before a navigation can't land in the newly opened page.
function setPendingCaret(next) {
  pendingCaret = next ? { ...next, path: activeDocumentPath() } : null;
}

// What the tab's dot, Save, Undo and Redo said before a typing session raised them, and which document it was. Null while nothing is raised on typing alone. The four are moved at the first keystroke, since words on screen have to be savable and undoable before anything is clicked out of and the future a press too many left standing is about to end; this is what puts them back where the host had them if the session ends up writing nothing.
let chromeBeforeTyping = null;

// The first keystroke of a typing session: promise the save and the undo the actions make good on. Silent after the first, and silent once a commit has gone out, which is when the promise stops being local.
function raiseTypingChrome() {
  const path = activeDocumentPath();
  if (!path || chromeBeforeTyping) return;
  chromeBeforeTyping = {
    path,
    dirty: isDocumentDirty(path),
    undoable: undoableByPath.get(path) === true,
    redoable: redoableByPath.get(path) === true,
  };
  undoableByPath.set(path, true);
  redoableByPath.delete(path);
  setDirtyState(path, true);
  updateEditingChrome();
}

// A session that wrote nothing — typed and taken back to where it started, or abandoned — puts the four back to the host's own answer. A document that was already dirty stays dirty, and a future nothing ended is still there.
function lowerTypingChrome() {
  const held = chromeBeforeTyping;
  chromeBeforeTyping = null;
  if (!held) return;
  if (held.undoable) undoableByPath.set(held.path, true);
  else undoableByPath.delete(held.path);
  if (held.redoable) redoableByPath.set(held.path, true);
  else redoableByPath.delete(held.path);
  setDirtyState(held.path, held.dirty);
  updateEditingChrome();
}

// The caret has left every surface that types. Whatever the session wrote is already on the wire, so a record still standing is one that wrote nothing. Deferred a tick because the commit and the focus change land in either order depending on which editor it was.
function endTypingSession() {
  window.setTimeout(() => {
    if (!chromeBeforeTyping || typingSurfaceHasFocus()) return;
    lowerTypingChrome();
  }, 0);
}

// Whether the caret is still in something that types — the add row's two boxes are one session, so stepping between them must not end it.
function typingSurfaceHasFocus() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.classList && active.classList.contains('frontmatter-input')) return true;
  return !!active.getAttribute && active.getAttribute('contenteditable') === 'true';
}

window.addEventListener('focusout', endTypingSession);

// Send a buffer-mutating reading-view command. Each lands one host undo snapshot, and this raises the dirty state (Save button + tab dot) optimistically.
function sendEditCommand(message) {
  const path = activeDocumentPath();
  if (path) {
    // The session has written something, so the raise is no longer a promise to take back.
    chromeBeforeTyping = null;
    undoableByPath.set(path, true);
    // A fresh edit ends whatever the last undo left standing, in the buffer and so on the button.
    redoableByPath.delete(path);
    setDirtyState(path, true);
    // The toggle's saved pixels no longer describe this text.
    forgetViewHandoff();
    // Undo just became available and Redo just went, which setDirtyState only reflects when the dirty flag itself changed — on the second and later edits it has not.
    updateEditingChrome();
  }
  send(message);
}

function visibleTextLength(el) {
  return el.textContent.length;
}

// The caret's character offset inside `el`'s visible text, or null when the selection is missing, uncollapsed, or outside the block.
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

// Both ends of the selection as character offsets inside `el`'s visible text, or null unless the whole selection is inside the block. Both ends, not just the caret: a double-clicked word has to survive the block becoming editable under it.
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
function blockTextPoint(el, offset, preferNextAtBoundary = false) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset || 0);
  let lastNode = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (remaining < node.nodeValue.length || (!preferNextAtBoundary && remaining === node.nodeValue.length)) {
      return { node, offset: remaining };
    }
    remaining -= node.nodeValue.length;
    lastNode = node;
  }
  return lastNode ? { node: lastNode, offset: lastNode.nodeValue.length } : null;
}

// Put the caret at a character offset inside `el`'s visible text (clamped to the end), walking its text nodes.
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
  const from = blockTextPoint(el, span.start, true);
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

// Whether a block serialized to nothing. Chromium leaves a `<br>` behind in a contenteditable whose text has all gone, and a heading always writes its hashes, so neither counts as text.
function blockSerializationEmpty(text, kind) {
  const bare = String(text == null ? '' : text)
    .replace(/<br\s*\/?>/gi, '')
    .trim();
  return kind === 'heading' ? /^#*$/.test(bare) : bare === '';
}

// The range a whole-block delete covers: the block, plus the blank line after it. A mapped range stops short of that separator (`trim_block_end`), so splicing the range alone would leave the blank lines from both sides stacked. The last block has nothing after it and takes the run before instead.
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

// Where the caret goes when a run of blocks is taken away: the end of the block above it, or the start of the one below when the run started the document. The offsets are post-splice — a block above keeps its own, one below moves up to where the run started.
function caretAfterBlockDelete(first, last, span) {
  const offsetOf = (node) => (node && node.dataset ? Number(node.dataset.srcStart) : NaN);
  const prev = first.previousElementSibling;
  if (Number.isFinite(offsetOf(prev))) {
    return { srcStart: offsetOf(prev), textOffset: visibleTextLength(prev) };
  }
  if (Number.isFinite(offsetOf(last.nextElementSibling))) {
    return { srcStart: span.start, textOffset: 0 };
  }
  // Nothing either side: the document is now empty, and bindReadingEditor opens its blank pair rather than a caret landing anywhere.
  return null;
}

// The Markdown a block's kind writes in front of its text. A heading's level comes off the tag the renderer chose, which is where the serializer reads it too.
function blockMarkerOf(el) {
  if (!el || el.dataset.blockKind !== 'heading') return '';
  return '#'.repeat(Number(el.tagName.substring(1)) || 1) + ' ';
}

// Whether a block can lose part of itself and be rebuilt from what is left. Only a paragraph and a heading round-trip from their rendered DOM back to source (`kind_is_editable`), so every other kind a selection touches goes whole rather than becoming a half the app cannot claim to write.
function blockCanBeCutInHalf(el) {
  const kind = el.dataset.blockKind;
  return (kind === 'paragraph' || kind === 'heading') && markdownBlockWysiwygSafe(el);
}

// A block typed empty is a block taken away, not a `##` or a `<br>` written into the file. Only a paragraph or a heading committing its whole range: a fence commits a narrower one, where empty means an empty fence and not a missing one. It goes through sendBlockSplice because the DOM still shows the emptied block, and a later blur replaying that range against the new buffer is what that stops.
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

// The blocks a selection covers, first to last, as one run of siblings — or null, which leaves the key to the browser. Two ends can have different parents because a raw-HTML wrapper nests the blocks after it, and a zero-length range is a block that is only in the DOM, with no offset in the buffer to splice from.
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

// The mapped block one end of a selection sits in. Not `selectionEditableBlock`, which matches only an editing host — a code fence or an image at either end is invisible to it, and the delete would then take half of one.
function selectionBlockAt(node) {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !el.closest) return null;
  const block = el.closest('[data-src-start]');
  return block && app.contains(block) ? block : null;
}

// What survives at one end of the selection: the part of the block outside it, as Markdown and as the count of visible characters, which is what a caret is measured in. A block that cannot be cut in half survives as nothing and goes whole.
function survivingHalf(el, container, offset, keepStart) {
  if (!blockCanBeCutInHalf(el)) return { markdown: '', text: 0 };
  const part = document.createRange();
  part.selectNodeContents(el);
  if (keepStart) part.setEnd(container, offset);
  else part.setStart(container, offset);
  const contents = part.cloneContents();
  return { markdown: inlineDomToMarkdown(contents).trim(), text: contents.textContent.trim().length };
}

// The one splice a cross-block delete makes: the first block's start to the last one's end, carrying the surviving halves joined into a single block. Everything between them is never serialized — it is simply not in the replacement. The kind comes from the first block that keeps any of its own text, so a run whose first block went whole does not leave the last one's heading as body text.
function crossBlockDeletePlan(source, first, last, head, tail) {
  const joined = head.markdown + tail.markdown;
  if (!joined) {
    const span = blockDeleteRange(source, first.start, last.end);
    return { start: span.start, end: span.end, text: '' };
  }
  return { start: first.start, end: last.end, text: (head.markdown ? first.marker : last.marker) + joined };
}

// Delete or Backspace over a selection that leaves the block it started in. Each block is its own editing host, so the browser has no answer here — and letting it try would edit the DOM under the splice and leave a focused block's blur replaying a range the buffer no longer has.
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
  // Every block in the run still shows its pre-splice content, so each one's blur baseline is neutralized — not just the one the splice was sent against.
  for (const el of elements) setEditBaseline(el);
  const landing = plan.text
    ? { srcStart: plan.start, textOffset: head.markdown ? head.text : 0 }
    : caretAfterBlockDelete(first, last, plan);
  if (landing) setPendingCaret(landing);
}

// Registered once, at the fragment's top level. Every other listener in this fragment is per block and re-bound on each render, so one inside bindReadingEditor would stack a copy per render.
window.addEventListener('keydown', handleBlockRunDeleteKey);

// The run of blocks a heading owns: the nearest heading at or above `el`, down to the next heading of ANY level or the end of the document. So deleting a `##` leaves a `###` under it standing, and the section is never more than what was on screen when it was picked. A block with no heading above it takes the run from the first block down to the first heading.
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

// Highlight a run of blocks. The browser paints a selection across blocks on its own, so there is nothing to draw.
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

// Which step Ctrl+A is on, read off what is already selected rather than counted: so a caret moved between two presses starts again by itself, with nothing to reset. 1 — the block is not selected yet, so the browser does it. 2 — the whole block is, so the section is next. 3 — the selection has already left the block.
function selectAllStep(spans, covers, whole) {
  if (spans) return 3;
  return whole > 0 && covers < whole ? 1 : 2;
}

// The block the caret is in, for Ctrl+A's stepping — an editing host in the document, the only place a caret can be. A locked page has none, and a block showing its raw source keeps the browser's own select-all, so both take Ctrl+A the way they always have: one press, the whole page.
function caretBlockForSelectAll(target) {
  const block = selectionBlockAt(target);
  if (!block || block.dataset.editingSource === 'true') return null;
  return block.getAttribute('contenteditable') === 'true' ? block : null;
}

// What Ctrl+A does with the caret in `block`: leave it to the browser, take the block's section, or take the whole page. A heading with nothing under it has no section worth a press of its own — its section is the block the first press already selected — so it goes straight to the page.
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

// The baseline a commit measures `el` against: its Markdown, plus each table cell's own, so the one cell somebody typed in can be found in what comes back.
function setEditBaseline(el) {
  el.__editBaseline = blockDomToSource(el);
  el.__editCells = tableCellTexts(el);
  beginTypingRun(el);
}

// A block back to the bytes of its own source range, which each kind of document spells differently: a note's block is Markdown, a message's is the words themselves, an element's is its words with what a tree escapes put back, and a comment's is the words exactly, since nothing escapes inside one.
function blockDomToSource(el) {
  if (currentDocumentFormat === 'eml') return emailBlockDomToText(el);
  if (currentDocumentFormat === 'xml') {
    return blockHoldsCommentWords(el) ? el.textContent : escapeTreeText(el.textContent);
  }
  return blockDomToMarkdown(el);
}

// Whether this is the box holding a comment's words rather than an element's. The class the renderer draws it with is the mark, because the words sit inside the fold rather than being it.
function blockHoldsCommentWords(el) {
  return !!el && !!el.classList && el.classList.contains('xml-comment-body');
}

// A comment cannot hold two dashes in a row or end in one, and has no escape to hide them behind — so those are refused rather than written, and the words go back to what the file has.
function commentTextRefused(el, text) {
  if (!blockHoldsCommentWords(el)) return false;
  if (!text.includes('--') && !text.endsWith('-')) return false;
  leafToast('A note in an XML file cannot hold two dashes in a row, so this was not written.');
  if (typeof el.__editBaseline === 'string') el.textContent = el.__editBaseline;
  return true;
}

// A value inside a tag cannot hold the quote that closes it, and the page has no escape to hide it behind either — the file would have to spell it as an entity, which is not the words the reader typed. So it is refused and the value goes back to the bytes the file has, which is where the last accepted keystroke of this run left it.
function valueQuoteRefused(el, text) {
  const quote = el.__valueQuote;
  const span = el.__innerSpan;
  if (!quote || !span || !text.includes(quote)) return false;
  leafToast('A value inside a tag cannot hold the quote that closes it, so this was not written.');
  el.textContent = sliceSourceBytes(currentDocumentSource, span.start, span.end);
  return true;
}

// What a tree document refuses to write, whichever gesture is writing it — the pause in the typing and the click-out both ask. Neither of these has an escape the page could hide, so both go back to the file's own bytes rather than being spelled another way.
function treeTextRefused(el, text) {
  return commentTextRefused(el, text) || valueQuoteRefused(el, text);
}

// An email block as the file spells it: text as it stands, a break as the ending its own slice uses, a link as the text it shows. Never the Markdown serializer, which would write asterisks and bracket forms into a message that never had them.
function emailBlockDomToText(el, ending) {
  if (ending === undefined) {
    const src = sliceSourceBytes(currentDocumentSource, Number(el.dataset.srcStart), Number(el.dataset.srcEnd));
    ending = src.includes('\r\n') ? '\r\n' : '\n';
  }
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    out += node.tagName.toLowerCase() === 'br' ? ending : emailBlockDomToText(node, ending);
  });
  return out;
}

// The line ending the open document is written with. A message keeps its own — splicing a `\n` into a `\r\n` message would mix the two — and everything else is `\n`, which is what the separators here have always been.
function documentLineEnding() {
  return currentDocumentFormat === 'eml' && String(currentDocumentSource).includes('\r\n')
    ? '\r\n'
    : '\n';
}

// What separates two blocks in the open document: a blank line in a note and in a message, one line between two elements in a tree.
function blockSeparator() {
  return currentDocumentFormat === 'xml' ? '\n' : documentLineEnding().repeat(2);
}

// Text as a tree document holds it, so what somebody types is what the file says. Nothing else escapes these, and a typed `&` written straight in is a file that no longer parses.
function escapeTreeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// What was typed into a blank line, as the open document spells it. Never the Markdown serializer outside a note: a message would get asterisks it never had, and an element would get them inside its own tag.
function typedBlockText(block) {
  if (currentDocumentFormat === 'eml') {
    return emailBlockDomToText(block, documentLineEnding()).trim();
  }
  if (currentDocumentFormat === 'xml') return escapeTreeText(block.textContent).trim();
  return inlineDomToMarkdown(block).trim();
}

// Whether the page can write this block's own bytes back out of what is on screen — the ticket's stamping rule one level up. Equal, and typing on the words is exact; not equal (a date the reader re-spelled, an address list rejoined, markup drawn from its source) and the block keeps the raw-slice editor.
function emailBlockTypeableInPlace(el) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const src = sliceSourceBytes(currentDocumentSource, start, end);
  return emailBlockDomToText(el, src.includes('\r\n') ? '\r\n' : '\n') === src;
}

// The inside of one element's own tags, as offsets into `src`. Null unless both tags are found — this range is spliced verbatim, so a comment, a declaration, a self-closing element or a tag carrying a `>` inside an attribute falls back to editing the whole block.
function xmlElementInnerSpan(src) {
  const open = /^[ \t]*<([^\s/>!?][^\s/>]*)(?:\s[^>]*)?>/.exec(src);
  if (!open) return null;
  const close = new RegExp('</' + open[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*>[ \\t]*$').exec(src);
  if (!close) return null;
  const from = open[0].length;
  // Below `from` the closing tag is inside the opening one: nothing between them to type on.
  if (close.index < from) return null;
  return { from, to: close.index };
}

// The `data-*` pair each kind of typed-on thing carries its own byte range under. A block's names are read by four other things — the gutter's plus, the drag handle, a delete over a run — so a cell of a table and a value an element keeps in a tag each wear a pair of their own, and nothing on the page wears two. Every gesture that moves a range or finds a thing by one walks this list, because a name added to one gesture and not the next is a splice at the wrong offset.
const RANGE_NAMES = [
  { found: 'data-src-start', start: 'srcStart', end: 'srcEnd' },
  { found: 'data-cell-start', start: 'cellStart', end: 'cellEnd' },
  { found: 'data-value-start', start: 'valueStart', end: 'valueEnd' },
];

// The span this tree block may be typed on, or null for one that keeps the raw editor — the message's question asked of an element. The drawn words, escaped the way a tree holds them, have to be exactly the bytes between the element's own tags: that equality is the whole safety, and inline markup the renderer flattened, whitespace it collapsed and an entity spelled another way all fail it.
function xmlBlockTypeableInPlace(el) {
  return xmlRangeTypeableInPlace(el, Number(el.dataset.srcStart), Number(el.dataset.srcEnd));
}

// The same question asked of one cell of a table. A cell is not a block and must never answer to a block's own names, so it carries its element's range under names of its own; everything after that is the block's proof unchanged, because a cell's words come from one leaf element exactly as a paragraph's do.
function xmlCellTypeableInPlace(el) {
  return xmlRangeTypeableInPlace(el, Number(el.dataset.cellStart), Number(el.dataset.cellEnd));
}

// The same question asked of a value an element keeps in a tag. The renderer stamped the bytes inside the quotes, so there are no tags in the slice to find: the drawn words are held straight against those bytes, which is the block's proof with the one step it has nothing to do taken out.
function xmlValueTypeableInPlace(el) {
  const start = Number(el.dataset.valueStart);
  const end = Number(el.dataset.valueEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (escapeTreeText(el.textContent) !== sliceSourceBytes(currentDocumentSource, start, end)) return null;
  return { start, end };
}

// The quote a value is written inside, read off the byte before it, or null where that byte is not one — a stamp the buffer has moved past cannot be typed on. An attribute takes either quote and may hold the other freely, so which one it is decides what it can never hold.
function valueClosingQuote(start) {
  const quote = sliceSourceBytes(currentDocumentSource, start - 1, start);
  return quote === '"' || quote === "'" ? quote : null;
}

// The proof both of those spend: `start..end` is one element, and what is drawn is exactly the bytes between its tags.
function xmlRangeTypeableInPlace(el, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const src = sliceSourceBytes(currentDocumentSource, start, end);
  const span = xmlElementInnerSpan(src);
  if (!span) return null;
  if (escapeTreeText(el.textContent) !== src.slice(span.from, span.to)) return null;
  // The span counts characters and the buffer counts bytes, and an element's text can be anything.
  return {
    start: start + utf8ByteLength(src.slice(0, span.from)),
    end: start + utf8ByteLength(src.slice(0, span.to)),
  };
}

// The span a comment's words may be typed on, given the words as they are drawn, or null for one that keeps the raw editor. A comment escapes nothing, so the drawn words are held against the bytes between the marks as they stand — allowing only for the ends the fold trims, which is the one change the renderer makes to them.
function xmlCommentTypeableInPlace(el, words) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const src = sliceSourceBytes(currentDocumentSource, start, end);
  if (!src.startsWith('<!--') || !src.endsWith('-->') || src.length < 7) return null;
  const inner = src.slice(4, src.length - 3);
  const text = inner.trim();
  if (text !== words) return null;
  const from = 4 + (inner.length - inner.trimStart().length);
  return {
    start: start + utf8ByteLength(src.slice(0, from)),
    end: start + utf8ByteLength(src.slice(0, from + text.length)),
  };
}

// Whether what is on the page still has to go into the buffer. Back at the words it started with and nothing written on the way is a no-edit focus and costs nothing; back at those words after a pause HAS written is a buffer holding text the page no longer shows, so the same words go out again to take it back. Five gestures ask this — the click-out, the source view's blur, the drag, the gap under a block and the line opened under one — and it is one function because a second copy of the question is one that can drop the second half.
function blockTextNeedsWriting(el, text) {
  return text !== el.__editBaseline || el.__liveStarted === true;
}

// Send an edit for `el`'s source range, only if `text` differs from the baseline captured when editing began (so a no-edit focus costs nothing). Wherever the caret is — another block, or still in this one, which is how Save and Undo commit — carry it across this commit's re-render (adjusting for the splice's offset shift) so it isn't dumped out.
//
// `range` overrides the block's own: a fenced code block edits the inside of its fences, so what it writes back is narrower than the block. An element of a tree document carries the same override on itself, stamped when it was wired, so every path that commits it splices between its tags rather than over them.
//
// Answers whether anything was written, because the chrome raised at the first keystroke is a promise a session that wrote nothing has to take back.
function commitBlockEdit(el, text, range) {
  // The pause is spent: this commit writes whatever the pause would have.
  if (el.__liveTimer) {
    window.clearTimeout(el.__liveTimer);
    el.__liveTimer = 0;
  }
  // A block the page has already replaced describes a buffer that has moved on — a re-render blurs it, and that blur must not splice yesterday's offsets.
  if (!el.isConnected) return false;
  if (treeTextRefused(el, text)) return false;
  const span = range || el.__innerSpan || null;
  const start = span ? span.start : Number(el.dataset.srcStart);
  const end = span ? span.end : Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (!blockTextNeedsWriting(el, text)) return false;
  if (!span && deleteEmptiedBlock(el, text)) return true;
  // A table where one cell changed writes that cell and leaves the rest of the file alone; `text` rides along as what the host falls back to when it cannot place it.
  const cell = span ? null : tableCellChange(el.__editCells, tableCellTexts(el));
  // The run's own first splice is the undo point; this one continues it wherever a pause has already written part of the run.
  sendEditCommand({ command: 'editBlock', start, end, text, cell, continuing: el.__liveStarted === true });
  const delta = cell
    ? utf8ByteLength(cell.text) - utf8ByteLength(el.__editCells[cell.row][cell.column])
    : utf8ByteLength(text) - (end - start);
  window.setTimeout(() => {
    if (pendingCaret) return; // a structural edit already claimed the caret
    const active = document.activeElement;
    if (!active || !active.dataset) return;
    // A caret that walked into a cell of a table, or into a value inside a tag, is carried by that thing's own names — the block's would find the table or the element around it, whose range does not move with the splice.
    const held = RANGE_NAMES.find((pair) => active.dataset[pair.start] != null);
    if (!held) return;
    if (active.getAttribute('contenteditable') !== 'true') return;
    if (active.dataset.editingSource === 'true') return;
    const activeStart = Number(active.dataset[held.start]);
    if (!Number.isFinite(activeStart)) return;
    const offset = caretTextOffsetIn(active);
    setPendingCaret({
      srcStart: activeStart >= end ? activeStart + delta : activeStart,
      found: held.found,
      textOffset: offset == null ? 0 : offset,
    });
  }, 0);
  return true;
}

// ---- typing that reaches the document at every pause -------------------------
// The pause after which what is on screen goes into the buffer. The code view's own beat, so both editors reach the document together.
const LIVE_EDIT_PAUSE_MS = 180;

// What a live splice would write for `el`, or null for a block whose typing waits for the click-out. A note's table is the one that waits: its commit writes one cell rather than a range, and where the buffer's table then differs from the page's own serialization there is no length the page can move its map by — and a map that lags writes the wrong bytes on the next gesture.
//
// `words` overrides what the block would be read as: a step taken back writes the words it put on the page rather than a second reading of them.
function liveEditOf(el, words) {
  if (el.dataset.editingSource === 'true') {
    const edit = typeof el.__liveSourceEdit === 'function' ? el.__liveSourceEdit() : null;
    if (edit && words !== undefined) edit.text = words;
    return edit;
  }
  if (!el.__editingActive) return null;
  if (el.dataset.blockKind === 'table' && currentDocumentFormat === 'markdown') return null;
  const text = words === undefined ? blockDomToSource(el) : words;
  const span = el.__innerSpan;
  if (span) return { start: span.start, end: span.end, text, inner: true };
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  // A line with no bytes of its own yet is written by its own commit, which carries the marker and the separator with it.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  // A block typed empty is a block taken away, which is a structural edit and the click-out's to make.
  if (blockSerializationEmpty(text, el.dataset.blockKind)) return null;
  return { start, end, text, inner: false };
}

// Put what is typed in `el` into the document without redrawing the page, then move the page's own map by what the splice changed. Nothing has re-rendered, so this map is the only thing that stays true — every block after the typed one shifts, and the source the page slices from is spliced to match. The blur baseline is deliberately left alone: the browser's own Ctrl+Z is decided against it, so advancing it would hand the key to the app mid-word.
function sendLiveBlockEdit(el, words) {
  if (!el.isConnected) return;
  const edit = liveEditOf(el, words);
  if (!edit) return;
  // Nothing new since the last pause.
  if (edit.text === (el.__liveText === undefined ? el.__editBaseline : el.__liveText)) return;
  if (treeTextRefused(el, edit.text)) return;
  sendEditCommand({
    command: 'editBlock',
    start: edit.start,
    end: edit.end,
    text: edit.text,
    live: true,
    continuing: el.__liveStarted === true,
  });
  el.__liveStarted = true;
  el.__liveText = edit.text;
  advanceLiveRanges(el, edit);
}

// The map, moved by the splice that just went out: the source the page slices from, the typed block's own span, and every offset after it.
function advanceLiveRanges(el, edit) {
  const written = utf8ByteLength(edit.text);
  const bytes = sourceByteEncoder.encode(currentDocumentSource || '');
  currentDocumentSource =
    sourceByteDecoder.decode(bytes.slice(0, edit.start)) +
    edit.text +
    sourceByteDecoder.decode(bytes.slice(edit.end));
  if (edit.inner) el.__innerSpan = { start: edit.start, end: edit.start + written };
  if (typeof el.__liveSourceMoved === 'function') el.__liveSourceMoved(edit.start + written);
  const delta = written - (edit.end - edit.start);
  if (delta) shiftBlockRangesAfter(edit.end, delta, el);
}

// Every offset at or past `at` moves by `delta`. One pass over everything on the page holding a range, because anything that lags the buffer — the gutter's plus, the drag, a delete over a run — splices the wrong bytes on its next press.
function shiftBlockRangesAfter(at, delta, typed) {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const move = (value) => (Number.isFinite(value) && value >= at ? value + delta : value);
  const moved = new Set();
  RANGE_NAMES.forEach(({ found, start, end }) => {
    body.querySelectorAll(`[${found}]`).forEach((node) => {
      node.dataset[start] = String(move(Number(node.dataset[start])));
      node.dataset[end] = String(move(Number(node.dataset[end])));
      moved.add(node);
    });
  });
  moved.forEach((node) => {
    // The typed block's own span was just set to what was written; moving it again would count the splice twice.
    if (node === typed || !node.__innerSpan) return;
    node.__innerSpan = { start: move(node.__innerSpan.start), end: move(node.__innerSpan.end) };
  });
}

// Arm the pause. Re-armed by every keystroke, so what goes into the document is a run of typing rather than a letter.
function scheduleLiveBlockEdit(el) {
  if (el.__liveTimer) window.clearTimeout(el.__liveTimer);
  el.__liveTimer = window.setTimeout(() => {
    el.__liveTimer = 0;
    sendLiveBlockEdit(el);
  }, LIVE_EDIT_PAUSE_MS);
}

// A typing run starts here: nothing of it has reached the buffer yet, so the next splice is its first and records the snapshot the whole run is taken back to.
function beginTypingRun(el) {
  el.__liveStarted = false;
  el.__liveText = undefined;
  beginTypingSteps(el);
}

// ---- what one press of Ctrl+Z takes back -------------------------------------
// A press takes back a group of keystrokes rather than a letter. The web view's own undo cannot be asked for a bigger step, so inside a block the key is the page's and the grouping is here — a step ends at a word, at a caret moved elsewhere, and at a pause.

// The stillness that ends the open step, so a stop to think mid-word is a group of its own. Word boundaries end most steps already, so this only has to catch the slow typist — and a short one would hand them back the letter-at-a-time undo this replaced. Not the 180 ms beat above: that is how often the document catches up, not how big a step is.
const TYPING_STEP_PAUSE_MS = 2000;

// The clock the steps are timed on, named so a check can hold it still.
function typingStepNow() {
  return Date.now();
}

// The keys that move the caret without typing anything.
const TYPING_STEP_MOVE_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

// Whether a character ends a word: a space, a line break, a punctuation mark — anything a word is not made of.
function typingBoundaryChar(char) {
  return !!char && !/[\p{L}\p{N}_]/u.test(char);
}

// The character a keystroke put in, or '' for anything that is not one — a delete, a paste, a line break the browser makes for us.
function typedCharOf(event) {
  const data = event && typeof event.data === 'string' ? event.data : '';
  return data.length === 1 ? data : '';
}

// What the block holds right now, as one step: the markup on screen, where the caret is in it, and the source those words write. The source is kept rather than worked out again later, so what a press puts into the document is exactly what it puts on the page.
function typingSnapshotOf(el) {
  const offset = caretTextOffsetIn(el);
  return {
    html: el.innerHTML,
    text: el.dataset.editingSource === 'true' ? el.innerText : blockDomToSource(el),
    offset: offset == null ? visibleTextLength(el) : offset,
  };
}

// Start `el`'s steps over. Nothing has been typed in this session, so what the block holds now is the bottom of the list — the state the last press left to take back.
function beginTypingSteps(el) {
  el.__typingSteps = [];
  el.__typingAhead = [];
  el.__typingOpen = typingSnapshotOf(el);
  el.__typingLastChar = '';
  el.__typingAt = 0;
  el.__typingBreak = false;
}

// Whether this keystroke opens a new step: a word starting after a boundary, a delete beside typing or typing beside a delete, the caret moved somewhere else since the last one, or a pause long enough to be a stop rather than a slow hand.
function typingStepEndsBefore(el, typed) {
  if (el.__typingBreak === true) return true;
  if (el.__typingAt && typingStepNow() - el.__typingAt >= TYPING_STEP_PAUSE_MS) return true;
  const last = el.__typingLastChar || '';
  // One of them is not a typed character at all, so the two keystrokes are different things and take a step each.
  if (!typed || !last) return typed !== last;
  return !typingBoundaryChar(typed) && typingBoundaryChar(last);
}

// Record the keystroke that just landed. Everything typed between two step ends is one step, and what is pushed is the block as it stood before the keystroke that opened the new one.
function recordTypingStep(el, typed) {
  if (!el.__typingSteps) beginTypingSteps(el);
  // Typing is the newest thing that happened, so whatever a press had walked back from is gone.
  el.__typingAhead = [];
  if (!el.__typingSteps.length || typingStepEndsBefore(el, typed)) el.__typingSteps.push(el.__typingOpen);
  el.__typingOpen = typingSnapshotOf(el);
  el.__typingLastChar = typed;
  el.__typingAt = typingStepNow();
  el.__typingBreak = false;
}

// Take `el`'s typing back one step. Answers false with nothing left, which is what hands the key on to the app's own undo.
function stepTypingBack(el) {
  const steps = el.__typingSteps;
  if (!steps || !steps.length) return false;
  if (!el.__typingAhead) el.__typingAhead = [];
  el.__typingAhead.push(typingSnapshotOf(el));
  restoreTypingSnapshot(el, steps.pop());
  return true;
}

// Walk `el`'s typing forward again, up to where the presses started. Answers false with nothing ahead — the reader is back at the newest words they typed.
function stepTypingForward(el) {
  const ahead = el.__typingAhead;
  if (!ahead || !ahead.length) return false;
  if (!el.__typingSteps) el.__typingSteps = [];
  el.__typingSteps.push(typingSnapshotOf(el));
  restoreTypingSnapshot(el, ahead.pop());
  return true;
}

// Put the block back to a step: the words, the caret, and the document behind them. The splice continues the run, so the app's own stack still holds the whole session as one step and a save right after a press writes the words on screen.
function restoreTypingSnapshot(el, snap) {
  el.innerHTML = snap.html;
  rebindRestoredCheckboxes(el);
  placeCaretInBlock(el, snap.offset);
  el.__typingOpen = snap;
  el.__typingLastChar = '';
  // Typing after a press starts a step of its own rather than joining the one it landed in.
  el.__typingBreak = true;
  sendLiveBlockEdit(el, snap.text);
}

// A restored block is fresh markup, so anything the page had bound inside it is gone with the nodes. Only the checkboxes carry a listener of their own; each already knows the task it flips, and a table's own are bound off the table.
function rebindRestoredCheckboxes(el) {
  if (el.dataset.blockKind === 'table') {
    bindTableCheckboxesIn(el);
    return;
  }
  el.querySelectorAll('input[type="checkbox"][data-task-index]').forEach((box) => {
    if (box.closest('td')) return;
    const index = Number(box.dataset.taskIndex);
    if (!Number.isFinite(index)) return;
    box.addEventListener('change', () => {
      sendTaskToggle(box, index);
    });
  });
}

// Commit whatever holds an active editing session, whichever of the three editors it is. Used before actions that bypass the click-out commit: a link click whose mousedown is swallowed, and Save or Undo pressed with the caret still in the words. A raw-source block and a field box are written by their own blur, which is also the one path that puts the rendered block back — a styled block is committed in place instead, so the caret can be carried across the re-render rather than dumped out.
function commitActiveEditingBlock() {
  const active = document.activeElement;
  if (!active) return;
  if (active.dataset && active.dataset.editingSource === 'true') {
    active.blur();
    return;
  }
  if (active.classList && active.classList.contains('frontmatter-input')) {
    active.blur();
    return;
  }
  if (!active.__editingActive) return;
  active.__editingActive = false;
  // Nothing written means the keystroke that lit the dot was taken back, so the dot goes out before Save or Undo reads it and acts on a promise there is nothing behind.
  if (!commitBlockEdit(active, blockDomToSource(active))) lowerTypingChrome();
}

// Splice `text` over `[start, end)` for a STRUCTURAL edit (split/merge/insert). Unlike commitBlockEdit this always sends, and it neutralizes the block's blur baseline afterwards: the DOM still shows the pre-splice content, and letting the blur commit fire would replay a stale range against the new buffer.
function sendBlockSplice(el, start, end, text) {
  sendEditCommand({ command: 'editBlock', start, end, text });
  setEditBaseline(el);
}

// A table checkbox toggle: autosave tells the host to write to disk with no undo step, and the plain send avoids a dirty flash. `cell` is the box's own cell, so the rest of the table keeps its spacing. Neutralizes the blur baseline like sendBlockSplice, in case the table was also being edited.
//
// `box` drew itself ticked before this leaves, so the send asks to be answered and puts that tick back where the buffer is holding nothing — see sendTaskToggle, which is the same bargain for a box in a plain list. A box inside a table has no task number to be named by, which is why the page is what undraws it.
function sendCheckboxBlockEdit(el, start, end, text, cell, box) {
  const drawn = box.checked;
  const token = leafWaitForEdit((held, why) => {
    if (!held) box.checked = !drawn;
    if (why) leafToast(why, 'error');
  });
  send({ command: 'editBlock', start, end, text, autosave: true, cell, token });
  setEditBaseline(el);
}

// Enter inside a paragraph/heading: split the block at the caret into two blocks. The serialized halves replace the block's source range, joined by a blank line; the caret carries over to the start of the second block. Enter at the end instead opens a fresh empty paragraph below (Markdown has no empty block, so it stays DOM-local until first commit); Enter at the very start is a no-op.
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
  // A message's halves are its own words, and its blank line is written in the ending that message uses.
  const separator = documentLineEnding().repeat(2);
  const half = (range) =>
    currentDocumentFormat === 'eml'
      ? emailBlockDomToText(range.cloneContents(), documentLineEnding()).trim()
      : inlineDomToMarkdown(range.cloneContents()).trim();
  const part1Inline = half(beforeRange);
  const part2Inline = half(afterRange);
  if (!part1Inline) return;
  const prefix = blockMarkerOf(el);
  const part1 = prefix + part1Inline;
  if (part2Inline) {
    // Both halves keep the block's own kind — splitting a heading yields two headings at the same level, splitting a paragraph two paragraphs.
    const part2 = prefix + part2Inline;
    sendBlockSplice(el, start, end, part1 + separator + part2);
    setPendingCaret({
      srcStart: start + utf8ByteLength(part1) + utf8ByteLength(separator),
      textOffset: 0,
    });
  } else if (blockDomToSource(el) !== el.__editBaseline) {
    // Enter at the end with unsaved text edits: commit them, then reopen the empty insert paragraph on the far side of the re-render.
    sendBlockSplice(el, start, end, part1);
    setPendingCaret({ srcStart: start, insertBelow: true });
  } else {
    openInsertBlockAfter(el);
  }
}

// Enter inside an element of a tree document: end it at the caret and carry on in another of the same one, tags and attributes and all. A newline inside the element would draw as a space the moment the page redrew, so a new line has to be a new element. At the end of the words there is nothing to carry down, so the line the plus opens is opened instead.
function splitTreeBlockAtCaret(el) {
  const span = el.__innerSpan;
  if (!span) return;
  // Only a paragraph. A second heading in the same part, and a second title in a document's header, are not drawn at all — splitting one would take the words off the page while leaving them in the file.
  if (el.dataset.blockKind !== 'paragraph') return;
  if (el.classList && el.classList.contains('tei-doc-subtitle')) return;
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const offset = caretTextOffsetIn(el);
  if (offset == null) return;
  const src = sliceSourceBytes(currentDocumentSource, start, end);
  const inner = xmlElementInnerSpan(src);
  if (!inner) return;
  const open = src.slice(0, inner.from);
  const close = src.slice(inner.to);
  const named = /^[ \t]*<([^\s/>]+)/.exec(open);
  const spec = named ? 'element:' + named[1] : undefined;
  const text = el.textContent;
  const part1 = text.slice(0, offset).trim();
  const part2 = text.slice(offset).trim();
  // Enter at the very start would leave an empty element above the words, so it does nothing — the answer a note gives at the same place.
  if (!part1) return;
  if (!part2) {
    // Words typed and not saved yet go in first: the blank line splices at this element's end, and a blur committing afterwards would write them a second time.
    if (blockDomToSource(el) !== el.__editBaseline) {
      sendBlockSplice(el, span.start, span.end, escapeTreeText(part1));
      setPendingCaret({ srcStart: start, insertBelow: true, blockSpec: spec });
      return;
    }
    openInsertBlockAfter(el, spec);
    return;
  }
  const first = open + escapeTreeText(part1) + close;
  const separator = blockSeparator();
  sendBlockSplice(el, start, end, first + separator + open + escapeTreeText(part2) + close);
  setPendingCaret({
    srcStart: start + utf8ByteLength(first) + utf8ByteLength(separator),
    textOffset: 0,
  });
}

// Backspace at the very start of a paragraph/heading: merge it into the previous block, Notion-style — the two texts join at a caret that stays put. Only fires when the previous sibling is itself a WYSIWYG paragraph/heading; anything else (a list, a code block, a rule) leaves Backspace inert at the boundary.
function mergeBlockIntoPrevious(el, prev) {
  const start = Number(prev.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const junction = visibleTextLength(prev);
  const merged = blockDomToMarkdown(prev) + inlineDomToMarkdown(el).trim();
  sendBlockSplice(el, start, end, merged);
  setPendingCaret({ srcStart: start, textOffset: junction });
}

// An editable block that exists only in the DOM: no source range yet, because Markdown has no empty block to give it one. `placeholder` is the gray wording it shows while it is blank — carried on a `data-` attribute the stylesheet prints, and switched off by the first keystroke rather than by `:empty`, which a contenteditable's leftover `<br>` would defeat.
//
// `insertAt` is where the block's first commit will splice, stamped as a zero-length source range so the block gutter can find the block and offer its plus. Zero length is also how the gutter knows not to offer the grip: a block with no text in the buffer has nothing to drag.
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
    // A line that is not in the buffer yet is still words on screen: the dot, Save and Undo answer for it from the first keystroke like any other block's.
    raiseTypingChrome();
  });
  return block;
}

// The blocks the insert row OPENS rather than writes: an empty block of that kind, showing gray wording, with nothing in the buffer until the first keystroke — `marker` is the Markdown that keystroke commits behind. Splicing the word "Heading" in instead leaves it there when you change your mind. A line Enter opened rather than the row: it says nothing, because you are already writing and being told to write would be noise.
const PLAIN_LINE_SPEC = { tag: 'p', kind: 'paragraph', placeholder: '', marker: '' };
// An empty line asked for by name gets one of these instead of one fixed word, rolled per line the way the home screen rolls its palm-leaf facts. Same voice, shorter: this one sits in the document, where a sentence would read as text somebody left behind.
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

// The same, for one element of a tree document: `close` is the half Markdown never needs, so the first keystroke commits `<p>the words</p>` rather than an empty element nothing draws. `chain` carries the tag across Enter, since the next line is another of the same element rather than the plain line a note falls to.
function xmlElementSpec(tag) {
  return {
    tag: 'p',
    kind: 'paragraph',
    placeholder: 'Write inside <' + tag + '>...',
    marker: '<' + tag + '>',
    close: '</' + tag + '>',
    chain: 'element:' + tag,
  };
}

// The other kinds a tree document draws, each written as the source that draws it: a heading is a container with a titling child in it, and a verse line is one line of a run. `chain` is never absent here — a tree document has no plain line to fall to, so Enter on a spec with none would write bare words between two elements.
const XML_BLOCK_SPECS = {
  'tei:head': {
    tag: 'h2',
    kind: 'heading',
    placeholder: 'Name this part...',
    marker: '<div><head>',
    close: '</head></div>',
    chain: 'element:p',
  },
  'tei:l': {
    tag: 'blockquote',
    kind: 'blockquote',
    placeholder: 'A line of verse...',
    marker: '<l>',
    close: '</l>',
    chain: 'tei:l',
  },
  // Enter carries on in another heading rather than a paragraph: an element with words in it and nothing under it is drawn as a labeled value here, not as prose.
  'xml:head': {
    tag: 'h2',
    kind: 'heading',
    placeholder: 'Name this part...',
    marker: '<section><head>',
    close: '</head></section>',
    chain: 'xml:head',
  },
};

// One more record on a table: the run's own record tag, with the first of its columns to type into. Both names come from the table's source, so what is written is another of what is already there — and the words go in before it is written, since a record with no readable cell in it stops the whole run being a table.
function xmlRowSpec(record, column) {
  return {
    tag: 'p',
    kind: 'paragraph',
    placeholder: 'Start a row...',
    marker: '<' + record + '><' + column + '>',
    close: '</' + column + '></' + record + '>',
    chain: 'row:' + record + ':' + column,
  };
}

// The blank block an id names. A tree document's element and its table record carry the document's own names in the id, because those are the document's rather than one of the four kinds a note offers.
function blankBlockSpec(id) {
  if (typeof id === 'string' && id.startsWith('element:')) {
    return xmlElementSpec(id.slice('element:'.length));
  }
  if (typeof id === 'string' && id.startsWith('row:')) {
    const [record, column] = id.slice('row:'.length).split(':');
    return record && column ? xmlRowSpec(record, column) : null;
  }
  return BLANK_BLOCK_SPECS[id] || XML_BLOCK_SPECS[id] || null;
}

// A list item has to stand in a list to look like one, so a spec may ask for a wrapper. `host` is what goes in the page; `block` is what you type in.
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

// A fresh empty block, ready to type into. Markdown cannot hold an empty block, so it exists only in the DOM until its first commit, which splices `separator`
// + the spec's marker + the typed text + the spec's closing half in at `insertAt`. Enter commits and chains another below (continuous writing flow); Backspace on the empty block dissolves it back into `previous`; clicking away commits, or dissolves it if nothing was typed -- unless `keepEmpty`, since an empty document has no other block to click into and removing this one would leave nowhere to type.
function openInsertBlock(
  insertAt,
  {
    spec = PLAIN_LINE_SPEC,
    separator = blockSeparator(),
    suffix = '',
    place,
    previous = null,
    keepEmpty = false,
  },
) {
  const { host, block } = makeBlankHost(spec, insertAt);
  const prefix = separator + spec.marker;
  // The spec's own closing half, inside the call's suffix: an element closes around the words, and the separator the caller adds goes outside it.
  const close = spec.close || '';
  place(host);
  const commit = (chainBelow, chainSpec) => {
    if (block.__committed) return true;
    const text = typedBlockText(block);
    if (!text) return false;
    block.__committed = true;
    sendEditCommand({
      command: 'editBlock',
      start: insertAt,
      end: insertAt,
      text: prefix + text + close + suffix,
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
  // What the block gutter's plus does here. This block is not in the buffer, so an insert "after" it has nothing to be after: the one splice has to carry whatever was typed AND the new block, or pressing plus mid-sentence would drop the sentence.
  block.__insertBlockWith = (option) => {
    // False, not nothing: this line already went to the host, so nothing goes out now, and a flowchart sheet waiting on this write has to hear that rather than close over the drawing.
    if (block.__committed) return false;
    block.__committed = true;
    const typed = typedBlockText(block);
    const lead = typed ? prefix + typed + close + separator : separator;
    const token = insertEditToken(option);
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: lead + option.text + suffix, token });
    if (option.caret) {
      setPendingCaret({ srcStart: insertAt + utf8ByteLength(lead) });
    }
    return token === undefined ? true : token;
  };
  // What the format bar does here. This line is not in the buffer, so its own commit carries the marker — a splice from outside lands beside the words, and the blur commit then writes them again.
  block.__commitAs = (marker) => {
    if (block.__committed) return;
    const typed = typedBlockText(block);
    if (!typed) return;
    block.__committed = true;
    sendEditCommand({ command: 'editBlock', start: insertAt, end: insertAt, text: separator + marker + typed + suffix });
    setPendingCaret({ srcStart: insertAt + utf8ByteLength(separator), textOffset: 0 });
  };
  // The plus pressed on this very line: it is empty, so it becomes the kind that was picked rather than growing a second block beside it.
  block.__becomeBlock = (specId) => {
    const next = blankBlockSpec(specId);
    if (!next || block.__committed || inlineDomToMarkdown(block).trim()) return;
    host.remove();
    openInsertBlock(insertAt, { spec: next, separator, suffix, place, previous, keepEmpty });
  };
  block.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // A note carries on in a plain line, whatever kind this one was — you have finished the heading and are writing under it. An element has nothing plain to fall to, so it chains another of itself.
      commit(true, spec.chain);
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
  // What the block gutter's plus does when the line below is what was pressed: save this one and open the next, the same as Enter.
  block.__lineBelow = (specId) => {
    if (!commit(true, specId)) block.focus({ preventScroll: true });
  };
  block.addEventListener('blur', (event) => {
    // The gutter has the focus, not the page: this block's words are about to be saved by whatever was pressed there.
    if (blockGutterHoldsFocus(event.relatedTarget)) return;
    if (!commit(false) && !keepEmpty) host.remove();
  });
  block.focus({ preventScroll: true });
}
function openInsertBlockAfter(el, specId) {
  const insertAt = Number(el.dataset.srcEnd);
  if (!Number.isFinite(insertAt)) return;
  openInsertBlock(insertAt, {
    spec: blankBlockSpec(specId) || PLAIN_LINE_SPEC,
    place: (host) => el.insertAdjacentElement('afterend', host),
    previous: el,
  });
}
// A document with nothing in it opens the way a blank page should read: a title, then a line to start writing — and the title IS the first `# heading`, so the name of the piece is part of the piece rather than a field beside it.
//
// Neither block is in the source yet, so the pair commits as ONE splice at offset zero. That is the whole reason they are handled together: two DOM-only blocks each holding "insert at 0" would overwrite each other, whichever committed second.
//
// Placed ahead of the pager placeholder, so the writing starts at the top of the page rather than under its footer.
function openMediumStart(body) {
  const title = makeBlankBlock('h1', 'heading', 'Name the leaf...', 0);
  // The line under the title is a paragraph until the insert row says otherwise: pick Heading or List there and this becomes one, since an empty line is the kind it is told to be rather than a thing to write a word into.
  let storyHost = makeBlankBlock('p', 'paragraph', 'Turn over a new leaf...', 0);
  let story = storyHost;
  let storyMarker = '';
  let titleMarker = '# ';
  body.insertBefore(storyHost, body.firstChild);
  body.insertBefore(title, body.firstChild);
  let committed = false;
  // The one splice the pair makes. `chainBelow` continues the writing flow — after it, reopen an empty paragraph under the story line the way Enter does anywhere else. `extra` is the block gutter's plus arriving instead: the same splice, with the chosen block on the end, so pressing plus with a title typed keeps the title.
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
    // Only the plus's own option carries a token, and only where whoever pressed it is holding something to wait with. The pair's other two ways out write for themselves and are done.
    const token = insertEditToken(extra);
    sendEditCommand({ command: 'editBlock', start: 0, end: 0, text, token });
    if (extra) {
      if (extra.caret) {
        setPendingCaret({ srcStart: utf8ByteLength(lead) });
      }
    } else if (chainBelow && parts.length) {
      // Under the last thing written, whichever of the pair that was: a title on its own is still something to carry on below.
      setPendingCaret({
        srcStart: utf8ByteLength(text) - utf8ByteLength(parts[parts.length - 1]),
        insertBelow: true,
        blockSpec: chainSpec,
      });
    }
    return token === undefined ? true : token;
  };
  // False, not nothing, where the pair had already committed: nothing goes out now, and a flowchart sheet waiting on this write has to hear that rather than close over the drawing.
  title.__insertBlockWith = (option) => (committed ? false : commit(false, option));
  // Clicking the space below the pair. Neither block is in the buffer yet, so it has to go through this same one splice — an insert of its own would be undone by the pair's own save a moment later, and the new line would flash and vanish on a document's first one.
  title.__lineBelow = (specId) => {
    if (!commit(true, null, specId)) story.focus({ preventScroll: true });
  };
  // The plus on the story line, which is empty by definition: it becomes the kind that was picked. Nothing is written — this line is not in the buffer yet.
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
  // The format bar on either of the pair. All it can do is change the marker that line commits with — neither is in the buffer for a splice to land on.
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
      // Backspace on an empty story line steps back up into the title, the mirror of Enter walking down.
      if (event.key === 'Backspace' && block === story && !inlineDomToMarkdown(story).trim()) {
        event.preventDefault();
        title.focus({ preventScroll: true });
        placeCaretInBlock(title, visibleTextLength(title));
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      // Enter in the title walks down to the story line rather than committing — a title with no story under it is not a document yet.
      if (block === title) {
        story.focus({ preventScroll: true });
        placeCaretInBlock(story, visibleTextLength(story));
        return;
      }
      commit(true);
    });
    // Leaving the pair for anything outside it writes whatever was typed. Nothing typed leaves both blocks standing: an empty document has nowhere else for the caret to go, and removing them would leave the page untypable.
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

// Structural keys for a WYSIWYG block, by kind. Paragraphs and headings get the block-editor behaviors (Enter splits, Shift+Enter breaks the line, Backspace at the start merges up); lists lean on the browser's native contenteditable list handling (Enter makes a new item, Backspace joins items) and serialize whatever structure results; table cells are single-line, so Enter is inert.
function handleWysiwygKeydown(el, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    el.blur();
    return;
  }
  if (currentDocumentFormat === 'eml') {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // A header value is one line of the file, so it takes neither a break nor a split.
    if (el.dataset.blockKind !== 'email_paragraph') return;
    // Shift+Enter is one more line of the same paragraph; Enter ends it and starts another, which is a blank line in the message.
    if (event.shiftKey) document.execCommand('insertLineBreak');
    else splitBlockAtCaret(el);
    return;
  }
  if (currentDocumentFormat === 'xml') {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // Held down or with shift, it is the same key doing the same thing: there is no soft break inside an element for the other one to be.
    splitTreeBlockAtCaret(el);
    return;
  }
  const kind = el.dataset.blockKind;
  if (kind === 'table') {
    if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (kind === 'blockquote') {
    // Enter inside a quote adds a quoted line (a hard break) rather than splitting the quote — a native Enter would create markup the quote's serializer has no `>`-form for.
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
      // The class, not `contenteditable`: the block above is only a host once it has been clicked into, and merging up must work the first time.
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

// Mark `el` editable — the class and the checkbox islands, not `contenteditable`. **A block is not an editing host until it is clicked into.** A host confines a selection to itself, so making every block one meant a drag could never leave the block it started in and there was nothing to select, copy or delete across two of them. The page is plain text until you point at a line, which is also why nothing is written per block at unlock.
function markMarkdownEditable(el) {
  el.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('contenteditable', 'false'));
}

// Whether `el` is open for typing right now.
function blockIsEditingHost(el) {
  return !!el && !!el.getAttribute && el.getAttribute('contenteditable') === 'true';
}

// Open `el` for typing and put `span` back under the selection — a caret where a click landed, or the word a double-click took. Turning the attribute on moves the selection, so where it was is captured before and restored after.
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

// Wire `el` as a live Markdown editor: keep the rendered styling, edit in place, commit on blur. Checkboxes stay non-editable islands; focus moving within the block neither resets the baseline nor commits.
function wireMarkdownEditable(el) {
  const editsLinkedValue = el.dataset && el.dataset.valueStart != null;
  // A link click is navigation, not "edit here": swallow the mousedown so the block never takes focus (the delegated click still navigates), and commit the block being edited first, since no focusout will fire.
  el.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('a') && !editsLinkedValue) {
      commitActiveEditingBlock();
      event.preventDefault();
    } else if (target.closest('input[type="checkbox"]')) {
      // Swallow the mousedown so a checkbox toggle doesn't focus the block (which scrolls the clicked row to the top). The click still fires and flips it.
      event.preventDefault();
    }
  });
  // The press that opens the block, decided on release rather than on the way down: only then is it known whether this was a click or a drag. Both ends of the selection inside this block means the pointer never left it, so it is this block's to open; a drag that reached another block leaves both alone and stands as the cross-block selection it is.
  el.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || blockIsEditingHost(el)) return;
    const target = event.target;
    if (target && target.closest && (target.closest('input[type="checkbox"]') || (target.closest('a') && !editsLinkedValue))) return;
    const span = selectionTextSpanIn(el);
    if (!span) return;
    openWysiwygBlock(el, span);
  });
  // An unlocked ranged value owns its left click; the same link stays available from its menu.
  if (editsLinkedValue) {
    el.addEventListener('click', (event) => {
      if (event.button === 0 && event.target && event.target.closest && event.target.closest('a')) event.preventDefault();
    });
  }
  el.addEventListener('focusin', () => {
    if (!el.__editingActive) {
      el.__editingActive = true;
      setEditBaseline(el);
    }
  });
  el.addEventListener('focusout', (event) => {
    if (event.relatedTarget && el.contains(event.relatedTarget)) return;
    // The selection bar's link box has the focus. Committing now would re-render the page out from under the very selection the URL is about to wrap. The block gutter is the same bargain: what was pressed there saves this block itself, in the order that keeps the offsets true.
    if (selectionToolbarHoldsFocus(event.relatedTarget)) return;
    if (blockGutterHoldsFocus(event.relatedTarget)) return;
    el.__editingActive = false;
    commitBlockEdit(el, blockDomToSource(el));
    // Back to being page rather than editor, so the next drag can leave it.
    closeWysiwygBlock(el);
  });
  // The first keystroke is what the dot, Save and Undo answer to — the words are on screen, so the three have to say so before anything is clicked out of. Then every pause in the typing puts the words themselves into the document.
  el.addEventListener('input', (event) => {
    raiseTypingChrome();
    recordTypingStep(el, typedCharOf(event));
    scheduleLiveBlockEdit(el);
  });
  el.addEventListener('keydown', (event) => handleWysiwygKeydown(el, event));
  wireTypingStepBreaks(el);
}

// A step also ends when the caret is moved somewhere else, so typing in two places is two steps. Inside one block it moves two ways: the keys that walk it, and the press that puts it down.
function wireTypingStepBreaks(el) {
  el.addEventListener('keydown', (event) => {
    if (TYPING_STEP_MOVE_KEYS.has(event.key)) el.__typingBreak = true;
  });
  el.addEventListener('pointerdown', () => {
    el.__typingBreak = true;
  });
}

// A fenced code block's inside, as offsets into `src`. The fences are what make it a code block, so offering them for editing puts one backspace between the reader and a broken document. Null unless BOTH are found — this range is spliced verbatim, so an indented or unterminated block falls back to editing the whole thing.
function fencedCodeInnerSpan(src) {
  const open = /^[ \t]*(`{3,}|~{3,})[^\n]*\n/.exec(src);
  if (!open) return null;
  const fence = open[1];
  // Matched at the end so a fence drawn inside the code cannot be taken for the one that closes the block, and only by a run at least as long as the opener's.
  const close = new RegExp('\\n[ \\t]*' + fence[0] + '{' + fence.length + ',}[ \\t]*$').exec(src);
  if (!close) return null;
  const from = open[0].length;
  // close.index is the newline ending the last code line, which belongs to the separator. Below `from` it is the opener's own: an empty fence, no range to edit.
  if (close.index < from) return null;
  return { from, to: close.index };
}

// Wire `el` as a raw-source editor, for XML blocks and Markdown blocks that don't round-trip WYSIWYG. The block swaps to its exact source on focus and splices it back on blur; no change restores the rendered view, a real change triggers a host re-render. Unlike a WYSIWYG block it is not an editing host up front — `contenteditable` goes on at pointerdown, one block at a time.
function wireSourceEditable(el) {
  if (!Number.isFinite(Number(el.dataset.srcStart)) || !Number.isFinite(Number(el.dataset.srcEnd))) return;
  let start = 0;
  let end = 0;
  // Worked out on the press rather than when the block was wired: a pause in another block's typing writes into the buffer without redrawing the page, so the range this block is stamped with is the only one that is still true by then.
  const readRange = () => {
    const blockStart = Number(el.dataset.srcStart);
    const blockEnd = Number(el.dataset.srcEnd);
    start = blockStart;
    end = blockEnd;
    if (el.dataset.blockKind !== 'code_block') return;
    const src = sliceSourceBytes(currentDocumentSource, blockStart, blockEnd);
    const span = fencedCodeInnerSpan(src);
    // The span counts characters and the buffer counts bytes, and the code inside can be anything — so both ends are converted rather than assumed ASCII.
    if (span) {
      start = blockStart + utf8ByteLength(src.slice(0, span.from));
      end = blockStart + utf8ByteLength(src.slice(0, span.to));
    }
  };
  // Held on the block so a control elsewhere can open the same edit: a drawn diagram is dragged to pan, so its source comes from a corner button instead (decorate.js). Everything else still opens on a press.
  el.__startSourceEdit = () => {
    if (el.dataset.editingSource === 'true') return;
    readRange();
    // Swapping a rendered block (often a tall image) for its one-line source collapses its height; pin the reader to the block above first, or a near-top image shrinking the document would clamp the scroll to the top. focus() must not scroll either — preventScroll keeps the caret from yanking the view.
    const aboveAnchor = anchorAboveElement(el);
    const src = sliceSourceBytes(currentDocumentSource, start, end);
    el.__editBaseline = src;
    el.__renderedHtml = el.innerHTML;
    el.dataset.editingSource = 'true';
    el.textContent = src;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.classList.add('leaf-editing-source');
    // After the swap, so the run's first step is the bytes this editor opened rather than the rendered block it replaced.
    beginTypingRun(el);
    el.focus({ preventScroll: true });
    if (aboveAnchor) {
      readerScrollAnchor = aboveAnchor;
      restoreReaderScrollAnchor(aboveAnchor);
    }
  };
  // What a pause writes here: the exact bytes on screen, over the range this editor opened — never the Markdown serializer, which is not what a raw-source block is showing.
  el.__liveSourceEdit = () => ({ start, end, text: el.innerText, inner: false });
  // And where those bytes now end, so the next pause splices over them rather than over what they replaced.
  el.__liveSourceMoved = (to) => {
    end = to;
  };
  el.addEventListener('input', (event) => {
    if (el.dataset.editingSource !== 'true') return;
    raiseTypingChrome();
    recordTypingStep(el, typedCharOf(event));
    scheduleLiveBlockEdit(el);
  });
  el.addEventListener('pointerdown', (event) => {
    if (el.dataset.editingSource === 'true') return;
    // A right press asks a question, so it must reach the browser as one: cancel it here and the block swaps to its source before the menu runs, leaving the picture the gesture was aimed at gone. Same test the in-place press makes.
    if (event.button !== 0) return;
    // Let a link click navigate; source editing starts from a click on any non-link part of the block.
    if (event.target && event.target.closest && event.target.closest('a')) return;
    // A press on a fold's own row opens the fold. It is the one press on a block that already means something, and swallowing it would leave a box nothing can open.
    if (event.target && event.target.closest && event.target.closest('summary')) return;
    // A value inside this block that carries its own bytes and is wired answers the press itself. Swapping the block for its markup here would take the caret off the one word the reader aimed at, which is the whole of what a composed run of values was drawn apart for.
    if (event.target && event.target.closest && event.target.closest('[data-value-start].leaf-editable')) return;
    if (el.dataset.processed === 'true' && el.classList.contains('mermaid')) return;
    event.preventDefault();
    // Now that most of a tree document types on its words, the markup arriving is the surprise, so the press that brings it says why — the same answer a packed part of a message gives. A note's code block or diagram opens its source because that is what it is, and says nothing.
    if (currentDocumentFormat === 'xml') {
      leafToast('This one carries markup, so the file’s own text opens instead.');
    }
    el.__startSourceEdit();
  });
  el.addEventListener('blur', () => {
    if (el.dataset.editingSource !== 'true') return;
    const text = el.innerText;
    el.removeAttribute('contenteditable');
    el.classList.remove('leaf-editing-source');
    delete el.dataset.editingSource;
    // The block is about to grow back to its rendered height (an image re-decodes from zero). Anchor to the stable block above so the reader holds its place.
    const aboveAnchor = anchorAboveElement(el);
    if (!blockTextNeedsWriting(el, text)) {
      // No change: restore the rendered view (no host round-trip needed).
      el.innerHTML = el.__renderedHtml;
      stampLocalImages(el);
      if (aboveAnchor) {
        readerScrollAnchor = aboveAnchor;
        restoreReaderScrollAnchor(aboveAnchor);
      }
      return;
    }
    // Hand the host re-render (leafReloadDocument) that same above-anchor: its own top-visible capture would target this block while it is momentarily zero-height.
    pendingEditAnchor = aboveAnchor;
    commitBlockEdit(el, text, { start, end });
    // The host re-renders the document from the buffer, which restores styling.
  });
  wireTypingStepBreaks(el);
}

// A block opened from somewhere other than a press on it. Silent on a block that was never wired: a diagram in a locked document has no edit to open.
function startBlockSourceEdit(el) {
  if (el && typeof el.__startSourceEdit === 'function') el.__startSourceEdit();
}

// Wire up every mapped block. Clean text blocks, tight lists, and tables edit WYSIWYG; every other block edits its source in place. A thematic break is left alone.
//
// One pass per kind of mutation, never one pass doing all of them per block. Interleaving a `contenteditable` write with the `.leaf-editable` class (which the `:focus` rules key on) made each block force its own focus recomputation: unlocking a 50,000-block glossary took 148 SECONDS that way, half a second batched. No block is made an editing host at unlock at all now — that happens on the click that opens one — so the passes stay separate on the same principle rather than because either is still expensive.
function bindEditableBlocks(format) {
  const body = app.querySelector('.document-body');
  if (!body) return;
  const wysiwygBlocks = [];
  const sourceBlocks = [];
  body.querySelectorAll('[data-src-start]').forEach((el) => {
    if (el.dataset.srcStart == null || el.dataset.srcEnd == null) return;
    const kind = el.dataset.blockKind;
    if (kind === 'rule') return;
    // A comment's words are drawn inside the block rather than as it, and the block's own row opens the fold — so what is wired for typing is the box holding the words, and the fold itself is left to the row. Words that are not the file's own bytes fall through to the raw editor the fold has today.
    if (format === 'xml' && kind === 'comment') {
      const words = el.querySelector('.xml-comment-body');
      const commentSpan = words ? xmlCommentTypeableInPlace(el, words.textContent) : null;
      if (commentSpan) {
        words.__innerSpan = commentSpan;
        wysiwygBlocks.push(words);
        return;
      }
    }
    // A message's words, and an element's, are typed on where they are drawn wherever the page can write the file's bytes back out of them; everything else keeps the raw-slice editor. The element also carries the span its commits splice, so the tags on either side are never in the edit.
    const innerSpan = format === 'xml' ? xmlBlockTypeableInPlace(el) : null;
    const wysiwyg =
      format === 'eml'
        ? emailBlockTypeableInPlace(el)
        : format === 'xml'
          ? !!innerSpan
          : format === 'markdown' &&
            (((kind === 'heading' || kind === 'paragraph') && markdownBlockWysiwygSafe(el)) ||
              (kind === 'list' && listWysiwygSafe(el)) ||
              (kind === 'table' && tableWysiwygSafe(el)) ||
              (kind === 'blockquote' && blockquoteWysiwygSafe(el)) ||
              (kind === 'footnote_definition' && footnoteDefinitionWysiwygSafe(el)));
    if (wysiwyg) {
      if (innerSpan) el.__innerSpan = innerSpan;
      wysiwygBlocks.push(el);
    } else if (format === 'xml' && kind === 'table') {
      // A table is the one block whose shape is the reading: swapping the grid for the markup of every record takes the page away from somebody who pressed one word. So it takes no listener at all, and never a message saying why. What answers a press is what was pressed — a cell where its words are one element's own bytes, a value of a folded cell on a span of its own, and a heading over a column that has an element to rename.
    } else if (Number.isFinite(Number(el.dataset.srcStart)) && Number.isFinite(Number(el.dataset.srcEnd))) {
      // A block with an unusable range gets neither the class nor a listener; wireSourceEditable's own guard would drop it anyway.
      sourceBlocks.push(el);
    }
  });
  // A cell of a table is drawn from one leaf element, so it can answer the same question — but nothing walks a cell, because the pass above walks the names a block is found by. So the cells get a pass of their own, and the ones that cannot be proved are left to the table's own press to answer. The question is asked of anything in a table carrying the range rather than of a cell: where several elements folded into one cell, each is a span of its own and the cell carries no range at all.
  if (format === 'xml') {
    body.querySelectorAll('table [data-cell-start]').forEach((el) => {
      if (el.dataset.cellStart == null) return;
      const cellSpan = xmlCellTypeableInPlace(el);
      if (!cellSpan) return;
      el.__innerSpan = cellSpan;
      wysiwygBlocks.push(el);
    });
    // And a value the element keeps inside its own tag, drawn in the list under its heading. Nothing walks these either, and the renderer stamped only the ones it drew unchanged — so what is left to settle here is the page's own proof and which quote the value is written inside, which is the one character it can never hold.
    body.querySelectorAll('[data-value-start]').forEach((el) => {
      const valueSpan = xmlValueTypeableInPlace(el);
      if (!valueSpan) return;
      const quote = valueClosingQuote(valueSpan.start);
      if (!quote) return;
      el.__innerSpan = valueSpan;
      el.__valueQuote = quote;
      wysiwygBlocks.push(el);
    });
    // And the headings, decided by the same ranges: one that stands over a column with an element behind it opens onto the tag rather than onto the label it was drawn with.
    wireXmlTableHeadings(body);
  }
  wysiwygBlocks.forEach(markMarkdownEditable);
  wysiwygBlocks.forEach((el) => el.classList.add('leaf-editable'));
  sourceBlocks.forEach((el) => el.classList.add('leaf-editable'));
  wysiwygBlocks.forEach(wireMarkdownEditable);
  sourceBlocks.forEach(wireSourceEditable);
}

// A message is part open and part shut, and nothing on the page says which. Pressing a part that proved no range says why, in the same strip a locked source growls a refused edit with — because a control that answers a press with nothing is the fault this whole ticket started from. Only the two parts a reader would try to type in: an attachment is a file, not words on the page.
function wireEmailClosedParts(body) {
  body.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    // Something with a range under the pointer is a part that opens; it answers for itself.
    if (target.closest('[data-src-start]')) return;
    if (target.closest('.email-body')) {
      leafToast('These words are packed into the message. Edit them in the source view.');
      return;
    }
    if (target.closest('.email-headers')) {
      leafToast('This line is folded or coded in the message. Edit it in the source view.');
    }
  });
}

// The data half of the same answer. A JSON or YAML block with no proven range is drawn exactly like the ones beside it that open, so silence reads as the page being broken rather than as the file being written a way nothing can place. The two lines split on what could not be proved: where a collection ends, or how a single value is spelled.
function wireDataClosedParts(body) {
  body.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    // Something with a range under the pointer is a block that opens; it answers for itself.
    if (target.closest('[data-src-start]')) return;
    // The big heading over a file that names no title of its own is the file's name, and pressing it opens the rename box. It is answered, so it is not silent.
    if (target.closest('[data-borrowed-title]')) return;
    const block = target.closest('[data-block-id]');
    if (!block) return;
    const kind = block.dataset.blockKind;
    if (kind === 'data_table' || kind === 'data_list') {
      leafToast('The page cannot tell where this ends in the file. Edit it in the source view.');
      return;
    }
    // A heading is a key's name as often as it is a value, and the page anchors none of the names — so it says where the words came from rather than claiming something about how a value is spelled.
    if (kind === 'data_heading') {
      leafToast('This heading comes from the file. Edit it in the source view.');
      return;
    }
    leafToast('This value is written a way the page cannot place in the file. Edit it in the source view.');
  });
}

// Land the caret carried across a structural edit's re-render: focus the destination block (by its post-splice offset) and restore the position, or open the chained empty insert paragraph. A missing target degrades to nothing.
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
  // A cell, and a value inside a tag, each answer to their own names rather than a block's — the gutter reads a block's, and either wearing them would be offered a drag handle. So the caret comes back under whichever name it left on.
  const target = body.querySelector(`[${pending.found || 'data-src-start'}="${pending.srcStart}"]`);
  if (!target) return;
  if (pending.insertBelow) {
    openInsertBlockAfter(target, pending.blockSpec);
    return;
  }
  // The block is not a host until something opens it, and landing a caret is one of the things that does — the edit before this one was typed, so typing carries on.
  if (!target.classList.contains('leaf-editable') || target.dataset.editingSource === 'true') return;
  const offset = pending.textOffset || 0;
  openWysiwygBlock(target, { start: offset, end: offset });
  if (blockIsEditingHost(target)) {
    target.focus({ preventScroll: true });
    placeCaretInBlock(target, offset);
  }
}

// Land a caret the render deferred. The reading view is decorated while hidden (see renderState) and a hidden element can't take focus, so this runs after the reveal.
function placeDeferredReadingCaret() {
  const body = app.querySelector('.document-body');
  if (body) placePendingCaret(body);
}

// Orchestrate the reading view's editing layer after each render: remember source/format, attach ranges, make checkboxes interactive, wire editors. `deferCaret` leaves the pending caret for placeDeferredReadingCaret().
function bindReadingEditor(doc, { deferCaret = false } = {}) {
  if (!doc) return;
  const body = app.querySelector('.document-body');
  if (!body) return;
  currentDocumentFormat = doc.format || 'markdown';
  currentDocumentSource = typeof doc.source === 'string' ? doc.source : '';
  currentDocumentDialect = typeof doc.dialect === 'string' ? doc.dialect : null;
  // Markdown is the named exception: an empty note has no blocks and is the one page a reader unlocks precisely to start typing in.
  currentDocumentBindsAnything =
    currentDocumentFormat === 'markdown' || (Array.isArray(doc.blocks) && doc.blocks.length > 0);
  // Checkboxes stay interactive on a locked page: a task toggle is a quick action that auto-saves and records no undo, not text editing. Only the click-to-type editable blocks are behind the padlock.
  if (currentDocumentFormat === 'markdown') {
    attachMarkdownBlockRanges(body, Array.isArray(doc.blocks) ? doc.blocks : [], currentDocumentSource);
    bindTaskCheckboxes(doc.tasks || []);
  }
  if (readerEditingAllowed()) {
    bindEditableBlocks(currentDocumentFormat);
    if (currentDocumentFormat === 'eml') wireEmailClosedParts(body);
    if (currentDocumentFormat === 'json' || currentDocumentFormat === 'yaml') wireDataClosedParts(body);

    // An unlocked document with no blocks in it -- a new one -- has nothing to click into. Open its first line, or the page is unlocked and untypable.
    if (currentDocumentFormat === 'markdown' && !pendingCaret && !body.querySelector('[data-src-start]')) {
      setPendingCaret({ emptyDocument: true });
    }
  }
  if (currentDocumentFormat === 'markdown') {
    bindTableCheckboxes();
    bindFrontmatterFields(body);
  }
  // The gutter and the selection bar read the format and the unlock, so they bind after both are set.
  bindBlockControls();
  bindTableSheet();
  bindSelectionToolbar();
  if (!deferCaret) placePendingCaret(body);
}

// Re-sync editing state after a buffer edit that needs no re-render (a task toggle). Refreshes the dirty state and adopts the toggled buffer as the source the raw-source editors slice from, or a later edit would revert the toggle.
window.leafBlocksResynced = (state) => {
  if (!state) return;
  if (typeof state.source === 'string') currentDocumentSource = state.source;
  const path = activeDocumentPath();
  if (path) {
    const wasUndoable = undoableByPath.get(path) === true;
    const wasRedoable = redoableByPath.get(path) === true;
    if (typeof state.canUndo === 'boolean') undoableByPath.set(path, state.canUndo);
    if (typeof state.canRedo === 'boolean') redoableByPath.set(path, state.canRedo);
    setDirtyState(path, !!state.dirty);
    // setDirtyState only refreshes the bar when the dirty flag itself moved, and an undo in the middle of a run moves neither it nor Undo — the button that changes there is Redo.
    if ((undoableByPath.get(path) === true) !== wasUndoable || (redoableByPath.get(path) === true) !== wasRedoable) {
      updateEditingChrome();
    }
  }
};
