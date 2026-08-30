// ---------------------------------------------------------------------------
// The flowchart sheet: a canvas you draw in and a code pane you type mermaid into, over the page. Two views, one model — the graph is the truth while the sheet is open, text is the interchange between the panes, and mermaid is the only serialization.
//
// Nothing is written until Save, and Save is one splice: the document's undo button then puts the whole diagram back, which is what a reader means by "undo that". Cancel writes nothing.
//
// The grammar lives in flow-model.js. Mermaid draws the canvas and places every box; this file measures the result and lays its handles over it.
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
const flowPicker = document.getElementById('flowPicker');
const flowPickerHead = document.getElementById('flowPickerHead');
const flowPickerBody = document.getElementById('flowPickerBody');
const flowPickerClose = document.getElementById('flowPickerClose');
const flowNotice = document.getElementById('flowNotice');
const flowCode = document.getElementById('flowCode');

// What the sheet is editing, for as long as it is open. `graph` is null while the text is something the canvas cannot model; `text` is authoritative either way, because it is what Save writes.
let flowSession = null;
let flowCodeTimer = 0;
// Drawing is a round trip through mermaid, so it is debounced, and whatever mermaid says when it refuses is what the notice shows.
let flowDrawTimer = 0;
let flowDrawError = '';
// True when mermaid drew the diagram but we could not find our boxes in it, so the handles are missing. Silent, otherwise, and indistinguishable from a bug.
let flowLostBoxes = false;
let flowLastFocus = null;
// The drawn diagram's own size, how much of life size it is shown at, and where the last draw put everything — which is what lets a label box be placed over the shape it belongs to without measuring the page.
let flowSize = null;
let flowZoom = 1;
let flowPlaced = null;
// Steps back and forward, and the state as of the last settled point. `before` is what a change undoes to, re-taken after every change — which is how one place can record a step without every caller having to remember to.
const flowHistory = { past: [], future: [] };
let flowBefore = null;
const FLOW_HISTORY_CAP = 100;

// Why the canvas is off, for when flowRefusal cannot name the line that beat it. The diagram is still drawn and the code pane still edits it, which is why refusing costs the reader nothing.
const FLOW_UNMODELED = 'The canvas can’t model this diagram yet.';
const FLOW_AS_TEXT = ' Edit it as text below; the picture follows what you type.';
const FLOW_LOST_BOXES = 'Drawn, but the canvas can’t find its boxes to put handles on — edit it as text below.';
const FLOW_NOTHING_YET = 'Nothing here yet. Double-click anywhere to add the first box.';
const FLOW_TIP_IDLE =
  'Double-click empty space to add a box · double-click a box to rename it · right-click anything for more.';
const FLOW_TIP_NODE =
  'Its + handles add the step before or after it · drag it onto a line to put it in that line · Delete removes it.';
// The first box is the one that decides which way the whole chart runs, so it is the only one offered all four handles. After that, Flow up top turns it.
const FLOW_TIP_FIRST = 'Its four + handles start the chart running that way. After that, Flow up top turns it.';
const FLOW_TIP_EDGE = 'Drag either end onto another box to reconnect it · Delete removes it.';
// The same sentence the text pane carries, on the button that does it — the pane is easy to have scrolled past, and this is the last moment to say so.
const FLOW_SAVE_REWRITES = 'Save rewrites the whole block: one box to a line, every label quoted.';
// A Save with nowhere left to go: the page redrew while the sheet was up, so what the diagram was going to be written onto is gone and its old offsets name somebody else's words. The sheet stays open behind this, because the text pane is the only copy of a drawing that took minutes.
const FLOW_SAVE_GONE =
  'The document changed underneath this diagram, so there is nowhere left to save it. Copy the text below before closing.';
// A diagram the canvas cannot model. It is drawn, and that is all it is.
const FLOW_TIP_PREVIEW = 'Drag to move the picture · Ctrl-scroll to zoom · type below to change it.';
// What a drag is offering, said while it is still in the air. Every drop this canvas takes is one of these, so none of them has to be guessed at.
const FLOW_TIP_MOVING =
  'Drop on a line to put this box in it · on another box to move it beside that one · in a group to join it, outside to leave it.';
const FLOW_TIP_BUD = 'Let go on empty space for a new box · on another box to connect to it.';

// ---- opening and closing ---------------------------------------------------

// A Save the host might refuse: nothing is written when the command is dispatched, so the sheet holds the drawing until the answer comes back. The token this sheet is waiting on, or null — kept so a sheet closed or reopened under a Save still in the air stops waiting rather than being answered later.
let flowSaveWaiting = null;

// The token an insert row's write travels under, or none. Only an option somebody is holding something for asks to be answered — the flowchart sheet, which keeps the drawing on screen until the host's word. Everything else on that row writes and is done, and the host says its own refusal where no token came, so minting one for those would swallow that sentence into an answer no sheet is listening for.
function insertEditToken(option) {
  return option && option.answered ? nextEditToken() : undefined;
}

// Stop waiting on whatever Save was in the air. The register in dom.js is what holds the callback, so dropping it here is what keeps a sheet that has since closed from being closed again by an answer to the sheet before it.
function dropFlowSaveWait() {
  if (flowSaveWaiting !== null) leafDropEditWait(flowSaveWaiting);
  flowSaveWaiting = null;
}

// The host's answer to one Save. Held closes the sheet; nothing held leaves the drawing on screen with the reason beside it, which is the only copy of that drawing left.
function onFlowSaveAnswered(held, why) {
  flowSaveWaiting = null;
  if (held) {
    closeFlowSheet();
    return;
  }
  leafToast(why || FLOW_SAVE_GONE, 'error');
}

// `save` is handed the mermaid text and decides where it goes: the insert row writes a new block, a diagram already in the page splices its own range. It answers false where it has nowhere left to land, a number where the host now owes an answer, and true where it wrote the block itself.
function openFlowSheet({ title, text, save }) {
  if (!flowSheet || !flowBackdrop) return;
  dropFlowSaveWait();
  flowLastFocus = document.activeElement;
  flowSession = { save, text: typeof text === 'string' ? text : '', graph: null };
  flowSelection = null;
  flowZoom = 1;
  if (flowSheetTitle) flowSheetTitle.textContent = title || 'Flowchart';
  readyFlowPicker();
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
  dropFlowSaveWait();
  closeFlowMenu();
  closeFlowLabelBox(false);
  flowSession = null;
  flowSelection = null;
  flowDrag = null;
  // The picker goes with it, and without its slide: the whole editor is leaving.
  flowPickerAdd = null;
  flowPickerName = '';
  if (flowPicker) {
    // Whatever leg it was on stops here too, or a class from an entrance nobody will finish is still on it the next time the editor opens.
    cancelSheetLegs(flowPicker);
    dropSheetMotion(flowPicker);
    flowPicker.classList.remove('open');
    flowPicker.hidden = true;
  }
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
  leafFocusForKeyboard(flowLastFocus);
}

function saveFlowSheet() {
  if (!flowSession) return;
  closeFlowLabelBox(true);
  // Before the disabled check: the flush is what it reads.
  flushFlowCode();
  if (flowSheetSave && flowSheetSave.disabled) return;
  const save = flowSession.save;
  const text = flowSession.text;
  // The write reads where it goes now rather than where it went when the sheet opened, and it happens before the sheet closes: one that has nowhere left to land says so and leaves the drawing on screen.
  const answer = typeof save === 'function' ? save(text) : undefined;
  if (answer === false) {
    leafToast(FLOW_SAVE_GONE, 'error');
    return;
  }
  // A number means the write went to the host and nothing is written yet. The sheet stays up with the drawing in it until the answer to that number says which way it went.
  if (typeof answer === 'number') {
    flowSaveWaiting = leafHoldEdit(answer, onFlowSaveAnswered);
    return;
  }
  closeFlowSheet();
}

// Escape closes without writing, the same as Cancel. Delete removes what the canvas has selected, but never while something is being typed.
function onFlowSheetKey(event) {
  if (!flowSession) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    // One thing at a time: the menu goes first, then the picker if it is asking which shape to add, and the sheet only when there is nothing over it.
    if (flowMenu) {
      closeFlowMenu();
      return;
    }
    if (flowPickerAdd) {
      closeFlowAddPicker();
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

// Text typed into the code pane, or the text the sheet opened on. This is the only place the graph is re-derived: what the canvas produces is never parsed back, so an edit can never cost the canvas its graph.
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

// The canvas moved. The graph is already the truth, so this only writes it out. Never parse it back: an emptied diagram does not survive the trip, and the canvas would be left with no graph to add to.
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

// The sheet keeps its own history, because one Save is one document undo and nobody wants "undo" to mean "throw the whole diagram away". A step is the graph and the text together: restoring only the text would re-read it, and an emptied diagram does not survive that trip.
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

// An empty diagram is a legal thing to be halfway through and not a legal thing to write: mermaid cannot draw a flowchart with nothing in it. Export is off for the same reason — there is no drawing to make a file out of.
function updateFlowSaveState() {
  const graph = flowSession && flowSession.graph;
  const empty = !!graph && !graph.nodes.length;
  if (flowSheetSave) {
    flowSheetSave.disabled = empty;
    flowSheetSave.title = empty ? 'Add a box before saving' : FLOW_SAVE_REWRITES;
  }
  if (flowSheetExport) {
    flowSheetExport.disabled = empty;
    flowSheetExport.title = empty ? 'Add a box before exporting' : 'Save this diagram as its own file';
  }
}

function flowSelectionStillThere() {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowSelection) return false;
  if (flowSelection.kind === 'node') return !!flowFindNode(graph, flowSelection.id);
  if (flowSelection.kind === 'group') return !!flowFindGroup(graph, flowSelection.id);
  return !!flowFindEdge(graph, flowSelection.id);
}

// Typing waits 180ms before it is read, so anything acting on the text takes what is in the field first — otherwise Save writes the text from before the last keystroke and closes, and those characters are gone.
function flushFlowCode() {
  window.clearTimeout(flowCodeTimer);
  if (!flowSession || !flowCode || flowCode.value === flowSession.text) return;
  setFlowText(flowCode.value, 'code');
}

if (flowCode) {
  flowCode.addEventListener('input', () => {
    if (!flowSession) return;
    window.clearTimeout(flowCodeTimer);
    flowCodeTimer = window.setTimeout(() => setFlowText(flowCode.value, 'code'), 180);
  });
  flowCode.addEventListener('blur', flushFlowCode);
}
if (flowSheetCancel) flowSheetCancel.addEventListener('click', closeFlowSheet);
if (flowSheetSave) flowSheetSave.addEventListener('click', saveFlowSheet);
if (flowBackdrop) flowBackdrop.addEventListener('click', closeFlowSheet);

// ---- the line that says what things are ------------------------------------

// Fourteen shapes is more than anyone can be expected to know by their outline, so hovering one says what it is for. Each hint is a field on the shape's own row, beside the outline the button draws.
function setFlowHint(text) {
  if (flowHint) flowHint.textContent = text;
}

function restoreFlowHint() {
  const graph = flowSession && flowSession.graph;
  // No graph is a picture, not a canvas: the gestures it does answer to are the two that only move the view, and the text pane is where it changes.
  if (!graph) {
    setFlowHint(FLOW_TIP_PREVIEW);
    return;
  }
  if (!flowSelection) {
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


// One end, drawn where a marker would put it. Markers need a `defs` block and a document-unique id; a chip is one glyph, so it draws the glyph.
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

// A connector, drawn small: the line in its own style with whatever sits at each tip. Used for both the line buttons and the end buttons.
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

// The one way a box is ever made. A + handle, a double-click on empty space and the menu all come through here saying where it goes in the order and what it hangs off, so they cannot disagree about what happens next.
function addFlowNode(shapeId, options) {
  const graph = flowSession && flowSession.graph;
  if (!graph) return null;
  const { before, connectFrom, connectTo, turn, intoEdge, text } = options || {};
  // Asked for across the flow: the chart turns, so the new step lands on the side it was asked for rather than wherever the old direction would put it.
  if (turn) graph.direction = turn;
  // The name typed into the picker before a shape was chosen, if there was one. Otherwise the shape's own name, which is a placeholder to be typed over.
  const named = (text || '').trim();
  const node = flowAddNode(graph, shapeId, named || flowShape(shapeId).label);
  if (before !== undefined) flowMoveNode(graph, node.id, before);
  if (connectFrom) flowConnect(graph, connectFrom, node.id);
  if (connectTo) flowConnect(graph, node.id, connectTo);
  if (intoEdge) flowSpliceIntoEdge(graph, node.id, intoEdge);
  flowSelection = { kind: 'node', id: node.id };
  flowGraphChanged();
  // Straight into typing its name: a box called "Step" helps nobody. Already named, and there is nothing to ask.
  if (!named) openFlowLabelBox('node', node.id);
  return node;
}

// Where a point on the canvas falls in the declaration order: the id to put a new box in front of, or null for the end. Nothing stores coordinates, so this is as close as "add it here" can get — and it is close enough that a box lands near where it was asked for.
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










// A box's + handles, one per side, all meaning the next step *that way*. A chart has one direction, so a step asked for across the flow can only land where it was asked for if the chart turns — see flowBudSidesFor for who may ask.
const FLOW_BUD_SIDES = ['up', 'down', 'left', 'right'];
const FLOW_BUD_WORDS = { up: 'above', down: 'below', left: 'to the left', right: 'to the right' };
// A mermaid direction and a side of a box are the same fact, said two ways.
const FLOW_DIRECTION_WAY = { TD: 'down', TB: 'down', BT: 'up', LR: 'right', RL: 'left' };
const FLOW_WAY_DIRECTION = { down: 'TD', up: 'BT', right: 'LR', left: 'RL' };
const FLOW_OPPOSITE_WAY = { up: 'down', down: 'up', left: 'right', right: 'left' };


// What a handle does, which depends on which way the chart already runs. With the flow it is the next step; against it, the step before this one; across it, the next step and the chart turns to follow.
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

// Which sides get a handle. A chart of one box has not said which way it runs, so all four are offered and the one you take settles it. After that only the two along the flow appear: a handle that spun the whole diagram round under you would be a trap, and the Flow picker is how it turns from then on.
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
  // The drawing is the same drawing, only bigger — so it is resized rather than asked for again, and only the measurements have to be taken afresh.
  sizeFlowStage();
  measureFlowDiagram();
  drawFlowOverlay();
}

// As large as it goes without spilling, and never enlarged past life size — a three-box diagram blown up to fill the pane looks broken, not helpful.
function fitFlowCanvas() {
  if (!flowCanvas || !flowSize) return;
  setFlowPan(0, 0);
  const room = flowCanvas.clientWidth - 24;
  const tall = flowCanvas.clientHeight - 24;
  if (room <= 0 || tall <= 0) return;
  setFlowZoom(Math.min(1, room / flowSize.width, tall / flowSize.height));
}

// Where the diagram has been dragged to, in stage pixels. The layout centers the stage and this moves it from there, so a diagram that fits the pane can still be pushed out from under the picker — which scrolling could never do, there being nothing to scroll.
const flowPan = { x: 0, y: 0 };

function setFlowPan(x, y) {
  flowPan.x = x;
  flowPan.y = y;
  if (!flowCanvas) return;
  flowCanvas.style.setProperty('--flow-pan-x', Math.round(x) + 'px');
  flowCanvas.style.setProperty('--flow-pan-y', Math.round(y) + 'px');
}

// Back to the middle: the drag undone, and a diagram bigger than the pane scrolled to its own middle rather than its top-left corner.
function centerFlowCanvas() {
  if (!flowCanvas) return;
  setFlowPan(0, 0);
  flowCanvas.scrollLeft = Math.max(0, (flowCanvas.scrollWidth - flowCanvas.clientWidth) / 2);
  flowCanvas.scrollTop = Math.max(0, (flowCanvas.scrollHeight - flowCanvas.clientHeight) / 2);
}

// ---- how much room the text gets -------------------------------------------

// A width change moves the canvas, not the diagram.
const FLOW_CODE_MIN = 180;

// Dragging holds this width; keys and reset read it fresh.
function setFlowCodeWidth(pixels, held) {
  if (!flowSheet) return;
  const room = held || flowSheet.clientWidth || 900;
  const width = Math.round(Math.max(FLOW_CODE_MIN, Math.min(room - 320, pixels)));
  flowSheet.style.setProperty('--flow-code-width', width + 'px');
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
    // A held pointer cannot resize the window.
    const room = (flowSheet && flowSheet.clientWidth) || 900;
    const move = (moved) => setFlowCodeWidth(was - (moved.clientX - start), room);
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
// There is one picture in this sheet and mermaid draws it. Nothing here knows what a decision or a database looks like: the text goes to mermaid, its SVG goes on the stage, and then we measure it to find out where our boxes landed. Handles, rings and drop marks are an overlay on top, in stage pixels.
//
// Never draw a shape here. Two pictures of one diagram means one of them is a lie, and it would be this one.

// Mermaid tags each box `data-id="<the id you wrote>"` and each line `data-id="L_<from>_<to>_<n>"`, counting from zero per pair. Both mappings are exact, so nothing here is matched by guesswork.
function flowEdgeDomId(from, to, nth) {
  return 'L_' + from + '_' + to + '_' + nth;
}

// Mermaid writes a box's id as `flowchart-<the id you wrote>-<n>`, on `id` rather than `data-id`. Both spellings are read: which one it uses depends on the renderer it took, and matching neither leaves every box unclickable.
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
  drawFlowPicker();
  updateFlowSaveState();
  updateFlowHistoryButtons();
}

function drawFlowNotice() {
  if (!flowNotice) return;
  const graph = flowSession && flowSession.graph;
  // Mermaid refusing to draw it beats us refusing to model it: one is a blank pane the reader has to explain, the other is a pane full of diagram.
  const problem = flowDrawError || (graph && flowLostBoxes ? FLOW_LOST_BOXES : '');
  const message = !graph
    ? problem || (flowRefusal(flowSession ? flowSession.text : '') || FLOW_UNMODELED) + FLOW_AS_TEXT
    : !graph.nodes.length
      ? FLOW_NOTHING_YET
      : problem;
  flowNotice.hidden = !message;
  flowNotice.textContent = message || '';
  flowNotice.classList.toggle('is-error', !!problem);
  if (flowCanvas) flowCanvas.classList.toggle('is-disabled', !graph);
  if (flowDirectionPicker) {
    flowDirectionPicker.disabled = !graph;
    if (graph) flowDirectionPicker.value = graph.direction === 'TB' ? 'TD' : graph.direction;
  }
  restoreFlowHint();
}

// Drawing is a round trip through mermaid, so it is debounced and the answer is stamped: a render that finishes after a newer one started is dropped rather than painted over it.
function queueFlowDiagram() {
  window.clearTimeout(flowDrawTimer);
  flowDrawTimer = window.setTimeout(drawFlowDiagram, 120);
}

function drawFlowDiagram() {
  if (!flowSession || !flowCanvas) return;
  const graph = flowSession.graph;
  const text = flowSession.text;
  const attempt = (flowRenderSeq += 1);
  // A diagram the canvas cannot model is still drawn, from its text — a pie chart, a gantt, a flowchart using something we don't read yet. It gets no handles, but a live picture is most of what an editor is for, and the code pane is the only way to edit these. Only an empty graph draws nothing.
  if ((graph && !graph.nodes.length) || !text.trim()) {
    flowCanvas.innerHTML = '';
    flowPlaced = null;
    flowSize = null;
    flowDrawError = '';
    drawFlowNotice();
    return;
  }
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

// Mermaid sizes its SVG to suit itself. The stage takes the diagram's own dimensions from the viewBox and scales them by the zoom, so one number moves everything and the overlay's pixels stay the diagram's pixels.
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

// Where mermaid put everything, in pixels relative to the stage. Read off the drawing rather than worked out, which is the whole point of the swap.
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
  // Every group carrying a `data-id`. Mermaid names a box either by the id you wrote or by its own `flowchart-<id>-<n>` spelling depending on the renderer it took, so both are read rather than one being assumed.
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
  // The boxes around boxes. Mermaid draws each one as `g.cluster`, named the way it names a node, so the same two spellings are read — and a cluster is measured only to put a title strip on it, never a handle: the whole of what the canvas does to a group is rename it, empty it out, or take it away.
  const groups = [];
  const knownGroups = new Set((graph.groups || []).map((group) => group.id));
  svg.querySelectorAll('g.cluster').forEach((drawn) => {
    const id = flowNodeIdFromDom(drawn.id, knownGroups) || flowNodeIdFromDom(drawn.dataset.id, knownGroups);
    if (!id) return;
    const rect = drawn.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    groups.push({
      id,
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
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
  flowPlaced = { nodes, edges, groups };
  flowLostBoxes = graph.nodes.length && !nodes.length;
}

// A corner's radius from how far in along its diagonal the fill starts. Its own function because the constant is easy to get wrong and impossible to see when it is — the Euclidean gap, (√2 − 1), is the wrong one and misses by that factor. The harness holds it.
function flowCornerRadiusFrom(inset) {
  return inset / (1 - Math.SQRT1_2);
}

// The radius a corner was probed at, in the drawing's own units, held against the group it was probed off. Probing is sixteen fill tests a box and the answer cannot change while that drawing is on the stage, so a zoom step and a drag on the divider — both of which measure the whole diagram again on every move — probe nothing. A fresh render replaces the stage's markup, so the old groups become unreachable and this empties itself with them; that is the whole of its lifetime.
const flowProbedRadii = new WeakMap();

// How round the corners of the shape mermaid drew are, in stage pixels. Read off the drawing for the same reason everything else is: a table of radii here would be a second opinion about a shape we do not draw. Everything the zoom touches is here rather than in the probe, so a held radius is right at whatever size the drawing is now.
function flowDrawnRadius(group, rect) {
  let probed = flowProbedRadii.get(group);
  if (probed === undefined) {
    probed = flowProbeDrawnRadius(group);
    flowProbedRadii.set(group, probed);
  }
  const radius = probed * flowZoom;
  // Nothing can be rounder than a pill. Measured against `rect`, which is screen pixels, so this cannot be held either.
  return Number.isFinite(radius) ? Math.max(0, Math.min(radius, Math.min(rect.width, rect.height) / 2)) : 0;
}

// The probe itself, answering in the drawing's own units — nothing in here reads the zoom, which is what makes the answer worth keeping.
function flowProbeDrawnRadius(group) {
  // The biggest thing in the group, not the first: a node holds its label's background and any decoration too, and document order does not say which one is the outline. The outline is the one that covers the others.
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

  // Measured, not read off an attribute: mermaid builds these with rough.js, so there is no `rx` and no arc to look up. Walk in along the corner's diagonal until the fill starts, which works however it chose to draw. A circular corner of radius r has its center at (r, r), so the fill begins at (t, t) where (r − t)√2 = r — that is, t = r(1 − 1/√2), and r is t divided by it.
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
  return flowCornerRadiusFrom(inside);
}

// ---- the overlay -----------------------------------------------------------

// How far the ring stands off the shape it is around.
const FLOW_RING_GAP = 8;

// Rings, + handles, line ends and drop marks. Plain elements over the drawing, so nothing has to be drawn twice and a selection costs no render.
function drawFlowOverlay() {
  const stage = flowCanvas && flowCanvas.querySelector('.flow-stage');
  const layer = stage && stage.querySelector('.flow-overlay');
  if (!layer) return;
  layer.textContent = '';
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowPlaced) return;
  // A line is selected by coloring mermaid's own path; there is nothing to overlay on a curve we did not draw.
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
    const node = flowFindNode(graph, box.id);
    const ring = document.createElement('div');
    // A picture and an icon show themselves — mermaid draws them. A link shows nothing at all, so the box wears a dotted ring of its own and says where it goes: a box holding something invisible is a box nobody edits on purpose.
    ring.className = 'flow-ring' + (node && node.href ? ' is-linked' : '');
    if (node && node.href) ring.title = 'Clicking this box opens ' + node.href;
    ring.dataset.node = box.id;
    // Nested corners, in reverse: the inner radius is the outer minus the gap, so the outer is the inner plus it. A square shape still gets the gap's worth of round, which is what keeps the two outlines parallel.
    ring.style.borderRadius = Math.round(box.radius + FLOW_RING_GAP) + 'px';
    tools.appendChild(ring);
    // The buds sit on the wrapper's own sides, so nothing has to be measured twice and they follow the box wherever mermaid puts it.
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

// A shape's button shows the shape, and mermaid draws that too — one tiny diagram per shape, rendered once when the sheet opens and kept for the session. The picker names every shape as well, so it reads before they land.
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
      if (flowSession) drawFlowPicker();
    })
    .catch(() => {});
}

// ---- the two ways in -------------------------------------------------------

// From the block gutter's plus: nothing exists yet, so Save writes a whole block through the insert row's own write path. `place` is what the plus was standing on, asked again at Save — every render rebuilds the gutter, and this sheet is held open across as many of them as somebody takes to draw.
//
// `answered` is what asks the insert row for a token: this is the door where the drawing is the only copy there is, so the sheet stays up until the host says the splice landed. The row's answer goes straight out — a number to wait on, false where it found nowhere to write and sent nothing at all.
function openBlockFlowSheet(write, place) {
  collapseBlockInsertRow();
  openFlowSheet({
    title: 'New flowchart',
    text: FLOW_STARTER,
    save: (text) => {
      if (!blockInsertPlaceStanding(place)) return false;
      return write({ id: 'flow', text: '```mermaid\n' + text + '\n```', answered: true });
    },
  });
}

// From a diagram already in the page. The text comes from the buffer, never the DOM: the rendered `<pre>` holds the runtime source with the YAML front matter stripped out, so what it says is not what the document says.
function openMermaidBlockSheet(block) {
  const span = flowBlockSpan(block);
  if (!span) return;
  openFlowSheet({
    title: 'Flowchart',
    text: span.text,
    // Read again here, never kept from the open: a pause in somebody's typing moves every block's numbers as it lands, and the offsets this sheet opened on would by then name a sentence.
    save: (text) => {
      const now = flowBlockSpan(block);
      if (!now) return false;
      const token = nextEditToken();
      sendEditCommand({ command: 'editBlock', start: now.start, end: now.end, text, token });
      return token;
    },
  });
}

// Where a diagram block's own text sits in the buffer right now: the block's range, narrowed to the inside of its fences. Null once it has left the page, asked as connectedness — a block a render replaced still answers the numbers it was drawn with.
function flowBlockSpan(block) {
  if (!block || !block.isConnected) return null;
  const blockStart = Number(block.dataset.srcStart);
  const blockEnd = Number(block.dataset.srcEnd);
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
  const source = sliceSourceBytes(currentDocumentSource, blockStart, blockEnd);
  const span = fencedCodeInnerSpan(source);
  if (!span) return null;
  return {
    start: blockStart + utf8ByteLength(source.slice(0, span.from)),
    end: blockStart + utf8ByteLength(source.slice(0, span.to)),
    text: source.slice(span.from, span.to),
  };
}
