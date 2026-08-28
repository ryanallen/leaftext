// The reading view's own render, and the landings a document comes to rest on.

import vm from 'node:vm';
import {
  bootReading,
  check,
  record,
  renderReadingDocument,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 4c. the reading view's own render ---------------------------------------
  //
  // Every file a reader opens comes through this render. What the checks below drive is the end of it: the guard that drops a landing armed on another document, and the three landings after it — the reader's own pixel, the block holding a source line, and the reset that catches what neither of those answered.
  //
  // Geometry is each check's own, never the stand-in element's. Every pixel a landing writes goes through the clamp, which measures the surface, the body and the body's first block, so a check standing none of them in reads every landing back as zero and passes on numbers nobody chose.

  check('a document handed to the page is rendered into the reading view', () => {
    const { context, app, body } = bootReading({ path: 'C:\\Notes\\opened.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    if (!String(app.className).includes('has-document')) throw new Error(`the surface reads ${JSON.stringify(String(app.className))} rather than one holding a document`);
    const layout = app.firstElementChild;
    if (!layout || !String(layout.className).includes('reader-layout')) throw new Error('the surface is not holding a reading layout');
    if (!body || body.parentElement !== layout) throw new Error("the document's own body is not standing under the layout");
    if (body.children.length !== 2) throw new Error(`the body holds ${body.children.length} blocks rather than the two the document declared`);
    // Drawn hidden and revealed once every pass over it has run, which is the last thing the render does before it lands.
    if (layout.style.getPropertyValue('display') === 'none') throw new Error('the finished document was left hidden');
    // The page took the document's own name as the window's, which is the cheapest proof the render read the document rather than the tab.
    if (!String(context.document.title).startsWith('opened')) throw new Error(`the window is titled ${JSON.stringify(context.document.title)}`);
  });

  check("a document opened with the reader's own pixel armed comes to rest on it", () => {
    const path = 'C:\\Notes\\exact.md';
    const context = runShell(source);
    // Everything one press of the source button leaves behind when the code view never moved: the pixel the reading view was on, and the arm that says it may simply be handed back.
    vm.runInContext(`viewHandoff = { path: ${JSON.stringify(path)}, readerScrollTop: 321, codeScrollTop: 0, readerLanded: 321, codeLanded: 0, restoreExact: true };`, context);
    const { app } = renderReadingDocument(context, { path, blocks: [{ srcStart: 0 }, { srcStart: 40 }, { srcStart: 90 }] });
    context.__frames.drain();
    if (app.scrollTop !== 321) throw new Error(`the reader came to rest at ${app.scrollTop} rather than the pixel it was on`);
    // One landing per toggle: a second render of the same document must not spend it again.
    if (vm.runInContext('viewHandoff.restoreExact', context) !== false) throw new Error('the pixel was left armed for the next render as well');
    // And it is the landing that ran, not the reset underneath it.
    if (vm.runInContext('resetReaderScrollOnNextRender', context) !== false) throw new Error('the reset was left armed under the landing that beat it');
  });

  check('a document opened with a source line armed comes to rest on the block holding it', () => {
    const path = 'C:\\Notes\\line.md';
    const blocks = [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }];
    const arm = (context, offset) =>
      vm.runInContext(`pendingViewLandingPath = ${JSON.stringify(path)}; pendingReadingSrcOffset = ${offset}; pendingViewScrollFraction = 0.5; pendingViewAtTop = false;`, context);
    const first = runShell(source);
    arm(first, 60);
    const landed = renderReadingDocument(first, { path, blocks });
    first.__frames.drain();
    // 60 falls inside the second block, which starts at 40 — so the block holding that line is the one the reader lands on.
    if (landed.app.scrollTop !== 900) throw new Error(`the reader came to rest at ${landed.app.scrollTop} rather than on the block holding the line`);
    if (vm.runInContext('pendingReadingSrcOffset', first) !== null) throw new Error('the source line was left armed for the next render as well');

    // A document whose blocks carry no source range at all: the landing has nothing to aim at, so the render falls back to the fraction the toggle carried across, which is half way down 9,000px of range.
    const bare = runShell(source);
    arm(bare, 60);
    const empty = renderReadingDocument(bare, { path, blocks: [] });
    empty.app.scrollTop = 4000;
    bare.__frames.drain();
    if (empty.app.scrollTop !== 4500) throw new Error(`a document with no block to land on came to rest at ${empty.app.scrollTop} rather than at the fraction the toggle carried`);

    // And with no fraction either, the content start — never wherever the last document left the reader.
    const plain = runShell(source);
    vm.runInContext(`pendingViewLandingPath = ${JSON.stringify(path)}; pendingReadingSrcOffset = 60; pendingViewScrollFraction = null; pendingViewAtTop = false;`, plain);
    const start = renderReadingDocument(plain, { path, blocks: [] });
    start.app.scrollTop = 4000;
    plain.__frames.drain();
    if (start.app.scrollTop !== 0) throw new Error(`a document with nothing to land on came to rest at ${start.app.scrollTop} rather than at its content start`);
  });

  check('the source button writes down where the reader is, whose document it is, and the block at the top', () => {
    const path = 'C:\\Notes\\toggled.md';
    const { context, app } = bootReading({
      path,
      blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 100 }, { srcStart: 90, top: 200 }, { srcStart: 150, top: 300 }],
    });
    context.__frames.drain();
    const sent = [];
    context.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    // Part way down, with the third block at the top edge.
    app.scrollTop = 250;
    context.toggleCodeView();
    const read = (name) => vm.runInContext(name, context);
    if (read('pendingViewLandingPath') !== path) throw new Error(`the landing was stamped with ${JSON.stringify(read('pendingViewLandingPath'))} rather than the document it was taken from`);
    if (read('viewHandoff.readerScrollTop') !== 250) throw new Error(`the reader's pixel was written down as ${read('viewHandoff.readerScrollTop')}`);
    if (read('pendingViewAtTop') !== false) throw new Error('a reader part way down a document was recorded as sitting at the top');
    if (read('pendingCodeViewSrcOffset') !== 90) throw new Error(`the source view was sent to ${read('pendingCodeViewSrcOffset')} rather than the block at the top of the reading view`);
    if (!sent.some((one) => one.command === 'enterCodeView')) throw new Error(`the press asked the host for nothing: ${JSON.stringify(sent)}`);

    // From the very top there is no block to align on, so the other view is told to land flush at its own top.
    app.scrollTop = 0;
    vm.runInContext('pendingViewAtTop = false;', context);
    context.toggleCodeView();
    if (read('pendingViewAtTop') !== true) throw new Error('a reader at the top of the document was not recorded as being there');
    if (read('pendingCodeViewSrcOffset') !== 0) throw new Error(`the top of the document took the offset ${read('pendingCodeViewSrcOffset')}`);
  });

  // ---- 4d. the page being left stays on screen long enough to leave -----------
  //
  // The write that draws a new page takes the old one with it in the same frame, so without a copy nothing on screen says which way the reader went and Back looks exactly like going on. A still copy of the page being left is laid over the one that arrived instead, in one cell of the reader's own scroll box. Everything worth checking is about the copy: that it is a copy, that it is behind the live page in every query, and that it goes.

  check('going somewhere lays a still copy of the page being left over the one that arrived', () => {
    const { context, app } = bootReading({ path: 'C:\Notes\first.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    context.__frames.drain();
    const layers = () => app.querySelectorAll('.reader-layout');
    if (layers().length !== 1) throw new Error(`a page at rest drew ${layers().length} layers rather than one`);
    const restingScrollHeight = app.scrollHeight;

    // Part way down the page they are leaving, so the copy has something to hold still.
    app.scrollTop = 240;
    vm.runInContext("setNavigationDirection('forward')", context);
    renderReadingDocument(context, { path: 'C:\Notes\second.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }, { srcStart: 90 }] });
    const both = layers();
    if (both.length !== 2) throw new Error(`following a link left ${both.length} layers on screen rather than two`);
    if (app.dataset.going !== 'forward') throw new Error(`the move read as ${app.dataset.going}`);
    if (!String(app.className).includes('is-swapping')) throw new Error('the reader is not wearing the move');
    // Both in one cell, which was measured to leave the reader's own scroll exactly as it was.
    if (app.scrollHeight !== restingScrollHeight) throw new Error(`two pages took the reader's scroll from ${restingScrollHeight} to ${app.scrollHeight}`);
    // The page that arrived owns the scroll from the frame it lands, and the copy riding over it changes nothing about where that is.
    context.__frames.drain();
    if (app.scrollTop !== 0) throw new Error(`the page that arrived came to rest at ${app.scrollTop} rather than at its own top`);

    // The live page is first, so every single-element query for the document still answers with the one that works; the copy is last, inert and out of a screen reader's way.
    const [live, copy] = both;
    if (live.classList.contains('is-leaving')) throw new Error('the copy was drawn in front of the live page');
    if (app.querySelector('.reader-layout') !== live) throw new Error('a query for the layout answered with the copy');
    if (app.querySelector('.document-body') !== live.querySelector('.document-body')) throw new Error("a query for the document's body answered with the copy's");
    if (live.querySelector('.document-body').children.length !== 3) throw new Error('the page that arrived is not the one that was opened');
    if (copy.querySelector('.document-body').children.length !== 2) throw new Error('the copy is not of the page that was left');
    if (!copy.classList.contains('is-leaving')) throw new Error('the copy is not marked as the one leaving');
    if (copy.inert !== true) throw new Error('the copy still takes a press');
    if (copy.getAttribute('aria-hidden') !== 'true') throw new Error('the copy is still read out');
    // Held where the reader left it, so the page going away carries the words they were reading out with it.
    if (copy.style.getPropertyValue('--reader-leaving-offset') !== '-240px') throw new Error(`the copy was held at ${copy.style.getPropertyValue('--reader-leaving-offset')} rather than where the reader was`);

    // Its own animation ends the move, and everything it put up comes off.
    for (const handler of copy.listeners.get('animationend') || []) handler({ target: copy });
    if (layers().length !== 1) throw new Error(`the move ended with ${layers().length} layers still up`);
    if (String(app.className).includes('is-swapping')) throw new Error('the reader is still wearing the move at rest');
    if (app.dataset.going !== undefined) throw new Error('the reader is still wearing a direction at rest');
    if (live.classList.contains('is-swapping-in')) throw new Error('the page that arrived is still wearing its travel');
  });

  check('a render nobody navigated to leaves the page exactly where it is', () => {
    const { context, app } = bootReading({ path: 'C:\Notes\held.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    context.__frames.drain();
    const layers = () => app.querySelectorAll('.reader-layout');

    // A live reload: the same document, re-read off the disk. Nobody went anywhere.
    context.window.leafReloadDocument(vm.runInContext('currentState', context));
    if (layers().length !== 1) throw new Error('a live reload drew a copy of the page it was re-reading');

    // A word standing with no move to spend it on is spent all the same, so it cannot move the render after this one.
    vm.runInContext("setNavigationDirection('forward')", context);
    context.window.leafReloadDocument(vm.runInContext('currentState', context));
    if (layers().length !== 1) throw new Error('a live reload spent a word it had no business spending');
    if (vm.runInContext('navigationDirection', context) !== '') throw new Error('a word nobody could use was left standing for the next render');
    renderReadingDocument(context, { path: 'C:\Notes\next.md', blocks: [{ srcStart: 0 }] });
    if (layers().length !== 1) throw new Error('an open with no direction behind it moved the page anyway');
  });
}
