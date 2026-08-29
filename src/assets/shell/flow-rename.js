// Typing a new name onto a box or a line, in place on the flowchart canvas. Opened by the double-click in flow-pointer.js and by the menu row in flow-menu.js.

// ---- renaming on the canvas ------------------------------------------------

// The box being typed into on the canvas, if any.
let flowLabelBox = null;

// A field over the thing it renames, rather than a trip to the strip at the bottom of the pane. Placed from the layout, so nothing has to be measured.
function openFlowLabelBox(kind, id) {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowPlaced) return;
  closeFlowLabelBox(true);
  const stage = flowCanvas.querySelector('.flow-stage');
  if (!stage) return;
  const find = {
    node: () => flowFindNode(graph, id),
    edge: () => flowFindEdge(graph, id),
    group: () => flowFindGroup(graph, id),
  };
  const where = {
    node: () => flowPlaced.nodes.find((entry) => entry.id === id),
    edge: () => flowPlaced.edges.find((entry) => entry.id === id),
    group: () => (flowPlaced.groups || []).find((entry) => entry.id === id),
  };
  const subject = find[kind] && find[kind]();
  const placed = where[kind] && where[kind]();
  if (!subject || !placed) return;
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'flow-label-box';
  field.spellcheck = false;
  field.value = (kind === 'edge' ? subject.label : subject.text) || '';
  field.placeholder =
    kind === 'node' ? 'Name this box' : kind === 'group' ? 'Name this group' : 'Label this line';
  field.setAttribute('aria-label', field.placeholder);
  const tall = Math.max(20, Math.round(26 * flowZoom));
  const width =
    kind === 'edge' ? Math.max(90, 140 * flowZoom) : Math.max(70, placed.width - 10);
  const left = kind === 'edge' ? placed.at.x - width / 2 : placed.x + (placed.width - width) / 2;
  // A group's name is drawn along its top edge, so that is where the field goes — over the title, not over the boxes it holds.
  const middle =
    kind === 'edge' ? placed.at.y : kind === 'group' ? placed.y + tall / 2 + 2 : placed.y + placed.height / 2;
  const top = middle - tall / 2;
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

// `keep` writes what was typed. Redrawing only happens when it changed, so clicking away from a field nobody edited does not rebuild the surface.
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
  } else if (box.kind === 'group') {
    const group = flowFindGroup(graph, box.id);
    if (!group) return;
    group.text = value.trim() || group.id;
  } else {
    const edge = flowFindEdge(graph, box.id);
    if (!edge) return;
    edge.label = value.trim() || null;
  }
  flowGraphChanged();
}
