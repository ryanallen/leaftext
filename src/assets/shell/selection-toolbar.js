// ---------------------------------------------------------------------------
// The selection toolbar: highlight words in the reading view and what they can
// become appears over them.
//
// The inline buttons work on the DOM of a block that is already a live editor, so
// bold is a `<strong>` the block's own blur commit serializes into `**` — one path
// into the buffer, not a second one beside it. The block buttons (text, the two
// heading sizes, quote) are the exception: a block's KIND is source rather than
// markup, so those splice the block's range the way Enter and Backspace already do.
//
// Only WYSIWYG Markdown blocks are offered anything. A raw-source block is showing
// its own `**` while you edit it, and a bar that wrote a second pair over the
// selection would be marking up the markup.
// ---------------------------------------------------------------------------

// How far above the highlighted line the bar floats, leaving room for its point.
const SELECTION_TOOLBAR_LIFT = 12;

// The inline formats, in the order the bar shows them. `command` is the browser's
// own — worth having, because it already knows how to bold half of an italic and
// how to undo it; the tags it reaches for are normalized afterwards. The rest are
// wrapped by hand: `code` holds text and nothing else, and a link needs a URL
// before it can exist.
const INLINE_FORMATS = [
  { id: 'bold', label: 'Bold', icon: `{{BOLD_ICON_SVG}}`, command: 'bold', tag: 'strong' },
  { id: 'italic', label: 'Italic', icon: `{{ITALIC_ICON_SVG}}`, command: 'italic', tag: 'em' },
  { id: 'strike', label: 'Strikethrough', icon: `{{STRIKETHROUGH_ICON_SVG}}`, command: 'strikeThrough', tag: 'del' },
  { id: 'code', label: 'Code', icon: `{{CODE_VIEW_ICON_SVG}}`, tag: 'code' },
  { id: 'link', label: 'Link', icon: `{{LINK_ICON_SVG}}`, tag: 'a' },
];

// What the whole block can become, in the order the bar shows them. Each is written
// by rewriting that block's source from its text.
//
// Four states, one button each, and the one the block already is grays out rather
// than toggling: Text is the way out of a heading, and the size buttons only resize.
// Pressing the size you are on and having the heading come off said the wrong thing.
const BLOCK_FORMATS = [
  { id: 'text', label: 'Text', icon: `{{TEXT_ICON_SVG}}` },
  { id: 'heading', label: 'Big heading', icon: `{{HEADING_ICON_SVG}}`, level: 2 },
  { id: 'subheading', label: 'Small heading', icon: `{{HEADING_ICON_SVG}}`, level: 3, small: true },
  { id: 'quote', label: 'Quote', icon: `{{QUOTE_ICON_SVG}}`, quote: true },
];
const BLOCK_FORMAT_KINDS = new Set(['paragraph', 'heading', 'blockquote']);

// Rebuilt with the document, like the block gutter: renderState replaces the
// reader's markup and everything pointing into it goes with it.
let selectionToolbar = null;
let selectionToolbarRow = null;
let selectionToolbarLinkRow = null;
let selectionToolbarLinkInput = null;
let selectionToolbarButtons = new Map();
// The block the current selection lives in, and the range itself — held because
// the link box takes the focus, and a selection nobody remembers is one the URL
// has nothing to attach to.
let selectionToolbarBlock = null;
let selectionToolbarRange = null;

// True while the link box is open, so the block underneath is allowed to keep its
// pending edits: committing it there would re-render the page out from under the
// selection the URL is for.
function selectionToolbarHoldsFocus(node) {
  return !!(selectionToolbar && node && selectionToolbar.contains(node));
}

function hideSelectionToolbar() {
  selectionToolbarBlock = null;
  selectionToolbarRange = null;
  if (!selectionToolbar) return;
  selectionToolbar.hidden = true;
  closeSelectionLinkBox();
}

function closeSelectionLinkBox() {
  if (!selectionToolbar) return;
  selectionToolbar.classList.remove('is-linking');
  if (selectionToolbarLinkInput) selectionToolbarLinkInput.value = '';
}

// The editable block a node sits in, or null. A block mid-source-edit is showing
// raw text, which the bar has nothing to say about.
function selectionEditableBlock(node) {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!el || !el.closest) return null;
  const block = el.closest('[data-src-start][contenteditable="true"]');
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

// Show the bar for the selection as it stands, or take it away. Called from
// selectionchange, so it runs on every caret move and must be cheap and quiet.
function syncSelectionToolbar() {
  if (!selectionToolbar) return;
  // The link box owns the selection while it is open — the input's own focus
  // collapsed it, and reading that back would close the bar mid-typing.
  if (selectionToolbar.classList.contains('is-linking')) return;
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
  markSelectionToolbarState();
  selectionToolbar.hidden = false;
  positionSelectionToolbar(range);
}

// Light the inline buttons the selection already answers to, gray the block button
// the block already is, and hide the block row where the block is not one of the
// kinds it rewrites.
function markSelectionToolbarState() {
  const kind = selectionToolbarBlock.dataset.blockKind;
  const blockable = BLOCK_FORMAT_KINDS.has(kind);
  const already = blockable ? currentBlockFormatId(selectionToolbarBlock, kind) : null;
  for (const [id, button] of selectionToolbarButtons) {
    const format = INLINE_FORMATS.find((item) => item.id === id);
    if (format) {
      button.classList.toggle('is-active', selectionFormatActive(format));
      continue;
    }
    button.hidden = !blockable;
    button.disabled = id === already;
  }
  selectionToolbar.classList.toggle('has-block-formats', blockable);
}

// Which block button the highlighted block already is — the one thing the bar has
// nothing to do, so it grays out.
function currentBlockFormatId(block, kind) {
  if (kind === 'blockquote') return 'quote';
  if (kind !== 'heading') return 'text';
  return headingButtonLevel(blockHeadingLevel(block)) === 2 ? 'heading' : 'subheading';
}

// A heading's level, read from the tag the renderer chose — the same place the
// serializer takes it from. 0 for anything that is not a heading.
function blockHeadingLevel(block) {
  return Number(block.tagName.substring(1)) || 0;
}

// Which of the two H's a heading counts as: six Markdown levels, two sizes, so a
// document's own `#` rounds to the big one and anything past `###` to the small one.
// Rounding only decides which button grays — no level is rewritten by being shown.
function headingButtonLevel(level) {
  return level <= 2 ? 2 : 3;
}

function selectionFormatActive(format) {
  if (format.command) {
    try {
      if (document.queryCommandState(format.command)) return true;
    } catch (_) {}
  }
  return !!selectionAncestor(format.tag);
}

// Float the bar over the highlighted words: centered on them, above the first
// line, and never past the edges of the page it belongs to.
function positionSelectionToolbar(range) {
  const layout = app.querySelector('.reader-layout');
  if (!layout) return;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[0] : range.getBoundingClientRect();
  const layoutRect = layout.getBoundingClientRect();
  const width = selectionToolbar.offsetWidth;
  const half = width / 2;
  const wanted = rect.left + rect.width / 2 - layoutRect.left;
  const left = Math.max(half + 8, Math.min(layoutRect.width - half - 8, wanted));
  selectionToolbar.style.left = left + 'px';
  selectionToolbar.style.top = rect.top - layoutRect.top - SELECTION_TOOLBAR_LIFT + 'px';
  // The point under the bar tracks the words even where the bar itself had to
  // stop at the page edge, so it still says which text this is about.
  selectionToolbar.style.setProperty('--selection-arrow', Math.round(wanted - left + half) + 'px');
}

// Put the remembered selection back and hand the block the focus, so a command
// runs against the words the bar was opened for.
function restoreSelectionForEdit() {
  if (!selectionToolbarBlock || !selectionToolbarRange) return false;
  if (!selectionToolbarBlock.isConnected) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  selectionToolbarBlock.focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(selectionToolbarRange);
  return true;
}

// What the browser's own commands leave behind, in the tags this app's serializer
// reads. Engines differ on which of `<strike>`, `<s>` or a styled `<span>` they
// reach for, and a wrapper the serializer doesn't know is formatting that
// disappears on save — so the shapes are folded back to one set here, at once,
// while the edit is still only in the page.
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

// Wrap the selection in `wrapper` and leave it selected, so a second button
// press lands on the same words.
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
  if (parent) parent.normalize();
  if (!selection || !first) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last || first);
  selection.removeAllRanges();
  selection.addRange(range);
  selectionToolbarRange = range.cloneRange();
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

// The link button: a URL box, filled in with the link already there if there is
// one. Enter writes it, an empty box takes the link away, Escape leaves it alone.
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

// Rewrite the block as another kind. Its text comes back through the same
// serializer the blur commit uses, stripped of the markers the old kind carried, so
// switching between kinds never stacks one on top of another — and the button for
// the kind it already is is disabled, so there is no toggle to reason about.
function applyBlockFormat(format) {
  const block = selectionToolbarBlock;
  if (!block) return;
  const start = Number(block.dataset.srcStart);
  const end = Number(block.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const body = blockBodyMarkdown(block);
  hideSelectionToolbar();
  if (!body) return;
  let text;
  if (format.level) {
    // A heading is one line, so a multi-line block folds into one becoming one.
    text = '#'.repeat(format.level) + ' ' + body.replace(/\s*\n+\s*/g, ' ');
  } else if (format.quote) {
    text = body
      .split('\n')
      .map((line) => ('> ' + line).trimEnd())
      .join('\n');
  } else {
    // Text: the markers came off with the body, so there is nothing to add back.
    text = body;
  }
  sendBlockSplice(block, start, end, text);
  setPendingCaret({ srcStart: start, textOffset: 0 });
}

// A block's words with its kind's markers taken off — a heading's `#`s, a quote's
// `>`s. A quote's blank `>` line becomes the blank line between two paragraphs,
// which is what it was standing in for.
function blockBodyMarkdown(block) {
  return blockDomToMarkdown(block)
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Re-read the selection after the DOM under it changed. A tick late on purpose:
// the browser settles the selection after a command before it is worth asking.
function syncSelectionToolbarSoon() {
  window.setTimeout(() => {
    if (!selectionToolbar || selectionToolbar.hidden) return;
    syncSelectionToolbar();
  }, 0);
}

function selectionToolbarButton(format, onPress) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = format.small ? 'selection-format is-small-heading' : 'selection-format';
  button.title = format.label;
  button.setAttribute('aria-label', format.label);
  button.innerHTML = format.icon;
  // Keep the focus (and so the selection) in the block: a button that took it
  // would have nothing left to format by the time it was pressed.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', onPress);
  return button;
}

// Build the bar for the render that just landed. One bar for the page, moved to
// whatever is highlighted — see block-controls.js for why not one per block.
function bindSelectionToolbar() {
  selectionToolbar = null;
  selectionToolbarRow = null;
  selectionToolbarLinkRow = null;
  selectionToolbarLinkInput = null;
  selectionToolbarButtons = new Map();
  selectionToolbarBlock = null;
  selectionToolbarRange = null;
  const layout = app.querySelector('.reader-layout');
  if (!layout || !readerEditingAllowed()) return;
  if (currentDocumentFormat !== 'markdown') return;

  selectionToolbar = document.createElement('div');
  selectionToolbar.className = 'selection-toolbar';
  selectionToolbar.hidden = true;
  // The point is an element rather than a pseudo because both pseudos are spoken
  // for: the bar's shadow and its face have to be two stacked layers behind the
  // buttons. See .selection-toolbar in reading.css.
  selectionToolbar.innerHTML =
    '<div class="selection-format-row"></div>' +
    '<div class="selection-link-row"><input type="text" class="selection-link-input" spellcheck="false" placeholder="Paste or type a link"></div>' +
    '<span class="selection-toolbar-point" aria-hidden="true"></span>';
  selectionToolbarRow = selectionToolbar.querySelector('.selection-format-row');
  selectionToolbarLinkRow = selectionToolbar.querySelector('.selection-link-row');
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

  selectionToolbarLinkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSelectionLink();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelectionLinkBox();
      restoreSelectionForEdit();
    }
  });
  layout.appendChild(selectionToolbar);
  syncSelectionToolbar();
}

document.addEventListener('selectionchange', () => {
  if (!selectionToolbar) return;
  syncSelectionToolbar();
});
// Bold, italic and a link where the hands already are. The browser would do the
// first two on its own inside a contenteditable, but not through the normalizing
// the serializer needs, and not with the bar keeping up.
window.addEventListener('keydown', (event) => {
  if (!selectionToolbar || selectionToolbar.hidden || !selectionToolbarBlock) return;
  if (event.key === 'Escape') {
    hideSelectionToolbar();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
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
