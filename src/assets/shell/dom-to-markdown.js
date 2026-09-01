// Whether this is one of the two things the renderer adds inside a footnote and the source never had: the number it is drawn with, and the arrow back to the sentence. Both carry a class saying so, in the Markdown renderer and in the TEI one alike.
function isRenderedFootnoteMark(el) {
  return !!(
    el.classList &&
    (el.classList.contains('footnote-definition-label') || el.classList.contains('footnote-backref'))
  );
}

// A footnote's name, off the element rather than off the number on screen: the reference wears `fnref-name`, the definition wears the name itself.
function footnoteNameOf(el) {
  const id = el.getAttribute ? el.getAttribute('id') || '' : '';
  return id.startsWith('fnref-') ? id.slice('fnref-'.length) : id;
}

function htmlAttributeEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rawInlineHtmlAttributes(el, tag) {
  const allowed = MARKDOWN_RAW_INLINE_ATTRIBUTES[tag] || [];
  let out = '';
  allowed.forEach((name) => {
    if (!el.hasAttribute(name)) return;
    out += ' ' + name + '="' + htmlAttributeEscape(el.getAttribute(name) || '') + '"';
  });
  return out;
}

function rawInlineHtmlToMarkdown(el, tag) {
  return '<' + tag + rawInlineHtmlAttributes(el, tag) + '>' + inlineDomToMarkdown(el) + '</' + tag + '>';
}

// Serialize a block's inline DOM back to Markdown (bold, italic, strikethrough, code, links, and safe raw inline HTML), stripping render-only decorations. Unknown wrappers contribute just their text.
function inlineDomToMarkdown(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue;
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    // The renderer's own marks inside a footnote — the number it is drawn with and the arrow back to the sentence. Neither is in the source, so neither is written back.
    if (isRenderedFootnoteMark(child)) return;
    const tag = child.tagName.toLowerCase();
    // A footnote reference is a superscript number on screen and `[^name]` in the file. The name is on the element; the number is assigned by first use and cannot be written back.
    if (tag === 'sup' && child.classList.contains('footnote-reference')) {
      const name = footnoteNameOf(child);
      if (name) {
        out += '[^' + name + ']';
        return;
      }
    }
    if (tag === 'br') {
      // Keep breaks inline. A backslash-newline hard break would end an ATX heading's source line and split the rendered heading apart on re-render.
      out += '<br>';
      return;
    }
    if (tag === 'strong' || tag === 'b') {
      out += '**' + inlineDomToMarkdown(child) + '**';
      return;
    }
    if (tag === 'em' || tag === 'i') {
      out += '*' + inlineDomToMarkdown(child) + '*';
      return;
    }
    if (tag === 'del' || tag === 's') {
      out += '~~' + inlineDomToMarkdown(child) + '~~';
      return;
    }
    if (tag === 'code') {
      out += '`' + child.textContent + '`';
      return;
    }
    if (tag === 'a') {
      out += anchorToMarkdown(child);
      return;
    }
    if (MARKDOWN_RAW_INLINE_TAGS.has(tag)) {
      out += rawInlineHtmlToMarkdown(child, tag);
      return;
    }
    out += inlineDomToMarkdown(child);
  });
  return out;
}

// The line a byte offset sits on, as offsets into `bytes`.
function sourceLineStart(bytes, at) {
  let index = Math.max(0, Math.min(at, bytes.length));
  while (index > 0 && bytes[index - 1] !== 10) index -= 1;
  return index;
}

function sourceLineEnd(bytes, at) {
  let index = Math.max(0, Math.min(at, bytes.length));
  while (index < bytes.length && bytes[index] !== 10) index += 1;
  return index;
}

// A footnote written inside a quote or a list item is lifted out and drawn at the foot of the page, so it is not in what the container draws — serializing the container alone would write its line out of the file. Its own lines go back on the end, taken from the source verbatim rather than rebuilt, separated by the container's own blank line (`>` in a quote, nothing in a list item).
function restoreLiftedFootnotes(el, markdown) {
  if (el.dataset.holdsFootnote !== 'true') return markdown;
  const { start, end } = rangeOf(el, 'block');
  const body = app.querySelector('.document-body');
  if (!body || !Number.isFinite(start) || !Number.isFinite(end)) return markdown;
  const bytes = documentSourceBytes();
  const lifted = [];
  body.querySelectorAll('.footnote-definition[data-src-start]').forEach((note) => {
    const { start: from, end: to } = rangeOf(note, 'block');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < start || to > end) return;
    const lines = sourceByteDecoder.decode(bytes.slice(sourceLineStart(bytes, from), sourceLineEnd(bytes, to)));
    // A trailing line holding nothing but the quote's own marker is the separator, not the note.
    lifted.push(lines.replace(/(\n[ \t>]*)+$/, ''));
  });
  if (!lifted.length) return markdown;
  const head = sourceByteDecoder.decode(bytes.slice(sourceLineStart(bytes, start), sourceLineEnd(bytes, start)));
  const gap = '\n' + (head.trimStart().startsWith('>') ? '>' : '') + '\n';
  return (markdown ? [markdown, ...lifted] : lifted).join(gap);
}

function blockDomToMarkdown(el) {
  const kind = el.dataset.blockKind;
  if (kind === 'list') {
    return restoreLiftedFootnotes(el, listDomToMarkdown(el, ''));
  }
  if (kind === 'table') {
    return tableDomToMarkdown(el);
  }
  if (kind === 'blockquote') {
    return restoreLiftedFootnotes(el, blockquoteDomToMarkdown(el));
  }
  if (kind === 'footnote_definition') {
    return '[^' + footnoteNameOf(el) + ']: ' + inlineDomToMarkdown(el).trim();
  }
  const text = inlineDomToMarkdown(el).trim();
  if (kind === 'heading') {
    const level = Number(el.tagName.substring(1)) || 1;
    return '#'.repeat(level) + ' ' + text;
  }
  return text;
}

// Whether the list is drawn with its items spaced apart, which is how a list written with blank lines between its items comes out: each item's words go in a paragraph of their own. The blank lines are what put them there, so they go back on the way out or the list closes up under the reader.
function listIsSpacedApart(listEl) {
  return Array.from(listEl.children).some((li) =>
    Array.from(li.children || []).some((child) => child.tagName && child.tagName.toLowerCase() === 'p'),
  );
}

// Serialize a rendered list back to Markdown item by item. Checkboxes read their live checked property, nested lists recurse with the marker-width indent, and ordered lists renumber from `start`. Items spaced apart keep their blank lines.
function listDomToMarkdown(listEl, indent) {
  const ordered = listEl.tagName.toLowerCase() === 'ol';
  const startNum = Number(listEl.getAttribute('start') || '1') || 1;
  const items = [];
  let index = 0;
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const marker = ordered ? String(startNum + index) + '. ' : '- ';
    index += 1;
    let task = '';
    const box = Array.from(li.children).find(
      (child) => child.tagName && child.tagName.toLowerCase() === 'input' && child.type === 'checkbox',
    );
    if (box) task = box.checked ? '[x] ' : '[ ] ';
    // The item's own text: everything but its checkbox and nested lists (handled separately; the clone keeps the live DOM untouched).
    const clone = li.cloneNode(true);
    Array.from(clone.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol' || tag === 'input') child.remove();
    });
    const lines = [indent + marker + task + inlineDomToMarkdown(clone).trim()];
    Array.from(li.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') {
        lines.push(listDomToMarkdown(child, indent + ' '.repeat(marker.length)));
      }
    });
    items.push(lines.join('\n'));
  });
  return items.join(listIsSpacedApart(listEl) ? '\n\n' : '\n');
}

// Serialize a rendered blockquote to `> `-prefixed Markdown, one quoted paragraph per child separated by a bare `>` line. `.blockquote-line` spans (from consumed
// <br>s) re-join with backslash hard breaks. Any unexpected child still
// serializes as a paragraph rather than being dropped.
function blockquoteDomToMarkdown(el) {
  const paragraphs = [];
  Array.from(el.children).forEach((child) => {
    const lines = Array.from(child.children).filter(
      (node) => node.classList && node.classList.contains('blockquote-line'),
    );
    const text = lines.length
      ? lines.map((line) => inlineDomToMarkdown(line).trim()).join('\\\n')
      : inlineDomToMarkdown(child).trim();
    if (text) paragraphs.push(text);
  });
  return paragraphs
    .map((text) =>
      text
        .split('\n')
        .map((line) => ('> ' + line).trimEnd())
        .join('\n'),
    )
    .join('\n>\n');
}

// The delimiter row for a serialized table. The original row is reused verbatim while the column count holds, so a cell edit never reformats the table.
function tableDelimiterRow(el, headCells) {
  const { start, end } = rangeOf(el, 'block');
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const src = sliceSourceBytes(start, end);
    for (const line of src.split('\n').slice(1, 3)) {
      const trimmed = line.trim();
      if (/^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('-')) {
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
        if (cells.length === headCells.length) return trimmed;
      }
    }
  }
  return tableDelimiterCells(headCells);
}

// The row rebuilt from the header cells, for a table whose column count changed. Alignment reads off `align`, where the renderer puts it: bare dashes here drop every `:---:` in the table.
function tableDelimiterCells(headCells) {
  const dashes = headCells.map((cell) => {
    const side = (cell.getAttribute('align') || '').toLowerCase();
    if (side === 'center') return ':---:';
    if (side === 'right') return '---:';
    if (side === 'left') return ':---';
    return '---';
  });
  return '| ' + dashes.join(' | ') + ' |';
}

// One rendered cell as GFM: newlines collapse and pipes escape, so what comes back always fits between two pipes. A checkbox-only cell writes its live state as `[ ]`/`[x]` — the marker in a cell is drawn from the text, not parsed as one.
function tableCellMarkdown(cell) {
  const box = cell.querySelector('input[type="checkbox"]');
  const text = inlineDomToMarkdown(cell)
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/\\\n/g, ' ')
    .replace(/\n+/g, ' ');
  if (box && !text) return box.checked ? '[x]' : '[ ]';
  return text;
}

// The table's rows as the host counts them: the head row first, then the body.
function tableRowElements(el) {
  const head = el.querySelector(':scope > thead > tr');
  const rows = head ? [head] : [];
  el.querySelectorAll(':scope > tbody > tr').forEach((tr) => rows.push(tr));
  return rows;
}

// Every cell of a table as Markdown, row by row. The baseline a commit measures against to find the one cell somebody typed in.
function tableCellTexts(el) {
  if (!el || el.dataset.blockKind !== 'table') return null;
  return tableRowElements(el).map((tr) => Array.from(tr.children).map(tableCellMarkdown));
}

// The one cell that changed between the baseline and the table as it stands now, in the form the host writes: `{ row, column, columns, text }`. Null unless exactly one cell moved and the table kept every row and column it had — anything else is a whole-table rewrite, which is the only thing that can add or drop a column.
function tableCellChange(before, after) {
  if (!before || !after || before.length !== after.length) return null;
  let found = null;
  for (let row = 0; row < after.length; row += 1) {
    if (before[row].length !== after[row].length) return null;
    for (let column = 0; column < after[row].length; column += 1) {
      if (before[row][column] === after[row][column]) continue;
      if (found) return null;
      found = { row, column, columns: after[row].length, text: after[row][column] };
    }
  }
  return found;
}

// Where one cell sits in the table that owns it, in that same form. Null for a cell this table does not own — a nested table's is its own block's business.
function tableCellPosition(el, cell) {
  const tr = cell.parentElement;
  const row = tableRowElements(el).indexOf(tr);
  const column = tr ? Array.from(tr.children).indexOf(cell) : -1;
  if (row < 0 || column < 0) return null;
  return { row, column, columns: tr.children.length, text: tableCellMarkdown(cell) };
}

// Serialize a rendered table to GFM pipes. The fallback for a table whose cell the host cannot place: it rebuilds every row, so a table lined up by hand loses its columns — see tableCellChange for the path that writes one cell instead.
function tableDomToMarkdown(el) {
  const headCells = Array.from(el.querySelectorAll(':scope > thead > tr > th'));
  const lines = ['| ' + headCells.map(tableCellMarkdown).join(' | ') + ' |'];
  lines.push(tableDelimiterRow(el, headCells));
  el.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll(':scope > td'));
    lines.push('| ' + cells.map(tableCellMarkdown).join(' | ') + ' |');
  });
  return lines.join('\n');
}

const MARKDOWN_WYSIWYG_INLINE_TAGS = new Set([
  'a', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code',
  'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',
]);

// Walked rather than handed to a tree walker so a subtree the serializer drops can be stepped over: the number a footnote is drawn with and its arrow back are not the block's to round-trip.
function inlineMarkdownDomWysiwygSafe(el) {
  for (const node of Array.from(el.children || [])) {
    if (isRenderedFootnoteMark(node)) continue;
    if (!MARKDOWN_WYSIWYG_INLINE_TAGS.has(node.tagName.toLowerCase())) return false;
    if (!inlineMarkdownDomWysiwygSafe(node)) return false;
  }
  return true;
}

// Whether a Markdown block edits WYSIWYG safely. Links are fine (anchorToMarkdown reproduces each form), but raw HTML elements such as <sub> cannot be reconstructed from their rendered DOM, so they use source editing.
function markdownBlockWysiwygSafe(el) {
  return inlineMarkdownDomWysiwygSafe(el) && !el.querySelector('img, .katex, .mermaid, input');
}

// A list serializes faithfully when its items hold inline content, plus checkboxes and nested lists. A list spaced apart draws each item's words in one paragraph, and that writes back — a *second* paragraph in an item is a continuation whose indent cannot be read off the page, so those keep the source editor along with lists holding real blocks.
function listWysiwygSafe(el) {
  if (el.querySelector('pre, blockquote, table, img, .katex, .mermaid')) return false;
  return Array.from(el.querySelectorAll('li')).every(
    (item) => Array.from(item.children).filter((child) => child.tagName.toLowerCase() === 'p').length <= 1,
  );
}

// A table serializes back faithfully when its cells hold only inline content (checkbox cells included) and it has a real header row to key the pipes off.
function tableWysiwygSafe(el) {
  return (
    !el.querySelector('img, pre, blockquote, table, .katex, .mermaid') &&
    !!el.querySelector(':scope > thead > tr > th')
  );
}

// A blockquote edits WYSIWYG when it's a plain quote of paragraphs. GitHub alerts and quotes holding nested blocks keep the raw-source editor.
function blockquoteWysiwygSafe(el) {
  if (el.classList.contains('markdown-alert')) return false;
  if (el.querySelector('blockquote, pre, table, ul, ol, img, .katex, .mermaid, input')) {
    return false;
  }
  return Array.from(el.children).every((child) => child.tagName.toLowerCase() === 'p');
}

// A footnote edits as it is drawn when it holds one paragraph. A second one is indented in the source and that indent cannot be read back off the page, so those keep the source editor.
function footnoteDefinitionWysiwygSafe(el) {
  const paragraphs = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === 'p');
  if (paragraphs.length !== 1) return false;
  if (el.querySelector('ul, ol, pre, table, blockquote, img, .katex, .mermaid, input')) return false;
  return !!footnoteNameOf(el) && inlineMarkdownDomWysiwygSafe(paragraphs[0]);
}

