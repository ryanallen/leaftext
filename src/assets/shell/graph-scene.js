// Position node graphics + redraw edges for the current simulation state, then
// draw one Pixi frame. Called on every d3 tick and after each interaction.
function renderGraphFrame(scene) {
  const { edgesGfx, colors, hoverNode } = scene;
  edgesGfx.clear();
  for (const link of scene.links) {
    const s = link.source;
    const t = link.target;
    if (typeof s.x !== 'number' || typeof t.x !== 'number') continue;
    const hot = hoverNode && (s === hoverNode || t === hoverNode);
    edgesGfx.moveTo(s.x, s.y).lineTo(t.x, t.y);
    edgesGfx.stroke({
      width: hot ? 1.6 : 1,
      color: hot ? colors.active : colors.edge,
      alpha: hoverNode ? (hot ? 0.9 : 0.12) : 0.4,
    });
  }
  for (const node of scene.nodes) {
    if (typeof node.x === 'number') node.gfx.position.set(node.x, node.y);
  }
  // Labels keep a fixed on-screen size and stay anchored under their node; this
  // only moves the labels already chosen visible, it does not re-decide the set.
  positionGraphLabels(scene);
  scene.app.render();
}

// Recolor and resize the node dots for the current active/hover state, then let
// the label pass decide which names to show. Cheap and only called on state
// changes, not per frame.
function applyGraphStyles() {
  const scene = graphScene;
  if (!scene) return;
  const { colors, hoverNode } = scene;
  const hoverSet = hoverNode ? scene.neighbors.get(hoverNode.path) : null;
  for (const node of scene.nodes) {
    // A web address rests dimmer than a document, so the documents are what the eye
    // lands on: the map is of your notes, and the addresses are where they point.
    let color = node.external ? colors.external : colors.node;
    let alpha = 1;
    let scale = 1;
    const isActive = graphActivePath && node.path === graphActivePath;
    if (isActive) { color = colors.active; scale = 1.7; }
    if (hoverNode) {
      if (node === hoverNode) { color = colors.hot; scale = 1.6; }
      else if (hoverSet && hoverSet.has(node.path)) { color = colors.hot; }
      else if (!isActive) { alpha = 0.22; }
    }
    node.gfx.tint = color;
    node.gfx.alpha = alpha;
    node.gfx.scale.set(scale);
  }
  layoutGraphLabels(scene);
  renderGraphFrame(scene);
}

// Re-read the theme tokens into the live scene and repaint, so the open graph
// recolors when the theme changes (the palette is captured at build time).
function refreshGraphColors() {
  if (!graphScene) return;
  graphScene.colors = graphColors();
  applyGraphStyles();
}

// Choose which labels are visible and place them. Active/hovered nodes (and a
// hover's neighbors) are forced; when settled with no hover, every other node
// is an ambient candidate walked most-connected-first, each winning a label only
// if its screen box clears the ones already placed. So the visible set scales
// with available room, and zooming in surfaces more names.
function layoutGraphLabels(scene) {
  const { world, colors } = scene;
  const ws = world.scale.x || 1;
  const ox = world.position.x;
  const oy = world.position.y;
  const screenW = scene.app.screen.width;
  const screenH = scene.app.screen.height;
  const hoverNode = scene.hoverNode;
  const hoverSet = hoverNode ? scene.neighbors.get(hoverNode.path) : null;
  const activeNode = graphActivePath ? scene.nodeByPath.get(graphActivePath) : null;

  // Build the priority-ordered candidate list. `forced` labels always show;
  // ambient ones must clear the collision test. Nodes without a position yet
  // (before the first tick) are skipped.
  const candidates = [];
  const seen = new Set();
  const push = (node, color, forced) => {
    if (!node || seen.has(node) || typeof node.x !== 'number') return;
    seen.add(node);
    candidates.push({ node, color, forced });
  };
  push(activeNode, colors.active, true);
  if (hoverNode) {
    push(hoverNode, colors.hot, true);
    let n = 0;
    for (const node of scene.nodes) {
      if (n >= GRAPH_NEIGHBOR_LABEL_CAP) break;
      if (hoverSet && hoverSet.has(node.path) && !seen.has(node)) { push(node, colors.hot, true); n++; }
    }
  } else if (scene.settled && scene.nodes.length <= GRAPH_AMBIENT_LABEL_MAX) {
    const rest = scene.nodes.filter((node) => !seen.has(node) && typeof node.x === 'number');
    // Hubs first, so the most-connected documents keep their names when space is tight.
    rest.sort((a, b) => (b.degree - a.degree) || (a.path < b.path ? -1 : 1));
    for (const node of rest) push(node, colors.dim, false);
  }

  const placed = [];
  const PADX = 5;
  const PADY = 2;
  const visible = new Set();
  for (const cand of candidates) {
    const node = cand.node;
    const sx = ox + node.x * ws;
    const sy = oy + node.y * ws;
    const w = labelScreenWidth(scene, node) + PADX * 2;
    const h = GRAPH_LABEL_FONT_SIZE + PADY * 2 + 2;
    const top = sy + graphNodeRadius(node.degree) * node.gfx.scale.y * ws + GRAPH_LABEL_GAP;
    const left = sx - w / 2;
    // Off-canvas labels are neither drawn nor allowed to block on-screen ones.
    if (left > screenW || left + w < 0 || top > screenH || top + h < 0) continue;
    const rect = { l: left, t: top, r: left + w, b: top + h };
    if (!cand.forced) {
      let hit = false;
      for (const p of placed) {
        if (rect.l < p.r && rect.r > p.l && rect.t < p.b && rect.b > p.t) { hit = true; break; }
      }
      if (hit) continue;
    }
    placed.push(rect);
    visible.add(node);
    setNodeLabel(scene, node, true, cand.color);
  }
  // Hide any label that did not win a slot this pass.
  for (const node of scene.nodes) {
    if (!visible.has(node) && node.labelText) node.labelText.visible = false;
  }
  positionGraphLabels(scene);
}

// Measure a label's on-screen width once (labels are a fixed screen size, so the
// unscaled text width is the screen width) and cache it on the node.
function labelScreenWidth(scene, node) {
  if (node.labelWidth == null) {
    scene.measureCtx.font = GRAPH_LABEL_FONT_SIZE + 'px "Noto Sans", sans-serif';
    node.labelWidth = scene.measureCtx.measureText(node.label).width;
  }
  return node.labelWidth;
}

// Keep every visible label a constant on-screen size (counter-scaling the world
// zoom) and anchored a fixed gap under its node. Positions live in world space;
// the inverse scale cancels the world zoom so the text neither grows nor blurs.
function positionGraphLabels(scene) {
  const inv = 1 / (scene.world.scale.x || 1);
  for (const node of scene.nodes) {
    const label = node.labelText;
    if (!label || !label.visible || typeof node.x !== 'number') continue;
    label.scale.set(inv);
    label.position.set(node.x, node.y + graphNodeRadius(node.degree) * node.gfx.scale.y + GRAPH_LABEL_GAP * inv);
  }
}

function setNodeLabel(scene, node, show, color) {
  if (show && !node.labelText) {
    const text = new PIXI.Text({
      text: node.label,
      // White base so the tint reproduces the target color exactly, the same way
      // the node dots are drawn white and tinted.
      style: { fontFamily: 'Noto Sans, sans-serif', fontSize: GRAPH_LABEL_FONT_SIZE, fill: 0xffffff, align: 'center' },
    });
    text.anchor.set(0.5, 0);
    // Labels hold a fixed on-screen size (positionGraphLabels counter-scales the
    // world zoom), so the bitmap never magnifies past its rasterized size — the
    // display density alone keeps it crisp at every zoom.
    text.resolution = window.devicePixelRatio || 1;
    node.labelText = text;
    scene.labelsLayer.addChild(text);
  }
  if (node.labelText) {
    node.labelText.visible = show;
    node.labelText.tint = color;
  }
}

// Pixi "global" coordinates are logical (CSS) pixels measured from the canvas
// origin, the same space the world container's position/scale live in — so a
// global point maps to world space directly, no getBoundingClientRect needed.
function graphGlobalToWorld(scene, gx, gy) {
  return {
    x: (gx - scene.world.position.x) / scene.world.scale.x,
    y: (gy - scene.world.position.y) / scene.world.scale.y,
  };
}

function startNodeDrag(scene, node, event) {
  scene.draggingNode = node;
  scene.pressGlobal = { x: event.global.x, y: event.global.y };
  const p = graphGlobalToWorld(scene, event.global.x, event.global.y);
  node.fx = p.x;
  node.fy = p.y;
  // Moving a node is taking the view: stop reframing under the reader's hand.
  scene.autoFit = false;
  scene.sim.alphaTarget(0.3).restart();
}

// All pointer interaction runs through Pixi's own event graph so background vs.
// node presses are disambiguated by event.target (deterministic), not listener
// order. Wheel is the one exception — a DOM event on the canvas.
function wireGraphPointer(scene) {
  const stage = scene.app.stage;
  stage.eventMode = 'static';
  stage.hitArea = scene.app.screen; // a Rectangle Pixi keeps sized to the canvas
  stage.on('pointerdown', (event) => {
    if (event.target !== stage) return; // a node handled it
    scene.autoFit = false;
    scene.panning = true;
    scene.panLast = { x: event.global.x, y: event.global.y };
  });
  stage.on('globalpointermove', (event) => {
    if (scene.draggingNode) {
      const p = graphGlobalToWorld(scene, event.global.x, event.global.y);
      scene.draggingNode.fx = p.x;
      scene.draggingNode.fy = p.y;
      renderGraphFrame(scene);
    } else if (scene.panning && scene.panLast) {
      scene.world.position.x += event.global.x - scene.panLast.x;
      scene.world.position.y += event.global.y - scene.panLast.y;
      scene.panLast = { x: event.global.x, y: event.global.y };
      renderGraphFrame(scene);
    }
  });
  const endPress = (event) => {
    if (scene.draggingNode) {
      const node = scene.draggingNode;
      scene.draggingNode = null;
      node.fx = null;
      node.fy = null;
      scene.sim.alphaTarget(0);
      // A press that barely moved is a click: go to whatever that node is.
      const moved = scene.pressGlobal
        && Math.hypot(event.global.x - scene.pressGlobal.x, event.global.y - scene.pressGlobal.y) > 4;
      if (!moved && node.external) {
        // A web address opens in the browser, and the map stays exactly as it is.
        // Nothing here replaced the page, so leaving the view would be throwing
        // away the picture the reader is working through to show them the document
        // they were already on.
        send({ command: 'openExternal', url: node.path });
      } else if (!moved) {
        // Clicking a document is a navigation out of the map: you picked something
        // to read. The map holds until that document is ready and then steps aside,
        // rather than closing now and flashing the file you were already on.
        graphExitPending = true;
        send({ command: 'openRecent', path: node.path });
      }
    }
    if (scene.panning) {
      // A pan slid nodes across the viewport edges; re-decide which labels are
      // on screen (overlaps are translation-invariant, but culling is not).
      scene.panning = false;
      scene.panLast = null;
      layoutGraphLabels(scene);
      renderGraphFrame(scene);
      return;
    }
    scene.panning = false;
    scene.panLast = null;
  };
  stage.on('pointerup', endPress);
  stage.on('pointerupoutside', endPress);
  scene.app.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    scene.autoFit = false;
    graphZoomAt(scene, event.offsetX, event.offsetY, factor);
    // Zoom changes how far apart the nodes sit on screen, so re-decide which
    // ambient labels fit before repainting.
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  }, { passive: false });
}

// Pixi's `resizeTo` only reacts to window resizes, so a pane-splitter drag
// (element resize) wouldn't resize or repaint. Observe the canvas ourselves:
// resize, shift the view by half the delta to keep content centered, repaint.
function wireGraphResize(scene) {
  const ro = new ResizeObserver(() => {
    const w = readerGraphCanvas.clientWidth;
    const h = readerGraphCanvas.clientHeight;
    if (!w || !h || (w === scene.lastWidth && h === scene.lastHeight)) return;
    const dx = (w - scene.lastWidth) / 2;
    const dy = (h - scene.lastHeight) / 2;
    scene.lastWidth = w;
    scene.lastHeight = h;
    try { scene.app.renderer.resize(w, h); } catch (_) { /* renderer gone */ }
    if (scene.autoFit) {
      // Still ours to frame, so a wider pane shows more of the map rather than
      // the same crop with margins.
      fitGraphToView(scene);
    } else {
      scene.world.position.x += dx;
      scene.world.position.y += dy;
    }
    layoutGraphLabels(scene);
    renderGraphFrame(scene);
  });
  ro.observe(readerGraphCanvas);
  scene.resizeObserver = ro;
}

// Whether the layout's box is entirely inside the padded view at the camera's
// current setting — i.e. whether there is anything to follow.
function graphBoundsInView(scene, minX, minY, maxX, maxY) {
  const ws = scene.world.scale.x || 1;
  const ox = scene.world.position.x;
  const oy = scene.world.position.y;
  const pad = GRAPH_FIT_PADDING;
  return ox + minX * ws >= pad
    && oy + minY * ws >= pad
    && ox + maxX * ws <= scene.app.screen.width - pad
    && oy + maxY * ws <= scene.app.screen.height - pad;
}

// Frame every node: the tightest zoom that still holds the whole layout, with
// the bounding box centered. Two documents fill the view; two thousand shrink to
// fit. Clamped to the same limits the wheel obeys, so a pair of nodes 40px apart
// stops at 4x rather than filling the screen with two dots.
//
// `follow` is the settling case: it moves only when the layout has left the frame.
// A force layout breathes, and refitting on every tick of that put the pumping on
// screen. Following what escapes and leaving the rest to the fit at `end` keeps
// the same guarantee — nothing off screen — without the ride.
function fitGraphToView(scene, follow) {
  if (!scene || !scene.nodes || !scene.nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of scene.nodes) {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
    const r = graphNodeRadius(node.degree);
    if (node.x - r < minX) minX = node.x - r;
    if (node.x + r > maxX) maxX = node.x + r;
    if (node.y - r < minY) minY = node.y - r;
    if (node.y + r > maxY) maxY = node.y + r;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  if (follow && graphBoundsInView(scene, minX, minY, maxX, maxY)) return;
  const width = scene.app.screen.width;
  const height = scene.app.screen.height;
  // A single node has no extent to divide by; the padding is the whole budget.
  const availableX = Math.max(1, width - GRAPH_FIT_PADDING * 2);
  const availableY = Math.max(1, height - GRAPH_FIT_PADDING * 2);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.max(
    GRAPH_MIN_ZOOM,
    Math.min(GRAPH_MAX_ZOOM, Math.min(availableX / spanX, availableY / spanY)),
  );
  scene.world.scale.set(scale);
  scene.world.position.x = width / 2 - ((minX + maxX) / 2) * scale;
  scene.world.position.y = height / 2 - ((minY + maxY) / 2) * scale;
}

function graphZoomAt(scene, sx, sy, factor) {
  const current = scene.world.scale.x;
  const next = Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, current * factor));
  const ratio = next / current;
  scene.world.position.x = sx - (sx - scene.world.position.x) * ratio;
  scene.world.position.y = sy - (sy - scene.world.position.y) * ratio;
  scene.world.scale.set(next);
}

// Smoothly pan+zoom so `node` ends centered and zoomed in. The target recomputes
// each frame from the node's live position, so it lands centered even mid-settle.
// Cancels any in-flight focus animation so rapid tab clicks don't fight.
function focusGraphNode(scene, node) {
  if (!scene || !node || typeof node.x !== 'number') return;
  // A flight to one node is a chosen framing; stop refitting behind it.
  scene.autoFit = false;
  if (scene.focusRaf) { cancelAnimationFrame(scene.focusRaf); scene.focusRaf = null; }
  const width = scene.app.screen.width;
  const height = scene.app.screen.height;
  const startScale = scene.world.scale.x;
  const startX = scene.world.position.x;
  const startY = scene.world.position.y;
  const targetScale = Math.min(GRAPH_MAX_ZOOM, Math.max(startScale, GRAPH_FOCUS_ZOOM));
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / GRAPH_FOCUS_DURATION_MS);
    // easeInOutCubic
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const scale = startScale + (targetScale - startScale) * e;
    // Where the world must sit for the node (at its current position) to be
    // centered on the canvas at this scale; blend from the start position so the
    // motion eases rather than snapping.
    const wantX = width / 2 - node.x * scale;
    const wantY = height / 2 - node.y * scale;
    scene.world.scale.set(scale);
    scene.world.position.x = startX + (wantX - startX) * e;
    scene.world.position.y = startY + (wantY - startY) * e;
    renderGraphFrame(scene);
    if (t < 1) {
      scene.focusRaf = requestAnimationFrame(step);
    } else {
      scene.focusRaf = null;
      // Settled at the focus zoom: re-decide labels for the final view.
      layoutGraphLabels(scene);
      renderGraphFrame(scene);
    }
  };
  scene.focusRaf = requestAnimationFrame(step);
}

// Move the highlight to a newly active document. Refetches+rebuilds when the new
// document means a different picture rather than a different highlight in the same
// one; otherwise keeps the scene and recolors, flying the camera when `focus`.
// `forceRefresh` (resync gesture) always rebuilds so a stale graph catches up.
function graphSetActive(path, focus, forceRefresh) {
  graphActivePath = path || null;
  if (!graphViewOpen) return;
  // Focus scope's slice is the active document's neighborhood, so changed seeds
  // (a different document) mean the scene in memory is for the wrong file.
  //
  // With no vault that holds at every size, not just Focus: the map is then of the
  // open document — its folder and what it links to — so another document is
  // another map, and one drawn for the file you have left may not even contain the
  // file you are on. A vault's map is the same picture whichever of its documents
  // you are reading, which is why the vault case still only refetches for Focus.
  const seedChanged =
    (graphScope === 'small' || !activeVaultId) &&
    graphScope + '|' + graphSeeds().join('\n') !== graphSeedKey;
  // No scene, or the document's node isn't in it (a new/re-indexed file), or an
  // explicit resync: fetch a fresh slice and fly to the node once it builds.
  const staleForActive =
    focus && !!graphActivePath && (!graphScene || !graphScene.nodeByPath.has(graphActivePath));
  if (forceRefresh || seedChanged || staleForActive) {
    graphFocusPending = focus && !!graphActivePath;
    requestGraphData();
    return;
  }
  if (!graphScene) return;
  applyGraphStyles();
  if (focus && graphActivePath) {
    const node = graphScene.nodeByPath.get(graphActivePath);
    if (node) focusGraphNode(graphScene, node);
  }
}
