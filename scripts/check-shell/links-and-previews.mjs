// Links, the card a rest over one draws, and the preview a note link carries.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  checkSettled,
  fakeElement,
  names,
  record,
  root,
  settle,
  settled,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The ask pipe's reader half is one call into this function (`READER_STATE` in src/pipe.rs), so nothing else in the suite notices when an element it reads is renamed — the next `{"ask":"state","reader":true}` would be the first to find out, and what it loses is silent.
  check('the page can say what the reader sees', () => {
    const readerState = () => booted.window.leafReaderState();
    const state = readerState();
    for (const field of ['scrollTop', 'scrollHeight', 'viewportHeight', 'codeView', 'panels', 'selection', 'renderInFlight']) {
      if (!(field in state)) throw new Error(`the reader half has no ${field}`);
    }
    for (const field of ['scrollTop', 'scrollHeight', 'viewportHeight']) {
      if (!Number.isFinite(state[field])) throw new Error(`${field} came back ${state[field]}`);
    }
    for (const panel of ['library', 'map', 'findBar', 'glossary']) {
      if (typeof state.panels[panel] !== 'boolean') throw new Error(`${panel} is not open or shut, it is ${state.panels[panel]}`);
    }
    // Nothing is rendered on the fake page, so there is no block to be anchored to.
    if (state.anchor !== null) throw new Error(`an empty page claimed an anchor: ${JSON.stringify(state.anchor)}`);
    if (state.selection !== null) throw new Error(`nothing is selected, and it said ${JSON.stringify(state.selection)}`);

    // Each panel read off its own element, so a renamed id fails here rather than answering "shut" for ever.
    const spinner = booted.document.getElementById('readerLoading');
    const bar = booted.document.getElementById('findBar');
    const sheet = booted.document.getElementById('glossarySheet');
    const shell = booted.document.getElementById('libraryShell');
    const wasContains = shell.classList.contains;
    try {
      spinner.hidden = false;
      bar.hidden = false;
      sheet.hidden = false;
      shell.classList.contains = () => false;
      const open = readerState();
      if (!open.renderInFlight) throw new Error('a render in flight was reported as settled');
      if (!open.panels.findBar || !open.panels.glossary) throw new Error('an open panel was reported shut');
      if (!open.panels.library) throw new Error('the library pane was reported shut while it is open');

      spinner.hidden = true;
      bar.hidden = true;
      sheet.hidden = true;
      shell.classList.contains = (name) => name === 'library-closed';
      const shut = readerState();
      if (shut.renderInFlight) throw new Error('a settled page was reported as rendering');
      if (shut.panels.findBar || shut.panels.glossary) throw new Error('a shut panel was reported open');
      if (shut.panels.library) throw new Error('a closed library pane was reported open');
    } finally {
      shell.classList.contains = wasContains;
      spinner.hidden = false;
      bar.hidden = false;
      sheet.hidden = false;
    }
  });

  // A pager button opens a page, and three things have to agree about that: the card, the middle click and the menu. Only the card is ever handed the button, so the answer comes off the address — a `file://` URL, which the scheme branch would otherwise call an app command.
  check('a pager button is another page to the card, the middle click and the menu alike', () => {
    const { linkHoverInfo, linkHoverKind, isAnotherPageHref } = booted;
    const href = 'file:///docs/002-rains.md';
    const pager = linkHoverInfo(href);
    if (pager.kind !== 'Another page') throw new Error(`the card calls it ${pager.kind}`);
    if (pager.detail !== href) throw new Error(`the address moved: ${pager.detail}`);

    // The kind is what gates the line-count request, so this is also what puts a length on that card.
    if (linkHoverKind(href) !== 'Another page') throw new Error(`the menu reads a pager link as ${linkHoverKind(href)}`);
    if (!isAnotherPageHref(href)) throw new Error('a middle click on a pager button has nowhere to open');

    // An ordinary document link keeps the answer it has, and a file that is not a page is still not one.
    if (linkHoverInfo('notes/other.md').kind !== 'Another page') throw new Error('a plain link stopped being a page');
    // A `file:` address naming a file the app does not read is still a file on this disk, so it gets the words every other such file gets rather than being read as an app's own scheme.
    const picture = linkHoverInfo('file:///docs/logo.png');
    if (picture.kind !== 'Opens in another app') throw new Error(`a file the app cannot read is called ${picture.kind}`);
    if (picture.detail !== '/docs/logo.png') throw new Error(`the card shows ${picture.detail} rather than where the file is`);
  });

  // One word for a link this app hands to the machine, whichever way the address was written, and the address under it is where the file actually is — so two links to one PDF are not described two different ways, and a dead one can be told from a live one without clicking it.
  check('a link to a file the app does not read says a click opens it, and says where it is', () => {
    const { linkHoverInfo } = booted;
    // The card resolves against the document on screen, so the page has to be reading one.
    booted.__wasState = vm.runInContext('currentState', booted);
    vm.runInContext('currentState = { tabs: [{ path: "/notes/guide/chapter/README.md" }], active: 0 }', booted);
    try {
      const pdf = linkHoverInfo('./assets/Release Notes.pdf');
      if (pdf.kind !== 'Opens in another app') throw new Error(`a PDF beside the note is called ${pdf.kind}`);
      if (pdf.detail !== '/notes/guide/chapter/assets/Release Notes.pdf') {
        throw new Error(`the card shows ${pdf.detail} rather than where the file is`);
      }

      // A saved web page two folders up, which is the link the fault was reported on.
      const page = linkHoverInfo('../../designs/v3-00-map.html');
      if (page.kind !== 'Opens in another app') throw new Error(`a saved web page is called ${page.kind}`);
      if (page.detail !== '/notes/designs/v3-00-map.html') throw new Error(`the card shows ${page.detail}`);

      // The same file written from the top of the disk: one link, one word, and a whole path left alone.
      const rooted = linkHoverInfo('/notes/guide/chapter/assets/Release Notes.pdf');
      if (rooted.kind !== 'Opens in another app') throw new Error(`the same PDF written whole is called ${rooted.kind}`);
      if (rooted.detail !== '/notes/guide/chapter/assets/Release Notes.pdf') {
        throw new Error(`a whole path was joined onto the note's folder: ${rooted.detail}`);
      }

      // And the two items that act on the file rather than on where the click goes appear for all three.
      const { linkHasAFileBehindIt } = booted;
      for (const href of ['./assets/Release Notes.pdf', '../../designs/v3-00-map.html', './two.md']) {
        if (!linkHasAFileBehindIt(href)) throw new Error(`Reveal file and Copy path dropped off ${href}`);
      }
      for (const href of ['https://example.com/a.pdf', '#a-heading', 'mailto:a@b.test']) {
        if (linkHasAFileBehindIt(href)) throw new Error(`Reveal file and Copy path appeared on ${href}, which has no file behind it`);
      }
    } finally {
      vm.runInContext('currentState = __wasState', booted);
    }
  });

  // The sanitizer keeps the anchor and drops the address, so a link written with a scheme of its own arrives as words painted in the link color with nothing behind them. What tells one from a live link is a class the decoration pass writes, because an anchor with no address is not by itself a stripped link: a place in the page is one too.
  check('a link the sanitizer emptied is marked, and a live link and a place in the page are left alone', () => {
    const appEl = booted.document.getElementById('app');
    const body = fakeElement('');
    body.className = 'document-body';
    body.innerHTML =
      '<p><a href="notes/other.md">a live link</a><a href="https://example.test/">the web</a>' +
      '<a>an app of its own</a><a>a phone number</a>' +
      '<a name="waypoint"></a><a id="landing"></a>' +
      '<a class="leaf-md-button">a button with nothing behind it</a></p>';
    appEl.appendChild(body);
    try {
      booted.markLinksThatGoNowhere();
      const marked = body
        .querySelectorAll('a')
        .filter((link) => link.classList.contains('link-goes-nowhere'))
        .map((link) => link.textContent);
      if (marked.join(' | ') !== 'an app of its own | a phone number | a button with nothing behind it') {
        throw new Error(`the pass marked ${JSON.stringify(marked)}`);
      }
    } finally {
      body.remove();
    }
  });

  // The rail's thumbnail is a clone of the document with the address stripped off every link in it, live ones included — so a rule keyed on the missing address would paint every link in the rail dead. The pass is scoped to the reader's own document instead, and the thumbnail sits outside it.
  check('the rail’s copy of a live link carries no mark', () => {
    const appEl = booted.document.getElementById('app');
    const rail = booted.document.getElementById('readerMinimap');
    const body = fakeElement('');
    body.className = 'document-body';
    body.innerHTML = '<p><a href="notes/other.md">a live link</a><a>an app of its own</a></p>';
    const preview = fakeElement('');
    preview.className = 'document-body document-minimap-preview';
    // What the clone holds after `stripMinimapClone`: the same links with no address at all, the live one among them.
    preview.innerHTML = '<p><a>a live link</a><a>an app of its own</a></p>';
    appEl.appendChild(body);
    rail.appendChild(preview);
    try {
      booted.markLinksThatGoNowhere();
      const inRail = preview.querySelectorAll('a').filter((link) => link.classList.contains('link-goes-nowhere'));
      if (inRail.length) throw new Error(`the pass reached ${inRail.length} of the thumbnail's links`);
      const inDocument = body
        .querySelectorAll('a')
        .filter((link) => link.classList.contains('link-goes-nowhere'))
        .map((link) => link.textContent);
      if (inDocument.join(' | ') !== 'an app of its own') throw new Error(`the document itself was marked ${JSON.stringify(inDocument)}`);
    } finally {
      body.remove();
      preview.remove();
    }
  });

  // A silent refusal is the whole complaint, so the card has to speak for a link that goes nowhere. The address is gone by the time the page sees it, so the card says what was written rather than what it said.
  check('the card says a marked link goes nowhere', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const kind = vm.runInContext('linkHoverTipKind', booted);
    const detail = vm.runInContext('linkHoverTipDetail', booted);
    const dead = fakeElement('');
    dead.tagName = 'A';
    dead.classList.add('link-goes-nowhere');
    dead.getBoundingClientRect = () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 });
    dead.closest = (selector) => (String(selector).includes('link-goes-nowhere') ? dead : null);
    try {
      booted.__hoverEvent = { target: dead, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('activeHoverLink = null; startLinkHover(__hoverEvent);', booted);
      booted.__frames.drain();
      if (tip.hidden) throw new Error('the card never came up over a link that goes nowhere');
      if (kind.textContent !== 'Goes nowhere') throw new Error(`the card calls it ${kind.textContent}`);
      if (detail.textContent !== 'Written with an address this app does not follow') {
        throw new Error(`the card's reason reads ${detail.textContent}`);
      }
    } finally {
      vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
      delete booted.__hoverEvent;
    }
  });

  // A whole path from a drive letter is how a person on Windows writes a link to a file of their own, and it now keeps its address through the sanitizer. Three answers used to call it an app's own address, where the guard beside them and the host both call it a path — so the card would have named it wrongly the moment the address arrived.
  check('a whole path from a drive letter is a file on this disk, not an app address', () => {
    const { linkHoverInfo, linkHoverKind, isAnotherPageHref, linkHasAFileBehindIt } = booted;
    // Both spellings, as the renderer hands them over: the sanitizer rewrites a drive-letter path to a `file:` address before it judges it.
    for (const href of ['file:///C:/Users/rwall/plan.md', 'C:/Users/rwall/plan.md', 'C:\\Users\\rwall\\plan.md']) {
      const page = linkHoverInfo(href);
      if (page.kind !== 'Another page') throw new Error(`${href} is called ${page.kind}`);
      if (!isAnotherPageHref(href)) throw new Error(`a middle click on ${href} has nowhere to open`);
      if (!linkHasAFileBehindIt(href)) throw new Error(`Reveal file and Copy path dropped off ${href}`);
    }
    // The same path naming a file the app does not read takes the words every other such file gets, with where it sits under it.
    const pdf = linkHoverInfo('file:///C:/Users/rwall/Release Notes.pdf');
    if (pdf.kind !== 'Opens in another app') throw new Error(`a PDF named by a whole path is called ${pdf.kind}`);
    if (pdf.detail !== 'C:/Users/rwall/Release Notes.pdf') throw new Error(`the card shows ${pdf.detail} rather than where the file is`);
    // An address belonging to another program is still not a file, and still not one this app follows.
    if (linkHoverKind('obsidian://open?vault=x') !== 'App link') throw new Error('an app of its own stopped being one');
    if (linkHasAFileBehindIt('obsidian://open?vault=x')) throw new Error('Reveal file appeared on an address with no file behind it');
  });

  // The address a whole path now keeps can name a program as easily as a page, and the question in front of that click is the one thing making phase 2 safe to press.
  check('a program named by a whole path still asks before the host is told anything', () => {
    const { sendDocumentLink, isMacPlatform, closeConfirm } = booted;
    const dialog = vm.runInContext('confirmDialog', booted);
    const title = vm.runInContext('confirmDialogTitle', booted);
    const sent = [];
    const was = booted.ipc;
    booted.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    try {
      const program = isMacPlatform ? 'file:///Users/rwall/Install.command' : 'file:///C:/Users/rwall/setup.exe';
      const name = program.split('/').pop();
      sendDocumentLink({ getAttribute: () => program }, false);
      if (sent.length) throw new Error(`a whole path to a program told the host ${JSON.stringify(sent)} before anyone answered`);
      if (dialog.hidden) throw new Error('a whole path to a program opened no question at all');
      if (!String(title.textContent).includes(name)) throw new Error(`the question does not name the file: ${title.textContent}`);
      closeConfirm();

      // And a page named the same way goes straight out, so the question is on the program rather than on the spelling.
      sent.length = 0;
      sendDocumentLink({ getAttribute: () => 'file:///C:/Users/rwall/plan.md' }, false);
      if (!dialog.hidden) throw new Error('a whole path to a page raised the program question');
      if (sent.length !== 1 || sent[0].command !== 'openLink') throw new Error(`a whole path to a page sent ${JSON.stringify(sent)}`);
    } finally {
      booted.ipc = was;
      closeConfirm();
    }
  });

  // Resolving a link's path is what puts a program one click away: a note travels in a zip, a clone or a shared vault, and the link that starts one looks like every other link. The question is asked by the page rather than the host, so all three hosts gain it out of one edit and no command crosses.
  check('a link naming a program asks before the host is told anything', () => {
    const { sendDocumentLink, isMacPlatform, closeConfirm, acceptConfirm } = booted;
    const dialog = vm.runInContext('confirmDialog', booted);
    const title = vm.runInContext('confirmDialogTitle', booted);
    const sent = [];
    const was = booted.ipc;
    booted.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    const click = (href) => {
      sent.length = 0;
      sendDocumentLink({ getAttribute: () => href }, false);
    };
    try {
      const program = isMacPlatform ? './tools/Install.command' : './tools/setup.exe';
      const name = program.split('/').pop();

      click(program);
      if (sent.length) throw new Error(`a link to a program told the host ${JSON.stringify(sent)} before anyone answered`);
      if (dialog.hidden) throw new Error('a link to a program opened no question at all');
      if (!String(title.textContent).includes(name)) throw new Error(`the question does not name the file: ${title.textContent}`);

      // No sends nothing at all, which is the whole point of asking.
      closeConfirm();
      if (sent.length) throw new Error(`answering no still told the host ${JSON.stringify(sent)}`);

      // Yes sends the link exactly as the author wrote it, the way an unasked one goes.
      click(program);
      acceptConfirm();
      if (!sent.some((one) => one.command === 'openLink' && one.href === program)) {
        throw new Error(`answering yes sent ${JSON.stringify(sent)}`);
      }

      // A file on the web ending in the same name is the browser's to fetch, not this machine's to run.
      click('https://example.com/downloads/setup.exe');
      if (!dialog.hidden) throw new Error('a link off the web was asked about as if it were a file beside the note');
      if (!sent.some((one) => one.command === 'openLink')) throw new Error('an external link was swallowed by the question');

      // And an ordinary page link is never asked about.
      click('./notes/two.md');
      if (!dialog.hidden) throw new Error('an ordinary page link asked to run something');
      if (!sent.some((one) => one.command === 'openLink')) throw new Error('an ordinary page link sent nothing');
    } finally {
      closeConfirm();
      booted.ipc = was;
    }
  });

  // The card follows the pointer at a fixed offset, which lands inside a target this size — so it covered the very page name it had just been given. The preview makes the card taller, but the page name still stays clear.
  check('the taller card over a pager button stands clear of it', () => {
    const { positionLinkHoverTip } = booted;
    const tip = vm.runInContext('linkHoverTip', booted);
    const wasRect = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 });
    const target = (title, top) => ({
      getAttribute: (name) => (name === 'data-pager-title' ? title : null),
      getBoundingClientRect: () => ({ top, bottom: top + 70, left: 100, right: 775, width: 675, height: 70 }),
    });
    const place = (link, y) => {
      booted.__hovered = link;
      vm.runInContext('activeHoverLink = __hovered;', booted);
      positionLinkHoverTip({ clientX: 400, clientY: y });
      return tip.style.top;
    };
    try {
      // Pointer in the middle of a button two thirds down the window: the card goes above the whole button, not to the pointer.
      if (place(target('The Rains Retreat', 600), 620) !== '390px') throw new Error(`the card landed at ${tip.style.top} instead of above the button`);
      // A button at the top of the window has no room above it, so the card goes under it rather than off screen.
      if (place(target('The Rains Retreat', 20), 40) !== '100px') throw new Error(`with no room above, the card landed at ${tip.style.top}`);
      // An ordinary link is not a big target, and its card follows the pointer until the window edge keeps it on screen.
      if (place(target(null, 600), 620) !== '402px') throw new Error(`an ordinary link's card moved to ${tip.style.top}`);
    } finally {
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('activeHoverLink = null;', booted);
      delete booted.__hovered;
    }
  });

  check('a linked-note preview waits for a rest, ignores old answers and fades without blinking', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    const wasStyle = booted.getComputedStyle;
    const wasSend = booted.ipc.postMessage;
    const waiting = [];
    const cleared = [];
    const sent = [];
    booted.setTimeout = (fn, delay) => {
      waiting.push({ fn, delay });
      return waiting.length;
    };
    booted.clearTimeout = (id) => cleared.push(id);
    // Only the root answers the duration token; the preview box keeps answering with the shrink it is carrying.
    booted.getComputedStyle = (element) => (element === booted.document.documentElement ? { getPropertyValue: () => '300ms' } : wasStyle(element));
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    // The host wraps every answer in the note it rendered, and the card is the width of that note: 692px of note inside a 250px picture box.
    const note = fakeElement('article');
    note.offsetWidth = 692;
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 200 })];
    const wasQuery = previewDocument.querySelector;
    const wasBoxWidth = preview.clientWidth;
    try {
      preview.clientWidth = 250;
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      vm.runInContext('activeHoverToken = 30; activeHoverLink = {}; linkHoverPointer = { clientX: 300, clientY: 300 }; linkHoverTip.hidden = false; showLinkHoverPreviewPlaceholder(); requestLinkPreview("notes/linked.md", 30);', booted);
      if (preview.hidden || preview.classList.contains('is-loaded')) throw new Error('the full card did not keep its placeholder while the preview waited');
      if (waiting.length !== 1 || waiting[0].delay !== 300) throw new Error('the preview did not wait for the deliberate-reveal token');
      if (sent.length !== 0) throw new Error('the preview asked before the pointer rested');
      waiting.shift().fn();
      if (sent.length !== 1 || sent[0].command !== 'previewLink') throw new Error('the rested pointer did not send one preview ask');
      previewDocument.scrollHeight = 200;
      booted.window.leafLinkPreview(30, '<p>Opening.</p>');
      booted.__frames.drain();
      if (!preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Opening.</p>') throw new Error('the host answer did not fade into the placeholder');
      if (preview.style.height !== '73px') throw new Error(`the preview did not shrink to its opening: ${preview.style.height}`);
      if (tip.innerHTML.indexOf('link-hover-tip-preview') > tip.innerHTML.indexOf('link-hover-tip-kind')) throw new Error('the preview is not above the existing rows');
      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip-preview-placeholder') || !css.includes('var(--lt-grain-dot)')) throw new Error('the preview placeholder has no dot grain');
      if (!css.includes('border-bottom: var(--lt-stroke-1) solid var(--lt-border)')) throw new Error('the preview has no divider above its words');
      if (!css.includes('width: calc(100% / var(--link-preview-shrink))') || !css.includes('.link-hover-tip-preview-document {\n  width: 100%')) throw new Error('the rendered opening does not fill the preview card');
      if (!css.includes('contain: inline-size') || !css.includes('  --link-preview-shrink: 0.36;\n  position: relative;\n  contain: inline-size;\n  width: 100%')) throw new Error('the rendered opening can still widen its tooltip');
      vm.runInContext('hideLinkHoverTip();', booted);
      booted.window.leafLinkPreview(30, '<p>Old.</p>');
      if (!preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Opening.</p>') throw new Error('the exit fade replaced the opening with a spinner');
      if (tip.hidden || tip.classList.contains('shown')) throw new Error('hiding skipped the slow fade');
      vm.runInContext('showLinkHoverTip({ clientX: 300, clientY: 300 });', booted);
      booted.__frames.drain();
      if (!tip.classList.contains('shown') || cleared.length === 0) throw new Error('a re-hover did not cancel the pending hide');
      vm.runInContext('hideLinkHoverTip();', booted);
      waiting.at(-1).fn();
      if (!tip.hidden) throw new Error('the fade fallback did not hide the card');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
      booted.getComputedStyle = wasStyle;
      booted.ipc.postMessage = wasSend;
      previewDocument.querySelector = wasQuery;
      preview.clientWidth = wasBoxWidth;
      vm.runInContext('activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview();', booted);
    }
  });

  // One block per element. The markup each is read back as is the page's own now; only the step to the next sibling is still handed over, and that goes when the page learns to step to one.
  const previewSectionBlocks = [
    '<h1 id="tracks">Tracks</h1>',
    '<p>The opening.</p>',
    '<h2 id="layer-order">Layer order</h2>',
    '<p>Why it is here.</p>',
    '<h3 id="a-detail">A detail</h3>',
    '<table><tbody><tr><td>The second step</td></tr></tbody></table>',
    '<h2 id="the-next">The next</h2>',
    '<p>Not this one.</p>',
  ];
  const PREVIEW_SECTION_OPENING = '<base href="file:///notes/"><article class="document-body">';
  const previewSectionHtml = PREVIEW_SECTION_OPENING + previewSectionBlocks.join('') + '</article>';
  // The parse the page holds between rests, handed over ready-made because the lift is what is being read, not the browser's parser.
  const seedPreviewParse = () => {
    const parsed = booted.document.createElement('div');
    parsed.innerHTML = previewSectionHtml;
    const note = parsed.querySelector('article');
    note.children.forEach((el, i) => {
      el.nextElementSibling = note.children[i + 1] || null;
    });
    booted.__previewProbeRoot = parsed;
    booted.__previewProbeHtml = previewSectionHtml;
    vm.runInContext('linkPreviewParsedRoot = __previewProbeRoot; linkPreviewParsedHtml = __previewProbeHtml;', booted);
  };
  const forgetPreviewParse = () => {
    vm.runInContext('linkPreviewParsedRoot = null; linkPreviewParsedHtml = null; linkPreviewCache.clear(); pendingPreviewTokens.clear();', booted);
    delete booted.__previewProbeRoot;
    delete booted.__previewProbeHtml;
  };
  // The card's answer is the whole file the address names, and the address names one section of it. The blocks that section is are lifted out before anything is drawn or remembered, so what the card draws is the heading the address named and everything under it — the deeper heading inside it included, and nothing of the next section of its own rank.
  check('a preview lifts the section its address names and stops at the next heading of that rank', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasHidden = tip.hidden;
    try {
      seedPreviewParse();
      tip.hidden = false;
      vm.runInContext('activeHoverToken = 41; linkHoverPointer = null; pendingPreviewTokens.set(41, "notes/tracks.md#layer-order");', booted);
      booted.window.leafLinkPreview(41, previewSectionHtml);
      const drawn = previewDocument.innerHTML;
      const want = PREVIEW_SECTION_OPENING + previewSectionBlocks.slice(2, 6).join('') + '</article>';
      if (drawn !== want) throw new Error(`the card drew something other than the section its address named: ${drawn}`);
      if (drawn.includes('The opening.')) throw new Error('the card still opens at the file rather than at the section named');
      if (!drawn.includes('The second step')) throw new Error('the table under the heading did not come with it');
      if (!drawn.includes('A detail')) throw new Error('the lift stopped at a heading of lower rank inside the section');
      if (drawn.includes('Not this one.')) throw new Error('the lift ran on into the next section');
    } finally {
      vm.runInContext('activeHoverToken = 0; hideLinkHoverPreview();', booted);
      tip.hidden = wasHidden;
      forgetPreviewParse();
    }
  });

  // A heading renamed since the link was written names nothing in what arrived. The file is still what the press opens, so the card goes on saying what the file is rather than emptying itself.
  check('a preview whose address names nothing in the answer draws the whole answer', () => {
    try {
      seedPreviewParse();
      vm.runInContext('activeHoverToken = 42; linkHoverTip.hidden = true; pendingPreviewTokens.set(42, "notes/tracks.md#renamed-since");', booted);
      booted.window.leafLinkPreview(42, previewSectionHtml);
      const kept = vm.runInContext('linkPreviewCache.get("notes/tracks.md#renamed-since")', booted);
      if (kept !== previewSectionHtml) throw new Error('an address naming nothing left the card with less than the file');

      vm.runInContext('pendingPreviewTokens.set(43, "notes/tracks.md");', booted);
      booted.window.leafLinkPreview(43, previewSectionHtml);
      const whole = vm.runInContext('linkPreviewCache.get("notes/tracks.md")', booted);
      if (whole !== previewSectionHtml) throw new Error('an address naming no section at all was cut down to one');
    } finally {
      vm.runInContext('activeHoverToken = 0;', booted);
      forgetPreviewParse();
    }
  });

  // The running order links at a hundred and forty-two sections of one page. What is kept per address is that address's own section, so those links hold a hundred and forty-two sections rather than that many copies of the page.
  check('a preview remembers the section its address named, not the file it was cut from', () => {
    try {
      seedPreviewParse();
      vm.runInContext('linkHoverTip.hidden = true; pendingPreviewTokens.set(44, "notes/tracks.md#layer-order"); pendingPreviewTokens.set(45, "notes/tracks.md#the-next");', booted);
      booted.window.leafLinkPreview(44, previewSectionHtml);
      booted.window.leafLinkPreview(45, previewSectionHtml);
      const held = vm.runInContext('[...linkPreviewCache.entries()]', booted);
      if (held.length !== 2) throw new Error(`two links into one file left ${held.length} entries`);
      for (const [key, value] of held) {
        if (value.includes('The opening.')) throw new Error(`${key} kept the whole file rather than its own section`);
        if (value.length >= previewSectionHtml.length) throw new Error(`${key} kept as much as the answer it was cut from`);
      }
      const first = held.find(([key]) => key.endsWith('#layer-order'))[1];
      const second = held.find(([key]) => key.endsWith('#the-next'))[1];
      if (!first.includes('Layer order') || first.includes('Not this one.')) throw new Error('the first link remembered the wrong section');
      if (!second.includes('Not this one.') || second.includes('Why it is here.')) throw new Error('the second link remembered the wrong section');
    } finally {
      forgetPreviewParse();
    }
  });

  checkSettled('a drawing in a linked-note preview is made outside the layer the card scales, dropped for a card the pointer has left, and left a strip when it will not fit', async () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const wasMermaid = booted.window.mermaid;
    const drew = [];
    const drawnIn = [];
    const holding = (node, holder) => { for (let up = node; up; up = up.parentElement) if (up === holder) return true; return false; };
    // The drawing's own size, which mermaid writes into the markup as a `viewBox`. Set before each rest, because the whole of the fit rule is a question about a drawing's shape. `null` leaves the `viewBox` off, which is markup nobody has measured.
    let natural = { width: 570, height: 450 };
    // The card asks for the runtime the same way the reading page does, so a stand-in on `window.mermaid` is the whole of what `loadMermaid` needs.
    const runtime = {
      initialize: () => {},
      registerIconPacks: () => {},
      run: ({ nodes }) => {
        drew.push(nodes[0].textContent);
        // Where it was asked to draw, read while that block is still standing: it is let go the moment its drawing is moved into the card.
        drawnIn.push({ node: nodes[0], holder: nodes[0].parentElement, off: nodes[0].parentElement && nodes[0].parentElement.style.left, scaled: holding(nodes[0], scale) });
        // Mermaid's own markup: full width under a `max-width`, a `viewBox` and no height at all, which is why capping the height letterboxes the ink and leaves the box exactly where it was. A stand-in writing a bare `<svg>` with its rectangle hand-fed cannot tell the box and the ink apart, so no case here can fail on the difference. Marked with its own last word too, so a drawing that landed in another card's block is read rather than guessed at.
        const view = natural ? ' viewBox="0 0 ' + natural.width + ' ' + natural.height + '"' : '';
        nodes[0].innerHTML = '<svg data-drawn="' + nodes[0].textContent.trim().split(' ').pop() + '" width="100%"' + view + '></svg>';
        nodes[0].dataset.processed = 'true';
        return Promise.resolve();
      },
    };
    // Two turns of the loop: the runtime is answered in one and the drawing lands in the next, so a single turn reads a card that is still waiting.
    const settle = async () => { await new Promise((done) => setImmediate(done)); await new Promise((done) => setImmediate(done)); };
    const block = () => previewDocument.querySelectorAll('pre.mermaid')[0];
    const remembered = (source) => vm.runInContext(`[...mermaidRenderCache.keys()].some((key) => key.endsWith(${JSON.stringify(source)}))`, booted);
    // Restated on every step: the checks that wait all share one page, so another of them restoring its own stub between two awaits here would leave this one asking a runtime that is no longer there.
    const open = (html) => {
      booted.window.mermaid = runtime;
      previewDocument.innerHTML = html;
      vm.runInContext('drawLinkPreviewDiagrams();', booted);
    };
    try {
      vm.runInContext('activeHoverToken = 60; linkHoverTip.hidden = false;', booted);
      preview.classList.add('is-loaded');
      open('<p>Opening.</p><pre class="mermaid" data-language="mermaid">flowchart LR A--&gt;B</pre><p>And it reads on.</p>');
      // Nothing is written for the wait: the block is the stylesheet's own undrawn shape, and the words on either side of it are already drawn.
      if (block().dataset.processed) throw new Error('the block claimed a drawing before one was made');
      if (!previewDocument.innerHTML.includes('And it reads on.')) throw new Error('the words after the drawing waited on it');
      await settle();
      if (drew.length !== 1) throw new Error(`the card asked for ${drew.length} drawings rather than one`);
      if (block().dataset.processed !== 'true') throw new Error('the drawing never reached the block');
      if (!block().querySelector('svg')) throw new Error('the block was marked drawn with no drawing moved into it');
      if (block().dataset.cardDiagram) throw new Error('the block was left marked as still drawing');

      // Mermaid sizes every word's frame from what it reads while drawing, so a block inside the layer the card scales gives each word a frame at the card's shrink and the word, still drawn full size, is clipped — and the shared memo then hands that same picture to the reading page.
      if (drawnIn[0].node === block()) throw new Error("the drawing is still made in the card's own block");
      if (drawnIn[0].scaled) throw new Error('the drawing is made inside the layer the card scales, so every word comes out at the shrink');
      if (!drawnIn[0].holder || !drawnIn[0].holder.classList.contains('document-body')) throw new Error('the drawing is not made in a document body, so it is drawn in different text from the page');
      // Off screen rather than hidden: a hidden box has no layout, and mermaid measures nothing in one.
      if (drawnIn[0].off !== '-10000px' || drawnIn[0].holder.hidden) throw new Error('the holder is not placed off screen, so it stands in the page beside the card');
      if (!vm.runInContext('linkPreviewDiagramHolder === null', booted)) throw new Error('the holder was left standing in the page after the drawing in it was done');

      // A second rest on the same link: the drawing comes out of the page's own memo and nothing is made again.
      open('<p>Opening.</p><pre class="mermaid" data-language="mermaid">flowchart LR A--&gt;B</pre>');
      await settle();
      if (drew.length !== 1) throw new Error('a second rest on the same link made the drawing again');
      if (block().dataset.processed !== 'true') throw new Error('the remembered drawing never reached the second card');

      // The pointer moved on while it drew, so the answer lands on a card nobody is looking at and is dropped rather than kept.
      open('<pre class="mermaid" data-language="mermaid">flowchart LR gone</pre>');
      vm.runInContext('activeHoverToken = 61;', booted);
      await settle();
      if (drew.length !== 2) throw new Error('the abandoned card never started its drawing, so nothing was dropped');
      if (remembered('flowchart LR gone')) throw new Error('a drawing made for a card nobody is looking at was remembered anyway');
      if (!remembered('flowchart LR A--&gt;B')) throw new Error('the two readings prove nothing if a drawing that was kept reads as missing too');

      // A drawing over the room is scaled into it and kept where it is still wide enough to read, and put back as the strip where it is not.
      vm.runInContext('activeHoverToken = 62;', booted);
      const wasStyle = booted.getComputedStyle;
      // Half the picture is 88 of the picture's own pixels, so at this shrink a drawing has 176 to land in; the narrowest a scaled drawing may be is a third of the picture, which is 84 where the reader sees it.
      const stubShrink = () => {
        booted.getComputedStyle = (element) => (element === preview ? { getPropertyValue: () => '0.5' } : wasStyle(element));
      };
      // The drawing is made outside the card and moved in, so the rectangle the fit rule reads is put on the card's own block rather than on the node the runtime drew into. It is the box mermaid's drawing keeps however hard its height is capped — its own natural width, at the room's height — and never the ink inside it, which is what the code has to work out for itself.
      const cardDrawnBox = (width) => {
        const card = block();
        const was = card.querySelector.bind(card);
        card.querySelector = (selector) => {
          const found = was(selector);
          if (found && selector === 'svg') found.getBoundingClientRect = () => ({ width, height: 88 });
          return found;
        };
      };
      const narrowest = vm.runInContext('LINK_PREVIEW_DIAGRAM_NARROWEST', booted);
      try {
        // The plan tree's own tracks page, which is what every link in its README points at: a page-tall flowchart, letterboxed to five pixels of ink inside a box that never narrowed.
        stubShrink();
        natural = { width: 262.9, height: 4105 };
        open('<pre class="mermaid" data-language="mermaid">flowchart LR TRACKS.md</pre>');
        cardDrawnBox(88.3);
        block().offsetHeight = 400;
        await settle();
        if (!(88.3 >= narrowest)) throw new Error('the box this case hands over is under the line on its own, so reading the box again would pass it and the case proves nothing');
        if (drew.length !== 3) throw new Error('the tall drawing was never made');
        if (block().dataset.processed) throw new Error('a drawing too narrow to read at the size it fits was left in the card');
        if (block().dataset.cardDiagram !== 'unshown') throw new Error('the block does not say the card will not draw it, so the strip rule lands on nothing');
        if (!block().textContent.includes('TRACKS.md')) throw new Error('the block that went back to the strip lost its own source text');
        stubShrink();
        open('<pre class="mermaid" data-language="mermaid">flowchart LR TRACKS.md</pre>');
        await settle();
        if (drew.length !== 3) throw new Error('a drawing already known not to fit was made a second time');
        if (block().dataset.cardDiagram !== 'unshown') throw new Error('the second rest lost the mark the strip rule keys on');

        // A pie chart is over the room too, and it is kept: what separates the two is how wide each still is once it fits. Its box is wider than the tall drawing's and so is its ink, so the change cannot pass by turning everything away.
        stubShrink();
        natural = { width: 570, height: 450 };
        open('<pre class="mermaid" data-language="mermaid">pie squarish</pre>');
        cardDrawnBox(195.3);
        block().offsetHeight = 400;
        await settle();
        if (drew.length !== 4) throw new Error('the square drawing was never made');
        if (block().dataset.processed !== 'true') throw new Error('a drawing that fits the room and is still wide enough to read was turned away');
        if (block().dataset.cardDiagram) throw new Error('a drawing that was kept was marked as one the card will not draw');

        // Markup nobody has measured: no `viewBox` to fold the box through, so the box is all there is to read and the drawing is kept on it.
        stubShrink();
        natural = null;
        open('<pre class="mermaid" data-language="mermaid">flowchart LR unmeasured</pre>');
        cardDrawnBox(195.3);
        block().offsetHeight = 400;
        await settle();
        if (drew.length !== 5) throw new Error('the drawing with no viewBox was never made');
        if (block().querySelector('svg').getAttribute('viewBox')) throw new Error('the case handed over a viewBox after all, so it never reached the reading it is here for');
        if (block().dataset.processed !== 'true') throw new Error('a drawing with no viewBox was turned away, so markup nobody has measured loses its picture');
      } finally {
        booted.getComputedStyle = wasStyle;
        natural = { width: 570, height: 450 };
      }

      // Two diagrams in one card are started at once, each on its own promise, so one block reused across them would have two renders in it.
      vm.runInContext('activeHoverToken = 63;', booted);
      open('<pre class="mermaid" data-language="mermaid">flowchart LR first</pre><pre class="mermaid" data-language="mermaid">flowchart LR second</pre>');
      await settle();
      if (drew.length !== 7) throw new Error(`a card with two diagrams asked for ${drew.length - 5} drawings rather than two`);
      const both = drawnIn.slice(-2);
      if (both[0].node === both[1].node) throw new Error('both were drawn in one block, so the second wrote over the first');
      const cards = previewDocument.querySelectorAll('pre.mermaid');
      const mark = (card) => { const svg = card.querySelector('svg'); return svg ? svg.dataset.drawn : null; };
      if (mark(cards[0]) !== 'first') throw new Error(`the first block holds ${mark(cards[0])} rather than its own drawing`);
      if (mark(cards[1]) !== 'second') throw new Error(`the second block holds ${mark(cards[1])} rather than its own drawing`);
      if (!vm.runInContext('linkPreviewDiagramHolder === null', booted)) throw new Error('the holder was left standing once both drawings were done');

      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip-preview-document pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"]):not([data-diagram-wait="far"])[data-card-diagram="unshown"] {')) throw new Error('the card has no strip rule for a drawing it will not show');
    } finally {
      booted.window.mermaid = wasMermaid;
      previewDocument.innerHTML = '';
      preview.classList.remove('is-loaded');
      vm.runInContext('activeHoverToken = 0; linkHoverTip.hidden = true;', booted);
    }
  });

  check('a page the host cannot draw drops the picture box instead of spinning', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const kind = vm.runInContext('linkHoverTipKind', booted);
    const detail = vm.runInContext('linkHoverTipDetail', booted);
    const wasTimeout = booted.setTimeout;
    const wasStyle = booted.getComputedStyle;
    const wasSend = booted.ipc.postMessage;
    const waiting = [];
    const sent = [];
    booted.setTimeout = (fn) => waiting.push(fn);
    booted.getComputedStyle = (element) => (element === booted.document.documentElement ? { getPropertyValue: () => '300ms' } : wasStyle(element));
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    const gone = { href: 'notes/gone.md', getAttribute: (name) => (name === 'href' ? 'notes/gone.md' : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
    gone.closest = () => gone;
    try {
      // The pointer rests, the ask goes out, and the host answers that the page is not there to draw.
      vm.runInContext('activeHoverToken = 41; activeHoverLink = {}; linkHoverPointer = { clientX: 300, clientY: 300 }; linkHoverTip.hidden = false; showLinkHoverPreviewPlaceholder(); requestLinkPreview("notes/gone.md", 41);', booted);
      waiting.shift()();
      if (!sent.some((message) => message.command === 'previewLink')) throw new Error('the rested pointer never asked for the preview');
      booted.window.leafLinkPreview(41, '');
      if (!preview.hidden || tip.classList.contains('has-preview')) throw new Error('a page the host cannot draw left its spinner turning on the card');
      if (previewDocument.innerHTML !== '') throw new Error('the empty answer left a box behind with nothing in it');
      // Hovering it again reads the same answer out of the cache: no box, no second ask, and the card still says what the link is and where it points.
      sent.length = 0;
      vm.runInContext('activeHoverLink = null;', booted);
      booted.__hoverEvent = { target: gone, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('startLinkHover(__hoverEvent);', booted);
      booted.__frames.drain();
      if (!preview.hidden || tip.classList.contains('has-preview')) throw new Error('the second hover raised a box the host had already said it cannot fill');
      if (sent.some((message) => message.command === 'previewLink')) throw new Error('the cached empty answer asked the host all over again');
      if (tip.hidden || kind.textContent !== 'Another page' || detail.textContent !== 'notes/gone.md') throw new Error('the card lost the rows it can still answer');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.getComputedStyle = wasStyle;
      booted.ipc.postMessage = wasSend;
      vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1; linkPreviewCache.delete("notes/gone.md"); lineCountCache.delete("notes/gone.md");', booted);
      delete booted.__hoverEvent;
    }
  });

  check('the preview shrink is written once and read off the box that carries it', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const fragment = readFileSync(join(root, 'src/assets/shell/glossary.js'), 'utf8');
    const written = (text) => (text.match(/0\.36(?!\d)/g) || []).length;
    if (!css.includes('--link-preview-shrink: 0.36;')) throw new Error('the shrink is not a property of the picture box');
    if (written(css) !== 1) throw new Error(`the stylesheet writes the shrink ${written(css)} times instead of once`);
    if (written(fragment) !== 0) throw new Error('the fragment still writes the shrink down rather than reading it off the box');
    try {
      // The height follows whatever the box is carrying, so a measured card shrinks by what it measured rather than by a number in the script.
      preview.classList.add('is-loaded');
      previewDocument.scrollHeight = 200;
      preview.style.setProperty('--link-preview-shrink', '0.5');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (preview.style.height !== '100px') throw new Error(`the height ignored the box's own shrink: ${preview.style.height}`);
      preview.style.setProperty('--link-preview-shrink', '0.36');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (preview.style.height !== '72px') throw new Error(`the stylesheet's own shrink did not size the box: ${preview.style.height}`);
    } finally {
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      previewDocument.scrollHeight = 0;
    }
  });

  check('a card is the width of the note in it, with no background left over down its side', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasQuery = previewDocument.querySelector;
    const wasWidth = preview.clientWidth;
    // A note held to 75 characters draws 692px at the window the card was measured in, inside a 250px picture box.
    const note = fakeElement('article');
    note.offsetWidth = 692;
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 200 })];
    try {
      preview.clientWidth = 250;
      preview.classList.add('is-loaded');
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '692px') throw new Error(`the note was laid out at ${scale.style.width} rather than at its own width`);
      const shrink = Number.parseFloat(preview.style.getPropertyValue('--link-preview-shrink'));
      if (shrink.toFixed(3) !== '0.361') throw new Error(`the shrink came out ${shrink} rather than the box over the note`);
      if (Math.abs(692 * shrink - 250) > 0.001) throw new Error('the drawn note does not reach both edges of its box');
      if (preview.style.height !== '73px') throw new Error(`the height did not follow the new shrink: ${preview.style.height}`);
      // A fresh answer is measured on its own: the card it replaces takes its shrink and its layer width with it.
      vm.runInContext('setLinkHoverPreview("<p>Next.</p>");', booted);
      if (scale.style.width !== '' || preview.style.getPropertyValue('--link-preview-shrink') !== '') throw new Error('a new answer would be measured inside the width of the card before it');
      // An answer with no note in it keeps the stylesheet's own shrink rather than none at all, which the harness has no cascade to hand it.
      previewDocument.querySelector = wasQuery;
      previewDocument.scrollHeight = 100;
      preview.style.setProperty('--link-preview-shrink', '0.36');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '') throw new Error('a card with no note to measure still pinned its layer to a width');
      if (preview.style.height !== '36px') throw new Error(`a card with no note to measure did not fall back to the stylesheet's shrink: ${preview.style.height}`);
    } finally {
      previewDocument.querySelector = wasQuery;
      previewDocument.scrollHeight = 0;
      previewDocument.innerHTML = '';
      preview.clientWidth = wasWidth;
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      preview.style.removeProperty('--link-preview-shrink');
      scale.style.width = '';
      booted.__frames.drain();
    }
  });

  check('a note is measured with room to spread, so a card is never held to the last one’s width', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasQuery = previewDocument.querySelector;
    const wasWidth = preview.clientWidth;
    // The note answers with whatever room it was given, the way a 75-character cap inside a narrow layer would.
    const note = fakeElement('article');
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 100 })];
    Object.defineProperty(note, 'offsetWidth', { get: () => (scale.style.width === '100vw' ? 900 : 400) });
    try {
      preview.clientWidth = 250;
      preview.classList.add('is-loaded');
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      // A wider window after a narrower card: the layer is still carrying the last measurement.
      scale.style.width = '400px';
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '900px') throw new Error(`the note was capped at the last card's width and measured ${scale.style.width}`);
    } finally {
      previewDocument.querySelector = wasQuery;
      preview.clientWidth = wasWidth;
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      preview.style.removeProperty('--link-preview-shrink');
      scale.style.width = '';
    }
  });

  check('a drawing\'s link asks with its address as text, not the object its href property answers', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const written = 'TRACKS.md#links';
    // What a linked box in a diagram answers: an SVG link's `href` is an object holding the address, never the address.
    const link = {
      href: { baseVal: written, animVal: written },
      getAttribute: (name) => (name === 'href' ? written : null),
      getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
    };
    link.closest = () => link;
    const wasSend = booted.ipc.postMessage;
    const wasTimeout = booted.setTimeout;
    const wasRect = tip.getBoundingClientRect;
    const sent = [];
    const waiting = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.setTimeout = (fn) => waiting.push(fn);
      tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 240, bottom: 120, width: 240, height: 120 });
      booted.__hoverEvent = { target: link, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('activeHoverLink = null; startLinkHover(__hoverEvent);', booted);
      waiting.forEach((fn) => fn());
      const count = sent.find((one) => one.command === 'countLines');
      const preview = sent.find((one) => one.command === 'previewLink');
      if (!count || !preview) throw new Error(`a diagram link asked for ${sent.map((one) => one.command).join(', ') || 'nothing'}`);
      for (const ask of [count, preview]) {
        if (typeof ask.href !== 'string') throw new Error(`${ask.command} carried ${JSON.stringify(ask.href)} where the host requires text`);
        if (ask.href !== written) throw new Error(`${ask.command} carried ${ask.href} instead of the address as written`);
      }
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.setTimeout = wasTimeout;
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('hideLinkHoverTip(); activeHoverLink = null;', booted);
      delete booted.__hoverEvent;
    }
  });

  check('a new link keeps its hover when an old link finishes leaving', () => {
    const { positionLinkHoverTip } = booted;
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = {
        href,
        getAttribute: (name) => (name === 'href' ? href : null),
        getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
      };
      item.closest = () => item;
      return item;
    };
    const first = link('https://example.com/first');
    const second = link('https://example.com/second');
    const event = (target, relatedTarget = { body: true }) => ({ target, relatedTarget, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const wasRect = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 240, bottom: 120, width: 240, height: 120 });
    try {
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      hover('startLinkHover', event(second));
      hover('endLinkHover', event(first));
      if (vm.runInContext('activeHoverLink', booted) !== second || tip.hidden) throw new Error('an old exit closed the re-entered link');
      hover('startLinkHover', event(second));
      if (vm.runInContext('activeHoverLink', booted) !== second) throw new Error('moving within one link restarted its hover');
      positionLinkHoverTip(event(second));
    } finally {
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('hideLinkHoverTip();', booted);
      delete booted.__hoverEvent;
    }
  });

  check('a rapid link handoff settles on the link under the pointer', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const first = link('notes/first.md');
    const second = link('notes/second.md');
    const event = (target) => ({ target, relatedTarget: { body: true }, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const wasElementFromPoint = booted.document.elementFromPoint;
    booted.document.elementFromPoint = () => second;
    try {
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      booted.__frames.drain();
      if (vm.runInContext('activeHoverLink', booted) !== second || tip.hidden) throw new Error('the link under the pointer did not keep its card');
      // The handoff builds a plain position: a copied pointer event loses its coordinates in the web view.
      if (vm.runInContext('linkHoverPointer.clientX', booted) !== 240) throw new Error('the handed-off card lost its place');
    } finally {
      booted.document.elementFromPoint = wasElementFromPoint;
      vm.runInContext('hideLinkHoverTip();', booted);
      delete booted.__hoverEvent;
    }
  });

  // The card floats beside the page, so replacing the page cannot take it along — the render hides it itself, outright, because the leave's fade exists for a slide to a neighboring link and a fresh page has none.
  check('a fresh render hides the hover card and clears the hovered link', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const spot = link('notes/first.md');
    const hover = () => {
      booted.__hoverEvent = { target: spot, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('startLinkHover(__hoverEvent);', booted);
      booted.__frames.drain();
    };
    try {
      hover();
      if (tip.hidden || !tip.classList.contains('shown')) throw new Error('the card never came up to be rendered over');
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('the render left the card floating over the fresh page');
      if (vm.runInContext('activeHoverLink', booted) !== null) throw new Error('the render left a link hovered, so the same spot could never raise a new card');
      if (vm.runInContext('linkHoverEndFade', booted) !== null) throw new Error('the render left a fade running instead of hiding outright');
      // The same spot raises a new card on the next pointer move.
      hover();
      if (tip.hidden || vm.runInContext('activeHoverLink', booted) !== spot) throw new Error('the spot the card was on could not raise a new one');
      // A render landing mid-fade ends the fade and hides in the same frame, not at the fade's own pace.
      vm.runInContext('hideLinkHoverTip();', booted);
      if (tip.hidden) throw new Error('the leave hid outright, so the mid-fade case went untested');
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      if (!tip.hidden || vm.runInContext('linkHoverEndFade', booted) !== null) throw new Error('a render mid-fade did not cut the fade short');
    } finally {
      vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
      delete booted.__hoverEvent;
    }
  });

  check('a leave settles at the pointer and never clears a newer hover', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const first = link('notes/first.md');
    const second = link('notes/second.md');
    const event = (target) => ({ target, relatedTarget: { body: true }, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const reset = () => vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
    const wasElementFromPoint = booted.document.elementFromPoint;
    try {
      // A hover that began after the leave was scheduled is not the settle's to touch, even with nothing under the pointer.
      booted.document.elementFromPoint = () => null;
      hover('startLinkHover', event(first));
      booted.__frames.drain();
      hover('endLinkHover', event(first));
      booted.__newLink = second;
      vm.runInContext('activeHoverLink = __newLink;', booted);
      booted.__frames.drain();
      if (vm.runInContext('activeHoverLink', booted) !== second || !tip.classList.contains('shown')) throw new Error('an old leave cleared the newer hover');
      // The settle looks where the pointer is now, not where the leave event said it was, and hands that place to the next card.
      reset();
      const seen = [];
      booted.document.elementFromPoint = (x, y) => { seen.push(String([x, y])); return second; };
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      hover('recordLinkHoverPoint', { clientX: 500, clientY: 400 });
      booted.__frames.drain();
      if (seen.at(-1) !== '500,400') throw new Error(`the settle looked where the pointer used to be: ${seen.at(-1)}`);
      if (vm.runInContext('activeHoverLink', booted) !== second) throw new Error('the link under the pointer lost the handoff');
      if (vm.runInContext('linkHoverPointer.clientY', booted) !== 400) throw new Error('the handed-off card lost the pointer’s newest place');
      // A leave with no destination is a pointer gone from the window: hide at once, no settle to wait on.
      reset();
      hover('startLinkHover', event(first));
      booted.__frames.drain();
      hover('endLinkHover', { target: first, relatedTarget: null, clientX: 240, clientY: 210 });
      if (vm.runInContext('activeHoverLink', booted) !== null || tip.classList.contains('shown')) throw new Error('a pointer that left the window kept its card');
      if (booted.__frames.waiting() !== 0) throw new Error('a window leave still waited for a settle');
      // A preview the reader has already seen returns rendered, never as a spinner.
      reset();
      previewDocument.scrollHeight = 100;
      vm.runInContext('linkPreviewCache.set("notes/first.md", "<p>Seen.</p>")', booted);
      hover('startLinkHover', event(first));
      if (preview.hidden || !preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Seen.</p>') throw new Error('a seen preview came back as a spinner');
      // The card carries the fixed-width mark while its preview is open, so every preview card is one width.
      if (!tip.classList.contains('has-preview')) throw new Error('a card with a preview is still sized by its own words');
      booted.__frames.drain();
      vm.runInContext('hideLinkHoverPreview();', booted);
      if (tip.classList.contains('has-preview')) throw new Error('a card without a preview kept the fixed width');
      // An exiting card stops its spinner with it.
      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip:not(.shown) .link-hover-tip-preview-spinner')) throw new Error('an exiting card still spins its spinner');
      if (!css.includes('.link-hover-tip.has-preview {\n  width: 17rem;\n}')) throw new Error('a preview card has no fixed width of its own');
      // The card is the width of its picture, so the address under it has to break mid-path rather than push the card wider.
      if (!css.slice(css.indexOf('.link-hover-tip-detail {'), css.indexOf('.link-hover-tip-lines {')).includes('overflow-wrap: anywhere;')) throw new Error('a long address would widen the card rather than wrapping inside it');
      // The shared halftone fades across a fraction of the box; a card this small needs the fade inside its own band or it shows nothing.
      if (!css.includes('.link-hover-tip::before {') || !css.includes('var(--lt-mask-opaque) calc(100% - 34px)')) throw new Error('the card has no fade stops of its own for the halftone shadow');
    } finally {
      booted.document.elementFromPoint = wasElementFromPoint;
      vm.runInContext('linkPreviewCache.delete("notes/first.md"); hideLinkHoverTip(); endLinkHoverFade();', booted);
      reset();
      delete booted.__hoverEvent;
      delete booted.__newLink;
    }
  });
}
