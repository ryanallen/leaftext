// anchors.js
// ---------------------------------------------------------------------------
// Shared permalink decoration for the public site and /docs. It addresses every
// anchorable content block with a hierarchical "locus" number (its position in
// the document tree, e.g. 1.3.2), prints that number in the left gutter the way
// a printed sutra prints paragraph numbers, and makes it the in-page link
// target. This mirrors the desktop app's scheme in src/lib.rs, so a #locus
// copied from one lands in the other.
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

// Address every anchor-addressable block with a hierarchical "legal" locus
// number — its canonical position in the document tree, e.g. 1.3.2 = the second
// block of the third sub-section of the first section. Headings open and nest
// sections; every block (headings included) is a child of the currently open
// section and consumes that section's next sibling number, so a paragraph and
// the sub-heading next to it can never land on the same number. Content blocks
// take their locus as the id, replacing the old word/letter slugs (slug-p-0).
// Headings keep the slug id the renderer gave them — the table of contents and
// author-written #slug links resolve against it — but they also get the locus:
// it is recorded on the block (dataset.locus) and exposed through a hidden alias
// anchor, so #<locus> jumps to the heading too. Numbering is deterministic, so
// the ids survive the re-render a fragment jump triggers.
function ensureAnchorLinkTargets(root) {
  const seen = new Set(
    Array.from(root.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter(Boolean)
  );
  const treeRoot = { childCounter: 0 };
  const stack = []; // the open heading chain: [{ level, number, childCounter }]
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    const isHeading = /^H[1-6]$/.test(target.tagName);
    if (isHeading) {
      const level = Number(target.tagName.slice(1));
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : treeRoot;
      parent.childCounter += 1;
      stack.push({ level, number: parent.childCounter, childCounter: 0 });
      const locus = stack.map((entry) => entry.number).join('.');
      if (target.id) {
        // Keep the slug id; expose the locus through a hidden alias anchor so
        // both #slug and #<locus> resolve to this heading.
        seen.add(target.id);
        const aliasId = uniqueAnchorBlockId(seen, locus);
        const alias = document.createElement('span');
        alias.className = 'locus-alias';
        alias.id = aliasId;
        alias.setAttribute('aria-hidden', 'true');
        target.insertBefore(alias, target.firstChild);
        target.dataset.locus = aliasId;
      } else {
        target.id = uniqueAnchorBlockId(seen, locus);
        target.dataset.locus = target.id;
      }
    } else {
      const container = stack.length ? stack[stack.length - 1] : treeRoot;
      container.childCounter += 1;
      if (target.id) {
        seen.add(target.id);
        target.dataset.locus = target.id;
      } else {
        const locus = stack.map((entry) => entry.number).concat(container.childCounter).join('.');
        target.id = uniqueAnchorBlockId(seen, locus);
        target.dataset.locus = target.id;
      }
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
    // Print the locus the way a sutra prints its paragraph number: "1.3.2".
    const num = document.createElement('span');
    num.className = 'anchor-num';
    num.textContent = locus;
    link.appendChild(num);
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
