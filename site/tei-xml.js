// tei-xml.js
// ---------------------------------------------------------------------------
// Converts a TEI XML string (84000 format) to HTML for the leaf reader.
// The output matches the structure markdown.js produces, so existing CSS and
// anchors.js work unchanged.
//
// Key TEI→HTML rules:
//   div[@type="translation"]          — container; no heading
//   div[@type="prelude"|"chapter"]    — h2 section
//   div[@type="section"]              — h3 section
//   div[@type="subsection"]           — h4 section
//   <head>                            — heading at the parent div's level
//   <p>                               — paragraph
//   <lg><l>…</l></lg>                 — verse block; lines joined with <br>
//   <note place="end">…</note>        — inline footnote ref + end notes list
//   <milestone>, <lb>, <ptr>          — omitted
//   <term>, <title>, <ref>, <quote>   — strip tag, keep text
// ---------------------------------------------------------------------------

import { slugify } from './slugger.js';

// div[@type] → heading level (2 = h2, etc.)
const DIV_HEADING_LEVEL = {
  prelude: 2,
  chapter: 2,
  section: 3,
  subsection: 4,
};

/** True when `text` looks like a TEI/XML document. */
export function isTEI(text) {
  const head = text.trimStart().slice(0, 500);
  return head.includes('<TEI') || (head.startsWith('<?xml') && head.includes('<TEI'));
}

/**
 * Convert a TEI XML string to an HTML body string.
 * Returns the inner HTML for the article element (no wrapping <article>).
 */
export function renderTEI(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    return '<p><strong>XML parse error.</strong></p>';
  }

  // Try to extract a title from the teiHeader
  const titleEl =
    xmlDoc.querySelector('titleStmt > title:not([type])') ||
    xmlDoc.querySelector('teiHeader title');

  const title = titleEl ? titleEl.textContent.trim() : '';

  const body = xmlDoc.querySelector('text > body');
  if (!body) {
    return '<p><strong>No TEI body element found in this document.</strong></p>';
  }

  const ctx = {
    footnotes: [],
    fnCount: 0,
    seen: Object.create(null),
  };

  const parts = [];
  if (title) {
    const id = slugify(title, ctx.seen);
    parts.push(`<h1 id="${escAttr(id)}">${escHtml(title)}</h1>\n`);
  }

  for (const child of body.children) {
    renderNode(child, parts, 0, ctx);
  }

  // Footnotes section
  if (ctx.footnotes.length > 0) {
    parts.push('<section class="footnotes">\n<ol>\n');
    ctx.footnotes.forEach((fnHtml, i) => {
      const n = i + 1;
      parts.push(
        `<li id="fn${n}"><p>${fnHtml} <a href="#fnref${n}" aria-label="Back to reference ${n}">↩</a></p></li>\n`
      );
    });
    parts.push('</ol>\n</section>\n');
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

function renderNode(node, out, divDepth, ctx) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const tag = localName(node);

  switch (tag) {
    case 'div':
      renderDiv(node, out, divDepth, ctx);
      break;
    case 'p':
      renderP(node, out, ctx);
      break;
    case 'lg':
      renderLg(node, out, ctx);
      break;
    case 'head':
      // Handled inside renderDiv; skip when encountered directly.
      break;
    case 'milestone':
    case 'lb':
    case 'ptr':
    case 'caesura':
      // omit
      break;
    default:
      // Unknown block elements: recurse into children
      for (const child of node.children) {
        renderNode(child, out, divDepth, ctx);
      }
  }
}

function renderDiv(node, out, divDepth, ctx) {
  const type = node.getAttribute('type') || '';

  if (type === 'translation') {
    // transparent container — just recurse
    for (const child of node.children) {
      renderNode(child, out, divDepth, ctx);
    }
    return;
  }

  const level = DIV_HEADING_LEVEL[type] ?? Math.min(2 + divDepth, 6);

  // Emit the <head> child as a heading
  const headEl = [...node.children].find((c) => localName(c) === 'head');
  if (headEl) {
    const text = headEl.textContent.trim();
    const id = slugify(text, ctx.seen);
    out.push(`<h${level} id="${escAttr(id)}">${escHtml(text)}</h${level}>\n`);
  }

  // Recurse into non-head children
  for (const child of node.children) {
    if (localName(child) === 'head') continue;
    renderNode(child, out, divDepth + 1, ctx);
  }
}

function renderP(node, out, ctx) {
  out.push('<p>');
  out.push(renderInline(node, ctx));
  out.push('</p>\n');
}

function renderLg(node, out, ctx) {
  const lines = [...node.children]
    .filter((c) => localName(c) === 'l')
    .map((l) => renderInline(l, ctx));
  out.push('<p class="tei-verse">');
  out.push(lines.join('<br>\n'));
  out.push('</p>\n');
}

function renderInline(node, ctx) {
  const parts = [];
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(escHtml(child.textContent));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = localName(child);
      if (tag === 'note' && child.getAttribute('place') === 'end') {
        ctx.fnCount++;
        const n = ctx.fnCount;
        const fnHtml = renderInline(child, ctx);
        ctx.footnotes.push(fnHtml);
        parts.push(
          `<sup><a href="#fn${n}" id="fnref${n}" class="footnote-ref" aria-label="Footnote ${n}">[${n}]</a></sup>`
        );
      } else if (['milestone', 'lb', 'ptr', 'caesura'].includes(tag)) {
        // omit
      } else {
        // term, title, ref, quote, foreign, hi, etc. → inline text
        parts.push(renderInline(child, ctx));
      }
    }
  }
  return parts.join('');
}

function localName(el) {
  return (el.localName || el.tagName || '').toLowerCase().replace(/^.*:/, '');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}
