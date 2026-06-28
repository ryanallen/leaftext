// link-tooltip.js
// ---------------------------------------------------------------------------
// Desktop-only hover tooltip for links. It explains what kind of link you are
// about to follow and shows the authored href. Mobile/touch gets no change.
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

function describeLink(link) {
  const rawHref = (link.getAttribute('href') || '').trim();
  if (!rawHref) return null;

  if (/^glossary:\s*$/i.test(rawHref)) {
    return {
      kind: 'Full glossary',
      detail: detailText(rawHref),
    };
  }

  const glossary = glossaryAnchor(rawHref);
  if (glossary) {
    return {
      kind: 'Glossary entry',
      detail: detailText(rawHref),
    };
  }

  const fragment = samePageFragment(rawHref);
  if (fragment) {
    return {
      kind: 'In-page jump',
      detail: detailText(rawHref),
    };
  }

  if (/^mailto:/i.test(rawHref)) {
    return {
      kind: 'Email link',
      detail: detailText(rawHref),
    };
  }

  if (/^https?:\/\//i.test(rawHref)) {
    return {
      kind: 'External site',
      detail: detailText(rawHref),
    };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return {
      kind: 'App link',
      detail: detailText(rawHref),
    };
  }

  if (/\.md(?:[#?].*)?$/i.test(rawHref)) {
    return {
      kind: 'Another page',
      detail: detailText(rawHref),
    };
  }

  if (rawHref.startsWith('/')) {
    return {
      kind: 'Site path',
      detail: detailText(rawHref),
    };
  }

  return {
    kind: 'Link',
    detail: rawHref,
  };
}

export function installLinkTooltip(root = document) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return { refresh() {} };
  }

  const tip = document.createElement('div');
  tip.className = 'link-hover-tip';
  tip.hidden = true;
  tip.innerHTML =
    '<div class="link-hover-tip-kind"></div>' +
    '<div class="link-hover-tip-detail"></div>';
  document.body.appendChild(tip);

  const kindEl = tip.querySelector('.link-hover-tip-kind');
  const detailEl = tip.querySelector('.link-hover-tip-detail');
  let activeLink = null;

  function hide() {
    activeLink = null;
    tip.hidden = true;
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
    tip.hidden = false;
    position(event);
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
