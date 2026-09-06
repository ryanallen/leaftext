// The map, and the rail the minimap draws down the page's edge.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  VIEW_WIDTH,
  check,
  fakeElement,
  pageMarkup,
  record,
  root,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // The two halves of a node press, sliced out of the fragment the way the flowchart canvas handler is above: what each one sends is one line, and neither is reachable without a real Pixi stage.
  const nodePressBranches = () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/graph-scene.js'), 'utf8');
    const opened = fragment.indexOf('const endPress = (event) => {');
    const closed = fragment.indexOf("stage.on('pointerup', endPress)");
    if (opened < 0 || closed < opened) throw new Error('could not find the node press handler');
    const handler = fragment.slice(opened, closed);
    const external = handler.indexOf('if (!moved && node.external)');
    const document_ = handler.indexOf('} else if (!moved) {');
    if (external < 0 || document_ < external) throw new Error('the press no longer splits a web address from a document');
    return { external: handler.slice(external, document_), document: handler.slice(document_) };
  };

  // Reading a map is a loop — read a name, go there, see what that one links to — and arming the exit ended the loop on every hop, while opening the same file from the pane (`library.js`) always kept the map up. Two controls for one act, disagreeing.
  check('clicking a node opens the document and stays on the map', () => {
    const { document: forDocument } = nodePressBranches();
    if (!/send\(\{ command: 'openRecent', path: node\.path \}\)/.test(forDocument)) {
      throw new Error('the document branch no longer opens the document');
    }
    if (/graphExitPending/.test(forDocument)) throw new Error('the document branch arms the exit, so the map closes on every hop');
  });

  // The branch beside it was already the behavior the one above just gained: nothing replaced the page, so there is nothing to leave the map for.
  check('a web address opens in the browser and never moves the map', () => {
    const { external } = nodePressBranches();
    if (!/send\(\{ command: 'openExternal', url: node\.path \}\)/.test(external)) {
      throw new Error('a web address no longer opens in the browser');
    }
    if (/graphExitPending/.test(external)) throw new Error('a web address arms the exit');
  });

  // What the click now rides on: `leafSetState` hands the opened file to `followFileInLibrary`, which calls this. Its two branches are the whole behavior — a picture that is now about the wrong file is refetched, and one that already holds the node is kept and flown to. Neither is reachable through a real scene here, so the three functions it ends in are swapped for spies; they are declarations, so the booted page carries them as properties, while `graphViewOpen` and the rest are top-level `let`s and are written into the same global lexical scope a later script shares.
  check('with the map up, a new document refetches the slice or keeps the scene', () => {
    const calls = [];
    const spy = (name) => () => { calls.push(name); };
    const original = {
      requestGraphData: booted.requestGraphData,
      applyGraphStyles: booted.applyGraphStyles,
      focusGraphNode: booted.focusGraphNode,
    };
    booted.requestGraphData = spy('refetch');
    booted.applyGraphStyles = spy('recolor');
    booted.focusGraphNode = spy('fly');
    try {
      const setUp = (path, held) => {
        calls.length = 0;
        vm.runInContext(
          `currentState = { recent: [], tabs: [{ path: ${JSON.stringify(path)} }], active: 0, document: {} };` +
            'graphViewOpen = true; graphScope = \'small\'; activeVaultId = 0;' +
            `graphScene = { nodeByPath: new Map(${JSON.stringify(held.map((p) => [p, { path: p }]))}) };` +
            `graphSeedKey = ${JSON.stringify(held.length ? 'small|' + path : 'small|somewhere/else.md')};`,
          booted,
        );
      };

      // A document the scene never drew: the seeds changed, so the map in memory is of the file you left.
      setUp('notes/new.md', []);
      booted.graphSetActive('notes/new.md', true);
      if (calls.join(',') !== 'refetch') throw new Error(`a document off the map gave ${calls.join(',') || 'nothing'}`);

      // A document already on it: keep the picture, move the highlight, fly the camera.
      setUp('notes/held.md', ['notes/held.md']);
      booted.graphSetActive('notes/held.md', true);
      if (calls.join(',') !== 'recolor,fly') throw new Error(`a document on the map gave ${calls.join(',') || 'nothing'}`);
    } finally {
      Object.assign(booted, original);
    }
  });

  // Leaving the map destroys the drawing, and the camera goes with it unless something takes it first — a reader who has zoomed into one corner of a vault comes back to a fresh auto-fit of the whole thicket. What outlives the scene is taken on the one path that means the view is being left.
  check('the camera the map was left at is answered once, and only for the same picture', () => {
    const { keptGraphCameraFor, graphSignature } = booted;
    const same = { nodes: [{ path: 'a.md', degree: 1 }, { path: 'b.md', degree: 1 }], edges: [{ source: 'a.md', target: 'b.md' }] };
    const other = { nodes: [{ path: 'a.md', degree: 1 }, { path: 'c.md', degree: 2 }], edges: [] };
    const arm = () => vm.runInContext(
      `keptGraphCamera = { positions: new Map(), autoFit: false, settled: true, scale: 4, x: 1547.87, y: 1099, signature: ${JSON.stringify(graphSignature(same))} };`,
      booted,
    );
    arm();
    const answered = keptGraphCameraFor(same);
    if (!answered || answered.scale !== 4) throw new Error('a payload drawing the same picture was not handed its camera back');
    if (keptGraphCameraFor(same) !== null) throw new Error('the same camera was handed out twice, so a later map inherits a corner nobody chose for it');
    arm();
    if (keptGraphCameraFor(other) !== null) throw new Error('a different picture was handed the camera of the map before it');
    if (vm.runInContext('keptGraphCamera', booted) !== null) throw new Error('a refused camera was left standing for the map after it');
  });

  // The places go with the camera, and that is not a nicety: without seeded positions the simulation starts cold and d3 throws the whole vault out from the center, so a camera pinned to a corner frames empty space.
  check('leaving the map keeps the framing, the node places and the picture they were taken over', () => {
    const original = { teardownGraphScene: booted.teardownGraphScene, clearReaderLoading: booted.clearReaderLoading };
    booted.teardownGraphScene = () => {};
    booted.clearReaderLoading = () => {};
    try {
      vm.runInContext(
        'keptGraphCamera = null;' +
          'graphScene = { nodes: [{ path: "a.md", x: 11, y: 22 }, { path: "b.md", x: 33, y: 44 }],' +
          ' world: { scale: { x: 4 }, position: { x: 1547.87, y: 1099 } },' +
          ' autoFit: false, settled: true, signature: "one-picture" };',
        booted,
      );
      booted.teardownGraph();
      const kept = vm.runInContext('keptGraphCamera', booted);
      if (!kept) throw new Error('leaving the map kept nothing, so the next open re-frames everything');
      if (kept.scale !== 4 || kept.x !== 1547.87 || kept.y !== 1099) throw new Error(`the framing came back as ${kept.scale} at ${kept.x},${kept.y}`);
      if (kept.autoFit !== false || kept.settled !== true) throw new Error('the flag saying whose framing it is was dropped, so a corner the reader chose reads as one the app chose');
      if (kept.signature !== 'one-picture') throw new Error('the picture it was taken over was dropped, so nothing can tell whether it still applies');
      const seat = kept.positions.get('b.md');
      if (!seat || seat.x !== 33 || seat.y !== 44) throw new Error('the node places were dropped, so the layout starts cold under the kept camera');
      // Nothing on screen to keep, and nothing stale left behind for the map after it either.
      vm.runInContext('graphScene = null;', booted);
      booted.teardownGraph();
      if (vm.runInContext('keptGraphCamera', booted) !== null) throw new Error('leaving with no scene up left a camera behind');
    } finally {
      Object.assign(booted, original);
    }
  });

  check('a geometry-only reflow keeps the reader block list', () => {
    const appEl = booted.document.getElementById('app');
    const body = fakeElement('reader-anchor-source');
    body.className = 'document-body';
    body.innerHTML = '<p>First block.</p><p>Second block.</p>';
    body.children.forEach((block, index) => {
      block.getBoundingClientRect = () => ({ top: index * 40, bottom: (index + 1) * 40 });
    });
    const query = body.querySelectorAll;
    let walks = 0;
    body.querySelectorAll = (selector) => {
      if (String(selector).includes('blockquote')) walks += 1;
      return query.call(body, selector);
    };
    booted.__heldState = vm.runInContext('currentState', booted);
    appEl.appendChild(body);
    try {
      vm.runInContext("currentState = { recent: [], tabs: [{ path: 'long.md' }], active: 0, document: {} };", booted);
      booted.captureReaderScrollAnchor();
      if (walks !== 1) throw new Error(`the first capture walked the document ${walks} times`);
      booted.observeReaderReflow();
      const watch = booted.__watchers.filter((one) => one.kind === 'ResizeObserver' && one.target === body).at(-1);
      if (!watch) throw new Error('the reader body has no reflow watcher to fire');
      watch.callback([{ target: body, contentRect: { width: 800, height: 80 } }], watch);
      booted.__frames.drain();
      booted.captureReaderScrollAnchor();
      if (walks !== 1) throw new Error(`a size-only reflow walked the document ${walks} times`);
    } finally {
      booted.disconnectReaderReflowObserver();
      appEl.removeChild(body);
      vm.runInContext('currentState = __heldState; delete __heldState; readerAnchorBlocks = null; readerAnchorBlocksCount = -1; readerAnchorBlocksSource = null;', booted);
      booted.__frames.drain();
    }
  });

  // The rail's thumbnail is a clone of one slice of the document, and this comparison decides whether the slice on the page still holds what the rail shows. A no asks for another rebuild, on the next animation frame, and a rebuild deep-clones the slice — so a no that can never become a yes is about a gigabyte a minute until the page dies. Numbers here are a real document's: 13,142px tall, scaled to a tenth.
  check('the thumbnail counts as covering the view at the top and the foot', () => {
    const { minimapWindowCoversView } = booted;
    const metrics = { scrollable: 12322, scaledDocumentHeight: 1314.2, trackHeight: 700, previewScale: 0.1 };
    const covers = (range, scrollTop) => {
      vm.runInContext(`minimapBuiltRange = ${range === null ? 'null' : JSON.stringify(range)};`, booted);
      return minimapWindowCoversView(metrics, scrollTop);
    };
    try {
      const ends = { top: 0, bottom: 13142 };
      if (!covers(ends, 0)) throw new Error('a thumbnail holding the whole document still rebuilt at the top');
      if (!covers(ends, 12322)) throw new Error('a thumbnail holding the whole document still rebuilt at the foot');
      // Measured off the rows alone, which is what shipped: the first block starts below the layout's padding and the last ends above it, so the view reaches past both ends of the clone and neither end can ever agree.
      const rowsOnly = { top: 87.85, bottom: 13058 };
      if (covers(rowsOnly, 0) || covers(rowsOnly, 12322)) throw new Error('the rows-only range passes now, so this proves nothing');
      // A slice out of the middle still rebuilds when the reader leaves it, and still does not when they have not.
      const middle = { top: 3000, bottom: 10100 };
      if (covers(middle, 0)) throw new Error('a scroll above the built slice stopped rebuilding');
      if (covers(middle, 12322)) throw new Error('a scroll below the built slice stopped rebuilding');
      if (!covers(middle, 6161)) throw new Error('a view inside the built slice rebuilt anyway');
      // A short document is not windowed, so there is no slice to leave.
      if (!covers(null, 0)) throw new Error('a document with no window asked for a rebuild');
    } finally {
      vm.runInContext('minimapBuiltRange = null;', booted);
    }
  });


  // The same comparison over the slice a descent leaves behind. Two numbers claiming the document's own ends from inside a block answer yes to both of these and the rail never asks for the picture back — the whole of the fault, in the one call every path into a rebuild makes first.
  check('a view outside a slice taken from inside a long block asks for a rebuild', () => {
    const { minimapWindowCoversView } = booted;
    const metrics = { scrollable: 12322, scaledDocumentHeight: 1314.2, trackHeight: 700, previewScale: 0.1 };
    const covers = (range, scrollTop) => {
      vm.runInContext(`minimapBuiltRange = ${JSON.stringify(range)};`, booted);
      return minimapWindowCoversView(metrics, scrollTop);
    };
    try {
      // A block spanning 2,000 to 11,000 of a 13,142px document, with the slice taking its edges rather than the document's.
      const block = { top: 2000, bottom: 11000 };
      if (covers(block, 12322)) throw new Error('a reader below the block was told the thumbnail already holds where they are');
      if (covers(block, 0)) throw new Error('a reader above the block was told the thumbnail already holds where they are');
      if (!covers(block, 6161)) throw new Error('a reader inside the block rebuilt anyway');
      // What shipped, for as long as the rail was blank: the same clone claiming the whole document.
      const claimed = { top: 0, bottom: 13142 };
      if (!covers(claimed, 12322) || !covers(claimed, 0)) throw new Error('the widened range fails now, so this proves nothing about what the fix took away');
    } finally {
      vm.runInContext('minimapBuiltRange = null;', booted);
    }
  });

  // The keep-it half. This answers without asking the guard at all, which is the whole point: a guard that starts failing again for some later reason costs one comparison rather than a rebuild every frame for as long as the window is open.
  check('a rebuild that would clone the same rows keeps the thumbnail', () => {
    const { minimapRebuildWouldChangeNothing } = booted;
    const metrics = { sourceWidth: 800 };
    const built = (extra = '') => vm.runInContext(
      'minimapContentVersion = 7; minimapBuiltVersion = 7; minimapBuiltSourceWidth = 800;'
        + 'minimapBuiltPreviewWidth = 90; minimapBuiltFrameWidth = 760;'
        + `minimapBuiltFirstRow = 12; minimapBuiltLastRow = 40; minimapBuiltRowPath = '1/0';`
        + `minimapBuiltSlack = 1;${extra}`,
      booted,
    );
    try {
      built();
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0')) throw new Error('an untouched document rebuilt its thumbnail anyway');
      // Everything that shapes a clone still forces one.
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 13, 40, '1/0')) throw new Error('a scroll into a new slice kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 41, '1/0')) throw new Error('a slice ending on a new row kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '2/0')) throw new Error('the same local row numbers in another large block kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 91, 760, 12, 40, '1/0')) throw new Error('a wider rail kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 800, 12, 40, '1/0')) throw new Error('more room for the layout kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing({ sourceWidth: 900 }, 90, 760, 12, 40, '1/0')) throw new Error('a rewrapped document kept the old thumbnail');
      built('minimapContentVersion = 8;');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0')) throw new Error('an edited document kept the old thumbnail');
    } finally {
      vm.runInContext(
        'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
          + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1;'
          + "minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1; minimapBuiltRowPath = '';"
          + 'minimapBuiltSlack = -1;',
        booted,
      );
    }
  });

  // The widening turn rebuilds the same rows out of the same document at the same widths, so the skip guard has to count the slack to let it through.
  check('the slack the standing clone holds is one of the things the skip guard counts', () => {
    const { minimapRebuildWouldChangeNothing } = booted;
    const metrics = { sourceWidth: 800 };
    const built = (slack) => vm.runInContext(
      'minimapContentVersion = 7; minimapBuiltVersion = 7; minimapBuiltSourceWidth = 800;'
        + 'minimapBuiltPreviewWidth = 90; minimapBuiltFrameWidth = 760;'
        + `minimapBuiltFirstRow = 12; minimapBuiltLastRow = 40; minimapBuiltRowPath = '1/0'; minimapBuiltSlack = ${slack};`,
      booted,
    );
    try {
      built(0);
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0', 1)) throw new Error('the turn that widens a narrow thumbnail was refused, so the rail stays one screen wide');
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0', 0)) throw new Error('a narrow rebuild over a narrow thumbnail asked for another');
      built(1);
      // The other way round: a clone already holding the screen either side answers a narrow ask without drawing anything.
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0', 0)) throw new Error('a narrow rebuild threw away a wider thumbnail that already held its rows');
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0', 1)) throw new Error('an untouched wide thumbnail rebuilt itself anyway');
    } finally {
      vm.runInContext(
        'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
          + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1;'
          + "minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1; minimapBuiltRowPath = '';"
          + 'minimapBuiltSlack = -1;',
        booted,
      );
    }
  });

  // A sliced carried edge reaches only as far as the range it was asked for, so the same row numbers can stand for two different clones. The guard counts that, or a reader moving out of one long table into the next keeps a thumbnail cut short of where they now are.
  check('a thumbnail whose carried edge was sliced asks for a rebuild over the same rows', () => {
    const { minimapRebuildWouldChangeNothing } = booted;
    const metrics = { sourceWidth: 800 };
    const built = (sliced) => vm.runInContext(
      'minimapContentVersion = 7; minimapBuiltVersion = 7; minimapBuiltSourceWidth = 800;'
        + 'minimapBuiltPreviewWidth = 90; minimapBuiltFrameWidth = 760;'
        + `minimapBuiltFirstRow = 12; minimapBuiltLastRow = 40; minimapBuiltRowPath = '1/0';`
        + `minimapBuiltSlack = 1; minimapBuiltSliced = ${sliced};`,
      booted,
    );
    try {
      built(false);
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0')) throw new Error('a thumbnail built out of whole rows rebuilt itself anyway');
      built(true);
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40, '1/0')) throw new Error('a thumbnail whose carried edge was sliced kept itself over the same rows');
    } finally {
      vm.runInContext(
        'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
          + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1;'
          + "minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1; minimapBuiltRowPath = '';"
          + 'minimapBuiltSlack = -1; minimapBuiltSliced = false;',
        booted,
      );
    }
  });

  // The rail stood up over a document of a hundred twenty-pixel rows, with the two answers the rebuild reads off a real page swapped for known ones — the rail's geometry, and the body it clones. Everything between them is the shipped rebuild, so what these two checks read back is the slice it really built. A 70-pixel track over a 2,000-pixel document drawn at a tenth covers the first 700 pixels of it, which is rows 0 to 35; a screen either side reaches row 70.
  const railOverARowedDocument = (geometry) => {
    const body = fakeElement('rail-slack-source');
    body.className = 'document-body';
    body.innerHTML = Array.from({ length: 100 }, (_, index) => `<p>row ${index}</p>`).join('');
    // The rail reads viewport rectangles and adds the scroll back on, so the rows answer where they are on the screen rather than where they are in the document — which is what lets a check move the reader down the document and read back the slice the rail then builds.
    body.children.forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 20 - metrics.scrollTop, bottom: (index + 1) * 20 - metrics.scrollTop, height: 20, width: 800 });
    });
    const metrics = Object.assign({
      sourceWidth: 800,
      sourceTop: 0,
      scrollHeight: 2000,
      viewportHeight: 700,
      scrollable: 1300,
      scrollTop: 0,
      // The rail's own box on the screen, which a drag maps a pointer through. Every other reader here works in document pixels and never asks for it.
      trackRect: { top: 0, bottom: 70, height: 70, width: 80 },
      trackHeight: 70,
      scaledDocumentHeight: 200,
      previewScale: 0.1,
    }, geometry);
    const was = {
      measure: booted.measureDocumentMinimap,
      source: booted.minimapSourceElement,
      setTimeout: booted.setTimeout,
      clearTimeout: booted.clearTimeout,
    };
    booted.measureDocumentMinimap = () => metrics;
    booted.minimapSourceElement = () => body;
    // The quiet turn, held rather than run: the page's own setTimeout throws its callback away, and a turn nobody can run is one no check can prove came back.
    const turns = { booked: [], cleared: [], next: 1, run: new Map() };
    booted.setTimeout = (fn) => {
      const id = turns.next;
      turns.next += 1;
      turns.run.set(id, fn);
      turns.booked.push(id);
      return id;
    };
    booted.clearTimeout = (id) => {
      turns.cleared.push(id);
      turns.run.delete(id);
    };
    booted.setMinimapMarkup(booted.documentMinimapMarkup());
    const rail = booted.document.getElementById('readerMinimap');
    const content = rail.querySelector('.document-minimap-track').querySelector('.document-minimap-content');
    content.getBoundingClientRect = () => ({ top: 0, bottom: 70, height: 70, width: 80 });
    return {
      turns,
      metrics,
      rail,
      read: (name) => vm.runInContext(name, booted),
      restore: () => {
        booted.measureDocumentMinimap = was.measure;
        booted.minimapSourceElement = was.source;
        booted.setTimeout = was.setTimeout;
        booted.clearTimeout = was.clearTimeout;
        booted.setMinimapMarkup('');
        booted.__frames.drain();
        vm.runInContext(
          'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
            + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1; minimapBuiltRange = null;'
            + "minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1; minimapBuiltRowPath = '';"
            + 'minimapBuiltSlack = -1; minimapPendingSlack = 0; minimapWidenTimer = 0;'
            + 'minimapDragging = false; minimapDragMetrics = null;'
            + 'minimapPointerId = null; minimapPointerOffsetY = null; readerScrolling = false;',
          booted,
        );
      },
    };
  };

  // The whole of a rebuild is the browser laying the slice out, and that falls with the rows in it — three screens is 13.7ms of a 15.6ms rebuild on a long config and one screen about 5. So the words landing draw the track's own screen and nothing either side, and the quiet turn behind them puts back the room a scroll slides into.
  check('a change to the words draws the screen the track covers, and the turn behind it draws one either side', () => {
    const stand = railOverARowedDocument();
    try {
      booted.invalidateMinimapPreview();
      booted.__frames.drain();
      if (stand.read('minimapBuiltSlack') !== 0) throw new Error(`the words changed and the rail still built with ${stand.read('minimapBuiltSlack')} screens either side`);
      const narrow = [stand.read('minimapBuiltFirstRow'), stand.read('minimapBuiltLastRow')];
      if (narrow[0] !== 0 || narrow[1] !== 35) throw new Error(`the words changed and the rail sliced rows ${narrow[0]} to ${narrow[1]} rather than the 0 to 35 its track covers`);
      if (stand.turns.booked.length !== 1) throw new Error('the narrow rebuild booked no quiet turn, so the screen either side never comes back');

      stand.turns.run.get(stand.turns.booked[0])();
      booted.__frames.drain();
      if (stand.read('minimapBuiltSlack') !== 1) throw new Error('the quiet turn came round and left the thumbnail a screen wide');
      const wide = [stand.read('minimapBuiltFirstRow'), stand.read('minimapBuiltLastRow')];
      if (wide[0] !== 0 || wide[1] !== 70) throw new Error(`the quiet turn sliced rows ${wide[0]} to ${wide[1]} rather than the 0 to 70 a screen either side reaches`);
    } finally {
      stand.restore();
    }
  });

  // A turn booked against a document the reader has gone on typing into would clone a slice of the words as they were, so it never runs: each change to the words drops the standing turn and books its own behind itself.
  check('a change to the words drops the turn that was going to widen the thumbnail', () => {
    const stand = railOverARowedDocument();
    try {
      booted.invalidateMinimapPreview();
      booted.__frames.drain();
      const booked = stand.turns.booked[0];

      booted.invalidateMinimapPreview();
      if (!stand.turns.cleared.includes(booked)) throw new Error('the words changed again and the turn booked against the words before them still stood');
      if (stand.turns.run.has(booked)) throw new Error('the dropped turn can still run');
      booted.__frames.drain();
      if (stand.turns.booked.length !== 2) throw new Error('the second change to the words booked no turn of its own, so the screen either side never comes back');
      if (stand.read('minimapWidenTimer') !== stand.turns.booked[1]) throw new Error('the rail is waiting on a turn that is not the one it booked last');
    } finally {
      stand.restore();
    }
  });


  // The rail rebuilding through a gesture, watched through what it asks for. Coverage is answered by a stand rather than the real comparison, because what is held here is when a rebuild is laid out and how wide, not which slice it picks; the schedule is watched through the shipped one, so a rebuild that is asked for still really happens.
  const railThroughAGesture = (geometry) => {
    const stand = railOverARowedDocument(geometry);
    const was = {
      covers: booted.minimapWindowCoversView,
      schedule: booted.scheduleMinimapPreviewUpdate,
      build: booted.updateDocumentMinimapPreview,
    };
    const asks = [];
    // What each rebuild that actually ran was asked for. The frame queue cannot answer this: placing the box and warming the thumbnail book frames of their own, so a count of frames counts those too.
    const builds = [];
    const state = { covers: false };
    // The stand’s own restore, held before this one takes its name: put the page back the way it found it, then hand the rowed stand its own turn.
    const restoreStand = stand.restore;
    // Held either as an answer — the coverage this check wants, whatever is on the track — or as the check's own comparison, for one that has to be answered off the slice really built.
    booted.minimapWindowCoversView = (metrics, scrollTop) => (typeof state.covers === 'function' ? state.covers(metrics, scrollTop) : state.covers);
    booted.scheduleMinimapPreviewUpdate = (slack) => {
      asks.push(slack === undefined ? vm.runInContext('MINIMAP_WINDOW_SLACK', booted) : slack);
      return was.schedule(slack);
    };
    booted.updateDocumentMinimapPreview = (slack) => {
      builds.push(slack === undefined ? vm.runInContext('MINIMAP_WINDOW_SLACK', booted) : slack);
      return was.build(slack);
    };
    return Object.assign(stand, {
      asks,
      builds,
      state,
      // The shipped comparison, for a check whose coverage has to be the built slice's own answer rather than a flag.
      reallyCovers: was.covers,
      frame: () => vm.runInContext('minimapPreviewFrame', booted),
      gestureSlack: vm.runInContext('MINIMAP_GESTURE_SLACK', booted),
      // A wheel notch: the reader moves, the scroll listener has already said a gesture is running, and the rail answers on the frame behind it.
      notch: (scrollTop) => {
        vm.runInContext('app', booted).scrollTop = scrollTop;
        stand.metrics.scrollTop = scrollTop;
        vm.runInContext('readerScrolling = true', booted);
        booted.updateMinimapViewportFromScroll();
      },
      restore: () => {
        booted.minimapWindowCoversView = was.covers;
        booted.scheduleMinimapPreviewUpdate = was.schedule;
        booted.updateDocumentMinimapPreview = was.build;
        restoreStand();
      },
    });
  };

  // The whole of the fault, in the one place the reader feels it: waiting for the wheel to stop left the track holding the position box and nothing beside it for all 399 frames of a 40,000px scroll. The slice is laid out on the moving frame now, narrow — a quarter of a screen either side is a fifth of the layout a rest asks for, which is what makes it affordable there.
  check('a wheel out of the built window rebuilds where the wheel is, asking a quarter of a screen either side', () => {
    const stand = railThroughAGesture();
    try {
      stand.notch(400);
      if (stand.asks.length !== 1) throw new Error(`the wheel left the built window and the rail asked for ${stand.asks.length} rebuilds rather than the one it draws with`);
      if (stand.asks[0] !== stand.gestureSlack) throw new Error(`the moving wheel asked for ${stand.asks[0]} screens either side rather than the gesture's quarter`);
      if (stand.gestureSlack >= 1) throw new Error('a gesture asks for as much as a rest does, so nothing here is narrow');
      if (!stand.frame()) throw new Error('the rail asked for a rebuild and booked no frame to lay it out on');
      stand.state.covers = true;
      booted.__frames.drain();
      if (stand.read('minimapBuiltSlack') !== stand.gestureSlack) throw new Error(`the moving wheel laid out a slice ${stand.read('minimapBuiltSlack')} screens wide rather than the quarter it asked for`);

      // The wheel stops somewhere the narrow slice does not reach, which is where the full one is laid out.
      stand.state.covers = false;
      booted.settleReaderScroll();
      if (stand.asks.length !== 2) throw new Error(`the scroll settled and the rail had asked for ${stand.asks.length} rebuilds rather than the gesture's and the settle's`);
      if (stand.asks[1] !== 1) throw new Error(`the settled rebuild asked for ${stand.asks[1]} screens either side rather than the full one`);
    } finally {
      stand.restore();
    }
  });

  // A fling passes hundreds of positions and lays out none of them: three notches inside one frame ask three times and the frame the rail booked lays out the last of them, so the reader is never shown a slice they have already gone past. The narrow ask is what makes that affordable — the whole screen a rest asks for is five times the layout on a frame the wheel is on.
  check('a fling of notches lays out one narrow slice, for where the scroll got to', () => {
    const stand = railThroughAGesture();
    try {
      stand.notch(200);
      stand.notch(700);
      stand.notch(1300);
      if (stand.asks.length !== 3) throw new Error(`three notches out of the window asked for ${stand.asks.length} rebuilds`);
      const wide = stand.asks.filter((slack) => slack !== stand.gestureSlack);
      if (wide.length) throw new Error(`a notch asked for ${wide.join(', ')} screens either side rather than the gesture's quarter`);
      // The slice the frame lays out holds where the fling got to, which is what the built rail then answers.
      stand.state.covers = true;
      booted.__frames.drain();
      if (stand.builds.length !== 1) throw new Error(`three notches inside one frame laid ${stand.builds.length} slices out rather than the one they coalesce into`);
      if (stand.builds[0] !== stand.gestureSlack) throw new Error(`the fling's one rebuild ran at ${stand.builds[0]} screens either side rather than the gesture's quarter`);
      // A quarter either side of the 700px the track shows is 175px, so the slice starts at 1,125 — row 56 — where a whole screen either side would reach back to row 30.
      const built = [stand.read('minimapBuiltFirstRow'), stand.read('minimapBuiltLastRow')];
      if (built[0] !== 56 || built[1] !== 99) throw new Error(`the fling's rebuild sliced rows ${built[0]} to ${built[1]} rather than the 56 to 99 a quarter either side of where it stopped reaches`);
      if (stand.read('minimapBuiltSlack') !== stand.gestureSlack) throw new Error('the fling laid out a slice wider than the gesture asked for');

      // The fresh measure at the settle can disagree with the cached geometry the gesture answered on, so a settle over a covered view asks for nothing at all.
      stand.state.covers = true;
      booted.settleReaderScroll();
      booted.__frames.drain();
      if (stand.asks.length !== 3) throw new Error('the scroll settled over a slice that already holds the reader and the rail rebuilt anyway');
    } finally {
      stand.restore();
    }
  });

  // The owner's own gesture, and the one the fault was reported on: 95 frames of one drag with no part of the thumbnail on the track. Every move that leaves the built slice draws it again now, narrowly, and the release still lays the full slice out for where the box was let go. Held here through the real handlers, because what is proved is which of them asks and for how much.
  check('a held position box rebuilds as it is dragged, asking a quarter of a screen either side', () => {
    // A track three times the box's height, so the box travels inside it rather than the thumbnail sliding under a full-height box — a drag has nothing to map a pointer through otherwise.
    const stand = railThroughAGesture({
      trackRect: { top: 0, bottom: 200, height: 200, width: 80 },
      trackHeight: 200,
      scaledDocumentHeight: 200,
    });
    try {
      const track = stand.rail.querySelector('.document-minimap-track');
      const box = track.querySelector('.document-minimap-viewport');
      box.getBoundingClientRect = () => ({ top: 0, bottom: 70, height: 70, width: 80 });
      // Standing the rail up builds its first thumbnail over the slice the reader is on, which is not the gesture: the drag starts from a rail that already holds one, the way a reader’s does. The drag then carries the box off that slice.
      stand.state.covers = true;
      booted.bindDocumentMinimap();
      booted.__frames.drain();
      stand.state.covers = false;
      stand.asks.length = 0;
      const press = (track.listeners.get('pointerdown') || [])[0];
      const move = (track.listeners.get('pointermove') || [])[0];
      const release = (track.listeners.get('pointerup') || [])[0];
      if (!press || !move || !release) throw new Error('the rail is not listening for a drag on its own track');
      const pointer = (clientY) => ({ button: 0, pointerId: 7, clientY, preventDefault() {} });

      press(pointer(10));
      for (let step = 20; step <= 100; step += 10) move(pointer(step));
      // The press maps the pointer through too, so the ten asks are its own and the nine moves behind it.
      if (stand.asks.length !== 10) throw new Error(`the box crossed the built window ten times and the rail asked for ${stand.asks.length} rebuilds`);
      const wide = stand.asks.filter((slack) => slack !== stand.gestureSlack);
      if (wide.length) throw new Error(`the held box asked for ${wide.join(', ')} screens either side rather than the gesture's quarter`);
      if (!stand.frame()) throw new Error('the drag crossed the built window and the rail booked no frame to rebuild on');
      const landed = vm.runInContext('app', booted).scrollTop;
      if (landed !== 900) throw new Error(`the drag left the reader at ${landed} rather than the 900 the pointer maps to`);

      release(pointer(100));
      if (stand.asks.length !== 11) throw new Error(`the box was let go and the rail asked for ${stand.asks.length - 10} rebuilds rather than the one full slice for where it landed`);
      if (stand.asks[10] !== 1) throw new Error(`the released rebuild asked for ${stand.asks[10]} screens either side rather than the full one`);
    } finally {
      stand.restore();
    }
  });

  // The narrow slice leaves the rail a quarter of a screen to scroll into either way, so the room a rest has has to come back on its own. Nothing is added for it: a clone built short of the full slack books the quiet turn already, the way the words landing do, and each movement pushes that turn back — so the wide slice lands once the hand stops rather than on a frame it is moving through.
  check('a gesture’s narrow rebuild books the turn that widens it back', () => {
    const stand = railThroughAGesture();
    try {
      // Coverage answered off the slice really built, so each notch past it is a real miss and the rebuild behind it a real rebuild.
      stand.state.covers = (metrics, scrollTop) => !!stand.read('minimapBuiltRange') && stand.reallyCovers(metrics, scrollTop);
      stand.notch(400);
      booted.__frames.drain();
      if (stand.read('minimapBuiltSlack') !== stand.gestureSlack) throw new Error('the gesture laid out a slice that was not narrow, so this proves nothing');
      if (stand.turns.booked.length !== 1) throw new Error(`the narrow rebuild booked ${stand.turns.booked.length} quiet turns rather than the one that puts the room back`);

      // A second notch rebuilds and books its own turn behind itself, dropping the one the notch before it left: the rail never widens onto a position the reader has gone past.
      stand.notch(900);
      booted.__frames.drain();
      if (!stand.turns.cleared.includes(stand.turns.booked[0])) throw new Error('the second notch left the first notch’s turn standing, so the rail can widen onto where the gesture began');
      if (stand.read('minimapWidenTimer') !== stand.turns.booked[stand.turns.booked.length - 1]) throw new Error('the rail is waiting on a turn that is not the one its last rebuild booked');

      stand.turns.run.get(stand.read('minimapWidenTimer'))();
      booted.__frames.drain();
      if (stand.read('minimapBuiltSlack') !== 1) throw new Error(`the quiet turn came round and left the thumbnail ${stand.read('minimapBuiltSlack')} screens wide rather than the full one`);
    } finally {
      stand.restore();
    }
  });

  // Every rebuild ends by asking the coverage question again, and a rebuild takes long enough that the hand is usually past the slice it just laid out. Answered at a rest's whole screen that put a 129.2ms layout back on a moving frame — the exact cost the narrow ask exists to keep out of a gesture — so the closing ask is the gesture's own while a hand is still on the wheel or the box.
  check('the ask a rebuild ends with is the gesture’s own while the hand is still moving', () => {
    const stand = railThroughAGesture();
    try {
      stand.notch(400);
      booted.__frames.drain();
      // The slice that just landed does not hold where the hand has got to by now, which is what the closing ask answers.
      const gestureAsks = stand.asks.slice(1);
      if (!gestureAsks.length) throw new Error('the rebuild never asked again on its way out, so this proves nothing');
      const wide = gestureAsks.filter((slack) => slack !== stand.gestureSlack);
      if (wide.length) throw new Error(`a rebuild landing mid-gesture asked for ${wide.join(', ')} screens either side rather than the gesture's quarter`);

      // The settle drops the flag before it asks, so the slice for where the gesture stopped is still the full one.
      const before = stand.asks.length;
      booted.settleReaderScroll();
      if (stand.asks.length !== before + 1) throw new Error(`the scroll settled and the rail asked for ${stand.asks.length - before} rebuilds rather than the one full slice`);
      if (stand.asks[before] !== 1) throw new Error(`the settled rebuild asked for ${stand.asks[before]} screens either side rather than the full one`);
    } finally {
      stand.restore();
    }
  });

  // The same closing door, read through the flag the position box raises rather than the wheel's. It is the half of that condition nothing else here reaches, and the box is the gesture the fault was reported on: dropped, every rebuild a moving drag asks for hands a whole screen's layout straight back to the frame the hand is still crossing.
  check('the ask a rebuild ends with is the gesture’s own while the position box is held', () => {
    const stand = railThroughAGesture();
    try {
      // The box is down and the wheel is not turning, so the closing ask has only the drag's flag to read.
      vm.runInContext('minimapDragging = true; readerScrolling = false;', booted);
      stand.state.covers = false;
      booted.updateDocumentMinimapPreview(stand.gestureSlack);
      if (!stand.asks.length) throw new Error('the rebuild never asked again on its way out, so this proves nothing');
      const wide = stand.asks.filter((slack) => slack !== stand.gestureSlack);
      if (wide.length) throw new Error(`a rebuild landing under a held box asked for ${wide.join(', ')} screens either side rather than the gesture's quarter`);

      // endDrag drops the flag before it calls the same door, so the slice for where the box was let go is the full one.
      vm.runInContext('minimapDragging = false', booted);
      const before = stand.asks.length;
      booted.updateMinimapViewport();
      if (stand.asks.length !== before + 1) throw new Error(`the box was let go and the rail asked for ${stand.asks.length - before} rebuilds rather than the one full slice`);
      if (stand.asks[before] !== 1) throw new Error(`the rebuild for where the box landed asked for ${stand.asks[before]} screens either side rather than the full one`);
    } finally {
      vm.runInContext('minimapDragging = false', booted);
      stand.restore();
    }
  });

  // A render places the reader deliberately, so a slice the outgoing document's scroll asked for must never land on the new one — it would clone a picture of words that have gone, for a position this page was never at. The gesture's rebuild is a booked frame rather than a remembered debt now, so what drops it is the teardown canceling that frame.
  check('a render drops the rebuild the outgoing document’s scroll asked for', () => {
    const stand = railThroughAGesture();
    try {
      stand.notch(700);
      if (!stand.frame()) throw new Error('the notch out of the window booked no frame to drop');
      if (stand.builds.length !== 0) throw new Error('the notch laid its slice out before the frame it booked came round');

      booted.disconnectMinimapPreviewObservers();
      if (stand.frame()) throw new Error('the render took the document away and the rail is still holding a frame to rebuild on');
      if (stand.read('minimapPendingSlack') !== 0) throw new Error('the render took the document away and the rail is still holding what the gone document asked for');
      booted.__frames.drain();
      if (stand.builds.length !== 0) throw new Error('the frame the outgoing document booked laid its slice out anyway');
    } finally {
      stand.restore();
    }
  });

  // The wiring both documents below need. The rebuild reads its geometry off the metrics and its rows off the body, and everything between them is the shipped rebuild, so what a check reads back is the slice it really built. `setScroll` moves the offset each row answers its rectangle against, since the rail reads viewport rectangles and adds the scroll back on.
  const railStandFor = (body, metrics, setScroll) => {
    let scrollTop = 0;
    const was = { measure: booted.measureDocumentMinimap, source: booted.minimapSourceElement };
    booted.measureDocumentMinimap = () => ({ ...metrics, scrollTop });
    booted.minimapSourceElement = () => body;
    booted.setMinimapMarkup(booted.documentMinimapMarkup());
    const rail = booted.document.getElementById('readerMinimap');
    const content = rail.querySelector('.document-minimap-track').querySelector('.document-minimap-content');
    content.getBoundingClientRect = () => ({ top: 0, bottom: 70, height: 70, width: 80 });
    const move = (offset) => {
      scrollTop = offset;
      setScroll(offset);
    };
    return {
      metrics,
      // Build the thumbnail for a reader sitting at this offset, the way a scroll past the built slice does. Written with a slack, the way a gesture asks for one narrower than a rest's.
      buildAt: (offset, slack) => {
        move(offset);
        booted.updateDocumentMinimapPreview(slack);
      },
      coversAt: (offset) => {
        move(offset);
        return booted.minimapWindowCoversView({ ...metrics, scrollTop }, offset);
      },
      // What the thumbnail on the page ended up holding: the block's own copy, and the top-level rows carried in beside it on either side.
      clonedRows: () => {
        const built = content.querySelector('.document-minimap-preview');
        const kids = built ? built.children : [];
        const at = Array.prototype.findIndex.call(kids, (child) => child.classList.contains('table-bay'));
        return {
          block: at >= 0,
          before: at < 0 ? 0 : at,
          after: at < 0 ? 0 : kids.length - at - 1,
          leadsWithCarried: at > 0,
        };
      },
      // The thumbnail itself, for a check that has to look inside a row it carried.
      builtClone: () => content.querySelector('.document-minimap-preview'),
      // Where the thumbnail was placed down the rail: the box the clone hangs in wears it.
      placedAt: () => {
        const box = content.querySelector('.document-minimap-frame');
        return box ? box.style.transform : '';
      },
      read: (name) => vm.runInContext(name, booted),
      restore: () => {
        booted.measureDocumentMinimap = was.measure;
        booted.minimapSourceElement = was.source;
        booted.setMinimapMarkup('');
        booted.__frames.drain();
        vm.runInContext(
          'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
            + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1; minimapBuiltRange = null;'
            + "minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1; minimapBuiltRowPath = '';"
            + 'minimapBuiltSliced = false; minimapBuiltSlack = -1; minimapPendingSlack = 0; minimapWidenTimer = 0;',
          booted,
        );
      },
    };
  };

  // The document the fault needs: one block taller than the window the rail asks for, with ground on both sides of it. Thirty-one rows of 100px with the eleventh a block spanning 1,000 to 6,000 and holding fifty of them, under a 70px track over an 8,000px document drawn at a tenth — so the rail shows 700px at a time, asks for a screen either side of that, and the block is five times the 2,100px it asked for. Everything the rebuild reads off a real page is swapped for a known number and everything between them is the shipped rebuild, so what these checks read back is the slice it really built.
  const railOverABlockedDocument = () => {
    // The rail reads viewport rectangles and adds the scroll back on, so the rows answer where they are on the screen rather than where they are in the document.
    let scrollTop = 0;
    const body = fakeElement('rail-block-source');
    body.className = 'document-body';
    body.innerHTML = Array.from({ length: 31 }, (_, index) => (index === 10
      ? `<div class="table-bay">${Array.from({ length: 50 }, (_, line) => `<p>line ${line}</p>`).join('')}</div>`
      : `<p>row ${index}</p>`)).join('');
    const span = (index) => {
      if (index < 10) return [index * 100, index * 100 + 100];
      if (index === 10) return [1000, 6000];
      return [6000 + (index - 11) * 100, 6100 + (index - 11) * 100];
    };
    body.children.forEach((row, index) => {
      const [top, bottom] = span(index);
      row.getBoundingClientRect = () => ({ top: top - scrollTop, bottom: bottom - scrollTop, height: bottom - top, width: 800 });
    });
    body.children[10].children.forEach((line, index) => {
      const top = 1000 + index * 100;
      line.getBoundingClientRect = () => ({ top: top - scrollTop, bottom: top + 100 - scrollTop, height: 100, width: 800 });
    });
    const metrics = {
      sourceWidth: 800,
      sourceTop: 0,
      scrollHeight: 8000,
      viewportHeight: 700,
      scrollable: 7300,
      scrollTop: 0,
      trackHeight: 70,
      scaledDocumentHeight: 800,
      previewScale: 0.1,
    };
    return railStandFor(body, metrics, (offset) => { scrollTop = offset; });
  };

  // The slice is the only thing that decides whether the rail ever rebuilds again, so it has to say where the clone really ends. Taking the document's own ends after the search had descended into a block left it claiming 2,000px above and below that the clone holds no row for, and the guard reads those two numbers and nothing else — so it answered yes over an empty rail and nothing ever asked for the picture back.
  check('a slice built inside a long block ends at that block’s own edges rather than at the document’s', () => {
    const stand = railOverABlockedDocument();
    try {
      stand.buildAt(5000);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error(`the search stopped at path ${stand.read('minimapBuiltRowPath')} rather than descending into the block, so this proves nothing`);
      if (stand.read('minimapBuiltLastRow') !== 49) throw new Error('the slice does not reach the block’s last row, so its bottom was never widened');
      const foot = stand.read('minimapBuiltRange');
      if (foot.bottom === 8000) throw new Error('the slice still claims the document’s own height, 2,000px below the last row the clone holds');
      // The block’s own foot is 6,000 and the document’s is 8,000. Anything below 6,000 and short of the document’s end is the block’s edge plus whatever rows past it the clone carried; the exact number is the carrying check’s.
      if (foot.bottom < 6000 || foot.bottom >= 8000) throw new Error(`the slice says it ends at ${foot.bottom}, which is neither the block’s own foot nor a row past it`);
      // The whole point of the number: a reader below the block is outside the clone, so the rail asks for one that holds where they are.
      if (stand.coversAt(7300)) throw new Error('a reader at the foot of the document was told the thumbnail already holds where they are');

      stand.buildAt(1000);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error('the search did not descend at the block’s head, so this proves nothing');
      if (stand.read('minimapBuiltFirstRow') !== 0) throw new Error('the slice does not reach the block’s first row, so its top was never widened');
      const head = stand.read('minimapBuiltRange');
      if (head.top === 0) throw new Error('the slice still claims the top of the document, 1,000px above the first row the clone holds');
      // The block’s own head is 1,000. Anything above it and below the document’s own top is a carried row before the block.
      if (head.top <= 0 || head.top > 1000) throw new Error(`the slice says it starts at ${head.top}, which is neither the block’s own head nor a row above it`);
      if (stand.coversAt(0)) throw new Error('a reader at the top of the document was told the thumbnail already holds where they are');
    } finally {
      stand.restore();
    }
  });


  // The same slice asked for the quarter a gesture asks for, which is where a fast scroll's rebuilds are now laid out. A narrow ask lands wholly inside a block this tall, so both ends of the slice are cut rows rather than the block's own edges — and the range still has to say where the clone really stops, or the rail is back to answering yes over ground it holds no row for.
  check('a narrow slice cut inside a long block still says where its rows really stop', () => {
    const stand = railOverABlockedDocument();
    const quarter = vm.runInContext('MINIMAP_GESTURE_SLACK', booted);
    try {
      // Sitting mid-block: the 700px the track shows plus a quarter either side is 2,825 to 3,875, which is 3,000px inside a block spanning 1,000 to 6,000.
      stand.buildAt(3000, quarter);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error(`the search stopped at path ${stand.read('minimapBuiltRowPath')} rather than descending into the block, so this proves nothing`);
      if (stand.read('minimapBuiltSlack') !== quarter) throw new Error('the slice was not built for the quarter a gesture asks for, so this proves nothing');
      const range = stand.read('minimapBuiltRange');
      if (range.top <= 1000 || range.bottom >= 6000) throw new Error(`the narrow slice says it runs ${range.top} to ${range.bottom}, which claims ground outside the block it was cut from`);
      if (range.top !== 2800 || range.bottom !== 3900) throw new Error(`the narrow slice says it runs ${range.top} to ${range.bottom} rather than the 2,800 to 3,900 its own cut lines stand at`);
      const lines = [stand.read('minimapBuiltFirstRow'), stand.read('minimapBuiltLastRow')];
      if (lines[0] !== 18 || lines[1] !== 28) throw new Error(`the narrow slice cut lines ${lines[0]} to ${lines[1]} rather than the 18 to 28 a quarter either side reaches`);
      // The whole point of the number: a reader a screen further down is outside the narrow clone, so the rail asks for one that holds where they are.
      if (stand.coversAt(4600)) throw new Error('a reader below the narrow slice was told the thumbnail already holds where they are');
      if (stand.coversAt(1400)) throw new Error('a reader above the narrow slice was told the thumbnail already holds where they are');
      if (!stand.coversAt(3000)) throw new Error('a reader inside the narrow slice was told to rebuild anyway');
    } finally {
      stand.restore();
    }
  });


  // A block taller than the window the rail asks for is descended into, and the clone is built out of that block's own rows — so a window reaching past the block's edge could hold no row on the other side of it, and the rail drew nothing at all for a rail-height past every long table. The rows past the edge are the document's top-level ones, so they go in beside the wrapper rather than inside it.
  check('a window reaching past a long block’s edge holds rows from both sides of it', () => {
    const stand = railOverABlockedDocument();
    try {
      // Sitting near the block's foot: the asked range runs from inside the block out to 6,400, which is four rows past it.
      stand.buildAt(5000);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error('the search never descended into the block, so this proves nothing');
      const past = stand.clonedRows();
      if (!past.block) throw new Error('the thumbnail holds no part of the block it was built inside');
      if (past.after < 1) throw new Error('the thumbnail holds nothing past the block’s foot, so a reader below it sees an empty rail');
      if (past.after !== 5) throw new Error(`the thumbnail carried ${past.after} rows past the block rather than the 5 the asked range reaches`);
      if (past.before !== 0) throw new Error('rows above the block were carried into a window that never reached its head');
      // The whole of the second half: the slice now covers the band the rail is showing, so the band stops asking for a rebuild on every frame of itself.
      for (const at of [5000, 5200, 5400, 5600, 5800]) {
        if (!stand.coversAt(at)) throw new Error(`the reader at ${at} is past the block’s foot and the rail asked for another rebuild`);
      }

      // And the same at the block's head, where the carried rows sit above it and the clone is placed at the first of them.
      stand.buildAt(1000);
      const ahead = stand.clonedRows();
      if (ahead.before !== 7) throw new Error(`the thumbnail carried ${ahead.before} rows above the block rather than the 7 the asked range reaches`);
      if (ahead.after !== 0) throw new Error('rows below the block were carried into a window that never reached its foot');
      if (!ahead.leadsWithCarried) throw new Error('the clone starts with the block rather than with the first row it actually holds, so the thumbnail is drawn where the block is');
      for (const at of [1000, 800, 600, 400]) {
        if (!stand.coversAt(at)) throw new Error(`the reader at ${at} is above the block’s head and the rail asked for another rebuild`);
      }
    } finally {
      stand.restore();
    }
  });


  // The document the boundary between two long tables needs: a block taller than the window with a table on each side of it. Fourteen top-level rows over a 31,900px document under a 70px track at a tenth, so the rail shows 700px and asks for a screen either side of that, 2,100px in all. The table above the block is 1,800px, short enough that the search descends into the block rather than into it; the table below is 24,000px, the one a clone taking its carried row whole takes entire for the few hundred pixels of it the rail can show. Both are built of 600px rows, taller than the sliver of either table a window at these boundaries reaches — which is what makes the row itself the thing a descent has to stop at.
  const railBetweenLongTables = () => {
    let scrollTop = 0;
    const body = fakeElement('rail-table-source');
    body.className = 'document-body';
    const table = (lines) => `<table><tbody>${Array.from({ length: lines }, (_, line) => `<tr><td>a${line}</td><td>b${line}</td><td>c${line}</td></tr>`).join('')}</tbody></table>`;
    body.innerHTML = Array.from({ length: 14 }, (_, index) => {
      if (index === 7) return table(3);
      if (index === 10) return `<div class="table-bay">${Array.from({ length: 50 }, (_, line) => `<p>line ${line}</p>`).join('')}</div>`;
      if (index === 11) return table(40);
      return `<p>row ${index}</p>`;
    }).join('');
    const span = (index) => {
      if (index < 7) return [index * 100, index * 100 + 100];
      if (index === 7) return [700, 2500];
      if (index < 10) return [2500 + (index - 8) * 100, 2600 + (index - 8) * 100];
      if (index === 10) return [2700, 7700];
      if (index === 11) return [7700, 31700];
      return [31700 + (index - 12) * 100, 31800 + (index - 12) * 100];
    };
    const stands = (node, top, bottom) => {
      node.getBoundingClientRect = () => ({ top: top - scrollTop, bottom: bottom - scrollTop, height: bottom - top, width: 800 });
    };
    body.children.forEach((row, index) => {
      const [top, bottom] = span(index);
      stands(row, top, bottom);
    });
    body.children[10].children.forEach((line, index) => stands(line, 2700 + index * 100, 2800 + index * 100));
    // Each table answers for its one tbody as well as its rows: the search measures the tbody on its way down and stops at the rows.
    for (const [row, from] of [[7, 700], [11, 7700]]) {
      const holder = body.children[row].children[0];
      stands(holder, from, from + holder.children.length * 600);
      holder.children.forEach((line, index) => stands(line, from + index * 600, from + index * 600 + 600));
    }
    const metrics = {
      sourceWidth: 800,
      sourceTop: 0,
      scrollHeight: 31900,
      viewportHeight: 700,
      scrollable: 31200,
      scrollTop: 0,
      trackHeight: 70,
      scaledDocumentHeight: 3190,
      previewScale: 0.1,
    };
    return railStandFor(body, metrics, (offset) => { scrollTop = offset; });
  };

  // Every row of a sliced table, and every cell in each of them. Descending into a <tr> reads its columns as more vertical rows, which leaves one cell standing where the whole row belongs.
  const slicedTableRows = (carried, of) => {
    if (!carried) throw new Error('the clone holds nothing where the carried table should be');
    if (carried.tagName !== 'TABLE') throw new Error(`the clone carried in a ${carried.tagName} rather than the table beside the block`);
    const rows = carried.children[0] ? carried.children[0].children : [];
    for (const row of rows) {
      if (row.tagName !== 'TR') throw new Error(`the slice descended past the table's rows and kept a ${row.tagName}`);
      if (row.children.length !== 3) throw new Error(`a row of the carried table kept ${row.children.length} of its 3 cells, so the descent read its columns as more rows`);
    }
    if (rows.length !== of) throw new Error(`the carried table went into the clone with ${rows.length} rows rather than the ${of} the window reaches`);
    return rows;
  };

  // A carried row is what stops the rail going blank past a long block, and going in whole it costs: at a boundary between two long tables that is a 20,000px table taken for the 500px of it the rail can show, and building the clone is most of a rebuild. It is windowed the same way the block is — and the slice has to say so, or the guard keeps a thumbnail for ground the clone holds no row for.
  check('a long table carried in past a block’s foot is sliced to the rows the window reaches', () => {
    const stand = railBetweenLongTables();
    try {
      stand.buildAt(6800);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error(`the search stopped at path ${stand.read('minimapBuiltRowPath')} rather than descending into the block, so this proves nothing`);
      const kids = stand.builtClone().children;
      if (kids.length !== 2) throw new Error(`the clone holds ${kids.length} top-level rows rather than the block and the table carried in past its foot`);
      slicedTableRows(kids[1], 1);
      const foot = stand.read('minimapBuiltRange');
      if (foot.bottom !== 8200) throw new Error(`the slice says it ends at ${foot.bottom} rather than at the 8,200 it asked for; the carried table runs to 31,700 and the clone holds none of that`);
      if (stand.coversAt(8500)) throw new Error('a reader below the sliced table was told the thumbnail already holds where they are');
    } finally {
      stand.restore();
    }
  });

  // The same at the other edge, where the carried row sits above the block and the window reaches back into its last rows. The clone starts inside that row, so the number the slice claims for its top is the one it asked for rather than the top of a table whose first eleven rows it does not hold.
  check('a long table carried in above a block is sliced to the rows the window reaches back into', () => {
    const stand = railBetweenLongTables();
    try {
      stand.buildAt(2400);
      if (stand.read('minimapBuiltRowPath') !== '10') throw new Error(`the search stopped at path ${stand.read('minimapBuiltRowPath')} rather than descending into the block, so this proves nothing`);
      const kids = stand.builtClone().children;
      if (kids.length !== 4) throw new Error(`the clone holds ${kids.length} top-level rows rather than the table, the two rows after it and the block`);
      slicedTableRows(kids[0], 2);
      const head = stand.read('minimapBuiltRange');
      if (head.top !== 1700) throw new Error(`the slice says it starts at ${head.top} rather than at the 1,700 it asked for; the carried table starts at 700 and the clone holds none of that`);
      if (stand.coversAt(1000)) throw new Error('a reader above the sliced table was told the thumbnail already holds where they are');
    } finally {
      stand.restore();
    }
  });

  // A windowed clone starts mid-document, so its first block's top margin has nothing above it to collapse against and the thumbnail lands off by that margin; the rebuild measures the miss and takes it back out. Once rows are carried in above a block the clone starts with one of them rather than with the wrapper chain, so the row that miss is measured on is one step down and not at the foot of the wrappers — walked down the chain instead, the read runs off the end of the clone, finds nothing and leaves the thumbnail sitting wherever the margin put it.
  check('a thumbnail that starts with a carried row is placed by measuring that row', () => {
    const stand = railOverABlockedDocument();
    try {
      stand.buildAt(1000);
      if (!stand.clonedRows().leadsWithCarried) throw new Error('the thumbnail does not start with a carried row, so this proves nothing');
      const scale = stand.metrics.previewScale;
      const uncorrected = `translateY(${stand.read('minimapBuiltRange').top * scale}px) scale(${scale})`;
      if (stand.placedAt() === uncorrected) {
        throw new Error('the thumbnail was left at the offset the slice asked for, so nothing measured where its first row actually landed');
      }
    } finally {
      stand.restore();
    }
  });

  // The document a long table needs: a block whose own child holds the table, so the search descends four levels rather than the one the blocked document above nests. Thirty-one rows of 100px with the eleventh a bay spanning 1,000 to 6,000, holding a lane, holding the table — a 100px header row over 49 body rows — and, standing over the lane's own top corner rather than under the table, the sheet button. Same 70px track over an 8,000px document at a tenth as the blocked stand, so the rail shows 700px and asks for a screen either side of that.
  const railOverALanedTable = () => {
    let scrollTop = 0;
    const body = fakeElement('rail-lane-source');
    body.className = 'document-body';
    const rows = Array.from({ length: 49 }, (_, line) => `<tr><td>b${line}</td></tr>`).join('');
    const lane = `<div class="table-lane"><table><thead><tr><th>head</th></tr></thead><tbody>${rows}</tbody></table><button class="table-sheet-open">sheet</button></div>`;
    body.innerHTML = Array.from({ length: 31 }, (_, index) => (index === 10
      ? `<div class="table-bay">${lane}</div>`
      : `<p>row ${index}</p>`)).join('');
    const stands = (node, top, bottom) => {
      node.getBoundingClientRect = () => ({ top: top - scrollTop, bottom: bottom - scrollTop, height: bottom - top, width: 800 });
    };
    body.children.forEach((row, index) => {
      if (index < 10) return stands(row, index * 100, index * 100 + 100);
      if (index === 10) return stands(row, 1000, 6000);
      return stands(row, 6000 + (index - 11) * 100, 6100 + (index - 11) * 100);
    });
    const laneNode = body.children[10].children[0];
    const table = laneNode.children[0];
    const button = laneNode.children[1];
    stands(laneNode, 1000, 6000);
    stands(table, 1000, 6000);
    stands(table.children[0], 1000, 1100);
    stands(table.children[1], 1100, 6000);
    table.children[1].children.forEach((line, index) => stands(line, 1100 + index * 100, 1200 + index * 100));
    // The button stands over the table's own top corner rather than under it, which is the pair a search halving over feet cannot order. There is no cascade in this page, so the stand says on the element itself what the stylesheet says.
    button.style.position = 'absolute';
    stands(button, 1000, 1030);
    const metrics = {
      sourceWidth: 800,
      sourceTop: 0,
      scrollHeight: 8000,
      viewportHeight: 700,
      scrollable: 7300,
      scrollTop: 0,
      trackHeight: 70,
      scaledDocumentHeight: 800,
      previewScale: 0.1,
    };
    return { ...railStandFor(body, metrics, (offset) => { scrollTop = offset; }), body };
  };

  // The clone used to rebuild only the chain the search descended — bay, lane, table, body — with every other child of every one of them dropped. A table's header row is a sibling of its body, so a thumbnail cut anywhere inside a long table drew that body with no header band over it, while the same table cloned whole a screen further up drew with one. The sheet button went the same way, and by a second fault as well: it stands over the table's top corner rather than under it, so the halving over the lane's two children was ordering a pair it cannot order.
  check('a window cut inside a table keeps the header row over the body and the button over the lane’s corner', () => {
    const stand = railOverALanedTable();
    try {
      // The asked range opens at 1,000, which is the table's own head, so the slice starts at the body's first row and the header row stands directly above it.
      stand.buildAt(1700);
      if (stand.read('minimapBuiltRowPath') !== '10/0/0/1') throw new Error(`the search stopped at path ${stand.read('minimapBuiltRowPath')} rather than descending through the bay, the lane and the table into its body, so this proves nothing`);
      const top = stand.builtClone().children;
      if (top.length !== 1 || !top[0].classList.contains('table-bay')) throw new Error('the thumbnail does not hold the bay on its own, so the window is not the one this is about');
      const laneClone = top[0].children[0];
      if (!laneClone || !laneClone.classList.contains('table-lane')) throw new Error('the thumbnail lost the lane the table sits in');
      const inLane = Array.prototype.map.call(laneClone.children, (child) => child.tagName).join(',');
      if (inLane !== 'TABLE,BUTTON') throw new Error(`the lane in the thumbnail holds ${inLane || 'nothing'} rather than the table and the button standing over its corner`);
      const inTable = Array.prototype.map.call(laneClone.children[0].children, (child) => child.tagName).join(',');
      if (inTable !== 'THEAD,TBODY') throw new Error(`the table in the thumbnail holds ${inTable || 'nothing'} rather than its header row over the body the window cut into`);
      const sliced = laneClone.children[0].children[1].children;
      if (sliced.length !== 21) throw new Error(`the thumbnail holds ${sliced.length} body rows rather than the 21 the asked range reaches`);
    } finally {
      stand.restore();
    }
  });

  // The frame is translated to where the clone's first content really sits. Left at the first sliced row while a header row is carried in above it inside the table, the whole thumbnail lands low by that row's height, so the picture the reader is handed is of a place they are not at.
  check('a thumbnail carrying a header row is placed at that row rather than at the first row of the body', () => {
    const stand = railOverALanedTable();
    try {
      stand.buildAt(1700);
      const cut = { appTop: 0, scrollTop: 1700, top: 1000, bottom: 3100 };
      const window = booted.minimapWindowRows(stand.body, 0, 1700, cut.top, cut.bottom);
      if (window.path !== '10/0/0/1') throw new Error('the search did not descend into the table’s body, so this proves nothing');
      const built = booted.buildWindowedMinimapClone(stand.body, window, window.first, window.last, cut);
      // The header row runs 1,000 to 1,100 and the body's first row starts where it ends.
      if (built.firstTop === 1100) throw new Error('the thumbnail is placed at the first row of the body, so it lands low by the header row standing above it');
      if (built.firstTop !== 1000) throw new Error(`the thumbnail is placed at ${built.firstTop}, which is neither the header row it starts with nor the body row under it`);
    } finally {
      stand.restore();
    }
  });

  // The rail's thumbnail is a clone of the page, and inserting a clone that holds an open <details> makes the browser fire `toggle` on it. The listener is on the document, so the rail heard its own thumbnail land, called that a change to the document and rebuilt — 29 rebuilds in 30 frames with nothing scrolling, and the wheel had no free frame to answer in.
  check('a section opening inside the rail is not the document changing', () => {
    const version = () => vm.runInContext('minimapContentVersion', booted);
    const raise = (target) => {
      const before = version();
      for (const handler of booted.document.listeners.get('toggle') || []) handler({ target });
      return version() - before;
    };
    // The cloned outline is inside the rail and inside a cloned .document-body, which is the whole difficulty: only the first of those tells it apart from the page.
    const inRail = { closest: (selector) => (selector === '.document-minimap' || selector === '.document-body' ? {} : null) };
    const inPage = { closest: (selector) => (selector === '.document-body' ? {} : null) };
    try {
      if (raise(inRail) !== 0) throw new Error('the rail rebuilt its thumbnail because its own clone landed');
      if (raise(inPage) === 0) throw new Error('a reader opening a section in the page no longer restates the thumbnail');
    } finally {
      // The page-side toggle asked for a rebuild, which is the point of it; drop that request rather than running it against a stand-in page with no document in it.
      vm.runInContext('minimapContentVersion = 0; if (minimapPreviewFrame) { window.cancelAnimationFrame(minimapPreviewFrame); minimapPreviewFrame = 0; }', booted);
    }
  });

  // Why that guard cannot be keyed on the reading body: the clone is made with cloneNode, so it carries the class it was cloned from, and stripping takes ids, textareas and links off it and never a class.
  check('the thumbnail carries the reading body class, so that class cannot tell it from the page', () => {
    const body = fakeElement();
    body.className = 'document-body';
    body.innerHTML = '<details class="document-outline"></details>';
    const clone = body.cloneNode();
    booted.stripMinimapClone(clone);
    if (!clone.classList.contains('document-body')) throw new Error('the clone lost the reading body class, so this proves nothing');
    if (!clone.classList.contains('document-minimap-preview')) throw new Error('the clone is not marked as the rail’s own');
  });

  // The whole of the thumbnail is what the copy kept: a shallow copy of the reading body for the wrapper, a deep copy of each row put into it. So the body here is a page element rather than a stand of its own, or the shallow copy comes back deep and the check proves its own helper.
  check('the thumbnail is the reading body’s own wrapper holding a deep copy of each row in the window', () => {
    const body = fakeElement('minimap-source');
    body.className = 'document-body';
    body.setAttribute('data-doc-kind', 'markdown');
    body.innerHTML = [
      '<h1 data-block-kind="heading">A title</h1>',
      '<p data-block-kind="paragraph">First words.</p>',
      '<pre class="mermaid" data-language="mermaid">flowchart TD</pre>',
      '<p data-block-kind="paragraph">Last words.</p>',
    ].join('');
    body.children.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 20, bottom: (index + 1) * 20 }); });
    const window = booted.minimapWindowRows(body, 0, 0, 20, 50);
    if (window.rows.length !== 4) throw new Error('the rows a window slices are not the body’s own blocks');

    // A window over the middle two rows: those rows and nothing else, in the order the document has them.
    const windowed = booted.buildWindowedMinimapClone(body, window, 1, 2).preview;
    if (windowed === body) throw new Error('the thumbnail is the reading body itself rather than a copy of it');
    if (windowed.children.length !== 2) throw new Error(`the window holds ${windowed.children.length} rows rather than the two it names`);
    if (windowed.textContent !== 'First words.flowchart TD') throw new Error(`the window says ${JSON.stringify(windowed.textContent)}`);
    // The wrapper is a shallow copy, so it wears the body's own classes and attributes — which is what makes every `.document-body x` rule match inside the rail.
    if (!windowed.classList.contains('document-body')) throw new Error('the wrapper did not keep the reading body class every rule inside the rail is keyed on');
    if (windowed.dataset.docKind !== 'markdown') throw new Error('the wrapper dropped a data- attribute the reading body was wearing');
    // A block carrying a data- attribute arrives still wearing it, which is how a diagram the page handed back is found in the copy at all.
    const diagram = windowed.children[1];
    if (diagram.dataset.language !== 'mermaid' || !diagram.classList.contains('mermaid')) throw new Error('a copied block arrived without what it was wearing');
    // The window is its own, so nothing it does reaches the page it was copied from.
    if (body.children.length !== 4) throw new Error('slicing a window took rows out of the document');
    if (windowed.style.paddingTop !== '0' || windowed.style.paddingBottom !== '0') throw new Error('the window kept the layer’s own padding, which belongs at the start of the document rather than at the start of a window into the middle of it');
    if (body.style.paddingTop === '0') throw new Error('the window’s padding was written onto the reading body itself');
  });

  check('a row taller than the minimap window gives the slice its own children and wrapper chain', () => {
    const body = fakeElement('minimap-deep-source');
    body.innerHTML = '<h1>Title</h1><pre class="highlight"><code><span>one</span><span>two</span><span>three</span></code></pre>';
    const [title, pre] = body.children;
    const code = pre.children[0];
    title.getBoundingClientRect = () => ({ top: 0, bottom: 20 });
    pre.getBoundingClientRect = () => ({ top: 20, bottom: 2020 });
    code.getBoundingClientRect = () => ({ top: 20, bottom: 2020 });
    code.children.forEach((line, index) => { line.getBoundingClientRect = () => ({ top: 20 + index * 20, bottom: 40 + index * 20 }); });
    const window = booted.minimapWindowRows(body, 0, 0, 0, 80);
    if (window.holder !== code || window.rows.length !== 3) throw new Error('the window stopped at the one row holding the whole document');
    if (window.wrappers.length !== 2 || window.wrappers[0] !== pre || window.wrappers[1] !== code) throw new Error('the window dropped the wrappers around the rows it reached');
    if (window.path !== '1/0') throw new Error(`the descended window says its path is ${window.path}`);
  });

  // The whole of the copy ticket: the window hands its readers the holder's own list rather than a snapshot of it. Identity is the only thing that says so — a copy answers every index the same way, at any size, which is why no number of rows would prove this.
  check('a window carries the holder’s own list of rows rather than a copy of it', () => {
    const body = fakeElement('minimap-live-rows-source');
    body.innerHTML = '<h1>Title</h1><pre class="highlight"><code><span>one</span><span>two</span><span>three</span></code></pre>';
    const [title, pre] = body.children;
    const code = pre.children[0];
    title.getBoundingClientRect = () => ({ top: 0, bottom: 20 });
    pre.getBoundingClientRect = () => ({ top: 20, bottom: 2020 });
    code.getBoundingClientRect = () => ({ top: 20, bottom: 2020 });
    code.children.forEach((line, index) => { line.getBoundingClientRect = () => ({ top: 20 + index * 20, bottom: 40 + index * 20 }); });

    const shallow = booted.minimapWindowRows(body, 0, 0, 0, 10);
    if (shallow.rows !== body.children) throw new Error('a window that never descended copied the reading body’s rows instead of carrying them');

    const descended = booted.minimapWindowRows(body, 0, 0, 0, 80);
    if (descended.holder !== code) throw new Error('the window did not descend, so this proves nothing about the row it descended into');
    if (descended.rows !== code.children) throw new Error('a descended window copied every child of the row it descended into');
  });

  // A fixture whose rows count the rectangle reads taken on them, so a check can say which rows the window search touched rather than only what it handed back. `spans` is one [top, bottom] per row and `kids` how many children each gets, since only a row with children can be descended into.
  const countingRows = (id, spans, kids) => {
    const body = fakeElement(id);
    body.innerHTML = spans.map((_, i) => `<div>${'<span></span>'.repeat(kids[i] ?? 0)}</div>`).join('');
    const reads = spans.map(() => 0);
    body.children.forEach((row, i) => {
      row.getBoundingClientRect = () => {
        reads[i] += 1;
        return { top: spans[i][0], bottom: spans[i][1] };
      };
    });
    return { body, reads };
  };

  // Only an end of the run can be taller than the window, so the search asks those two rows and nothing between them. The scan this replaced read every row of the window — 1,552 rectangles on a description list of 40,000 children, 13.7 ms of a typing pause. Here both ends are tall enough, and the first is the one that answers.
  check('the minimap window search descends through the first end of its run and never reads the last after that', () => {
    const spans = [[-500, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 1200]];
    const { body, reads } = countingRows('minimap-first-end-source', spans, [2, 0, 0, 0, 0, 2]);
    const opening = body.children[0];
    opening.children[0].getBoundingClientRect = () => ({ top: -500, bottom: 40 });
    opening.children[1].getBoundingClientRect = () => ({ top: 40, bottom: 50 });
    const window = booted.minimapWindowRows(body, 0, 0, 0, 100);
    if (window.holder !== opening) throw new Error('the search did not descend through the first end of its run');
    // Rows 2 and 4 are read by the two binary searches alone; row 0 is read once by a search and once as the candidate. A read on row 1 or row 3 is the full-window scan come back, and a second read on row 5 is the last end asked after the first had already answered.
    if (reads.join(',') !== '2,0,2,0,1,1') throw new Error(`the rows were read ${reads.join(',')} times rather than 2,0,2,0,1,1`);
  });

  // The three runs the two binary searches settle on their own: none, one, and one whose first end is not the tall row.
  check('the minimap window search reads no row for an empty run, one row twice over for a single-row run, and its last end when the first does not answer', () => {
    const none = countingRows('minimap-empty-run-source', [[0, 10], [10, 20]], [1, 1]);
    const empty = booted.minimapWindowRows(none.body, 0, 0, 100, 200);
    if (empty.first <= empty.last) throw new Error('a window below every row still named a run of them');
    // Both rows are read by the two searches; a third read on either is a candidate asked for a run that holds no rows.
    if (none.reads.join(',') !== '2,2') throw new Error(`the empty run read its rows ${none.reads.join(',')} times rather than 2,2`);

    const alone = countingRows('minimap-one-row-run-source', [[0, 50]], [1]);
    const single = booted.minimapWindowRows(alone.body, 0, 0, 0, 100);
    if (single.first !== 0 || single.last !== 0) throw new Error('the one-row run did not come back as one row');
    // Two reads from the searches and one candidate read: the row is both ends, so it is asked once rather than twice.
    if (alone.reads.join(',') !== '3') throw new Error(`the one-row run read its row ${alone.reads.join(',')} times rather than 3`);

    const spans = [[0, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 1200]];
    const { body, reads } = countingRows('minimap-last-end-source', spans, [0, 1, 1, 1, 1, 2]);
    const closing = body.children[5];
    closing.children[0].getBoundingClientRect = () => ({ top: 90, bottom: 200 });
    closing.children[1].getBoundingClientRect = () => ({ top: 200, bottom: 1200 });
    const window = booted.minimapWindowRows(body, 0, 0, 0, 100);
    if (window.holder !== closing) throw new Error('the search did not descend through the last end of its run');
    // Rows 1 and 3 are never read at all: the searches skip them and the candidate pass has no reason to ask them. Any number there is the walk over the whole window come back.
    if (reads.join(',') !== '2,0,2,0,1,2') throw new Error(`the rows were read ${reads.join(',')} times rather than 2,0,2,0,1,2`);
  });

  // Widening the run outward is what brings in a child standing over its sibling, and it must not turn back into the walk over the whole window that halving replaced — 1,552 rectangles on a description list of 40,000 children, 13.7 ms of a typing pause. Where the children do stand under one another the child past each end of the run is already clear of the asked range, so the widening reads one rectangle a side and stops there.
  check('the minimap window search widens a run by one rectangle either side of it and no further', () => {
    const spans = [[0, 100], [100, 200], [200, 300], [300, 400], [400, 500], [500, 600]];
    const { body, reads } = countingRows('minimap-widening-source', spans, [0, 0, 0, 0, 0, 0]);
    const window = booted.minimapWindowRows(body, 0, 0, 250, 350);
    if (window.first !== 2 || window.last !== 3) throw new Error(`the run came back as ${window.first} to ${window.last} rather than the two rows the range stands over`);
    // Rows 1 and 4 are read once by a search and once by the widening; rows 2 and 3 are the run's own ends, read by the searches and again as the candidate to descend into. A read on row 5, or a third on row 1 or row 4, is the widening walking on rather than stopping at the first child clear of the range.
    if (reads.join(',') !== '1,2,3,2,2,0') throw new Error(`the rows were read ${reads.join(',')} times rather than 1,2,3,2,2,0`);
  });

  check('a slice inside one row keeps the whitespace between the lines it cuts', () => {
    const body = fakeElement('minimap-whitespace-source');
    body.innerHTML = '<pre><code><span>one</span>\n<span>two</span>\n<span>three</span></code></pre>';
    const pre = body.children[0];
    const code = pre.children[0];
    const window = { holder: code, rows: Array.from(code.children), wrappers: [pre, code], path: '0/0' };
    const clone = booted.buildWindowedMinimapClone(body, window, 0, 1).preview;
    if (clone.textContent !== 'one\ntwo') throw new Error(`the slice joined its lines as ${JSON.stringify(clone.textContent)}`);
    const copiedCode = clone.children[0].children[0];
    if (copiedCode.childNodes.length !== 3 || copiedCode.childNodes[1].nodeType !== 3) throw new Error('the slice kept elements instead of the child nodes between them');
  });

  check('a descended slice keeps shallow copies of every wrapper and drops their edge padding', () => {
    const body = fakeElement('minimap-wrapper-source');
    body.className = 'document-body';
    body.innerHTML = '<pre class="highlight" data-language="rust"><code class="syntax"><span>one</span><span>two</span></code></pre>';
    const pre = body.children[0];
    const code = pre.children[0];
    const window = { holder: code, rows: Array.from(code.children), wrappers: [pre, code], path: '0/0' };
    const clone = booted.buildWindowedMinimapClone(body, window, 1, 1).preview;
    const copiedPre = clone.children[0];
    const copiedCode = copiedPre && copiedPre.children[0];
    if (!copiedPre || !copiedCode || copiedCode.children.length !== 1 || copiedCode.textContent !== 'two') throw new Error('the descended slice was not put back inside its ancestor chain');
    if (!copiedPre.classList.contains('highlight') || copiedPre.dataset.language !== 'rust' || !copiedCode.classList.contains('syntax')) throw new Error('a rebuilt wrapper dropped the names its rendering rules read');
    for (const wrapper of [clone, copiedPre, copiedCode]) {
      if (wrapper.style.paddingTop !== '0' || wrapper.style.paddingBottom !== '0') throw new Error('a rebuilt wrapper kept padding that belongs at the document edge');
    }
    if (copiedCode.children.length === code.children.length) throw new Error('the wrapper was copied deep before the slice landed');
  });

  check('a body whose second row holds a thousand lines clones only the lines in its window', () => {
    const body = fakeElement('minimap-thousand-line-source');
    const lines = Array.from({ length: 1000 }, (_, index) => `<span>line ${index}</span>`).join('\n');
    body.innerHTML = `<h1>Title</h1><pre class="highlight"><code>${lines}</code></pre>`;
    const [title, pre] = body.children;
    const code = pre.children[0];
    title.getBoundingClientRect = () => ({ top: 0, bottom: 20 });
    pre.getBoundingClientRect = () => ({ top: 20, bottom: 20020 });
    code.getBoundingClientRect = () => ({ top: 20, bottom: 20020 });
    code.children.forEach((line, index) => { line.getBoundingClientRect = () => ({ top: 20 + index * 20, bottom: 40 + index * 20 }); });
    const window = booted.minimapWindowRows(body, 0, 0, 0, 160);
    const clone = booted.buildWindowedMinimapClone(body, window, window.first, window.last).preview;
    const copiedLines = clone.querySelectorAll('span');
    if (window.holder !== code || copiedLines.length >= 1000) throw new Error(`the thumbnail copied ${copiedLines.length} of the thousand lines`);
    if (copiedLines.length < 7 || copiedLines.length > 9) throw new Error(`a 160-pixel window copied ${copiedLines.length} twenty-pixel lines`);
  });

  check('a press near the foot lands at the same place with a whole thumbnail and a descended one', () => {
    booted.setMinimapMarkup(booted.documentMinimapMarkup());
    const rail = booted.document.getElementById('readerMinimap');
    const track = rail.querySelector('.document-minimap-track');
    const content = track.querySelector('.document-minimap-content');
    const appEl = booted.document.getElementById('app');
    const wasMeasure = booted.measureDocumentMinimap;
    const wasHold = booted.leafHoldPointer;
    booted.measureDocumentMinimap = () => ({ scrollable: 10000, viewportHeight: 800, previewScale: 0.05, trackHeight: 700, scaledDocumentHeight: 1200, scrollTop: appEl.scrollTop });
    booted.leafHoldPointer = () => {};
    content.getBoundingClientRect = () => ({ top: 0, bottom: 700, height: 700, width: 80 });
    try {
      booted.bindDocumentMinimap();
      const press = (preview) => {
        content.innerHTML = '';
        content.appendChild(preview);
        appEl.scrollTop = 0;
        const event = { button: 0, pointerId: 17, clientY: 680, preventDefault() {} };
        for (const handler of track.listeners.get('pointerdown') || []) handler(event);
        for (const handler of track.listeners.get('pointerup') || []) handler(event);
        return appEl.scrollTop;
      };
      const whole = fakeElement();
      whole.innerHTML = '<p>whole document</p>';
      const descended = fakeElement();
      descended.innerHTML = '<pre><code><span>window near the foot</span></code></pre>';
      const wholeLanding = press(whole);
      const descendedLanding = press(descended);
      if (wholeLanding !== descendedLanding || wholeLanding !== 10000) throw new Error(`the whole thumbnail landed at ${wholeLanding} and the descended one at ${descendedLanding}`);
    } finally {
      booted.measureDocumentMinimap = wasMeasure;
      booted.leafHoldPointer = wasHold;
      booted.setMinimapMarkup('');
      appEl.scrollTop = 0;
      booted.__frames.drain();
    }
  });

  // The other listener that hears the document change watches the reading view's own body, and the clone lands in the rail beside it — so a landing clone was never something that watcher could see, and the toggle guard above is the only thing standing between the rail and its own thumbnail. Both halves are where the markup puts them, which is what this holds.
  check('the rail sits outside the body the thumbnail watches', () => {
    const page = pageMarkup();
    const opened = page.indexOf('<main id="app"');
    const closed = page.indexOf('</main>', opened);
    if (opened < 0 || closed < 0) throw new Error('the reading view is not a <main id="app"> any more');
    if (page.slice(opened, closed).includes('readerMinimap')) throw new Error('the rail moved inside the reading view, so its clone lands where the watcher can see it');
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    if (!/function minimapSourceElement\(\) \{\s*return readingDocumentRoot\(\);/.test(fragment)) throw new Error('the thumbnail no longer clones the reading view’s own body');
    if (!/minimapBodyObserver = new MutationObserver\(invalidateMinimapPreview\);\s*minimapBodyObserver\.observe\(source, \{/.test(fragment)) throw new Error('the watcher is no longer bound to the element the thumbnail is cloned from');
  });

  check('the fade stops at the position box', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    const opened = fragment.indexOf('function placeMinimapViewport(');
    const closed = fragment.indexOf('\n}', opened);
    const placement = fragment.slice(opened, closed);
    if (placement.includes('reader-edge-fade-depth')) throw new Error('the scroll path copied the fade depth out of the stylesheet');
    if (/getBoundingClientRect|getComputedStyle/.test(placement)) throw new Error('the scroll path reads geometry to place the fade');
    const markup = booted.documentMinimapMarkup();
    if ((markup.match(/class="document-minimap-fade"/g) || []).length !== 2) throw new Error('the rail does not carry two fade elements');
    if (!markup.includes('data-edge="top"') || !markup.includes('data-edge="bottom"')) throw new Error('the two fade elements do not name their edges');
    const styled = () => ({ style: {} });
    const content = styled();
    const viewport = styled();
    const fade = () => {
      let clipPath = '';
      const written = { clipPath: 0 };
      const style = {};
      Object.defineProperty(style, 'clipPath', {
        get: () => clipPath,
        set: (value) => {
          clipPath = value;
          written.clipPath += 1;
        },
      });
      return { style, written };
    };
    const topFade = fade();
    const bottomFade = fade();
    const rail = {
      style: { setProperty() { throw new Error('a custom property was written on the rail'); } },
      querySelector: (selector) => ({
        '.document-minimap-content': content,
        '.document-minimap-viewport': viewport,
        '.document-minimap-fade[data-edge="top"]': topFade,
        '.document-minimap-fade[data-edge="bottom"]': bottomFade,
      }[selector] || null),
    };
    const metrics = { scaledDocumentHeight: 100, trackHeight: 100, scrollable: 120, scrollTop: 0, viewportHeight: 80, previewScale: 0.5 };
    const placed = (scrollTop) => {
      booted.placeMinimapViewport(rail, metrics, scrollTop);
      return [topFade.style.clipPath, bottomFade.style.clipPath];
    };
    const top = placed(0);
    if (top[0] !== 'inset(0 0 max(0px, calc(100% - 0px)) 0)' || top[1] !== 'inset(max(0px, calc(100% - 60px)) 0 0 0)') throw new Error(`the top box left ${top.join(' and ')}`);
    const partial = placed(40);
    if (partial[0] !== 'inset(0 0 max(0px, calc(100% - 20px)) 0)' || partial[1] !== 'inset(max(0px, calc(100% - 40px)) 0 0 0)') throw new Error(`the partial box left ${partial.join(' and ')}`);
    const bottom = placed(120);
    if (bottom[0] !== 'inset(0 0 max(0px, calc(100% - 60px)) 0)' || bottom[1] !== 'inset(max(0px, calc(100% - 0px)) 0 0 0)') throw new Error(`the bottom box left ${bottom.join(' and ')}`);
    if (topFade.written.clipPath !== 3 || bottomFade.written.clipPath !== 3) throw new Error('the two bands were not clipped on every placement');
  });

  // Placing the box runs every frame of every scroll, and a custom property inherits — so writing one on the rail re-resolves style across the whole clone hanging under it, which measured 78ms a write against 0.13ms for writing onto the element that draws. Neither `transform` nor `top` inherits, so neither reaches the clone — but `top` is a layout property, and writing the box's place to it makes the browser lay the rail's own subtree out again on every frame of every scroll, 12.0 to 21.0µs a frame against 3.5 to 4.0 as a transform. So a `top` on the box fails here.
  check('the box and the thumbnail are placed by writing to themselves', () => {
    const styled = () => ({ style: { setProperty() { throw new Error('a custom property was written on the rail'); } } });
    const content = styled();
    const viewport = styled();
    const rail = Object.assign(styled(), {
      querySelector: (selector) => (selector === '.document-minimap-content' ? content : selector === '.document-minimap-viewport' ? viewport : null),
    });
    const metrics = { scaledDocumentHeight: 2000, trackHeight: 700, scrollable: 12322, scrollTop: 0, viewportHeight: 800, previewScale: 0.05 };
    booted.placeMinimapViewport(rail, metrics, 6161);
    if (!/^translateY\(-?\d/.test(content.style.transform || '')) throw new Error(`the thumbnail lane was not slid by its own transform: ${content.style.transform}`);
    if (!/^translateY\(-?\d/.test(viewport.style.transform || '')) throw new Error(`the box was not placed by its own transform: ${viewport.style.transform}`);
    if (viewport.style.top) throw new Error(`the box was placed by top, a layout property the rail lays its own subtree out again to answer: ${viewport.style.top}`);
    if (!/px$/.test(viewport.style.height || '')) throw new Error('the box was not sized on itself');
  });

  // A comparison put back on either height would pass the check above, because the first pass leaves the right number sitting there for the second to read. So the writes are counted instead: this web view drops an identical inline write before the attribute is touched, and reading the value back to skip one costs twice what the write does.
  check('the lane and the box are sized on every pass, never compared first', () => {
    const counting = () => {
      const style = { transform: '', top: '' };
      const written = { height: 0 };
      let height = '';
      Object.defineProperty(style, 'height', {
        get: () => height,
        set: (value) => {
          height = value;
          written.height += 1;
        },
      });
      return { style, written };
    };
    const content = counting();
    const viewport = counting();
    const rail = {
      querySelector: (selector) => (selector === '.document-minimap-content' ? content : selector === '.document-minimap-viewport' ? viewport : null),
    };
    const metrics = { scaledDocumentHeight: 2000, trackHeight: 700, scrollable: 12322, scrollTop: 0, viewportHeight: 800, previewScale: 0.05 };
    booted.placeMinimapViewport(rail, metrics, 6161);
    booted.placeMinimapViewport(rail, metrics, 6161);
    if (content.written.height !== 2) throw new Error(`the thumbnail lane's height was written ${content.written.height} times over two identical passes`);
    if (viewport.written.height !== 2) throw new Error(`the box's height was written ${viewport.written.height} times over two identical passes`);
  });

  // Nothing in the page may put itself straight back on the frame queue: a job that does keeps the window drawing for as long as its condition holds, and the condition here is a 600ms pane motion. Draining has to reach a fixed point, and the pane finishing is what asks again.
  check('the rail waits for the library pane instead of asking every frame', () => {
    // Its own page, because it moves the pane and the app bar's fold with it, and the shared one is read by every check after this.
    const page = runShell(source);
    const frames = page.__frames;
    const root = page.document.documentElement;
    const minimapWidth = () => root.style.getPropertyValue('--minimap-width');
    // A code character's width, so the ruler below answers a number the arithmetic can spend. Any width does; this is a monospace face at the size Monaco measures at.
    const RULER_CHAR = 8.4;
    // The width the guard holds back is measured off a ruler the page appends, and every rectangle the stand-in answers is zero wide — so with no ruler of its own this check reads an unwritten property whether the write was dropped or made, and passes with the guard lifted out of the file altogether. A ruler as wide as what is written into it is the whole of what makes the dropped write visible.
    const madeElement = page.document.createElement;
    page.document.createElement = (tag) => {
      const made = madeElement(tag);
      made.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, height: 0, width: String(made.textContent || '').length * RULER_CHAR });
      return made;
    };
    root.style.setProperty('--code-font', 'monospace');
    root.style.setProperty('--reader-gutter', '24px');
    page.document.getElementById('libraryShell').clientWidth = VIEW_WIDTH;
    root.style.removeProperty('--minimap-width');
    frames.drain();
    // The app's own toggle, never a class name typed in here: the names the guard reads belong to library.js, and a check spelling them itself goes on passing the day that fragment spells them differently.
    page.toggleLibrary();
    if (!page.libraryPaneIsMoving()) throw new Error('the toggle never armed the pane motion');
    // Arming settles whatever was running, and that settle asks for the width — so a held-back request is already standing here.
    frames.drain();
    if (minimapWidth()) throw new Error(`the rail took its width as the pane started moving: ${minimapWidth()}`);
    page.scheduleMinimapWidthSync();
    const ran = frames.drain();
    if (ran !== 1) throw new Error(`one request for the rail's width ran ${ran} frames`);
    if (minimapWidth()) throw new Error(`the rail took its width mid-motion: ${minimapWidth()}`);
    page.endLibraryMotion();
    // The frames the end asks for are the width and the bar's own refit beside it, and what proves the held-back write was taken is the width landing.
    if (!frames.drain()) throw new Error('the pane finishing its motion never asked for the width it held back');
    if (!/^[\d.]+px$/.test(minimapWidth())) throw new Error(`the pane stopped and the rail was left at ${minimapWidth() || 'nothing'}`);
  });
  // The rail is chrome in a grid column beside the box that scrolls, and the window itself does not scroll — so with nothing scrollable under it, a notch over the one strip the app draws in place of a scrollbar has nothing to move, in the very place a click or a drag on it leaves the pointer. What answers it is the column itself: it is a scroller, the web view moves it, and the page only carries the position across. Everything below drives the real listeners at the real column.
  //
  // The column's range here is what a browser adds up: whatever the rail itself stands in, plus the spacer. So a spacer written straight from the reader's range and left there overshoots, which is what makes the read-back correction visible rather than assumed.
  const RAIL_CONTENT_HEIGHT = 730;
  const COLUMN_HEIGHT = 800;
  const railColumnStand = () => {
    const rail = booted.document.getElementById('readerMinimap');
    const appEl = booted.document.getElementById('app');
    const columnScroll = (rail.listeners.get('scroll') || []).at(-1);
    if (!columnScroll) throw new Error("nothing carries the rail column's scroll onto the reader");
    // The reader's own, and the last one bound to it: minimap.js is the last fragment that binds a scroll there.
    const readerScroll = (appEl.listeners.get('scroll') || []).at(-1);
    if (!readerScroll) throw new Error("nothing carries the reader's scroll back onto the rail column");
    booted.setMinimapMarkup(booted.documentMinimapMarkup());
    const spacer = rail.querySelector('.reader-minimap-spacer');
    const spacerHeight = () => Math.max(0, parseFloat(spacer && spacer.style.height) || 0);
    rail.clientHeight = COLUMN_HEIGHT;
    Object.defineProperty(rail, 'scrollHeight', {
      configurable: true,
      // A browser never answers less than the box itself, which is what leaves an unscrollable reader's column with no travel at all.
      get: () => Math.max(COLUMN_HEIGHT, RAIL_CONTENT_HEIGHT + spacerHeight()),
    });
    const wasHold = booted.leafHoldPointer;
    booted.leafHoldPointer = () => {};
    const wasMeasure = booted.measureDocumentMinimap;
    booted.measureDocumentMinimap = () => ({ scrollable: 10000, viewportHeight: 800, previewScale: 0.05, trackHeight: 700, scaledDocumentHeight: 2000, scrollTop: 0 });
    return {
      rail,
      app: appEl,
      spacer,
      columnScroll,
      readerScroll,
      // What the column can travel, the way a browser works it out.
      travel: () => Math.max(0, rail.scrollHeight - rail.clientHeight),
      // Give the reader a document, and let the frame the invalidation asks for size the column to it.
      setReader: (scrollHeight, clientHeight = 787) => {
        appEl.scrollHeight = scrollHeight;
        appEl.clientHeight = clientHeight;
        booted.invalidateMinimapMetrics();
        booted.__frames.drain();
      },
      done: () => {
        booted.leafHoldPointer = wasHold;
        booted.measureDocumentMinimap = wasMeasure;
        booted.setMinimapMarkup('');
        delete rail.scrollHeight;
        rail.scrollHeight = 0;
        rail.clientHeight = 0;
        rail.scrollTop = 0;
        rail.classList.remove('is-scroll-held');
        appEl.scrollTop = 0;
        appEl.scrollHeight = 0;
        appEl.clientHeight = 0;
        booted.__frames.drain();
      },
    };
  };

  // The whole of the fault: a real notch at the rail landed the right distance in one jump, because the page wrote the reader's new position itself — the only place in the app that moved the reader rather than asking the web view to. Nothing may claim that notch now, or whatever curve the web view gives the page is taken off it again.
  check('no listener claims a notch over the rail', () => {
    const rail = booted.document.getElementById('readerMinimap');
    if ((rail.listeners.get('wheel') || []).length) throw new Error('something still claims a wheel over the rail, so the notch is not the web view\u2019s');
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    if (/deltaMode/.test(fragment)) throw new Error('the notch conversion outlived the handler, so something is still counting a wheel');
    const css = readFileSync(join(root, 'src/assets/reading/library.css'), 'utf8');
    const opened = css.indexOf('.reader-minimap {');
    if (opened < 0) throw new Error('the rail column has no rule of its own');
    const rule = css.slice(opened, css.indexOf('}', opened));
    if (!/overflow-y:\s*auto/.test(rule)) throw new Error('the rail column does not scroll, so a notch over it has nothing to move');
    if (!/scrollbar-width:\s*none/.test(rule)) throw new Error('the column would draw a bar saying what the rail already says');
    if (!/\.reader-minimap::-webkit-scrollbar\s*\{[^}]*width:\s*0/.test(css)) throw new Error('the column draws a bar in the web view it actually runs in');
    if (!/\.reader-minimap\.is-scroll-held\s*\{[^}]*overflow-y:\s*hidden/.test(css)) throw new Error('a drag on the box cannot take the column\u2019s scroll away');
    // The travel is the spacer's alone: pinned to the top of the column, the rail's own parts stay where the click jump and the box drag read them.
    const railCss = readFileSync(join(root, 'src/assets/reading/minimap.css'), 'utf8');
    const opensPin = railCss.indexOf('.document-minimap {');
    const pinned = railCss.slice(opensPin, railCss.indexOf('}', opensPin));
    if (!/position:\s*sticky/.test(pinned)) throw new Error('the rail rides the column\u2019s scroll instead of staying pinned to the top of it');
  });

  // The thumbnail started an app bar below the top of the page card, because a sticky offset is measured from the scrollport's content edge and the column's top padding has already moved that down by the bar \u2014 so naming the bar's height on the pin stacked on the padding rather than standing in for it. Watched in a running copy: the bar's bottom at 54 and the thumbnail's top at 94, and zero put it on 54.
  check('the rail\u2019s thumbnail is pinned level with the top of the page card', () => {
    const columnCss = readFileSync(join(root, 'src/assets/reading/library.css'), 'utf8');
    const opensColumn = columnCss.indexOf('.reader-minimap {');
    if (opensColumn < 0) throw new Error('the rail column has no rule of its own');
    const column = columnCss.slice(opensColumn, columnCss.indexOf('}', opensColumn));
    // The padding is what places the thumbnail level with the card; the pin's offset must not be a second copy of it.
    if (!/padding-top:\s*var\(--app-bar-height\)/.test(column)) throw new Error('the column no longer holds its contents off the bar, so the pin\u2019s offset is not the whole placement any more');
    const railCss = readFileSync(join(root, 'src/assets/reading/minimap.css'), 'utf8');
    const opensPin = railCss.indexOf('.document-minimap {');
    const pinned = railCss.slice(opensPin, railCss.indexOf('}', opensPin));
    const offset = /top:\s*([^;]+);/.exec(pinned);
    if (!offset) throw new Error('the pin names no offset at all, so where it holds the thumbnail is the browser\u2019s guess');
    if (offset[1].trim() !== '0') throw new Error(`the pin's offset is ${offset[1].trim()}, which stacks on the column's top padding and starts the thumbnail an app bar below the top of the page card`);
  });

  // The pin is what keeps the column's travel off the rail's own parts. A fake page runs no sticky, so what is provable here is the other half of it: the column's scroll writes the reader's position and nothing else \u2014 nothing in that path moves the thumbnail, the track or the box, so with the offset at zero the pin is the only thing placing them.
  check('the column\u2019s scroll moves the reader and never the rail\u2019s own parts', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      const thumb = stand.rail.querySelector('.document-minimap');
      if (!thumb) throw new Error('the rail drew no thumbnail to hold still');
      const placedBefore = `${thumb.style.top || ''}|${thumb.style.transform || ''}|${thumb.style.marginTop || ''}`;
      stand.rail.scrollTop = 4000;
      stand.columnScroll({});
      booted.__frames.drain();
      if (Math.round(stand.app.scrollTop) !== 4000) throw new Error(`the column's scroll left the reader at ${stand.app.scrollTop}`);
      const placedAfter = `${thumb.style.top || ''}|${thumb.style.transform || ''}|${thumb.style.marginTop || ''}`;
      if (placedAfter !== placedBefore) throw new Error('the column\u2019s scroll moved the thumbnail itself, so the pin is not what places it');
    } finally {
      stand.done();
    }
  });

  // A notch over the rail has to carry the page exactly what the same notch carries it over the page, which is the one thing the handler this replaces already got right. A column that travels a different distance than the reader spends every notch at a different rate.
  check('the rail\u2019s column travels exactly as far as the reader does', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      if (stand.travel() !== 16320 - 787) throw new Error(`the reader can travel ${16320 - 787} and the column ${stand.travel()}`);
      // Computed and trusted rather than read back, the spacer would be the reader's whole range and the column would outrun it by what the rail itself stands in.
      if (stand.spacer.style.height === `${16320 - 787}px`) throw new Error('the spacer was written straight from the reader\u2019s range, so the column outruns it');
    } finally {
      stand.done();
    }
  });

  // The page's whole part in the gesture: the web view scrolls the column, and this carries that position onto the reader.
  check('scrolling the rail\u2019s column carries the reader with it', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      stand.app.scrollTop = 1000;
      stand.rail.scrollTop = 1400;
      stand.columnScroll();
      if (stand.app.scrollTop !== 1400) throw new Error(`the column moved to 1400 and the reader to ${stand.app.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // A click on the rail, a drag on the box, the keyboard, a tab switch and a reflow re-pin all move the reader without touching the column, and the next notch over the rail would jump the page back to wherever the column was left. The other half is what must not happen: the reader's own event answering a scroll the column started, and carrying the column back over it.
  check('a jump the reader makes leaves the column where the reader now is', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      stand.app.scrollTop = 900;
      stand.readerScroll();
      if (stand.rail.scrollTop !== 900) throw new Error(`the reader jumped to 900 and the column stayed at ${stand.rail.scrollTop}`);
      // A scroll event lands a frame after the write that caused it, so by the time the reader's arrives a gliding column has moved on twice. What the page holds is the position it last wrote, not a flag — a flag would be spent on the second of these, and the reader's event would then drag the column back to the first.
      stand.rail.scrollTop = 2000;
      stand.columnScroll();
      stand.rail.scrollTop = 2200;
      stand.columnScroll();
      stand.readerScroll();
      if (stand.rail.scrollTop !== 2200) throw new Error(`the reader\u2019s answer dragged the gliding column back to ${stand.rail.scrollTop}`);
      if (stand.app.scrollTop !== 2200) throw new Error(`the column glided to 2200 and left the reader at ${stand.app.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // The mirror's own direction of the one-frame lag, and the whole of the Mac trackpad jitter. While the page glides its scroll writes the column, and the column's answering event lands a frame later carrying the position the page held then — written back, that drags the page to the previous frame and cancels the animation drawing it. Measured in the running app: eleven such write-backs a second of glide, and the page stopped a third of the way down and sat still.
  check('the column never carries the reader\u2019s own mirror back onto a gliding page', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      // Frame N of a glide: the page's scroll writes the column to where the page is.
      stand.app.scrollTop = 3000;
      stand.readerScroll();
      if (stand.rail.scrollTop !== 3000) throw new Error(`the reader glided to 3000 and left the column at ${stand.rail.scrollTop}`);
      // Frame N+1: the glide has moved on, and the column's late scroll event arrives still carrying frame N.
      stand.app.scrollTop = 3400;
      stand.columnScroll();
      if (stand.app.scrollTop !== 3400) throw new Error(`the column\u2019s echo dragged the gliding reader back to ${stand.app.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // The other half of that guard: it may only ever swallow the mirror's own write. A hand on the rail lands the column somewhere the mirror never put it, and that has to carry the page exactly as it does today.
  check('a rail gesture off the recorded position still carries the reader one to one', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      stand.app.scrollTop = 3000;
      stand.readerScroll();
      stand.rail.scrollTop = 800;
      stand.columnScroll();
      if (stand.app.scrollTop !== 800) throw new Error(`a rail gesture to 800 left the reader at ${stand.app.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // The record is a module-scope value, so a document switch that left it standing would carry one document's mirrored position into the next — and there the page is not where the record says, so the guard would swallow the first rail gesture that happened to land on it.
  check('a fresh document clears the position the mirror last wrote', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      stand.app.scrollTop = 3000;
      stand.readerScroll();
      // The next document, opened where the last one was read.
      booted.initializeMinimapState();
      stand.app.scrollTop = 0;
      stand.rail.scrollTop = 3000;
      stand.columnScroll();
      if (stand.app.scrollTop !== 3000) throw new Error(`a rail gesture to 3000 on a fresh document left the reader at ${stand.app.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // The column stands while the code view is up, where it holds no rail at all — and the same case covers the start screen and a document short enough to need no scrolling. No travel there, so the notch is the web view's to do nothing with, exactly as it is today.
  check('an empty column is left to the web view', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      if (!stand.travel()) throw new Error('the column had no travel to lose');
      // A document that fits the window.
      stand.setReader(600, 787);
      if (stand.travel()) throw new Error(`a reader that cannot scroll left the column ${stand.travel()} to travel`);
      // No rail at all: the code view, and the start screen.
      booted.setMinimapMarkup('');
      if (stand.rail.querySelector('.reader-minimap-spacer')) throw new Error('an empty column kept the travel the rail gave it');
    } finally {
      stand.done();
    }
  });

  // A drag holds the box against the pointer and writes the reader's position itself; a notch landing mid-drag would fight it for the same value. The shipped handler refused the notch, and the column refuses to scroll at all — the same fact one layer down.
  check('a drag on the box still owns the scroll', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      const track = stand.rail.querySelector('.document-minimap-track');
      booted.bindDocumentMinimap();
      const pointer = () => ({ button: 0, pointerId: 7, clientY: 100, preventDefault() {} });
      for (const handler of track.listeners.get('pointerdown') || []) handler(pointer());
      if (!stand.rail.classList.contains('is-scroll-held')) throw new Error('the column can still be scrolled while the box is held');
      stand.app.scrollTop = 5000;
      for (const handler of track.listeners.get('pointerup') || []) handler(pointer());
      if (stand.rail.classList.contains('is-scroll-held')) throw new Error('the column never got its scroll back after the drag');
      if (stand.rail.scrollTop !== 5000) throw new Error(`the drag left the reader at 5000 and the column at ${stand.rail.scrollTop}`);
    } finally {
      stand.done();
    }
  });

  // The travel is the document's height, so it has to follow it — a diagram pass, a details block opening, an image landing, a window resize. Everything that can change it already drops the rail's cached geometry, so that is the one place it is asked for rather than a second list of the same triggers to keep in step.
  check('a taller document lengthens the column\u2019s travel', () => {
    const stand = railColumnStand();
    try {
      stand.setReader(16320, 787);
      if (stand.travel() !== 16320 - 787) throw new Error(`the column travels ${stand.travel()}`);
      stand.setReader(40000, 787);
      if (stand.travel() !== 40000 - 787) throw new Error(`the document grew and the column travels ${stand.travel()}`);
      stand.setReader(4000, 787);
      if (stand.travel() !== 4000 - 787) throw new Error(`the document shrank and the column travels ${stand.travel()}`);
    } finally {
      stand.done();
    }
  });
}
