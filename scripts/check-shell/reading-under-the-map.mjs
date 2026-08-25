// The reading view's place while the map covers it.

import vm from 'node:vm';
import {
  bootReading,
  check,
  record,
  registrationsOn,
  renderReadingDocument,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 4d. the reading view's place while the map covers it --------------------
  //
  // The map hides `#app` outright, and a hidden element measures zero on every box it has — so a place captured while the map is up is measured against blocks whose rects all read zero, and the search for the topmost visible one falls through to the last block of the document, which is the very bottom of the page. The checks below hide the reader the way a window does, with every rect flattened, and drive the three paths that would otherwise write that answer down.

  /** Hide the reader the way the window does: no box at all, on the surface and on every block in it. Hands back the reveal, which puts the geometry it took back. */
  function hideTheReader(app, body) {
    const flat = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    const was = { app: app.getBoundingClientRect, body: body.getBoundingClientRect, scrollHeight: app.scrollHeight, clientHeight: app.clientHeight };
    const blocks = body.children.map((child) => child.getBoundingClientRect);
    app.hidden = true;
    app.getBoundingClientRect = flat;
    body.getBoundingClientRect = flat;
    body.children.forEach((child) => { child.getBoundingClientRect = flat; });
    app.scrollHeight = 0;
    app.clientHeight = 0;
    return () => {
      app.hidden = false;
      app.getBoundingClientRect = was.app;
      body.getBoundingClientRect = was.body;
      body.children.forEach((child, at) => { child.getBoundingClientRect = blocks[at]; });
      app.scrollHeight = was.scrollHeight;
      app.clientHeight = was.clientHeight;
    };
  }

  /** The reader's place as the page writes it down, ready to compare across a trip into the map. */
  function anchorOn(context) {
    return JSON.stringify(vm.runInContext('readerScrollAnchor', context));
  }

  check('a reader that is off screen answers no place rather than the last block of the document', () => {
    const path = 'C:\Notes\long.md';
    const { context, app, body } = bootReading({
      path,
      blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }, { srcStart: 150, top: 2700 }],
    });
    context.__frames.drain();
    // Part way down, with the third block at the top edge — the place the reader is holding when they press the map.
    app.scrollTop = 1800;
    context.refreshReaderScrollAnchor();
    const halfway = anchorOn(context);
    if (JSON.parse(halfway).block !== 2) throw new Error(`the reader's place was written down as ${halfway} rather than the block at the top edge`);

    const reveal = hideTheReader(app, body);
    try {
      if (context.captureReaderScrollAnchor() !== null) {
        throw new Error(`a reader with no box to measure still answered ${JSON.stringify(context.captureReaderScrollAnchor())}`);
      }
      // And the re-record leaves the place standing rather than writing that nothing over it.
      context.refreshReaderScrollAnchor();
      if (anchorOn(context) !== halfway) throw new Error(`the reader's place became ${anchorOn(context)} while it was off screen`);
    } finally {
      reveal();
    }
  });

  check('the map going up over the reading view leaves the reader on the block they were reading', () => {
    const path = 'C:\Notes\long.md';
    const { context, app, body } = bootReading({
      path,
      blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }, { srcStart: 150, top: 2700 }],
    });
    context.__frames.drain();
    app.scrollTop = 1800;
    context.refreshReaderScrollAnchor();
    const halfway = anchorOn(context);

    const [watch] = registrationsOn(context.__watchers, 'ResizeObserver', body);
    if (!watch) throw new Error('the render left nothing watching the document for reflow, so the map hiding it fires nothing');
    const reveal = hideTheReader(app, body);
    try {
      // Hiding the surface is a resize, which is what wakes the watcher while there is nothing left to measure.
      watch.callback([{ target: body, contentRect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }], watch);
      context.__frames.drain();
      if (anchorOn(context) !== halfway) {
        throw new Error(`the map going up moved the reader's place to ${anchorOn(context)}, and the last block of this document is block 3`);
      }
    } finally {
      reveal();
    }
    // Back on screen, the pass that was held off runs and pins the reader to the block they left off on.
    context.scheduleReaderLayoutUpdate();
    context.__frames.drain();
    if (app.scrollTop !== 1800) throw new Error(`coming back out of the map left the reader at ${app.scrollTop} rather than where they were`);
  });

  check('a layout pass queued while the map is up is dropped by the source render rather than landing on a document that has gone', () => {
    const path = 'C:\Notes\long.md';
    const { context, app, body } = bootReading({
      path,
      blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }],
    });
    context.__frames.drain();
    app.scrollTop = 900;
    context.refreshReaderScrollAnchor();
    const place = anchorOn(context);

    // The map's reveal queues one, and the source render replaces the whole document a moment later — so the pass would wake with nothing under it to measure.
    context.scheduleReaderLayoutUpdate();
    if (context.__frames.waiting() !== 1) throw new Error('nothing was queued, so this check is watching nothing');
    context.renderCodeView({ text: 'one\ntwo\nthree\n' });
    if (context.__frames.waiting() !== 0) throw new Error('the source render left a layout pass queued against the document it had just taken away');
    context.__frames.drain();
    if (anchorOn(context) !== place) throw new Error(`the trip into the source view wrote the reader's place away: ${anchorOn(context)}`);
  });

  // The other half of the same trip: out of the map into the source view. `showGraph` wants a WebGL context no stand-in page has, so the map is put up the way `setGraphView` puts it up — the place taken first, then the flag — and the reader hidden the way the window hides it.
  check('the source view opened out of the map lands on the block the reader was on', () => {
    const path = 'C:\Notes\long.md';
    const { context, app, body } = bootReading({
      path,
      blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }, { srcStart: 150, top: 2700 }],
    });
    context.__frames.drain();
    context.ipc = { postMessage: () => {} };
    app.scrollTop = 1800;
    context.refreshReaderScrollAnchor();

    context.takeGraphExitPlace();
    const taken = () => JSON.parse(vm.runInContext('JSON.stringify(viewHandoff)', context));
    if (taken().graphReaderScrollTop !== 1800) throw new Error(`the map took the reader's pixel as ${taken().graphReaderScrollTop}`);
    if (taken().graphReaderSrcOffset !== 90) throw new Error(`the map took the block at the top as source offset ${taken().graphReaderSrcOffset} rather than the third block's 90`);
    vm.runInContext('graphViewOpen = true;', context);
    const reveal = hideTheReader(app, body);
    try {
      context.toggleCodeView();
      const read = (name) => vm.runInContext(name, context);
      if (read('pendingViewAtTop') !== false) throw new Error('a reader half way down a document was recorded as sitting at the top of it, which is what defeats the landing below');
      if (read('pendingCodeViewSrcOffset') !== 90) throw new Error(`the source view was sent to ${read('pendingCodeViewSrcOffset')} rather than the block the reader was on`);
      if (read('viewHandoff.readerScrollTop') !== 1800) throw new Error(`the reading view's own pixel was written down as ${read('viewHandoff.readerScrollTop')}`);
      if (read('pendingViewScrollFraction') !== 0.2) throw new Error(`the fallback fraction was taken off the hidden reader: ${read('pendingViewScrollFraction')}`);
    } finally {
      reveal();
      vm.runInContext('graphViewOpen = false;', context);
    }
  });

  check('the source view opened out of the map comes back to the scroll it was left at', () => {
    const path = 'C:\Notes\long.md';
    const { context, app, body } = bootReading({ path, blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }] });
    context.__frames.drain();
    context.ipc = { postMessage: () => {} };
    const editor = {
      __scrollTop: 5000,
      __revealed: null,
      getScrollTop() { return this.__scrollTop; },
      setScrollTop(next) { this.__scrollTop = next; },
      getScrollHeight: () => 10000,
      getLayoutInfo: () => ({ height: 1000 }),
      revealLineNearTop(line) { this.__revealed = line; },
      // Leaving the source view asks which line is at the top, so the reading view can land on the block holding it, and reads the buffer back to keep the page's copy of the source in step.
      getVisibleRanges: () => [{ startLineNumber: 2 }],
      getValue: () => 'one\ntwo\nthree\n',
    };
    context.__fakeMonaco = editor;
    // In the source view, 5,000 down, and the toggle put it there — so the record holds the reading view's pixel from the way in.
    vm.runInContext('monacoEditor = __fakeMonaco; monacoEditorPath = null; codeViewActive = true;', context);
    vm.runInContext(`viewHandoff = { path: ${JSON.stringify(path)}, readerScrollTop: 900, codeScrollTop: 5000, readerLanded: 900, codeLanded: 5000, graphFromCodeView: false, graphReaderScrollTop: null, graphReaderFraction: null, graphReaderSrcOffset: null, restoreExact: false };`, context);

    // The Map button out of the source view: the toggle leaves for the reading view first, then the map goes up over it.
    context.toggleCodeView();
    context.takeGraphExitPlace();
    if (vm.runInContext('viewHandoff.graphFromCodeView', context) !== true) {
      throw new Error('the map did not record that it was entered from the source view, which is the one thing that decides what the way out spends');
    }
    vm.runInContext('graphViewOpen = true; codeViewActive = false; monacoEditor = null;', context);
    const reveal = hideTheReader(app, body);
    try {
      // And the Source button out of the map.
      context.toggleCodeView();
      if (vm.runInContext('viewHandoff.restoreExact', context) !== true) {
        throw new Error("the source view's own pixel was left sitting in the record unspent, which is the fault this phase is about");
      }
      const built = { ...editor, __scrollTop: 0, __revealed: null };
      context.__fakeMonaco = built;
      vm.runInContext('monacoEditor = __fakeMonaco; codeViewActive = true;', context);
      context.landNewCodeEditor('one\ntwo\nthree\n');
      if (built.getScrollTop() !== 5000) throw new Error(`the source view came back at ${built.getScrollTop()} rather than the 5,000 it was left at`);
    } finally {
      reveal();
      vm.runInContext('graphViewOpen = false; codeViewActive = false; monacoEditor = null; monacoEditorPath = null; viewHandoff = null;', context);
    }
  });
  // ---- the reading view's place on the way back out of the map ----------------
  //
  // The Map button pressed in the source view leaves that view first, so the reading render arrives while the map is already over it. Every landing that render could run writes a pixel and reads it straight back, and a page with no box reads zero — so the place the toggle computed is spent on nothing and the reader comes back at the top. The checks below hold the render's own geometry flat across the frames the landing runs in, which is the only way a landing spent too early is told apart from one that landed.

  /** The whole trip: reading view, into the source at a known line, Map, and the host's reading render arriving underneath it. Hands back the page and the reveal, stopped at the moment before Reading is pressed. */
  function intoTheMapFromTheSource(path, blocks) {
    const booted = bootReading({ path, blocks });
    const { context } = booted;
    context.__frames.drain();
    context.ipc = { postMessage: () => {} };
    // In the source view, scrolled down, and scrolled by hand since the toggle put it there — so the reading view's own pixel is stale and the source line is what the landing has to use.
    const editor = {
      __scrollTop: 5000,
      getScrollTop() { return this.__scrollTop; },
      setScrollTop(next) { this.__scrollTop = next; },
      getScrollHeight: () => 10000,
      getLayoutInfo: () => ({ height: 1000 }),
      revealLineNearTop() {},
      getVisibleRanges: () => [{ startLineNumber: 3 }],
      getValue: () => 'one\ntwo\nthree\nfour\n',
    };
    context.__fakeMonaco = editor;
    vm.runInContext('monacoEditor = __fakeMonaco; monacoEditorPath = null; codeViewActive = true;', context);
    vm.runInContext(
      'viewHandoff = { path: ' + JSON.stringify(path) + ', readerScrollTop: 900, codeScrollTop: 5000, readerLanded: 900, codeLanded: 3000, graphFromCodeView: false, graphReaderScrollTop: null, graphReaderFraction: null, graphReaderSrcOffset: null, restoreExact: false };',
      context,
    );

    // Map: the toggle leaves the source view and writes down the block holding its top line, then the map goes up over the reading view that has not arrived yet.
    context.toggleCodeView();
    context.takeGraphExitPlace();
    vm.runInContext('graphViewOpen = true; monacoEditor = null;', context);
    const app = context.document.getElementById('app');
    app.hidden = true;

    // The host's reading render, under the map. Its geometry is flattened straight after, before any frame runs, because that is what a landing scheduled by this render would actually measure.
    app.scrollTop = 0;
    renderReadingDocument(context, { path, blocks });
    const body = app.querySelector('.document-body');
    const reveal = hideTheReader(app, body);
    context.__frames.drain();
    return { context, app, body, reveal };
  }

  /** Reading pressed: the boxes come back, and the map's one reveal is what spends whatever the render held. */
  function pressReading(context, reveal) {
    reveal();
    vm.runInContext('graphViewOpen = false;', context);
    context.applyGraphView();
    context.__frames.drain();
  }

  const FOUR = [{ srcStart: 0, top: 0 }, { srcStart: 4, top: 900 }, { srcStart: 8, top: 1800 }, { srcStart: 12, top: 2700 }];

  check('a reading render that runs while the reader is off screen keeps its landing rather than spending it on nothing', () => {
    const path = 'C:\\Notes\\long.md';
    const { context, app, reveal } = intoTheMapFromTheSource(path, FOUR);
    try {
      const read = (name) => vm.runInContext(name, context);
      if (read('heldReadingLandingPath') !== path) {
        throw new Error('the render under the map noted no held landing, so the reveal has nothing to spend');
      }
      if (read('pendingReadingSrcOffset') !== 8) {
        throw new Error('the block the source view was on was spent by the render under the map: pendingReadingSrcOffset is ' + read('pendingReadingSrcOffset'));
      }
      if (read('pendingViewScrollFraction') == null) throw new Error('the landing lost its fallback fraction under the map');
      if (read('viewHandoff.readerLanded') !== 900) {
        throw new Error('the render counted itself landed at ' + read('viewHandoff.readerLanded') + ', which is a page with no box reading its own write back as zero');
      }
      if (app.scrollTop !== 0) throw new Error('a page with no box was scrolled to ' + app.scrollTop);
    } finally {
      reveal();
      vm.runInContext('graphViewOpen = false; codeViewActive = false; monacoEditor = null; monacoEditorPath = null; viewHandoff = null; heldReadingLandingPath = null;', context);
    }
  });

  check('leaving the map for the reading view lands on the block the source view was showing', () => {
    const path = 'C:\\Notes\\long.md';
    const { context, app, reveal } = intoTheMapFromTheSource(path, FOUR);
    try {
      pressReading(context, reveal);
      if (app.scrollTop !== 1800) {
        throw new Error('leaving the map put the reader at ' + app.scrollTop + ' rather than 1800, the block holding the line the source view was on');
      }
      // And the pass the reveal wakes finds the anchor the landing re-recorded, so it pins the block rather than the top of the document.
      const anchor = JSON.parse(vm.runInContext('JSON.stringify(readerScrollAnchor)', context));
      if (!anchor || anchor.block !== 2) {
        throw new Error('the landing left the reader\'s place written down as ' + JSON.stringify(anchor) + ', so the reveal\'s reflow pass would pin the top of the document over it');
      }
      context.scheduleReaderLayoutUpdate();
      context.__frames.drain();
      if (app.scrollTop !== 1800) throw new Error('the reflow pass the reveal wakes threw the landing away, leaving the reader at ' + app.scrollTop);
    } finally {
      vm.runInContext('graphViewOpen = false; codeViewActive = false; monacoEditor = null; monacoEditorPath = null; viewHandoff = null; heldReadingLandingPath = null;', context);
    }
  });

  check('a held landing is spent once, and a document opened under the map replaces it rather than landing the last one place', () => {
    const path = 'C:\\Notes\\long.md';
    const other = 'C:\\Notes\\other.md';
    const { context, app, reveal } = intoTheMapFromTheSource(path, FOUR);
    try {
      // Clicking a node keeps the map up on purpose, so the next document renders off screen too — and its landing is its own, not the one taken in the file before it.
      reveal();
      app.hidden = true;
      app.scrollTop = 0;
      renderReadingDocument(context, { path: other, blocks: FOUR });
      const second = hideTheReader(app, app.querySelector('.document-body'));
      context.__frames.drain();
      if (vm.runInContext('heldReadingLandingPath', context) !== other) {
        throw new Error('the second document did not take the held landing over, so the reveal would spend the first one place on it');
      }
      pressReading(context, second);
      if (app.scrollTop !== 0) {
        throw new Error('a document opened under the map came back at ' + app.scrollTop + ', which is where the reader was in the file before it');
      }
      // Spent: a second reveal finds nothing held and leaves a reader who has since scrolled where they are.
      app.scrollTop = 500;
      context.applyGraphView();
      context.__frames.drain();
      if (app.scrollTop !== 500) throw new Error('the held landing ran a second time and moved the reader to ' + app.scrollTop);
    } finally {
      vm.runInContext('graphViewOpen = false; codeViewActive = false; monacoEditor = null; monacoEditorPath = null; viewHandoff = null; heldReadingLandingPath = null;', context);
    }
  });
}
