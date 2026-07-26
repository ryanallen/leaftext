// ---------------------------------------------------------------------------
// Graph view: an Obsidian-style force-directed map of how documents link to one
// another, rendered with PixiJS (WebGL) and laid out with d3-force. Nodes are
// documents; edges are resolved doc-to-doc links. The active document is the
// highlighted centre; clicking a node opens it; hovering lights up its links.
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

function setGraphStatus(message) {
  if (!message) {
    libraryGraphStatus.hidden = true;
    libraryGraphStatus.textContent = '';
    return;
  }
  libraryGraphStatus.hidden = false;
  libraryGraphStatus.textContent = message;
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
    // (a dim grey), so they read as secondary next to the active/hover labels.
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
  setGraphStatus(window.leafLocale.t('library.graph.loading'));
  send({ command: 'getGraph', scope: graphScope, seeds });
}

// Entry point when the graph view becomes visible. Requests fresh data the first
// time, then either builds the scene (data already in hand) or just moves the
// active-node highlight (scene already built).
function showGraph() {
  graphActivePath = activeDocumentPath();
  if (!graphRequested) {
    requestGraphData();
  }
  if (graphScene) {
    applyGraphStyles();
  } else if (graphData) {
    buildGraphScene();
  }
}

window.leafSetGraph = (payload) => {
  if (payload && payload.error) {
    graphData = null;
    if (libraryView === 'graph') {
      teardownGraphScene();
      setGraphStatus((payload.error && payload.error.message) || window.leafLocale.t('library.graph.error'));
    }
    return;
  }
  graphData = payload || { nodes: [], edges: [], truncated: false };
  if (libraryView === 'graph') buildGraphScene();
};

function teardownGraph() {
  graphRequested = false;
  teardownGraphScene();
}

function teardownGraphScene() {
  if (graphScene) {
    if (graphScene.focusRaf) { try { cancelAnimationFrame(graphScene.focusRaf); } catch (_) { /* noop */ } }
    if (graphScene.resizeObserver) { try { graphScene.resizeObserver.disconnect(); } catch (_) { /* noop */ } }
    try { graphScene.sim.stop(); } catch (_) { /* already gone */ }
    try { graphScene.app.destroy(true, { children: true, texture: true }); } catch (_) { /* already gone */ }
    graphScene = null;
  }
  libraryGraphCanvas.innerHTML = '';
}

async function buildGraphScene() {
  teardownGraphScene();
  const data = graphData;
  if (!data || !data.nodes || !data.nodes.length) {
    setGraphStatus(window.leafLocale.t('library.graph.empty'));
    return;
  }
  try {
    await loadGraphLibs();
  } catch (err) {
    console.error('Leaf graph runtimes failed to load', err);
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
    return;
  }
  // The view may have changed while the runtimes loaded.
  if (libraryView !== 'graph') return;

  try {
  const width = libraryGraphCanvas.clientWidth || 300;
  const height = libraryGraphCanvas.clientHeight || 300;
  const app = new PIXI.Application();
  await app.init({
    resizeTo: libraryGraphCanvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
  });
  if (libraryView !== 'graph') {
    try { app.destroy(true, { children: true }); } catch (_) { /* noop */ }
    return;
  }
  // Pixi renders on demand (not every frame) to stay quiet once the layout settles.
  app.ticker.stop();
  libraryGraphCanvas.appendChild(app.canvas);
  setGraphStatus(data.truncated
    ? window.leafLocale.t('library.graph.truncated', { count: window.leafLocale.formatNumber(data.nodes.length) })
    : '');

  const colors = graphColors();

  // Build node objects d3 will mutate with x/y, plus their Pixi graphics.
  const nodes = data.nodes.map((n) => ({ path: n.path, label: n.label || n.path, degree: n.degree || 0 }));
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
    // Ambient labels wait for the layout to settle so they resolve on stable
    // positions instead of flickering as the simulation jiggles the nodes.
    settled: false,
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
    // Drawn white so a tint shows the true state colour; radius set once.
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
  const renderEvery = veryHeavy ? 6 : heavy ? 3 : 1;
  let tickCount = 0;
  sim.on('tick', () => {
    tickCount += 1;
    if (tickCount % renderEvery === 0) renderGraphFrame(scene);
  });
  sim.on('end', () => {
    // The layout has stopped moving: let ambient labels resolve on the final
    // positions, then paint.
    scene.settled = true;
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  });
  scene.sim = sim;

  wireGraphPointer(scene);
  wireGraphResize(scene);
  graphScene = scene;
  applyGraphStyles();
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
    teardownGraphScene();
    setGraphStatus((err && err.message) ? String(err.message) : window.leafLocale.t('library.graph.error'));
  }
}

