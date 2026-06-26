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
