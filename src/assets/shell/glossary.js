// ---- Glossary bottom sheet ------------------------------------------------
// A glossary link opens the term in a sheet over the current document. The webview can't read the file, so the click asks the host, which reads + renders the glossary and calls window.leafShowGlossary below.
const glossarySheet = document.getElementById('glossarySheet');
const glossaryBackdrop = document.getElementById('glossaryBackdrop');
const glossarySheetBody = document.getElementById('glossarySheetBody');
const glossarySheetClose = document.getElementById('glossarySheetClose');
const glossaryFullLink = document.getElementById('glossaryFullLink');
// The path part of the last glossary link followed from a document, reused so a glossary-to-glossary jump resolves against the same file the host opened.
let glossaryHrefBase = 'GLOSSARY.md';
let glossaryLastFocus = null;
function glossaryAnchorFromHref(rawHref) {
  if (!rawHref) return '';
  // Preferred form: a `glossary:slug` URL with no file path; the host finds the nearest GLOSSARY.md.
  const scheme = /^glossary:(.*)$/i.exec(rawHref);
  if (scheme) {
    let anchor = scheme[1].replace(/^#/, '');
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
    return anchor;
  }
  if (/^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return '';
  // Real form: a `…/GLOSSARY.md#slug` relative link, matched case-insensitively.
  const hashAt = rawHref.indexOf('#');
  if (hashAt < 0) return '';
  const path = rawHref.slice(0, hashAt).split('?')[0];
  const base = path.split(/[\\/]/).pop().toLowerCase();
  if (base !== 'glossary.md') return '';
  let anchor = rawHref.slice(hashAt + 1);
  try { anchor = decodeURIComponent(anchor); } catch (e) {}
  return anchor;
}
function glossaryHeadingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}
function extractGlossaryEntry(root, anchor) {
  const start = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === anchor);
  if (!start) return null;
  const level = glossaryHeadingLevel(start) || 6;
  const frag = document.createDocumentFragment();
  frag.appendChild(start.cloneNode(true));
  let node = start.nextElementSibling;
  while (node) {
    const lvl = glossaryHeadingLevel(node);
    if (lvl && lvl <= level) break;
    frag.appendChild(node.cloneNode(true));
    node = node.nextElementSibling;
  }
  return frag;
}
function onGlossaryKey(event) {
  if (event.key === 'Escape') dismissGlossary();
}
function showGlossary() {
  // Only when it opens: a term followed from inside the sheet calls this again, and the focus to return to is the document's, not a link about to be replaced.
  if (glossarySheet.hidden) glossaryLastFocus = document.activeElement;
  glossaryBackdrop.hidden = false;
  glossarySheet.hidden = false;
  requestAnimationFrame(() => {
    glossaryBackdrop.classList.add('open');
    // Flush again: a sheet parked part-way down by a drag stays there until it is closed, and the next thing to open it means to be read.
    resetSheetDrag(glossarySheet);
    glossarySheet.classList.add('open');
  });
  document.addEventListener('keydown', onGlossaryKey);
  leafFocusForKeyboard(glossarySheetClose);
}
function dismissGlossary() {
  if (glossarySheet.hidden) return;
  endGlossaryWait();
  glossaryBackdrop.classList.remove('open');
  glossarySheet.classList.remove('open');
  document.removeEventListener('keydown', onGlossaryKey);
  const hide = () => {
    glossarySheet.hidden = true;
    glossaryBackdrop.hidden = true;
    glossarySheet.removeEventListener('transitionend', hide);
  };
  glossarySheet.addEventListener('transitionend', hide);
  setTimeout(hide, 320);
  leafFocusForKeyboard(glossaryLastFocus);
}
// A big glossary takes long enough to read and render that a tap can look like it missed, so the sheet goes up on a spinner the moment the link is followed. The page raises it rather than the host: the host can't send a script while it is rendering, so its spinner would arrive after the work it was to cover. The fade-in is delayed (CSS), so a cached lookup never flashes one.
const GLOSSARY_ANSWER_TIMEOUT_MS = 20000;
let glossaryWaitTimer = 0;
// Every openGlossary goes through awaitGlossaryEntry, so an answer arriving with nothing outstanding belongs to a lookup the user dismissed: it must not put the sheet back up on its own.
const GLOSSARY_FAILED = 'Couldn’t open the glossary.';
let glossaryWaiting = false;
function endGlossaryWait() {
  glossaryWaiting = false;
  if (glossaryWaitTimer) {
    clearTimeout(glossaryWaitTimer);
    glossaryWaitTimer = 0;
  }
}
function glossarySheetMessage(message) {
  endGlossaryWait();
  const text = document.createElement('p');
  text.className = 'glossary-sheet-message';
  text.textContent = message;
  glossarySheetBody.innerHTML = '';
  glossarySheetBody.appendChild(text);
}
// Called as the link is followed, before the host has heard about it.
function awaitGlossaryEntry() {
  endGlossaryWait();
  const waiting = document.createElement('div');
  waiting.className = 'glossary-sheet-waiting';
  waiting.setAttribute('role', 'status');
  waiting.setAttribute('aria-label', 'Loading glossary…');
  const spinner = document.createElement('div');
  spinner.className = 'lt-spinner glossary-sheet-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  waiting.appendChild(spinner);
  glossarySheetBody.innerHTML = '';
  glossarySheetBody.appendChild(waiting);
  glossarySheetBody.scrollTop = 0;
  glossaryWaiting = true;
  // If nothing comes back at all, the sheet still has to stop spinning.
  glossaryWaitTimer = window.setTimeout(() => {
    glossaryWaitTimer = 0;
    glossarySheetMessage(GLOSSARY_FAILED);
  }, GLOSSARY_ANSWER_TIMEOUT_MS);
  showGlossary();
}
// The host looked and came back empty-handed: no glossary file near the document ('missing'), or one it couldn't read.
window.leafGlossaryFailed = (reason) => {
  if (glossarySheet.hidden) return;
  glossarySheetMessage(reason === 'missing' ? 'No glossary file near this document.' : GLOSSARY_FAILED);
};
glossaryBackdrop.addEventListener('click', dismissGlossary);
glossarySheetClose.addEventListener('click', dismissGlossary);
makeSheetDraggable(glossarySheet, glossarySheet.querySelector('.leaf-sheet-grip'), dismissGlossary);
// "Open the full glossary" opens the glossary file as an ordinary document tab, resolved (like the link that opened the sheet) against the active document.
glossaryFullLink.addEventListener('click', (event) => {
  event.preventDefault();
  dismissGlossary();
  send({ command: 'openLink', href: glossaryHrefBase, scroll_anchor: currentScrollAnchor() });
});
glossarySheetBody.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  const rawHref = link.getAttribute('href') || '';
  if (!rawHref || /^[a-z]+:\/\//i.test(rawHref) || rawHref.startsWith('mailto:')) return;
  event.preventDefault();
  const within = glossaryAnchorFromHref(rawHref) || (rawHref.startsWith('#') ? rawHref.slice(1) : '');
  if (within) {
    awaitGlossaryEntry();
    send({ command: 'openGlossary', href: glossaryHrefBase + '#' + within });
    return;
  }
  dismissGlossary();
  send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor() });
});
const linkHoverTip = document.createElement('div');
linkHoverTip.className = 'link-hover-tip';
linkHoverTip.hidden = true;
linkHoverTip.innerHTML =
  '<div class="link-hover-tip-kind"></div>' +
  '<div class="link-hover-tip-detail"></div>' +
  '<div class="link-hover-tip-lines" hidden></div>';
appSurface.appendChild(linkHoverTip);
const linkHoverTipKind = linkHoverTip.querySelector('.link-hover-tip-kind');
const linkHoverTipDetail = linkHoverTip.querySelector('.link-hover-tip-detail');
const linkHoverTipLines = linkHoverTip.querySelector('.link-hover-tip-lines');
const canHoverLinks = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// A hovered cross-document link shows the target's line count. The webview asks the host (countLines IPC); the host answers via window.leafLineCount. Each hover gets a token so a stale answer is ignored, and answers are cached by href.
let activeHoverToken = 0;
const lineCountCache = new Map();
const pendingLineTokens = new Map();
function formatLineCount(n) {
  return formatCount(n) + ' ' + (n === 1 ? 'line' : 'lines');
}
function setLinkHoverLines(count) {
  const text = typeof count === 'number' && count >= 0 ? formatLineCount(count) : '';
  linkHoverTipLines.textContent = text;
  linkHoverTipLines.hidden = !text;
}
window.leafLineCount = (token, lines) => {
  const key = pendingLineTokens.get(token);
  if (key !== undefined) {
    pendingLineTokens.delete(token);
    if (typeof lines === 'number' && lines >= 0) lineCountCache.set(key, lines);
  }
  if (token === activeHoverToken && typeof lines === 'number' && lines >= 0) {
    setLinkHoverLines(lines);
  }
};
let activeHoverLink = null;
function hideLinkHoverTip() {
  activeHoverLink = null;
  linkHoverTip.hidden = true;
}
// Worked out in the window's coordinates, which is what the pointer and the button's rectangle are given in, and written out in the app's — the tip is a fixed child of the app surface, so its `left` is measured from there.
function positionLinkHoverTip(event) {
  const margin = 14;
  const rect = linkHoverTip.getBoundingClientRect();
  const app = leafAppRect();
  let left = event.clientX + 18;
  let top = event.clientY + 18;
  if (left + rect.width > app.right - margin) {
    left = Math.max(app.left + margin, event.clientX - rect.width - 18);
  }
  if (top + rect.height > app.bottom - margin) {
    top = Math.max(app.top + margin, event.clientY - rect.height - 18);
  }
  // A pager button is a big target, so a card following the pointer into it covers the very page name it is there to give. It stands clear of the whole button instead — above it, or under it when there is no room.
  const button = pagerHoverTitle(activeHoverLink) ? activeHoverLink.getBoundingClientRect() : null;
  if (button && top < button.bottom && top + rect.height > button.top) {
    const above = button.top - rect.height - 10;
    top = above >= app.top + margin ? above : Math.min(button.bottom + 10, app.bottom - margin - rect.height);
  }
  linkHoverTip.style.left = (left - app.left) + 'px';
  linkHoverTip.style.top = (top - app.top) + 'px';
}
// The tooltip's detail line. Decodes the percent-encoded href for readability, falling back to the raw href if it isn't valid percent-encoding.
function hoverDetail(rawHref) {
  try { return decodeURIComponent(rawHref); } catch (e) { return rawHref; }
}
// The page a pager button was stamped with. Placement only: the card stands clear of a target this big.
function pagerHoverTitle(link) {
  return link && link.getAttribute ? (link.getAttribute('data-pager-title') || '').trim() : '';
}
// The href alone, so the card, the middle click and the menu cannot answer differently about one link.
function linkHoverInfo(rawHref) {
  if (!rawHref) return null;
  if (/^glossary:\s*$/i.test(rawHref)) {
    return { kind: 'Full glossary', detail: hoverDetail(rawHref) };
  }
  if (glossaryAnchorFromHref(rawHref)) {
    return { kind: 'Glossary entry', detail: hoverDetail(rawHref) };
  }
  if (sameDocumentFragmentHref(rawHref)) {
    return { kind: 'In-page jump', detail: hoverDetail(rawHref) };
  }
  if (/^mailto:/i.test(rawHref)) {
    return { kind: 'Email link', detail: hoverDetail(rawHref) };
  }
  if (/^https?:\/\//i.test(rawHref)) {
    return { kind: 'External site', detail: hoverDetail(rawHref) };
  }
  // The pager's buttons carry one, and the host opens it in place like any page — so this goes ahead of the scheme test, which would call it an app command.
  if (/^file:/i.test(rawHref) && DOCUMENT_HREF_RE.test(rawHref)) {
    return { kind: 'Another page', detail: hoverDetail(rawHref) };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) {
    return { kind: 'App link', detail: hoverDetail(rawHref) };
  }
  // Any format the app reads, not just Markdown — the host follows all of them in place, so the hint has to promise the same.
  if (DOCUMENT_HREF_RE.test(rawHref)) {
    return { kind: 'Another page', detail: hoverDetail(rawHref) };
  }
  if (rawHref.startsWith('/')) {
    return { kind: 'Local path', detail: hoverDetail(rawHref) };
  }
  return { kind: 'Link', detail: hoverDetail(rawHref) };
}
if (canHoverLinks) {
  document.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const rawHref = (link.getAttribute('href') || '').trim();
    const info = linkHoverInfo(rawHref);
    if (!info) {
      hideLinkHoverTip();
      return;
    }
    activeHoverLink = link;
    linkHoverTipKind.textContent = info.kind;
    linkHoverTipDetail.textContent = info.detail;
    const token = ++activeHoverToken;
    setLinkHoverLines(null);
    // Only in-app page links carry a line count; nothing else does.
    if (info.kind === 'Another page') {
      const key = link.href || rawHref;
      if (lineCountCache.has(key)) {
        setLinkHoverLines(lineCountCache.get(key));
      } else {
        pendingLineTokens.set(token, key);
        send({ command: 'countLines', href: key, token });
      }
    }
    linkHoverTip.hidden = false;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointermove', (event) => {
    if (!activeHoverLink) return;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointerout', (event) => {
    if (!activeHoverLink) return;
    const next = event.relatedTarget;
    if (next && next.closest && next.closest('a[href]') === activeHoverLink) return;
    hideLinkHoverTip();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideLinkHoverTip();
  });
  window.addEventListener('blur', hideLinkHoverTip);
  app.addEventListener('scroll', hideLinkHoverTip, true);
}
// The parsed glossary document, cached between calls keyed by the exact html the host sent — parsing the (often huge) glossary into a DOM to lift one entry is the dominant cost of opening the sheet. A different glossary reparses once; extractGlossaryEntry only reads/clones, so sharing is safe.
let glossaryParsedHtml = null;
let glossaryParsedRoot = null;
// Called by the host with the fully rendered glossary document; pull out the requested entry and slide the sheet up.
window.leafShowGlossary = (html, anchor) => {
  if (!glossaryWaiting) return; // answer to a lookup the user has since dismissed
  endGlossaryWait();
  if (html !== glossaryParsedHtml) {
    glossaryParsedRoot = document.createElement('div');
    glossaryParsedRoot.innerHTML = html;
    glossaryParsedHtml = html;
  }
  const entry = extractGlossaryEntry(glossaryParsedRoot, anchor);
  if (!entry) {
    glossarySheetMessage(`No glossary entry for “${anchor}”.`);
    showGlossary();
    return;
  }
  glossarySheetBody.innerHTML = '';
  glossarySheetBody.appendChild(entry);
  glossarySheetBody.scrollTop = 0;
  showGlossary();
};
// One delegated click listener for every document link, bound once — binding each link separately costs a major slice of open time on large documents. Delegation also handles links added later (the async pager) with no rebinding.
let documentLinksBound = false;
// A link the app itself follows: one inside the document being read. The minimap's clone keeps the class but has its hrefs stripped and takes no pointer events.
function documentLinkFor(target) {
  const link = target && target.closest ? target.closest('a[href]') : null;
  return link && app.contains(link) && link.closest('.document-body') ? link : null;
}
// Hold this and the link opens as a page behind the one you are reading: Cmd on a Mac, where Ctrl is already the right-click, and Ctrl everywhere else.
function newPageModifierHeld(event) {
  return isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
// Whether a link has a page in this app to open at all. The hover tip's own test, so what the tip promised and what the gesture does cannot disagree.
function isAnotherPageHref(rawHref) {
  return linkHoverKind(rawHref) === 'Another page';
}
// What a link is, in the words the hover tip uses. Read by the right-click menu to name Open after where it sends you.
function linkHoverKind(rawHref) {
  const info = linkHoverInfo((rawHref || '').trim());
  return info ? info.kind : '';
}
function bindDocumentLinks() {
  if (documentLinksBound) {
    return;
  }
  documentLinksBound = true;
  app.addEventListener('click', (event) => {
    const link = documentLinkFor(event.target);
    if (!link || event.defaultPrevented || event.button !== 0) {
      return;
    }
    event.preventDefault();
    sendDocumentLink(link, newPageModifierHeld(event));
  });
  // The middle button raises `auxclick` and never `click`, so this is the only place it can be seen. Only a link with a page to open answers it.
  app.addEventListener('auxclick', (event) => {
    const link = event.button === 1 ? documentLinkFor(event.target) : null;
    if (!link || !isAnotherPageHref(link.getAttribute('href'))) {
      return;
    }
    event.preventDefault();
    sendDocumentLink(link, true);
  });
  // The web view's own scroll-anywhere puck opens on mousedown, which is before the auxclick above — canceling there alone would be too late to stop it.
  app.addEventListener('mousedown', (event) => {
    const link = event.button === 1 ? documentLinkFor(event.target) : null;
    if (link && isAnotherPageHref(link.getAttribute('href'))) {
      event.preventDefault();
    }
  });
}
// Hand a document link to the host — from a click, or from the right-click menu's own Open. Every click that reaches here is canceled first: a click left uncanceled is the web view's to follow, and the web view is not the app.
function sendDocumentLink(link, newPage) {
  const rawHref = link.getAttribute('href') || '';
  if (!rawHref) {
    return;
  }
  const glossaryTerm = glossaryAnchorFromHref(rawHref);
  if (glossaryTerm) {
    // For a `glossary:` link keep the bare scheme as the base, so term jumps and "open full glossary" let the host re-resolve the nearest file.
    glossaryHrefBase = /^glossary:/i.test(rawHref) ? 'glossary:' : rawHref.split('#')[0];
    awaitGlossaryEntry();
    send({ command: 'openGlossary', href: rawHref });
    return;
  }
  const fragmentHref = sameDocumentFragmentHref(rawHref);
  if (fragmentHref) {
    send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });
    return;
  }
  // As written, never the form the browser resolved: a site is one page, so a resolved href names a document at the top of it rather than one beside the document being read. Both hosts resolve a written href against the open document.
  send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });
}
