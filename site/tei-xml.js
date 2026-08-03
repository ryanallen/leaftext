// tei-xml.js
// ---------------------------------------------------------------------------
// Converts a TEI XML string (84000 format) to HTML for the leaf reader. The output matches the structure markdown.js produces, so existing CSS and anchors.js work unchanged.
//
// Key TEI→HTML rules:
//   div[@type="translation"]          — container; no heading, no added depth
//   div[@type=…] (any other)          — nested section; heading level from depth
//                                       (h2 at the top, one smaller per level, ≤ h6)
//   <head>                            — heading at the parent div's level
//   <p>                               — paragraph
//   <lg><l>…</l></lg>                 — verse block; a blockquote, lines joined with <br>
//   bare <l>…</l> runs                — coalesced into a blockquote (verse without <lg>)
//   <note place="end">…</note>        — inline footnote ref + end notes list
//   <milestone>, <lb>, <caesura>      — omitted
//   <ptr>                             — keep label text (link if external URL)
//   <term>, <title>, <ref>, <quote>   — strip tag, keep text
// ---------------------------------------------------------------------------

import { slugify } from './slugger.js';

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

  // Collect every `titleStmt > title` in document order. 84000 headers carry a title matrix — `type` mainTitle/longTitle/otherTitle crossed with `xml:lang` en / Sa-Ltn / bo / Bo-Ltn (lang casing varies) — so taking the first title showed whichever language the file happened to list first.
  const titles = [];
  xmlDoc.querySelectorAll('titleStmt > title').forEach((el) => {
    const text = (el.textContent || '').trim();
    if (!text) return;
    titles.push({
      type: (el.getAttribute('type') || '').toLowerCase(),
      lang: (
        el.getAttribute('xml:lang') ||
        el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') ||
        ''
      ).toLowerCase(),
      text,
    });
  });
  const pick = (type, lang) => {
    const hit = titles.find((t) => t.type === type && t.lang === lang);
    return hit ? hit.text : '';
  };

  // The document title is the English main title. Fall back to the English long title, then to the first title in any language except Tibetan (which also covers plain untyped <title> elements), then to any teiHeader title.
  const nonTibetan = titles.find((t) => t.lang !== 'bo' && t.lang !== 'bo-ltn');
  const headerTitleEl = xmlDoc.querySelector('teiHeader title');
  const title =
    pick('maintitle', 'en') ||
    pick('longtitle', 'en') ||
    (nonTibetan ? nonTibetan.text : '') ||
    (headerTitleEl ? headerTitleEl.textContent.trim() : '');

  // Alternate-language title lines rendered under the main title, in this order: Sanskrit main title, English long title, Sanskrit long title. Tibetan titles are never shown. Sanskrit is set in italics; duplicates of the main title or of an earlier line are dropped.
  const subtitles = [];
  [
    { text: pick('maintitle', 'sa-ltn'), italic: true },
    { text: pick('longtitle', 'en'), italic: false },
    { text: pick('longtitle', 'sa-ltn'), italic: true },
  ].forEach((line) => {
    if (!line.text || line.text === title) return;
    if (subtitles.some((s) => s.text === line.text)) return;
    subtitles.push(line);
  });

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
  if (subtitles.length > 0) {
    parts.push('<div class="tei-doc-subtitles">\n');
    subtitles.forEach((line) => {
      const inner = line.italic ? `<em>${escHtml(line.text)}</em>` : escHtml(line.text);
      parts.push(`<p class="tei-doc-subtitle">${inner}</p>\n`);
    });
    parts.push('</div>\n');
  }

  // Front matter (summary, acknowledgments, introduction) lives in `text > front`, a sibling of `body`. Render it collapsed by default so the reader lands on the translation itself; the reader can open it to read the summary/introduction.
  const front = xmlDoc.querySelector('text > front');
  if (front) renderFront(front, parts, ctx);

  renderBlockSequence([...body.children], parts, 0, ctx);

  // Footnotes section — match markdown.js exactly so the same CSS applies: `.footnotes > ol` is forced back to Arabic numerals (overriding the upper-roman default), and the back-reference uses the shared SVG icon.
  if (ctx.footnotes.length > 0) {
    parts.push('<section class="footnotes" aria-label="Footnotes">\n<hr>\n<ol>\n');
    ctx.footnotes.forEach((fnHtml, i) => {
      const n = i + 1;
      parts.push(
        `<li id="fn-${n}"><p>${fnHtml} <a href="#fnref-${n}" class="footnote-back" aria-label="Back to content"><svg class="footnote-back-icon" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"/></svg></a></p></li>\n`
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
      // Unknown block elements: recurse, still coalescing bare <l> runs.
      renderBlockSequence([...node.children], out, divDepth, ctx);
  }
}

// Render a run of block-level sibling elements, coalescing consecutive bare
// <l> lines (verse lines with no <lg> wrapper) into one blockquote so they
// still render like a Markdown `>` quote.
function renderBlockSequence(children, out, divDepth, ctx) {
  const isLine = (el) => localName(el) === 'l';
  let i = 0;
  while (i < children.length) {
    if (isLine(children[i])) {
      const lines = [];
      while (i < children.length && isLine(children[i])) {
        lines.push(renderInline(children[i], ctx));
        i++;
      }
      out.push(verseBlockquote(lines));
    } else {
      renderNode(children[i], out, divDepth, ctx);
      i++;
    }
  }
}

// Wrap verse lines in a blockquote (left bar + hanging indent), one <l> per row.
function verseBlockquote(lines) {
  return `<blockquote class="tei-verse">\n<p>${lines.join('<br>\n')}</p>\n</blockquote>\n`;
}

// Render `text > front` as a collapsed <details> so summary/acknowledgments/ introduction are available but out of the way by default. The inner content uses the same block machinery as the body (headings, paragraphs, verse), so its own CSS and anchors work unchanged; outline.js skips anything inside `.tei-front` so these collapsed headings don't clutter the outline.
function renderFront(front, out, ctx) {
  const inner = [];
  renderBlockSequence([...front.children], inner, 0, ctx);
  const html = inner.join('').trim();
  if (!html) return;

  // Label the toggle with the section names it holds (e.g. "Summary, Acknowledgments, Introduction"), falling back to a generic term.
  const heads = [...front.children]
    .filter((c) => localName(c) === 'div')
    .map((d) => [...d.children].find((c) => localName(c) === 'head'))
    .filter(Boolean)
    .map((h) => h.textContent.trim())
    .filter(Boolean);
  const label = heads.length ? heads.join(', ') : 'Front matter';

  out.push(
    `<details class="tei-front">\n<summary class="tei-front-summary">${escHtml(label)}</summary>\n<div class="tei-front-body">\n`
  );
  out.push(html);
  out.push('</div>\n</details>\n');
}

function renderDiv(node, out, divDepth, ctx) {
  const type = node.getAttribute('type') || '';

  if (type === 'translation') {
    // transparent container — just recurse
    renderBlockSequence([...node.children], out, divDepth, ctx);
    return;
  }

  // Heading level follows nesting depth alone. 84000 TEI nests these types in varying orders (a `section` may hold a `chapter` and vice versa), so a fixed type→level table would render a nested heading larger than the one above it.
  const level = Math.min(2 + divDepth, 6);

  // Emit the <head> child as a heading
  const headEl = [...node.children].find((c) => localName(c) === 'head');
  if (headEl) {
    const text = headEl.textContent.trim();
    const id = slugify(text, ctx.seen);
    out.push(`<h${level} id="${escAttr(id)}">${escHtml(text)}</h${level}>\n`);
  }

  // Recurse into non-head children
  const rest = [...node.children].filter((c) => localName(c) !== 'head');
  renderBlockSequence(rest, out, divDepth + 1, ctx);
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
  out.push(verseBlockquote(lines));
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
        // Match markdown.js footnote reference markup (plain Arabic, no brackets).
        parts.push(
          `<sup class="footnote-ref" id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`
        );
      } else if (tag === 'ptr') {
        // 84000 TEI puts the visible cross-reference label INSIDE <ptr> (e.g. <ptr target="...">Going forth</ptr>). Keep the label; link it only for external URLs (internal #ids don't map to heading slugs).
        const label = renderInline(child, ctx);
        if (label) {
          const target = child.getAttribute('target') || '';
          if (target.startsWith('http://') || target.startsWith('https://')) {
            parts.push(`<a href="${escAttr(target)}">${label}</a>`);
          } else {
            parts.push(label);
          }
        }
      } else if (['milestone', 'lb', 'caesura'].includes(tag)) {
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
