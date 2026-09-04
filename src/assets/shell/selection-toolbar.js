// ---------------------------------------------------------------------------
// The selection toolbar: highlight words in the reading view and what they can become appears over them.
//
// The inline buttons work on the DOM of a block that is already a live editor, so bold is a `<strong>` the block's own blur commit serializes into `**` — one path into the buffer, not a second one beside it. The block buttons (text, the two heading sizes, quote) are the exception: a block's KIND is source rather than markup, so those splice the block's range the way Enter and Backspace already do.
//
// Only WYSIWYG Markdown blocks are offered anything. A raw-source block is showing its own `**` while you edit it, and a bar that wrote a second pair over the selection would be marking up the markup.
//
// The bar itself is not behind the padlock; its buttons are. The reading formats mark the words up or read them out, so a locked page is offered them; the inline and block formats change what the document is, and stay hidden until it is unlocked. A locked page already carries the byte ranges and the block kinds, so none of the reading formats needs an editing host opened for it — and `restoreSelectionForEdit`, which is what opens one, refuses to run at all while locked.
// ---------------------------------------------------------------------------

// How far above the highlighted line the bar floats, leaving room for its point.
const SELECTION_TOOLBAR_LIFT = 12;
// What the one input in the bar asks for while it is the link box. Held here because the note box borrows the same input and has to hand it back saying this again.
const SELECTION_LINK_PLACEHOLDER = 'Paste or type a link';
// How close to either edge of the page the bar may come. The same number caps its width in reading/selection-toolbar.css, so a bar too wide for the column wraps rather than being clamped to a left edge whose right edge then hangs past the words.
const SELECTION_TOOLBAR_MARGIN = 8;

// The inline formats, in the order the bar shows them. `command` is the browser's own — worth having, because it already knows how to bold half of an italic and how to undo it; the tags it reaches for are normalized afterwards. The rest are wrapped by hand: `code` holds text and nothing else, and a link needs a URL before it can exist.
const INLINE_FORMATS = [
  { id: 'bold', label: 'Bold', icon: `<span class="lt-icon lt-icon-bold"></span>`, command: 'bold', tag: 'strong' },
  { id: 'italic', label: 'Italic', icon: `<span class="lt-icon lt-icon-italic"></span>`, command: 'italic', tag: 'em' },
  { id: 'strike', label: 'Strikethrough', icon: `<span class="lt-icon lt-icon-strikethrough"></span>`, command: 'strikeThrough', tag: 'del' },
  { id: 'code', label: 'Code', icon: `<span class="lt-icon lt-icon-code-view"></span>`, tag: 'code' },
  { id: 'link', label: 'Link', icon: `<span class="lt-icon lt-icon-link"></span>`, tag: 'a' },
];

// What the bar offers a locked page: the words read out or marked up, never the document's shape changed. They come last in the unlocked row and are the whole of the locked one.
const READING_FORMATS = [
  { id: 'copy', label: 'Copy', icon: '<span class="lt-icon lt-icon-copy"></span>' },
  { id: 'highlight', label: 'Highlight', icon: '<span class="lt-icon lt-icon-highlighter"></span>' },
  { id: 'annotate', label: 'Annotate', icon: '<span class="lt-icon lt-icon-footnote"></span>' },
];

// What the whole block can become, in the order the bar shows them. Each is written by rewriting that block's source from its text.
//
// Nothing here toggles: a button with nowhere to go grays out, and Text is the way out of a heading. Pressing the size you are on and having the heading come off says the wrong thing.
//
// The H's are a bigger and a smaller, one level per press. Relative rather than fixed levels so all six are reachable, including the `#` a document may hold many of.
const BLOCK_FORMATS = [
  { id: 'text', label: 'Text', icon: `<span class="lt-icon lt-icon-text"></span>` },
  { id: 'bigger', label: 'Bigger heading', icon: `<span class="lt-icon lt-icon-heading"></span>`, step: -1, cls: 'is-heading-bigger' },
  { id: 'smaller', label: 'Smaller heading', icon: `<span class="lt-icon lt-icon-heading"></span>`, step: 1, cls: 'is-heading-smaller' },
  { id: 'quote', label: 'Quote', icon: `<span class="lt-icon lt-icon-quote"></span>`, quote: true },
];
// Where a paragraph or a quote steps in when made a heading: the ordinary section heading, with `#` one more press of the bigger H away.
const HEADING_ENTRY_LEVEL = 2;
const BLOCK_FORMAT_KINDS = new Set(['paragraph', 'heading', 'blockquote']);

// Rebuilt with the document, like the block gutter: renderState replaces the reader's markup and everything pointing into it goes with it.
let selectionToolbar = null;
let selectionToolbarRow = null;
let selectionToolbarLinkInput = null;
let selectionToolbarButtons = new Map();
// The block the current selection lives in, and the range itself — held because the link box takes the focus, and a selection nobody remembers is one the URL has nothing to attach to.
let selectionToolbarBlock = null;
let selectionToolbarRange = null;
// The place a click landed on with nothing selected, which is where a note's marker goes. Held while it stands, because the bar shows only Annotate then and there is no selection for the press to read back.
let selectionToolbarPoint = null;

// True while the link box is open, so the block underneath is allowed to keep its pending edits: committing it there would re-render the page out from under the selection the URL is for.
function selectionToolbarHoldsFocus(node) {
  return !!(selectionToolbar && node && selectionToolbar.contains(node));
}

function hideSelectionToolbar() {
  selectionToolbarBlock = null;
  selectionToolbarRange = null;
  selectionToolbarPoint = null;
  if (!selectionToolbar) return;
  selectionToolbar.hidden = true;
  closeSelectionInputBox();
}

// Whether the one input in the bar is showing, in either of the two hats it wears.
function selectionToolbarInputOpen() {
  return !!selectionToolbar && (selectionToolbar.classList.contains('is-linking') || selectionToolbar.classList.contains('is-noting'));
}

function closeSelectionInputBox() {
  if (!selectionToolbar) return;
  selectionToolbar.classList.remove('is-linking');
  selectionToolbar.classList.remove('is-noting');
  if (selectionToolbarLinkInput) {
    selectionToolbarLinkInput.value = '';
    selectionToolbarLinkInput.placeholder = SELECTION_LINK_PLACEHOLDER;
  }
}

// The editable block a node sits in, or null. A block mid-source-edit is showing raw text, which the bar has nothing to say about.
//
// Matched on the class rather than on `contenteditable`: a block is only an editing host once it has been clicked into, and highlighting words in one that has not been is exactly when the bar is wanted. `applyInlineFormat` opens it before it runs a command, since a command needs a host.
//
// Locked, the attribute alone is the test. The class is what says a block is wired for typing and only the unlock branch adds it, while the byte ranges the reading formats splice are stamped on every block either way — so asking for the class locked would be asking for a wiring none of them uses. The source-edit guard below is unchanged: a block showing its own markup has nothing the bar can say about it, locked or not.
function selectionEditableBlock(node) {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!el || !el.closest) return null;
  const block = el.closest(readerEditingAllowed() ? '[data-src-start].leaf-editable' : '[data-src-start]');
  if (!block || block.dataset.editingSource === 'true') return null;
  if (!app.contains(block)) return null;
  return block;
}

// The nearest ancestor of `tag` between the selection and its block.
function selectionAncestor(tag) {
  if (!selectionToolbarBlock) return null;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  let node = selection.getRangeAt(0).startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  while (node && node !== selectionToolbarBlock) {
    if (node.tagName && node.tagName.toLowerCase() === tag) return node;
    node = node.parentElement;
  }
  return null;
}

// Show the bar for the selection as it stands, or take it away. Called from selectionchange, so it runs on every caret move and must be cheap and quiet.
function syncSelectionToolbar() {
  if (!selectionToolbar) return;
  // The box owns the selection while it is open — the input's own focus collapsed it, and reading that back would close the bar mid-typing.
  if (selectionToolbarInputOpen()) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    hideSelectionToolbar();
    return;
  }
  const range = selection.getRangeAt(0);
  const block = selectionEditableBlock(range.startContainer);
  if (!block || block !== selectionEditableBlock(range.endContainer) || !range.toString().trim()) {
    hideSelectionToolbar();
    return;
  }
  selectionToolbarBlock = block;
  selectionToolbarRange = range.cloneRange();
  selectionToolbarPoint = null;
  markSelectionToolbarState();
  selectionToolbar.hidden = false;
  positionSelectionToolbar(range);
}

// Light the inline buttons the selection already answers to, gray the block button the block already is, and hide the block row where the block is not one of the kinds it rewrites. Locked, both of those rows are hidden outright and the reading formats are the whole bar.
function markSelectionToolbarState() {
  const kind = selectionToolbarBlock.dataset.blockKind;
  const editing = readerEditingAllowed();
  // A click on a place rather than a passage: there is nothing to copy and nothing to mark up, so Annotate stands there on its own.
  const atPoint = !!selectionToolbarPoint;
  const blockable = editing && !atPoint && BLOCK_FORMAT_KINDS.has(kind);
  const level = kind === 'heading' ? blockHeadingLevel(selectionToolbarBlock) : 0;
  for (const [id, button] of selectionToolbarButtons) {
    if (READING_FORMATS.some((item) => item.id === id)) {
      button.hidden = atPoint && id !== 'annotate';
      continue;
    }
    const format = INLINE_FORMATS.find((item) => item.id === id);
    if (format) {
      button.hidden = !editing || atPoint;
      button.classList.toggle('is-active', editing && !atPoint && selectionFormatActive(format));
      continue;
    }
    button.hidden = !blockable;
    button.disabled = !blockFormatChanges(BLOCK_FORMATS.find((item) => item.id === id), kind, level);
  }
  selectionToolbar.classList.toggle('has-block-formats', blockable);
}

// Whether pressing a block button would change anything. False grays it out: nothing is bigger than `#`, nothing smaller than `######`, and Text is already text.
function blockFormatChanges(format, kind, level) {
  if (format.step) return !!steppedHeadingLevel(level, format.step);
  if (format.quote) return kind !== 'blockquote';
  return kind !== 'paragraph';
}

// The level one press lands on, or 0 where it has nowhere to go. Only the bigger H steps body text in — there is nothing to shrink about a paragraph.
function steppedHeadingLevel(level, step) {
  if (!level) return step < 0 ? HEADING_ENTRY_LEVEL : 0;
  const next = level + step;
  return next >= 1 && next <= 6 ? next : 0;
}

// A heading's level, read from the tag the renderer chose — the same place the serializer takes it from. 0 for anything that is not a heading.
function blockHeadingLevel(block) {
  return Number(block.tagName.substring(1)) || 0;
}

function selectionFormatActive(format) {
  if (format.command) {
    try {
      if (document.queryCommandState(format.command)) return true;
    } catch (_) {}
  }
  return !!selectionAncestor(format.tag);
}

// Float the bar over the highlighted words: centered on them, above the first line, and never past the edges of the page it belongs to.
function positionSelectionToolbar(range) {
  const layout = app.querySelector('.reader-layout');
  if (!layout) return;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : range.getBoundingClientRect();
  const layoutRect = layout.getBoundingClientRect();
  const width = selectionToolbar.offsetWidth;
  const half = width / 2;
  const wanted = rect.left + rect.width / 2 - layoutRect.left;
  const left = Math.max(half + SELECTION_TOOLBAR_MARGIN, Math.min(layoutRect.width - half - SELECTION_TOOLBAR_MARGIN, wanted));
  selectionToolbar.style.left = left + 'px';
  selectionToolbar.style.top = rect.top - layoutRect.top - SELECTION_TOOLBAR_LIFT + 'px';
  // The point under the bar tracks the words even where the bar itself had to stop at the page edge, so it still says which text this is about.
  selectionToolbar.style.setProperty('--selection-arrow', Math.round(wanted - left + half) + 'px');
}

// Put the remembered selection back and hand the block the focus, so a command runs against the words the bar was opened for. The block is opened for typing first: it may only have been highlighted, and an editing command has nothing to act on without a host.
function restoreSelectionForEdit() {
  // The one place in this file that opens an editing host, so the padlock is held here rather than at each caller: a locked page must never be handed one, however the press arrived.
  if (!readerEditingAllowed()) return false;
  if (!selectionToolbarBlock || !selectionToolbarRange) return false;
  if (!selectionToolbarBlock.isConnected) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(selectionToolbarRange);
  const span = selectionTextSpanIn(selectionToolbarBlock);
  if (!span) return false;
  openWysiwygBlock(selectionToolbarBlock, span);
  selectionToolbarBlock.focus({ preventScroll: true });
  selectTextSpanInBlock(selectionToolbarBlock, span);
  if (!selection.rangeCount) return false;
  selectionToolbarRange = selection.getRangeAt(0).cloneRange();
  return true;
}

// What the browser's own commands leave behind, in the tags this app's serializer reads. Engines differ on which of `<strike>`, `<s>` or a styled `<span>` they reach for, and a wrapper the serializer doesn't know is formatting that disappears on save — so the shapes are folded back to one set here, at once, while the edit is still only in the page.
function normalizeInlineFormatting(block) {
  const swap = (el, tag) => {
    const replacement = document.createElement(tag);
    while (el.firstChild) replacement.appendChild(el.firstChild);
    el.replaceWith(replacement);
  };
  block.querySelectorAll('strike, s, u, font').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    // Underline has no Markdown, so it keeps only its words.
    if (tag === 'u' || tag === 'font') {
      el.replaceWith(...el.childNodes);
      return;
    }
    swap(el, 'del');
  });
  block.querySelectorAll('span[style]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    if (/font-weight:\s*(bold|[6-9]00)/.test(style)) swap(el, 'strong');
    else if (/font-style:\s*italic/.test(style)) swap(el, 'em');
    else if (/text-decoration[^;]*line-through/.test(style)) swap(el, 'del');
  });
}

// Wrap the selection in `wrapper` and leave it selected, so a second button press lands on the same words.
function surroundSelection(wrapper, textOnly) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (textOnly) wrapper.textContent = range.toString();
  else wrapper.appendChild(range.extractContents());
  if (textOnly) range.deleteContents();
  range.insertNode(wrapper);
  const after = document.createRange();
  after.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(after);
  selectionToolbarRange = after.cloneRange();
}

// Take a wrapper away but keep its words, and keep them selected.
function unwrapSelectionAncestor(el) {
  const selection = window.getSelection();
  const parent = el.parentNode;
  const first = el.firstChild;
  const last = el.lastChild;
  el.replaceWith(...el.childNodes);
  // Selected before the join, not after: the join keeps the first run of words and drops the rest, so words in front of the phrase destroy the run these two ends name. Both live ranges ride the join onto the survivor at the phrase's own offsets.
  if (selection && first) {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last || first);
    selection.removeAllRanges();
    selection.addRange(range);
    selectionToolbarRange = range.cloneRange();
  }
  if (parent) parent.normalize();
}

function applyInlineFormat(format) {
  if (!restoreSelectionForEdit()) return;
  const block = selectionToolbarBlock;
  const existing = selectionAncestor(format.tag);
  if (format.command) {
    try {
      document.execCommand('styleWithCSS', false, false);
    } catch (_) {}
    document.execCommand(format.command);
    normalizeInlineFormatting(block);
  } else if (existing) {
    unwrapSelectionAncestor(existing);
  } else {
    surroundSelection(document.createElement(format.tag), format.tag === 'code');
  }
  syncSelectionToolbarSoon();
}

// Which reading format was pressed. One door, so a format added beside copy is a case here rather than another wiring in the builder.
function applyReadingFormat(format) {
  if (format.id === 'copy') copySelectionText();
  else if (format.id === 'highlight') applyHighlight();
  else if (format.id === 'annotate') applyAnnotate();
}

// Highlight: a `<mark>` around the words, or off the words that already carry one.
//
// Written on a DETACHED CLONE of the block and spliced over the block's own source range, never on the page: the inline buttons run the browser's commands, which need an editing host, and a locked page must never be handed one. So the tag goes on the clone, `blockDomToMarkdown` reads the result back out (`<mark>` is already one of the raw inline tags it writes), and the buffer is what changes — the path the block buttons already take.
//
// `blockDomToMarkdown` rather than `blockBodyMarkdown`, which strips a heading's `#` and a quote's `>` — those markers are the block's kind, and the splice is replacing the whole line.
function applyHighlight() {
  const block = selectionToolbarBlock;
  if (!block || !block.isConnected) return;
  const { start, end } = rangeOf(block, 'block');
  // An empty range is a block that exists only in the page: its words are not in the buffer for a splice to replace.
  if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) return;
  const existing = selectionAncestor('mark');
  const span = selectionToolbarSpan(block);
  if (!existing && (!span || span.end <= span.start)) return;
  const clone = block.cloneNode(true);
  // The clone is a copy made in one go, so the wrapper at position N on the page is the wrapper at position N in it. That is what carries a live element across to a tree the selection cannot reach.
  if (existing) {
    const at = [...block.querySelectorAll('mark')].indexOf(existing);
    const twin = clone.querySelectorAll('mark')[at];
    if (!twin) return;
    twin.replaceWith(...twin.childNodes);
  } else if (!wrapCloneSpan(clone, span, 'mark')) {
    return;
  }
  const text = blockDomToMarkdown(clone);
  hideSelectionToolbar();
  if (!text) return;
  sendBlockSplice(block, start, end, text);
}

// Wrap a span of a detached block's visible text in `tag`. The offsets are the ones the live selection answered for the block on the page, and the clone's text runs are the same runs, so the same two numbers name the same words in it.
function wrapCloneSpan(clone, span, tag) {
  const from = blockTextPoint(clone, span.start, true);
  const to = blockTextPoint(clone, span.end);
  if (!from || !to) return false;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const wrapper = document.createElement(tag);
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  return true;
}

// Copy: the words as they read, not the Markdown behind them. The clipboard path the right-click menu's Copy already takes, and the selection is left where it was — a second door onto one path, not a second path.
function copySelectionText() {
  if (!selectionToolbarRange) return;
  copyPlainText(selectionToolbarRange.toString());
}

// ---- annotate ---------------------------------------------------------------
//
// A note is a footnote: a marker at the end of the passage and its words at the end of the source. Both go up in one `editBlocks`, in ascending order, so the reader gets one undo rather than two — and so the second range's offsets are not moved out from under it by the first write.
//
// The label is never a number the reader will see. `relocate_footnote_definitions` moves every definition to the end in reference order and pulldown-cmark numbers them by first use, so a note written in the middle renumbers everything after it with no work here.

// The footnote label a new note takes: one no note in the document already wears. Read off the page rather than out of the buffer — the renderer knows every label it drew, and nothing may ask the page for the whole document as a string to search it.
function unusedFootnoteLabel() {
  const taken = new Set();
  const body = app.querySelector('.document-body');
  if (body) {
    body.querySelectorAll('sup.footnote-reference, .footnote-definition').forEach((el) => {
      const name = footnoteNameOf(el);
      if (name) taken.add(name);
    });
  }
  for (let at = 1; ; at += 1) {
    const label = 'note-' + at;
    if (!taken.has(label)) return label;
  }
}

// How many characters of `block`'s visible text come before `node`.
function blockTextOffsetOf(block, node) {
  const holder = node.parentElement;
  if (!holder) return 0;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(holder, [...holder.childNodes].indexOf(node));
  return before.cloneContents().textContent.length;
}

// The marker this press is on, or null. A marker sits just after the words it belongs to, so re-selecting that passage ends exactly where the marker begins — that boundary is being on it, and so is a caret anywhere in the marker itself. Nothing looser: a selection of the whole paragraph is a note about the paragraph, not a press on a marker inside it.
function footnoteReferenceAt(block, span) {
  const marks = [...block.querySelectorAll('sup.footnote-reference')];
  for (const mark of marks) {
    const at = blockTextOffsetOf(block, mark);
    if (span.end === at) return mark;
    if (span.start === span.end && span.start >= at && span.start <= at + mark.textContent.length) return mark;
  }
  return null;
}

// Put `node` at a character offset inside a detached block, splitting the run of words the offset falls in. The clone is never on the page, so nothing is drawn twice while this happens.
function insertIntoCloneAt(clone, offset, node) {
  const point = blockTextPoint(clone, offset, false);
  if (!point) return false;
  const run = point.node;
  const holder = run.parentElement;
  if (!holder) return false;
  const after = [...holder.childNodes][[...holder.childNodes].indexOf(run) + 1] || null;
  const tail = run.nodeValue.slice(point.offset);
  run.nodeValue = run.nodeValue.slice(0, point.offset);
  holder.insertBefore(node, after);
  if (tail) holder.insertBefore(document.createTextNode(tail), after);
  return true;
}

// Where a note's marker lands and what the bar is pointing at, for a press with nothing selected. A click answers a place in the text through `caretRangeFromPoint`, which is the standard question and the one that does not rest on how a collapsed selection behaves in text nobody can type in.
function caretRangeAtPoint(x, y) {
  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(x, y) || null;
  }
  // The same question under the name the other engine ships it as, so the feature does not rest on which one is under the window.
  if (typeof document.caretPositionFromPoint === 'function') {
    const at = document.caretPositionFromPoint(x, y);
    if (!at || !at.offsetNode) return null;
    const range = document.createRange();
    range.setStart(at.offsetNode, at.offset);
    range.setEnd(at.offsetNode, at.offset);
    return range;
  }
  return null;
}

// A click in the document with nothing selected: Annotate on its own, over the place that was pressed. Locked only — unlocked, that click is opening the block for typing, and a lone button standing over the caret would be in the way of it.
function offerAnnotateAtPoint(event) {
  if (!selectionToolbar || readerEditingAllowed()) return;
  if (currentDocumentFormat !== 'markdown') return;
  if (selectionToolbarInputOpen() || selectionToolbarHoldsFocus(event.target)) return;
  const selection = window.getSelection();
  if (selection && selection.rangeCount && !selection.getRangeAt(0).collapsed && String(selection).trim()) return;
  const caret = caretRangeAtPoint(event.clientX, event.clientY);
  const block = caret && selectionEditableBlock(caret.startContainer);
  if (!block) {
    hideSelectionToolbar();
    return;
  }
  selectionToolbarBlock = block;
  selectionToolbarRange = null;
  selectionToolbarPoint = caret;
  markSelectionToolbarState();
  selectionToolbar.hidden = false;
  positionSelectionToolbar(caret);
}

// Both ends of the press as character offsets in the block: the caret point where the press was a click on a place, the remembered selection otherwise.
//
// The bar's own remembered range, never the live selection. The note box takes the focus and the selection goes with it, so by the time Enter lands there is nothing left in the document to read back — which is the same reason the bar holds a copy of the range at all, and why the link box puts it back before it writes.
function selectionToolbarSpan(block) {
  const range = selectionToolbarPoint || selectionToolbarRange;
  if (!range || !block.contains(range.startContainer) || !block.contains(range.endContainer)) return null;
  const upTo = (container, offset) => {
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(container, offset);
    return before.cloneContents().textContent.length;
  };
  return { start: upTo(range.startContainer, range.startOffset), end: upTo(range.endContainer, range.endOffset) };
}

// Annotate: take a marker off where the press is already on one, or open the box to type a new note into.
function applyAnnotate() {
  const block = selectionToolbarBlock;
  if (!block || !block.isConnected) return;
  const span = selectionToolbarSpan(block);
  if (!span) return;
  const existing = footnoteReferenceAt(block, span);
  if (existing) {
    removeFootnote(block, existing);
    return;
  }
  openSelectionNoteBox();
}

// A marker deleted takes its own note with it. The two halves live in two places, and a definition left at the end of the file with nothing pointing at it is the worse of the two failures — so both ranges go up together, ascending, as one undo.
function removeFootnote(block, mark) {
  const label = footnoteNameOf(mark);
  const { start, end } = rangeOf(block, 'block');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) return;
  const clone = block.cloneNode(true);
  const at = [...block.querySelectorAll('sup.footnote-reference')].indexOf(mark);
  const twin = clone.querySelectorAll('sup.footnote-reference')[at];
  if (!twin) return;
  twin.remove();
  const text = blockDomToMarkdown(clone);
  const blocks = [{ start, end, text }];
  const note = footnoteDefinitionFor(label);
  if (note) {
    const span = rangeOf(note, 'block');
    if (Number.isFinite(span.start) && Number.isFinite(span.end) && span.start >= end) {
      const cut = blockDeleteRange(span.start, span.end);
      blocks.push({ start: cut.start, end: cut.end, text: '' });
    }
  }
  hideSelectionToolbar();
  if (!text) return;
  sendEditCommand({ command: 'editBlocks', blocks: foldTouchingBlocks(blocks) });
}

// The note at the foot of the page a label belongs to, as the renderer drew it.
function footnoteDefinitionFor(label) {
  const body = app.querySelector('.document-body');
  if (!body || !label) return null;
  return [...body.querySelectorAll('.footnote-definition[data-src-start]')].find((note) => footnoteNameOf(note) === label) || null;
}

// The note box: the link row's own input, wearing the other hat. One control, because both jobs are "type one short thing about these words" and a second input in the bar would be a second control for one of them.
function openSelectionNoteBox() {
  if (!selectionToolbar || !selectionToolbarLinkInput) return;
  selectionToolbarLinkInput.value = '';
  selectionToolbarLinkInput.placeholder = 'Type a note';
  selectionToolbar.classList.add('is-noting');
  selectionToolbarLinkInput.focus();
}

// Enter in the note box: the marker into the block, the note onto the end of the source, both in one send. An empty box writes nothing, the way an empty link box takes a link off rather than writing one.
function commitSelectionNote() {
  const note = selectionToolbarLinkInput.value.trim();
  const block = selectionToolbarBlock;
  const span = block ? selectionToolbarSpan(block) : null;
  const { start, end } = block ? rangeOf(block, 'block') : { start: NaN, end: NaN };
  hideSelectionToolbar();
  if (!note || !span || !Number.isFinite(start) || !Number.isFinite(end) || end === start) return;
  const label = unusedFootnoteLabel();
  const clone = block.cloneNode(true);
  const marker = document.createElement('sup');
  marker.className = 'footnote-reference';
  marker.setAttribute('id', 'fnref-' + label);
  // The number on screen is the renderer's, assigned by first use. The serializer writes the label off the element and never this, which is why it can be anything.
  marker.textContent = '1';
  if (!insertIntoCloneAt(clone, span.end, marker)) return;
  const text = blockDomToMarkdown(clone);
  if (!text) return;
  const tail = documentSourceLength();
  const blocks = [
    { start, end, text },
    { start: tail, end: tail, text: footnoteDefinitionSource(label, note, tail) },
  ];
  sendEditCommand({ command: 'editBlocks', blocks: foldTouchingBlocks(blocks) });
}

// The definition's own line, with exactly the blank line in front of it the end of the source is still missing.
function footnoteDefinitionSource(label, note, tail) {
  const newline = documentLineEnding();
  const behind = sliceSourceBytes(Math.max(0, tail - 2 * newline.length), tail);
  let lead = '';
  if (tail > 0 && !behind.endsWith(newline)) lead = newline + newline;
  else if (tail > 0 && !behind.endsWith(newline + newline)) lead = newline;
  return lead + '[^' + label + ']: ' + note;
}

// Two replacements that meet at one offset, written as one. The host takes a list that touches — it refuses only a range starting before the one in front of it has ended — so this is legibility rather than legality, and it is the shape a block at the very end of the source gives every time.
function foldTouchingBlocks(blocks) {
  const folded = [];
  for (const one of blocks) {
    const last = folded[folded.length - 1];
    if (last && last.end === one.start) {
      last.end = one.end;
      last.text += one.text;
      continue;
    }
    folded.push({ ...one });
  }
  return folded;
}

// The link button: a URL box, filled in with the link already there if there is one. Enter writes it, an empty box takes the link away, Escape leaves it alone.
function openSelectionLinkBox() {
  if (!selectionToolbar || !selectionToolbarLinkInput) return;
  const existing = selectionAncestor('a');
  selectionToolbarLinkInput.value = existing ? existing.getAttribute('href') || '' : '';
  selectionToolbar.classList.add('is-linking');
  selectionToolbarLinkInput.focus();
  selectionToolbarLinkInput.select();
}

function commitSelectionLink() {
  const url = selectionToolbarLinkInput.value.trim();
  selectionToolbar.classList.remove('is-linking');
  if (!restoreSelectionForEdit()) {
    hideSelectionToolbar();
    return;
  }
  const existing = selectionAncestor('a');
  if (existing) unwrapSelectionAncestor(existing);
  if (url) {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', url);
    surroundSelection(anchor, false);
  }
  syncSelectionToolbarSoon();
}

// Rewrite the block as another kind. Its text comes back through the same serializer the blur commit uses, stripped of the markers the old kind carried, so switching between kinds never stacks one on top of another — and the button for the kind it already is is disabled, so there is no toggle to reason about.
function applyBlockFormat(format) {
  const block = selectionToolbarBlock;
  if (!block) return;
  const { start, end } = rangeOf(block, 'block');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const kind = block.dataset.blockKind;
  // Recomputed rather than trusted to the disabled button: a level outside 1-6 is not a heading Markdown can write.
  const marker = blockFormatMarker(format, kind === 'heading' ? blockHeadingLevel(block) : 0);
  if (marker === null) return;
  // An empty range is a block that exists only in the page: its words are not in the buffer for a splice to replace, so its own commit carries the marker. Splicing from out here writes the marker beside the words and then writes them twice.
  if (end === start) {
    if (!block.__commitAs) return;
    hideSelectionToolbar();
    block.__commitAs(marker, block);
    return;
  }
  const body = blockBodyMarkdown(block);
  hideSelectionToolbar();
  if (!body) return;
  let text;
  if (format.step) {
    // A heading is one line, so a multi-line block folds into one becoming one.
    text = marker + body.replace(/\s*\n+\s*/g, ' ');
  } else if (format.quote) {
    text = body
      .split('\n')
      .map((line) => (marker + line).trimEnd())
      .join('\n');
  } else {
    // Text: the markers came off with the body, so there is nothing to add back.
    text = body;
  }
  sendBlockSplice(block, start, end, text);
  setPendingCaret({ srcStart: start, textOffset: 0 });
}

// The Markdown a block button puts in front of the text, or null where the press has nowhere to go and nothing should be written.
function blockFormatMarker(format, level) {
  if (!format.step) return format.quote ? '> ' : '';
  const next = steppedHeadingLevel(level, format.step);
  return next ? '#'.repeat(next) + ' ' : null;
}

// A block's words with its kind's markers taken off — a heading's `#`s, a quote's `>`s. A quote's blank `>` line becomes the blank line between two paragraphs, which is what it was standing in for.
function blockBodyMarkdown(block) {
  return blockDomToMarkdown(block)
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Re-read the selection after the DOM under it changed. A tick late on purpose: the browser settles the selection after a command before it is worth asking.
function syncSelectionToolbarSoon() {
  window.setTimeout(() => {
    if (!selectionToolbar || selectionToolbar.hidden) return;
    syncSelectionToolbar();
  }, 0);
}

function selectionToolbarButton(format, onPress) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = format.cls ? 'selection-format ' + format.cls : 'selection-format';
  button.title = format.label;
  button.setAttribute('aria-label', format.label);
  button.innerHTML = format.icon;
  // Keep the focus (and so the selection) in the block: a button that took it would have nothing left to format by the time it was pressed.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', onPress);
  return button;
}

// Build the bar for the render that just landed. One bar for the page, moved to whatever is highlighted — see block-controls.js for why not one per block.
function bindSelectionToolbar() {
  selectionToolbar = null;
  selectionToolbarRow = null;
  selectionToolbarLinkInput = null;
  selectionToolbarButtons = new Map();
  selectionToolbarBlock = null;
  selectionToolbarRange = null;
  selectionToolbarPoint = null;
  const layout = app.querySelector('.reader-layout');
  if (!layout) return;
  if (currentDocumentFormat !== 'markdown') return;

  selectionToolbar = document.createElement('div');
  selectionToolbar.className = 'selection-toolbar';
  selectionToolbar.hidden = true;
  // The point is an element rather than a pseudo because both pseudos are spoken for: the bar's shadow and its face have to be two stacked layers behind the buttons. See .selection-toolbar in reading/selection-toolbar.css.
  selectionToolbar.innerHTML =
    '<div class="selection-format-row"></div>' +
    '<div class="selection-link-row"><input type="text" class="selection-link-input" spellcheck="false" placeholder="Paste or type a link"></div>' +
    '<span class="selection-toolbar-point" aria-hidden="true"></span>';
  selectionToolbarRow = selectionToolbar.querySelector('.selection-format-row');
  selectionToolbarLinkInput = selectionToolbar.querySelector('.selection-link-input');

  for (const format of INLINE_FORMATS) {
    const button = selectionToolbarButton(format, () =>
      format.id === 'link' ? openSelectionLinkBox() : applyInlineFormat(format),
    );
    selectionToolbarButtons.set(format.id, button);
    selectionToolbarRow.appendChild(button);
  }
  const divider = document.createElement('span');
  divider.className = 'selection-format-divider';
  selectionToolbarRow.appendChild(divider);
  for (const format of BLOCK_FORMATS) {
    const button = selectionToolbarButton(format, () => applyBlockFormat(format));
    selectionToolbarButtons.set(format.id, button);
    selectionToolbarRow.appendChild(button);
  }
  // Last in the row, and the only ones a locked page keeps. Nothing divides them off: the divider the bar already carries belongs to the block row and goes when that row goes.
  for (const format of READING_FORMATS) {
    const button = selectionToolbarButton(format, () => applyReadingFormat(format));
    selectionToolbarButtons.set(format.id, button);
    selectionToolbarRow.appendChild(button);
  }

  selectionToolbarLinkInput.addEventListener('keydown', (event) => {
    // One input, two jobs: the class the bar is wearing is what says which of them Enter is finishing.
    const noting = selectionToolbar.classList.contains('is-noting');
    if (event.key === 'Enter') {
      event.preventDefault();
      if (noting) commitSelectionNote();
      else commitSelectionLink();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelectionInputBox();
      if (noting) hideSelectionToolbar();
      else restoreSelectionForEdit();
    }
  });
  layout.appendChild(selectionToolbar);
  syncSelectionToolbar();
}

document.addEventListener('selectionchange', () => {
  if (!selectionToolbar) return;
  syncSelectionToolbar();
});
// A click on a place rather than a passage. Listened for on the way back up, so a click that highlighted something has already been through selectionchange and put the bar on those words instead.
document.addEventListener('click', (event) => {
  offerAnnotateAtPoint(event);
});
// Bold, italic and a link where the hands already are. The browser would do the first two on its own inside a contenteditable, but not through the normalizing the serializer needs, and not with the bar keeping up.
window.addEventListener('keydown', (event) => {
  if (!selectionToolbar || selectionToolbar.hidden || !selectionToolbarBlock) return;
  if (event.key === 'Escape') {
    hideSelectionToolbar();
    return;
  }
  // Bold, italic and the link box all write, so they stay behind the padlock with their own buttons. Escape above closes the bar either way.
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !readerEditingAllowed()) return;
  const key = event.key.toLowerCase();
  const format = INLINE_FORMATS.find((item) => item.id === (key === 'b' ? 'bold' : key === 'i' ? 'italic' : ''));
  if (format) {
    event.preventDefault();
    applyInlineFormat(format);
    return;
  }
  if (key === 'k') {
    event.preventDefault();
    openSelectionLinkBox();
  }
});
window.addEventListener('resize', () => {
  if (selectionToolbar && !selectionToolbar.hidden) syncSelectionToolbar();
});
