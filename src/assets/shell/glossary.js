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
function documentHeadingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : 0;
}
// One section of a rendered document: the element the anchor names and every block after it, stopping at the next heading of its own rank or higher. Any element, not only a heading, so an anchor stamped on something else still answers. Read by the glossary sheet for a term and by the link card for the section an address points at.
function documentSectionBlocks(root, anchor) {
  const start = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === anchor);
  if (!start) return null;
  const level = documentHeadingLevel(start) || 6;
  const blocks = [start];
  let node = start.nextElementSibling;
  while (node) {
    const lvl = documentHeadingLevel(node);
    if (lvl && lvl <= level) break;
    blocks.push(node);
    node = node.nextElementSibling;
  }
  return blocks;
}
function onGlossaryKey(event) {
  if (event.key === 'Escape') dismissGlossary();
}
function showGlossary() {
  // Only when it opens: a term followed from inside the sheet calls this again, and the focus to return to is the document's, not a link about to be replaced.
  if (glossarySheet.hidden) glossaryLastFocus = document.activeElement;
  openSheet(glossarySheet, glossaryBackdrop);
  document.addEventListener('keydown', onGlossaryKey);
  leafFocusForKeyboard(glossarySheetClose);
}
function dismissGlossary(options) {
  if (glossarySheet.hidden) return;
  endGlossaryWait();
  document.removeEventListener('keydown', onGlossaryKey);
  closeSheet(glossarySheet, glossaryBackdrop, options);
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
// Wrapped, not handed straight over: the dismissal reads how it was asked for off its one argument, and a listener would pass it the click.
glossaryBackdrop.addEventListener('click', () => dismissGlossary());
glossarySheetClose.addEventListener('click', () => dismissGlossary());
makeSheetDraggable(glossarySheet, glossarySheet.querySelector('.leaf-sheet-grip'), dismissGlossary);
// "Open the full glossary" opens the glossary file as an ordinary document tab, resolved (like the link that opened the sheet) against the active document.
glossaryFullLink.addEventListener('click', (event) => {
  event.preventDefault();
  dismissGlossary();
  setNavigationDirection('forward');
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
  setNavigationDirection('forward');
  send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor() });
});
const linkHoverTip = document.createElement('div');
linkHoverTip.className = 'link-hover-tip';
linkHoverTip.hidden = true;
linkHoverTip.innerHTML =
  '<div class="link-hover-tip-preview" hidden><div class="link-hover-tip-preview-placeholder"><span class="lt-spinner link-hover-tip-preview-spinner"></span></div><div class="link-hover-tip-preview-scale"><div class="document-body link-hover-tip-preview-document"></div></div></div>' +
  '<div class="link-hover-tip-kind"></div>' +
  '<div class="link-hover-tip-detail"></div>' +
  '<div class="link-hover-tip-lines" hidden></div>' +
  '<div class="link-hover-tip-more" hidden>Press to read the rest</div>';
appSurface.appendChild(linkHoverTip);
const linkHoverTipPreview = linkHoverTip.querySelector('.link-hover-tip-preview');
const linkHoverTipPreviewScale = linkHoverTip.querySelector('.link-hover-tip-preview-scale');
const linkHoverTipPreviewDocument = linkHoverTip.querySelector('.link-hover-tip-preview-document');
const linkHoverTipKind = linkHoverTip.querySelector('.link-hover-tip-kind');
const linkHoverTipDetail = linkHoverTip.querySelector('.link-hover-tip-detail');
const linkHoverTipLines = linkHoverTip.querySelector('.link-hover-tip-lines');
const linkHoverTipMore = linkHoverTip.querySelector('.link-hover-tip-more');
const canHoverLinks = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// A hovered cross-document link shows the target's line count. The webview asks the host (countLines IPC); the host answers via window.leafLineCount. Each hover gets a token so a stale answer is ignored, and answers are cached by href.
let activeHoverToken = 0;
const lineCountCache = new Map();
const pendingLineTokens = new Map();
const linkPreviewCache = new Map();
const pendingPreviewTokens = new Map();
let linkHoverPreviewTimer = 0;
let linkHoverHideTimer = 0;
let linkHoverShowFrame = 0;
let linkHoverEndFade = null;
let linkHoverPointer = null;
let linkHoverLeaveFrame = 0;
// Whether the card the pointer is on is a glossary link's. Read at drawing time rather than carried through the ask, because the host's answer arrives long after the rest that asked for it.
let linkHoverEntry = false;
// The pointer's latest place. A leave settles here, not at the stale point its own event carried.
let linkHoverClientX = -1;
let linkHoverClientY = -1;
function recordLinkHoverPoint(event) {
  if (typeof event.clientX !== 'number') return;
  linkHoverClientX = event.clientX;
  linkHoverClientY = event.clientY;
}
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
function durationTokenMilliseconds(token) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return value.endsWith('ms') ? amount : amount * 1000;
}
function setLinkHoverPreview(html) {
  const present = typeof html === 'string' && html !== '';
  linkHoverTipPreviewDocument.innerHTML = present ? html : '';
  linkHoverTipPreview.classList.toggle('is-loaded', present);
  linkHoverTipPreview.classList.toggle('is-entry', present && linkHoverEntry);
  // Whether this answer runs past the cap is the drawing's own answer, so the cut and the line it promises start off every card.
  linkHoverTipPreview.classList.remove('is-capped');
  linkHoverTipMore.hidden = true;
  // Every answer is measured on its own. A shrink and a layer width left over from the last card would cap this note at that card's width and hold it there.
  linkHoverTipPreview.style.removeProperty('--link-preview-shrink');
  linkHoverTipPreviewScale.style.width = '';
  if (!present) linkHoverTipPreview.style.removeProperty('height');
  if (present) requestAnimationFrame(sizeLinkHoverPreview);
}
// The shrink the box is carrying, never a second copy of the number.
function linkPreviewShrink() {
  const value = Number.parseFloat(getComputedStyle(linkHoverTipPreview).getPropertyValue('--link-preview-shrink'));
  return Number.isFinite(value) && value > 0 ? value : 1;
}
// The note is held to the page's reading measure, so 75 characters is not a width until something asks. The layer is widened past anything the page can reach, the note is read at its own cap, and the layer is then laid out at exactly that — so the picture is the note, with no background beside it. The widening comes first because a layer at any narrower width caps the note at it and holds every later card there.
function measureLinkPreviewShrink(note) {
  linkHoverTipPreviewScale.style.width = '100vw';
  const box = linkHoverTipPreview.clientWidth;
  const measured = note ? note.offsetWidth : 0;
  // Nothing to measure: the stylesheet's own shrink rather than none at all, so a host answering with bare blocks still draws a card.
  if (!(box > 0) || !(measured > 0)) {
    linkHoverTipPreviewScale.style.width = '';
    return linkPreviewShrink();
  }
  linkHoverTipPreview.style.setProperty('--link-preview-shrink', String(box / measured));
  linkHoverTipPreviewScale.style.width = measured + 'px';
  return box / measured;
}
// The card's own width at reading size. The shrink fits a page's note into a thumbnail, and an entry is the answer itself rather than a picture of one, so it stays at 1 — which the stylesheet's own `calc` reads as the box's width exactly.
function holdLinkPreviewUnshrunk() {
  linkHoverTipPreview.style.setProperty('--link-preview-shrink', '1');
  linkHoverTipPreviewScale.style.width = '';
  return 1;
}
// The room a glossary entry gets. Measured in the card, 480px draws three of every four entries whole and holds the card to seven tenths of a full window; the fraction is what carries a short window, where a fixed cap would cover the sentence being read.
const LINK_PREVIEW_ENTRY_CAP = 480;
function linkPreviewEntryCap() {
  const room = Math.floor(leafAppRect().height * 0.6);
  return room > 0 ? Math.min(LINK_PREVIEW_ENTRY_CAP, room) : LINK_PREVIEW_ENTRY_CAP;
}
function sizeLinkHoverPreview() {
  if (!linkHoverTipPreview.classList.contains('is-loaded')) return;
  const article = linkHoverTipPreviewDocument.querySelector('article');
  const note = article && article.children.length ? article : null;
  const source = note || linkHoverTipPreviewDocument;
  const shrink = linkHoverEntry ? holdLinkPreviewUnshrunk() : measureLinkPreviewShrink(note);
  // The whole opening, not its first blocks: the height cap lands most notes at one size, and only a note shorter than the cap hugs its content.
  const blocks = [...source.children].filter((block) => block.offsetHeight > 0);
  const last = blocks[blocks.length - 1];
  const height = last ? last.offsetTop + last.offsetHeight : source.scrollHeight;
  const drawn = Math.ceil(height * shrink);
  // An entry under the cap hugs its own height, the way a short note already does; one past it is cut, and the cut says so rather than stopping mid-word.
  const cap = linkHoverEntry ? linkPreviewEntryCap() : 0;
  const capped = cap > 0 && drawn > cap;
  linkHoverTipPreview.style.height = (capped ? cap : drawn) + 'px';
  linkHoverTipPreview.classList.toggle('is-capped', capped);
  linkHoverTipMore.hidden = !capped;
  if (linkHoverPointer) positionLinkHoverTip(linkHoverPointer);
  drawLinkPreviewDiagrams();
}
linkHoverTipPreviewDocument.addEventListener('load', () => requestAnimationFrame(sizeLinkHoverPreview), true);
// Half the picture, in the picture's own pixels: a drawing over it is scaled into it by the stylesheet, because the picture is there to say how the page reads on.
const LINK_PREVIEW_DIAGRAM_ROOM = 88;
// A third of the picture's width, which a drawing has to still be once it fits that room: a page-tall flowchart comes to 10px there and is a sliver, a pie chart to 111px and is a pie.
const LINK_PREVIEW_DIAGRAM_NARROWEST = 251 / 3;
// Sources too narrow at the size they fit, and ones mermaid refused. Both are the strip, and both are remembered so a second rest goes straight there.
const linkPreviewDiagramsNotShown = new Set();
// Where every drawing a card makes is made. Mermaid sizes each word's frame from what it reads while drawing, so a block inside the layer the card scales gives every word a frame at the card's shrink and the word, still drawn at full size, is clipped to a smear — and the shared picture memo hands that same picture to the reading page.
let linkPreviewDiagramHolder = null;
// Off screen rather than hidden: a hidden box has no layout, and mermaid measures nothing in one. A block of its own per drawing, because a card with two diagrams starts both at once.
function takeLinkPreviewDiagramBlock(source) {
  if (!linkPreviewDiagramHolder) {
    linkPreviewDiagramHolder = document.createElement('div');
    linkPreviewDiagramHolder.className = 'document-body';
    linkPreviewDiagramHolder.style.position = 'absolute';
    linkPreviewDiagramHolder.style.top = '0';
    linkPreviewDiagramHolder.style.left = '-10000px';
    appSurface.appendChild(linkPreviewDiagramHolder);
  }
  // The width the card measured its note at, so a word wraps where the reading page would wrap it and the memo's one entry serves both.
  const width = linkHoverTipPreviewScale.offsetWidth;
  if (width > 0) linkPreviewDiagramHolder.style.width = width + 'px';
  const block = document.createElement('pre');
  block.className = 'mermaid';
  block.textContent = source;
  linkPreviewDiagramHolder.appendChild(block);
  return block;
}
// The holder goes with the last drawing in it, so nothing of the card is left standing in the page between rests.
function dropLinkPreviewDiagramBlock(block) {
  block.remove();
  if (linkPreviewDiagramHolder && !linkPreviewDiagramHolder.children.length) {
    linkPreviewDiagramHolder.remove();
    linkPreviewDiagramHolder = null;
  }
}
// The card's picture is a document like any other, so a Mermaid fence in it arrives as its own source text and nothing here will ever draw it: the reading page's pass collects inside `#app` and the card sits outside. Nothing is written for the wait — the block is already the box, the corner word and the ring the stylesheet gives an undrawn diagram.
function drawLinkPreviewDiagrams() {
  const blocks = [...linkHoverTipPreviewDocument.querySelectorAll('pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"])')];
  if (!blocks.length) return;
  // The card this was asked for. Another link under the pointer moves it on, and the answer that arrives after that is dropped rather than drawn into a card nobody is looking at.
  const token = activeHoverToken;
  for (const block of blocks) {
    if (block.dataset.processed === 'true' || block.dataset.cardDiagram === 'drawing') continue;
    // Kept on the block, the way the reading page keeps it: once a drawing is in there the block's own text is the drawing's, and a second pass reading it would ask for a picture of an SVG.
    if (block.__mermaidSource == null) block.__mermaidSource = block.textContent;
    const source = block.__mermaidSource;
    if (linkPreviewDiagramsNotShown.has(source)) {
      block.dataset.cardDiagram = 'unshown';
      continue;
    }
    const drawn = mermaidRenderCache.get(mermaidCacheKey(source));
    if (drawn) {
      block.innerHTML = drawn;
      ensureMermaidSheets(block);
      block.dataset.processed = 'true';
      keepLinkPreviewDiagramThatFits(block, source);
      continue;
    }
    block.dataset.cardDiagram = 'drawing';
    const stage = takeLinkPreviewDiagramBlock(source);
    loadMermaid()
      .then((mermaid) => {
        registerMermaidIcons(mermaid);
        mermaid.initialize(mermaidRuntimeConfig());
        return mermaid.run({ nodes: [stage] });
      })
      .then(() => {
        delete block.dataset.cardDiagram;
        if (token !== activeHoverToken || !block.isConnected) {
          dropLinkPreviewDiagramBlock(stage);
          return;
        }
        // Sheet first, memo second, card third: the memo holds the markup, so hoisting the sheet after it would remember a sheet naming rules the page has not got.
        shareMermaidSheet(stage);
        const made = stage.innerHTML;
        if (mermaidRenderCache.size >= MERMAID_CACHE_CAP) mermaidRenderCache.clear();
        mermaidRenderCache.set(mermaidCacheKey(source), made);
        dropLinkPreviewDiagramBlock(stage);
        // The same assignment the memo's own restore makes, so a card holds what the page would hold.
        block.innerHTML = made;
        block.dataset.processed = 'true';
        keepLinkPreviewDiagramThatFits(block, source);
        sizeLinkHoverPreview();
      })
      .catch(() => {
        // A drawing mermaid refused keeps whatever it drew in there on the reading page; in a picture this small there is no room to read an error, so it goes back to the strip with the corner word still saying what stood there.
        delete block.dataset.cardDiagram;
        dropLinkPreviewDiagramBlock(stage);
        linkPreviewDiagramsNotShown.add(source);
        if (!block.isConnected) return;
        putLinkPreviewDiagramBack(block, source);
        if (token === activeHoverToken) sizeLinkHoverPreview();
      });
  }
}
// The one thing the card decides that the reading page does not: a drawing still too narrow to read at the size it fits goes back as the strip, and is remembered so the next rest goes straight there.
function keepLinkPreviewDiagramThatFits(block, source) {
  const shrink = linkPreviewShrink();
  if (block.offsetHeight <= LINK_PREVIEW_DIAGRAM_ROOM / shrink) return;
  // Taller than the room, so the stylesheet has scaled it down: what is left to ask is whether anything is still readable at that size.
  const drawing = block.querySelector('svg');
  if (drawing && linkPreviewDiagramInkWidth(drawing) >= LINK_PREVIEW_DIAGRAM_NARROWEST) return;
  linkPreviewDiagramsNotShown.add(source);
  putLinkPreviewDiagramBack(block, source);
}
// The ink, not the box around it: mermaid's drawing is `width="100%"` under a `max-width`, so capping its height letterboxes the picture inside a rectangle that never narrows, and reading that rectangle calls a five-pixel hairline a picture. The letterbox is arithmetic rather than a search — the smaller of the rectangle and its height times the drawing's own aspect — and a drawing with no usable `viewBox` keeps the plain reading. Either number is already what the reader sees: the drawing sits inside the layer the card scales, so multiplying by the shrink again would count it twice.
function linkPreviewDiagramInkWidth(drawing) {
  const box = drawing.getBoundingClientRect();
  const view = (drawing.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean).map(Number);
  if (view.length !== 4 || !(view[2] > 0) || !(view[3] > 0)) return box.width;
  return Math.min(box.width, (box.height * view[2]) / view[3]);
}
// The block goes back to being undrawn, and says so — the stylesheet's box and ring are for a drawing that is coming, and nothing is coming for this one.
function putLinkPreviewDiagramBack(block, source) {
  delete block.dataset.processed;
  block.textContent = source;
  block.dataset.cardDiagram = 'unshown';
}
function showLinkHoverPreviewPlaceholder() {
  linkHoverTipPreview.hidden = false;
  linkHoverTip.classList.add('has-preview');
  setLinkHoverPreview(null);
}
function hideLinkHoverPreview() {
  linkHoverTipPreview.hidden = true;
  linkHoverTip.classList.remove('has-preview');
  setLinkHoverPreview(null);
}
// An empty answer is the host saying it cannot draw that page, so the card drops the picture box the way a link to anything but a page never raises one.
function applyLinkHoverPreview(html) {
  if (typeof html === 'string' && html !== '') {
    linkHoverTipPreview.hidden = false;
    linkHoverTip.classList.add('has-preview');
    setLinkHoverPreview(html);
  } else {
    hideLinkHoverPreview();
  }
  if (linkHoverPointer) positionLinkHoverTip(linkHoverPointer);
}
function endLinkHoverFade() {
  if (linkHoverHideTimer) window.clearTimeout(linkHoverHideTimer);
  linkHoverHideTimer = 0;
  if (linkHoverEndFade) linkHoverTip.removeEventListener('transitionend', linkHoverEndFade);
  linkHoverEndFade = null;
}
function showLinkHoverTip(event) {
  if (linkHoverLeaveFrame) window.cancelAnimationFrame(linkHoverLeaveFrame);
  linkHoverLeaveFrame = 0;
  endLinkHoverFade();
  linkHoverTip.hidden = false;
  positionLinkHoverTip(event);
  if (linkHoverShowFrame) window.cancelAnimationFrame(linkHoverShowFrame);
  linkHoverShowFrame = requestAnimationFrame(() => {
    linkHoverShowFrame = 0;
    if (!linkHoverTip.hidden) linkHoverTip.classList.add('shown');
  });
}
let activeHoverLink = null;
function hideLinkHoverTip() {
  if (linkHoverPreviewTimer) window.clearTimeout(linkHoverPreviewTimer);
  linkHoverPreviewTimer = 0;
  if (linkHoverShowFrame) window.cancelAnimationFrame(linkHoverShowFrame);
  linkHoverShowFrame = 0;
  if (linkHoverLeaveFrame) window.cancelAnimationFrame(linkHoverLeaveFrame);
  linkHoverLeaveFrame = 0;
  activeHoverLink = null;
  linkHoverPointer = null;
  activeHoverToken += 1;
  if (linkHoverTip.hidden) {
    hideLinkHoverPreview();
    return;
  }
  // Already fading: a second exit would stack another listener and timer on the same card.
  if (linkHoverEndFade) return;
  linkHoverTip.classList.remove('shown');
  const hide = (event) => {
    if (event && event.target !== linkHoverTip) return;
    endLinkHoverFade();
    linkHoverTip.hidden = true;
    hideLinkHoverPreview();
  };
  linkHoverEndFade = hide;
  linkHoverTip.addEventListener('transitionend', hide);
  linkHoverHideTimer = window.setTimeout(hide, durationTokenMilliseconds('--lt-duration-300'));
}
// A render destroys the link the card was raised on, so the card goes outright in the same frame — the leave's fade exists for a slide to a neighboring link, and a fresh page has none. The `var` is the guard for the render theme.js runs while this fragment's own state is still in its dead zone: no card exists yet, so there is nothing to hide.
var linkHoverCardReady = false;
function dismissLinkHoverTip() {
  if (!linkHoverCardReady) return;
  hideLinkHoverTip();
  endLinkHoverFade();
  linkHoverTip.classList.remove('shown');
  linkHoverTip.hidden = true;
  hideLinkHoverPreview();
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
function requestLinkPreview(key, token) {
  linkHoverPreviewTimer = window.setTimeout(() => {
    linkHoverPreviewTimer = 0;
    if (token !== activeHoverToken || linkHoverTip.hidden) return;
    if (linkPreviewCache.has(key)) {
      applyLinkHoverPreview(linkPreviewCache.get(key));
      return;
    }
    pendingPreviewTokens.set(token, key);
    send({ command: 'previewLink', href: key, token });
  }, durationTokenMilliseconds('--lt-duration-300'));
}
// The last answer the host sent, parsed once — one file's render is parsed once however many of its sections are rested on, and it is only read from, so holding it between rests is safe.
let linkPreviewParsedHtml = null;
let linkPreviewParsedRoot = null;
// The section of the host's answer that the address names, as words the card can draw. The answer is a base and one `article` the card measures the note by, so the opening the host wrote is kept and only what stands inside it is swapped. A glossary link names its term through the scheme, which has no `#` to cut at, so that is read first. An address naming no section is the whole answer; a glossary term the answer has not got is nothing at all, because a whole glossary is not what that reader was promised.
function linkPreviewSectionHtml(html, href) {
  const term = glossaryAnchorFromHref(href);
  let anchor = term;
  if (!anchor) {
    const hashAt = String(href || '').indexOf('#');
    if (hashAt < 0) return html;
    anchor = String(href).slice(hashAt + 1);
    try { anchor = decodeURIComponent(anchor); } catch (e) {}
  }
  if (!anchor) return html;
  const opens = html.indexOf('<article');
  const opened = opens < 0 ? -1 : html.indexOf('>', opens);
  if (opened < 0) return html;
  if (html !== linkPreviewParsedHtml) {
    linkPreviewParsedRoot = document.createElement('div');
    linkPreviewParsedRoot.innerHTML = html;
    linkPreviewParsedHtml = html;
  }
  const note = linkPreviewParsedRoot.querySelector('article') || linkPreviewParsedRoot;
  const blocks = documentSectionBlocks(note, anchor);
  if (!blocks) return term ? '' : html;
  return html.slice(0, opened + 1) + blocks.map((block) => block.outerHTML).join('') + '</article>';
}
window.leafLinkPreview = (token, html) => {
  const key = pendingPreviewTokens.get(token);
  let note = html;
  if (key !== undefined) {
    pendingPreviewTokens.delete(token);
    // The section rather than the whole file, so many links into one page cost that many sections rather than that many copies of the page.
    if (typeof html === 'string') {
      note = html === '' ? html : linkPreviewSectionHtml(html, key);
      linkPreviewCache.set(key, note);
    }
  }
  if (token !== activeHoverToken || linkHoverTip.hidden || typeof html !== 'string') return;
  applyLinkHoverPreview(note);
};
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
  // Any other `file:` address is still a file on this disk, so it takes the words every other such file gets rather than being read as an app's own scheme below.
  if (/^file:/i.test(rawHref)) {
    return { kind: 'Opens in another app', detail: resolvedHoverDetail(rawHref) };
  }
  // A scheme of its own: another app's address, a phone number. A single letter is a drive rather than a scheme, which is how a whole path is written on Windows and how the guard below and the host both read one.
  if (/^[a-z][a-z0-9+.-]+:/i.test(rawHref)) {
    return { kind: 'App link', detail: hoverDetail(rawHref) };
  }
  // Any format the app reads, not just Markdown — the host follows all of them in place, so the hint has to promise the same.
  if (DOCUMENT_HREF_RE.test(rawHref)) {
    return { kind: 'Another page', detail: hoverDetail(rawHref) };
  }
  // Everything left is a file this app does not read, whichever way it was written — `./report.pdf` and `/notes/report.pdf` are the same link doing the same thing, so a reader hovering both is not told two different things about them. The address under it is where that file actually sits, which is what tells a dead link from a live one.
  return { kind: 'Opens in another app', detail: resolvedHoverDetail(rawHref) };
}
// Where the file a link names actually sits: joined onto the folder the open document is in, the way the host joins it before handing it to the machine. A whole path stands on its own, and with nothing open there is nothing to join onto, so the address is shown as it was written.
function resolvedHoverDetail(rawHref) {
  const written = String(rawHref || '');
  // A `file:` address already says where the file sits, so it is read back as the path it names rather than joined onto the open document's folder.
  if (/^file:/i.test(written)) return hoverDetail(localPathFromFileHref(written));
  const name = strippedHref(written);
  const from = activeDocumentPath();
  if (!from || !name || /^[/\\]/.test(name) || /^[a-z]:[/\\]/i.test(name)) return hoverDetail(written);
  const separator = from.includes('\\') ? '\\' : '/';
  const at = from.split(/[\\/]/).slice(0, -1);
  for (const part of name.split(/[\\/]/)) {
    if (part === '.' || part === '') continue;
    if (part === '..') at.pop();
    else at.push(part);
  }
  return hoverDetail(at.join(separator) + written.slice(name.length));
}
// What the card is raised over: a link the app can follow, or one `decorate.js` marked as going nowhere. A reader hovering a dead link is owed the reason rather than silence.
const HOVERABLE_LINK = 'a[href], a.link-goes-nowhere';
// The card's words for a link the sanitizer took the address off. The address itself is gone by the time the page sees it, so the card says what kind of thing was written rather than what it said.
const LINK_GOES_NOWHERE = { kind: 'Goes nowhere', detail: 'Written with an address this app does not follow' };
function linkGoesNowhere(link) {
  return Boolean(link && link.classList && link.classList.contains('link-goes-nowhere'));
}
// The path inside a `file:` address, the way the host reads one back: a drive letter stands on its own, and everything else keeps the slash at the front of it.
function localPathFromFileHref(href) {
  const path = String(href).replace(/^file:\/\/\/?/i, '');
  return /^[a-z](?::|%3a)[/\\]/i.test(path) ? path : '/' + path;
}
function startLinkHover(event) {
  const link = event.target.closest(HOVERABLE_LINK);
  if (!link) return;
  recordLinkHoverPoint(event);
  if (link === activeHoverLink) {
    linkHoverPointer = event;
    positionLinkHoverTip(event);
    return;
  }
  const rawHref = (link.getAttribute('href') || '').trim();
  const info = linkGoesNowhere(link) ? LINK_GOES_NOWHERE : linkHoverInfo(rawHref);
  if (!info) {
    hideLinkHoverTip();
    return;
  }
  if (linkHoverPreviewTimer) window.clearTimeout(linkHoverPreviewTimer);
  linkHoverPreviewTimer = 0;
  activeHoverLink = link;
  linkHoverPointer = event;
  linkHoverTipKind.textContent = info.kind;
  linkHoverTipDetail.textContent = info.detail;
  const token = ++activeHoverToken;
  setLinkHoverLines(null);
  const entry = info.kind === 'Glossary entry';
  linkHoverEntry = entry;
  // A link to the whole glossary is a file rather than one entry, so it draws with the page thumbnail's shrink and is counted like any other page.
  if (entry || info.kind === 'Another page' || info.kind === 'Full glossary') {
    // A drawing's link answers an object here where an ordinary one answers text, and the host drops a message whose address is not a string. A glossary link goes as it was written instead: the scheme carries the term, and a relative address read back off the page resolves against the page rather than against the document the host joins it onto.
    const key = entry ? rawHref : (typeof link.href === 'string' && link.href) || rawHref;
    if (linkPreviewCache.has(key)) {
      // Seen already: straight back up rendered, so a return to a link never blinks its spinner — and a page the host could not draw raises no box at all.
      applyLinkHoverPreview(linkPreviewCache.get(key));
    } else {
      showLinkHoverPreviewPlaceholder();
      requestLinkPreview(key, token);
    }
    // A term is the one link with no count: the number would be the whole glossary's above three blocks of one entry. A link to the whole glossary is that file, so its count is the file's and right.
    if (!entry) {
      if (lineCountCache.has(key)) {
        setLinkHoverLines(lineCountCache.get(key));
      } else {
        pendingLineTokens.set(token, key);
        send({ command: 'countLines', href: key, token });
      }
    }
  } else {
    hideLinkHoverPreview();
  }
  showLinkHoverTip(event);
}
// A leave never hides on its own word: one frame later the link under the pointer decides — the active one stays, another takes the card over, none at all hides it.
function endLinkHover(event) {
  if (!activeHoverLink) return;
  const leaving = event.target.closest && event.target.closest(HOVERABLE_LINK);
  if (leaving !== activeHoverLink) return;
  recordLinkHoverPoint(event);
  // No destination at all: the pointer left the window, or the link left the page.
  if (!event.relatedTarget) {
    hideLinkHoverTip();
    return;
  }
  const wasActive = activeHoverLink;
  if (linkHoverLeaveFrame) window.cancelAnimationFrame(linkHoverLeaveFrame);
  linkHoverLeaveFrame = requestAnimationFrame(() => {
    linkHoverLeaveFrame = 0;
    // A newer hover owns the card now; its own leave will settle it.
    if (activeHoverLink !== wasActive) return;
    const target = document.elementFromPoint && document.elementFromPoint(linkHoverClientX, linkHoverClientY);
    const link = target && target.closest && target.closest(HOVERABLE_LINK);
    if (link === activeHoverLink) return;
    if (link) {
      // A plain object, not a copied event: a pointer event's coordinates do not survive a copy.
      startLinkHover({ target: link, clientX: linkHoverClientX, clientY: linkHoverClientY });
      return;
    }
    hideLinkHoverTip();
  });
}
linkHoverCardReady = true;
if (canHoverLinks) {
  document.addEventListener('pointerover', startLinkHover);
  document.addEventListener('pointermove', (event) => {
    recordLinkHoverPoint(event);
    if (!activeHoverLink) return;
    linkHoverPointer = event;
    positionLinkHoverTip(event);
  });
  document.addEventListener('pointerout', endLinkHover);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideLinkHoverTip();
  });
  window.addEventListener('blur', hideLinkHoverTip);
  app.addEventListener('scroll', hideLinkHoverTip, true);
}
// The parsed glossary document, cached between calls keyed by the exact html the host sent — parsing the (often huge) glossary into a DOM to lift one entry is the dominant cost of opening the sheet. A different glossary reparses once; documentSectionBlocks only reads, so sharing is safe.
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
  const entry = documentSectionBlocks(glossaryParsedRoot, anchor);
  if (!entry) {
    glossarySheetMessage(`No glossary entry for “${anchor}”.`);
    showGlossary();
    return;
  }
  glossarySheetBody.innerHTML = '';
  // Copies, because the parsed document is kept for the next lookup and the sheet would otherwise empty it.
  for (const block of entry) glossarySheetBody.appendChild(block.cloneNode(true));
  glossarySheetBody.scrollTop = 0;
  showGlossary();
};
// One delegated click listener for every document link, bound once — binding each link separately costs a major slice of open time on large documents. Delegation also handles links added later (the async pager) with no rebinding.
let documentLinksBound = false;
// A link the app itself follows: one inside the document being read, or one inside the copy of a table put on the whole window. That copy sits beside the document in `#app` rather than inside it, so a click the second test misses is the web view's — and the re-render a finished load brings then rewrites `#app`, taking the sheet with it. The minimap's clone keeps the class but has its hrefs stripped and takes no pointer events.
function documentLinkFor(target) {
  const link = target && target.closest ? target.closest('a[href]') : null;
  if (!link || !app.contains(link)) return null;
  return link.closest('.document-body') || link.closest('.table-sheet-overlay') ? link : null;
}
// Hold this and the link opens as a page behind the one you are reading: Cmd on a Mac, where Ctrl is already the right-click, and Ctrl everywhere else.
function newPageModifierHeld(event) {
  return isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
// Whether a link names a file on this machine, whichever way a click opens it. Reveal file and Copy path act on the file rather than on where the click sends you, so they are the two items this gates rather than `isAnotherPageHref`.
function linkHasAFileBehindIt(rawHref) {
  const kind = linkHoverKind(rawHref);
  return kind === 'Another page' || kind === 'Opens in another app';
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
  // A term rises over the full-window table, so the table stays. Everything else leaves it behind — even a jump inside this document, which scrolls a page nobody can see under the sheet — so the table goes first, the way "Open the full glossary" drops its own sheet. A page opened behind is the reader choosing to stay here, so the table stays with them.
  if (!newPage) closeTableSheet();
  const fragmentHref = sameDocumentFragmentHref(rawHref);
  if (fragmentHref) {
    send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });
    return;
  }
  // As written, never the form the browser resolved: a site is one page, so a resolved href names a document at the top of it rather than one beside the document being read. Both hosts resolve a written href against the open document.
  //
  // Following a link is a step in. A page opened behind is not: nothing on screen changes, so a word written for it would move whatever render came next.
  const away = () => {
    if (!newPage) setNavigationDirection('forward');
    send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });
  };
  // Resolving the path is what puts a program one click away, so a link naming one asks first — in the box the app already asks before it deletes a file.
  if (linkRunsAProgram(rawHref)) {
    openConfirm(`Run “${fileBaseName(strippedHref(rawHref))}”?`, 'This link starts a program rather than opening a document. Only run it if you trust where this file came from.', 'Run', away);
    return;
  }
  away();
}
// What the system runs rather than opens, per platform, and the page's own list — `format.rs` answers the other question, which is what the app itself can read. A note travels in a zip, a clone or a shared vault, so a link that looks like every other link is one click from starting whatever sits beside it.
const WINDOWS_RUNS_THESE = ['bat', 'cmd', 'com', 'cpl', 'exe', 'hta', 'jar', 'js', 'jse', 'lnk', 'msc', 'msi', 'msp', 'pif', 'ps1', 'reg', 'scr', 'vb', 'vbe', 'vbs', 'wsf', 'wsh'];
const MAC_RUNS_THESE = ['app', 'command', 'jar', 'pkg', 'scpt', 'sh', 'tool', 'workflow'];
// The href with its heading and its query off, which is where the file's own name ends.
function strippedHref(rawHref) {
  return String(rawHref || '').split(/[#?]/)[0];
}
// True for a local link whose file the system would run. An href naming a scheme of its own is that handler's, not a file beside the note — except `file:`, which names one.
function linkRunsAProgram(rawHref) {
  const href = String(rawHref || '').trim();
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]+:/i.test(href) && !/^file:/i.test(href)) return false;
  const name = strippedHref(href);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return (isMacPlatform ? MAC_RUNS_THESE : WINDOWS_RUNS_THESE).includes(name.slice(dot + 1).toLowerCase());
}
