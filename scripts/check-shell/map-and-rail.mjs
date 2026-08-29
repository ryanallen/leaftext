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

  // The keep-it half. This answers without asking the guard at all, which is the whole point: a guard that starts failing again for some later reason costs one comparison rather than a rebuild every frame for as long as the window is open.
  check('a rebuild that would clone the same rows keeps the thumbnail', () => {
    const { minimapRebuildWouldChangeNothing } = booted;
    const metrics = { sourceWidth: 800 };
    const built = (extra = '') => vm.runInContext(
      'minimapContentVersion = 7; minimapBuiltVersion = 7; minimapBuiltSourceWidth = 800;'
        + 'minimapBuiltPreviewWidth = 90; minimapBuiltFrameWidth = 760;'
        + `minimapBuiltFirstRow = 12; minimapBuiltLastRow = 40;${extra}`,
      booted,
    );
    try {
      built();
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40)) throw new Error('an untouched document rebuilt its thumbnail anyway');
      // Everything that shapes a clone still forces one.
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 13, 40)) throw new Error('a scroll into a new slice kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 41)) throw new Error('a slice ending on a new row kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 91, 760, 12, 40)) throw new Error('a wider rail kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 800, 12, 40)) throw new Error('more room for the layout kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing({ sourceWidth: 900 }, 90, 760, 12, 40)) throw new Error('a rewrapped document kept the old thumbnail');
      built('minimapContentVersion = 8;');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40)) throw new Error('an edited document kept the old thumbnail');
    } finally {
      vm.runInContext(
        'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
          + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1;'
          + 'minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1;',
        booted,
      );
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
    if (booted.minimapWindowRows(body).length !== 4) throw new Error('the rows a window slices are not the body’s own blocks');

    // A window over the middle two rows: those rows and nothing else, in the order the document has them.
    const windowed = booted.buildWindowedMinimapClone(body, 1, 2);
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

  // The other listener that hears the document change watches the reading view's own body, and the clone lands in the rail beside it — so a landing clone was never something that watcher could see, and the toggle guard above is the only thing standing between the rail and its own thumbnail. Both halves are where the markup puts them, which is what this holds.
  check('the rail sits outside the body the thumbnail watches', () => {
    const page = pageMarkup();
    const opened = page.indexOf('<main id="app"');
    const closed = page.indexOf('</main>', opened);
    if (opened < 0 || closed < 0) throw new Error('the reading view is not a <main id="app"> any more');
    if (page.slice(opened, closed).includes('readerMinimap')) throw new Error('the rail moved inside the reading view, so its clone lands where the watcher can see it');
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    if (!/function minimapSourceElement\(\) \{\s*return app\.querySelector\('\.document-body'\);/.test(fragment)) throw new Error('the thumbnail no longer clones the reading view’s own body');
    if (!/minimapBodyObserver = new MutationObserver\(invalidateMinimapPreview\);\s*minimapBodyObserver\.observe\(source, \{/.test(fragment)) throw new Error('the watcher is no longer bound to the element the thumbnail is cloned from');
  });

  // Placing the box runs every frame of every scroll, and a custom property inherits — so writing one on the rail re-resolves style across the whole clone hanging under it, which measured 78ms a write against 0.13ms for writing onto the element that draws. Neither `transform` nor `top` inherits, so neither reaches the clone at all.
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
    if (!/px$/.test(viewport.style.top || '') || !/px$/.test(viewport.style.height || '')) throw new Error('the box was not placed and sized on itself');
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
  // The rail is chrome in a grid column beside the box that scrolls, and the window's own scroll is gone — so a notch over the one strip the app draws in place of a scrollbar found nothing above it to move, in the very place a click or a drag on it leaves the pointer. What answers it is the column itself: it is a scroller, the web view moves it, and all the page does is carry the position across. Everything below drives the real listeners at the real column.
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
    if (!/position:\s*sticky/.test(pinned) || !/top:\s*var\(--app-bar-height\)/.test(pinned)) throw new Error('the rail rides the column\u2019s scroll instead of staying pinned to the top of it');
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
