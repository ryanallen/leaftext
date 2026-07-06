// outline.js
// ---------------------------------------------------------------------------
// Build a collapsed "Outline" (a table of contents) from a rendered document's
// headings and drop it in just under the title. It works for both Markdown and
// TEI XML documents, because both renderers emit <h1>–<h6> that carry slug ids:
// the outline is a pure DOM pass over those headings, blind to how they were
// produced. Each entry links to its heading's id and the entries nest as a
// bulleted list — one step in per step down in heading level — inside a
// <details> that starts closed so it never crowds the top of the page. Bullets,
// not numbers: a deep document runs a counter into the hundreds and the wide
// markers overflow the panel's left edge. Clicking an entry jumps to that
// heading via its #id.
// ---------------------------------------------------------------------------

// Read a heading's visible text without any decorations that may sit inside it
// (permalink buttons, hidden locus aliases, footnote markers), so the outline
// entry reads as just the heading.
function headingText(h) {
  const clone = h.cloneNode(true);
  clone
    .querySelectorAll('.anchor-link, .heading-anchor, .locus-alias, .footnote-ref')
    .forEach((node) => node.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

// Turn a flat, document-order list of headings into a nested <ul>, one level of
// nesting per step down in heading level. The shallowest heading present becomes
// the top level, so a document that only uses h2/h3 still nests sensibly.
function buildOutlineList(doc, headings) {
  const root = doc.createElement('ul');
  // Each frame is a list currently open at a given heading level; the sentinel
  // level-0 frame is the root and is never popped.
  const stack = [{ level: 0, list: root }];
  headings.forEach((h) => {
    const level = Number(h.tagName.slice(1)) || 1;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    // Top-level entries go straight in the root; deeper ones go in a child list
    // hung off the parent frame's most recent item (reused if it already exists).
    let container = parent.list;
    if (parent.level !== 0) {
      const lastLi = parent.list.lastElementChild;
      let sub = lastLi ? lastLi.querySelector(':scope > ul') : null;
      if (!sub) {
        sub = doc.createElement('ul');
        (lastLi || parent.list).appendChild(sub);
      }
      container = sub;
    }
    const li = doc.createElement('li');
    const link = doc.createElement('a');
    link.className = 'document-outline-link';
    link.setAttribute('href', '#' + encodeURIComponent(h.id));
    link.textContent = headingText(h) || h.id;
    li.appendChild(link);
    container.appendChild(li);
    stack.push({ level, list: container });
  });
  return root;
}

// Build the outline and insert it directly after the document title (the first
// heading). Returns the <details> element, or null when there is nothing worth
// outlining. `options.label` is the summary text ("Outline" by default).
export function buildOutline(root, options = {}) {
  if (!root) return null;
  const doc = root.ownerDocument || document;

  // Rebuild cleanly if one is already present (e.g. a re-render).
  const existing = root.querySelector(':scope > .document-outline');
  if (existing) existing.remove();

  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (h) =>
      !h.closest('.document-outline') &&
      !h.closest('.footnotes') &&
      !h.closest('.tei-front')
  );
  // A title plus at least one section is the minimum worth an outline for.
  if (headings.length < 2) return null;

  const title = headings[0];
  const rest = headings.slice(1);

  // Every heading the renderers emit carries a slug id; guard anyway so a stray
  // id-less heading (e.g. from injected raw HTML) still gets a working target.
  rest.forEach((h, i) => {
    if (!h.id) h.id = 'section-' + (i + 1);
  });

  const details = doc.createElement('details');
  details.className = 'document-outline';
  const summary = doc.createElement('summary');
  summary.className = 'document-outline-summary';
  summary.textContent = options.label || 'Outline';
  // Filled in by decorateAnchorLinks once the numbering pass knows the
  // document's total line count.
  const count = doc.createElement('span');
  count.className = 'document-outline-count';
  summary.appendChild(count);
  details.appendChild(summary);
  details.appendChild(buildOutlineList(doc, rest));

  title.insertAdjacentElement('afterend', details);
  return details;
}
