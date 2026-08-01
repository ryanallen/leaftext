// ---------------------------------------------------------------------------
// Where the boxes go. One pure function over the graph, so it can be swapped for
// mermaid's own dagre result later (render the text, read the node transforms
// out of the SVG) without the canvas noticing — and so that stored positions
// stay possible if they are ever wanted.
//
// Nothing here is persisted. The document holds no coordinates, which is why the
// canvas is a structure editor: you say what connects to what, and this decides
// where it lands.
// ---------------------------------------------------------------------------

const FLOW_NODE_HEIGHT = 46;
const FLOW_NODE_MIN_WIDTH = 96;
const FLOW_NODE_MAX_WIDTH = 240;
// The label is drawn at 13px in the app font; this is close enough to keep a box
// off its own text, and the text is clipped rather than trusted.
const FLOW_CHAR_WIDTH = 7.4;
const FLOW_LABEL_PADDING = 30;
// Between ranks, and between two boxes on the same rank.
const FLOW_RANK_GAP = 66;
const FLOW_SLOT_GAP = 30;
const FLOW_MARGIN = 28;

// The box the text needs, then whatever room the shape wants around it — a
// diamond and a circle hold far less of their own area than a rectangle does.
// Both numbers come from the shape's own row, so a new shape sizes itself.
function flowNodeSize(node) {
  const shape = flowShape(node.type);
  const text = String(node.text == null ? node.id : node.text);
  const longest = text.split(/<br\s*\/?>|\n/).reduce((most, part) => Math.max(most, part.length), 0);
  const wanted = longest * FLOW_CHAR_WIDTH + FLOW_LABEL_PADDING;
  let width = Math.round(Math.max(FLOW_NODE_MIN_WIDTH, Math.min(FLOW_NODE_MAX_WIDTH, wanted)) * shape.grow[0]);
  let height = Math.round(FLOW_NODE_HEIGHT * shape.grow[1]);
  if (shape.square) width = height = Math.max(width, height);
  return { width, height };
}

// How far down the flow each node sits: one past the furthest thing pointing at
// it. Relaxed rather than sorted, so a cycle costs a bounded number of passes
// and settles instead of hanging — a diagram is allowed to loop back.
function flowRanks(graph) {
  const rank = new Map();
  for (const node of graph.nodes) rank.set(node.id, 0);
  const edges = graph.edges.filter(
    (edge) => edge.fromNode !== edge.toNode && rank.has(edge.fromNode) && rank.has(edge.toNode),
  );
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let moved = false;
    for (const edge of edges) {
      const wanted = rank.get(edge.fromNode) + 1;
      if (wanted > rank.get(edge.toNode)) {
        rank.set(edge.toNode, wanted);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return rank;
}

// Where a line leaves or meets a box: the point on its outline in the direction
// of the other end. A rectangle's edge, which reads correctly for the rounded
// box too and close enough for the diamond.
function flowBoundaryPoint(box, towardX, towardY) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const scaleX = dx ? box.width / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy ? box.height / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// The graph, placed. Ranks run along the flow's direction and each rank's boxes
// are laid across it in declaration order — which is what makes dragging a node
// among its neighbors a real edit rather than scratch work.
function layoutFlow(graph) {
  const empty = { nodes: [], edges: [], width: 0, height: 0 };
  if (!graph || !graph.nodes.length) return empty;
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const rank = flowRanks(graph);
  const sizes = new Map(graph.nodes.map((node) => [node.id, flowNodeSize(node)]));
  const rows = [];
  for (const node of graph.nodes) {
    const at = rank.get(node.id) || 0;
    if (!rows[at]) rows[at] = [];
    rows[at].push(node);
  }
  // Along = down the flow, across = the width of a rank. Named for the axes
  // rather than x and y, because which is which is the direction's business.
  const alongOf = (id) => (horizontal ? sizes.get(id).width : sizes.get(id).height);
  const acrossOf = (id) => (horizontal ? sizes.get(id).height : sizes.get(id).width);
  let along = FLOW_MARGIN;
  const placed = new Map();
  let widestRow = 0;
  const rowPlans = [];
  for (const row of rows) {
    if (!row) continue;
    const breadth = row.reduce((sum, node) => sum + acrossOf(node.id), 0) + FLOW_SLOT_GAP * (row.length - 1);
    widestRow = Math.max(widestRow, breadth);
    const depth = row.reduce((most, node) => Math.max(most, alongOf(node.id)), 0);
    rowPlans.push({ row, breadth, depth, along });
    along += depth + FLOW_RANK_GAP;
  }
  const totalAlong = Math.max(0, along - FLOW_RANK_GAP) + FLOW_MARGIN;
  const totalAcross = widestRow + FLOW_MARGIN * 2;
  for (const plan of rowPlans) {
    let across = (totalAcross - plan.breadth) / 2;
    for (const node of plan.row) {
      const size = sizes.get(node.id);
      // Centered on the rank's depth, so a diamond and a box on one rank line up.
      const alongAt = plan.along + (plan.depth - alongOf(node.id)) / 2;
      placed.set(node.id, { node, size, along: alongAt, across });
      across += acrossOf(node.id) + FLOW_SLOT_GAP;
    }
  }
  const width = horizontal ? totalAlong : totalAcross;
  const height = horizontal ? totalAcross : totalAlong;
  const boxes = new Map();
  const nodes = [];
  for (const node of graph.nodes) {
    const spot = placed.get(node.id);
    if (!spot) continue;
    let x = horizontal ? spot.along : spot.across;
    let y = horizontal ? spot.across : spot.along;
    // The two backwards directions are the same layout, read from the far end.
    if (graph.direction === 'BT') y = height - y - spot.size.height;
    if (graph.direction === 'RL') x = width - x - spot.size.width;
    const box = {
      id: node.id,
      type: node.type,
      text: node.text,
      x,
      y,
      width: spot.size.width,
      height: spot.size.height,
    };
    boxes.set(node.id, box);
    nodes.push(box);
  }
  const edges = [];
  for (const edge of graph.edges) {
    const from = boxes.get(edge.fromNode);
    const to = boxes.get(edge.toNode);
    if (!from || !to) continue;
    edges.push(flowEdgeGeometry(edge, from, to, horizontal));
  }
  return { nodes, edges, width, height };
}

// One line, as two ends plus the bend between them. A node pointing at itself
// gets a loop off its side instead, which is the only shape a straight line
// cannot make.
function flowEdgeGeometry(edge, from, to, horizontal) {
  const base = { id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode, label: edge.label, toEnd: edge.toEnd };
  if (from === to) {
    const x = from.x + from.width;
    const y = from.y + from.height / 2;
    return {
      ...base,
      loop: true,
      from: { x, y: y - 8 },
      to: { x, y: y + 8 },
      control1: { x: x + 52, y: y - 34 },
      control2: { x: x + 52, y: y + 34 },
      labelAt: { x: x + 40, y },
    };
  }
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const start = flowBoundaryPoint(from, toCenter.x, toCenter.y);
  const finish = flowBoundaryPoint(to, fromCenter.x, fromCenter.y);
  // The bend leaves and arrives along the flow's axis, so a line that crosses a
  // rank reads as a curve rather than a diagonal.
  const reach = horizontal ? Math.abs(finish.x - start.x) / 2 : Math.abs(finish.y - start.y) / 2;
  const lean = Math.max(18, Math.min(70, reach));
  const control1 = horizontal
    ? { x: start.x + Math.sign(finish.x - start.x || 1) * lean, y: start.y }
    : { x: start.x, y: start.y + Math.sign(finish.y - start.y || 1) * lean };
  const control2 = horizontal
    ? { x: finish.x - Math.sign(finish.x - start.x || 1) * lean, y: finish.y }
    : { x: finish.x, y: finish.y - Math.sign(finish.y - start.y || 1) * lean };
  return {
    ...base,
    loop: false,
    from: start,
    to: finish,
    control1,
    control2,
    labelAt: { x: (start.x + finish.x) / 2, y: (start.y + finish.y) / 2 },
  };
}
