// ---------------------------------------------------------------------------
// Live editing in the reading view (source-anchored, both Markdown and XML).
//
// The source buffer is the single source of truth in Rust. Every editable block carries its source byte range (Markdown ranges attached here from `blocks`, XML ranges stamped inline by the TEI renderer); an edit serializes the block back to source and asks the host to splice that range and re-render. Markdown text edits WYSIWYG; XML edits its exact source (TEI can't be reconstructed from the HTML). Anything not safely round-trippable stays read-only (code view only).
// ---------------------------------------------------------------------------

const sourceByteEncoder = new TextEncoder();
const sourceByteDecoder = new TextDecoder();
// The bytes of the last source asked for. Replace-all takes two ranges per match group and a column rename two per cell, so without it a long document is encoded whole a thousand times over for a few kilobytes of answer. Keyed on the string handed in rather than kept beside `currentDocumentSource`, which also moves after a live splice and after a buffer re-sync.
let sourceByteCacheOf = null;
let sourceByteCache = null;
// The raw source between two UTF-8 byte offsets. Block ranges are byte offsets (Rust), but JS strings are UTF-16, so slice on the encoded bytes.
function sliceSourceBytes(source, start, end) {
  const text = source || '';
  if (sourceByteCache === null || text !== sourceByteCacheOf) {
    sourceByteCache = sourceByteEncoder.encode(text);
    sourceByteCacheOf = text;
  }
  return sourceByteDecoder.decode(sourceByteCache.slice(start, end));
}

// ---- the one door to a drawn range ------------------------------------------
//
// The `data-*` pair each kind of typed-on thing carries its own byte range under. A block's names are read by four other things — the gutter's plus, the drag handle, a delete over a run — so a cell of a table and a value an element keeps in a tag each wear a pair of their own, and nothing on the page wears two. Every gesture that moves a range or finds a thing by one walks this list, because a name added to one gesture and not the next is a splice at the wrong offset.
const RANGE_NAMES = [
  { kind: 'block', found: 'data-src-start', start: 'srcStart', end: 'srcEnd' },
  { kind: 'cell', found: 'data-cell-start', start: 'cellStart', end: 'cellEnd' },
  { kind: 'value', found: 'data-value-start', start: 'valueStart', end: 'valueEnd' },
];

const rangeNamesOf = (kind) => RANGE_NAMES.find((pair) => pair.kind === kind) || null;

// Every read and every write of a drawn range goes through the functions below, and nowhere in the page is one of those six names spelled against an element's own `dataset` — `scripts/check-shell/block-ranges.mjs` refuses it. Eighty-nine places used to read them straight off the DOM, and a single one left behind splices the wrong bytes into somebody's file, so there has to be exactly one place the numbers can move to.

// Every drawn range on the page, keyed on the element wearing it, each entry holding whichever of the three kinds that element carries. The numbers live here rather than in the element's own attributes because a typing pause moves every one of them: 40,000 offsets move in this table in 0.9 ms where the same 40,000 written back as `data-*` attributes cost 33, which is a wait somebody feels at every pause in a long document. Reset and refilled once per render, so it holds one document's elements and a page that has moved on drops out of it whole.
let drawnRanges = new Map();

// What an element wears where its number used to be. The attribute stays — sixteen places ask `closest('[data-src-start]')` to know whether something can be typed on at all, which is a different question — but its value is no longer an offset, so a read that got past the check reads `NaN` and is refused by the `Number.isFinite` guard every caller already has, rather than splicing an offset the buffer left behind.
const RANGE_HELD_IN_TABLE = '-';

// Start a document's table. The body is drawn whole on every render, so nothing of the last one is worth keeping and holding it would keep its elements alive.
function resetDrawnRanges() {
  drawnRanges = new Map();
}

// The two byte offsets `el` carries for `kind`, each NaN where it carries none. Callers hold the pair against `Number.isFinite` before splicing anything, the way they held the attribute. An element the table has never seen is read off its own attributes, which is what an element drawn since the render — a card's diagram, markup a step taken back put back — still wears.
function rangeOf(el, kind) {
  const names = el && el.dataset ? rangeNamesOf(kind) : null;
  if (!names) return { start: NaN, end: NaN };
  const held = drawnRanges.get(el);
  const pair = held ? held[kind] : null;
  if (pair) return { start: pair.start, end: pair.end };
  return { start: Number(el.dataset[names.start]), end: Number(el.dataset[names.end]) };
}

// Whether `el` carries a range for `kind` at all, which is a different question from whether the numbers are usable: a range of no length means the document put this element here, and no range at all means the page did.
function hasRangeOf(el, kind) {
  const names = el && el.dataset ? rangeNamesOf(kind) : null;
  if (!names) return false;
  const held = drawnRanges.get(el);
  if (held && held[kind]) return true;
  return el.dataset[names.start] != null && el.dataset[names.end] != null;
}

// Move or stamp the pair. The numbers go in the table and the element wears the mark, so the page can still be asked whether this is something to type on while nothing can read an offset off it.
function setRangeOf(el, kind, start, end) {
  const names = el && el.dataset ? rangeNamesOf(kind) : null;
  if (!names) return;
  const held = drawnRanges.get(el) || {};
  held[kind] = { start: Number(start), end: Number(end) };
  drawnRanges.set(el, held);
  el.dataset[names.start] = RANGE_HELD_IN_TABLE;
  el.dataset[names.end] = RANGE_HELD_IN_TABLE;
}

// Take into the table every range drawn on `body` that is not in it yet — the ones the Rust renderers stamp inline for a tree, a config, a workbook and a message, and anything the page drew after the render. Finding them all costs 0.6 ms on a page of 20,000, which is why the walk can stay: it is the attribute traffic that was expensive, not the looking.
function adoptDrawnRanges(body) {
  if (!body) return;
  RANGE_NAMES.forEach(({ kind, found }) => {
    body.querySelectorAll('[' + found + ']').forEach((el) => {
      const held = drawnRanges.get(el);
      if (held && held[kind]) return;
      const names = rangeNamesOf(kind);
      const start = Number(el.dataset[names.start]);
      const end = Number(el.dataset[names.end]);
      // A mark and no table entry is an element carried over from a page that is gone; there is no offset in it to take.
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      setRangeOf(el, kind, start, end);
    });
  });
}

// Move every offset at or past `at` by `delta`, in the table rather than on the page. `alsoMove` is handed each element once with the same arithmetic, so a caller holding a span of its own on an element moves it in the same walk — which is all the `Set` the old walk built ever did, and it can never have folded two entries together because nothing on the page wears two of the three names.
function moveDrawnRangesAfter(at, delta, alsoMove) {
  const move = (value) => (Number.isFinite(value) && value >= at ? value + delta : value);
  drawnRanges.forEach((held, el) => {
    for (const kind of Object.keys(held)) {
      held[kind].start = move(held[kind].start);
      held[kind].end = move(held[kind].end);
    }
    if (alsoMove) alsoMove(el, move);
  });
}

// The element still drawn on `body` whose `kind` range starts at `at`, or null. The caret carried across a re-render is the one thing that finds an element by its number rather than the other way round.
function elementWithRange(body, kind, at) {
  for (const [el, held] of drawnRanges) {
    const pair = held[kind];
    if (pair && pair.start === at && el.isConnected !== false && (!body || body === el || bodyHolds(body, el))) return el;
  }
  return null;
}

// Whether `el` is drawn inside `body`, walked rather than asked: the reader's own bay and lane sit between a table and the body, so a check against the parent alone would miss one.
function bodyHolds(body, el) {
  for (let at = el.parentElement; at; at = at.parentElement) if (at === body) return true;
  return false;
}

// The source ranges of a run of blocks, in document order — or null unless every one is present, ordered and non-overlapping. The host refuses a run the same way, and a drifted map must not be given the chance to shred a file. Shared by the gutter's drag and the cross-block delete, which both hand the host one run.
function blockRunRanges(elements) {
  const ranges = [];
  let previousEnd = -1;
  for (const el of elements) {
    const { start, end } = rangeOf(el, 'block');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd) return null;
    previousEnd = end;
    ranges.push([start, end]);
  }
  return ranges;
}

// The kinds that can only ever be drawn as one thing, so a block landing on another element means the host's list and the drawn page have drifted apart — which the counts cannot see, because a drift keeps them equal. The other kinds are left out because more than one tag is right for each: a heading is one of six, a paragraph is also how a display-maths line is drawn, a code block is a `<pre>` unless it is a diagram, and a raw HTML block is whatever it opens with.
const BLOCK_KIND_FITS = {
  rule: (el) => el.tagName === 'HR',
  table: (el) => el.tagName === 'TABLE',
  list: (el) => el.tagName === 'UL' || el.tagName === 'OL',
  footnote_definition: (el) => el.tagName === 'DIV' && el.classList.contains('footnote-definition'),
};

// Attach each Markdown block's source range to its rendered element. Blocks come in the order the page draws them, which is what makes pairing by position possible at all, but a raw-HTML wrapper (e.g. `<div align="center">`) nests the blocks that follow it, so they aren't all immediate children of the body. Walk the tree instead: descend into wrappers to reach their blocks, and step over a wrapper's closing tag (`</div>`), which renders to no element. If the structure can't be matched cleanly, attach nothing so a misaligned range can't drive an edit. XML ranges are stamped inline by the renderer, not here.
function attachMarkdownBlockRanges(body, blocks, source) {
  const src = typeof source === 'string' ? source : '';
  // Reader-injected, non-source elements to skip while walking.
  const isInjected = (el) =>
    el.classList.contains('docs-pager') ||
    el.classList.contains('docs-pager-loading') ||
    el.classList.contains('frontmatter');
  // A raw-HTML block whose source is a closing tag (`</div>`) closes a wrapper rather than opening an element, so it maps to no element and is stepped over.
  const isClosingHtmlBlock = (block) =>
    block.kind === 'html_block' &&
    sliceSourceBytes(src, block.start, block.end).trimStart().startsWith('</');
  const hasElementChild = (el) => Array.from(el.children).some((child) => child.nodeType === 1);

  const pairs = [];
  let cursor = 0;
  let mismatch = false;
  const nextBlock = () => {
    while (cursor < blocks.length && isClosingHtmlBlock(blocks[cursor])) cursor += 1;
    return cursor < blocks.length ? blocks[cursor] : null;
  };
  const walk = (elements) => {
    for (const el of elements) {
      if (el.nodeType !== 1 || isInjected(el)) continue;
      // The reader's own bay and lane round a wide table are boxes the page added, not blocks: stamp the table inside them, or an edit would serialize a wrapper and find no rows in it.
      if (el.classList.contains('table-bay') || el.classList.contains('table-lane')) {
        walk(el.children);
        continue;
      }
      const block = nextBlock();
      if (!block) {
        mismatch = true;
        return;
      }
      cursor += 1;
      const fits = BLOCK_KIND_FITS[block.kind];
      if (fits && !fits(el)) {
        mismatch = true;
        return;
      }
      // A raw-HTML wrapper is a transparent container, not an editable block: descend to its blocks but never stamp the wrapper itself, or source-editing it would replace its rendered children with raw tag text.
      if (block.kind === 'html_block' && hasElementChild(el)) {
        walk(el.children);
      } else {
        pairs.push([el, block]);
      }
    }
  };
  walk(body.children);
  // Every non-closing block must have found an element, or the mapping drifted and none of it can be trusted.
  if (nextBlock() !== null) mismatch = true;
  if (mismatch) return;

  for (const [el, block] of pairs) {
    el.dataset.blockId = String(block.id);
    setRangeOf(el, 'block', block.start, block.end);
    el.dataset.blockKind = block.kind;
    if (block.editable) el.dataset.editable = 'true';
    // A footnote was written in here and is drawn at the foot of the page instead, so what this block draws is not all of its source.
    if (block.holds_footnote) el.dataset.holdsFootnote = 'true';
  }
}

// The document-order checkboxes the reader may toggle: every body checkbox not in a table cell. Table-cell markers are synthesized (not `TaskListMarker`s), so the host's offsets exclude them; excluding them here keeps the Nth checkbox aligned. The first `.document-body` is the front tab's own: a render replaces the reader whole, so only one document is ever drawn in it, and the full-window table's grid — which wears the same name — is appended after. `check-shell.mjs` holds that order.
function readingTaskCheckboxes() {
  const body = app.querySelector('.document-body');
  if (!body) return [];
  return Array.from(body.querySelectorAll('input[type="checkbox"]')).filter((box) => !box.closest('td'));
}

function bindTaskCheckboxes(tasks) {
  const boxes = readingTaskCheckboxes();
  const count = Array.isArray(tasks) ? tasks.length : 0;
  if (boxes.length !== count) {
    // Alignment can't be trusted — leave read-only.
    return;
  }
  boxes.forEach((box, index) => {
    box.removeAttribute('disabled');
    box.dataset.taskIndex = String(index);
    box.addEventListener('change', () => {
      sendTaskToggle(box, index);
    });
  });
}

// Tick one box in a plain list. A checkbox toggle auto-saves and records no undo, so it uses a plain send (not sendEditCommand, which would optimistically flag the doc dirty).
//
// The browser drew the tick before this leaves, which is on purpose — waiting on the host would make every tick feel slow — so the send asks to be answered. Told the buffer is holding nothing, the box puts its own tick back: the host cannot name a box to redraw, and the listener that drew it is the one thing that can undraw it. Told the buffer is holding it, the tick stands, even over a file the write refused — the change is real, and the chrome the host sends beside this says so. An answer that never arrives leaves the box as the reader drew it.
function sendTaskToggle(box, index) {
  const drawn = box.checked;
  const token = leafWaitForEdit((held, why) => {
    if (!held) box.checked = !drawn;
    // The sentence rides the answer rather than being growled by the host, so a tick is only ever told about once — see say_edit_outcome, which stays quiet wherever a token came.
    if (why) leafToast(why, 'error');
  });
  send({ command: 'toggleTask', index, token });
}

// Make table-cell checkboxes interactive. They have no marker offset to flip (synthesized from cell text), so a click sends the box's own cell for the host to write, with the whole table re-serialized behind it as the fallback. WYSIWYG tables only — checked directly, since these bind even when reader editing is off (no contenteditable).
function bindTableCheckboxes() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  body.querySelectorAll('[data-block-kind="table"]').forEach(bindTableCheckboxesIn);
}

// One table's, on their own — a step of typing taken back is new markup, so the boxes inside it need binding again.
function bindTableCheckboxesIn(table) {
  if (!tableWysiwygSafe(table)) return;
  const { start, end } = rangeOf(table, 'block');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  table.querySelectorAll('td input[type="checkbox"]').forEach((box) => {
    const cell = box.closest('td');
    box.removeAttribute('disabled');
    box.addEventListener('change', () => {
      // Read after the flip: the change event fires with the new state already on.
      sendCheckboxBlockEdit(table, start, end, tableDomToMarkdown(table), tableCellPosition(table, cell), box);
    });
  });
}

// Serialize an anchor back to Markdown. The renderer makes several kinds of `<a>` that must NOT all become `[text](href)`:
//   - glossary links and GitHub refs (`.github-ref`) → their plain text;
//   - autolinks (visible text == URL) → kept bare;
//   - everything else → `[text](href)`.
function anchorToMarkdown(el) {
  const href = el.getAttribute('href') || '';
  const text = el.textContent;
  if (href.startsWith('glossary:') || el.classList.contains('github-ref')) {
    return text;
  }
  if (
    href === text ||
    href === 'mailto:' + text ||
    href === 'http://' + text ||
    href === 'https://' + text
  ) {
    return text;
  }
  return '[' + inlineDomToMarkdown(el) + '](' + href + ')';
}

const MARKDOWN_RAW_INLINE_TAGS = new Set(['abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div']);
const MARKDOWN_RAW_INLINE_ATTRIBUTES = {
  abbr: ['title'],
  div: ['align', 'id'],
  span: ['id'],
};

