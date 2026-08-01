// ---------------------------------------------------------------------------
// The flowchart sheet: a canvas you draw in and a code pane you type mermaid
// into, over the page. Two views, one model — the graph is the truth while the
// sheet is open, text is the interchange between the panes, and mermaid is the
// only serialization.
//
// Nothing is written until Save, and Save is one splice: the document's undo
// button then puts the whole diagram back, which is what a reader means by
// "undo that". Cancel writes nothing.
//
// The grammar lives in flow-model.js and the placement in flow-layout.js. This
// file knows neither — it asks.
// ---------------------------------------------------------------------------

const flowBackdrop = document.getElementById('flowBackdrop');
const flowSheet = document.getElementById('flowSheet');
const flowSheetTitle = document.getElementById('flowSheetTitle');
const flowSheetCancel = document.getElementById('flowSheetCancel');
const flowSheetSave = document.getElementById('flowSheetSave');
const flowUndoButton = document.getElementById('flowUndo');
const flowRedoButton = document.getElementById('flowRedo');
const flowDirectionPicker = document.getElementById('flowDirection');
const flowHint = document.getElementById('flowHint');
const flowCanvas = document.getElementById('flowCanvas');
const flowZoomIn = document.getElementById('flowZoomIn');
const flowZoomOut = document.getElementById('flowZoomOut');
const flowZoomFit = document.getElementById('flowZoomFit');
const flowInspector = document.getElementById('flowInspector');
const flowNotice = document.getElementById('flowNotice');
const flowCode = document.getElementById('flowCode');
const flowPreview = document.getElementById('flowPreview');
const flowPreviewError = document.getElementById('flowPreviewError');

// What the sheet is editing, for as long as it is open. `graph` is null while
// the text is something the canvas cannot model; `text` is authoritative either
// way, because it is what Save writes.
let flowSession = null;
let flowSelection = null;
let flowDrag = null;
let flowCodeTimer = 0;
let flowPreviewTimer = 0;
let flowPreviewSeq = 0;
let flowLastFocus = null;
// The drawn diagram's own size, how much of life size it is shown at, and where
// the last draw put everything — which is what lets a label box be placed over
// the shape it belongs to without measuring the page.
let flowSize = null;
let flowZoom = 1;
let flowPlaced = null;
// The box being typed into on the canvas, if any.
let flowLabelBox = null;
// Steps back and forward, and the state as of the last settled point. `before`
// is what a change undoes to, re-taken after every change — which is how one
// place can record a step without every caller having to remember to.
const flowHistory = { past: [], future: [] };
let flowBefore = null;
const FLOW_HISTORY_CAP = 100;

// Why the canvas is off. The code pane still works on every one of these, which
// is why refusing costs the reader nothing.
const FLOW_UNMODELED = 'The canvas can’t model this diagram yet — edit it as text below.';
const FLOW_NOTHING_YET = 'Nothing here yet. Double-click anywhere to add the first box.';
const FLOW_TIP_IDLE =
  'Double-click empty space to add a box · double-click a box to rename it · right-click anything for more.';
const FLOW_TIP_NODE =
  'Its + handles add the step before or after it · drag it onto a line to put it in that line · Delete removes it.';
// The first box is the one that decides which way the whole chart runs, so it is
// the only one offered all four handles. After that, Flow up top turns it.
const FLOW_TIP_FIRST = 'Its four + handles start the chart running that way. After that, Flow up top turns it.';
const FLOW_TIP_EDGE = 'Drag either end onto another box to reconnect it · Delete removes it.';
// What a drag is offering, said while it is still in the air. Every drop this
// canvas takes is one of these, so none of them has to be guessed at.
const FLOW_TIP_MOVING = 'Drop on a line to put this box in it · on another box to move it beside that one.';
const FLOW_TIP_BUD = 'Let go on empty space for a new box · on another box to connect to it.';

// ---- opening and closing ---------------------------------------------------

// `save` is handed the mermaid text and decides where it goes: the insert row
// writes a new block, a diagram already in the page splices its own range.
function openFlowSheet({ title, text, save }) {
  if (!flowSheet || !flowBackdrop) return;
  flowLastFocus = document.activeElement;
  flowSession = { save, text: typeof text === 'string' ? text : '', graph: null };
  flowSelection = null;
  flowZoom = 1;
  if (flowSheetTitle) flowSheetTitle.textContent = title || 'Flowchart';
  buildFlowControls();
  flowHistory.past.length = 0;
  flowHistory.future.length = 0;
  flowBefore = null;
  setFlowText(flowSession.text, 'open');
  flowBackdrop.hidden = false;
  flowSheet.hidden = false;
  requestAnimationFrame(() => {
    flowBackdrop.classList.add('open');
    flowSheet.classList.add('open');
    // Only now does the pane have a size to fit the diagram into.
    fitFlowCanvas();
    centerFlowCanvas();
  });
  document.addEventListener('keydown', onFlowSheetKey);
  if (flowCanvas) flowCanvas.focus({ preventScroll: true });
}

function closeFlowSheet() {
  if (!flowSession) return;
  closeFlowMenu();
  closeFlowLabelBox(false);
  flowSession = null;
  flowSelection = null;
  flowDrag = null;
  window.clearTimeout(flowCodeTimer);
  window.clearTimeout(flowPreviewTimer);
  document.removeEventListener('keydown', onFlowSheetKey);
  flowBackdrop.classList.remove('open');
  flowSheet.classList.remove('open');
  const hide = () => {
    flowSheet.hidden = true;
    flowBackdrop.hidden = true;
    flowSheet.removeEventListener('transitionend', hide);
  };
  flowSheet.addEventListener('transitionend', hide);
  window.setTimeout(hide, 320);
  if (flowLastFocus && flowLastFocus.focus) flowLastFocus.focus();
}

function saveFlowSheet() {
  if (!flowSession) return;
  closeFlowLabelBox(true);
  if (flowSheetSave && flowSheetSave.disabled) return;
  const save = flowSession.save;
  const text = flowSession.text;
  closeFlowSheet();
  if (typeof save === 'function') save(text);
}

// Escape closes without writing, the same as Cancel. Delete removes what the
// canvas has selected, but never while something is being typed.
function onFlowSheetKey(event) {
  if (!flowSession) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    // One thing at a time: the menu goes first, and the sheet only when there
    // is nothing else open over it.
    if (flowMenu) {
      closeFlowMenu();
      return;
    }
    closeFlowSheet();
    return;
  }
  // A field has its own undo and its own idea of Delete; leave it to it.
  const inField = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (inField) return;
  const key = String(event.key).toLowerCase();
  if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redoFlow();
    else undoFlow();
    return;
  }
  if (!flowSelection || !flowSession.graph) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteFlowSelection();
    return;
  }
  // Enter renames the selected box, the way Finder and every outliner does.
  if (event.key === 'Enter') {
    event.preventDefault();
    openFlowLabelBox(flowSelection.kind, flowSelection.id);
  }
}

// ---- the two panes, kept in step ------------------------------------------

// Text typed into the code pane, or the text the sheet opened on. This is the
// only place the graph is re-derived: what the canvas produces is never parsed
// back, so an edit can never cost the canvas its graph.
function setFlowText(text, from) {
  if (!flowSession) return;
  if (from === 'code') recordFlowStep();
  flowSession.text = text;
  flowSession.graph = parseFlow(text);
  if (flowSelection && !flowSelectionStillThere()) flowSelection = null;
  if (from !== 'code' && flowCode) flowCode.value = text;
  redrawFlowSheet();
  flowBefore = flowSnapshot();
}

// The canvas moved. The graph is already the truth, so this only writes it out —
// re-reading our own text would be work for nothing, and it is what used to
// leave the canvas dead the moment you deleted the last box.
function flowGraphChanged() {
  if (!flowSession || !flowSession.graph) return;
  recordFlowStep();
  flowSession.text = renderFlow(flowSession.graph);
  if (flowCode) flowCode.value = flowSession.text;
  if (flowSelection && !flowSelectionStillThere()) flowSelection = null;
  redrawFlowSheet();
  flowBefore = flowSnapshot();
}

function redrawFlowSheet() {
  drawFlowCanvas();
  drawFlowInspector();
  updateFlowSaveState();
  updateFlowHistoryButtons();
  queueFlowPreview();
}

// ---- stepping back ---------------------------------------------------------

// The sheet keeps its own history, because one Save is one document undo and
// nobody wants "undo" to mean "throw the whole diagram away". A step is the
// graph and the text together: restoring only the text would re-read it, and an
// emptied diagram does not survive that trip.
function flowSnapshot() {
  if (!flowSession) return null;
  return {
    text: flowSession.text,
    graph: flowSession.graph ? JSON.parse(JSON.stringify(flowSession.graph)) : null,
    selection: flowSelection ? { kind: flowSelection.kind, id: flowSelection.id } : null,
  };
}

function recordFlowStep() {
  if (!flowBefore) return;
  flowHistory.past.push(flowBefore);
  if (flowHistory.past.length > FLOW_HISTORY_CAP) flowHistory.past.shift();
  flowHistory.future.length = 0;
}

function applyFlowState(state) {
  if (!state || !flowSession) return;
  closeFlowLabelBox(false);
  flowSession.text = state.text;
  flowSession.graph = state.graph ? JSON.parse(JSON.stringify(state.graph)) : null;
  flowSelection = state.selection ? { kind: state.selection.kind, id: state.selection.id } : null;
  if (flowCode) flowCode.value = state.text;
  redrawFlowSheet();
  flowBefore = flowSnapshot();
}

function undoFlow() {
  if (!flowSession || !flowHistory.past.length) return;
  const now = flowSnapshot();
  const back = flowHistory.past.pop();
  applyFlowState(back);
  flowHistory.future.push(now);
  updateFlowHistoryButtons();
}

function redoFlow() {
  if (!flowSession || !flowHistory.future.length) return;
  const now = flowSnapshot();
  const forward = flowHistory.future.pop();
  applyFlowState(forward);
  flowHistory.past.push(now);
  updateFlowHistoryButtons();
}

function updateFlowHistoryButtons() {
  if (flowUndoButton) flowUndoButton.disabled = !flowHistory.past.length;
  if (flowRedoButton) flowRedoButton.disabled = !flowHistory.future.length;
}

if (flowUndoButton) flowUndoButton.addEventListener('click', undoFlow);
if (flowRedoButton) flowRedoButton.addEventListener('click', redoFlow);

// An empty diagram is a legal thing to be halfway through and not a legal thing
// to write: mermaid cannot draw a flowchart with nothing in it.
function updateFlowSaveState() {
  if (!flowSheetSave) return;
  const graph = flowSession && flowSession.graph;
  const empty = !!graph && !graph.nodes.length;
  flowSheetSave.disabled = empty;
  flowSheetSave.title = empty ? 'Add a box before saving' : '';
}

function flowSelectionStillThere() {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowSelection) return false;
  return flowSelection.kind === 'node'
    ? !!flowFindNode(graph, flowSelection.id)
    : !!flowFindEdge(graph, flowSelection.id);
}

if (flowCode) {
  flowCode.addEventListener('input', () => {
    if (!flowSession) return;
    window.clearTimeout(flowCodeTimer);
    flowCodeTimer = window.setTimeout(() => setFlowText(flowCode.value, 'code'), 180);
  });
}
if (flowSheetCancel) flowSheetCancel.addEventListener('click', closeFlowSheet);
if (flowSheetSave) flowSheetSave.addEventListener('click', saveFlowSheet);
if (flowBackdrop) flowBackdrop.addEventListener('click', closeFlowSheet);

// ---- the line that says what things are ------------------------------------

// Fourteen shapes is more than anyone can be expected to know by their outline,
// so hovering one says what it is for. Each hint is a field on the shape's own
// row, beside the outline the button draws.
function setFlowHint(text) {
  if (flowHint) flowHint.textContent = text;
}

function restoreFlowHint() {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowSelection) {
    setFlowHint(FLOW_TIP_IDLE);
    return;
  }
  if (flowSelection.kind === 'edge') {
    setFlowHint(FLOW_TIP_EDGE);
    return;
  }
  const node = flowFindNode(graph, flowSelection.id);
  const shape = node && flowShape(node.type);
  if (!shape) {
    setFlowHint(FLOW_TIP_IDLE);
    return;
  }
  const tip = graph.nodes.length <= 1 ? FLOW_TIP_FIRST : FLOW_TIP_NODE;
  setFlowHint(shape.label + ' — ' + shape.hint + ' ' + tip);
}

// ---- the palette and the direction ----------------------------------------

// How wide and tall a palette button's little drawing is.
const FLOW_CHIP_W = 42;
const FLOW_CHIP_H = 26;

// A shape, drawn small. The same `outline` the canvas draws from, so a palette
// button cannot show one thing and the canvas another — and adding a shape adds
// its button with no work here at all.
function flowShapeChip(type) {
  const box = { x: 3, y: 3, w: FLOW_CHIP_W - 6, h: FLOW_CHIP_H - 6, cx: FLOW_CHIP_W / 2, cy: FLOW_CHIP_H / 2 };
  return (
    '<svg class="flow-chip" viewBox="0 0 ' + FLOW_CHIP_W + ' ' + FLOW_CHIP_H + '" aria-hidden="true">' +
    flowOutlineMarkup(type, box) +
    '</svg>'
  );
}

// One end, drawn where a marker would put it. Markers need a `defs` block and a
// document-unique id; a chip is one glyph, so it draws the glyph.
function flowEndChipGlyph(mark, x, y, facing) {
  if (!mark) return '';
  if (mark === 'arrow') {
    const back = x - 6 * facing;
    return '<path class="flow-end-mark" d="M' + back + ' ' + (y - 4) + ' L' + x + ' ' + y + ' L' + back + ' ' + (y + 4) + ' Z"/>';
  }
  if (mark === 'circle') return '<circle class="flow-end-mark" cx="' + x + '" cy="' + y + '" r="3.5"/>';
  return (
    '<path class="flow-end-mark is-open" d="M' + (x - 3) + ' ' + (y - 3) + ' L' + (x + 3) + ' ' + (y + 3) +
    ' M' + (x + 3) + ' ' + (y - 3) + ' L' + (x - 3) + ' ' + (y + 3) + '"/>'
  );
}

// A connector, drawn small: the line in its own style with whatever sits at
// each tip. Used for both the line buttons and the end buttons.
function flowEdgeChip(lineId, endId) {
  const ends = flowEdgeEnd(endId);
  const y = FLOW_CHIP_H / 2;
  return (
    '<svg class="flow-chip" viewBox="0 0 ' + FLOW_CHIP_W + ' ' + FLOW_CHIP_H + '" aria-hidden="true">' +
    '<line class="flow-chip-line is-' + flowEdgeLine(lineId).id + '" x1="7" y1="' + y + '" x2="' + (FLOW_CHIP_W - 7) + '" y2="' + y + '"/>' +
    flowEndChipGlyph(flowEndMark(ends.head), 7, y, -1) +
    flowEndChipGlyph(flowEndMark(ends.tail), FLOW_CHIP_W - 7, y, 1) +
    '</svg>'
  );
}

function buildFlowControls() {
  if (flowDirectionPicker && !flowDirectionPicker.childElementCount) {
    for (const direction of FLOW_DIRECTIONS) {
      const option = document.createElement('option');
      option.value = direction.id;
      option.textContent = direction.label;
      flowDirectionPicker.appendChild(option);
    }
    flowDirectionPicker.addEventListener('change', () => {
      if (!flowSession || !flowSession.graph) return;
      flowSession.graph.direction = flowDirectionPicker.value;
      flowGraphChanged();
    });
  }
}

// The one way a box is ever made. A + handle, a double-click on empty space and
// the menu all come through here saying where it goes in the order and what it
// hangs off, so they cannot disagree about what happens next.
function addFlowNode(shapeId, options) {
  const graph = flowSession && flowSession.graph;
  if (!graph) return null;
  const { before, connectFrom, connectTo, turn, intoEdge } = options || {};
  // Asked for across the flow: the chart turns, so the new step lands on the
  // side it was asked for rather than wherever the old direction would put it.
  if (turn) graph.direction = turn;
  const node = flowAddNode(graph, shapeId, flowShape(shapeId).label);
  if (before !== undefined) flowMoveNode(graph, node.id, before);
  if (connectFrom) flowConnect(graph, connectFrom, node.id);
  if (connectTo) flowConnect(graph, node.id, connectTo);
  if (intoEdge) flowSpliceIntoEdge(graph, node.id, intoEdge);
  flowSelection = { kind: 'node', id: node.id };
  flowGraphChanged();
  // Straight into typing its name: a box called "Step" helps nobody.
  openFlowLabelBox('node', node.id);
  return node;
}

// Where a point on the canvas falls in the declaration order: the id to put a
// new box in front of, or null for the end. Nothing stores coordinates, so this
// is as close as "add it here" can get — and it is close enough that a box lands
// near where it was asked for.
function flowSlotAt(point) {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowPlaced || !flowPlaced.nodes.length) return undefined;
  let best = null;
  let nearest = Infinity;
  for (const node of flowPlaced.nodes) {
    const dx = point.x - (node.x + node.width / 2);
    const dy = point.y - (node.y + node.height / 2);
    const away = dx * dx + dy * dy;
    if (away < nearest) {
      nearest = away;
      best = node;
    }
  }
  if (!best) return undefined;
  const ids = graph.nodes.map((node) => node.id);
  const at = ids.indexOf(best.id);
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const past = horizontal ? point.x > best.x + best.width / 2 : point.y > best.y + best.height / 2;
  return past ? ids[at + 1] || null : best.id;
}

// ---- the canvas ------------------------------------------------------------

function drawFlowCanvas() {
  if (!flowCanvas) return;
  const graph = flowSession && flowSession.graph;
  const empty = !!graph && !graph.nodes.length;
  if (flowNotice) {
    flowNotice.hidden = !!graph && !empty;
    flowNotice.textContent = graph ? (empty ? FLOW_NOTHING_YET : '') : FLOW_UNMODELED;
  }
  if (flowDirectionPicker) {
    flowDirectionPicker.disabled = !graph;
    if (graph) flowDirectionPicker.value = graph.direction === 'TB' ? 'TD' : graph.direction;
  }
  flowCanvas.classList.toggle('is-disabled', !graph);
  restoreFlowHint();
  if (!graph) {
    flowSize = null;
    flowPlaced = null;
    flowCanvas.innerHTML = '';
    return;
  }
  flowPlaced = layoutFlow(graph);
  flowSize = { width: Math.max(1, flowPlaced.width), height: Math.max(1, flowPlaced.height) };
  // Every selection redraws the whole surface, and replacing its contents sends
  // the scroll box back to the corner. Put it back, or picking a box halfway
  // down a diagram would throw the view away.
  const left = flowCanvas.scrollLeft;
  const top = flowCanvas.scrollTop;
  flowCanvas.innerHTML = flowCanvasMarkup(flowPlaced);
  flowCanvas.scrollLeft = left;
  flowCanvas.scrollTop = top;
}

// The stage is the diagram's own box at the current zoom. It exists so the label
// editor can be placed over a shape in the diagram's own coordinates, and so it
// scrolls with the drawing rather than sitting still over it.
function flowCanvasMarkup(layout) {
  const parts = [];
  const width = Math.round(flowSize.width * flowZoom);
  const height = Math.round(flowSize.height * flowZoom);
  parts.push('<div class="flow-stage" style="width:' + width + 'px;height:' + height + 'px">');
  // The viewBox is the diagram's own size and the width/height are that scaled:
  // zooming changes only the two attributes, so it never has to be redrawn.
  parts.push(
    '<svg class="flow-svg" viewBox="0 0 ' + flowSize.width + ' ' + flowSize.height +
      '" width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">',
  );
  // One marker per end and state, not one recolored: a marker renders in its own
  // context, so `currentColor` inside it never sees the line that pointed at it.
  const defs = [];
  for (const mark of ['arrow', 'circle', 'cross']) {
    defs.push(flowEndMarker(mark, false), flowEndMarker(mark, true));
  }
  parts.push('<defs>' + defs.join('') + '</defs>');
  const direction = flowSession.graph.direction;
  const sides = flowBudSidesFor(flowSession.graph);
  for (const edge of layout.edges) parts.push(flowEdgeMarkup(edge));
  for (const node of layout.nodes) parts.push(flowNodeMarkup(node, direction, sides));
  parts.push('</svg></div>');
  return parts.join('');
}

const FLOW_END_GLYPHS = {
  arrow: '<path class="flow-end-mark" d="M0 0 10 5 0 10z"/>',
  circle: '<circle class="flow-end-mark" cx="5" cy="5" r="4"/>',
  cross: '<path class="flow-end-mark is-open" d="M1.5 1.5 8.5 8.5 M8.5 1.5 1.5 8.5"/>',
};

function flowEndMarkerId(mark, selected) {
  return 'flowEnd' + mark.charAt(0).toUpperCase() + mark.slice(1) + (selected ? 'On' : '');
}

function flowEndMarker(mark, selected) {
  // A circle and a cross sit centered on the tip; only the arrow points.
  const refX = mark === 'arrow' ? 9 : 5;
  return (
    '<marker id="' + flowEndMarkerId(mark, selected) +
    '" viewBox="0 0 10 10" refX="' + refX +
    '" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    FLOW_END_GLYPHS[mark].replace('flow-end-mark', 'flow-end-mark' + (selected ? ' is-selected' : '')) +
    '</marker>'
  );
}

function flowEdgePath(edge) {
  return (
    'M' + edge.from.x + ' ' + edge.from.y +
    ' C' + edge.control1.x + ' ' + edge.control1.y +
    ' ' + edge.control2.x + ' ' + edge.control2.y +
    ' ' + edge.to.x + ' ' + edge.to.y
  );
}

function flowEdgeMarkup(edge) {
  const selected = flowSelection && flowSelection.kind === 'edge' && flowSelection.id === edge.id;
  const d = flowEdgePath(edge);
  const ends = flowEdgeEnd(edge.toEnd);
  const startMark = flowEndMark(ends.head);
  const endMark = flowEndMark(ends.tail);
  const markers =
    (startMark ? ' marker-start="url(#' + flowEndMarkerId(startMark, selected) + ')"' : '') +
    (endMark ? ' marker-end="url(#' + flowEndMarkerId(endMark, selected) + ')"' : '');
  const parts = [
    '<g class="flow-edge is-' + flowEdgeLine(edge.line).id + (selected ? ' is-selected' : '') +
      '" data-edge="' + escapeAttr(edge.id) + '">',
    // A line is a few pixels of ink; this is what a click actually lands on.
    '<path class="flow-edge-hit" d="' + d + '" fill="none"/>',
    '<path class="flow-edge-line" d="' + d + '" fill="none"' + markers + '/>',
  ];
  if (edge.label) {
    parts.push(
      '<text class="flow-edge-label" x="' + edge.labelAt.x + '" y="' + edge.labelAt.y +
        '" text-anchor="middle" dominant-baseline="middle">' + escapeText(edge.label) + '</text>',
    );
  }
  // Both ends become grab handles once the line is picked, so where a line goes
  // is changed the same way it was drawn in the first place.
  if (selected) {
    for (const which of ['from', 'to']) {
      parts.push(
        '<circle class="flow-edge-end" data-endpoint="' + which + '" data-edge="' + escapeAttr(edge.id) +
          '" cx="' + edge[which].x + '" cy="' + edge[which].y + '" r="6"/>',
      );
    }
  }
  parts.push('</g>');
  return parts.join('');
}

// The box a shape's own row describes, turned into SVG. The row hands back
// numbers; the only place that knows what a `<polygon>` is, is here.
function flowOutlineMarkup(type, box) {
  const parts = flowShape(type).outline(box);
  return parts
    .map((part) => {
      const cls = ' class="flow-node-shape' + (part.open ? ' is-open' : '') + '"';
      if (part.kind === 'rect') {
        return (
          '<rect' + cls + ' x="' + part.x + '" y="' + part.y + '" width="' + part.w +
          '" height="' + part.h + '" rx="' + flowRound(part.rx) + '"/>'
        );
      }
      if (part.kind === 'circle') {
        return '<circle' + cls + ' cx="' + part.cx + '" cy="' + part.cy + '" r="' + flowRound(part.r) + '"/>';
      }
      if (part.kind === 'line') {
        return (
          '<line class="flow-node-mark" x1="' + part.x1 + '" y1="' + part.y1 +
          '" x2="' + part.x2 + '" y2="' + part.y2 + '"/>'
        );
      }
      if (part.kind === 'poly') {
        return '<polygon' + cls + ' points="' + part.points.map((p) => flowRound(p[0]) + ' ' + flowRound(p[1])).join(', ') + '"/>';
      }
      return '<path' + cls + ' d="' + part.d.map((step) => step.map(flowRound).join(' ')).join(' ') + '"/>';
    })
    .join('');
}

function flowRound(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
}

// A box's + handles, one per side, all meaning the next step *that way*. A chart
// has one direction, so a step asked for across the flow can only land where it
// was asked for if the chart turns — see flowBudSidesFor for who may ask.
const FLOW_BUD_SIDES = ['up', 'down', 'left', 'right'];
const FLOW_BUD_WORDS = { up: 'above', down: 'below', left: 'to the left', right: 'to the right' };
// A mermaid direction and a side of a box are the same fact, said two ways.
const FLOW_DIRECTION_WAY = { TD: 'down', TB: 'down', BT: 'up', LR: 'right', RL: 'left' };
const FLOW_WAY_DIRECTION = { down: 'TD', up: 'BT', right: 'LR', left: 'RL' };
const FLOW_OPPOSITE_WAY = { up: 'down', down: 'up', left: 'right', right: 'left' };

function flowBudPoints(node) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return {
    up: { x: cx, y: node.y },
    down: { x: cx, y: node.y + node.height },
    left: { x: node.x, y: cy },
    right: { x: node.x + node.width, y: cy },
  };
}

// What a handle does, which depends on which way the chart already runs. With
// the flow it is the next step; against it, the step before this one; across it,
// the next step and the chart turns to follow.
function flowBudIntent(direction, side) {
  const way = FLOW_DIRECTION_WAY[direction] || 'down';
  if (side === way) return { step: 'next' };
  if (side === FLOW_OPPOSITE_WAY[way]) return { step: 'previous' };
  return { step: 'next', turn: FLOW_WAY_DIRECTION[side] };
}

function flowBudTitle(direction, side) {
  const intent = flowBudIntent(direction, side);
  if (intent.step === 'previous') return 'Add the step before this';
  if (!intent.turn) return 'Add the next step';
  return 'Start the chart running ' + FLOW_BUD_WORDS[side];
}

// Which sides get a handle. A chart of one box has not said which way it runs,
// so all four are offered and the one you take settles it. After that only the
// two along the flow appear: a handle that spun the whole diagram round under
// you would be a trap, and the Flow picker is how it turns from then on.
function flowBudSidesFor(graph) {
  if (graph.nodes.length <= 1) return FLOW_BUD_SIDES;
  const way = FLOW_DIRECTION_WAY[graph.direction] || 'down';
  return [way, FLOW_OPPOSITE_WAY[way]];
}

// One + handle. Click it and pick the shape you want, or drag it onto a box that
// already exists to connect the two.
function flowBudMarkup(id, side, at, direction) {
  return (
    '<g class="flow-bud" data-bud="' + side + '" data-node="' + escapeAttr(id) + '">' +
    '<title>' + escapeText(flowBudTitle(direction, side)) + '</title>' +
    '<circle class="flow-bud-disc" cx="' + flowRound(at.x) + '" cy="' + flowRound(at.y) + '" r="8"/>' +
    '<path class="flow-bud-plus" d="M' + flowRound(at.x - 4) + ' ' + flowRound(at.y) +
    ' h8 M' + flowRound(at.x) + ' ' + flowRound(at.y - 4) + ' v8"/>' +
    '</g>'
  );
}

// What a + handle makes, as addFlowNode's arguments.
function flowBudRelation(graph, id, side) {
  const intent = flowBudIntent(graph.direction, side);
  const relation = intent.step === 'previous' ? { connectTo: id } : { connectFrom: id };
  if (intent.turn) relation.turn = intent.turn;
  return relation;
}

function flowNodeMarkup(node, direction, sides) {
  const selected = flowSelection && flowSelection.kind === 'node' && flowSelection.id === node.id;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const outline = flowOutlineMarkup(node.type, { x: node.x, y: node.y, w: node.width, h: node.height, cx, cy });
  const buds = flowBudPoints(node);
  return (
    '<g class="flow-node' + (selected ? ' is-selected' : '') + '" data-node="' + escapeAttr(node.id) + '">' +
    outline +
    '<text class="flow-node-label" x="' + cx + '" y="' + cy +
    '" text-anchor="middle" dominant-baseline="middle">' + escapeText(flowClampLabel(node)) + '</text>' +
    sides.map((side) => flowBudMarkup(node.id, side, buds[side], direction)).join('') +
    '</g>'
  );
}

// The box was sized from the label, up to a limit; past it the text is cut
// rather than allowed to run outside its own shape. A shape that grew wider than
// its text holds no more of it, so the room is measured before that growth.
function flowClampLabel(node) {
  const text = String(node.text == null ? node.id : node.text).replace(/<br\s*\/?>/gi, ' ');
  const room = Math.floor((node.width / flowShape(node.type).grow[0] - 18) / 7.4);
  return text.length > room ? text.slice(0, Math.max(1, room - 1)) + '…' : text;
}

// ---- how big it is drawn ---------------------------------------------------

// A big diagram in a small window is one you pan, not one you squint at. The
// scroll box was always there; this is what lets you get the whole thing into it.
const FLOW_ZOOM_MIN = 0.25;
const FLOW_ZOOM_MAX = 2.5;

function setFlowZoom(next) {
  const clamped = Math.max(FLOW_ZOOM_MIN, Math.min(FLOW_ZOOM_MAX, next));
  if (Math.abs(clamped - flowZoom) < 0.001) return;
  closeFlowLabelBox(true);
  flowZoom = clamped;
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  const svg = stage && stage.querySelector('.flow-svg');
  if (!svg || !flowSize) return;
  const width = Math.round(flowSize.width * flowZoom);
  const height = Math.round(flowSize.height * flowZoom);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  stage.style.width = width + 'px';
  stage.style.height = height + 'px';
}

// As large as it goes without spilling, and never enlarged past life size — a
// three-box diagram blown up to fill the pane looks broken, not helpful.
function fitFlowCanvas() {
  if (!flowCanvas || !flowSize) return;
  const room = flowCanvas.clientWidth - 24;
  const tall = flowCanvas.clientHeight - 24;
  if (room <= 0 || tall <= 0) return;
  setFlowZoom(Math.min(1, room / flowSize.width, tall / flowSize.height));
}

// A diagram smaller than the pane is centered by the layout (see .flow-stage);
// one bigger than it opens on its middle rather than its top-left corner.
function centerFlowCanvas() {
  if (!flowCanvas) return;
  flowCanvas.scrollLeft = Math.max(0, (flowCanvas.scrollWidth - flowCanvas.clientWidth) / 2);
  flowCanvas.scrollTop = Math.max(0, (flowCanvas.scrollHeight - flowCanvas.clientHeight) / 2);
}

if (flowZoomIn) flowZoomIn.addEventListener('click', () => setFlowZoom(flowZoom * 1.2));
if (flowZoomOut) flowZoomOut.addEventListener('click', () => setFlowZoom(flowZoom / 1.2));
if (flowZoomFit) flowZoomFit.addEventListener('click', fitFlowCanvas);
if (flowCanvas) {
  flowCanvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || !flowSession) return;
      event.preventDefault();
      setFlowZoom(flowZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );
}

// ---- pointer work on the canvas -------------------------------------------

const FLOW_SVG_NS = 'http://www.w3.org/2000/svg';

function flowNodeAt(x, y) {
  const found = flowTargetAt(x, y);
  return found && found.kind === 'node' ? found.id : null;
}

// What is under the pointer, in the three flavors every drop cares about: a box,
// a line, or the surface itself. Null means the pointer has left the canvas.
function flowTargetAt(x, y) {
  if (!flowCanvas) return null;
  const found = document.elementFromPoint(x, y);
  if (!found || !found.closest || !flowCanvas.contains(found)) return null;
  const node = found.closest('.flow-node');
  if (node) return { kind: 'node', id: node.dataset.node };
  const edge = found.closest('.flow-edge');
  if (edge) return { kind: 'edge', id: edge.dataset.edge };
  return { kind: 'canvas', id: null };
}

// A pointer position in the diagram's own coordinates, so a rubber-band line can
// be drawn in the same space the boxes were placed in.
function flowPointAt(x, y) {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  if (!stage) return { x: 0, y: 0 };
  const rect = stage.getBoundingClientRect();
  return { x: (x - rect.left) / flowZoom, y: (y - rect.top) / flowZoom };
}

function flowPointIn(event) {
  return flowPointAt(event.clientX, event.clientY);
}

function flowGroupFor(id) {
  return flowCanvas ? flowCanvas.querySelector('.flow-node[data-node="' + id + '"]') : null;
}

// The line that follows the pointer while a connection is being made or moved.
function drawFlowRubber(from, to) {
  const svg = flowCanvas && flowCanvas.querySelector('.flow-svg');
  if (!svg) return;
  let line = svg.querySelector('.flow-rubber');
  if (!line) {
    line = document.createElementNS(FLOW_SVG_NS, 'line');
    line.setAttribute('class', 'flow-rubber');
    svg.appendChild(line);
  }
  line.setAttribute('x1', from.x);
  line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x);
  line.setAttribute('y2', to.y);
}

function clearFlowRubber() {
  const line = flowCanvas && flowCanvas.querySelector('.flow-rubber');
  if (line) line.remove();
}

// What the pointer is over, lit up so a drop is never a guess. Takes what
// flowTargetAt hands back, or an id, or nothing.
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
  if (spot.kind !== 'edge') return;
  const line = flowCanvas.querySelector('.flow-edge[data-edge="' + spot.id + '"]');
  if (line) line.classList.add('is-drop');
}

// Where a line being re-aimed still holds on: the end that is not moving.
function flowFixedEnd(edgeId, moving) {
  const placed = flowPlaced && flowPlaced.edges.find((edge) => edge.id === edgeId);
  if (!placed) return { x: 0, y: 0 };
  return moving === 'from' ? placed.to : placed.from;
}

if (flowCanvas) {
  flowCanvas.addEventListener('pointerdown', (event) => {
    const graph = flowSession && flowSession.graph;
    if (!graph || event.button !== 0) return;
    const target = event.target;
    const near = (selector) => (target && target.closest ? target.closest(selector) : null);
    const endpoint = near('.flow-edge-end');
    const bud = near('.flow-bud');
    const node = near('.flow-node');
    const edge = near('.flow-edge');
    // Nothing here calls preventDefault: on a pointerdown it suppresses the
    // compatibility mouse events, dblclick included, so double-clicking a shape
    // to rename it did nothing. Text selection is held off in the stylesheet.
    const grab = () => {
      try {
        flowCanvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* the drag still works without capture */
      }
    };
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
      selectFlow('edge', edge.dataset.edge);
      return;
    }
    // Empty space: nothing is selected any more, and the pointer now carries
    // the view — which is how you get around a diagram bigger than the pane.
    selectFlow(null, null);
    flowDrag = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      left: flowCanvas.scrollLeft,
      top: flowCanvas.scrollTop,
      moved: false,
    };
    grab();
  });

  flowCanvas.addEventListener('pointermove', (event) => {
    if (!flowDrag) return;
    if (flowDrag.kind === 'pan') {
      flowDrag.moved = true;
      flowCanvas.scrollLeft = flowDrag.left - (event.clientX - flowDrag.startX);
      flowCanvas.scrollTop = flowDrag.top - (event.clientY - flowDrag.startY);
      flowCanvas.classList.add('is-panning');
      return;
    }
    if (flowDrag.kind === 'reorder') {
      const far = Math.abs(event.clientX - flowDrag.startX) + Math.abs(event.clientY - flowDrag.startY);
      if (!flowDrag.moved && far <= 4) return;
      flowDrag.moved = true;
      flowCanvas.classList.add('is-dragging');
      setFlowHint(FLOW_TIP_MOVING);
      // The box comes with the pointer. Nothing is stored, so where you let go
      // only says where it sits among its neighbors and it settles back into the
      // layout — but a box that would not move at all reads as a broken one.
      const group = flowGroupFor(flowDrag.from);
      if (group) {
        group.classList.add('is-dragging');
        const dx = (event.clientX - flowDrag.startX) / flowZoom;
        const dy = (event.clientY - flowDrag.startY) / flowZoom;
        group.setAttribute('transform', 'translate(' + flowRound(dx) + ' ' + flowRound(dy) + ')');
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

    // A + handle pressed and released without travelling is a click: pick the
    // shape, and it arrives joined up on the side the handle sits.
    if (drag.kind === 'bud' && !drag.moved) {
      openFlowShapePicker(
        event.clientX,
        event.clientY,
        (shape) => addFlowNode(shape, flowBudRelation(graph, drag.from, drag.side)),
        flowNewNodeShape(graph, drag.from),
      );
      return;
    }
    if (!drag.moved) return;
    if (drag.kind === 'retarget') {
      const edge = flowFindEdge(graph, drag.edge);
      if (!edge || !over) {
        drawFlowCanvas();
        return;
      }
      if (drag.end === 'from') edge.fromNode = over;
      else edge.toNode = over;
      flowGraphChanged();
      return;
    }
    if (drag.kind === 'bud') {
      // Let go on a box to join the two; let go on the surface for a new one,
      // near where the pointer stopped.
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
        drawFlowCanvas();
        return;
      }
      const where = flowSlotAt(flowPointIn(event));
      openFlowShapePicker(
        event.clientX,
        event.clientY,
        (shape) => addFlowNode(shape, { ...flowBudRelation(graph, drag.from, drag.side), before: where }),
        flowNewNodeShape(graph, drag.from),
      );
      return;
    }
    // A box dropped on a line goes into that line: `A --> B` becomes
    // `A --> this --> B`. This is how a step is added part-way through a chain.
    if (spot && spot.kind === 'edge') {
      const edge = flowFindEdge(graph, spot.id);
      if (edge && edge.fromNode !== drag.from && edge.toNode !== drag.from) {
        // Out of wherever it was, with that chain closed up behind it, and into
        // this one. Leaving its old lines behind would say it is in two places.
        flowExtractNode(graph, drag.from);
        flowSpliceIntoEdge(graph, drag.from, spot.id);
        flowGraphChanged();
        return;
      }
    }
    if (!over || over === drag.from) {
      // Nothing under the pointer: the box goes back where the layout puts it.
      drawFlowCanvas();
      return;
    }
    // Dropped on another box: the dragged one takes that box's place in the
    // declaration order, which is what decides where it sits on its rank. From
    // above it lands after, from below before, so it goes the way the pointer did.
    const order = graph.nodes.map((node) => node.id);
    const was = order.indexOf(drag.from);
    const onto = order.indexOf(over);
    flowMoveNode(graph, drag.from, was < onto ? order[onto + 1] || null : over);
    flowGraphChanged();
  });

  flowCanvas.addEventListener('dblclick', (event) => {
    if (!flowSession || !flowSession.graph) return;
    const near = (selector) => (event.target && event.target.closest ? event.target.closest(selector) : null);
    const node = near('.flow-node');
    const edge = near('.flow-edge');
    if (node) {
      openFlowLabelBox('node', node.dataset.node);
      return;
    }
    if (edge) {
      openFlowLabelBox('edge', edge.dataset.edge);
      return;
    }
    // Empty space. Nothing stores where a box sits, so the point decides where
    // it lands in the order rather than on the page — near enough that it
    // appears about where it was asked for.
    const where = flowSlotAt(flowPointIn(event));
    openFlowShapePicker(event.clientX, event.clientY, (shape) => addFlowNode(shape, { before: where }));
  });

  flowCanvas.addEventListener('contextmenu', (event) => {
    if (!flowSession || !flowSession.graph) return;
    event.preventDefault();
    const spot = flowTargetAt(event.clientX, event.clientY) || { kind: 'canvas', id: null };
    if (spot.kind !== 'canvas') selectFlow(spot.kind, spot.id);
    else selectFlow(null, null);
    openFlowMenu(event.clientX, event.clientY, spot);
  });
}

// ---- the menu on a right-click ---------------------------------------------

// Everything the canvas can do, named, on the thing it would do it to. The
// gestures are faster once they are known; this is where they are learned, and
// the only place the less common ones (duplicate, detach, flip) live at all.
let flowMenu = null;
let flowMenuAt = { x: 0, y: 0 };

function flowMenuItems(spot) {
  const graph = flowSession.graph;
  if (spot.kind === 'node') {
    return [
      { label: 'Rename', run: () => openFlowLabelBox('node', spot.id) },
      {
        label: 'Add box after this',
        run: () => addFlowNode(flowNewNodeShape(graph, spot.id), { connectFrom: spot.id }),
      },
      {
        label: 'Add box before this',
        run: () => addFlowNode(flowNewNodeShape(graph, spot.id), { connectTo: spot.id }),
      },
      {
        label: 'Duplicate',
        run: () => {
          const copy = flowDuplicateNode(graph, spot.id);
          if (copy) flowSelection = { kind: 'node', id: copy.id };
          flowGraphChanged();
        },
      },
      {
        label: 'Take it out of the chain',
        run: () => {
          flowExtractNode(graph, spot.id);
          flowGraphChanged();
        },
      },
      { label: 'Delete box', run: deleteFlowSelection },
    ];
  }
  if (spot.kind === 'edge') {
    return [
      { label: 'Label this line', run: () => openFlowLabelBox('edge', spot.id) },
      {
        label: 'Point it the other way',
        run: () => {
          flowFlipEdge(graph, spot.id);
          flowGraphChanged();
        },
      },
      { label: 'Delete line', run: deleteFlowSelection },
    ];
  }
  const point = flowPointAt(flowMenuAt.x, flowMenuAt.y);
  return flowShapeChoices((id) => addFlowNode(id, { before: flowSlotAt(point) }));
}

// Every shape, as something to pick. `first` floats one to the top — a + handle
// puts the shape you would most likely want there, so the common chain is still
// one glance and one click.
function flowShapeChoices(make, first) {
  const shapes = FLOW_SHAPES.slice();
  if (first) {
    const at = shapes.findIndex((shape) => shape.id === first);
    if (at > 0) shapes.unshift(shapes.splice(at, 1)[0]);
  }
  return shapes.map((shape) => ({
    label: shape.label,
    chip: shape.id,
    hint: shape.hint,
    run: () => make(shape.id),
  }));
}

// Pick a shape, right where the pointer is. This is what a + handle and a
// double-click on empty space both open, so a new box is the shape you meant
// rather than the one we guessed and left you to fix.
function openFlowShapePicker(x, y, make, first) {
  openFlowMenuWith(x, y, flowShapeChoices(make, first), true);
}

function openFlowMenu(x, y, spot) {
  flowMenuAt = { x, y };
  openFlowMenuWith(x, y, flowMenuItems(spot), spot.kind === 'canvas');
}

function openFlowMenuWith(x, y, items, asGrid) {
  closeFlowMenu();
  flowMenuAt = { x, y };
  const menu = document.createElement('div');
  menu.className = 'flow-menu' + (asGrid ? ' is-shapes' : '');
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flow-menu-item';
    button.setAttribute('role', 'menuitem');
    if (item.hint) button.title = item.hint;
    if (item.chip) button.innerHTML = flowShapeChip(item.chip);
    const text = document.createElement('span');
    text.textContent = item.label;
    button.appendChild(text);
    button.addEventListener('click', () => {
      closeFlowMenu();
      item.run();
    });
    menu.appendChild(button);
  }
  flowSheet.appendChild(menu);
  // Kept inside the sheet: a menu opened near the right edge would otherwise
  // hang off it, and the sheet is the whole window.
  const sheet = flowSheet.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const left = Math.min(x - sheet.left, sheet.width - size.width - 8);
  const top = Math.min(y - sheet.top, sheet.height - size.height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  flowMenu = menu;
  document.addEventListener('pointerdown', onFlowMenuOutside, true);
}

function closeFlowMenu() {
  if (!flowMenu) return;
  document.removeEventListener('pointerdown', onFlowMenuOutside, true);
  if (flowMenu.parentNode) flowMenu.parentNode.removeChild(flowMenu);
  flowMenu = null;
}

function onFlowMenuOutside(event) {
  if (flowMenu && event.target && event.target.closest && event.target.closest('.flow-menu')) return;
  closeFlowMenu();
}

// Where a connection being drawn hangs from: the + handle it left.
function flowBudAnchor(id, side) {
  const placed = flowPlaced && flowPlaced.nodes.find((node) => node.id === id);
  if (!placed) return { x: 0, y: 0 };
  const points = flowBudPoints(placed);
  return points[side] || points.down;
}

// What shape the next box should be. A decision's answers are steps, and
// everything else carries on as itself — so the common chain needs no choosing.
function flowNewNodeShape(graph, fromId) {
  const node = flowFindNode(graph, fromId);
  if (!node) return FLOW_SHAPES[0].id;
  if (node.type === 'diamond' || node.type === 'stadium') return 'rect';
  return node.type;
}

function selectFlow(kind, id) {
  flowSelection = kind ? { kind, id } : null;
  drawFlowCanvas();
  drawFlowInspector();
}

function deleteFlowSelection() {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowSelection) return;
  if (flowSelection.kind === 'node') flowDeleteNode(graph, flowSelection.id);
  else flowDeleteEdge(graph, flowSelection.id);
  flowSelection = null;
  flowGraphChanged();
}

// ---- renaming on the canvas ------------------------------------------------

// A field over the thing it renames, rather than a trip to the strip at the
// bottom of the pane. Placed from the layout, so nothing has to be measured.
function openFlowLabelBox(kind, id) {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowPlaced) return;
  closeFlowLabelBox(true);
  const stage = flowCanvas.querySelector('.flow-stage');
  if (!stage) return;
  const subject =
    kind === 'node' ? flowFindNode(graph, id) : flowFindEdge(graph, id);
  const placed =
    kind === 'node'
      ? flowPlaced.nodes.find((entry) => entry.id === id)
      : flowPlaced.edges.find((entry) => entry.id === id);
  if (!subject || !placed) return;
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'flow-label-box';
  field.spellcheck = false;
  field.value = (kind === 'node' ? subject.text : subject.label) || '';
  field.placeholder = kind === 'node' ? 'Name this box' : 'Label this line';
  field.setAttribute('aria-label', field.placeholder);
  const width = kind === 'node' ? Math.max(70, placed.width - 14) : 140;
  const left = kind === 'node' ? placed.x + (placed.width - width) / 2 : placed.labelAt.x - width / 2;
  const top = (kind === 'node' ? placed.y + placed.height / 2 : placed.labelAt.y) - 13;
  field.style.left = Math.round(left * flowZoom) + 'px';
  field.style.top = Math.round(top * flowZoom) + 'px';
  field.style.width = Math.round(width * flowZoom) + 'px';
  field.style.height = Math.round(26 * flowZoom) + 'px';
  field.style.fontSize = Math.max(9, Math.round(13 * flowZoom)) + 'px';
  // The canvas below would take this as a click on empty space and deselect.
  field.addEventListener('pointerdown', (event) => event.stopPropagation());
  field.addEventListener('dblclick', (event) => event.stopPropagation());
  field.addEventListener('keydown', (event) => {
    // Escape here means "stop renaming", not "close the sheet".
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFlowLabelBox(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      closeFlowLabelBox(true);
    }
  });
  field.addEventListener('blur', () => closeFlowLabelBox(true));
  stage.appendChild(field);
  flowLabelBox = { kind, id, field, was: field.value };
  flowSelection = { kind, id };
  field.focus();
  field.select();
}

// `keep` writes what was typed. Redrawing only happens when it changed, so
// clicking away from a field nobody edited does not rebuild the surface.
function closeFlowLabelBox(keep) {
  const box = flowLabelBox;
  if (!box) return;
  flowLabelBox = null;
  const value = box.field.value;
  if (box.field.parentNode) box.field.parentNode.removeChild(box.field);
  if (!keep || value === box.was) return;
  const graph = flowSession && flowSession.graph;
  if (!graph) return;
  if (box.kind === 'node') {
    const node = flowFindNode(graph, box.id);
    if (!node) return;
    node.text = value.trim() || node.id;
  } else {
    const edge = flowFindEdge(graph, box.id);
    if (!edge) return;
    edge.label = value.trim() || null;
  }
  flowGraphChanged();
}

// ---- what the selection can be changed to ---------------------------------

function drawFlowInspector() {
  if (!flowInspector) return;
  const graph = flowSession && flowSession.graph;
  const selection = flowSelection;
  flowInspector.textContent = '';
  const node = graph && selection && selection.kind === 'node' ? flowFindNode(graph, selection.id) : null;
  const edge = graph && selection && selection.kind === 'edge' ? flowFindEdge(graph, selection.id) : null;
  if (!node && !edge) {
    flowInspector.hidden = true;
    return;
  }
  flowInspector.hidden = false;

  const label = document.createElement('input');
  label.type = 'text';
  label.className = 'flow-field';
  label.spellcheck = false;
  label.placeholder = node ? 'Name this box' : 'Label this line';
  label.value = (node ? node.text : edge.label) || '';
  label.setAttribute('aria-label', node ? 'Box name' : 'Line label');
  label.addEventListener('input', () => {
    if (node) node.text = label.value;
    else edge.label = label.value.trim() || null;
    // The text and the preview follow every keystroke; redrawing the canvas
    // under the caret would take the focus out of the field being typed in.
    flowSession.text = renderFlow(graph);
    if (flowCode) flowCode.value = flowSession.text;
    queueFlowPreview();
  });
  label.addEventListener('change', () => flowGraphChanged());
  flowInspector.appendChild(label);

  // A box picks its shape; a line picks its style and what sits at its tips.
  // Every group is generated from the table it belongs to.
  if (node) {
    flowInspector.appendChild(
      flowChoiceGroup('Shape', FLOW_SHAPES, node.type, (id) => flowShapeChip(id), (id) => {
        node.type = id;
      }),
    );
  } else {
    flowInspector.appendChild(
      flowChoiceGroup('Line', FLOW_EDGE_LINES, edge.line, (id) => flowEdgeChip(id, 'none'), (id) => {
        edge.line = id;
      }),
    );
    flowInspector.appendChild(
      flowChoiceGroup('Ends', FLOW_EDGE_ENDS, edge.toEnd, (id) => flowEdgeChip(edge.line, id), (id) => {
        edge.toEnd = id;
      }),
    );
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'flow-delete';
  remove.textContent = node ? 'Delete box' : 'Delete line';
  remove.title = 'Or press Delete';
  remove.addEventListener('click', deleteFlowSelection);
  flowInspector.appendChild(remove);
}

// One row of the inspector: a caption and a button per row of `options`, each
// drawn by `chip` and applied by `apply`.
function flowChoiceGroup(caption, options, current, chip, apply) {
  const group = document.createElement('div');
  group.className = 'flow-choices';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', caption);
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flow-choice' + (option.id === current ? ' is-current' : '');
    button.title = option.hint ? option.label + ' — ' + option.hint : option.label;
    button.setAttribute('aria-label', caption + ': ' + option.label);
    button.innerHTML = chip(option.id);
    button.addEventListener('click', () => {
      apply(option.id);
      flowGraphChanged();
    });
    if (option.hint) {
      button.addEventListener('pointerenter', () => setFlowHint(option.label + ' — ' + option.hint));
      button.addEventListener('pointerleave', restoreFlowHint);
    }
    group.appendChild(button);
  }
  return group;
}

// ---- the live preview ------------------------------------------------------

// Where the sheet differs from the page on purpose: a document marks a failed
// diagram and moves on, an editor has to say what is wrong. Mermaid's own
// message is the whole point of the pane.
function queueFlowPreview() {
  window.clearTimeout(flowPreviewTimer);
  flowPreviewTimer = window.setTimeout(drawFlowPreview, 220);
}

function drawFlowPreview() {
  if (!flowSession || !flowPreview) return;
  const graph = flowSession.graph;
  // An empty diagram is a state to be in, not an error to report.
  if (graph && !graph.nodes.length) {
    flowPreview.textContent = '';
    if (flowPreviewError) {
      flowPreviewError.hidden = true;
      flowPreviewError.textContent = '';
    }
    return;
  }
  const text = flowSession.text;
  const attempt = (flowPreviewSeq += 1);
  const id = 'leafFlowPreview' + attempt;
  loadMermaid()
    .then(async (mermaid) => {
      mermaid.initialize(mermaidRuntimeConfig());
      const { svg } = await mermaid.render(id, text);
      if (!flowSession || attempt !== flowPreviewSeq) return;
      flowPreview.innerHTML = svg;
      if (flowPreviewError) {
        flowPreviewError.hidden = true;
        flowPreviewError.textContent = '';
      }
    })
    .catch((error) => {
      if (!flowSession || attempt !== flowPreviewSeq) return;
      // Mermaid leaves the element it was drawing into behind when it throws.
      const orphan = document.getElementById('d' + id);
      if (orphan && orphan.remove) orphan.remove();
      if (!flowPreviewError) return;
      flowPreviewError.textContent = (error && error.message) || 'This diagram cannot be drawn.';
      flowPreviewError.hidden = false;
    });
}

// ---- the two ways in -------------------------------------------------------

// From the block gutter's plus: nothing exists yet, so Save writes a whole
// block through the insert row's own write path.
function openBlockFlowSheet(write) {
  collapseBlockInsertRow();
  openFlowSheet({
    title: 'New flowchart',
    text: FLOW_STARTER,
    save: (text) => write({ id: 'flow', text: '```mermaid\n' + text + '\n```' }),
  });
}

// From a diagram already in the page. The text comes from the buffer, never the
// DOM: the rendered `<pre>` holds the runtime source with the YAML front matter
// stripped out, so what it says is not what the document says.
function openMermaidBlockSheet(block) {
  const blockStart = Number(block.dataset.srcStart);
  const blockEnd = Number(block.dataset.srcEnd);
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return;
  const source = sliceSourceBytes(currentDocumentSource, blockStart, blockEnd);
  const span = fencedCodeInnerSpan(source);
  if (!span) return;
  const start = blockStart + utf8ByteLength(source.slice(0, span.from));
  const end = blockStart + utf8ByteLength(source.slice(0, span.to));
  openFlowSheet({
    title: 'Flowchart',
    text: source.slice(span.from, span.to),
    save: (text) => sendEditCommand({ command: 'editBlock', start, end, text }),
  });
}
