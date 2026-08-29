// The sheet that picks a shape — for a new box, and for changing one already on the flowchart canvas. Its pictures are drawn by flow-canvas.js and its choice lands on the selection flow-pointer.js keeps.

// ---- the picker: one sheet for choosing and for changing --------------------
//
// Adding a box and changing one are the same question — which shape — so they are the same sheet, in the same order, with the same headings. It slides up from the bottom of the canvas and goes back down when there is nothing selected and nothing being added.

let flowPickerReady = false;

// Pushed down and away by its grab bar, like every other sheet. Wired on the first open rather than at load: this fragment is served ahead of the inline script, so `makeSheetDraggable` is not there yet when it runs.
function readyFlowPicker() {
  if (flowPickerReady || !flowPicker) return;
  flowPickerReady = true;
  const grip = flowPicker.querySelector('.leaf-sheet-grip');
  if (typeof makeSheetDraggable === 'function' && grip) {
    makeSheetDraggable(flowPicker, grip, dismissFlowPicker);
  }
  // Wrapped, not handed straight over: the dismissal reads how it was asked for off its one argument, and a listener would pass it the click.
  if (flowPickerClose) flowPickerClose.addEventListener('click', () => dismissFlowPicker());
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
  flowPickerBody.textContent = '';
  const node = graph && selection && selection.kind === 'node' ? flowFindNode(graph, selection.id) : null;
  const edge = graph && selection && selection.kind === 'edge' ? flowFindEdge(graph, selection.id) : null;
  const adding = !!flowPickerAdd && !!graph;
  if (!node && !edge && !adding) {
    // The shared close owns the wait: it hides the sheet only once the leg that takes it off screen has finished.
    closeSheet(flowPicker, null, options);
    return;
  }
  // Pushed part-way down to see the diagram behind it, the sheet stays there while it is open — picking a second box does not shove it back up. It comes back flush only when it has been away and returns, which is the entrance the shared open runs.
  openSheet(flowPicker, null, { keepParked: true });

  flowPickerHead.appendChild(adding ? flowPickerNameField() : flowPickerField(graph, node, edge));

  // A box picks its shape; a line picks its style and what sits at its tips. Every group is generated from the table it belongs to.
  if (adding) {
    const make = flowPickerAdd;
    for (const family of flowShapeFamilies()) {
      flowPickerChoices(family.name, family.shapes, null, (id) => flowShapeChip(id), (id) => {
        const named = flowPickerName;
        flowPickerAdd = null;
        flowPickerName = '';
        make(id, named);
      });
    }
  } else if (node) {
    for (const extra of FLOW_NODE_EXTRAS) flowPickerExtraField(graph, node, extra);
    for (const family of flowShapeFamilies()) {
      flowPickerChoices(family.name, family.shapes, node.shape, (id) => flowShapeChip(id), (id) => {
        node.shape = id;
        flowGraphChanged();
      });
    }
  } else {
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

// Typed, not picked: a link and a picture are addresses, and an icon is one of fifty-seven names — none of them a short row of chips.
function flowPickerExtraField(graph, node, extra) {
  const heading = document.createElement('div');
  heading.className = 'flow-menu-heading';
  heading.textContent = extra.label;
  flowPickerBody.appendChild(heading);
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
  flowPickerBody.appendChild(field);
}

// One heading and the run of choices under it, each drawn by `chip` and applied by `apply`. The same rows the right-click menu is built from, so a shape reads the same wherever it is offered.
function flowPickerChoices(caption, options, current, chip, apply) {
  if (!options.length) return;
  const heading = document.createElement('div');
  heading.className = 'flow-menu-heading';
  heading.textContent = caption;
  flowPickerBody.appendChild(heading);
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flow-menu-item' + (option.id === current ? ' is-current' : '');
    button.title = option.hint ? option.label + ' — ' + option.hint : option.label;
    button.setAttribute('aria-label', caption + ': ' + option.label);
    button.innerHTML = chip(option.id);
    const text = document.createElement('span');
    text.textContent = option.label;
    button.appendChild(text);
    button.addEventListener('click', () => apply(option.id));
    if (option.hint) {
      button.addEventListener('pointerenter', () => setFlowHint(option.label + ' — ' + option.hint));
      button.addEventListener('pointerleave', restoreFlowHint);
    }
    flowPickerBody.appendChild(button);
  }
}
