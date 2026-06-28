// anchors.js
// ---------------------------------------------------------------------------
// Shared permalink decoration for the public site and /docs. It addresses body
// blocks the way a translated sutra is cited — chapter:verse (e.g. 1:42) — and
// makes that the in-page link target, then injects a GitHub-style permalink
// button (the chain glyph, revealed on hover) for each block. This mirrors the
// desktop app's scheme in src/lib.rs, so a #locus copied from one lands in the
// other.
// ---------------------------------------------------------------------------

const ANCHOR_LINK_ICON =
  '<svg class="anchor-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>';
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
// navigation entry, not body content, so it takes no verse number.
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

// Number the document the way a translated sutra is cited: chapter:verse, one
// colon. Each top-level heading (h1) opens a chapter and takes that bare chapter
// number. Every body block after it — paragraphs, quotes, content list items,
// tables — is the next running verse in that chapter (1:1, 1:2, 1:3 …); the
// verse counter runs straight through sub-headings and resets only at the next
// chapter. Sub-headings (h2–h6) are unnumbered titles: they keep their slug id
// for the table of contents and #slug links but take no verse. The navigation
// outline (a list of link-only items) is skipped. Numbering is deterministic, so
// the ids survive the re-render a fragment jump triggers.
function ensureAnchorLinkTargets(root) {
  const seen = new Set(
    Array.from(root.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter(Boolean)
  );
  let chapter = 0;
  let verse = 0;
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    if (isNavOutlineItem(target)) return;
    const tag = target.tagName;
    if (tag === 'H1') {
      chapter += 1;
      verse = 0;
      assignLocus(target, String(chapter), seen);
    } else if (/^H[2-6]$/.test(tag)) {
      // Unnumbered title: keep its slug id so the TOC and #slug links resolve.
      if (target.id) {
        seen.add(target.id);
        target.dataset.locus = target.id;
      }
    } else {
      if (chapter === 0) chapter = 1;
      verse += 1;
      assignLocus(target, chapter + ':' + verse, seen);
    }
  });
}

export function decorateAnchorLinks(root, label = 'Link to this section') {
  if (!root) return;
  ensureAnchorLinkTargets(root);
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    const locus = target.dataset.locus;
    if (!locus) return;
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    if (target.querySelector(':scope > .anchor-link')) return;
    const link = document.createElement('a');
    link.className = 'anchor-link';
    link.href = '#' + encodeURIComponent(locus);
    link.setAttribute('aria-label', label);
    link.title = label;
    link.innerHTML = ANCHOR_LINK_ICON;
    // Clicking copies the full deep link to this block (the canonical citation)
    // without blocking the in-page jump, and a brief is-copied flash confirms it.
    link.addEventListener('click', () => {
      const url = location.origin + location.pathname + location.search + '#' + encodeURIComponent(locus);
      copyAnchorLink(url);
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
