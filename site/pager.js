// pager.js
// ---------------------------------------------------------------------------
// The Previous/Next strip under a document, filled by the page that knows the order.
//
// The renderer writes a **waiting** strip into every document it draws, because the reader it was built for does have neighbors — the desktop walks the folder and fills it. A browser has no folder to walk, so the page holds that list and this is where it hands it over.
//
// **A waiting state is a promise.** Left alone the strip spins for ever, which is exactly the fault the renderer's own record says cost it a browser session to find. So every page that renders a document calls this: with neighbors it fills the strip, and with none it takes the strip out rather than leaving a promise nobody is going to keep.
// ---------------------------------------------------------------------------

const LOADING = '.docs-pager-loading';

/** One button, or an empty cell holding the other one over to its own side. */
function button(entry, side, kicker) {
  if (!entry) return '<span></span>';
  const attribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const text = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<a class="docs-pager-${side}" href="${attribute(entry.href)}" data-pager-title="${attribute(entry.label)}">` +
    `<span class="docs-pager-label">${kicker}</span>${text(entry.label)}</a>`
  );
}

/**
 * Fill the strip the renderer left waiting inside `contentEl`.
 *
 * `prev` and `next` are `{ href, label }` or nothing. Both missing means this document has no neighbors, and the strip comes out.
 */
export function fillPager(contentEl, prev, next) {
  const nav = contentEl.querySelector(LOADING);
  if (!nav) return;
  if (!prev && !next) {
    nav.remove();
    return;
  }
  nav.classList.remove('docs-pager-loading');
  nav.removeAttribute('aria-busy');
  nav.innerHTML = button(prev, 'prev', 'Previous') + button(next, 'next', 'Next');
}
