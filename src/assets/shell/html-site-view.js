// An HTML file's reading view is the page its own CSS draws, inside a frame of its own. There is nothing to press and nothing to turn off: the source view is still where the file is edited, and this is what a reader sees.
//
// The page rides in the frame's `srcdoc` rather than being served from an address. The app shell is loaded with `with_html`, so its own address is `about:blank` and its origin is opaque — nothing served from any address is same-origin with it, and a frame pointing at one answers `contentDocument` as null. Inlined, the frame keeps the shell's own origin, which is the only reason Find, the outline, the minimap, the menu and the selection can be bridged into it at all.
//
// `sandbox="allow-same-origin"` is the frame's only grant. Without `allow-scripts` the page runs nothing, and the host's sanitizer took every script out before the page was prepared, so the two hold the same line from opposite sides. The page also carries a policy of its own, which is additive with the shell's: a contained page can only ever be tighter than the app page, never looser.
//
// What the bridge is: the reader's own features ask this file for the drawn document rather than reaching for `.document-body` themselves, and the frame's own document carries the click, middle-click and right-click listeners the app page's `document` would otherwise never see, because an event inside a frame does not leave it.

// The frame the reading view draws a whole HTML page in. Keyed on the article's own class rather than on the tag, so nothing else a document happens to hold can answer for the page.
const SITE_FRAME_SELECTOR = '.document-body-site > .document-site';

// Where the reader was in each contained page, by path. A frame taken out of the page and put back — a tab switch, a live reload — loads its document again from scratch, so the place has to be remembered out here rather than left in a document that is about to be thrown away.
const siteFrameScrollTops = new Map();
// The contained document this file has already put its listeners on. A document, not a frame: the frame outlives its own page.
let siteFrameListening = null;
// Which document the frame on screen is showing, so a scroll is remembered against the right file.
let siteFramePath = null;

// The frame the open document is drawn in, or nothing where the document is not a whole page.
function documentSiteFrame(root = app) {
  return root && root.querySelector ? root.querySelector(SITE_FRAME_SELECTOR) : null;
}

// The contained page's own document, once the frame has one. Nothing while it is still arriving, and nothing for every format that is not a whole HTML page.
function siteFrameDocument(root = app) {
  const frame = documentSiteFrame(root);
  if (!frame) return null;
  try {
    return frame.contentDocument || null;
  } catch (error) {
    return null;
  }
}

// What the reader's own features treat as the drawn document: the contained page where there is one, and the article Leaftext drew otherwise. Every feature that reads the page goes through here, so there is one answer to "which document" rather than one per fragment.
function readingDocumentRoot(root = app) {
  const page = siteFrameDocument(root);
  if (page && page.body) return page.body;
  return root && root.querySelector ? root.querySelector('.document-body') : null;
}

// What scrolls the drawn document. The frame is the page's viewport and scrolls itself, so `100vh`, a sticky header and every media query answer the way they do in a browser tab — which also means the reader shell underneath it never scrolls at all.
function siteFrameScroller(root = app) {
  const page = siteFrameDocument(root);
  return page ? page.scrollingElement || page.body : null;
}

// What the reader's scroll is read from and written to. The frame is the page's viewport, so a contained page's place is inside it and the shell around it never moves at all.
function readerScrollElement() {
  return siteFrameScroller() || app;
}

// Whether the open document is drawn as a page of its own.
function readingIsContainedPage(root = app) {
  return !!documentSiteFrame(root);
}

// A link inside the contained page. The app page's own test asks whether the link sits inside `#app`, which nothing in another document does.
function containedPageLinkFor(target) {
  return target && target.closest ? target.closest('a[href]') : null;
}

// The words highlighted inside the contained page, exactly as selected. The frame keeps its own selection, so the app page's is empty the whole time a reader has words picked out in a saved site.
function containedPageSelectionText(page) {
  const view = page.defaultView;
  const selection = view && view.getSelection ? view.getSelection() : null;
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  return selection.toString();
}

function containedPageCanvasColor(page) {
  const view = page.defaultView;
  if (!view || !view.getComputedStyle || !page.documentElement || !page.body || !page.createElement) return null;
  const probe = page.createElement('i');
  probe.style.setProperty('position', 'fixed', 'important');
  probe.style.setProperty('width', '1px', 'important');
  probe.style.setProperty('height', '1px', 'important');
  probe.style.setProperty('background', 'Canvas', 'important');
  page.body.appendChild(probe);
  let layers;
  try {
    layers = [page.documentElement, page.body, probe].map((element) => {
      const style = view.getComputedStyle(element);
      if (style.backgroundImage && style.backgroundImage !== 'none') return null;
      return colorRgb(style.backgroundColor || '');
    });
  } finally {
    probe.remove();
  }
  let painted = [0, 0, 0, 0];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (!layer || layer[3] <= 0) continue;
    const alpha = layer[3] + painted[3] * (1 - layer[3]);
    painted = [
      (layer[0] * layer[3] + painted[0] * painted[3] * (1 - layer[3])) / alpha,
      (layer[1] * layer[3] + painted[1] * painted[3] * (1 - layer[3])) / alpha,
      (layer[2] * layer[3] + painted[2] * painted[3] * (1 - layer[3])) / alpha,
      alpha,
    ];
  }
  if (painted[3] < 1) return null;
  return `rgb(${painted.slice(0, 3).map(Math.round).join(', ')})`;
}

function applyContainedPageTabPalette(page) {
  const fill = containedPageCanvasColor(page);
  if (!fill) return;
  const root = document.documentElement;
  const ink = colorContrast(fill, '#000') >= colorContrast(fill, '#fff') ? '#000' : '#fff';
  root.style.setProperty('--tab-page-fill', fill);
  root.style.setProperty('--tab-page-ink', ink);
}

// Where a point inside the contained page is on the app's own page, so a menu opens under the pointer rather than at the top-left of the window.
function siteFramePointOnPage(event) {
  const frame = documentSiteFrame();
  if (!frame) return { x: event.clientX, y: event.clientY };
  const box = frame.getBoundingClientRect();
  return { x: box.left + event.clientX, y: box.top + event.clientY };
}

// Remember where the reader is in the contained page, against the file it belongs to.
function rememberSiteFrameScroll() {
  const scroller = siteFrameScroller();
  if (!scroller || !siteFramePath) return;
  siteFrameScrollTops.set(siteFramePath, scroller.scrollTop);
}

// Put the reader back where they were in this file, if they have been here.
function restoreSiteFrameScroll() {
  const scroller = siteFrameScroller();
  if (!scroller || !siteFramePath) return;
  const at = siteFrameScrollTops.get(siteFramePath);
  if (typeof at === 'number' && at > 0) scroller.scrollTop = at;
}

// The three ways a link is followed, put on the contained document rather than on the app page's, because a click inside a frame never reaches the page around it. Each one hands the address to the app's own link path, which is what decides between another document and the machine's browser — the frame itself never navigates.
function bindContainedPageLinks(page) {
  page.addEventListener('click', (event) => {
    const link = containedPageLinkFor(event.target);
    if (!link || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    if (followContainedPageFragment(page, link.getAttribute('href') || '')) return;
    sendDocumentLink(link, newPageModifierHeld(event));
  });
  page.addEventListener('auxclick', (event) => {
    const link = event.button === 1 ? containedPageLinkFor(event.target) : null;
    if (!link || !isAnotherPageHref(link.getAttribute('href'))) return;
    event.preventDefault();
    sendDocumentLink(link, true);
  });
  page.addEventListener('mousedown', (event) => {
    const link = event.button === 1 ? containedPageLinkFor(event.target) : null;
    if (link && isAnotherPageHref(link.getAttribute('href'))) event.preventDefault();
  });
  // The hover card is drawn on the app's page and placed at the pointer, so a pointer inside the frame is carried out in the app's own coordinates. Forwarded rather than re-dispatched: the card reads the target and the point and nothing else off the event, and an event made in one document cannot be raised in another.
  const carried = (event) => {
    const at = siteFramePointOnPage(event);
    return { target: event.target, relatedTarget: event.relatedTarget, clientX: at.x, clientY: at.y };
  };
  page.addEventListener('pointerover', (event) => startLinkHover(carried(event)));
  page.addEventListener('pointermove', (event) => moveLinkHover(carried(event)));
  page.addEventListener('pointerout', (event) => endLinkHover(carried(event)));
}

// A link to somewhere in the same page is followed inside the page, and never handed to the host. The host resolves a fragment against the document Leaftext drew, which for a contained page is the frame and not the words — so every in-page link on a saved site did nothing at all. Setting the frame's own hash is what a browser does with one, and it is the whole of it: the page scrolls to the element, and `:target` starts matching, which is how a one-file prototype shows one screen at a time.
function followContainedPageFragment(page, rawHref) {
  const fragment = sameDocumentFragmentHref(String(rawHref).trim());
  if (!fragment) return false;
  const view = page.defaultView;
  if (!view) return false;
  view.location.hash = fragment;
  return true;
}

// The right-click menu, on the contained page's own terms: the link under the pointer, then the picture, then the page itself. The same three the app page answers with, in the same order, because a reader right-clicking a saved site means what they mean anywhere else.
function bindContainedPageMenu(page) {
  page.addEventListener('contextmenu', (event) => {
    const at = siteFramePointOnPage(event);
    const link = containedPageLinkFor(event.target);
    if (link) {
      event.preventDefault();
      showContextMenu(at.x, at.y, (link.getAttribute('href') || '').trim(), 'link', link);
      return;
    }
    const picture = event.target.closest ? event.target.closest('img') : null;
    if (picture) {
      event.preventDefault();
      showContextMenu(at.x, at.y, picture.getAttribute('src') || '', 'picture', null, picture);
      return;
    }
    event.preventDefault();
    showContextMenu(at.x, at.y, activeDocumentPath(), 'page');
  });
}

// The contained page has arrived: bind what only exists once it has a document, then re-run every reader feature that asked the empty frame a question while it was still parsing.
function siteFrameReady() {
  const page = siteFrameDocument();
  if (!page || !page.body) return;
  applyContainedPageTabPalette(page);
  if (siteFrameListening !== page) {
    siteFrameListening = page;
    bindContainedPageLinks(page);
    bindContainedPageMenu(page);
    // Scroll on a document's own scroller reaches the document, which is the one element that outlives every element in the page.
    page.addEventListener('scroll', rememberSiteFrameScroll, { passive: true });
  }
  restoreSiteFrameScroll();
  // The keyboard scrolls whatever has focus, and the shell underneath the frame does not scroll at all — so the page is where the keys have to land for Page Down to mean what it means in a browser tab.
  if (page.body.focus) {
    page.body.tabIndex = -1;
    page.body.focus({ preventScroll: true });
  }
  // Each of these read an empty frame during the render, which is a page with no words, no headings and no rail.
  forgetRenderedText();
  publishDocumentOutline();
  applySpeedReaderToDocument();
  invalidateMinimapPreview();
  scheduleMinimapPreviewUpdate();
}

// A document embedded in somebody else's page has its neighbors beside itself, and only this page knows the address it was fetched into — the host that prepared the page has no disk and no served folder to name. So the base is written here, and only here: the desktop's page already carries one, and a page with nothing to resolve against is left as it is rather than given an address that resolves to the app itself.
//
// Written before the frame has parsed, so its own page is the one that carries it. Setting the attribute again is what starts that parse, which is why nothing else may have been done to the frame first.
function fillContainedPageBase(frame) {
  const page = frame.getAttribute('srcdoc') || '';
  if (!page || page.includes('<base ')) return;
  const at = document.baseURI;
  if (!at || at === 'about:blank' || at.startsWith('about:')) return;
  const held = String(at).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  frame.setAttribute('srcdoc', page.replace('</head>', `<base href="${held}"></head>`));
}

// Called by the renderer once the document is on the page. A frame that is not there clears the record, so a Markdown note after an HTML page is not read as a contained one.
function bindDocumentSiteFrame(path) {
  document.documentElement.style.removeProperty('--tab-page-fill');
  document.documentElement.style.removeProperty('--tab-page-ink');
  const frame = documentSiteFrame();
  if (!frame) {
    siteFrameListening = null;
    siteFramePath = null;
    return;
  }
  fillContainedPageBase(frame);
  siteFramePath = path || activeDocumentPath();
  frame.addEventListener('load', siteFrameReady);
  // A frame whose page has already been parsed raises no load this would hear.
  const page = siteFrameDocument();
  if (page && page.readyState === 'complete') siteFrameReady();
}

// The page as it goes out as a file: the contained page's own markup, because the page is the page. Nothing of Leaftext's is wrapped around it — a saved site exported through the app is that site, not a screenshot of the app holding it.
function containedPageExportMarkup() {
  const page = siteFrameDocument();
  const root = page && page.documentElement;
  return root ? `<!doctype html>${root.outerHTML}` : '';
}

// A sheet measured or rendered while the frame stands at the reader's own height is one screen of a page that may be many, so the frame is grown to its content for as long as the paper hold lasts and put back after. It rides on the hold rather than on the measurement or the render, because both raise the same hold and the render is the one this file never sees.
const siteFramePaperHold = window.leafHoldAppearance;
let siteFrameHeldHeight = null;
window.leafHoldAppearance = (held) => {
  const frame = documentSiteFrame();
  const page = siteFrameDocument();
  if (frame && page && page.documentElement) {
    if (held && siteFrameHeldHeight === null) {
      siteFrameHeldHeight = frame.style.height;
      frame.style.height = `${page.documentElement.scrollHeight}px`;
    } else if (!held && siteFrameHeldHeight !== null) {
      frame.style.height = siteFrameHeldHeight;
      siteFrameHeldHeight = null;
    }
  }
  // The hold itself is the theme bootstrap's, which runs in the page's head before this script. A host that serves its own page without it has nothing to pass the hold on to, and the frame still grows.
  if (typeof siteFramePaperHold === 'function') siteFramePaperHold(held);
};
