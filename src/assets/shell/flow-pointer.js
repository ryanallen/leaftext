// Every press, drag and release on the flowchart canvas: selecting a box, moving one, drawing a line between two, and the double-click that opens a name for typing. The canvas element, the graph and the redraw all live in flow-canvas.js, which is why this loads after it.

// ---- pointer work on the canvas -------------------------------------------

const FLOW_SVG_NS = 'http://www.w3.org/2000/svg';

function flowNodeAt(x, y) {
  const found = flowTargetAt(x, y);
  return found && found.kind === 'node' ? found.id : null;
}

// What is under the pointer, in the three flavors every drop cares about: a box, a line, or the surface itself. Null means the pointer has left the canvas.
function flowTargetAt(x, y) {
  if (!flowCanvas) return null;
  const found = document.elementFromPoint(x, y);
  if (!found || !found.closest || !flowCanvas.contains(found)) return null;
  const ring = found.closest('.flow-ring');
  if (ring) return { kind: 'node', id: ring.dataset.node };
  const bud = found.closest('.flow-bud');
  if (bud) return { kind: 'node', id: bud.dataset.node };
  const edge = flowEdgeUnder(found);
  if (edge) return { kind: 'edge', id: edge };
  // Inside a group's box, but on nothing in it. Only asked after the boxes and the lines, so a group never takes a drop meant for what it holds — and the innermost wins, because a nested group is inside its parent's box too.
  const inside = flowGroupAt(x, y);
  if (inside) return { kind: 'group', id: inside };
  return { kind: 'canvas', id: null };
}

// The smallest drawn group the point falls in. Measured off the cluster mermaid drew, so it is the box the reader can see.
function flowGroupAt(x, y) {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  if (!stage || !flowPlaced || !flowPlaced.groups) return null;
  const origin = stage.getBoundingClientRect();
  const at = { x: x - origin.left, y: y - origin.top };
  let best = null;
  let smallest = Infinity;
  for (const box of flowPlaced.groups) {
    if (at.x < box.x || at.x > box.x + box.width || at.y < box.y || at.y > box.y + box.height) continue;
    const area = box.width * box.height;
    if (area < smallest) {
      smallest = area;
      best = box.id;
    }
  }
  return best;
}

// True only for the bare surface: the scroll box, the stage, the overlay, or mermaid's SVG root. Anything deeper is part of the drawing, and treating it as empty space is how a double-click on a box adds another one.
function flowPointIsBare(target) {
  if (!target || !target.closest) return false;
  if (target === flowCanvas) return true;
  if (target.classList && (target.classList.contains('flow-stage') || target.classList.contains('flow-overlay'))) {
    return true;
  }
  return target.tagName === 'svg' || target.tagName === 'SVG';
}

// A pointer position in stage pixels — the same space the measurements are in, so the rubber band and the drop tests need no conversion.
function flowPointAt(x, y) {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  if (!stage) return { x: 0, y: 0 };
  const rect = stage.getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

function flowPointIn(event) {
  return flowPointAt(event.clientX, event.clientY);
}

// Which of our lines a mermaid element belongs to. Mermaid names its paths from the two ends, so the answer comes from the measurement rather than a search.
function flowEdgeUnder(element) {
  if (!flowPlaced || !element) return null;
  const path = element.closest ? element.closest('path[data-id], g[data-id]') : null;
  if (!path) return null;
  const found = flowPlaced.edges.find((edge) => edge.path === path || edge.path.dataset.id === path.dataset.id);
  return found ? found.id : null;
}

// A box's handles, which is what a drag carries and what a drop lights up.
function flowGroupFor(id) {
  return flowCanvas ? flowCanvas.querySelector('.flow-node-tools[data-node="' + id + '"]') : null;
}

// The cluster mermaid drew for one of our groups. Named the two ways it names a box, so it is looked up the same way rather than by a selector that only works on one of the renderers.
function flowClusterFor(id) {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  if (!stage) return null;
  const wanted = new Set([id]);
  let found = null;
  stage.querySelectorAll('svg g.cluster').forEach((drawn) => {
    if (found) return;
    if (flowNodeIdFromDom(drawn.id, wanted) || flowNodeIdFromDom(drawn.dataset.id, wanted)) found = drawn;
  });
  return found;
}

// The line that follows the pointer while a connection is being made or moved.
function drawFlowRubber(from, to) {
  const layer = flowCanvas && flowCanvas.querySelector('.flow-overlay');
  if (!layer) return;
  let band = layer.querySelector('.flow-rubber-band');
  if (!band) {
    band = document.createElementNS(FLOW_SVG_NS, 'svg');
    band.setAttribute('class', 'flow-rubber-band');
    band.appendChild(document.createElementNS(FLOW_SVG_NS, 'line'));
    layer.appendChild(band);
  }
  const line = band.firstChild;
  line.setAttribute('class', 'flow-rubber');
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y);
}

function clearFlowRubber() {
  const band = flowCanvas && flowCanvas.querySelector('.flow-rubber-band');
  if (band) band.remove();
}

// What the pointer is over, lit up so a drop is never a guess. Takes what flowTargetAt hands back, or an id, or nothing.
function markFlowDropTarget(target) {
  if (!flowCanvas) return;
  flowCanvas.querySelectorAll('.is-drop').forEach((found) => found.classList.remove('is-drop'));
  if (!target) return;
  const spot = typeof target === 'string' ? { kind: 'node', id: target } : target;
  if (spot.kind === 'node') {
    const group = flowGroupFor(spot.id);
    if (group) group.classList.add('is-drop');
    return;
  }
  if (spot.kind === 'group') {
    const drawn = flowClusterFor(spot.id);
    if (drawn) drawn.classList.add('is-drop');
    return;
  }
  if (spot.kind !== 'edge') return;
  const placed = flowPlaced && flowPlaced.edges.find((edge) => edge.id === spot.id);
  if (placed) placed.path.classList.add('is-drop');
}

// Where a line being re-aimed still holds on: the end that is not moving.
function flowFixedEnd(edgeId, moving) {
  const placed = flowPlaced && flowPlaced.edges.find((edge) => edge.id === edgeId);
  if (!placed) return { x: 0, y: 0 };
  return moving === 'from' ? placed.to : placed.from;
}

// The pointer carries the view when there is nothing under it to take hold of — which is the whole of a diagram the canvas cannot model.
function beginFlowPan(event) {
  flowDrag = {
    kind: 'pan',
    startX: event.clientX,
    startY: event.clientY,
    panX: flowPan.x,
    panY: flowPan.y,
    moved: false,
  };
  leafHoldPointer(flowCanvas, event.pointerId);
}

if (flowCanvas) {
  flowCanvas.addEventListener('pointerdown', (event) => {
    if (!flowSession || event.button !== 0) return;
    const graph = flowSession.graph;
    if (!graph) {
      beginFlowPan(event);
      return;
    }
    const target = event.target;
    const near = (selector) => (target && target.closest ? target.closest(selector) : null);
    const endpoint = near('.flow-edge-end');
    const bud = near('.flow-bud');
    const node = near('.flow-ring');
    const edge = flowEdgeUnder(target);
    // Nothing here calls preventDefault: on a pointerdown it suppresses the compatibility mouse events, dblclick included, so double-clicking a shape to rename it does nothing. Text selection is held off in the stylesheet.
    const grab = () => leafHoldPointer(flowCanvas, event.pointerId);
    closeFlowLabelBox(true);
    if (endpoint) {
      flowDrag = { kind: 'retarget', edge: endpoint.dataset.edge, end: endpoint.dataset.endpoint, moved: false };
      grab();
      return;
    }
    if (bud) {
      selectFlow('node', bud.dataset.node);
      flowDrag = { kind: 'bud', from: bud.dataset.node, side: bud.dataset.bud, moved: false };
      grab();
      return;
    }
    if (node) {
      selectFlow('node', node.dataset.node);
      flowDrag = {
        kind: 'reorder',
        from: node.dataset.node,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      grab();
      return;
    }
    if (edge) {
      selectFlow('edge', edge);
      return;
    }
    // Empty space: nothing is selected any more, and the pointer now carries the view — which is how you get around a diagram bigger than the pane.
    selectFlow(null, null);
    beginFlowPan(event);
  });

  flowCanvas.addEventListener('pointermove', (event) => {
    if (!flowDrag) return;
    if (flowDrag.kind === 'pan') {
      flowDrag.moved = true;
      setFlowPan(
        flowDrag.panX + (event.clientX - flowDrag.startX),
        flowDrag.panY + (event.clientY - flowDrag.startY),
      );
      flowCanvas.classList.add('is-panning');
      return;
    }
    if (flowDrag.kind === 'reorder') {
      const far = Math.abs(event.clientX - flowDrag.startX) + Math.abs(event.clientY - flowDrag.startY);
      if (!flowDrag.moved && far <= 4) return;
      flowDrag.moved = true;
      flowCanvas.classList.add('is-dragging');
      setFlowHint(FLOW_TIP_MOVING);
      // The box comes with the pointer. Nothing is stored, so where you let go only says where it sits among its neighbors and it settles back into the layout — but a box that would not move at all reads as a broken one.
      const group = flowGroupFor(flowDrag.from);
      if (group) {
        group.classList.add('is-dragging');
        const dx = event.clientX - flowDrag.startX;
        const dy = event.clientY - flowDrag.startY;
        group.style.transform = 'translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px)';
      }
      markFlowDropTarget(flowTargetAt(event.clientX, event.clientY));
      return;
    }
    flowDrag.moved = true;
    flowCanvas.classList.add('is-connecting');
    if (flowDrag.kind === 'bud') setFlowHint(FLOW_TIP_BUD);
    const anchor =
      flowDrag.kind === 'retarget'
        ? flowFixedEnd(flowDrag.edge, flowDrag.end)
        : flowBudAnchor(flowDrag.from, flowDrag.side);
    drawFlowRubber(anchor, flowPointIn(event));
    markFlowDropTarget(flowNodeAt(event.clientX, event.clientY));
  });

  flowCanvas.addEventListener('pointerup', (event) => {
    const drag = flowDrag;
    flowDrag = null;
    flowCanvas.classList.remove('is-dragging');
    flowCanvas.classList.remove('is-connecting');
    flowCanvas.classList.remove('is-panning');
    clearFlowRubber();
    markFlowDropTarget(null);
    const graph = flowSession && flowSession.graph;
    restoreFlowHint();
    if (!drag || !graph || drag.kind === 'pan') return;
    const spot = flowTargetAt(event.clientX, event.clientY);
    const over = spot && spot.kind === 'node' ? spot.id : null;

    // A + handle pressed and released without travelling is a click: pick the shape, and it arrives joined up on the side the handle sits.
    if (drag.kind === 'bud' && !drag.moved) {
      openFlowAddPicker((shape, named) =>
        addFlowNode(shape, { ...flowBudRelation(graph, drag.from, drag.side), text: named }),
      );
      return;
    }
    if (!drag.moved) return;
    if (drag.kind === 'retarget') {
      const edge = flowFindEdge(graph, drag.edge);
      if (!edge || !over) {
        drawFlowOverlay();
        return;
      }
      if (drag.end === 'from') edge.from = over;
      else edge.to = over;
      flowGraphChanged();
      return;
    }
    if (drag.kind === 'bud') {
      // Let go on a box to join the two; let go on the surface for a new one, near where the pointer stopped.
      if (over && over !== drag.from) {
        const edge =
          flowBudIntent(graph.direction, drag.side).step === 'previous'
            ? flowConnect(graph, over, drag.from)
            : flowConnect(graph, drag.from, over);
        if (edge) flowSelection = { kind: 'edge', id: edge.id };
        flowGraphChanged();
        return;
      }
      if (!spot) {
        drawFlowOverlay();
        return;
      }
      const where = flowSlotAt(flowPointIn(event));
      openFlowAddPicker((shape, named) =>
        addFlowNode(shape, { ...flowBudRelation(graph, drag.from, drag.side), before: where, text: named }),
      );
      return;
    }
    // A box dropped on a line goes into that line: `A --> B` becomes `A --> this --> B`. This is how a step is added part-way through a chain.
    if (spot && spot.kind === 'edge') {
      const edge = flowFindEdge(graph, spot.id);
      if (edge && edge.from !== drag.from && edge.to !== drag.from) {
        // Out of wherever it was, with that chain closed up behind it, and into this one. Leaving its old lines behind would say it is in two places.
        flowExtractNode(graph, drag.from);
        flowSpliceIntoEdge(graph, drag.from, spot.id);
        flowGraphChanged();
        return;
      }
    }
    // Dropped inside a group's box, on nothing in it: the box joins that group. Dropped on the bare surface with a group behind it: it leaves the one it was in. Both are the same gesture read two ways, and it is the only way to move a box between groups without going through the menu.
    const moving = flowFindNode(graph, drag.from);
    if (spot && spot.kind === 'group') {
      // Dropped back in the group it was already in: nothing happened, and a step in the history that undoes to the same picture is a step wasted.
      if (moving && moving.group === spot.id) {
        drawFlowOverlay();
        return;
      }
      flowMoveNodeToGroup(graph, drag.from, spot.id);
      flowGraphChanged();
      return;
    }
    if (spot && spot.kind === 'canvas' && moving && moving.group) {
      flowMoveNodeToGroup(graph, drag.from, null);
      flowGraphChanged();
      return;
    }
    if (!over || over === drag.from) {
      // Nothing under the pointer: the box goes back where the layout puts it.
      drawFlowOverlay();
      return;
    }
    // Dropped on another box: the dragged one takes that box's place in the declaration order, which is what decides where it sits on its rank. From above it lands after, from below before, so it goes the way the pointer did.
    const order = graph.nodes.map((node) => node.id);
    const was = order.indexOf(drag.from);
    const onto = order.indexOf(over);
    flowMoveNode(graph, drag.from, was < onto ? order[onto + 1] || null : over);
    flowGraphChanged();
  });

  flowCanvas.addEventListener('dblclick', (event) => {
    if (!flowSession || !flowSession.graph) return;
    const near = (selector) => (event.target && event.target.closest ? event.target.closest(selector) : null);
    const node = near('.flow-ring');
    const edge = flowEdgeUnder(event.target);
    if (node) {
      openFlowLabelBox('node', node.dataset.node);
      return;
    }
    if (edge) {
      openFlowLabelBox('edge', edge);
      return;
    }
    // Only genuinely empty space adds a box. Anything inside mermaid's drawing is part of a box or a line, and a double-click there that quietly adds a third box — because the ring over it has gone missing — is exactly the kind of guess this should not make.
    if (!flowPointIsBare(event.target)) return;
    // Nothing stores where a box sits, so the point decides where it lands in the order rather than on the page — near enough that it appears about where it was asked for.
    const where = flowSlotAt(flowPointIn(event));
    openFlowAddPicker((shape, named) => addFlowNode(shape, { before: where, text: named }));
  });

  flowCanvas.addEventListener('contextmenu', (event) => {
    if (!flowSession || !flowSession.graph) return;
    event.preventDefault();
    const spot = flowTargetAt(event.clientX, event.clientY) || { kind: 'canvas', id: null };
    // Empty space has nothing to act on, so the question is which box to add — and that is the picker's question, in the picker's sheet.
    if (spot.kind === 'canvas' || spot.kind === 'group') {
      const where = flowSlotAt(flowPointIn(event));
      openFlowAddPicker((shape, named) => addFlowNode(shape, { before: where, text: named }));
      return;
    }
    selectFlow(spot.kind, spot.id);
    openFlowMenu(event.clientX, event.clientY, spot);
  });
}
