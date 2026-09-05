// A whole HTML file drawn as the page its own CSS makes: what the reader gets, and what the reader's own features do about a document that is not in this page at all.

import vm from 'node:vm';
import { check, readingCss, record, runShell, source } from './shared.mjs';

const PAGE = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body><h1>A saved page</h1><h2>Its second heading</h2><p>Words in somebody else\'s document.</p><a href="./next.html">Onward</a></body></html>';

/** The article the host renders for an HTML file: an empty frame carrying the whole page in an attribute. */
function siteArticle(page = PAGE) {
  const held = page.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<article class="document-body document-body-site"><iframe class="document-site" sandbox="allow-same-origin" title="A saved page" srcdoc="${held}"></iframe></article>`;
}

/** A document, a heading and a link, standing in for what a frame's own page would hold. The fake page has no frames, so the one thing a real web view gives us — a second document behind `contentDocument` — is built here. */
function containedDocument(context, frame) {
  const make = (tag, className) => {
    const element = context.document.createElement(tag);
    if (className) element.className = className;
    return element;
  };
  const body = make('div', 'contained-body');
  const first = make('h1');
  first.textContent = 'A saved page';
  const second = make('h2');
  second.textContent = 'Its second heading';
  const words = make('p');
  words.textContent = "Words in somebody else's document.";
  const link = make('a');
  link.setAttribute('href', './next.html');
  link.textContent = 'Onward';
  const inside = make('a');
  inside.setAttribute('href', '#screen-2');
  inside.textContent = 'The next screen';
  const picture = make('img');
  picture.setAttribute('src', 'assets/diagram.png');
  [first, second, words, link, inside, picture].forEach((child) => body.appendChild(child));
  body.scrollHeight = 4000;
  body.clientHeight = 800;
  body.scrollTop = 0;

  const listeners = new Map();
  const page = {
    readyState: 'complete',
    body,
    // The root a real frame's page carries: its height is what the paper hold grows the frame to, and its markup is the whole of what the export writes out as the file.
    documentElement: {
      scrollHeight: 4000,
      get outerHTML() {
        return `<html><head></head>${body.outerHTML}</html>`;
      },
    },
    scrollingElement: body,
    // A frame's own address, which is what an in-page link is followed by: setting the hash is what scrolls the page and starts `:target` matching. The selection is the frame's own too, and a test that gives the reader words to copy writes it here.
    defaultView: {
      getSelection: () => page.selection,
      location: { hash: '' },
    },
    selection: { isCollapsed: true, rangeCount: 0, toString: () => '' },
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: (kind, handler) => {
      if (!listeners.has(kind)) listeners.set(kind, []);
      listeners.get(kind).push(handler);
    },
    raise: (kind, event) => (listeners.get(kind) || []).forEach((handler) => handler(event)),
  };
  frame.contentDocument = page;
  return page;
}

/** A page with one HTML file open on it, its frame already carrying a document. */
function bootContainedPage(options = {}) {
  const sent = [];
  const context = runShell(source, { ipc: { postMessage: (text) => sent.push(JSON.parse(text)) } });
  const app = context.document.getElementById('app');
  const path = 'C:\\Notes\\saved.html';
  context.window.leafSetState({
    recent: [],
    favorites: [],
    tabs: [{ title: 'saved', path }],
    active: 0,
    document: {
      title: 'A saved page',
      path,
      html: siteArticle(options.page),
      has_visible_content: true,
      format: 'Html',
      blocks: [],
      tasks: [],
      source: options.page || PAGE,
    },
  });
  const frame = app.querySelector('.document-body-site > .document-site');
  // The frame stands where the reader's stage stands, so a point inside the page has somewhere to be carried out to.
  if (frame) frame.getBoundingClientRect = () => ({ top: 120, left: 300, right: 1100, bottom: 920, width: 800, height: 800 });
  const page = frame ? containedDocument(context, frame) : null;
  // The renderer bound the frame while it was still empty, which is what happens in the window too: the page arrives afterwards and raises its own load.
  if (frame) vm.runInContext('siteFrameReady()', context);
  return { context, app, frame, page, sent, path };
}

/** A page with an ordinary note open on it, to compare the bar against. */
function bootMarkdown() {
  const context = runShell(source);
  const path = 'C:\Notes\one.md';
  context.window.leafSetState({
    recent: [],
    favorites: [],
    tabs: [{ title: 'one', path }],
    active: 0,
    document: {
      title: 'one',
      path,
      html: '<article class="document-body"><h1>A note</h1></article>',
      has_visible_content: true,
      format: 'Markdown',
      blocks: [],
      tasks: [],
      source: '# A note',
    },
  });
  return { context };
}

/** Every control the bar is showing, named and in order, so two bars can be compared as one string. */
function barControls(context) {
  const bar = context.document.getElementById('readerToolbar');
  const named = [];
  (function walk(node) {
    for (const child of node.children) {
      if (child.id && !child.hidden) named.push(child.id);
      walk(child);
    }
  })(bar);
  return named.join(',');
}

export function run() {
  if (!record.booted) return;

  // The reading view of an HTML file is the page, and that is the whole of it: no switch, no row in the tray, nothing remembered. The bar an HTML file gets is the bar every document gets.
  check('an HTML page is drawn in a frame and adds no control to the bar', () => {
    const { app, frame, context } = bootContainedPage();
    if (!frame) throw new Error('an HTML file drew no contained page');
    const article = app.querySelector('.document-body-site');
    if (article.children.length !== 1 || article.children[0] !== frame) {
      throw new Error('something else was drawn beside the page');
    }
    if (frame.getAttribute('sandbox') !== 'allow-same-origin') {
      throw new Error(`the frame's grant is ${frame.getAttribute('sandbox')}`);
    }
    // Against a note rather than against a written-down list: the claim is that an HTML file brings no control of its own, so the bar a note gets is the thing to compare with. Nothing it has that the note has not — a tool the note has and this file does not is a tool with nothing to do on a page drawn in its own frame, which is the check below.
    const note = barControls(bootMarkdown().context).split(',');
    const extra = barControls(context).split(',').filter((one) => one && !note.includes(one));
    if (extra.length) {
      throw new Error(`an HTML file brought ${extra.join(',')} that a note does not have`);
    }
  });

  // The tray's nub says where a view's tools went, so a tray with nothing in it is a promise with nothing behind it. On a contained page the padlock has nothing to bind to and the speed reader is refused, which empties the reading view's recess — while the source view of the same file still has both its padlock and its typing help.
  check('the reading view of a page in its own frame leaves no nub', () => {
    const { context } = bootContainedPage();
    const tray = context.document.getElementById('readerToolTray');
    const tools = context.document.getElementById('readerViewTools');
    if (!tray.hidden) throw new Error('the nub stood over the bar with nothing in the tray');
    if (!tools.hidden) throw new Error('the recess stayed open on a view with no tools');
    const showing = [...tools.children].filter((tool) => !tool.hidden).map((tool) => tool.id);
    if (showing.length) throw new Error(`${showing.join(',')} was still standing in the recess`);
    vm.runInContext("renderViewTools('code')", context);
    if (tray.hidden) throw new Error('the source view of the same file lost its nub too');
    const inSource = [...tools.children].filter((tool) => !tool.hidden).map((tool) => tool.id).join(',');
    if (!inSource.includes('readerLockButton') || !inSource.includes('codeIntelButton')) {
      throw new Error(`the source view's recess holds ${inSource || 'nothing'}`);
    }
  });

  // A frame is a document of its own, so a page-wide rule in somebody else's file reaches nothing of Leaftext's. What proves it here is that no tag out of that file is in this page at all: it rides in an attribute and is parsed on the other side of the frame.
  check('a page-wide selector in the file cannot reach the app around it', () => {
    const { app, context } = bootContainedPage({
      page: '<style>* { display: none } .reader-tool, .library-pane { background: red }</style><p>Words</p>',
    });
    const inside = app.querySelectorAll('p').length + app.querySelectorAll('style').length;
    if (inside !== 0) throw new Error(`${inside} of the file's own elements were drawn into the app page`);
    const bar = context.document.getElementById('readerToolbar');
    if (bar.hidden) throw new Error('the bar went with the page it does not belong to');
  });

  // Find searches the drawn document, and the drawn document is now inside the frame. The same answer the outline reads.
  check('Find and the outline reach the contained document', () => {
    const { context, page } = bootContainedPage();
    const found = vm.runInContext('findRenderedBody()', context);
    if (found !== page.body) throw new Error('Find is still searching the article around the page');
    const rows = vm.runInContext('documentOutlineRows.map((row) => row.text).join(" | ")', context);
    if (!rows.includes('A saved page') || !rows.includes('Its second heading')) {
      throw new Error(`the outline read ${rows || 'nothing'} out of the contained page`);
    }
  });

  // A link inside the file goes where every other link in the app goes: the host decides between a document and the machine's browser. The frame itself never navigates, which is why the click is canceled first.
  check('a link in the page leaves through the app rather than navigating the frame', () => {
    const { page, sent } = bootContainedPage();
    const link = page.querySelector('a');
    let canceled = false;
    page.raise('click', {
      target: link,
      button: 0,
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {
        canceled = true;
      },
    });
    if (!canceled) throw new Error('the click was left for the frame to follow');
    const opened = sent.filter((one) => one.command === 'openLink');
    if (opened.length !== 1 || !String(opened[0].href).includes('next.html')) {
      throw new Error(`the app was sent ${JSON.stringify(sent)}`);
    }
  });

  // A link to somewhere in the same page is the whole of how a one-file prototype works, and the host cannot follow one: it resolves a fragment against the document Leaftext drew, which for a contained page is the frame and not the words.
  check('an in-page link is followed inside the page', () => {
    const { page, sent } = bootContainedPage();
    const link = page.querySelector('a[href="#screen-2"]');
    let canceled = false;
    page.raise('click', {
      target: link,
      button: 0,
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {
        canceled = true;
      },
    });
    if (!canceled) throw new Error('the click was left for the frame to follow');
    if (page.defaultView.location.hash !== '#screen-2') {
      throw new Error(`the page went to ${page.defaultView.location.hash || 'nowhere'}`);
    }
    if (sent.some((one) => one.command === 'openLink')) {
      throw new Error(`the app was asked to open ${JSON.stringify(sent)}`);
    }
  });

  // A page is a page: it stops at the edge of the window it is in, so the lane's own side padding — which every other format wants, being a column of words — goes for this one.
  check('the page fills the reader lane left to right', () => {
    const css = readingCss();
    const at = css.indexOf('.reader-layout:has(.document-body-site) {');
    if (at < 0) throw new Error('the lane still holds the page off its own edges');
    const rule = css.slice(at, css.indexOf('}', at));
    if (!/--reader-layout-padding-inline:\s*0px/.test(rule)) {
      throw new Error(`the lane's padding for a contained page is ${rule}`);
    }
  });

  // A sheet measured while the frame stands at the reader's own height is one screen of a page that may be many. The hold is what both the measurement and the render raise, so the frame grows on the hold and goes back when it drops.
  check('the export grows the frame to the whole page and puts it back', () => {
    const { context, frame } = bootContainedPage();
    const before = frame.style.height;
    context.window.leafHoldAppearance(true);
    if (frame.style.height !== '4000px') {
      throw new Error(`the sheet would have been measured against ${frame.style.height || 'the stage'}`);
    }
    context.window.leafHoldAppearance(false);
    if (frame.style.height !== before) throw new Error('the frame stayed grown after the sheet was drawn');
  });

  // A published site names the folder it serves documents from, so the host writes the base. A document embedded in somebody else's page has no such folder — its neighbors sit beside it wherever the page was fetched into — and that address is one only this page knows.
  check('an embedded page is given the address it was fetched into', () => {
    const { context, app } = bootContainedPage({ page: '<!doctype html><html><head></head><body><p>Words</p></body></html>' });
    const frame = app.querySelector('.document-site');
    const carried = frame.getAttribute('srcdoc');
    // The fake page stands where the app shell stands: `about:blank`, which resolves nothing, so no base is written and the page is left as it was.
    if (carried.includes('<base ')) throw new Error('a page with nowhere to resolve against was given an address anyway');

    context.document.baseURI = 'https://somebody.example/docs/report/';
    vm.runInContext('fillContainedPageBase(document.querySelector(".document-site"))', context);
    const filled = frame.getAttribute('srcdoc');
    if (!filled.includes('<base href="https://somebody.example/docs/report/"></head>')) {
      throw new Error('the embedded page resolves its own neighbors against nothing');
    }

    // And never twice: the host already wrote one for a page whose folder it serves.
    vm.runInContext('fillContainedPageBase(document.querySelector(".document-site"))', context);
    const twice = frame.getAttribute('srcdoc').split('<base ').length - 1;
    if (twice !== 1) throw new Error(`the page carries ${twice} bases`);
  });

  // The page's stylesheet is inside the page, which is the whole point of a frame: it arrives as an attribute, is parsed on the other side, and the app page never holds a rule of it.
  check('a linked stylesheet lands in the page and nowhere else', () => {
    const { app } = bootContainedPage({
      page: '<link rel="stylesheet" href="assets/site.css"><p class="card">Words</p>',
    });
    if (app.querySelectorAll('link').length !== 0) throw new Error("the page's stylesheet was linked into the app");
    const frame = app.querySelector('.document-site');
    if (!(frame.getAttribute('srcdoc') || '').includes('assets/site.css')) {
      throw new Error('the page lost the stylesheet it asked for');
    }
  });

  // A media query inside the page measures the frame, and the frame is the reader's stage rather than the window. What decides that is the frame taking its width from the article around it and never from the window itself.
  check('the page is measured by the reader stage rather than by the window', () => {
    const css = readingCss();
    const rule = css.slice(css.indexOf('.document-site {'), css.indexOf('}', css.indexOf('.document-site {')));
    if (!rule.includes('width: 100%')) throw new Error('the contained page no longer fills the stage it is given');
    if (/\d(vw|vh|vmin|vmax)/.test(rule)) throw new Error('the frame takes a share of the window rather than of the stage');
  });

  // The frame's document is thrown away when the frame leaves the page, so where the reader was is remembered out here and put back when the page comes again.
  check('the reader comes back to the same place in the page', () => {
    const { context, page, path } = bootContainedPage();
    page.body.scrollTop = 1200;
    page.raise('scroll', {});
    page.body.scrollTop = 0;
    vm.runInContext('siteFrameReady()', context);
    if (page.body.scrollTop !== 1200) {
      throw new Error(`the reader came back at ${page.body.scrollTop} rather than where they were`);
    }
    const kept = vm.runInContext(`siteFrameScrollTops.get(${JSON.stringify(path)})`, context);
    if (kept !== 1200) throw new Error(`the place was kept as ${kept}`);
  });

  /** Right-click at a point in the contained page and answer what the reader's menu was asked to open. */
  function menuAskedFor(context, page, target, at = { clientX: 40, clientY: 60 }) {
    const was = context.showContextMenu;
    let asked = null;
    let canceled = false;
    try {
      context.showContextMenu = (x, y, path, kind, link, picture) => {
        asked = { x, y, path, kind, link, picture };
      };
      page.raise('contextmenu', {
        target,
        clientX: at.clientX,
        clientY: at.clientY,
        preventDefault: () => {
          canceled = true;
        },
      });
    } finally {
      context.showContextMenu = was;
    }
    return { asked, canceled };
  }

  // A right-click inside a saved site means what it means anywhere else in the app, and the frame's own web-view menu is never what the reader gets. The three kinds are the app page's three, in the app page's order.
  check('a right-click in the page opens the reader own menu on the link, the picture or the page', () => {
    const { context, page, path } = bootContainedPage();

    const onLink = menuAskedFor(context, page, page.querySelector('a'));
    if (!onLink.canceled) throw new Error('the web view was left to draw its own menu over a link');
    if (!onLink.asked || onLink.asked.kind !== 'link' || !String(onLink.asked.path).includes('next.html')) {
      throw new Error(`a right-click on a link asked for ${JSON.stringify(onLink.asked && onLink.asked.kind)} on ${onLink.asked && onLink.asked.path}`);
    }

    const onPicture = menuAskedFor(context, page, page.querySelector('img'));
    if (!onPicture.canceled) throw new Error('the web view was left to draw its own menu over a picture');
    if (!onPicture.asked || onPicture.asked.kind !== 'picture' || onPicture.asked.path !== 'assets/diagram.png') {
      throw new Error(`a right-click on a picture asked for ${JSON.stringify(onPicture.asked && onPicture.asked.kind)} on ${onPicture.asked && onPicture.asked.path}`);
    }

    // On the words, the menu is the open file's — the file the reader has open, not a document inside the frame, because the frame holds no file of its own.
    const onWords = menuAskedFor(context, page, page.querySelector('p'));
    if (!onWords.canceled) throw new Error('the web view was left to draw its own menu over the words');
    if (!onWords.asked || onWords.asked.kind !== 'page' || onWords.asked.path !== path) {
      throw new Error(`a right-click on the words asked for ${JSON.stringify(onWords.asked && onWords.asked.kind)} on ${onWords.asked && onWords.asked.path}`);
    }

    // The menu is drawn on the app's page, so a point inside the frame is carried out into the app's own coordinates or every menu opens near the top-left of the window.
    if (onWords.asked.x !== 340 || onWords.asked.y !== 180) {
      throw new Error(`the menu was opened at ${onWords.asked.x},${onWords.asked.y} rather than where the pointer was`);
    }
  });

  // Copy takes the words the reader picked out, and a contained page keeps its selection in its own document — the app page's is empty the whole time a reader is dragging across a saved site.
  check('the words picked out in the page are the words that get copied', () => {
    const { context, page } = bootContainedPage();
    if (vm.runInContext('selectionTextInReadingView()', context) !== '') {
      throw new Error('a page with nothing picked out answered with words anyway');
    }
    page.selection = { isCollapsed: false, rangeCount: 1, toString: () => "Words in somebody else's document." };
    const copied = vm.runInContext('selectionTextInReadingView()', context);
    if (copied !== "Words in somebody else's document.") {
      throw new Error(`copy would have taken ${JSON.stringify(copied)} out of the app page instead`);
    }
  });

  // The hover card is drawn on the app's page and placed at the pointer, so a rest on a link inside the frame is carried out in the app's own coordinates. Forwarded rather than re-dispatched: an event made in one document cannot be raised in another.
  check('a rest on a link in the page raises the reader own card', () => {
    const { context, page } = bootContainedPage();
    const link = page.querySelector('a');
    page.raise('pointerover', { target: link, relatedTarget: null, clientX: 40, clientY: 60 });
    const resting = vm.runInContext('activeHoverLink', context);
    if (resting !== link) throw new Error('a rest on a link inside the page raised no card');
    page.raise('pointermove', { target: link, relatedTarget: null, clientX: 50, clientY: 70 });
    const at = vm.runInContext('linkHoverPointer && [linkHoverPointer.clientX, linkHoverPointer.clientY].join(",")', context);
    if (at !== '350,190') throw new Error(`the card follows the pointer to ${at} rather than to where it is on the app page`);
    page.raise('pointerout', { target: link, relatedTarget: null, clientX: 50, clientY: 70 });
    if (vm.runInContext('activeHoverLink', context)) throw new Error('the card stayed up after the pointer left the link');
  });

  // The setting is saved and global, so a reader who turned it on over a note opens an HTML file with it already on. Splitting a word inside somebody else's layout makes two flex items out of it and the row's own gap opens in the middle of the word, and the bold lead never arrives in exchange, so the page must come through untouched.
  check('the speed reader leaves a page drawn in its own frame whole', () => {
    const { context, app, page } = bootContainedPage();
    vm.runInContext('setSpeedReaderEnabled(true)', context);
    try {
      if (page.body.dataset.speedReaderProcessed === 'true') {
        throw new Error('the speed reader walked the page the author wrote');
      }
      if (page.body.querySelectorAll('.speed-reader-anchor').length) {
        throw new Error('a word in the page came apart into two elements');
      }
      const article = app.querySelector('.document-body-site');
      if (article.dataset.speedReaderProcessed === 'true') {
        throw new Error('the speed reader treated the frame around the page');
      }
    } finally {
      vm.runInContext('setSpeedReaderEnabled(false)', context);
    }
  });

  // The guard is about the contained page and nothing else: every format Leaftext draws itself keeps the speed reader working exactly as it does today.
  check('an ordinary drawn document still gets the speed reader', () => {
    const { context } = bootMarkdown();
    vm.runInContext('setSpeedReaderEnabled(true)', context);
    try {
      const drawn = context.document.getElementById('app').querySelector('.document-body');
      if (drawn.dataset.speedReaderProcessed !== 'true') {
        throw new Error('the guard took the speed reader off a note as well');
      }
      if (!drawn.querySelectorAll('.speed-reader-anchor').length) {
        throw new Error('a note came through with no word split at all');
      }
    } finally {
      vm.runInContext('setSpeedReaderEnabled(false)', context);
    }
  });

  // The export is where the damage would leave the app: with the setting on, every span the pass wrote was written into the file the reader saved — Leaftext's own class names sprinkled through somebody else's page.
  check('an exported page carries none of the reader own word spans', () => {
    const { context } = bootContainedPage();
    vm.runInContext('setSpeedReaderEnabled(true)', context);
    try {
      const written = vm.runInContext('pageExportMarkup()', context);
      // Asked before the words are looked at, because an export that wrote nothing would carry no spans either and pass without proving a thing. The doctype rather than a sentence: a sentence is what comes apart when the pass has run, so it cannot be the proof that a page was written.
      if (!written.startsWith('<!doctype html>')) {
        throw new Error('the export wrote no page at all, so it proves nothing about what is in one');
      }
      if (written.includes('speed-reader-anchor')) {
        throw new Error('the saved file carries the app own word spans');
      }
      if (!written.includes('A saved page')) {
        throw new Error("the saved file has the page's own words broken up in it");
      }
    } finally {
      vm.runInContext('setSpeedReaderEnabled(false)', context);
    }
  });
}
