// The menu a right-click on the flowchart canvas opens, and what each row does to the graph. Its rows read the selection flow-pointer.js keeps.

// ---- the menu on a right-click ---------------------------------------------

// Everything the canvas can do, named, on the thing it would do it to. The gestures are faster once they are known; this is where they are learned, and the only place the less common ones (duplicate, detach, flip) live at all.
let flowMenu = null;

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
      ...flowGroupItems(graph, spot.id),
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
  return [];
}

// What a box can do about the group it is in. A group is a box around boxes and the canvas has no gesture that draws one, so this menu is the whole of it: make one, join one, leave one, or take one away. The group's own name is renamed from here too, because a cluster has no handle to double-click.
function flowGroupItems(graph, id) {
  const node = flowFindNode(graph, id);
  if (!node) return [];
  const items = [];
  // Renamed the way everything else on the canvas is: a field over the thing, here over the group's own title strip. The draw has to land first, so the field has somewhere to sit.
  const rename = (groupId) => {
    window.setTimeout(() => openFlowLabelBox('group', groupId), 160);
  };
  items.push({
    label: 'Put it in a new group',
    run: () => {
      const group = flowGroupNodes(graph, [id], 'Group');
      flowGraphChanged();
      if (group) rename(group.id);
    },
  });
  // Only the groups it could actually join: its own is not one of them, and neither is a group holding boxes from somewhere else in the nesting.
  for (const group of graph.groups || []) {
    if (group.id === node.group) continue;
    items.push({
      label: 'Move it into ' + (group.text || group.id),
      run: () => {
        flowMoveNodeToGroup(graph, id, group.id);
        flowGraphChanged();
      },
    });
  }
  if (node.group) {
    const group = flowFindGroup(graph, node.group);
    items.push({
      label: 'Take it out of ' + (group.text || node.group),
      run: () => {
        flowMoveNodeToGroup(graph, id, group ? group.parent : null);
        flowGraphChanged();
      },
    });
    items.push({ label: 'Rename the group', run: () => openFlowLabelBox('group', node.group) });
    items.push({
      label: 'Remove the group, keep the boxes',
      run: () => {
        flowUngroup(graph, node.group);
        flowGraphChanged();
      },
    });
  }
  return items;
}

function openFlowMenu(x, y, spot) {
  openFlowMenuWith(x, y, flowMenuItems(spot));
}

// `host` is what the menu hangs off and is clamped inside. The editor's own menus leave it alone and get the sheet; a diagram in the page passes `appSurface`, because the reader that holds the block scrolls and would clip it, and the full-window view passes its own overlay.
function openFlowMenuWith(x, y, items, host) {
  closeFlowMenu();
  const menu = document.createElement('div');
  menu.className = 'flow-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    // A heading is a label for the run below it, not something to click. It spans both columns of the grid — see .flow-menu-heading.
    if (item.heading) {
      const caption = document.createElement('div');
      caption.className = 'flow-menu-heading';
      caption.textContent = item.heading;
      menu.appendChild(caption);
      continue;
    }
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
  const holder = host || flowSheet;
  holder.appendChild(menu);
  // Kept inside its host: a menu opened near the right edge would otherwise hang off it.
  const sheet = holder.getBoundingClientRect();
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

// Where a connection being drawn hangs from: the + handle it left, on the side of the box mermaid drew.
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

// What shape the next box should be. A decision's answers are steps, and everything else carries on as itself — so the common chain needs no choosing.
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
  drawFlowPicker();
}

function deleteFlowSelection() {
  const graph = flowSession && flowSession.graph;
  if (!graph || !flowSelection) return;
  if (flowSelection.kind === 'node') flowDeleteNode(graph, flowSelection.id);
  // Deleting a group takes the box away, not what is in it: the boxes are the work, and there is no gesture to get them back.
  else if (flowSelection.kind === 'group') flowUngroup(graph, flowSelection.id);
  else flowDeleteEdge(graph, flowSelection.id);
  flowSelection = null;
  flowGraphChanged();
}
