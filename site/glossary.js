// glossary.js
// ---------------------------------------------------------------------------
// Shared bottom-sheet glossary behaviour for the web reading views (the root
// README reader in reader.js and the /docs site in docs.js).
//
// A "glossary link" is any in-page link whose target file is the glossary
// (its basename is GLOSSARY_FILE) and that carries a "#anchor" — for example
// `[karma](../../GLOSSARY.md#karma)`. Clicking one slides the matching entry up
// in a sheet over the reading view instead of navigating away, so the doc
// underneath keeps its scroll position. Links inside the sheet that point at
// other glossary terms swap the entry in place; any other link dismisses the
// sheet first and hands the navigation back to the host.
//
// The host owns its own click handling, so this module does NOT register a
// document-wide listener. It returns `handleClick(event)`: call it first in the
// host's content click handler and bail out when it returns true.
// ---------------------------------------------------------------------------

// The on-disk convention is GLOSSARY.md (like README.md). This is the
// comparison key only; the basename is lowercased before comparing, so a
// link to GLOSSARY.md or a legacy glossary.md both match.
const GLOSSARY_FILE = 'glossary.md';

function decodeAnchor(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

// Split an href into [pathBeforeHash, anchor], dropping any ?query.
function splitHref(href) {
  const hashAt = href.indexOf('#');
  const path = (hashAt >= 0 ? href.slice(0, hashAt) : href).split('?')[0];
  const anchor = hashAt >= 0 ? href.slice(hashAt + 1) : '';
  return [path, decodeAnchor(anchor)];
}

function basename(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1].toLowerCase();
}

// The glossary anchor a link points to, or '' when it is not a glossary link.
function glossaryAnchor(href) {
  if (!href) return '';
  // Preferred form: a fake `glossary:slug` URL with no file path, so it works at
  // any folder depth. The sheet always loads from the configured glossaryUrl.
  const scheme = /^glossary:(.*)$/i.exec(href);
  if (scheme) return decodeAnchor(scheme[1].replace(/^#/, ''));
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith('mailto:')) return '';
  // Real form: a `…/GLOSSARY.md#slug` relative link (what /check expands the
  // shorthand into; also a working link in plain Markdown viewers).
  const [path, anchor] = splitHref(href);
  if (!anchor) return '';
  if (basename(path) !== GLOSSARY_FILE) return '';
  return anchor;
}

function headingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}

// Pull one entry out of the rendered glossary: the heading whose id is `anchor`
// plus every following sibling up to the next heading of the same or higher
// level. Returns a DocumentFragment, or null when the anchor is not found.
function extractEntry(root, anchor) {
  const start = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === anchor);
  if (!start) return null;
  const level = headingLevel(start) || 6;
  const frag = document.createDocumentFragment();
  frag.appendChild(start.cloneNode(true));
  let node = start.nextElementSibling;
  while (node) {
    const lvl = headingLevel(node);
    if (lvl && lvl <= level) break;
    frag.appendChild(node.cloneNode(true));
    node = node.nextElementSibling;
  }
  return frag;
}

// Wire up the glossary sheet for one reading view.
//   glossaryUrl    where to fetch the glossary Markdown from (fetched once, lazily)
//   renderMarkdown the shared Markdown -> HTML renderer
//   onNavigate     optional; called with an href when a non-glossary link inside
//                  the sheet is followed, so the host can route to it
export function installGlossary({ glossaryUrl, renderMarkdown, onNavigate }) {
  let loadPromise = null;
  let sheet = null;
  let backdrop = null;
  let bodyEl = null;
  let lastFocus = null;

  function loadGlossary() {
    if (!loadPromise) {
      loadPromise = (async () => {
        const res = await fetch(glossaryUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const root = document.createElement('div');
        root.innerHTML = renderMarkdown(await res.text());
        return root;
      })();
    }
    return loadPromise;
  }

  function onKey(event) {
    if (event.key === 'Escape') dismiss();
  }

  function ensureSheet() {
    if (sheet) return;

    backdrop = document.createElement('div');
    backdrop.className = 'glossary-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', dismiss);

    sheet = document.createElement('aside');
    sheet.className = 'glossary-sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Glossary');
    sheet.innerHTML =
      '<div class="glossary-sheet-grip"></div>' +
      '<button type="button" class="glossary-sheet-close" aria-label="Close glossary">' +
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />' +
      '</svg></button>' +
      '<div class="glossary-sheet-body document-body"></div>' +
      '<div class="glossary-sheet-footer">' +
      '<a class="glossary-sheet-fulllink" href="#">Open the full glossary</a>' +
      '</div>';

    bodyEl = sheet.querySelector('.glossary-sheet-body');
    sheet.querySelector('.glossary-sheet-close').addEventListener('click', dismiss);
    bodyEl.addEventListener('click', onSheetClick);
    sheet.querySelector('.glossary-sheet-fulllink').addEventListener('click', (event) => {
      event.preventDefault();
      dismiss();
      if (onNavigate) onNavigate(glossaryUrl);
      else window.location.assign(glossaryUrl);
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
  }

  // Clicks inside the sheet: another glossary term (or a bare "#anchor", which
  // can only mean another entry within this glossary) swaps the entry in place;
  // anything else leaves the glossary and is handed to the host.
  function onSheetClick(event) {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || /^[a-z]+:\/\//i.test(href) || href.startsWith('mailto:')) return;
    event.preventDefault();
    const within = glossaryAnchor(href) || (href.startsWith('#') ? decodeAnchor(href.slice(1)) : '');
    if (within) {
      open(within);
      return;
    }
    dismiss();
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function show() {
    ensureSheet();
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.classList.add('open');
    });
    document.addEventListener('keydown', onKey);
    sheet.querySelector('.glossary-sheet-close').focus();
  }

  function dismiss() {
    if (!sheet || sheet.hidden) return;
    backdrop.classList.remove('open');
    sheet.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    const hide = () => {
      sheet.hidden = true;
      backdrop.hidden = true;
      sheet.removeEventListener('transitionend', hide);
    };
    sheet.addEventListener('transitionend', hide);
    setTimeout(hide, 320); // fallback when the transition does not fire
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  async function open(anchor) {
    show();
    bodyEl.innerHTML = '<p class="glossary-sheet-status">Loading…</p>';
    let root;
    try {
      root = await loadGlossary();
    } catch (err) {
      bodyEl.innerHTML =
        '<p class="glossary-sheet-status">Could not load the glossary (' + err.message + ').</p>';
      return;
    }
    const entry = extractEntry(root, anchor);
    bodyEl.innerHTML = '';
    if (entry) bodyEl.appendChild(entry);
    else bodyEl.innerHTML = '<p class="glossary-sheet-status">No glossary entry for “' + anchor + '”.</p>';
    bodyEl.scrollTop = 0;
  }

  return {
    // Call first in the host's content click handler. Returns true when the
    // click was a glossary link (and was handled), false otherwise.
    handleClick(event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return false;
      }
      const link = event.target.closest('a');
      if (!link) return false;
      const anchor = glossaryAnchor(link.getAttribute('href'));
      if (!anchor) return false;
      event.preventDefault();
      open(anchor);
      return true;
    },
    open,
    dismiss,
  };
}

// ---------------------------------------------------------------------------
// Dynamic auto-glossary linking
//
// After the document content is rendered, call this to asynchronously fetch
// the glossary (GLOSSARY.md or GLOSSARY.xml / glossary.xml) and wrap every
// occurrence of each glossary term in the content with a `glossary:slug` link.
//
// Terms from ## (h2) headings are used. Matching is whole-word, case-insensitive.
// Text inside existing <a>, <code>, and <pre> elements is skipped.
//
// Usage:
//   installAutoGlossary({ contentEl, renderMarkdown, renderTEI })
//
// Returns a promise that resolves when linking is done (or quietly fails).
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(['a', 'code', 'pre', 'script', 'style', 'head']);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect all text nodes in `root` that are not inside skipped elements.
 * @param {Element} root
 * @returns {Text[]}
 */
function collectTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    (node) => {
      let el = node.parentElement;
      while (el && el !== root) {
        if (SKIP_TAGS.has(el.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  );
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

/**
 * Replace term occurrences in a single text node with glossary links.
 * @param {Text} textNode
 * @param {RegExp} pattern   — built from all terms
 * @param {Map<string, string>} termMap — term.toLowerCase() → slug
 */
function linkTextNode(textNode, pattern, termMap) {
  const text = textNode.textContent;
  pattern.lastIndex = 0;
  if (!pattern.test(text)) return;
  pattern.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const slug = termMap.get(match[0].toLowerCase());
    if (slug) {
      const a = document.createElement('a');
      a.href = 'glossary:' + slug;
      a.textContent = match[0];
      frag.appendChild(a);
    } else {
      frag.appendChild(document.createTextNode(match[0]));
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  textNode.parentNode.replaceChild(frag, textNode);
}

/**
 * Extract glossary terms from rendered glossary HTML.
 * Returns [{term, slug}], longest terms first.
 * @param {string} html  — rendered HTML string
 * @returns {{term: string, slug: string}[]}
 */
function extractTerms(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const terms = [];
  for (const h of div.querySelectorAll('h2[id]')) {
    const term = h.textContent.trim();
    if (term) terms.push({ term, slug: h.id });
  }
  // longest first so multi-word terms match before their substrings
  terms.sort((a, b) => b.term.length - a.term.length);
  return terms;
}

/**
 * Fetch the glossary (tries GLOSSARY.md then GLOSSARY.xml / glossary.xml).
 * Returns rendered HTML string or null.
 * @param {Function} renderMarkdown
 * @param {Function|null} renderTEI
 * @returns {Promise<string|null>}
 */
async function fetchGlossaryHtml(renderMarkdown, renderTEI) {
  const candidates = ['GLOSSARY.md', 'GLOSSARY.xml', 'glossary.xml'];
  for (const name of candidates) {
    let res;
    try {
      res = await fetch(name, { cache: 'no-cache' });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const text = await res.text();
    if (name.endsWith('.xml') && renderTEI) {
      return renderTEI(text);
    }
    return renderMarkdown(text);
  }
  return null;
}

/**
 * Asynchronously scan `contentEl` and wrap every glossary term with a
 * `glossary:slug` link. Safe to call; silently no-ops when no glossary found.
 *
 * @param {object} opts
 * @param {Element} opts.contentEl     — the rendered document element
 * @param {Function} opts.renderMarkdown
 * @param {Function} [opts.renderTEI]  — optional; used for .xml glossary files
 */
export async function installAutoGlossary({ contentEl, renderMarkdown, renderTEI }) {
  let glossaryHtml;
  try {
    glossaryHtml = await fetchGlossaryHtml(renderMarkdown, renderTEI || null);
  } catch {
    return;
  }
  if (!glossaryHtml) return;

  const terms = extractTerms(glossaryHtml);
  if (!terms.length) return;

  // Build a single regex from all terms (whole-word boundaries)
  const pattern = new RegExp(
    '(?<![\\p{L}\\p{M}\\d])(' +
      terms.map((t) => escapeRegex(t.term)).join('|') +
      ')(?![\\p{L}\\p{M}\\d])',
    'giu'
  );

  // Map lowercase term → slug for O(1) lookup during replacement
  const termMap = new Map(terms.map((t) => [t.term.toLowerCase(), t.slug]));

  // Collect text nodes first (modifying the DOM during traversal is unsafe)
  const textNodes = collectTextNodes(contentEl);

  // Process in small async batches so we don't block the UI thread
  const BATCH = 50;
  for (let i = 0; i < textNodes.length; i += BATCH) {
    const batch = textNodes.slice(i, i + BATCH);
    for (const node of batch) {
      if (node.parentNode) linkTextNode(node, pattern, termMap);
    }
    // Yield to the browser between batches
    await new Promise((r) => setTimeout(r, 0));
  }
}
