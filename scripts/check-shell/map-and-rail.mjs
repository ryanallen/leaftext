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

  // The whole of the thumbnail is what the copy kept: a shallow copy of the reading body for the wrapper, a deep copy of each row put into it. Nothing had ever read one back — until the stand-in page could really copy, a check here was handed its own copy and proved that instead.
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
  // The rail is chrome in a grid column beside the box that scrolls, and the window's own scroll is gone — so a notch over the one strip the app draws in place of a scrollbar found nothing above it to move, in the very place a click or a drag on it leaves the pointer. Everything below fires the real handler at the real column.
  const railWheelStand = () => {
    const rail = booted.document.getElementById('readerMinimap');
    const handler = (rail.listeners.get('wheel') || []).at(-1);
    if (!handler) throw new Error('nothing listens for a wheel over the rail');
    const appEl = booted.document.getElementById('app');
    const track = fakeElement('');
    track.classList.add('document-minimap-track');
    const minimap = fakeElement('');
    minimap.classList.add('document-minimap');
    minimap.appendChild(track);
    rail.appendChild(minimap);
    const measured = { count: 0 };
    const wasMeasure = booted.measureDocumentMinimap;
    booted.measureDocumentMinimap = () => {
      measured.count += 1;
      return { scrollable: 10000, viewportHeight: 800 };
    };
    vm.runInContext('invalidateMinimapMetrics(); minimapDragging = false;', booted);
    return {
      handler,
      app: appEl,
      minimap,
      measured,
      done: () => {
        booted.measureDocumentMinimap = wasMeasure;
        minimap.remove();
        appEl.scrollTop = 0;
        vm.runInContext('invalidateMinimapMetrics(); minimapDragging = false; minimapWheelLineHeight = 0;', booted);
      },
    };
  };
  const railWheel = (changes = {}) => {
    let prevented = false;
    return {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      deltaX: 0,
      deltaY: 200,
      deltaMode: 0,
      preventDefault() {
        prevented = true;
      },
      prevented: () => prevented,
      ...changes,
    };
  };

  // The whole of the fault: a real notch at the rail left the reader where it was, while the same notch over the page moved it 200.
  check('a wheel over the rail scrolls the reader by the notch and claims it', () => {
    const stand = railWheelStand();
    try {
      stand.app.scrollTop = 400;
      const notch = railWheel();
      stand.handler(notch);
      if (stand.app.scrollTop !== 600) throw new Error(`a notch over the rail moved the reader to ${stand.app.scrollTop}`);
      if (!notch.prevented()) throw new Error('the notch it spent was left to the web view as well');
    } finally {
      stand.done();
    }
  });

  // Over the page a notch at either end chains nowhere, because the window's own scroll is gone — so claiming it here is what the reader already sees rather than a stray gesture escaping to the web view.
  check('the wheel stops the reader at the top and at the foot, and still claims the notch', () => {
    const stand = railWheelStand();
    try {
      stand.app.scrollTop = 0;
      const up = railWheel({ deltaY: -200 });
      stand.handler(up);
      if (stand.app.scrollTop !== 0) throw new Error(`a notch at the top took the reader to ${stand.app.scrollTop}`);
      if (!up.prevented()) throw new Error('a notch at the top escaped to the web view');
      stand.app.scrollTop = 10000;
      const down = railWheel();
      stand.handler(down);
      if (stand.app.scrollTop !== 10000) throw new Error(`a notch at the foot took the reader to ${stand.app.scrollTop}`);
      if (!down.prevented()) throw new Error('a notch at the foot escaped to the web view');
    } finally {
      stand.done();
    }
  });

  // A zoom over the rail is the web view's exactly as it is over the page, and a sideways trackpad gesture is nobody's here.
  check('a held key or a sideways notch over the rail is left alone', () => {
    const stand = railWheelStand();
    try {
      for (const changes of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { deltaY: 0, deltaX: 200 }]) {
        stand.app.scrollTop = 400;
        const ignored = railWheel(changes);
        stand.handler(ignored);
        if (stand.app.scrollTop !== 400) throw new Error(`an unclaimed wheel moved the reader to ${stand.app.scrollTop}`);
        if (ignored.prevented()) throw new Error('an unclaimed wheel was taken off the web view anyway');
      }
    } finally {
      stand.done();
    }
  });

  // The column stands while the code view is up, where it holds no rail at all — and the same return covers the start screen. Claiming a notch there would take the wheel off a web view that is scrolling something of its own.
  check('with no rail in the column the notch is left to the web view', () => {
    const stand = railWheelStand();
    stand.minimap.remove();
    try {
      stand.app.scrollTop = 400;
      const notch = railWheel();
      stand.handler(notch);
      if (stand.app.scrollTop !== 400) throw new Error(`an empty column scrolled the reader to ${stand.app.scrollTop}`);
      if (notch.prevented()) throw new Error('an empty column claimed the notch');
    } finally {
      stand.done();
    }
  });

  // A drag holds the box against the pointer and writes the scroll itself; a notch landing mid-drag would fight it for the same value.
  check('a notch while the box is being dragged changes nothing', () => {
    const stand = railWheelStand();
    try {
      vm.runInContext('minimapDragging = true;', booted);
      stand.app.scrollTop = 400;
      const notch = railWheel();
      stand.handler(notch);
      if (stand.app.scrollTop !== 400) throw new Error(`a notch mid-drag moved the reader to ${stand.app.scrollTop}`);
      if (notch.prevented()) throw new Error('a notch mid-drag was claimed');
    } finally {
      stand.done();
    }
  });

  // This host reports pixels, so raw arithmetic would ship correct here and move the reader three pixels a notch in a browser reporting lines — the same fault in a thinner shape.
  check('a notch counted in lines or in pages moves further than its raw number', () => {
    const stand = railWheelStand();
    try {
      stand.app.style.setProperty('line-height', '40px');
      stand.app.scrollTop = 0;
      stand.handler(railWheel({ deltaY: 3, deltaMode: 1 }));
      if (stand.app.scrollTop !== 120) throw new Error(`three lines moved the reader ${stand.app.scrollTop}`);
      stand.app.scrollTop = 0;
      stand.handler(railWheel({ deltaY: 2, deltaMode: 2 }));
      if (stand.app.scrollTop !== 1600) throw new Error(`two pages moved the reader ${stand.app.scrollTop}`);
    } finally {
      stand.app.style.removeProperty('line-height');
      stand.done();
    }
  });

  // Re-measuring per notch forces a fresh layout of the whole document — ~400ms on a large glossary, the wheel taking two seconds to answer. Scrolling cannot change that geometry, so the scroll path's cache is what the range comes from.
  check('the wheel takes its range from the cached rail metrics rather than measuring again', () => {
    const stand = railWheelStand();
    try {
      stand.app.scrollTop = 0;
      for (let i = 0; i < 5; i += 1) stand.handler(railWheel());
      if (stand.app.scrollTop !== 1000) throw new Error(`five notches moved the reader ${stand.app.scrollTop}`);
      if (stand.measured.count !== 1) throw new Error(`five notches measured the document ${stand.measured.count} times`);
    } finally {
      stand.done();
    }
  });

  // The fault was the rail standing outside the box that scrolls, so a notch looking up its ancestors found nothing. The listener has to be on that outside element, and it has to be able to claim the notch.
  check('the wheel listener is bound to the rail column, which stands outside the scroller', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    const opened = fragment.indexOf("readerMinimap.addEventListener('wheel',");
    if (opened < 0) throw new Error('the wheel is no longer listened for on the rail column itself');
    if (!/\{ passive: false \}\);/.test(fragment.slice(opened))) throw new Error('the rail wheel listener is passive, so it cannot claim a notch');
    const page = pageMarkup();
    const from = page.indexOf('<main id="app"');
    const to = page.indexOf('</main>', from);
    if (from < 0 || to < 0) throw new Error('the reading view is not a <main id="app"> any more');
    if (page.slice(from, to).includes('readerMinimap')) throw new Error('the rail moved inside the scroller, so the notch it answers would have chained there anyway');
  });
}
