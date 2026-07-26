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

// Serialize a block's inline DOM back to Markdown (bold, italic, strikethrough,
// code, links, and safe raw inline HTML), stripping render-only decorations.
// Unknown wrappers contribute just their text.
function inlineDomToMarkdown(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.nodeValue;
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const tag = child.tagName.toLowerCase();
    if (child.classList.contains('heading-anchor')) {
      return;
    }
    if (tag === 'br') {
      // Keep breaks inline. A backslash-newline hard break would end an ATX
      // heading's source line and split the rendered heading apart on re-render.
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

function blockDomToMarkdown(el) {
  const kind = el.dataset.blockKind;
  if (kind === 'list') {
    return listDomToMarkdown(el, '');
  }
  if (kind === 'table') {
    return tableDomToMarkdown(el);
  }
  if (kind === 'blockquote') {
    return blockquoteDomToMarkdown(el);
  }
  const text = inlineDomToMarkdown(el).trim();
  if (kind === 'heading') {
    const level = Number(el.tagName.substring(1)) || 1;
    return '#'.repeat(level) + ' ' + text;
  }
  return text;
}

// Serialize a rendered list back to Markdown item by item. Checkboxes read their
// live checked property, nested lists recurse with the marker-width indent, and
// ordered lists renumber from `start`. Only tight inline-content lists reach here
// (listWysiwygSafe gates the rest to the raw editor).
function listDomToMarkdown(listEl, indent) {
  const ordered = listEl.tagName.toLowerCase() === 'ol';
  const startNum = Number(listEl.getAttribute('start') || '1') || 1;
  const lines = [];
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
    // The item's own text: everything but its checkbox and nested lists (handled
    // separately; the clone keeps the live DOM untouched).
    const clone = li.cloneNode(true);
    Array.from(clone.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol' || tag === 'input') child.remove();
    });
    lines.push(indent + marker + task + inlineDomToMarkdown(clone).trim());
    Array.from(li.children).forEach((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') {
        lines.push(listDomToMarkdown(child, indent + ' '.repeat(marker.length)));
      }
    });
  });
  return lines.join('\n');
}

// Serialize a rendered blockquote to `> `-prefixed Markdown, one quoted paragraph
// per child separated by a bare `>` line. `.blockquote-line` spans (from consumed
// <br>s) re-join with backslash hard breaks. Any unexpected child still
// serializes as a paragraph rather than being dropped.
function blockquoteDomToMarkdown(el) {
  const paragraphs = [];
  Array.from(el.children).forEach((child) => {
    const tag = child.tagName.toLowerCase();
    if (tag === 'a' && child.classList.contains('heading-anchor')) return;
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

// The delimiter row for a serialized table. Alignment (`:---:`) is stripped by
// the sanitizer and can't be read from the DOM, so reuse the original delimiter
// row when its column count still matches; only a column-count change regenerates it.
function tableDelimiterRow(el, columnCount) {
  const start = Number(el.dataset.srcStart);
  const end = Number(el.dataset.srcEnd);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const src = sliceSourceBytes(currentDocumentSource, start, end);
    for (const line of src.split('\n').slice(1, 3)) {
      const trimmed = line.trim();
      if (/^\|?[\s:|-]+\|?$/.test(trimmed) && trimmed.includes('-')) {
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
        if (cells.length === columnCount) return trimmed;
      }
    }
  }
  return '| ' + Array.from({ length: columnCount }, () => '---').join(' | ') + ' |';
}

// Serialize a rendered table to GFM pipes. Cells collapse newlines and escape
// pipes; a checkbox-only cell writes its live state as `[ ]`/`[x]`.
function tableDomToMarkdown(el) {
  const cellText = (cell) => {
    const box = cell.querySelector('input[type="checkbox"]');
    const text = inlineDomToMarkdown(cell)
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\\\n/g, ' ')
      .replace(/\n+/g, ' ');
    if (box && !text) return box.checked ? '[x]' : '[ ]';
    return text;
  };
  const headCells = Array.from(el.querySelectorAll(':scope > thead > tr > th'));
  const lines = ['| ' + headCells.map(cellText).join(' | ') + ' |'];
  lines.push(tableDelimiterRow(el, headCells.length));
  el.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll(':scope > td'));
    lines.push('| ' + cells.map(cellText).join(' | ') + ' |');
  });
  return lines.join('\n');
}

const MARKDOWN_WYSIWYG_INLINE_TAGS = new Set([
  'a', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code',
  'abbr', 'kbd', 'mark', 'ins', 'sub', 'sup', 'span', 'div',
]);

function inlineMarkdownDomWysiwygSafe(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.classList && node.classList.contains('heading-anchor')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const tag = node.tagName.toLowerCase();
    if (!MARKDOWN_WYSIWYG_INLINE_TAGS.has(tag)) return false;
  }
  return true;
}

// Whether a Markdown block edits WYSIWYG safely. Links are fine
// (anchorToMarkdown reproduces each form), but raw HTML elements such as <sub>
// cannot be reconstructed from their rendered DOM, so they use source editing.
function markdownBlockWysiwygSafe(el) {
  return (
    inlineMarkdownDomWysiwygSafe(el) &&
    !el.querySelector('img, sup.footnote-reference, .katex, .mermaid, input')
  );
}

// A list serializes faithfully only when tight and inline-content (plus
// checkboxes and nested lists). Loose lists or ones holding blocks fall back to
// the raw-source editor.
function listWysiwygSafe(el) {
  return !el.querySelector('p, pre, blockquote, table, img, sup.footnote-reference, .katex, .mermaid');
}

// A table serializes back faithfully when its cells hold only inline content
// (checkbox cells included) and it has a real header row to key the pipes off.
function tableWysiwygSafe(el) {
  return (
    !el.querySelector('img, pre, blockquote, table, sup.footnote-reference, .katex, .mermaid') &&
    !!el.querySelector(':scope > thead > tr > th')
  );
}

// A blockquote edits WYSIWYG when it's a plain quote of paragraphs. GitHub alerts
// and quotes holding nested blocks keep the raw-source editor.
function blockquoteWysiwygSafe(el) {
  if (el.classList.contains('markdown-alert')) return false;
  if (el.querySelector('blockquote, pre, table, ul, ol, img, sup.footnote-reference, .katex, .mermaid, input')) {
    return false;
  }
  return Array.from(el.children).every((child) => {
    const tag = child.tagName.toLowerCase();
    return tag === 'p' || (tag === 'a' && child.classList.contains('heading-anchor'));
  });
}

