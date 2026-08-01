// ---------------------------------------------------------------------------
// The flowchart grammar and the graph behind it. No DOM here, not one selector:
// this is the half check-shell.mjs can run in Node.
//
// One table. FLOW_SHAPES, and FLOW_EDGE_LINES against FLOW_EDGE_ENDS, are read
// in both directions — parseFlow matches what they spell, renderFlow writes it,
// and the sheet's palette is generated from them. So a shape the parser cannot
// read can never be offered, and a new one is one row.
//
// A node has an `id`, a `shape` and its `text`; an edge runs `from` one to
// another, with a `line` style and a pair of `ends`. Mermaid's subject matter,
// said plainly — don't borrow another format's field names for it.
//
// Fail closed. parseFlow returns null on anything it does not fully understand,
// never a partial graph: a canvas that quietly drops the half it didn't read
// turns "I tidied my diagram" into lost work. Subgraphs, classes, styles,
// clicks and typed `@{}` shapes are refused by that rule alone, because nothing
// here matches them.
// ---------------------------------------------------------------------------

// The shapes, keyed by the name mermaid knows each one by — the id is what gets
// written into the file. A row says what a shape is called, what it is for, and
// how it is spelled. Nothing here says what one looks like: mermaid draws the
// canvas, so a second drawing of the same shape could only ever be a second
// drawing that was wrong.
const FLOW_SHAPES = [
  { id: 'rect', label: 'Process', hint: 'A step: something that happens.', open: '[', close: ']' },
  { id: 'rounded', label: 'Event', hint: 'A step, drawn softer. Same meaning as a process.', open: '(', close: ')' },
  { id: 'stadium', label: 'Terminal', hint: 'Where the flow starts, and where it stops.', open: '([', close: '])' },
  { id: 'fr-rect', label: 'Subprocess', hint: 'A step spelled out somewhere else.', open: '[[', close: ']]' },
  { id: 'cyl', label: 'Database', hint: 'Data being stored or read.', open: '[(', close: ')]' },
  { id: 'circle', label: 'Circle', hint: 'A jump: the flow carries on at the matching circle.', open: '((', close: '))' },
  { id: 'dbl-circ', label: 'Double circle', hint: 'The end of the whole flow.', open: '(((', close: ')))' },
  { id: 'diam', label: 'Decision', hint: 'A question, with a labeled line out for each answer.', open: '{', close: '}' },
  { id: 'hex', label: 'Preparation', hint: 'Setting something up before the next step.', open: '{{', close: '}}' },
  { id: 'lean-r', label: 'Input', hint: 'Something going in.', open: '[/', close: '/]' },
  { id: 'lean-l', label: 'Output', hint: 'Something coming out.', open: '[\\', close: '\\]' },
  { id: 'trap-b', label: 'Manual operation', hint: 'A step done by hand.', open: '[/', close: '\\]' },
  { id: 'trap-t', label: 'Manual input', hint: 'Something typed in by hand.', open: '[\\', close: '/]' },
  { id: 'odd', label: 'Flag', hint: 'A note pinned to the flow.', open: '>', close: ']' },
];

// A shape's opener does not always decide which shape it is — `[/x/]` and
// `[/x\]` open the same way — so the longest opener is tried first and the
// closer settles it. See takeFlowNode.
const FLOW_SHAPES_BY_OPENER = FLOW_SHAPES.slice().sort((a, b) => b.open.length - a.open.length);

// The order every list of shapes is shown in. Alphabetical, so a shape sits
// where you last saw it; the table above keeps the order the parser wants.
const FLOW_SHAPES_BY_LABEL = FLOW_SHAPES.slice().sort((a, b) => a.label.localeCompare(b.label));

// The catalog behind a function: a `const` in the shell script is not reachable
// from check-shell.mjs and a function is.
function flowShapeCatalog() {
  return FLOW_SHAPES;
}

// A connector is a line style and a pair of ends, and mermaid spells it as the
// product of the two — so these are two tables, not one of twenty-one rows.
// A token is `head + body + tail`; the labeled form mermaid also takes is
// `head + labelOpen + text + labelBody + tail`. Everything below falls out:
//
//   solid  --- --> --o --x <--> o--o x--x        -- text -->
//   dotted -.- -.-> -.-o -.-x <-.-> o-.-o x-.-x  -. text .->
//   thick  === ==> ==o ==x <==> o==o x==x        == text ==>
const FLOW_EDGE_LINES = [
  { id: 'solid', label: 'Solid', body: '--', plainTail: '-', labelOpen: '--', labelBody: '--' },
  { id: 'dotted', label: 'Dotted', body: '-.-', plainTail: '', labelOpen: '-.', labelBody: '.-' },
  { id: 'thick', label: 'Thick', body: '==', plainTail: '=', labelOpen: '==', labelBody: '==' },
];

// One row covers both ends because mermaid only spells the symmetric pairs:
// there is no way to write a circle at one end and a cross at the other.
const FLOW_EDGE_ENDS = [
  { id: 'arrow', label: 'Arrow', head: '', tail: '>' },
  { id: 'none', label: 'Plain', head: '', tail: '' },
  { id: 'circle', label: 'Circle', head: '', tail: 'o' },
  { id: 'cross', label: 'Cross', head: '', tail: 'x' },
  { id: 'both', label: 'Both ways', head: '<', tail: '>' },
  { id: 'both-circle', label: 'Circles', head: 'o', tail: 'o' },
  { id: 'both-cross', label: 'Crosses', head: 'x', tail: 'x' },
];

// The end that is drawn at each tip, from how it is spelled. One place, so the
// canvas cannot disagree with the grammar about what `o--x` would even mean.
function flowEndMark(mark) {
  if (mark === '>' || mark === '<') return 'arrow';
  if (mark === 'o') return 'circle';
  if (mark === 'x') return 'cross';
  return null;
}

function flowEdgeToken(line, end) {
  return end.head + line.body + (end.tail || line.plainTail);
}

// Every spelling, generated once and matched longest first — `-.->` must be
// tried before `-.-`, or a dotted arrow reads as a dotted line with a stray `>`.
const FLOW_EDGE_TOKENS = [];
for (const line of FLOW_EDGE_LINES) {
  for (const end of FLOW_EDGE_ENDS) {
    FLOW_EDGE_TOKENS.push({ token: flowEdgeToken(line, end), line: line.id, ends: end.id });
  }
}
FLOW_EDGE_TOKENS.sort((a, b) => b.token.length - a.token.length);

// The same product again, for the form that carries its label between the
// dashes. Parsed but never written: the canvas writes `|"label"|`, which every
// line style takes. The label may not hold the characters a closer starts with,
// or `A ----> B` would read as a labeled arrow.
const FLOW_EDGE_LABELED = [];
for (const line of FLOW_EDGE_LINES) {
  for (const end of FLOW_EDGE_ENDS) {
    const open = end.head + line.labelOpen;
    const close = line.labelBody + (end.tail || line.plainTail);
    FLOW_EDGE_LABELED.push({
      re: new RegExp('^' + flowEscapeRe(open) + '[ \\t]*([^-<>|=\\n]+?)[ \\t]*' + flowEscapeRe(close)),
      weight: open.length * 10 + close.length,
      line: line.id,
      ends: end.id,
    });
  }
}
FLOW_EDGE_LABELED.sort((a, b) => b.weight - a.weight);

function flowEscapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FLOW_DIRECTIONS = [
  { id: 'TD', label: 'Top down' },
  { id: 'LR', label: 'Left to right' },
  { id: 'BT', label: 'Bottom up' },
  { id: 'RL', label: 'Right to left' },
];

// `graph` is the older keyword for the same diagram; both parse, and we always
// write `flowchart`. TB is TD under another name — kept on read, never written.
const FLOW_HEADER_RE = /^[ \t]*(?:flowchart|graph)(?:[ \t]+(TD|TB|BT|LR|RL))?[ \t]*$/i;
// A comment, and the accessibility lines. Neither attaches to anything
// structural, so both ride through a save untouched.
const FLOW_COMMENT_RE = /^[ \t]*%%/;
const FLOW_ACC_RE = /^[ \t]*acc(?:Title|Descr)[ \t]*:/;
// Deliberately narrow: a hyphen in an id cannot be told from the start of an
// arrow without lookahead nobody should have to read. An id we won't parse just
// refuses the canvas, and the code pane still works on it.
const FLOW_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.]*/;
const FLOW_INDENT = '    ';
// Mermaid's escape for a quote inside a quoted label — the one entity we both
// read and write, so a label with a quote in it survives the round trip.
const FLOW_QUOTE_ENTITY = '#quot;';

// What the insert row opens on: one node, so the canvas has something to work
// from. Written the way renderFlow writes, so it round-trips like the rest.
const FLOW_STARTER = 'flowchart TD\n' + FLOW_INDENT + 'n1(["Start"])';

function flowShape(id) {
  return FLOW_SHAPES.find((shape) => shape.id === id) || FLOW_SHAPES[0];
}

function flowEdgeLine(id) {
  return FLOW_EDGE_LINES.find((line) => line.id === id) || FLOW_EDGE_LINES[0];
}

function flowEdgeEnd(id) {
  return FLOW_EDGE_ENDS.find((end) => end.id === id) || FLOW_EDGE_ENDS[0];
}

function decodeFlowLabel(raw) {
  return String(raw).split(FLOW_QUOTE_ENTITY).join('"');
}

function encodeFlowLabel(text) {
  return String(text == null ? '' : text).split('"').join(FLOW_QUOTE_ENTITY);
}

// An unquoted label. The exclusions are not fussiness: every one of these
// characters is a shape or an edge we do not model yet, and reading `A[/x/]` as
// a rectangle labeled "/x/" would silently turn a parallelogram into a box.
function flowBareLabelOk(raw) {
  const text = raw.trim();
  if (!text) return false;
  if (/[[\]{}()<>"'|;#&`]/.test(text)) return false;
  if (/^[/\\]/.test(text) || /[/\\]$/.test(text)) return false;
  return true;
}

// The label inside a shape's brackets, up to `close`. Quoted or bare; a
// backtick means a markdown string, which is phase 5.
function takeFlowLabel(rest, close) {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return null;
    const raw = rest.slice(1, end);
    if (raw.includes('`')) return null;
    if (!rest.slice(end + 1).startsWith(close)) return null;
    return { text: decodeFlowLabel(raw), rest: rest.slice(end + 1 + close.length) };
  }
  const end = rest.indexOf(close);
  if (end < 0) return null;
  const raw = rest.slice(0, end);
  if (!flowBareLabelOk(raw)) return null;
  return { text: raw.trim(), rest: rest.slice(end + close.length) };
}

// One node, declared with a shape (`A["text"]`) or just named (`A`); a named-only
// node carries neither shape nor text and the caller supplies both. An opener
// that leads nowhere is stepped over rather than refused, since several are
// shared — its brackets are then still in `rest`, no connector matches them, and
// the statement fails anyway.
function takeFlowNode(rest) {
  const id = FLOW_ID_RE.exec(rest);
  if (!id) return null;
  const after = rest.slice(id[0].length);
  for (const shape of FLOW_SHAPES_BY_OPENER) {
    if (!after.startsWith(shape.open)) continue;
    const label = takeFlowLabel(after.slice(shape.open.length), shape.close);
    if (!label) continue;
    return { node: { id: id[0], shape: shape.id, text: label.text }, rest: label.rest };
  }
  return { node: { id: id[0], shape: null, text: null }, rest: after };
}

// The nodes one connector reaches at once: `A & B` is two, joined by `&`.
function takeFlowNodeGroup(rest) {
  const nodes = [];
  let at = rest;
  for (;;) {
    const taken = takeFlowNode(at);
    if (!taken) return null;
    nodes.push(taken.node);
    at = taken.rest.replace(/^[ \t]+/, '');
    if (!at.startsWith('&')) return { nodes, rest: at };
    at = at.slice(1).replace(/^[ \t]+/, '');
  }
}

// One connector. Every spelling comes from FLOW_EDGE_TOKENS and every labeled
// spelling from FLOW_EDGE_LABELED, both generated from the two line/end tables —
// so there is no list here to fall behind them. Labeled forms go first: they
// are longer, and their own regexes refuse to match an unlabeled connector.
function takeFlowLink(rest) {
  for (const form of FLOW_EDGE_LABELED) {
    const match = form.re.exec(rest);
    if (!match) continue;
    // A "label" of nothing but dots is a longer dotted edge — `-.....->` is a
    // rank hint, not `-.` around the text `...`. Keep looking.
    if (!/[^\s.]/.test(match[1])) continue;
    const label = flowLinkLabel(match[1]);
    if (label === false) return null;
    return { link: { label, line: form.line, ends: form.ends }, rest: rest.slice(match[0].length) };
  }
  for (const spelling of FLOW_EDGE_TOKENS) {
    if (!rest.startsWith(spelling.token)) continue;
    let after = rest.slice(spelling.token.length);
    let label = null;
    if (after.startsWith('|')) {
      const end = after.indexOf('|', 1);
      if (end < 0) return null;
      label = flowLinkLabel(after.slice(1, end));
      if (label === false) return null;
      after = after.slice(end + 1);
    }
    return { link: { label, line: spelling.line, ends: spelling.ends }, rest: after };
  }
  return null;
}

// A connector's label, quoted or not. `false` means refuse the diagram; null
// means there was no label worth keeping.
function flowLinkLabel(raw) {
  let label = String(raw).trim();
  if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
  if (label.includes('"') || label.includes('`')) return false;
  return decodeFlowLabel(label) || null;
}

// One body line: a node on its own, or a chain of node groups joined by
// connectors. `A --> B --> C` is read as the two edges it means, and
// `A & B --> C & D` as the four. Anything left over at the end — a second
// statement after a `;`, a trailing `:::class` — fails the whole line.
function parseFlowStatement(line) {
  let rest = line.trim();
  const declared = [];
  const links = [];
  let previous = null;
  let pending = null;
  for (;;) {
    const group = takeFlowNodeGroup(rest);
    if (!group) return null;
    for (const node of group.nodes) declared.push(node);
    if (previous) {
      for (const from of previous) {
        for (const node of group.nodes) {
          links.push({
            from,
            to: node.id,
            label: pending.label,
            line: pending.line,
            ends: pending.ends,
          });
        }
      }
    }
    previous = group.nodes.map((node) => node.id);
    rest = group.rest;
    if (!rest) return { declared, links };
    const link = takeFlowLink(rest);
    if (!link) return null;
    pending = link.link;
    rest = link.rest.replace(/^[ \t]+/, '');
  }
}

// Text in, graph out, or null for a diagram we do not model. Everything above
// the header — YAML front matter, `%%{init}%%`, comments, blank lines — is kept
// as it was written and handed straight back by renderFlow.
function parseFlow(text) {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const prelude = [];
  let at = 0;
  if (lines.length && lines[0].trim() === '---') {
    let close = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        close = i;
        break;
      }
    }
    if (close < 0) return null;
    for (let i = 0; i <= close; i += 1) prelude.push(lines[i]);
    at = close + 1;
  }
  while (at < lines.length && (FLOW_COMMENT_RE.test(lines[at]) || !lines[at].trim())) {
    prelude.push(lines[at]);
    at += 1;
  }
  const header = FLOW_HEADER_RE.exec(at < lines.length ? lines[at] : '');
  if (!header) return null;
  at += 1;
  const graph = {
    prelude,
    direction: (header[1] || 'TD').toUpperCase(),
    // Comments and accessibility lines from inside the body. They go back at the
    // top of it rather than exactly where they were: nothing structural holds
    // them in place, and a canvas edit reorders the statements around them.
    notes: [],
    nodes: [],
    edges: [],
  };
  const byId = new Map();
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    if (!line.trim()) continue;
    if (FLOW_COMMENT_RE.test(line) || FLOW_ACC_RE.test(line)) {
      graph.notes.push(line.trim());
      continue;
    }
    const statement = parseFlowStatement(line);
    if (!statement) return null;
    for (const found of statement.declared) {
      let node = byId.get(found.id);
      if (!node) {
        // A node mentioned only in an edge shows its own id, which is what
        // mermaid draws. Writing it back as a declaration says the same thing.
        node = { id: found.id, shape: FLOW_SHAPES[0].id, text: found.id, declared: false };
        byId.set(node.id, node);
        graph.nodes.push(node);
      }
      if (found.shape) {
        // Two shapes for one node is a document whose meaning depends on which
        // one mermaid keeps. Not one to guess at.
        if (node.declared) return null;
        node.declared = true;
        node.shape = found.shape;
        node.text = found.text;
      }
    }
    for (const link of statement.links) {
      graph.edges.push({
        id: 'e' + (graph.edges.length + 1),
        from: link.from,
        to: link.to,
        label: link.label,
        line: link.line,
        ends: link.ends,
      });
    }
  }
  if (!graph.nodes.length) return null;
  for (const node of graph.nodes) delete node.declared;
  return graph;
}

// Graph out, text in. Every node is written as a declaration and every label is
// quoted: both are always legal, and between them they remove a class of bug and
// make renderFlow(parseFlow(text)) an identity for anything we wrote.
function renderFlow(graph) {
  if (!graph) return '';
  const lines = graph.prelude.slice();
  lines.push('flowchart ' + graph.direction);
  for (const note of graph.notes) lines.push(FLOW_INDENT + note);
  for (const node of graph.nodes) {
    const shape = flowShape(node.shape);
    lines.push(FLOW_INDENT + node.id + shape.open + '"' + encodeFlowLabel(node.text) + '"' + shape.close);
  }
  for (const edge of graph.edges) {
    const token = flowEdgeToken(flowEdgeLine(edge.line), flowEdgeEnd(edge.ends));
    const label = edge.label ? '|"' + encodeFlowLabel(edge.label) + '"|' : '';
    lines.push(FLOW_INDENT + edge.from + ' ' + token + label + ' ' + edge.to);
  }
  return lines.join('\n');
}

// ---- the edits the canvas makes -------------------------------------------
// All in place: the sheet owns one graph for as long as it is open, and writes
// it out once.

function flowNextId(graph, prefix) {
  const taken = new Set(graph.nodes.map((node) => node.id).concat(graph.edges.map((edge) => edge.id)));
  let n = 1;
  while (taken.has(prefix + n)) n += 1;
  return prefix + n;
}

function flowAddNode(graph, type, text) {
  const node = { id: flowNextId(graph, 'n'), shape: flowShape(type).id, text: text || 'Step' };
  graph.nodes.push(node);
  return node;
}

function flowFindNode(graph, id) {
  return graph.nodes.find((node) => node.id === id) || null;
}

function flowFindEdge(graph, id) {
  return graph.edges.find((edge) => edge.id === id) || null;
}

// Connect two nodes, unless that edge is already drawn. Returns the edge either
// way, so the canvas can select it.
function flowConnect(graph, from, to) {
  if (!flowFindNode(graph, from) || !flowFindNode(graph, to)) return null;
  const existing = graph.edges.find((edge) => edge.from === from && edge.to === to);
  if (existing) return existing;
  const edge = { id: flowNextId(graph, 'e'), from, to, label: null, line: 'solid', ends: 'arrow' };
  graph.edges.push(edge);
  return edge;
}

// Put a node into a connection that already exists: `A --> B` becomes
// `A --> X --> B`. The first half keeps the original line, its ends and its
// label; the second half matches its look and carries no label of its own.
function flowSpliceIntoEdge(graph, id, edgeId) {
  const edge = flowFindEdge(graph, edgeId);
  if (!edge || !flowFindNode(graph, id)) return null;
  if (edge.from === id || edge.to === id) return null;
  const rest = {
    id: flowNextId(graph, 'e'),
    from: id,
    to: edge.to,
    label: null,
    line: edge.line,
    ends: edge.ends,
  };
  edge.to = id;
  graph.edges.splice(graph.edges.indexOf(edge) + 1, 0, rest);
  return rest;
}

// Unhook a node from everything, leaving the node itself where it is.
function flowDetachNode(graph, id) {
  graph.edges = graph.edges.filter((edge) => edge.from !== id && edge.to !== id);
}

// Pull a node out of the middle of a chain and close the gap behind it: what
// reached it is joined to what left it, then its own lines go. Without the
// healing, taking one step out of `A --> B --> C` would leave A and C strangers.
function flowExtractNode(graph, id) {
  const incoming = graph.edges.filter((edge) => edge.to === id && edge.from !== id);
  const outgoing = graph.edges.filter((edge) => edge.from === id && edge.to !== id);
  for (const into of incoming) {
    for (const out of outgoing) {
      if (into.from !== out.to) flowConnect(graph, into.from, out.to);
    }
  }
  flowDetachNode(graph, id);
}

// A copy of a node, right after it in the order and joined to nothing.
function flowDuplicateNode(graph, id) {
  const node = flowFindNode(graph, id);
  if (!node) return null;
  const copy = { id: flowNextId(graph, 'n'), shape: node.shape, text: node.text };
  graph.nodes.splice(graph.nodes.indexOf(node) + 1, 0, copy);
  return copy;
}

// Point a line the other way. Its style, its ends and its label stay put.
function flowFlipEdge(graph, id) {
  const edge = flowFindEdge(graph, id);
  if (!edge) return;
  const from = edge.from;
  edge.from = edge.to;
  edge.to = from;
}

function flowDeleteNode(graph, id) {
  graph.nodes = graph.nodes.filter((node) => node.id !== id);
  graph.edges = graph.edges.filter((edge) => edge.from !== id && edge.to !== id);
}

function flowDeleteEdge(graph, id) {
  graph.edges = graph.edges.filter((edge) => edge.id !== id);
}

// Move a node's declaration before another's. Declaration order is what decides
// where a node sits among the others on its rank, which is the whole of what
// dragging one does — see the layout.
function flowMoveNode(graph, id, beforeId) {
  const from = graph.nodes.findIndex((node) => node.id === id);
  if (from < 0) return;
  const [node] = graph.nodes.splice(from, 1);
  const at = beforeId == null ? graph.nodes.length : graph.nodes.findIndex((other) => other.id === beforeId);
  graph.nodes.splice(at < 0 ? graph.nodes.length : at, 0, node);
}
