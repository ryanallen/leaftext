// anchors.js
// ---------------------------------------------------------------------------
// Shared gutter line numbers + permalink decoration for the public site and
// /docs. It gives each block a flat sequential address from its place in the
// document — 1, 2, 3, 4 … counting straight down, like a code editor's line
// gutter — makes that the in-page link target, then shows the number itself in
// the left gutter as faint monospace text (Visual Studio style). The number is a
// live permalink: it is always visible, brightens on hover, and clicking it
// copies the deep link to that block. The address is pure ASCII, so it reads
// cleanly in the hover tooltip even when the heading text has diacritics. This
// mirrors the desktop app's scheme in src/lib.rs, so a #locus copied from one
// lands in the other.
// ---------------------------------------------------------------------------

// `pre:not(.mermaid)` deliberately excludes Mermaid diagram fences: a permalink
// gutter link makes no sense on a diagram, and inserting one as the pre's first
// child corrupts the source Mermaid reads from innerHTML (it then sees no
// diagram text and renders a "Syntax error" bomb).
const ANCHOR_LINK_SELECTOR =
  'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre:not(.mermaid), table, details, figure, div[id], a[id]';

function uniqueAnchorBlockId(seen, base) {
  let candidate = base;
  let suffix = 1;
  while (!candidate || seen.has(candidate)) {
    candidate = base + '-' + suffix;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

// Copy text via the async clipboard API, falling back to a hidden textarea +
// execCommand where the async API is unavailable (e.g. a non-secure context).
function copyAnchorLink(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopyAnchor(text));
    return;
  }
  legacyCopyAnchor(text);
}
function legacyCopyAnchor(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch (error) {
    /* clipboard unavailable; the fragment jump still happens */
  }
  document.body.removeChild(area);
}

// A list item that is purely a link (or links) is a table-of-contents /
// navigation entry, not body content, so it takes no number.
function isNavOutlineItem(el) {
  if (el.tagName !== 'LI') return false;
  const text = (el.textContent || '').replace(/\s+/g, '');
  if (!text) return false;
  let linkText = '';
  el.querySelectorAll('a').forEach((a) => {
    linkText += a.textContent || '';
  });
  return text === linkText.replace(/\s+/g, '');
}

// Give `target` the address `locus`: if it already has an id (a heading slug or
// an author anchor) keep that id and add a hidden alias carrying the locus, so
// #<locus> still lands on it; otherwise the locus becomes the id. Either way the
// locus is recorded on dataset.locus for the gutter permalink.
function assignLocus(target, locus, seen) {
  if (target.id) {
    seen.add(target.id);
    const alias = document.createElement('span');
    alias.className = 'locus-alias';
    alias.id = uniqueAnchorBlockId(seen, locus);
    alias.setAttribute('aria-hidden', 'true');
    target.insertBefore(alias, target.firstChild);
    target.dataset.locus = alias.id;
  } else {
    target.id = uniqueAnchorBlockId(seen, locus);
    target.dataset.locus = target.id;
  }
}

// Number the document so each block has a short, citable address: a flat running
// count down the page — 1, 2, 3, 4 … — like a code editor's line gutter, with no
// reset at headings. A heading keeps the slug id the renderer gave it (so the
// table of contents and #slug links resolve) and carries its number through a
// hidden alias. The navigation outline (link-only list items) is skipped. The
// address is pure ASCII, so a heading with diacritics still reads cleanly in the
// link tooltip. Numbering is deterministic, so the ids survive the re-render a
// fragment jump triggers.
function ensureAnchorLinkTargets(root) {
  const seen = new Set(
    Array.from(root.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter(Boolean)
  );
  let line = 0;
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    // The generated outline is navigation, not body content — no locus number.
    if (target.closest('.document-outline')) return;
    if (isNavOutlineItem(target)) return;
    line += 1;
    assignLocus(target, '' + line, seen);
  });
  return line;
}

// Build the shareable URL for a block — the one that must resolve when pasted
// into a browser. On a single-page reader the fragment is the whole address
// (#<locus>). On the hash-routed docs viewer the address is #/<route>#<locus>,
// so keep the current route and append the locus as its section anchor, exactly
// as the viewer rewrites the URL bar when the link is clicked. Without this the
// copied link would drop the route and land on the docs home instead.
function locusShareUrl(locus) {
  const hash = location.hash || '';
  if (hash.startsWith('#/')) {
    const route = hash.split('#').slice(0, 2).join('#'); // '#/<route>', minus any stale anchor
    return location.origin + location.pathname + route + '#' + locus;
  }
  return location.origin + location.pathname + location.search + '#' + encodeURIComponent(locus);
}

export function decorateAnchorLinks(root, label = 'Link to this section') {
  if (!root) return;
  const lineTotal = ensureAnchorLinkTargets(root);
  // The numbering pass just walked the whole document, so its final count is
  // the document's line total — stamp it into the outline summary:
  // "Outline (1234 lines)".
  const outlineCount = root.querySelector('.document-outline-count');
  if (outlineCount) {
    outlineCount.textContent = '(' + lineTotal + ' lines)';
  }
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    const locus = target.dataset.locus;
    if (!locus) return;
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    if (target.closest('.document-outline')) return;
    if (target.querySelector(':scope > .anchor-link')) return;
    // A blockquote (or GitHub alert) is one citable unit: it carries the number,
    // and its inner blocks must not stack a second number in the same gutter. Skip
    // the number on anything nested in a blockquote; the block keeps its id, so
    // #locus links to it still resolve — it just shares the blockquote's number.
    if (target.tagName !== 'BLOCKQUOTE' && target.closest('blockquote')) return;
    const link = document.createElement('a');
    link.className = 'anchor-link';
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    // The gutter shows the block's line number as faint monospace text; clicking
    // it still copies the deep link (handled below). The digits live in an inner
    // span so the anchor can inherit the block's font metrics (matching its first
    // line box) while the glyph stays a fixed small size, baseline-aligned to the
    // block's text — see the .anchor-link CSS.
    const num = document.createElement('span');
    num.className = 'anchor-link-num';
    num.textContent = locus;
    link.appendChild(num);
    // Clicking copies the full deep link to this block (the canonical citation)
    // without blocking the in-page jump, and a brief is-copied flash confirms it.
    link.addEventListener('click', () => {
      copyAnchorLink(locusShareUrl(locus));
      link.classList.add('is-copied');
      window.clearTimeout(link.__copiedTimer);
      link.__copiedTimer = window.setTimeout(() => link.classList.remove('is-copied'), 900);
    });
    target.classList.add('has-anchor-link');
    target.insertBefore(link, target.firstChild);
  });
  positionAnchorLinks(root);
  observeAnchorLayout(root);
}

// Park every permalink button in the document's left margin, lined up with where
// a top-level heading's button sits, no matter how deeply its block is indented.
// The button's right edge already meets its block's left edge (right: 100% in
// CSS); here we shift it further left by the block's own indentation so it clears
// the indented text instead of overlapping it. The indent can't be derived in
// pure CSS — accumulating it through a custom property forms a self-referential
// cycle the engine discards — so we measure each block's left edge against the
// root's and shift by the difference, which also handles every list, blockquote,
// padding, and text-indent combination exactly. Reads are batched ahead of writes
// to avoid layout thrash; the buttons are out of flow, so moving them never
// resizes the root and so never loops the layout observer.
export function positionAnchorLinks(root) {
  if (!root) return;
  const blocks = root.querySelectorAll('.has-anchor-link');
  if (!blocks.length) return;
  const rootLeft = root.getBoundingClientRect().left;
  const indents = [];
  blocks.forEach((block) => {
    indents.push(block.getBoundingClientRect().left - rootLeft);
  });
  blocks.forEach((block, index) => {
    const link = block.querySelector(':scope > .anchor-link');
    if (!link) return;
    const indent = indents[index];
    link.style.right = indent > 0.5 ? `calc(100% + ${Math.round(indent)}px)` : '';
  });
}

// The indentation is em-based, so it scales with the viewport-driven font size;
// reposition on any reflow or resize. Wire each root once: a ResizeObserver
// catches font/width reflow (and image decoding), and the resize listeners catch
// zoom and viewport changes. All are coalesced into a single animation frame.
const observedAnchorRoots = new WeakSet();
function observeAnchorLayout(root) {
  if (!root || observedAnchorRoots.has(root)) return;
  observedAnchorRoots.add(root);
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      positionAnchorLinks(root);
    });
  };
  window.addEventListener('resize', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(schedule).observe(root);
  }
}
