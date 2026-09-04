// The sheet that picks a shape — for a new box, and for changing one already on the flowchart canvas. Its pictures are drawn by flow-canvas.js and its choice lands on the selection flow-pointer.js keeps.

// ---- the picker: one sheet for choosing and for changing --------------------
//
// Adding a box and changing one are the same question — which shape — so they are the same sheet, in the same order, with the same headings. It slides up from the bottom of the canvas and goes back down when there is nothing selected and nothing being added.

let flowPickerReady = false;

// Pushed down and away by its grab bar like every other sheet, and pulled taller by it, which is this sheet's alone — it opens a quarter of the editor tall so the diagram stays readable, and the whole shape list is a drag away. Wired on the first open rather than at load: this fragment is served ahead of the inline script, so `makeSheetDraggable` is not there yet when it runs.
function readyFlowPicker() {
  if (flowPickerReady || !flowPicker) return;
  flowPickerReady = true;
  const grip = flowPicker.querySelector('.leaf-sheet-grip');
  if (typeof makeSheetDraggable === 'function' && grip) {
    makeSheetDraggable(flowPicker, grip, dismissFlowPicker, { tallerOnPullUp: true });
  }
  // Wrapped, not handed straight over: the dismissal reads how it was asked for off its one argument, and a listener would pass it the click.
  if (flowPickerClose) flowPickerClose.addEventListener('click', () => dismissFlowPicker());
  // On the way down, before anything has moved. Choosing a box redraws the overlay, so by the time a press has finished bubbling the ring it landed on is off the page — and a press asked about a detached element looks like a press on nothing, which put the sheet away every time somebody chose a box.
  if (flowSheet) flowSheet.addEventListener('pointerdown', pressOutsideFlowPicker, true);
}

// What keeps its own press while the sheet is up. The sheet itself, obviously. The canvas, because it already decides for itself — a press on empty space puts the sheet away and a press on a box or a + handle is the start of a gesture. And the top bar and the split bar, because zooming, undoing and widening the text pane are working the canvas with the sheet standing rather than leaving it.
const FLOW_PICKER_KEEPS_ITS_PRESS = '#flowPicker, #flowCanvas, #flowSheetHead, #flowSplit';

// A press on the dimmed editor outside the sheet puts it away, which is what every other scrim in the app promises. Read off the press rather than taken by the scrim: that scrim lies over the canvas, so one that took the pointer would take every press the diagram needs and a + handle drag would die at the press that starts it.
function pressOutsideFlowPicker(event) {
  if (!flowPicker || flowPicker.hidden || event.button !== 0) return;
  const target = event.target;
  if (target && target.closest && target.closest(FLOW_PICKER_KEEPS_ITS_PRESS)) return;
  dismissFlowPicker();
}

function openFlowAddPicker(make) {
  flowPickerAdd = make;
  flowPickerName = '';
  selectFlow(null, null);
  drawFlowPicker();
  // The field is the first thing in the sheet and the first thing to do with it: a name can be typed before the shape is chosen, or after, or not at all.
  window.setTimeout(() => {
    const field = flowPickerHead && flowPickerHead.querySelector('.flow-field');
    if (field && flowPickerAdd) field.focus();
  }, 60);
}

function closeFlowAddPicker() {
  if (!flowPickerAdd) return;
  flowPickerAdd = null;
  flowPickerName = '';
  drawFlowPicker();
}

// Nothing selected and nothing being added: the sheet has said all it has to. The one thing carried through is how it was dismissed, because a drag has already done the winding up a button press has not.
function dismissFlowPicker(options) {
  flowPickerAdd = null;
  flowPickerName = '';
  selectFlow(null, null);
  drawFlowPicker(options);
}

function drawFlowPicker(options) {
  if (!flowPicker || !flowPickerBody || !flowPickerHead) return;
  const graph = flowSession && flowSession.graph;
  const selection = flowSelection;
  flowPickerHead.textContent = '';
  // Only what the selection draws goes. The shape grid's wrapper is left standing where it is: nothing inside it changes with the selection but which one button is marked.
  for (const child of [...flowPickerBody.children]) {
    if (child !== flowShapeWrap) child.remove();
  }
  const node = graph && selection && selection.kind === 'node' ? flowFindNode(graph, selection.id) : null;
  const edge = graph && selection && selection.kind === 'edge' ? flowFindEdge(graph, selection.id) : null;
  const adding = !!flowPickerAdd && !!graph;
  if (!node && !edge && !adding) {
    // The shared close owns the wait: it hides the sheet only once the leg that takes it off screen has finished.
    closeSheet(flowPicker, flowPickerBackdrop, options);
    return;
  }
  // Pushed part-way down to see the diagram behind it, the sheet stays there while it is open — picking a second box does not shove it back up. It comes back flush only when it has been away and returns, which is the entrance the shared open runs.
  openSheet(flowPicker, flowPickerBackdrop, { keepParked: true });

  // Every field the selection has, in one form at the top of the sheet: the name of the thing, then — for a box — where clicking it goes, the icon on it and the picture in it. One field up here and three buried in the scrolling shape list is why the last three went unfound.
  const form = document.createElement('div');
  form.className = 'flow-form';
  form.appendChild(
    flowPickerRow(
      adding || node ? 'Name' : 'Label',
      adding ? flowPickerNameField() : flowPickerField(graph, node, edge)
    )
  );
  if (node) for (const extra of FLOW_NODE_EXTRAS) form.appendChild(flowPickerRow(extra.label, flowPickerExtraField(graph, node, extra)));
  flowPickerHead.appendChild(form);

  // A box picks its shape; a line picks its style and what sits at its tips. Every group is generated from the table it belongs to.
  if (adding || node) {
    // Written again on every draw, and asked for as the button is pressed. A held button cannot carry the closure a redraw made, and one that did would put the shape on the box that was selected two clicks ago.
    flowShapePress = adding
      ? (id) => {
          const make = flowPickerAdd;
          const named = flowPickerName;
          flowPickerAdd = null;
          flowPickerName = '';
          if (make) make(id, named);
        }
      : (id) => {
          node.shape = id;
          flowGraphChanged();
        };
    flowShapeGridStands();
    markFlowShape(node ? node.shape : null);
  } else {
    // A line has two grids of its own, so the shape grid collapses to nothing until a box is picked again.
    flowShapePress = null;
    flowShapeGridStandsDown();
    // An invisible line is the one style that takes no ends — mermaid spells it `~~~` and nothing else. Picking it drops the ends; picking an end back makes the line solid again, rather than offering a spelling that is not.
    flowPickerChoices('Line', FLOW_EDGE_LINES, edge.line, (id) => flowEdgeChip(id, 'none'), (id) => {
      edge.line = id;
      if (flowEdgeLine(id).only) edge.ends = flowEdgeLine(id).only;
      flowGraphChanged();
    });
    flowPickerChoices('Ends', FLOW_EDGE_ENDS, edge.ends, (id) => flowEdgeChip(edge.line, id), (id) => {
      edge.ends = id;
      const line = flowEdgeLine(edge.line);
      if (line.only && line.only !== id) edge.line = FLOW_EDGE_LINES[0].id;
      flowGraphChanged();
    });
  }

  if (!node && !edge) return;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'flow-delete';
  remove.textContent = node ? 'Delete box' : 'Delete line';
  remove.title = 'Or press Delete';
  remove.addEventListener('click', deleteFlowSelection);
  flowPickerBody.appendChild(remove);
}

// The name for the box about to be added. It is held here rather than on a box that does not exist yet, and picking a shape does not touch it: someone who typed "Read the file" and then chose a cylinder meant both.
function flowPickerNameField() {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'flow-field';
  field.spellcheck = false;
  field.placeholder = 'Name this box, then pick its shape';
  field.value = flowPickerName;
  field.setAttribute('aria-label', 'Name this box');
  field.addEventListener('input', () => {
    flowPickerName = field.value;
  });
  return field;
}

// The name of the selected box, or the label on the selected line.
function flowPickerField(graph, node, edge) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'flow-field';
  field.spellcheck = false;
  field.placeholder = node ? 'Name this box' : 'Label this line';
  field.value = (node ? node.text : edge.label) || '';
  field.setAttribute('aria-label', node ? 'Box name' : 'Line label');
  field.addEventListener('input', () => {
    if (node) node.text = field.value;
    else edge.label = field.value.trim() || null;
    // The text and the preview follow every keystroke; redrawing the canvas under the caret would take the focus out of the field being typed in.
    flowSession.text = renderFlow(graph);
    if (flowCode) flowCode.value = flowSession.text;
    queueFlowDiagram();
  });
  field.addEventListener('change', () => flowGraphChanged());
  return field;
}

// The three things a box can carry that are not its shape. `key` is the field on the box and the key mermaid writes, so there is one name for each of them.
const FLOW_NODE_EXTRAS = [
  { key: 'href', label: 'Link', placeholder: 'Where clicking this box goes' },
  { key: 'icon', label: 'Icon', placeholder: 'leaf:back' },
  { key: 'img', label: 'Picture', placeholder: 'A picture beside this document, or its address' },
];

// One field and the word for it beside it. Every field in the sheet is one of these, so the four read as a form rather than as a box at the top and three under shouting captions further down.
function flowPickerRow(label, field) {
  const row = document.createElement('label');
  row.className = 'flow-form-row';
  const caption = document.createElement('span');
  caption.className = 'flow-form-label';
  caption.textContent = label;
  row.appendChild(caption);
  row.appendChild(field);
  return row;
}

// Typed, not picked: a link and a picture are addresses, and an icon is one of fifty-seven names — none of them a short row of chips.
function flowPickerExtraField(graph, node, extra) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'flow-field';
  field.spellcheck = false;
  field.placeholder = extra.placeholder;
  field.value = node[extra.key] || '';
  field.setAttribute('aria-label', extra.label);
  field.addEventListener('input', () => {
    node[extra.key] = field.value.trim() || null;
    // Emptying the link takes its tooltip with it, or a link typed back in would arrive wearing words somebody wrote for a different destination.
    if (extra.key === 'href' && !node.href) node.hrefTip = null;
    flowSession.text = renderFlow(graph);
    if (flowCode) flowCode.value = flowSession.text;
    queueFlowDiagram();
  });
  field.addEventListener('change', () => flowGraphChanged());
  return field;
}

// One heading and the run of choices under it, each drawn by `chip` and applied by `apply`. A choice wears the right-click menu's own row class so it reads like one, and that is all the two share: the menu builds its own rows and never carries a shape. Only the line and its ends are drawn this way: their pictures come from the style the selected line carries, so they really do change with the selection.
function flowPickerChoices(caption, options, current, chip, apply) {
  if (!options.length) return;
  flowPickerPlace(flowPickerHeading(caption));
  for (const option of options) {
    const button = flowPickerChoice(caption, option, chip(option.id), apply);
    if (option.id === current) button.classList.add('is-current');
    flowPickerPlace(button);
  }
}

function flowPickerHeading(caption) {
  const heading = document.createElement('div');
  heading.className = 'flow-menu-heading';
  heading.textContent = caption;
  return heading;
}

function flowPickerChoice(caption, option, chip, apply) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'flow-menu-item';
  button.title = option.hint ? option.label + ' — ' + option.hint : option.label;
  button.setAttribute('aria-label', caption + ': ' + option.label);
  button.innerHTML = chip;
  const text = document.createElement('span');
  text.textContent = option.label;
  button.appendChild(text);
  button.addEventListener('click', () => apply(option.id));
  if (option.hint) {
    button.addEventListener('pointerenter', () => setFlowHint(option.label + ' — ' + option.hint));
    button.addEventListener('pointerleave', restoreFlowHint);
  }
  return button;
}

// Where a part drawn from the selection goes: in front of the shape grid's wrapper, which stands in the body whether it is showing its buttons or collapsed, so the fields and the two line grids are always ahead of it. The delete button is the one thing appended past it.
function flowPickerPlace(element) {
  if (flowShapeWrap && flowShapeWrap.parentElement === flowPickerBody) flowPickerBody.insertBefore(element, flowShapeWrap);
  else flowPickerBody.appendChild(element);
}

// ---- the shape grid, built once --------------------------------------------
//
// Eight headings and forty-seven buttons, each with a whole SVG parsed into it. None of it depends on the selection: the shape table, the families and the pictures are fixed for the life of the app, and the only per-selection fact in the grid is which one button wears `is-current`. Rebuilding it on every redraw cost a click from box to box 13.2ms of a 16.7ms frame; leaving it standing costs 0.7ms. It never leaves the body either, because putting it back is a fresh layout of the lot — a click from a line onto a box was 8.0ms, and 1.3ms once the wrapper below merely collapses.
//
// Held here rather than in state.js because this fragment is the only thing that touches it. flow-canvas.js reaches the throwaway below by name, and a function declaration is there whichever way round the two fragments are served.
let flowShapeGrid = null;
let flowShapeWrap = null;
let flowShapeButtons = null;
let flowShapeMarked = null;
let flowShapePress = null;

// Building the buttons and placing them in the body are two jobs, because only the second has somebody's click behind it: building costs 4.4ms, so it is asked for when the pictures land and a draw that finds one prepared merely places it.
function flowShapeGridPrepared() {
  if (flowShapeGrid) return;
  flowShapeGrid = [];
  flowShapeButtons = new Map();
  // One wrapper around the lot, laid out as the same two columns the body is, so a button comes back at the x and the width it had loose in the body. It is what lets the grid stay in the page and merely collapse: fifty-five elements taken out and put back are a fresh layout of forty-seven SVGs, which is 8.0ms of a click from a line onto a box against 1.3ms.
  flowShapeWrap = document.createElement('div');
  flowShapeWrap.className = 'flow-shape-grid';
  for (const family of flowShapeFamilies()) {
    if (!family.shapes.length) continue;
    flowShapeGrid.push(flowPickerHeading(family.name));
    for (const shape of family.shapes) {
      const button = flowPickerChoice(family.name, shape, flowShapeChip(shape.id), (id) => {
        if (flowShapePress) flowShapePress(id);
      });
      button.tabIndex = 0;
      flowShapeButtons.set(shape.id, button);
      flowShapeGrid.push(button);
    }
  }
  for (const element of flowShapeGrid) flowShapeWrap.appendChild(element);
  flowShapeMarked = null;
}

function flowShapeGridStands() {
  // The fallback for a copy the pictures never reached, so one whose mermaid load failed shows a sheet full of named shapes rather than an empty one.
  flowShapeGridPrepared();
  if (flowShapeWrap.parentElement !== flowPickerBody) flowPickerBody.appendChild(flowShapeWrap);
  if (!flowShapeWrap.classList.contains('is-collapsed')) return;
  flowShapeWrap.classList.remove('is-collapsed');
  flowShapeWrap.removeAttribute('aria-hidden');
  for (const button of flowShapeButtons.values()) button.tabIndex = 0;
}

// Collapsed to nothing, never emptied. A height of zero keeps every button's layout box, so coming back is a height change rather than a fresh layout of forty-seven SVGs: 1.3ms against 8.0. `display: none` is not an alternative — on the wrapper it reads 4.9ms and on the buttons 5.6ms, because it throws the boxes away exactly the way removing them does. A collapsed grid is still forty-seven buttons a Tab out of the line rows could walk into, and still forty-seven things a screen reader could read. `inert` is the word for what it is and the wrong thing to write: toggling it invalidates the whole subtree and hands back the 5ms the collapse just saved. Saying the same thing the long way costs nothing.
function flowShapeGridStandsDown() {
  if (!flowShapeWrap || flowShapeWrap.classList.contains('is-collapsed')) return;
  flowShapeWrap.classList.add('is-collapsed');
  flowShapeWrap.setAttribute('aria-hidden', 'true');
  for (const button of flowShapeButtons.values()) button.tabIndex = -1;
}

// The mark moves rather than being written into forty-seven class strings.
function markFlowShape(id) {
  const button = (id && flowShapeButtons && flowShapeButtons.get(id)) || null;
  if (flowShapeMarked === button) return;
  if (flowShapeMarked) flowShapeMarked.classList.remove('is-current');
  if (button) button.classList.add('is-current');
  flowShapeMarked = button;
}

// The first grid of a session is built before mermaid has drawn one picture, so every button in it is empty. It is thrown away the moment the pictures land; held instead, it would keep forty-seven blank buttons for the rest of the session.
function forgetFlowShapeGrid() {
  if (flowShapeWrap) flowShapeWrap.remove();
  flowShapeWrap = null;
  flowShapeGrid = null;
  flowShapeButtons = null;
  flowShapeMarked = null;
}
