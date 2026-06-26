// anchors.js
// ---------------------------------------------------------------------------
// Shared permalink decoration for the public site and /docs. It assigns stable
// ids to anchorable content blocks that do not already have one, then injects a
// GitHub-style gutter link for each target.
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

function ensureAnchorLinkTargets(root) {
  const seen = new Set(
    Array.from(root.querySelectorAll('[id]'))
      .map((element) => element.id)
      .filter(Boolean)
  );
  let sectionId = 'top';
  let blockIndex = 0;
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target, targetIndex) => {
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    const isHeading = /^H[1-6]$/.test(target.tagName);
    if (!target.id) {
      const tag = target.tagName.toLowerCase();
      const preferred = isHeading
        ? 'section-' + (targetIndex + 1)
        : sectionId + '-' + tag + '-' + blockIndex;
      target.id = uniqueAnchorBlockId(seen, preferred);
    } else {
      seen.add(target.id);
    }
    if (isHeading) {
      sectionId = target.id;
      blockIndex = 0;
    } else {
      blockIndex += 1;
    }
  });
}

export function decorateAnchorLinks(root, label = 'Link to this section') {
  if (!root) return;
  ensureAnchorLinkTargets(root);
  root.querySelectorAll(ANCHOR_LINK_SELECTOR).forEach((target) => {
    if (!target.id) return;
    if (target.classList.contains('footnote-definition') || target.classList.contains('footnotes')) {
      return;
    }
    if (target.querySelector(':scope > .anchor-link')) return;
    const link = document.createElement('a');
    link.className = 'anchor-link';
    link.href = '#' + encodeURIComponent(target.id);
    link.setAttribute('aria-label', label);
    link.title = label;
    link.innerHTML = ANCHOR_LINK_ICON;
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
