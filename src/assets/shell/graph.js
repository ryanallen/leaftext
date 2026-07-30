// ---------------------------------------------------------------------------
// Graph view: an Obsidian-style force-directed map of how documents link to one
// another, rendered with PixiJS (WebGL) and laid out with d3-force. Nodes are
// documents; edges are resolved doc-to-doc links. The active document is the
// highlighted center; clicking a node opens it; hovering lights up its links.
// ---------------------------------------------------------------------------
let graphData = null; // last {nodes, edges, truncated} payload from the backend
let graphRequested = false; // asked the backend since entering the graph view
let graphScene = null; // live Pixi/d3 scene while the view is open
let graphActivePath = null;
let graphLibsPromise = null;
let graphSeedKey = null; // scope+seeds of the last request, to skip redundant refetches
let graphFocusPending = false; // fly to the active node once the next scene finishes building
const GRAPH_NEIGHBOR_LABEL_CAP = 12;
// Focus scope on the start screen seeds from the recent files; cap how many so a
// long history does not balloon the neighborhood.
const GRAPH_RECENT_SEED_CAP = 50;
// How far the world container can zoom in/out (mouse wheel and focus flights are
// both clamped to this). Kept as constants so the label supersample below can be
// tied to the same ceiling.
const GRAPH_MIN_ZOOM = 0.15;
const GRAPH_MAX_ZOOM = 4;
// Screen margin left around the graph when it fits itself to the view. Larger
// than a node needs, because a label hangs above each one.
const GRAPH_FIT_PADDING = 64;
// When we fly the graph to a node (clicking its tab), settle at least this zoom
// so the node reads as focused; never zoom out from a closer view the user set.
const GRAPH_FOCUS_ZOOM = 2.2;
const GRAPH_FOCUS_DURATION_MS = 420;
// Ambient labels (the names floating by the nodes you are not on) render at a
// fixed screen size and are decluttered by collision — see layoutGraphLabels.
const GRAPH_LABEL_FONT_SIZE = 11;
const GRAPH_LABEL_GAP = 4; // screen px between a node and the top of its label
// Above this node count, skip ambient labels: the collision pass would rarely
// place any in a dense overview and the per-relayout cost stops being free.
// Active/hover labels still show at any size.
const GRAPH_AMBIENT_LABEL_MAX = 400;
// Where a rebuild that inherited the last layout starts the simulation: a nudge to
// absorb what changed, not a fresh layout. Full alpha threw the whole map out from
// the center again, which is what a save looked like from the reader's side.
const GRAPH_WARM_ALPHA = 0.3;
// A burst of writes under the vault arrives as a burst of graphs. Build the last
// and skip the rest — each rebuild is a WebGL context thrown away.
const GRAPH_REBUILD_COALESCE_MS = 150;
let graphRebuildTimer = 0;

// Show the map instead of the document, or put the document back. One flag for
// the window, not a mode each tab remembers: a graph is of the vault, and the
// question "which tab was it on" has no answer.
function setGraphView(open) {
  const next = Boolean(open) && graphHasBoundedRoot();
  if (next === graphViewOpen) return;
  graphViewOpen = next;
  applyGraphView();
  // The host needs to know so a file changing on disk only costs a redraw when
  // there is something on screen to redraw.
  send({ command: 'setGraphView', open: graphViewOpen });
  if (graphViewOpen) showGraph();
  else teardownGraph();
}
// Leaving the graph for a document, which is what opening one means. Silent when
// the graph was not up.
function closeGraphView() {
  setGraphView(false);
}
function applyGraphView() {
  if (readerGraph) readerGraph.hidden = !graphViewOpen;
  if (app) app.hidden = graphViewOpen;
  if (readerMinimap) readerMinimap.hidden = graphViewOpen;
  // No minimap, so no reason to keep holding its column. The stylesheet reads
  // this to give the map, and what floats over it, the full width.
  document.documentElement.dataset.graphView = graphViewOpen ? 'true' : 'false';
  renderReaderToolbar(!!activeDocumentPath());
}
// The bar: the views of the open document, one of them pressed, then whatever
// edits apply.
//
// No document, no bar. The three views are three ways of showing one thing, and
// on the home screen there is no thing — a toggle there would be flipping
// between the recent files and a map, which is navigation, not a view. The pane
// beside it already does that, and does it better.
//
// A view you *can* be in but cannot enter grays out where it stands rather than
// vanishing: those states come and go as you work, and a row that reshuffles
// under the pointer is worse than one with a dead key in it.
function renderReaderToolbar(hasDocument) {
  if (!readerToolbar) return;
  readerToolbar.hidden = !hasDocument;
  if (!hasDocument) return;
  const current = graphViewOpen ? 'graph' : codeViewActive ? 'code' : 'reading';
  const enabled = { reading: true, code: true, graph: graphHasBoundedRoot() };
  for (const button of [viewReadingButton, viewCodeButton, viewGraphButton]) {
    if (!button) continue;
    const view = button.dataset.view;
    const on = view === current;
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('is-active', on);
    const unavailable = !enabled[view] && !on;
    button.disabled = unavailable;
    setViewToolReason(button, unavailable);
  }
  renderReadingTools(current === 'reading');
}
// Why a view can't be entered, keyed by view — what the grayed-out key says when
// you hover it, instead of leaving you to work it out. Only the map has a reason
// to give: it is of a vault, so without one there is nothing to draw. The other
// two are always enterable, and if that ever changes they keep their ordinary
// tooltip rather than inventing an explanation. The sentence is the one the map
// itself shows when you get there, so it is said in one place.
const VIEW_UNAVAILABLE_REASON = { graph: 'library.graph.needsVault' };
// Point a grayed-out view key's tooltip at that reason, and an enterable one back
// at what it does.
//
// Swapped by KEY and not by text: the pass that reapplies wording after a language
// change reads data-i18n-title off the element, so setting the title alone would
// put the old sentence back the moment the language changed. The enterable key is
// the one the markup already carries, remembered here before it is overwritten, so
// there is no second copy of it in this file to drift out of step.
function setViewToolReason(button, unavailable) {
  if (!button.dataset.i18nTitleEnterable) {
    button.dataset.i18nTitleEnterable = button.dataset.i18nTitle || '';
  }
  const key =
    (unavailable && VIEW_UNAVAILABLE_REASON[button.dataset.view]) ||
    button.dataset.i18nTitleEnterable;
  if (!key) return;
  button.dataset.i18nTitle = key;
  button.title = window.leafLocale.t(key);
}
// The reading view's own tools. None turns blue: the filled chip means "this is
// the view you are in", and a setting inside that view must not wear it. The
// glyph carries the state instead -- a shut padlock, a thin first letter.
function renderReadingTools(onReadingView) {
  if (readerViewTools) readerViewTools.hidden = !onReadingView;
  if (!onReadingView) return;
  const unlocked = readerEditingAllowed();
  setSubtoolState(readerLockButton, unlocked, unlocked ? 'toolbar.lock' : 'toolbar.unlock');
  setSubtoolState(speedReaderButton, speedReaderEnabled, 'toolbar.speedReader');
}
function setSubtoolState(button, on, labelKey) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(on));
  const label = window.leafLocale.t(labelKey);
  button.title = label;
  button.setAttribute('aria-label', label);
}
// Flipping it re-renders the document, which is what binds or drops the editable
// blocks. Any block mid-edit is committed first rather than silently discarded.
function toggleReaderLock() {
  const path = activeDocumentPath();
  if (!path) return;
  commitActiveEditingBlock();
  if (readerUnlockedByPath.has(path)) readerUnlockedByPath.delete(path);
  else readerUnlockedByPath.add(path);
  renderState();
}
if (readerLockButton) {
  readerLockButton.addEventListener('click', toggleReaderLock);
}
// The speed reader stays one preference for the whole app -- it is a way of
// reading, not a property of a document. The reading toolbar is the one place it
// is turned on and off; the glyph then shows which way it went.
if (speedReaderButton) {
  speedReaderButton.addEventListener('click', () => {
    setSpeedReaderEnabled(!speedReaderEnabled);
    send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });
    renderReadingTools(true);
  });
}
// Going to a view. Each is a way of showing the same thing, so entering one
// leaves the others — there is no state where two are on.
function setReaderView(view) {
  if (view === 'graph') {
    // The source view is of a document; the map is not. Leave it first.
    if (codeViewActive) toggleCodeView();
    setGraphView(true);
    return;
  }
  // Going from the map straight to the source: hold the map until the source is
  // ready, the way clicking a node does. Dropping it first reveals the reading
  // view, and revealing it lays out a whole document we are about to replace —
  // which is the reading view flashing up under a spinner on the way to the
  // code view.
  if (graphViewOpen && view === 'code' && !codeViewActive) {
    graphExitPending = true;
    toggleCodeView();
    return;
  }
  // Leaving the map for the reading view. #app is hidden while the map is up, so
  // revealing it re-lays-out the whole document — a stall on a big file with no
  // feedback. Hold a spinner across it, matching graph→code, instead of freezing
  // on the map. The 'graph' owner is what lets the spinner show while the map is
  // still up (beginReaderLoading otherwise suppresses spinners there).
  if (graphViewOpen && view === 'reading' && !codeViewActive) {
    beginReaderLoading('graph');
    // Two frames before the reveal so the spinner actually paints first — the
    // reveal below re-lays-out the whole document in one blocking frame, and
    // without the yield the spinner and the finished reader paint together, so it
    // never shows (mirrors runViewRender's heavy-payload path).
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        setGraphView(false);
        renderReaderToolbar(!!activeDocumentPath());
        window.requestAnimationFrame(() => clearReaderLoading('graph'));
      })
    );
    return;
  }
  setGraphView(false);
  // Reading and code are the same document either way round, so both are the
  // one toggle — it carries the reader's place across the swap.
  if ((view === 'code') !== codeViewActive) toggleCodeView();
  renderReaderToolbar(!!activeDocumentPath());
}
for (const button of [viewReadingButton, viewCodeButton, viewGraphButton]) {
  if (button) button.addEventListener('click', () => setReaderView(button.dataset.view));
}

function setGraphStatus(message) {
  if (!message) {
    readerGraphStatus.hidden = true;
    readerGraphStatus.textContent = '';
    return;
  }
  readerGraphStatus.hidden = false;
  readerGraphStatus.textContent = message;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// Load PixiJS and the d3-force bundle once, lazily, only when the graph opens.
function loadGraphLibs() {
  const ready = () => window.PIXI && window.d3 && typeof window.d3.forceSimulation === 'function';
  if (ready()) return Promise.resolve();
  if (graphLibsPromise) return graphLibsPromise;
  // Pixi must load before its unsafe-eval companion, which patches Pixi's shader
  // and uniform systems to avoid `new Function` (blocked by the CSP). d3-force
  // loads in parallel — it shares nothing with Pixi.
  const pixiChain = window.PIXI
    ? Promise.resolve()
    : loadScriptOnce(PIXI_SCRIPT_URL).then(() => loadScriptOnce(PIXI_UNSAFE_EVAL_SCRIPT_URL));
  graphLibsPromise = Promise.all([
    pixiChain,
    window.d3 && window.d3.forceSimulation ? Promise.resolve() : loadScriptOnce(D3_FORCE_SCRIPT_URL),
  ]).then(() => {
    if (!ready()) throw new Error('Graph runtimes loaded without exposing PIXI/d3');
  });
  return graphLibsPromise;
}

// Resolve a CSS custom property to a 0xRRGGBB number for Pixi tints.
function cssVarColor(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseCssColor(raw, fallback);
}
function parseCssColor(value, fallback) {
  if (!value) return fallback;
  if (value[0] === '#') {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return Number.isNaN(n) ? fallback : n;
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((x) => parseFloat(x));
    return ((parts[0] & 255) << 16) | ((parts[1] & 255) << 8) | (parts[2] & 255);
  }
  return fallback;
}

// The graph's palette, read fresh from the theme tokens. Used at build time and
// re-read on theme change so the canvas recolors with the rest of the app.
function graphColors() {
  return {
    node: cssVarColor('--app-muted-foreground', 0x8b95a5),
    active: cssVarColor('--accent', 0x8a63d2),
    hot: cssVarColor('--app-foreground', 0xe6e6e6),
    edge: cssVarColor('--app-border', 0x3a3f4b),
    // Ambient labels for the documents you are not on: the muted-foreground token
    // (a dim gray), so they read as secondary next to the active/hover labels.
    dim: cssVarColor('--app-muted-foreground', 0x8b95a5),
  };
}

function graphNodeRadius(degree) {
  return Math.max(3, Math.min(14, 3 + Math.sqrt(degree || 0) * 1.1));
}

// The Focus scope seeds from the open document, or from the recent files when no
// document is open (the start screen). Other scopes ignore seeds.
function graphSeeds() {
  const active = activeDocumentPath();
  if (active) return [active];
  return ((currentState && currentState.recent) || []).slice(0, GRAPH_RECENT_SEED_CAP);
}

// Ask the backend for the graph slice for the current scope + seeds, resetting any
// existing scene so the view reads "loading" until fresh data arrives.
function requestGraphData() {
  const seeds = graphSeeds();
  graphSeedKey = graphScope + '|' + seeds.join('\n');
  graphRequested = true;
  graphData = null;
  teardownGraphScene();
  // The spinner a slow document gets. Building a map is the same kind of wait,
  // and a line of text in the corner reads as a result rather than a wait.
  setGraphStatus('');
  beginReaderLoading('graph');
  send({ command: 'getGraph', scope: graphScope, seeds });
}

// Entry point when the graph view becomes visible. Requests fresh data the first
// time, then either builds the scene (data already in hand) or just moves the
// active-node highlight (scene already built).
// The graph is read off the disk, and the vault is the only root it reads. The
// whole library is not a collection, it is a computer — there is no map of it
// worth drawing and no way to read one without a crawl.
function graphHasBoundedRoot() {
  return Boolean(activeVaultId);
}
function showGraph() {
  graphActivePath = activeDocumentPath();
  if (!graphHasBoundedRoot()) {
    teardownGraphScene();
    clearReaderLoading('graph');
    setGraphStatus(window.leafLocale.t('library.graph.needsVault'));
    return;
  }
  if (!graphRequested) {
    requestGraphData();
  }
  if (graphScene) {
    applyGraphStyles();
  } else if (graphData) {
    buildGraphScene();
  }
}

// What a payload draws: the node set with its degrees, and the wires between
// them. Two graphs that agree on this are the same picture, however they arrived
// — so the one already on screen, with the layout it settled into and wherever
// the reader has panned it, is the better copy of it.
function graphSignature(data) {
  const nodes = (data && data.nodes) || [];
  const edges = (data && data.edges) || [];
  const marks = nodes.map((node) => node.path + ':' + (node.degree || 0)).sort();
  const wires = edges.map((edge) => edge.source + '>' + edge.target).sort();
  return marks.join('\n') + '\n--\n' + wires.join('\n');
}

window.leafSetGraph = (payload) => {
  if (payload && payload.error) {
    graphData = null;
    if (graphViewOpen) {
      teardownGraphScene();
      clearReaderLoading('graph');
      setGraphStatus((payload.error && payload.error.message) || window.leafLocale.t('library.graph.error'));
    }
    return;
  }
  graphData = payload || { nodes: [], edges: [], truncated: false };
  if (!graphViewOpen) return;
  // Already drawing exactly this. The host redraws for any change to the vault's
  // text, and most of them leave the map identical.
  if (graphScene && graphScene.signature === graphSignature(graphData)) return;
  // Nothing on screen yet: the first graph of a session is what the reader is
  // waiting for, so it must not wait behind a timer.
  if (!graphScene) {
    buildGraphScene();
    return;
  }
  if (graphRebuildTimer) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = setTimeout(() => {
    graphRebuildTimer = 0;
    if (graphViewOpen) buildGraphScene();
  }, GRAPH_REBUILD_COALESCE_MS);
};

function teardownGraph() {
  graphRequested = false;
  clearReaderLoading('graph');
  teardownGraphScene();
}
// Moving the pane moves the graph's root, so what it drew is about somewhere
// else now. Only matters while the graph is the view on screen.
function refreshGraphForScope() {
  graphRequested = false;
  graphData = null;
  if (graphViewOpen) showGraph();
}

function teardownGraphScene() {
  if (graphRebuildTimer) { clearTimeout(graphRebuildTimer); graphRebuildTimer = 0; }
  if (graphScene) {
    if (graphScene.focusRaf) { try { cancelAnimationFrame(graphScene.focusRaf); } catch (_) { /* noop */ } }
    if (graphScene.resizeObserver) { try { graphScene.resizeObserver.disconnect(); } catch (_) { /* noop */ } }
    try { graphScene.sim.stop(); } catch (_) { /* already gone */ }
    try { graphScene.app.destroy(true, { children: true, texture: true }); } catch (_) { /* already gone */ }
    graphScene = null;
  }
  readerGraphCanvas.innerHTML = '';
}

// Where the map on screen had got to: every node's place, and the camera. A redraw
// is nearly always a small change to a picture someone is reading, so the next
// scene starts from here.
function carryGraphLayout(scene) {
  const positions = new Map();
  for (const node of scene.nodes) {
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      positions.set(node.path, { x: node.x, y: node.y });
    }
  }
  return {
    positions,
    // A framing the reader took is theirs to keep across a redraw; one we chose
    // stays ours, so a graph that grew a node still gets framed.
    autoFit: scene.autoFit,
    settled: scene.settled,
    scale: scene.world.scale.x,
    x: scene.world.position.x,
    y: scene.world.position.y,
  };
}

async function buildGraphScene() {
  const carried = graphScene ? carryGraphLayout(graphScene) : null;
  teardownGraphScene();
  const data = graphData;
  if (!data || !data.nodes || !data.nodes.length) {
    clearReaderLoading('graph');
    setGraphStatus(window.leafLocale.t('library.graph.empty'));
    return;
  }
  try {
    await loadGraphLibs();
  } catch (err) {
    console.error('Leaf graph runtimes failed to load', err);
    clearReaderLoading('graph');
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
    return;
  }
  // The view may have changed while the runtimes loaded.
  if (!graphViewOpen) { clearReaderLoading('graph'); return; }

  try {
  const width = readerGraphCanvas.clientWidth || 300;
  const height = readerGraphCanvas.clientHeight || 300;
  const app = new PIXI.Application();
  await app.init({
    resizeTo: readerGraphCanvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
  });
  if (!graphViewOpen) {
    try { app.destroy(true, { children: true }); } catch (_) { /* noop */ }
    clearReaderLoading('graph');
    return;
  }
  // Pixi renders on demand (not every frame) to stay quiet once the layout settles.
  app.ticker.stop();
  readerGraphCanvas.appendChild(app.canvas);
  setGraphStatus(data.truncated
    ? window.leafLocale.t('library.graph.truncated', { count: window.leafLocale.formatNumber(data.nodes.length) })
    : '');

  const colors = graphColors();

  // Build node objects d3 will mutate with x/y, plus their Pixi graphics. A node
  // the last scene had keeps its place: d3 only seeds the ones without one, so a
  // rebuild lands on the layout that was there plus wherever the new nodes fall.
  const nodes = data.nodes.map((n) => {
    const node = { path: n.path, label: n.label || n.path, degree: n.degree || 0 };
    const seat = carried && carried.positions.get(n.path);
    if (seat) { node.x = seat.x; node.y = seat.y; }
    return node;
  });
  const nodeByPath = new Map(nodes.map((n) => [n.path, n]));
  const links = (data.edges || [])
    .filter((e) => nodeByPath.has(e.source) && nodeByPath.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const world = new PIXI.Container();
  world.position.set(width / 2, height / 2);
  app.stage.addChild(world);
  const edgesGfx = new PIXI.Graphics();
  world.addChild(edgesGfx);
  const nodesLayer = new PIXI.Container();
  world.addChild(nodesLayer);
  const labelsLayer = new PIXI.Container();
  world.addChild(labelsLayer);

  const scene = {
    app, world, edgesGfx, nodes, links, nodeByPath, colors, labelsLayer,
    hoverNode: null, draggingNode: null, panning: false, panLast: null, pressGlobal: null,
    lastWidth: width, lastHeight: height,
    // Frame everything until the reader takes the wheel. A view parked at 1:1 on
    // an arbitrary center cannot answer "how much is there": two documents sit
    // lost in an empty field, two thousand hang off every edge. Any pan, zoom,
    // drag or flight ends it for good — including one from before a redraw.
    autoFit: carried ? carried.autoFit : true,
    // Ambient labels wait for the layout to settle so they resolve on stable
    // positions instead of flickering as the simulation jiggles the nodes. A
    // carried layout is already settled, so its names do not blink out.
    settled: carried ? carried.settled : false,
    // What this scene draws, so a later delivery of the same picture can be
    // recognized and left alone.
    signature: graphSignature(data),
    // A 2D context used only to measure label widths for the collision pass.
    measureCtx: document.createElement('canvas').getContext('2d'),
  };

  // Adjacency for hover highlighting.
  const neighbors = new Map(nodes.map((n) => [n.path, new Set()]));
  for (const link of links) {
    neighbors.get(link.source).add(link.target);
    neighbors.get(link.target).add(link.source);
  }
  scene.neighbors = neighbors;

  for (const node of nodes) {
    const gfx = new PIXI.Graphics();
    // Drawn white so a tint shows the true state color; radius set once.
    gfx.circle(0, 0, graphNodeRadius(node.degree)).fill(0xffffff);
    gfx.eventMode = 'static';
    gfx.cursor = 'pointer';
    gfx.hitArea = new PIXI.Circle(0, 0, graphNodeRadius(node.degree) + 3);
    gfx.on('pointerover', () => {
      scene.hoverNode = node;
      // The same native tooltip the library rows, hits, and tabs use: the full
      // document path on the canvas element under the cursor.
      scene.app.canvas.title = node.path;
      applyGraphStyles();
    });
    gfx.on('pointerout', () => {
      if (scene.hoverNode === node) {
        scene.hoverNode = null;
        scene.app.canvas.title = '';
        applyGraphStyles();
      }
    });
    gfx.on('pointerdown', (event) => startNodeDrag(scene, node, event));
    node.gfx = gfx;
    node.labelText = null;
    nodesLayer.addChild(gfx);
  }

  // Scale the layout to the node count. Edge drawing dominates, so large graphs
  // paint every Nth tick, settle faster, approximate charge more coarsely, and
  // drop the collide force once it's unaffordable.
  const nodeCount = nodes.length;
  const heavy = nodeCount > 1500;
  const veryHeavy = nodeCount > 4000;
  const sim = window.d3.forceSimulation(nodes)
    .velocityDecay(heavy ? 0.5 : 0.4)
    .alphaDecay(veryHeavy ? 0.06 : heavy ? 0.045 : 0.0228)
    .force('charge', window.d3.forceManyBody()
      .strength(-90)
      .distanceMax(heavy ? 300 : 400)
      .theta(heavy ? 1.2 : 0.9))
    .force('link', window.d3.forceLink(links).id((d) => d.path).distance(46).strength(0.6))
    .force('center', window.d3.forceCenter(0, 0));
  if (!veryHeavy) {
    sim.force('collide', window.d3.forceCollide().radius((d) => graphNodeRadius(d.degree) + 3));
  }
  // Inherited a layout: run the simulation warm, so it absorbs the change rather
  // than laying the whole vault out again under a reader's eyes.
  if (carried && carried.positions.size) sim.alpha(GRAPH_WARM_ALPHA);
  const renderEvery = veryHeavy ? 6 : heavy ? 3 : 1;
  let tickCount = 0;
  sim.on('tick', () => {
    tickCount += 1;
    if (tickCount % renderEvery === 0) {
      // Follow as it settles, so a layout expanding past the edges is not watched
      // from behind a fixed camera — but hold still while it stays in frame.
      if (scene.autoFit) fitGraphToView(scene, true);
      renderGraphFrame(scene);
    }
  });
  sim.on('end', () => {
    // The layout has stopped moving: let ambient labels resolve on the final
    // positions, then paint.
    scene.settled = true;
    if (scene.autoFit) fitGraphToView(scene);
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  });
  scene.sim = sim;

  wireGraphPointer(scene);
  wireGraphResize(scene);
  graphScene = scene;
  clearReaderLoading('graph');
  applyGraphStyles();
  // d3 seeds positions before the first tick, so there is already something to
  // frame: the map opens fitted rather than snapping into place a frame later.
  // A camera the reader set survives the redraw instead of being overruled by it.
  if (scene.autoFit) {
    fitGraphToView(scene);
  } else if (carried) {
    scene.world.scale.set(carried.scale);
    scene.world.position.set(carried.x, carried.y);
  }
  layoutGraphLabels(scene);
  renderGraphFrame(scene);
  // A rebuild triggered by a deliberate navigation (tab click/switch) flies to
  // the active node now that its graphics exist; d3 seeds positions before the
  // first tick, so focusGraphNode tracks it as the layout settles.
  if (graphFocusPending && graphActivePath) {
    graphFocusPending = false;
    const activeNode = scene.nodeByPath.get(graphActivePath);
    if (activeNode) focusGraphNode(scene, activeNode);
  }
  } catch (err) {
    // Surface the real failure (e.g. WebGL unavailable in this WebView) on the
    // status line instead of hanging on "Building graph…", and log a breadcrumb.
    console.error('Leaf graph build failed', err);
    clearReaderLoading('graph');
    teardownGraphScene();
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
  }
}

