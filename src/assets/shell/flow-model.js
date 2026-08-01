// ---------------------------------------------------------------------------
// The flowchart grammar and the graph behind it. No DOM here, not one selector:
// this is the half check-shell.mjs can run in Node, and the half a future
// `.canvas` reader would share.
//
// One table. FLOW_SHAPES, and FLOW_EDGE_LINES against FLOW_EDGE_ENDS, are read
// in both directions — parseFlow matches what they spell, renderFlow writes it,
// the layout sizes from them and the sheet's palette is drawn from them. So a
// shape the parser cannot read can never be offered, and a new one is one row.
//
// Fail closed. parseFlow returns null on anything it does not fully understand,
// never a partial graph: a canvas that quietly drops the half it didn't read
// turns "I tidied my diagram" into lost work. Everything outside phase 1 —
// subgraphs, classes, styles, clicks, typed `@{}` shapes, dotted and thick
// edges — falls out of that rule for free, because nothing here matches it.
//
// Field names follow jsoncanvas.org, at no cost today and so that reading a
// `.canvas` file later reuses this model instead of growing a second one.
// ---------------------------------------------------------------------------

// The classic bracket family, all fourteen. One row is a shape: how it is
// spelled (`open`/`close`), how much room it needs around its text (`grow`), and
// what it looks like (`outline`). The outline returns numbers, not markup — the
// canvas turns those into SVG, so this file still has no presentation in it, and
// the palette is drawn from the same rows the parser matches against. A shape
// missing from here cannot be spelled, sized, drawn or offered.
const FLOW_SHAPES = [
  {
    id: 'rect',
    label: 'Step',
    hint: 'A step: something that happens.',
    open: '[',
    close: ']',
    grow: [1, 1],
    outline: (b) => [{ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rx: 6 }],
  },
  {
    id: 'rounded',
    label: 'Rounded step',
    hint: 'A step, drawn softer. Same meaning as a plain step.',
    open: '(',
    close: ')',
    grow: [1, 1],
    outline: (b) => [{ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rx: 14 }],
  },
  {
    id: 'diamond',
    label: 'Decision',
    hint: 'A question, with a labeled line out for each answer.',
    open: '{',
    close: '}',
    grow: [1.4, 1.4],
    outline: (b) => [
      {
        kind: 'poly',
        points: [
          [b.cx, b.y],
          [b.x + b.w, b.cy],
          [b.cx, b.y + b.h],
          [b.x, b.cy],
        ],
      },
    ],
  },
  {
    id: 'stadium',
    label: 'Start or end',
    hint: 'Where the flow starts, and where it stops.',
    open: '([',
    close: '])',
    grow: [1.1, 1],
    outline: (b) => [{ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rx: b.h / 2 }],
  },
  {
    id: 'subroutine',
    label: 'Subroutine',
    hint: 'A step spelled out somewhere else.',
    open: '[[',
    close: ']]',
    grow: [1.2, 1],
    outline: (b) => [
      { kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rx: 4 },
      { kind: 'line', x1: b.x + 9, y1: b.y, x2: b.x + 9, y2: b.y + b.h },
      { kind: 'line', x1: b.x + b.w - 9, y1: b.y, x2: b.x + b.w - 9, y2: b.y + b.h },
    ],
  },
  {
    id: 'cylinder',
    label: 'Database',
    hint: 'Data being stored or read.',
    open: '[(',
    close: ')]',
    grow: [1, 1.4],
    outline: (b) => {
      const lip = Math.min(10, b.h / 5);
      return [
        {
          kind: 'path',
          d: [
            ['M', b.x, b.y + lip],
            ['A', b.w / 2, lip, 0, 0, 0, b.x + b.w, b.y + lip],
            ['L', b.x + b.w, b.y + b.h - lip],
            ['A', b.w / 2, lip, 0, 0, 0, b.x, b.y + b.h - lip],
            ['Z'],
          ],
        },
        // The rim, drawn over the body so the top reads as a lid.
        {
          kind: 'path',
          open: true,
          d: [
            ['M', b.x, b.y + lip],
            ['A', b.w / 2, lip, 0, 0, 1, b.x + b.w, b.y + lip],
          ],
        },
      ];
    },
  },
  {
    id: 'circle',
    label: 'Circle',
    hint: 'A jump: the flow carries on at the matching circle.',
    open: '((',
    close: '))',
    grow: [1.15, 1.6],
    square: true,
    outline: (b) => [{ kind: 'circle', cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) / 2 }],
  },
  {
    id: 'double-circle',
    label: 'Double circle',
    hint: 'The end of the whole flow.',
    open: '(((',
    close: ')))',
    grow: [1.3, 1.8],
    square: true,
    outline: (b) => [
      { kind: 'circle', cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) / 2 },
      { kind: 'circle', open: true, cx: b.cx, cy: b.cy, r: Math.min(b.w, b.h) / 2 - 6 },
    ],
  },
  {
    id: 'hexagon',
    label: 'Preparation',
    hint: 'Getting ready — setting something up before the next step.',
    open: '{{',
    close: '}}',
    grow: [1.3, 1],
    outline: (b) => {
      const notch = Math.min(22, b.w * 0.18);
      return [
        {
          kind: 'poly',
          points: [
            [b.x + notch, b.y],
            [b.x + b.w - notch, b.y],
            [b.x + b.w, b.cy],
            [b.x + b.w - notch, b.y + b.h],
            [b.x + notch, b.y + b.h],
            [b.x, b.cy],
          ],
        },
      ];
    },
  },
  {
    id: 'asymmetric',
    label: 'Flag',
    hint: 'A note pinned to the flow.',
    open: '>',
    close: ']',
    grow: [1.2, 1],
    outline: (b) => [
      {
        kind: 'poly',
        points: [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x, b.y + b.h],
          [b.x + 16, b.cy],
        ],
      },
    ],
  },
  {
    id: 'lean-r',
    label: 'Input',
    hint: 'Something going in.',
    open: '[/',
    close: '/]',
    grow: [1.3, 1],
    outline: (b) => flowLeanOutline(b, 1),
  },
  {
    id: 'lean-l',
    label: 'Output',
    hint: 'Something coming out.',
    open: '[\\',
    close: '\\]',
    grow: [1.3, 1],
    outline: (b) => flowLeanOutline(b, -1),
  },
  {
    id: 'trapezoid',
    label: 'Manual operation',
    hint: 'A step done by hand.',
    open: '[/',
    close: '\\]',
    grow: [1.35, 1],
    outline: (b) => flowTrapezoidOutline(b, 1),
  },
  {
    id: 'trapezoid-alt',
    label: 'Manual input',
    hint: 'Something typed in by hand.',
    open: '[\\',
    close: '/]',
    grow: [1.35, 1],
    outline: (b) => flowTrapezoidOutline(b, -1),
  },
];

// A shape's opener does not always decide which shape it is — `[/x/]` and
// `[/x\]` open the same way — so the longest opener is tried first and the
// closer settles it. See takeFlowNode.
const FLOW_SHAPES_BY_OPENER = FLOW_SHAPES.slice().sort((a, b) => b.open.length - a.open.length);

function flowSkew(b) {
  return Math.min(24, b.w * 0.2);
}

// The two parallelograms: the same four corners, leaning one way or the other.
function flowLeanOutline(b, way) {
  const skew = flowSkew(b);
  const points =
    way > 0
      ? [
          [b.x + skew, b.y],
          [b.x + b.w, b.y],
          [b.x + b.w - skew, b.y + b.h],
          [b.x, b.y + b.h],
        ]
      : [
          [b.x, b.y],
          [b.x + b.w - skew, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x + skew, b.y + b.h],
        ];
  return [{ kind: 'poly', points }];
}

// The two trapezoids: narrow at the top, or narrow at the bottom.
function flowTrapezoidOutline(b, way) {
  const skew = flowSkew(b);
  const points =
    way > 0
      ? [
          [b.x + skew, b.y],
          [b.x + b.w - skew, b.y],
          [b.x + b.w, b.y + b.h],
          [b.x, b.y + b.h],
        ]
      : [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x + b.w - skew, b.y + b.h],
          [b.x + skew, b.y + b.h],
        ];
  return [{ kind: 'poly', points }];
}

// A connector is a line style and a pair of ends, and mermaid spells it as the
// product of the two — so these are two tables, not one of twenty-one rows. A
// token is `head + body + tail`, and the labeled form mermaid also accepts is
// `head + labelOpen + text + labelBody + tail`. Every spelling below falls out
// of those two lines; nothing else is written down.
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
    FLOW_EDGE_TOKENS.push({ token: flowEdgeToken(line, end), line: line.id, toEnd: end.id });
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
      toEnd: end.id,
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

// One node, either declared with a shape (`A["text"]`) or just named (`A`).
// A named-only node carries no shape and no text; the caller supplies both.
//
// An opener that leads nowhere is stepped over rather than refused, because
// several of them are shared — but the brackets are then still sitting in
// `rest`, no connector matches them, and the statement fails. Closed either way.
function takeFlowNode(rest) {
  const id = FLOW_ID_RE.exec(rest);
  if (!id) return null;
  const after = rest.slice(id[0].length);
  for (const shape of FLOW_SHAPES_BY_OPENER) {
    if (!after.startsWith(shape.open)) continue;
    const label = takeFlowLabel(after.slice(shape.open.length), shape.close);
    if (!label) continue;
    return { node: { id: id[0], type: shape.id, text: label.text }, rest: label.rest };
  }
  return { node: { id: id[0], type: null, text: null }, rest: after };
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
    return { link: { label, line: form.line, toEnd: form.toEnd }, rest: rest.slice(match[0].length) };
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
    return { link: { label, line: spelling.line, toEnd: spelling.toEnd }, rest: after };
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
      for (const fromNode of previous) {
        for (const node of group.nodes) {
          links.push({
            fromNode,
            toNode: node.id,
            label: pending.label,
            line: pending.line,
            toEnd: pending.toEnd,
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
        node = { id: found.id, type: FLOW_SHAPES[0].id, text: found.id, declared: false };
        byId.set(node.id, node);
        graph.nodes.push(node);
      }
      if (found.type) {
        // Two shapes for one node is a document whose meaning depends on which
        // one mermaid keeps. Not one to guess at.
        if (node.declared) return null;
        node.declared = true;
        node.type = found.type;
        node.text = found.text;
      }
    }
    for (const link of statement.links) {
      graph.edges.push({
        id: 'e' + (graph.edges.length + 1),
        fromNode: link.fromNode,
        toNode: link.toNode,
        label: link.label,
        line: link.line,
        toEnd: link.toEnd,
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
    const shape = flowShape(node.type);
    lines.push(FLOW_INDENT + node.id + shape.open + '"' + encodeFlowLabel(node.text) + '"' + shape.close);
  }
  for (const edge of graph.edges) {
    const token = flowEdgeToken(flowEdgeLine(edge.line), flowEdgeEnd(edge.toEnd));
    const label = edge.label ? '|"' + encodeFlowLabel(edge.label) + '"|' : '';
    lines.push(FLOW_INDENT + edge.fromNode + ' ' + token + label + ' ' + edge.toNode);
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
  const node = { id: flowNextId(graph, 'n'), type: flowShape(type).id, text: text || 'Step' };
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
function flowConnect(graph, fromNode, toNode) {
  if (!flowFindNode(graph, fromNode) || !flowFindNode(graph, toNode)) return null;
  const existing = graph.edges.find((edge) => edge.fromNode === fromNode && edge.toNode === toNode);
  if (existing) return existing;
  const edge = { id: flowNextId(graph, 'e'), fromNode, toNode, label: null, line: 'solid', toEnd: 'arrow' };
  graph.edges.push(edge);
  return edge;
}

// Put a node into a connection that already exists: `A --> B` becomes
// `A --> X --> B`. The first half keeps the original line, its ends and its
// label; the second half matches its look and carries no label of its own.
function flowSpliceIntoEdge(graph, id, edgeId) {
  const edge = flowFindEdge(graph, edgeId);
  if (!edge || !flowFindNode(graph, id)) return null;
  if (edge.fromNode === id || edge.toNode === id) return null;
  const rest = {
    id: flowNextId(graph, 'e'),
    fromNode: id,
    toNode: edge.toNode,
    label: null,
    line: edge.line,
    toEnd: edge.toEnd,
  };
  edge.toNode = id;
  graph.edges.splice(graph.edges.indexOf(edge) + 1, 0, rest);
  return rest;
}

// Unhook a node from everything, leaving the node itself where it is.
function flowDetachNode(graph, id) {
  graph.edges = graph.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id);
}

// Pull a node out of the middle of a chain and close the gap behind it: what
// reached it is joined to what left it, then its own lines go. Without the
// healing, taking one step out of `A --> B --> C` would leave A and C strangers.
function flowExtractNode(graph, id) {
  const incoming = graph.edges.filter((edge) => edge.toNode === id && edge.fromNode !== id);
  const outgoing = graph.edges.filter((edge) => edge.fromNode === id && edge.toNode !== id);
  for (const into of incoming) {
    for (const out of outgoing) {
      if (into.fromNode !== out.toNode) flowConnect(graph, into.fromNode, out.toNode);
    }
  }
  flowDetachNode(graph, id);
}

// A copy of a node, right after it in the order and joined to nothing.
function flowDuplicateNode(graph, id) {
  const node = flowFindNode(graph, id);
  if (!node) return null;
  const copy = { id: flowNextId(graph, 'n'), type: node.type, text: node.text };
  graph.nodes.splice(graph.nodes.indexOf(node) + 1, 0, copy);
  return copy;
}

// Point a line the other way. Its style, its ends and its label stay put.
function flowFlipEdge(graph, id) {
  const edge = flowFindEdge(graph, id);
  if (!edge) return;
  const from = edge.fromNode;
  edge.fromNode = edge.toNode;
  edge.toNode = from;
}

function flowDeleteNode(graph, id) {
  graph.nodes = graph.nodes.filter((node) => node.id !== id);
  graph.edges = graph.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id);
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
