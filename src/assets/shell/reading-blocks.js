// ---------------------------------------------------------------------------
// Live editing in the reading view (source-anchored, both Markdown and XML).
//
// The source buffer is the single source of truth in Rust. Every editable block
// carries its source byte range (Markdown ranges attached here from `blocks`,
// XML ranges stamped inline by the TEI renderer); an edit serializes the block
// back to source and asks the host to splice that range and re-render. Markdown
// text edits WYSIWYG; XML edits its exact source (TEI can't be reconstructed from
// the HTML). Anything not safely round-trippable stays read-only (code view only).
// ---------------------------------------------------------------------------

const sourceByteEncoder = new TextEncoder();
const sourceByteDecoder = new TextDecoder();
// The raw source between two UTF-8 byte offsets. Block ranges are byte offsets
// (Rust), but JS strings are UTF-16, so slice on the encoded bytes.
function sliceSourceBytes(source, start, end) {
  const bytes = sourceByteEncoder.encode(source || '');
  return sourceByteDecoder.decode(bytes.slice(start, end));
}

// Attach each Markdown block's source range to its rendered element. Blocks come
// in document order, but a raw-HTML wrapper (e.g. `<div align="center">`) nests
// the blocks that follow it, so they aren't all immediate children of the body.
// Walk the tree instead: descend into wrappers to reach their blocks, and step
// over a wrapper's closing tag (`</div>`), which renders to no element. If the
// structure can't be matched cleanly, attach nothing so a misaligned range can't
// drive an edit. XML ranges are stamped inline by the renderer, not here.
function attachMarkdownBlockRanges(body, blocks, source) {
  const src = typeof source === 'string' ? source : '';
  // Reader-injected, non-source elements to skip while walking.
  const isInjected = (el) =>
    el.classList.contains('document-outline') ||
    el.classList.contains('docs-pager') ||
    el.classList.contains('docs-pager-loading') ||
    el.classList.contains('frontmatter');
  // A raw-HTML block whose source is a closing tag (`</div>`) closes a wrapper
  // rather than opening an element, so it maps to no element and is stepped over.
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
      const block = nextBlock();
      if (!block) {
        mismatch = true;
        return;
      }
      cursor += 1;
      // A raw-HTML wrapper is a transparent container, not an editable block:
      // descend to its blocks but never stamp the wrapper itself, or source-
      // editing it would replace its rendered children with raw tag text.
      if (block.kind === 'html_block' && hasElementChild(el)) {
        walk(el.children);
      } else {
        pairs.push([el, block]);
      }
    }
  };
  walk(body.children);
  // Every non-closing block must have found an element, or the mapping drifted
  // and none of it can be trusted.
  if (nextBlock() !== null) mismatch = true;
  if (mismatch) return;

  for (const [el, block] of pairs) {
    el.dataset.blockId = String(block.id);
    el.dataset.srcStart = String(block.start);
    el.dataset.srcEnd = String(block.end);
    el.dataset.blockKind = block.kind;
    if (block.editable) el.dataset.editable = 'true';
  }
}

// The document-order checkboxes the reader may toggle: every body checkbox not in
// a table cell. Table-cell markers are synthesized (not `TaskListMarker`s), so the
// host's offsets exclude them; excluding them here keeps the Nth checkbox aligned.
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
    // A checkbox toggle auto-saves and records no undo, so it uses a plain send
    // (not sendEditCommand, which would optimistically flag the doc dirty).
    box.addEventListener('change', () => {
      send({ command: 'toggleTask', index });
    });
  });
}

// Make table-cell checkboxes interactive. They have no marker offset to flip
// (synthesized from cell text), so a click re-serializes the whole table from the
// DOM and splices it over the table's source range. WYSIWYG tables only — checked
// directly, since these bind even when reader editing is off (no contenteditable).
function bindTableCheckboxes() {
  const body = app.querySelector('.document-body');
  if (!body) return;
  body.querySelectorAll('[data-block-kind="table"]').forEach((table) => {
    if (!tableWysiwygSafe(table)) return;
    const start = Number(table.dataset.srcStart);
    const end = Number(table.dataset.srcEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    table.querySelectorAll('td input[type="checkbox"]').forEach((box) => {
      box.removeAttribute('disabled');
      box.addEventListener('change', () => {
        sendCheckboxBlockEdit(table, start, end, tableDomToMarkdown(table));
      });
    });
  });
}

// Serialize an anchor back to Markdown. The renderer makes several kinds of `<a>`
// that must NOT all become `[text](href)`:
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

