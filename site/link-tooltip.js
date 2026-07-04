// link-tooltip.js
// ---------------------------------------------------------------------------
// Desktop-only hover tooltip for links. It explains what kind of link you are
// about to follow, shows the authored href, and — for links that point at
// another document — how many lines that document is (fetched once and cached).
// Mobile/touch gets no change.
// ---------------------------------------------------------------------------

function decodePart(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    return raw;
  }
}

// What to print as the tooltip's detail line. The authored href may be
// percent-encoded (a heading slug with diacritics becomes `#%C5%9B...`), which
// is unreadable, so decode it for display and fall back to the raw href if it
// is not valid percent-encoding.
function detailText(rawHref) {
  return decodePart(rawHref);
}

function glossaryAnchor(href) {
  if (!href) return '';
  const scheme = /^glossary:(.*)$/i.exec(href);
  if (scheme) return decodePart(scheme[1].replace(/^#/, ''));
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith('mailto:')) return '';
  const hashAt = href.indexOf('#');
  if (hashAt < 0) return '';
  const path = href.slice(0, hashAt).split('?')[0];
  const base = path.split(/[\\/]/).pop().toLowerCase();
  if (base !== 'glossary.md') return '';
  return decodePart(href.slice(hashAt + 1));
}

function samePageFragment(href) {
  if (!href) return '';
  if (href.startsWith('#')) return decodePart(href.slice(1));
  if (href.startsWith('./#')) return decodePart(href.slice(3));
  if (href.startsWith('.#')) return decodePart(href.slice(2));
  return '';
}

// True when the href points at a document file we can fetch and count (Markdown
// or TEI XML), rather than an external site, a mail link, or an in-page jump.
// The glossary is excluded — it opens as a single entry, not a whole page.
function isDocumentLink(rawHref) {
  if (!rawHref) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) && !/^[a-z]:[\\/]/i.test(rawHref)) return false; // scheme (http:, mailto:, glossary:)
  if (samePageFragment(rawHref)) return false;
  if (glossaryAnchor(rawHref)) return false;
  const path = rawHref.split('#')[0].split('?')[0];
  return /\.(md|markdown|mdown|xml)$/i.test(path);
}

function describeLink(link) {
  const rawHref = (link.getAttribute('href') || '').trim();
  if (!rawHref) return null;

  const countable = isDocumentLink(rawHref);

  if (/^glossary:\s*$/i.test(rawHref)) {
    return { kind: 'Full glossary', detail: detailText(rawHref), countable: false };
  }

  const glossary = glossaryAnchor(rawHref);
  if (glossary) {
    return { kind: 'Glossary entry', detail: detailText(rawHref), countable: false };
  }

  const fragment = samePageFragment(rawHref);
  if (fragment) {
    return { kind: 'In-page jump', detail: detailText(rawHref), countable: false };
  }

  if (/^mailto:/i.test(rawHref)) {
    return { kind: 'Email link', detail: detailText(rawHref), countable: false };
  }

  if (/^https?:\/\//i.test(rawHref)) {
    return { kind: 'External site', detail: detailText(rawHref), countable: false };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return { kind: 'App link', detail: detailText(rawHref), countable: false };
  }

  if (/\.md(?:[#?].*)?$/i.test(rawHref)) {
    return { kind: 'Another page', detail: detailText(rawHref), countable };
  }

  if (rawHref.startsWith('/')) {
    return { kind: 'Site path', detail: detailText(rawHref), countable };
  }

  return { kind: 'Link', detail: rawHref, countable };
}

// The linked file's source length, phrased for the tooltip. A file that ends in
// a trailing newline is not counted as an extra empty line, so this matches what
// an editor's line count shows.
function countLines(text) {
  if (!text) return 0;
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length;
}

function linesLabel(n) {
  return `${n.toLocaleString()} ${n === 1 ? 'line' : 'lines'}`;
}

// Turn a link into the URL of the document it points at, so we can fetch it and
// count its lines. The default resolves the href relative to the current page,
// which is right for a plain document site. A hash-routed docs viewer passes its
// own resolver (a relative `.md` link there maps to a route, not a URL under the
// current path), so this default is only a fallback.
function defaultResolveDocUrl(link) {
  const rawHref = (link.getAttribute('href') || '').trim();
  if (!isDocumentLink(rawHref)) return null;
  try {
    const url = new URL(rawHref.split('#')[0], link.baseURI || location.href);
    if (url.origin !== location.origin) return null; // same-origin only
    return url.href;
  } catch (error) {
    return null;
  }
}

export function installLinkTooltip(root = document, options = {}) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return { refresh() {} };
  }

  const resolveDocUrl =
    typeof options.resolveDocUrl === 'function' ? options.resolveDocUrl : defaultResolveDocUrl;

  const tip = document.createElement('div');
  tip.className = 'link-hover-tip';
  tip.hidden = true;
  tip.innerHTML =
    '<div class="link-hover-tip-kind"></div>' +
    '<div class="link-hover-tip-detail"></div>' +
    '<div class="link-hover-tip-lines" hidden></div>';
  document.body.appendChild(tip);

  const kindEl = tip.querySelector('.link-hover-tip-kind');
  const detailEl = tip.querySelector('.link-hover-tip-detail');
  const linesEl = tip.querySelector('.link-hover-tip-lines');
  let activeLink = null;
  // Resolved-URL -> line count (or 'error'). Counting a document fetches it once;
  // hovering the same target again reads the cache.
  const lineCache = new Map();

  function hide() {
    activeLink = null;
    tip.hidden = true;
  }

  function setLines(count) {
    if (typeof count === 'number') {
      linesEl.textContent = linesLabel(count);
      linesEl.hidden = false;
    } else {
      linesEl.textContent = '';
      linesEl.hidden = true;
    }
  }

  // Fetch (once) and count the linked document, then show its line count — but
  // only if the pointer is still on the same link when the fetch resolves.
  async function fillLineCount(link) {
    const url = resolveDocUrl(link);
    if (!url) return;

    if (lineCache.has(url)) {
      const cached = lineCache.get(url);
      if (link === activeLink && typeof cached === 'number') setLines(cached);
      return;
    }

    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const count = countLines(await res.text());
      lineCache.set(url, count);
      if (link === activeLink) setLines(count);
    } catch (error) {
      lineCache.set(url, 'error');
    }
  }

  function position(event) {
    const margin = 14;
    const rect = tip.getBoundingClientRect();
    let left = event.clientX + 18;
    let top = event.clientY + 18;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, event.clientX - rect.width - 18);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, event.clientY - rect.height - 18);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function show(link, event) {
    const info = describeLink(link);
    if (!info) {
      hide();
      return;
    }
    activeLink = link;
    kindEl.textContent = info.kind;
    detailEl.textContent = info.detail;
    setLines(null);
    tip.hidden = false;
    position(event);
    if (info.countable) fillLineCount(link);
  }

  root.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || !root.contains(link)) return;
    show(link, event);
  });

  root.addEventListener('pointermove', (event) => {
    if (!activeLink) return;
    position(event);
  });

  root.addEventListener('pointerout', (event) => {
    if (!activeLink) return;
    const next = event.relatedTarget;
    if (next && activeLink.contains(next)) return;
    if (next && next.closest && next.closest('a[href]') === activeLink) return;
    hide();
  });

  root.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hide();
  });

  return { refresh() {} };
}
