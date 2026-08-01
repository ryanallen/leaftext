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
// The grammar lives in flow-model.js. Mermaid draws the canvas and places every
// box; this file measures the result and lays its handles over it.
// ---------------------------------------------------------------------------

const flowBackdrop = document.getElementById('flowBackdrop');
const flowSheet = document.getElementById('flowSheet');
const flowSheetTitle = document.getElementById('flowSheetTitle');
const flowSheetCancel = document.getElementById('flowSheetCancel');
const flowSheetSave = document.getElementById('flowSheetSave');
const flowSheetExport = document.getElementById('flowSheetExport');
const flowUndoButton = document.getElementById('flowUndo');
const flowRedoButton = document.getElementById('flowRedo');
const flowDirectionPicker = document.getElementById('flowDirection');
const flowHint = document.getElementById('flowHint');
const flowCanvas = document.getElementById('flowCanvas');
const flowZoomIn = document.getElementById('flowZoomIn');
const flowZoomOut = document.getElementById('flowZoomOut');
const flowZoomFit = document.getElementById('flowZoomFit');
const flowSplit = document.getElementById('flowSplit');
const flowInspector = document.getElementById('flowInspector');
const flowNotice = document.getElementById('flowNotice');
const flowCode = document.getElementById('flowCode');

// What the sheet is editing, for as long as it is open. `graph` is null while
// the text is something the canvas cannot model; `text` is authoritative either
// way, because it is what Save writes.
let flowSession = null;
let flowSelection = null;
let flowDrag = null;
let flowCodeTimer = 0;
// Drawing is a round trip through mermaid, so it is debounced, and whatever
// mermaid says when it refuses is what the notice shows.
let flowDrawTimer = 0;
let flowDrawError = '';
// True when mermaid drew the diagram but we could not find our boxes in it, so
// the handles are missing. Silent, otherwise, and indistinguishable from a bug.
let flowLostBoxes = false;
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
const FLOW_LOST_BOXES = 'Drawn, but the canvas can’t find its boxes to put handles on — edit it as text below.';
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
  loadFlowChips();
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
  window.clearTimeout(flowDrawTimer);
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

// The canvas moved. The graph is already the truth, so this only writes it out.
// Never parse it back: an emptied diagram does not survive the trip, and the
// canvas would be left with no graph to add to.
function flowGraphChanged() {
  if (!flowSession || !flowSession.graph) return;
  recordFlowStep();
  flowSession.text = renderFlow(flowSession.graph);
  if (flowCode) flowCode.value = flowSession.text;
  if (flowSelection && !flowSelectionStillThere()) flowSelection = null;
  redrawFlowSheet();
  flowBefore = flowSnapshot();
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
// to write: mermaid cannot draw a flowchart with nothing in it. Export is off for
// the same reason — there is no drawing to make a file out of.
function updateFlowSaveState() {
  const graph = flowSession && flowSession.graph;
  const empty = !!graph && !graph.nodes.length;
  if (flowSheetSave) {
    flowSheetSave.disabled = empty;
    flowSheetSave.title = empty ? 'Add a box before saving' : '';
  }
  if (flowSheetExport) {
    flowSheetExport.disabled = empty;
    flowSheetExport.title = empty ? 'Add a box before exporting' : 'Save this diagram as its own file';
  }
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
  const shape = node && flowShape(node.shape);
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










// A box's + handles, one per side, all meaning the next step *that way*. A chart
// has one direction, so a step asked for across the flow can only land where it
// was asked for if the chart turns — see flowBudSidesFor for who may ask.
const FLOW_BUD_SIDES = ['up', 'down', 'left', 'right'];
const FLOW_BUD_WORDS = { up: 'above', down: 'below', left: 'to the left', right: 'to the right' };
// A mermaid direction and a side of a box are the same fact, said two ways.
const FLOW_DIRECTION_WAY = { TD: 'down', TB: 'down', BT: 'up', LR: 'right', RL: 'left' };
const FLOW_WAY_DIRECTION = { down: 'TD', up: 'BT', right: 'LR', left: 'RL' };
const FLOW_OPPOSITE_WAY = { up: 'down', down: 'up', left: 'right', right: 'left' };


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


// What a + handle makes, as addFlowNode's arguments.
function flowBudRelation(graph, id, side) {
  const intent = flowBudIntent(graph.direction, side);
  const relation = intent.step === 'previous' ? { connectTo: id } : { connectFrom: id };
  if (intent.turn) relation.turn = intent.turn;
  return relation;
}



// ---- how big it is drawn ---------------------------------------------------

// A big diagram in a small window is one you pan, not one you squint at.
const FLOW_ZOOM_MIN = 0.25;
const FLOW_ZOOM_MAX = 2.5;

function setFlowZoom(next) {
  const clamped = Math.max(FLOW_ZOOM_MIN, Math.min(FLOW_ZOOM_MAX, next));
  if (Math.abs(clamped - flowZoom) < 0.001) return;
  closeFlowLabelBox(true);
  flowZoom = clamped;
  // The drawing is the same drawing, only bigger — so it is resized rather than
  // asked for again, and only the measurements have to be taken afresh.
  sizeFlowStage();
  measureFlowDiagram();
  drawFlowOverlay();
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

// ---- how much room the text gets -------------------------------------------

// The text pane is dragged to whatever width suits what you are doing: mostly
// drawing, mostly typing, or halfway. Arrow keys move it too, so it is not a
// mouse-only control. The canvas re-fits after, since its room just changed.
const FLOW_CODE_MIN = 180;

function setFlowCodeWidth(pixels) {
  if (!flowSheet) return;
  const room = flowSheet.clientWidth || 900;
  const width = Math.round(Math.max(FLOW_CODE_MIN, Math.min(room - 320, pixels)));
  flowSheet.style.setProperty('--flow-code-width', width + 'px');
  sizeFlowStage();
  measureFlowDiagram();
  drawFlowOverlay();
}

function flowCodeWidth() {
  return flowCode ? flowCode.getBoundingClientRect().width : 340;
}

if (flowSplit) {
  flowSplit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = event.clientX;
    const was = flowCodeWidth();
    const move = (moved) => setFlowCodeWidth(was - (moved.clientX - start));
    const done = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', done);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', done);
  });
  flowSplit.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setFlowCodeWidth(flowCodeWidth() + (event.key === 'ArrowLeft' ? 24 : -24));
  });
  flowSplit.addEventListener('dblclick', () => setFlowCodeWidth(340));
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

// ---- the canvas, which is mermaid's own drawing ----------------------------
//
// There is one picture in this sheet and mermaid draws it. Nothing here knows
// what a decision or a database looks like: the text goes to mermaid, its SVG
// goes on the stage, and then we measure it to find out where our boxes landed.
// Handles, rings and drop marks are an overlay on top, in stage pixels.
//
// Never draw a shape here. Two pictures of one diagram means one of them is a
// lie, and it would be this one.

// Mermaid tags each box `data-id="<the id you wrote>"` and each line
// `data-id="L_<from>_<to>_<n>"`, counting from zero per pair. Both mappings are
// exact, so nothing here is matched by guesswork.
function flowEdgeDomId(from, to, nth) {
  return 'L_' + from + '_' + to + '_' + nth;
}

// Mermaid writes a box's id as `flowchart-<the id you wrote>-<n>`, on `id`
// rather than `data-id`. Both spellings are read: which one it uses depends on
// the renderer it took, and matching neither leaves every box unclickable.
function flowNodeIdFromDom(raw, known) {
  if (!raw) return null;
  if (known.has(raw)) return raw;
  const stripped = /^flowchart-(.+)-\d+$/.exec(raw);
  return stripped && known.has(stripped[1]) ? stripped[1] : null;
}

let flowRenderSeq = 0;

function redrawFlowSheet() {
  drawFlowNotice();
  queueFlowDiagram();
  drawFlowOverlay();
  drawFlowInspector();
  updateFlowSaveState();
  updateFlowHistoryButtons();
}

function drawFlowNotice() {
  if (!flowNotice) return;
  const graph = flowSession && flowSession.graph;
  const message = !graph
    ? FLOW_UNMODELED
    : !graph.nodes.length
      ? FLOW_NOTHING_YET
      : flowDrawError || (flowLostBoxes ? FLOW_LOST_BOXES : '');
  flowNotice.hidden = !message;
  flowNotice.textContent = message || '';
  flowNotice.classList.toggle('is-error', !!graph && (!!flowDrawError || flowLostBoxes));
  if (flowCanvas) flowCanvas.classList.toggle('is-disabled', !graph);
  if (flowDirectionPicker) {
    flowDirectionPicker.disabled = !graph;
    if (graph) flowDirectionPicker.value = graph.direction === 'TB' ? 'TD' : graph.direction;
  }
  restoreFlowHint();
}

// Drawing is a round trip through mermaid, so it is debounced and the answer is
// stamped: a render that finishes after a newer one started is dropped rather
// than painted over it.
function queueFlowDiagram() {
  window.clearTimeout(flowDrawTimer);
  flowDrawTimer = window.setTimeout(drawFlowDiagram, 120);
}

function drawFlowDiagram() {
  if (!flowSession || !flowCanvas) return;
  const graph = flowSession.graph;
  const attempt = (flowRenderSeq += 1);
  if (!graph || !graph.nodes.length) {
    flowCanvas.innerHTML = '';
    flowPlaced = null;
    flowSize = null;
    flowDrawError = '';
    drawFlowNotice();
    return;
  }
  const text = flowSession.text;
  loadMermaid()
    .then(async (mermaid) => {
      mermaid.initialize(mermaidRuntimeConfig());
      const { svg } = await mermaid.render('leafFlowDraw' + attempt, text);
      if (!flowSession || attempt !== flowRenderSeq) return;
      flowDrawError = '';
      const left = flowCanvas.scrollLeft;
      const top = flowCanvas.scrollTop;
      flowCanvas.innerHTML = '<div class="flow-stage">' + svg + '<div class="flow-overlay"></div></div>';
      sizeFlowStage();
      measureFlowDiagram();
      drawFlowOverlay();
      flowCanvas.scrollLeft = left;
      flowCanvas.scrollTop = top;
      drawFlowNotice();
    })
    .catch((error) => {
      if (!flowSession || attempt !== flowRenderSeq) return;
      // Mermaid leaves the element it was drawing into behind when it throws.
      const orphan = document.getElementById('dleafFlowDraw' + attempt);
      if (orphan && orphan.remove) orphan.remove();
      flowDrawError = (error && error.message) || 'This diagram cannot be drawn.';
      drawFlowNotice();
    });
}

// Mermaid sizes its SVG to suit itself. The stage takes the diagram's own
// dimensions from the viewBox and scales them by the zoom, so one number moves
// everything and the overlay's pixels stay the diagram's pixels.
function sizeFlowStage() {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  const svg = stage && stage.querySelector('svg');
  if (!svg) return;
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const natural = box.length === 4 && box[2] > 0 ? { width: box[2], height: box[3] } : null;
  if (natural) flowSize = natural;
  if (!flowSize) return;
  const width = Math.max(1, Math.round(flowSize.width * flowZoom));
  const height = Math.max(1, Math.round(flowSize.height * flowZoom));
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.maxWidth = 'none';
  stage.style.width = width + 'px';
  stage.style.height = height + 'px';
}

// Where mermaid put everything, in pixels relative to the stage. Read off the
// drawing rather than worked out, which is the whole point of the swap.
function measureFlowDiagram() {
  const graph = flowSession && flowSession.graph;
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  const svg = stage && stage.querySelector('svg');
  if (!graph || !svg) {
    flowPlaced = null;
    return;
  }
  const origin = stage.getBoundingClientRect();
  const known = new Set(graph.nodes.map((node) => node.id));
  const nodes = [];
  // Every group carrying a `data-id`. Mermaid names a box either by the id you
  // wrote or by its own `flowchart-<id>-<n>` spelling depending on the renderer
  // it took, so both are read rather than one being assumed.
  svg.querySelectorAll('g.node, g[data-id]').forEach((group) => {
    const id = flowNodeIdFromDom(group.id, known) || flowNodeIdFromDom(group.dataset.id, known);
    if (!id) return;
    const rect = group.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    nodes.push({
      id,
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
      radius: flowDrawnRadius(group, rect),
    });
  });
  const edges = [];
  const seen = new Map();
  for (const edge of graph.edges) {
    const pair = edge.from + '_' + edge.to;
    const nth = seen.get(pair) || 0;
    seen.set(pair, nth + 1);
    const name = flowEdgeDomId(edge.from, edge.to, nth);
    const path =
      svg.querySelector('path[data-id="' + name + '"]') || svg.querySelector('path[id="' + name + '"]');
    if (!path || typeof path.getTotalLength !== 'function') continue;
    const at = (length) => {
      const point = path.getPointAtLength(length).matrixTransform(path.getScreenCTM());
      return { x: point.x - origin.left, y: point.y - origin.top };
    };
    const total = path.getTotalLength();
    edges.push({ id: edge.id, path, from: at(0), to: at(total), at: at(total / 2) });
  }
  flowPlaced = { nodes, edges };
  flowLostBoxes = graph.nodes.length && !nodes.length;
}

// A corner's radius from how far in along its diagonal the fill starts. Its own
// function because the constant is easy to get wrong and impossible to see when
// it is — the Euclidean gap, (√2 − 1), is the wrong one and misses by that
// factor. The harness holds it.
function flowCornerRadiusFrom(inset) {
  return inset / (1 - Math.SQRT1_2);
}

// How round the corners of the shape mermaid drew are, in stage pixels. Read off
// the drawing for the same reason everything else is: a table of radii here
// would be a second opinion about a shape we do not draw.
function flowDrawnRadius(group, rect) {
  // The biggest thing in the group, not the first: a node holds its label's
  // background and any decoration too, and document order does not say which
  // one is the outline. The outline is the one that covers the others.
  let outline = null;
  let widest = 0;
  group.querySelectorAll('rect, circle, ellipse, polygon, path').forEach((drawn) => {
    let box;
    try {
      box = drawn.getBBox();
    } catch (error) {
      return;
    }
    const area = box.width * box.height;
    if (area > widest) {
      widest = area;
      outline = drawn;
    }
  });
  const svg = outline && outline.ownerSVGElement;
  if (!outline || !svg || typeof outline.isPointInFill !== 'function') return 0;
  let box;
  try {
    box = outline.getBBox();
  } catch (error) {
    return 0;
  }
  const reach = Math.min(box.width, box.height) / 2;
  if (!(reach > 0)) return 0;

  // Measured, not read off an attribute: mermaid builds these with rough.js, so
  // there is no `rx` and no arc to look up. Walk in along the corner's diagonal
  // until the fill starts, which works however it chose to draw. A circular
  // corner of
  // radius r has its center at (r, r), so the fill begins at (t, t) where
  // (r − t)√2 = r — that is, t = r(1 − 1/√2), and r is t divided by it.
  const probe = svg.createSVGPoint();
  const filled = (x, y) => {
    probe.x = x;
    probe.y = y;
    try {
      return outline.isPointInFill(probe);
    } catch (error) {
      return false;
    }
  };
  if (filled(box.x + 0.5, box.y + 0.5)) return 0; // a square corner
  let inside = reach;
  let outside = 0;
  for (let step = 0; step < 14; step += 1) {
    const mid = (inside + outside) / 2;
    if (filled(box.x + mid, box.y + mid)) inside = mid;
    else outside = mid;
  }
  const radius = flowCornerRadiusFrom(inside) * flowZoom;
  // Nothing can be rounder than a pill.
  return Number.isFinite(radius) ? Math.max(0, Math.min(radius, Math.min(rect.width, rect.height) / 2)) : 0;
}

// ---- the overlay -----------------------------------------------------------

// How far the ring stands off the shape it is around.
const FLOW_RING_GAP = 8;

// Rings, + handles, line ends and drop marks. Plain elements over the drawing,
// so nothing has to be drawn twice and a selection costs no render.
function drawFlowOverlay() {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  const layer = stage && stage.querySelector('.flow-overlay');
  if (!layer) return;
  layer.textContent = '';
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowPlaced) return;
  // A line is selected by coloring mermaid's own path; there is nothing to
  // overlay on a curve we did not draw.
  for (const placed of flowPlaced.edges) {
    placed.path.classList.toggle('is-selected', !!flowSelection && flowSelection.id === placed.id);
  }
  const sides = flowBudSidesFor(graph);
  for (const box of flowPlaced.nodes) {
    const chosen = flowSelection && flowSelection.kind === 'node' && flowSelection.id === box.id;
    const tools = document.createElement('div');
    tools.className = 'flow-node-tools' + (chosen ? ' is-selected' : '');
    tools.dataset.node = box.id;
    tools.style.left = box.x - FLOW_RING_GAP + 'px';
    tools.style.top = box.y - FLOW_RING_GAP + 'px';
    tools.style.width = box.width + FLOW_RING_GAP * 2 + 'px';
    tools.style.height = box.height + FLOW_RING_GAP * 2 + 'px';
    const ring = document.createElement('div');
    ring.className = 'flow-ring';
    ring.dataset.node = box.id;
    // Nested corners, in reverse: the inner radius is the outer minus the gap,
    // so the outer is the inner plus it. A square shape still gets the gap's
    // worth of round, which is what keeps the two outlines parallel.
    ring.style.borderRadius = Math.round(box.radius + FLOW_RING_GAP) + 'px';
    tools.appendChild(ring);
    // The buds sit on the wrapper's own sides, so nothing has to be measured
    // twice and they follow the box wherever mermaid puts it.
    for (const side of sides) {
      const bud = document.createElement('button');
      bud.type = 'button';
      bud.className = 'flow-bud is-' + side;
      bud.dataset.bud = side;
      bud.dataset.node = box.id;
      bud.title = flowBudTitle(graph.direction, side);
      bud.textContent = '+';
      tools.appendChild(bud);
    }
    layer.appendChild(tools);
  }
  const chosenEdge = flowSelection && flowSelection.kind === 'edge' ? flowSelection.id : null;
  for (const placed of flowPlaced.edges) {
    if (placed.id !== chosenEdge) continue;
    for (const which of ['from', 'to']) {
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'flow-edge-end';
      grip.dataset.endpoint = which;
      grip.dataset.edge = placed.id;
      grip.title = 'Drag onto another box to move this end';
      grip.style.left = placed[which].x + 'px';
      grip.style.top = placed[which].y + 'px';
      layer.appendChild(grip);
    }
  }
}


// ---- the little pictures in the picker -------------------------------------

// A shape's button shows the shape, and mermaid draws that too — one tiny
// diagram per shape, rendered once when the sheet opens and kept for the
// session. The picker names every shape as well, so it reads before they land.
const flowChipCache = new Map();
let flowChipsAsked = false;

function flowShapeChip(id) {
  return flowChipCache.get(id) || '';
}

function loadFlowChips() {
  if (flowChipsAsked) return;
  flowChipsAsked = true;
  loadMermaid()
    .then(async (mermaid) => {
      mermaid.initialize(mermaidRuntimeConfig());
      for (const shape of FLOW_SHAPES) {
        const label = '" "';
        const body = shape.open ? shape.open + label + shape.close : '@{ shape: ' + shape.id + ', label: " " }';
        try {
          const { svg } = await mermaid.render('leafFlowChip-' + shape.id, 'flowchart LR\n  c' + body);
          flowChipCache.set(shape.id, svg.replace(/<svg /, '<svg class="flow-chip" preserveAspectRatio="xMidYMid meet" '));
        } catch (error) {
          // A shape this copy of mermaid will not draw simply has no picture.
          flowChipCache.set(shape.id, '');
        }
      }
      if (flowSession) drawFlowInspector();
    })
    .catch(() => {});
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
  const ring = found.closest('.flow-ring');
  if (ring) return { kind: 'node', id: ring.dataset.node };
  const bud = found.closest('.flow-bud');
  if (bud) return { kind: 'node', id: bud.dataset.node };
  const edge = flowEdgeUnder(found);
  if (edge) return { kind: 'edge', id: edge };
  return { kind: 'canvas', id: null };
}

// True only for the bare surface: the scroll box, the stage, the overlay, or
// mermaid's SVG root. Anything deeper is part of the drawing, and treating it as
// empty space is how a double-click on a box adds another one.
function flowPointIsBare(target) {
  if (!target || !target.closest) return false;
  if (target === flowCanvas) return true;
  if (target.classList && (target.classList.contains('flow-stage') || target.classList.contains('flow-overlay'))) {
    return true;
  }
  return target.tagName === 'svg' || target.tagName === 'SVG';
}

// A pointer position in stage pixels — the same space the measurements are in,
// so the rubber band and the drop tests need no conversion.
function flowPointAt(x, y) {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  if (!stage) return { x: 0, y: 0 };
  const rect = stage.getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

function flowPointIn(event) {
  return flowPointAt(event.clientX, event.clientY);
}

// Which of our lines a mermaid element belongs to. Mermaid names its paths from
// the two ends, so the answer comes from the measurement rather than a search.
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
  const placed = flowPlaced && flowPlaced.edges.find((edge) => edge.id === spot.id);
  if (placed) placed.path.classList.add('is-drop');
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
    const node = near('.flow-ring');
    const edge = flowEdgeUnder(target);
    // Nothing here calls preventDefault: on a pointerdown it suppresses the
    // compatibility mouse events, dblclick included, so double-clicking a shape
    // to rename it does nothing. Text selection is held off in the stylesheet.
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
      selectFlow('edge', edge);
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

    // A + handle pressed and released without travelling is a click: pick the
    // shape, and it arrives joined up on the side the handle sits.
    if (drag.kind === 'bud' && !drag.moved) {
      openFlowShapePicker(event.clientX, event.clientY, (shape) =>
        addFlowNode(shape, flowBudRelation(graph, drag.from, drag.side)),
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
        drawFlowOverlay();
        return;
      }
      const where = flowSlotAt(flowPointIn(event));
      openFlowShapePicker(event.clientX, event.clientY, (shape) =>
        addFlowNode(shape, { ...flowBudRelation(graph, drag.from, drag.side), before: where }),
      );
      return;
    }
    // A box dropped on a line goes into that line: `A --> B` becomes
    // `A --> this --> B`. This is how a step is added part-way through a chain.
    if (spot && spot.kind === 'edge') {
      const edge = flowFindEdge(graph, spot.id);
      if (edge && edge.from !== drag.from && edge.to !== drag.from) {
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
      drawFlowOverlay();
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
    // Only genuinely empty space adds a box. Anything inside mermaid's drawing
    // is part of a box or a line, and a double-click there that quietly adds a
    // third box — because the ring over it has gone missing — is exactly the
    // kind of guess this should not make.
    if (!flowPointIsBare(event.target)) return;
    // Nothing stores where a box sits, so the point decides where it lands in
    // the order rather than on the page — near enough that it appears about
    // where it was asked for.
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

// Every shape, as something to pick. Always the same order: a list that
// reshuffles itself has to be read every time.
function flowShapeChoices(make) {
  return FLOW_SHAPES_BY_LABEL.map((shape) => ({
    label: shape.label,
    chip: shape.id,
    hint: shape.hint,
    run: () => make(shape.id),
  }));
}

// Pick a shape, right where the pointer is. This is what a + handle and a
// double-click on empty space both open, so a new box is the shape you meant
// rather than the one we guessed and left you to fix.
function openFlowShapePicker(x, y, make) {
  openFlowMenuWith(x, y, flowShapeChoices(make), true);
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

// Where a connection being drawn hangs from: the + handle it left, on the side
// of the box mermaid drew.
function flowBudAnchor(id, side) {
  const box = flowPlaced && flowPlaced.nodes.find((node) => node.id === id);
  if (!box) return { x: 0, y: 0 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (side === 'up') return { x: cx, y: box.y - FLOW_RING_GAP };
  if (side === 'left') return { x: box.x - FLOW_RING_GAP, y: cy };
  if (side === 'right') return { x: box.x + box.width + FLOW_RING_GAP, y: cy };
  return { x: cx, y: box.y + box.height + FLOW_RING_GAP };
}

// What shape the next box should be. A decision's answers are steps, and
// everything else carries on as itself — so the common chain needs no choosing.
function flowNewNodeShape(graph, fromId) {
  const node = flowFindNode(graph, fromId);
  if (!node) return FLOW_SHAPES[0].id;
  // And so is whatever follows a terminal.
  if (node.shape === 'diam' || node.shape === 'stadium') return 'rect';
  return node.shape;
}

function selectFlow(kind, id) {
  flowSelection = kind ? { kind, id } : null;
  drawFlowOverlay();
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
  const tall = Math.max(20, Math.round(26 * flowZoom));
  const width = kind === 'node' ? Math.max(70, placed.width - 10) : Math.max(90, 140 * flowZoom);
  const left = kind === 'node' ? placed.x + (placed.width - width) / 2 : placed.at.x - width / 2;
  const top = (kind === 'node' ? placed.y + placed.height / 2 : placed.at.y) - tall / 2;
  field.style.left = Math.round(left) + 'px';
  field.style.top = Math.round(top) + 'px';
  field.style.width = Math.round(width) + 'px';
  field.style.height = tall + 'px';
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
    queueFlowDiagram();
  });
  label.addEventListener('change', () => flowGraphChanged());
  flowInspector.appendChild(label);

  // A box picks its shape; a line picks its style and what sits at its tips.
  // Every group is generated from the table it belongs to.
  if (node) {
    flowInspector.appendChild(
      flowChoiceGroup('Shape', FLOW_SHAPES_BY_LABEL, node.shape, (id) => flowShapeChip(id), (id) => {
        node.shape = id;
      }),
    );
  } else {
    flowInspector.appendChild(
      flowChoiceGroup('Line', FLOW_EDGE_LINES, edge.line, (id) => flowEdgeChip(id, 'none'), (id) => {
        edge.line = id;
      }),
    );
    flowInspector.appendChild(
      flowChoiceGroup('Ends', FLOW_EDGE_ENDS, edge.ends, (id) => flowEdgeChip(edge.line, id), (id) => {
        edge.ends = id;
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

// ---- taking the diagram out ------------------------------------------------

// Two files, one diagram: the mermaid text as a Markdown document of its own, or
// the drawing as a picture. Nothing here touches the document the sheet was
// opened from — an export is a file beside it, and Save is still the only thing
// that writes into the page.
//
// The drawing is always asked for again rather than lifted off the stage: what is
// on screen carries the zoom, the selection ring and our handles.
//
// **Don't add SVG.** Mermaid's SVG is a web page in an SVG's clothing — a
// stylesheet keyed to a generated id, labels that are HTML, a font list full of
// CSS keywords no font is named after — and a drawing program reads those as
// instructions it cannot follow.

// Twice life size, so a picture pasted somewhere and scaled up still reads.
const FLOW_PNG_SCALE = 2;

const FLOW_EXPORTS = [
  { id: 'md', label: 'Markdown', hint: 'The mermaid text, in a document of its own' },
  { id: 'png', label: 'PNG', hint: 'The drawing as a picture, to paste anywhere' },
];

let flowExportSeq = 0;

// The page color behind the diagram. A drawing on its own has no page to sit on,
// and a pale-ink theme on nothing is a file that looks blank.
function flowExportBackground() {
  const style = window.getComputedStyle(document.documentElement);
  return (style.getPropertyValue('--surface') || '').trim() || '#ffffff';
}

// Text as base64, through its own bytes: `btoa` takes one character per byte, so
// a label with an accent or an emoji in it has to be encoded first.
function flowBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

// The room around the drawing, so the picture is not the boxes cropped to their
// own edges. The reading view pays the same in padding.
const FLOW_EXPORT_MARGIN = 24;

// The drawing on its way to becoming pixels, and no further: a web view will only
// rasterize an SVG by loading it as an image, so one has to exist for a moment.
// It is never written to a file — see the header. `htmlLabels` off because an
// image-loaded SVG drops a `<foreignObject>`, leaving shapes with no text in them.
async function flowDrawingSvg() {
  if (!flowSession || !flowSession.text) return null;
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidRuntimeConfig({ htmlLabels: false }));
  const name = 'leafFlowExport' + (flowExportSeq += 1);
  let drawn;
  try {
    drawn = (await mermaid.render(name, flowSession.text)).svg;
  } catch (error) {
    // Mermaid leaves the element it was drawing into behind when it throws.
    const orphan = document.getElementById('d' + name);
    if (orphan && orphan.remove) orphan.remove();
    throw error;
  }
  const root = new DOMParser().parseFromString(drawn, 'image/svg+xml').documentElement;
  const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  // Anything unexpected and the drawing goes out exactly as mermaid wrote it,
  // rather than half-edited by us.
  if (root.tagName !== 'svg' || box.length !== 4 || !(box[2] > 0)) return drawn;
  // The drawing keeps its own coordinates and the view widens around it, which
  // is what puts the margin outside every box rather than moving anything.
  const left = box[0] - FLOW_EXPORT_MARGIN;
  const top = box[1] - FLOW_EXPORT_MARGIN;
  const width = box[2] + FLOW_EXPORT_MARGIN * 2;
  const height = box[3] + FLOW_EXPORT_MARGIN * 2;
  root.setAttribute('viewBox', left + ' ' + top + ' ' + width + ' ' + height);
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  root.style.maxWidth = 'none';
  const behind = root.ownerDocument.createElementNS(FLOW_SVG_NS, 'rect');
  behind.setAttribute('x', left);
  behind.setAttribute('y', top);
  behind.setAttribute('width', width);
  behind.setAttribute('height', height);
  behind.setAttribute('fill', flowExportBackground());
  root.insertBefore(behind, root.firstChild);
  return new XMLSerializer().serializeToString(root);
}

// The drawing, as pixels. The markup goes in as a data URL, which is why the
// page's img-src allows `data:`.
function flowExportPngBase64(svgText) {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * FLOW_PNG_SCALE));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * FLOW_PNG_SCALE));
      const ink = canvas.getContext('2d');
      if (!ink) {
        reject(new Error('This window cannot make a picture.'));
        return;
      }
      // Painted again here: a PNG has no transparency to fall back on once it is
      // dropped into something with a page color of its own.
      ink.fillStyle = flowExportBackground();
      ink.fillRect(0, 0, canvas.width, canvas.height);
      ink.drawImage(picture, 0, 0, canvas.width, canvas.height);
      resolve((canvas.toDataURL('image/png').split(',')[1] || '').trim());
    };
    picture.onerror = () => reject(new Error('The drawing could not be turned into a picture.'));
    picture.src = 'data:image/svg+xml;base64,' + flowBase64(svgText);
  });
}

// The host is handed finished bytes and asked only where they go: it shows the
// Save dialog, writes the file, and says how it went.
async function exportFlowDiagram(kind) {
  if (!flowSession) return;
  closeFlowLabelBox(true);
  closeFlowMenu();
  try {
    if (kind === 'md') {
      send({ command: 'exportDiagram', format: 'md', data: '```mermaid\n' + flowSession.text + '\n```\n' });
      return;
    }
    const drawing = await flowDrawingSvg();
    if (!drawing) return;
    send({ command: 'exportDiagram', format: 'png', data: await flowExportPngBase64(drawing) });
  } catch (error) {
    leafToast((error && error.message) || 'That diagram could not be exported.', 'error');
  }
}

if (flowSheetExport) {
  flowSheetExport.addEventListener('click', () => {
    const spot = flowSheetExport.getBoundingClientRect();
    openFlowMenuWith(
      spot.left,
      spot.bottom + 6,
      FLOW_EXPORTS.map((kind) => ({
        label: kind.label,
        hint: kind.hint,
        run: () => exportFlowDiagram(kind.id),
      })),
      false,
    );
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
