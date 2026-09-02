// The reading view's own render, and the landings a document comes to rest on.

import vm from 'node:vm';
import {
  bootReading,
  check,
  checkSettled,
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

  checkSettled('a staged reading payload is fetched and handed to its state entry point', async () => {
    const context = runShell(source);
    const payload = { recent: [], favorites: [], tabs: [], active: null, document: { source: 'from the payload' } };
    const fetched = [];
    const landed = [];
    context.fetch = (url) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    };
    context.window.leafSetState = (state) => landed.push(state);
    context.window.leafLoadWorkspace('leaf-source://localhost/payload/7', 'state', null);
    await new Promise((done) => setImmediate(done));
    if (fetched.join('') !== 'leaf-source://localhost/payload/7') throw new Error(`the page fetched ${JSON.stringify(fetched)} rather than the staged payload URL`);
    if (landed.length !== 1 || landed[0] !== payload) throw new Error('the fetched payload did not reach the state entry point');
    const buffer = new TextEncoder().encode(JSON.stringify(payload)).buffer;
    let released = null;
    context.window.chrome = { webview: { releaseBuffer: (value) => { released = value; } } };
    context.acceptWorkspaceSharedBuffer({ getBuffer: () => buffer, additionalData: { action: 'state', detail: null } });
    if (landed.length !== 2 || landed[1].document.source !== 'from the payload') throw new Error('the shared payload did not reach the state entry point');
    if (released !== buffer) throw new Error('the page kept the shared payload after reading it');
  });

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
    // Part way down, with the third block up under the app bar and the fourth crossing the line the document is read from.
    app.scrollTop = 250;
    context.toggleCodeView();
    const read = (name) => vm.runInContext(name, context);
    if (read('pendingViewLandingPath') !== path) throw new Error(`the landing was stamped with ${JSON.stringify(read('pendingViewLandingPath'))} rather than the document it was taken from`);
    if (read('viewHandoff.readerScrollTop') !== 250) throw new Error(`the reader's pixel was written down as ${read('viewHandoff.readerScrollTop')}`);
    if (read('pendingViewAtTop') !== false) throw new Error('a reader part way down a document was recorded as sitting at the top');
    if (read('pendingCodeViewSrcOffset') !== 150) throw new Error(`the source view was sent to ${read('pendingCodeViewSrcOffset')} rather than the block being read at the top of the reading view`);
    if (!sent.some((one) => one.command === 'enterCodeView')) throw new Error(`the press asked the host for nothing: ${JSON.stringify(sent)}`);

    // From the very top there is no block to align on, so the other view is told to land flush at its own top.
    app.scrollTop = 0;
    vm.runInContext('pendingViewAtTop = false;', context);
    context.toggleCodeView();
    if (read('pendingViewAtTop') !== true) throw new Error('a reader at the top of the document was not recorded as being there');
    if (read('pendingCodeViewSrcOffset') !== 0) throw new Error(`the top of the document took the offset ${read('pendingCodeViewSrcOffset')}`);
  });

  // A full-window table, picture or diagram is built inside the reading view, so the write below takes it away whether or not anything was told. Only the diagram was, which left a term raised out of a table standing over a document it never came from — and, once the bubble is handed to one of these, a view nobody ever closed holding it down for the rest of the launch.
  check('a render takes a full-window table and picture down through their own closes before it replaces the reading view', () => {
    const { context, app, body } = bootReading({ path: 'C:\Notes\wide.md', blocks: [{ srcStart: 0 }] });
    const glossary = context.document.getElementById('glossarySheet');
    // A close waits out its exit animation, and nothing here ever tells a sheet its animation ended, so the fallback runs where it stands.
    const wasTimeout = context.setTimeout;
    context.setTimeout = (fn) => { fn(); return 0; };
    // What was still standing on the reading view at the one moment the render replaces it. A view swept away answers here; a view closed first does not.
    const own = Object.getOwnPropertyDescriptor(app, 'innerHTML');
    const sweeps = [];
    Object.defineProperty(app, 'innerHTML', {
      get: own.get,
      set: (value) => {
        sweeps.push(app.children.map((child) => String(child.className || '')).join(' '));
        own.set(value);
      },
      configurable: true,
      enumerable: true,
    });
    try {
      body.innerHTML = '<table data-block-kind="table"><thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody></table><img src="leaf-asset://one.png" alt="One">';
      const table = body.querySelector('table');
      const picture = body.querySelector('img');
      if (!table || !picture) throw new Error('the document was drawn without a table or a picture to open');

      context.openTableSheet(table, null);
      if (!app.querySelector('.table-sheet-overlay')) throw new Error('the full-window table did not open');
      // A term raised out of that table, which only the table's own close dismisses.
      context.showGlossary();
      if (glossary.hidden) throw new Error('the term raised out of the table did not come up');

      sweeps.length = 0;
      renderReadingDocument(context, { path: 'C:\Notes\other.md', blocks: [{ srcStart: 0 }] });
      if (sweeps.length !== 1) throw new Error(`the render replaced the reading view ${sweeps.length} times`);
      if (sweeps[0].includes('table-sheet-overlay')) throw new Error('the render swept the full-window table away rather than closing it');
      if (!glossary.hidden) throw new Error('the term raised out of the table was left standing over a document it never came from');

      const fresh = context.document.getElementById('app').querySelector('.document-body');
      fresh.innerHTML = '<img src="leaf-asset://two.png" alt="Two">';
      context.openImageSheet(fresh.querySelector('img'), null);
      if (!app.querySelector('.image-sheet-overlay')) throw new Error('the full-window picture did not open');

      sweeps.length = 0;
      renderReadingDocument(context, { path: 'C:\Notes\third.md', blocks: [{ srcStart: 0 }] });
      if (sweeps.length !== 1) throw new Error(`the second render replaced the reading view ${sweeps.length} times`);
      if (sweeps[0].includes('image-sheet-overlay')) throw new Error('the render swept the full-window picture away rather than closing it');

      // The swap into the code view replaces the same reading view, so it owes the same three closes.
      const third = context.document.getElementById('app').querySelector('.document-body');
      third.innerHTML = '<table data-block-kind="table"><thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody></table>';
      context.openTableSheet(third.querySelector('table'), null);
      if (!app.querySelector('.table-sheet-overlay')) throw new Error('the full-window table did not open again');

      sweeps.length = 0;
      context.renderCodeView({ text: 'one\ntwo\nthree\n' });
      if (sweeps.length !== 1) throw new Error(`the swap into the code view replaced the reading view ${sweeps.length} times`);
      if (sweeps[0].includes('table-sheet-overlay')) throw new Error('the swap into the code view swept the full-window table away rather than closing it');
    } finally {
      Object.defineProperty(app, 'innerHTML', own);
      context.setTimeout = wasTimeout;
    }
  });

  // ---- 4d. every way of opening a page draws one page and queues nothing -----
  //
  // A copy of the page being left laid over the one arriving delays every destination and moves a document after its bytes are ready, so the write that draws the new page is the whole of it: one layer, at full strength, with no clone, no direction and nothing waiting to be cleaned up afterwards.

  const oneLayerOnly = (app, how) => {
    const layers = app.querySelectorAll('.reader-layout');
    if (layers.length !== 1) throw new Error(`${how} left ${layers.length} layers on screen rather than one`);
    const [live] = layers;
    if (live.classList.contains('is-arriving')) throw new Error(`${how} left the page wearing an arrival`);
    if (live.classList.contains('is-swapping-in')) throw new Error(`${how} left the page wearing a travel`);
    if (live.style.getPropertyValue('--reader-leaving-offset')) throw new Error(`${how} held the page at an offset`);
    if (String(app.className).includes('is-swapping')) throw new Error(`${how} left the reader wearing a move`);
    if (app.dataset.going !== undefined) throw new Error(`${how} left a direction on the reader`);
    return live;
  };

  check('opening a different document, a link, Back and Forward each draw one page', () => {
    const { context, app } = bootReading({ path: 'C:\Notes\first.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    context.__frames.drain();
    oneLayerOnly(app, 'a page at rest');
    const restingScrollHeight = app.scrollHeight;

    // Part way down the page being left, which is where the copy used to be mounted and held.
    app.scrollTop = 240;
    renderReadingDocument(context, { path: 'C:\Notes\second.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }, { srcStart: 90 }] });
    const live = oneLayerOnly(app, 'following a link');
    if (live.querySelector('.document-body').children.length !== 3) throw new Error('the page that arrived is not the one that was opened');
    // One layer takes the reader's own scroll, exactly as one always did.
    if (app.scrollHeight !== restingScrollHeight) throw new Error(`the page that arrived took the reader's scroll from ${restingScrollHeight} to ${app.scrollHeight}`);
    context.__frames.drain();
    if (app.scrollTop !== 0) throw new Error(`the page that arrived came to rest at ${app.scrollTop} rather than at its own top`);

    // Back and Forward come back on the same path a link does, and read the same on screen.
    vm.runInContext("sendNavigationCommand('goBack')", context);
    renderReadingDocument(context, { path: 'C:\Notes\first.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    oneLayerOnly(app, 'pressing Back');
    vm.runInContext("sendNavigationCommand('goForward')", context);
    renderReadingDocument(context, { path: 'C:\Notes\second.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }, { srcStart: 90 }] });
    oneLayerOnly(app, 'pressing Forward');
  });

  check('a render queues no cleanup, so a live reload and a second open move nothing', () => {
    const { context, app } = bootReading({ path: 'C:\Notes\held.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    context.__frames.drain();

    // A live reload: the same document, re-read off the disk. Nobody went anywhere.
    context.window.leafReloadDocument(vm.runInContext('currentState', context));
    oneLayerOnly(app, 'a live reload');

    // And a second open landing straight after the first: there is no timer and no listener left over from the one before it.
    renderReadingDocument(context, { path: 'C:\Notes\next.md', blocks: [{ srcStart: 0 }] });
    renderReadingDocument(context, { path: 'C:\Notes\third.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
    const live = oneLayerOnly(app, 'a second open landing on the first');
    if (live.querySelector('.document-body').children.length !== 2) throw new Error('the page left standing is not the one opened last');
  });
}
