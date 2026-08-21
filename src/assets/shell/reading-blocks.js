// ---------------------------------------------------------------------------
// Live editing in the reading view (source-anchored, both Markdown and XML).
//
// The source buffer is the single source of truth in Rust. Every editable block carries its source byte range (Markdown ranges attached here from `blocks`, XML ranges stamped inline by the TEI renderer); an edit serializes the block back to source and asks the host to splice that range and re-render. Markdown text edits WYSIWYG; XML edits its exact source (TEI can't be reconstructed from the HTML). Anything not safely round-trippable stays read-only (code view only).
// ---------------------------------------------------------------------------

const sourceByteEncoder = new TextEncoder();
const sourceByteDecoder = new TextDecoder();
// The raw source between two UTF-8 byte offsets. Block ranges are byte offsets (Rust), but JS strings are UTF-16, so slice on the encoded bytes.
function sliceSourceBytes(source, start, end) {
  const bytes = sourceByteEncoder.encode(source || '');
  return sourceByteDecoder.decode(bytes.slice(start, end));
}

// The source ranges of a run of blocks, in document order — or null unless every one is present, ordered and non-overlapping. The host refuses a run the same way, and a drifted map must not be given the chance to shred a file. Shared by the gutter's drag and the cross-block delete, which both hand the host one run.
function blockRunRanges(elements) {
  const ranges = [];
  let previousEnd = -1;
  for (const el of elements) {
    const start = Number(el.dataset.srcStart);
    const end = Number(el.dataset.srcEnd);
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
    el.classList.contains('document-outline') ||
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
      // The reader's own lane round a wide table is a box the page added, not a block: stamp the table inside it, or an edit would serialize the wrapper and find no rows in it.
      if (el.classList.contains('table-lane')) {
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
    el.dataset.srcStart = String(block.start);
    el.dataset.srcEnd = String(block.end);
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
    // A checkbox toggle auto-saves and records no undo, so it uses a plain send (not sendEditCommand, which would optimistically flag the doc dirty).
    box.addEventListener('change', () => {
      send({ command: 'toggleTask', index });
    });
  });
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
  const start = Number(table.dataset.srcStart);
  const end = Number(table.dataset.srcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  table.querySelectorAll('td input[type="checkbox"]').forEach((box) => {
    const cell = box.closest('td');
    box.removeAttribute('disabled');
    box.addEventListener('change', () => {
      // Read after the flip: the change event fires with the new state already on.
      sendCheckboxBlockEdit(table, start, end, tableDomToMarkdown(table), tableCellPosition(table, cell));
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

