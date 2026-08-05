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
// turns "I tidied my diagram" into lost work. A box given its own size or its own
// place on the page is refused by that rule alone, because nothing here matches
// them and a save would drop them.
//
// Refusing is not the same as saying nothing. flowRefusal walks the same text
// again and names the line that beat the parser, because "we can't model this"
// fifteen different times tells the reader nothing about their diagram.
// ---------------------------------------------------------------------------

// The shapes, keyed by the name mermaid knows each one by — the id is what gets
// written into the file. A row says what a shape is called, what it is for, and
// how it is spelled. Nothing here says what one looks like: mermaid draws the
// canvas, so a second drawing of the same shape could only ever be a second
// drawing that was wrong.
//
// A row with `open` can be drawn in brackets, and is written that way. The rest
// have no brackets at all — they are the shapes `A@{ shape: … }` added, and the
// typed form is the only way to write one. `also` is every other name mermaid
// answers to for the same shape; we read them all and write the short one.
const FLOW_SHAPES = [
  { id: 'rect', family: 'Basics', label: 'Process', hint: 'A step: something that happens.', open: '[', close: ']', also: ['proc', 'process', 'rectangle'] },
  { id: 'rounded', family: 'Basics', label: 'Event', hint: 'A step, drawn softer. Same meaning as a process.', open: '(', close: ')', also: ['event'] },
  { id: 'stadium', family: 'Basics', label: 'Terminal', hint: 'Where the flow starts, and where it stops.', open: '([', close: '])', also: ['terminal', 'pill'] },
  { id: 'fr-rect', family: 'Basics', label: 'Subprocess', hint: 'A step spelled out somewhere else.', open: '[[', close: ']]', also: ['subprocess', 'subproc', 'framed-rectangle', 'subroutine'] },
  { id: 'cyl', family: 'Basics', label: 'Database', hint: 'Data being stored or read.', open: '[(', close: ')]', also: ['db', 'database', 'cylinder'] },
  { id: 'circle', family: 'Start and stop', label: 'Circle', hint: 'A jump: the flow carries on at the matching circle.', open: '((', close: '))', also: ['circ'] },
  { id: 'dbl-circ', family: 'Start and stop', label: 'Double circle', hint: 'The end of the whole flow.', open: '(((', close: ')))', also: ['double-circle'] },
  { id: 'diam', family: 'Basics', label: 'Decision', hint: 'A question, with a labeled line out for each answer.', open: '{', close: '}', also: ['decision', 'diamond', 'question'] },
  { id: 'hex', family: 'Steps', label: 'Preparation', hint: 'Setting something up before the next step.', open: '{{', close: '}}', also: ['hexagon', 'prepare'] },
  { id: 'lean-r', family: 'In and out', label: 'Input', hint: 'Something going in.', open: '[/', close: '/]', also: ['lean-right', 'in-out'] },
  { id: 'lean-l', family: 'In and out', label: 'Output', hint: 'Something coming out.', open: '[\\', close: '\\]', also: ['lean-left', 'out-in'] },
  // Mermaid's own meanings, which are not the ones these two carried before the
  // other forty-odd arrived: manual input is sl-rect, and this pair moves up one.
  { id: 'trap-b', family: 'Steps', label: 'Priority action', hint: 'A step that jumps the queue.', open: '[/', close: '\\]', also: ['priority', 'trapezoid-bottom', 'trapezoid'] },
  { id: 'trap-t', family: 'By hand', label: 'Manual operation', hint: 'A step done by hand.', open: '[\\', close: '/]', also: ['manual', 'trapezoid-top', 'inv-trapezoid'] },
  { id: 'odd', family: 'Notes', label: 'Flag', hint: 'A note pinned to the flow.', open: '>', close: ']' },
  { id: 'notch-rect', family: 'Steps', label: 'Card', hint: 'A card, punched at one corner.', also: ['card', 'notched-rectangle'] },
  { id: 'lin-rect', family: 'Steps', label: 'Lined process', hint: 'A step with a margin drawn down it.', also: ['lined-rectangle', 'lined-process', 'lin-proc', 'shaded-process'] },
  { id: 'sm-circ', family: 'Start and stop', label: 'Start dot', hint: 'Where the flow begins, drawn small.', also: ['start', 'small-circle'] },
  { id: 'fr-circ', family: 'Start and stop', label: 'Stop dot', hint: 'Where the flow ends, drawn small.', also: ['stop', 'framed-circle'] },
  { id: 'f-circ', family: 'Start and stop', label: 'Junction', hint: 'Where lines meet and carry on.', also: ['junction', 'filled-circle'] },
  { id: 'fork', family: 'Start and stop', label: 'Fork or join', hint: 'The flow splits in two, or two come back together.', also: ['join'] },
  { id: 'hourglass', family: 'Steps', label: 'Collate', hint: 'Putting things in order before the next step.', also: ['collate'] },
  { id: 'brace', family: 'Notes', label: 'Comment', hint: 'A note in the margin, braced on the left.', also: ['comment', 'brace-l'] },
  { id: 'brace-r', family: 'Notes', label: 'Comment, right', hint: 'The same note, braced on the right.' },
  { id: 'braces', family: 'Notes', label: 'Comment, both sides', hint: 'The same note, braced on both.' },
  { id: 'bolt', family: 'In and out', label: 'Communication link', hint: 'A step that happens over a wire.', also: ['com-link', 'lightning-bolt'] },
  { id: 'doc', family: 'Documents', label: 'Document', hint: 'Something written out.', also: ['document'] },
  { id: 'docs', family: 'Documents', label: 'Multi-document', hint: 'Several of them.', also: ['documents', 'st-doc', 'stacked-document'] },
  { id: 'lin-doc', family: 'Documents', label: 'Lined document', hint: 'A document with a margin down it.', also: ['lined-document'] },
  { id: 'tag-doc', family: 'Documents', label: 'Tagged document', hint: 'A document with a tag on the corner.', also: ['tagged-document'] },
  { id: 'st-rect', family: 'Steps', label: 'Multi-process', hint: 'A step that happens more than once.', also: ['procs', 'processes', 'stacked-rectangle'] },
  { id: 'tag-rect', family: 'Steps', label: 'Tagged process', hint: 'A step with a tag on the corner.', also: ['tagged-rectangle', 'tag-proc', 'tagged-process'] },
  { id: 'div-rect', family: 'Steps', label: 'Divided process', hint: 'A step in two parts.', also: ['div-proc', 'divided-rectangle', 'divided-process'] },
  { id: 'sl-rect', family: 'By hand', label: 'Manual input', hint: 'Something typed in by hand.', also: ['manual-input', 'sloped-rectangle'] },
  { id: 'bow-rect', family: 'Data', label: 'Stored data', hint: 'Data kept somewhere.', also: ['stored-data', 'bow-tie-rectangle'] },
  { id: 'win-pane', family: 'Data', label: 'Internal storage', hint: 'Data held inside the program.', also: ['internal-storage', 'window-pane'] },
  { id: 'delay', family: 'Steps', label: 'Delay', hint: 'A wait.', also: ['half-rounded-rectangle'] },
  { id: 'h-cyl', family: 'Data', label: 'Direct access storage', hint: 'A drum: data read straight off it.', also: ['das', 'horizontal-cylinder'] },
  { id: 'lin-cyl', family: 'Data', label: 'Disk storage', hint: 'Data on a disk.', also: ['disk', 'lined-cylinder'] },
  { id: 'curv-trap', family: 'In and out', label: 'Display', hint: 'Something shown to a person.', also: ['curved-trapezoid', 'display'] },
  { id: 'notch-pent', family: 'Steps', label: 'Loop limit', hint: 'Where a loop starts, and where it stops.', also: ['loop-limit', 'notched-pentagon'] },
  { id: 'tri', family: 'Steps', label: 'Extract', hint: 'Taking one part out.', also: ['extract', 'triangle'] },
  { id: 'flip-tri', family: 'By hand', label: 'Manual file', hint: 'A file kept by hand.', also: ['manual-file', 'flipped-triangle'] },
  { id: 'cross-circ', family: 'Steps', label: 'Summary', hint: 'What it all came to.', also: ['summary', 'crossed-circle'] },
  { id: 'flag', family: 'Data', label: 'Paper tape', hint: 'A run of data, read end to end.', also: ['paper-tape'] },
  { id: 'bang', family: 'Notes', label: 'Bang', hint: 'Something going wrong.' },
  { id: 'cloud', family: 'Notes', label: 'Cloud', hint: 'Somewhere else, and not our problem.' },
  { id: 'text', family: 'Notes', label: 'Text', hint: 'Words with nothing drawn round them.' },
];

// A shape's opener does not always decide which shape it is — `[/x/]` and
// `[/x\]` open the same way — so the longest opener is tried first and the
// closer settles it. See takeFlowNode.
const FLOW_SHAPES_BY_OPENER = FLOW_SHAPES.filter((shape) => shape.open).sort(
  (a, b) => b.open.length - a.open.length,
);

// Every name a shape answers to, mapped to the one we write. Mermaid takes all
// of them; keeping the aliases readable and unwritten is what stops the file
// growing a second spelling of a shape it already had.
const FLOW_SHAPES_BY_NAME = new Map();
for (const shape of FLOW_SHAPES) {
  FLOW_SHAPES_BY_NAME.set(shape.id, shape);
  for (const name of shape.also || []) FLOW_SHAPES_BY_NAME.set(name, shape);
}

// The order every list of shapes is shown in. Alphabetical, so a shape sits
// where you last saw it; the table above keeps the order the parser wants.
const FLOW_SHAPES_BY_LABEL = FLOW_SHAPES.slice().sort((a, b) => a.label.localeCompare(b.label));

// Forty-seven shapes in one alphabetical run is a list nobody reads to the end
// of, so the picker shows them under headings. The everyday six come first;
// after that the headings are what a shape is *for*, and inside each one it is
// alphabetical again. Every shape sits under exactly one — the harness holds
// that, because a shape in no family would simply never be offered.
const FLOW_SHAPE_FAMILIES = [
  'Basics',
  'Steps',
  'Start and stop',
  'In and out',
  'By hand',
  'Data',
  'Documents',
  'Notes',
];

function flowShapeFamilies() {
  return FLOW_SHAPE_FAMILIES.map((name) => ({
    name,
    shapes: FLOW_SHAPES_BY_LABEL.filter((shape) => shape.family === name),
  }));
}

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
//
// A connector can also be *stretched*, and mermaid reads the extra length as a
// rank hint: `--->` pushes the box it points at one rank further down than
// `-->` would. `unit` is the character that repeats, `least` is how many of them
// the shortest spelling has, and `open`/`shut` are what sits either side of the
// run. So `----> ` is the arrow with two more units, and that number is kept on
// the edge — dropping it would quietly redraw the whole layout on the next save.
//
// The invisible link is a fourth row that takes no ends at all: `~~~` and
// nothing else. `only` says so, and the product below skips every other pair.
const FLOW_EDGE_LINES = [
  { id: 'solid', label: 'Solid', unit: '-', least: 2, open: '', shut: '', plainTail: '-', labelOpen: '--', labelBody: '--' },
  { id: 'dotted', label: 'Dotted', unit: '.', least: 1, open: '-', shut: '-', plainTail: '', labelOpen: '-.', labelBody: '.-' },
  { id: 'thick', label: 'Thick', unit: '=', least: 2, open: '', shut: '', plainTail: '=', labelOpen: '==', labelBody: '==' },
  { id: 'invisible', label: 'Invisible', unit: '~', least: 3, open: '', shut: '', plainTail: '', only: 'none' },
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

// Which ends a line style can carry. Every pair, unless the row says otherwise.
function flowEndsFor(line) {
  return line.only ? FLOW_EDGE_ENDS.filter((end) => end.id === line.only) : FLOW_EDGE_ENDS;
}

// One connector, spelled. `stretch` is how many units past the shortest form it
// runs — 0 for `-->`, 1 for `--->`.
function flowEdgeToken(line, end, stretch) {
  const run = line.unit.repeat(line.least + Math.max(0, stretch || 0));
  return end.head + line.open + run + line.shut + (end.tail || line.plainTail);
}

// Every spelling, as a pattern rather than a string, because the run in the
// middle has no fixed length. Matched longest fixed part first — `-.->` must be
// tried before `-.-`, or a dotted arrow reads as a dotted line with a stray `>`.
const FLOW_EDGE_TOKENS = [];
for (const line of FLOW_EDGE_LINES) {
  for (const end of flowEndsFor(line)) {
    const before = end.head + line.open;
    const after = line.shut + (end.tail || line.plainTail);
    FLOW_EDGE_TOKENS.push({
      re: new RegExp(
        '^' + flowEscapeRe(before) + '(' + flowEscapeRe(line.unit) + '{' + line.least + ',})' + flowEscapeRe(after),
      ),
      least: line.least,
      weight: before.length + after.length,
      line: line.id,
      ends: end.id,
    });
  }
}
FLOW_EDGE_TOKENS.sort((a, b) => b.weight - a.weight);

// The same product again, for the form that carries its label between the
// dashes. Parsed but never written: the canvas writes `|"label"|`, which every
// line style takes. The label may not hold the characters a closer starts with,
// or `A ----> B` would read as a labeled arrow.
const FLOW_EDGE_LABELED = [];
for (const line of FLOW_EDGE_LINES) {
  if (!line.labelOpen) continue;
  for (const end of flowEndsFor(line)) {
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
// A hyphen is allowed inside an id, but only with a letter or digit behind it:
// that is the whole difference between `read-file` and the `A --> B` whose
// arrow starts one character later. `-.` is excluded for the same reason, or
// `A-.->B` would read as an id called `A-.`.
const FLOW_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.]*(?:-[A-Za-z0-9_][A-Za-z0-9_.]*)*/;
// How a diagram is painted. The canvas sets none of these — it has no color
// picker and is not getting one — but a diagram that carries them is still a
// diagram to draw in, so they are read onto the thing they paint and written
// back off it. On the node and the edge rather than in a list of lines, which
// is what makes deleting a box take its color with it instead of leaving a rule
// pointing at nothing.
const FLOW_CLASSDEF_RE = /^[ \t]*classDef[ \t]+\S[\s\S]*$/;
const FLOW_CLASS_RE = /^[ \t]*class[ \t]+([A-Za-z0-9_.,\- \t]+?)[ \t]+([A-Za-z0-9_-]+)[ \t]*;?[ \t]*$/;
const FLOW_STYLE_RE = /^[ \t]*style[ \t]+([A-Za-z0-9_.-]+)[ \t]+(\S.*?)[ \t]*;?[ \t]*$/;
const FLOW_LINKSTYLE_RE = /^[ \t]*linkStyle[ \t]+(default|[0-9][0-9, \t]*?)[ \t]+(\S.*?)[ \t]*;?[ \t]*$/;
// Where a box goes when it is clicked: `click A "…"`, with `href` optional and a
// second string the tooltip. Both spellings reach the same anchor in the page, so
// the short one is what gets written back.
const FLOW_CLICK_RE = /^click[ \t]+([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]+(?:href[ \t]+)?"([^"]*)"(?:[ \t]+"([^"]*)")?[ \t]*;?[ \t]*$/;
// The form that names a function. Read, written back, and dead.
const FLOW_CLICK_CALL_RE = /^click[ \t]+[A-Za-z0-9_][A-Za-z0-9_.-]*[ \t]+call(?:back)?\b/;
// The class a box carries on its own line: `A[Careful]:::warn`.
const FLOW_NODE_CLASS_RE = /^:::([A-Za-z0-9_-]+)/;
// A line's own name, and the one thing a named line is for. `@{` is excluded
// because that spelling is a box being given a shape, not a line being named.
const FLOW_EDGE_NAME_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)@(?!\{)/;
const FLOW_EDGE_ATTR_RE = /^[ \t]*([A-Za-z0-9_][A-Za-z0-9_.-]*)@\{(.*)\}[ \t]*$/;
const FLOW_ANIMATION_KEYS = ['animate', 'animation'];
// A box around boxes. `subgraph one`, `subgraph one [Title]`, `subgraph "Title"`
// — the id comes first when there are two, and is the title when there is one.
// Which group a box is in rides on the box, so moving a box among its neighbors
// cannot quietly move it out of its group.
const FLOW_SUBGRAPH_RE = /^[ \t]*subgraph[ \t]+(\S[\s\S]*?)[ \t]*$/;
const FLOW_END_RE = /^[ \t]*end[ \t]*;?[ \t]*$/i;
const FLOW_DIRECTION_RE = /^[ \t]*direction[ \t]+(TD|TB|BT|LR|RL)[ \t]*$/i;
const FLOW_SUBGRAPH_TITLED_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*\[(.*)\]$/;
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

// The label inside a shape's brackets, up to `close`. Quoted or bare. Backticks
// inside a quoted label are mermaid's markdown string — they are the label's own
// text as far as we are concerned, kept whole and written back whole, so a bold
// word survives a save even though the canvas shows it as it was typed.
function takeFlowLabel(rest, close) {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1);
    if (end < 0) return null;
    const raw = rest.slice(1, end);
    if (!rest.slice(end + 1).startsWith(close)) return null;
    return { text: decodeFlowLabel(raw), rest: rest.slice(end + 1 + close.length) };
  }
  const end = rest.indexOf(close);
  if (end < 0) return null;
  const raw = rest.slice(0, end);
  if (!flowBareLabelOk(raw)) return null;
  return { text: raw.trim(), rest: rest.slice(end + close.length) };
}

// `shape: cyl, label: "one, two"` in two, on the comma that is not inside the
// label.
function flowTypedParts(body) {
  const parts = [];
  let at = 0;
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      parts.push(body.slice(at, i));
      at = i + 1;
    }
  }
  parts.push(body.slice(at));
  return parts;
}

// The typed form: `A@{ shape: cyl, label: "Cache", icon: "leaf:back" }`. Four
// keys are read; a size or a position is a layout we do not keep, and anything
// else in the braces refuses the diagram rather than being dropped on the next
// save.
function takeFlowTyped(rest) {
  if (!rest.startsWith('@{')) return null;
  // Scanned rather than searched for: a label may hold a brace or a comma, and
  // both of those are what the braces and the commas out here are made of.
  let close = -1;
  let quoted = false;
  for (let at = 2; at < rest.length; at += 1) {
    const char = rest[at];
    if (char === '"') quoted = !quoted;
    else if (char === '}' && !quoted) {
      close = at;
      break;
    }
  }
  if (close < 0) return null;
  const body = rest.slice(2, close);
  const typed = { shape: null, text: null, icon: null, img: null };
  for (const part of flowTypedParts(body)) {
    if (!part.trim()) continue;
    const at = part.indexOf(':');
    if (at < 0) return null;
    const key = part.slice(0, at).trim();
    let value = part.slice(at + 1).trim();
    const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    if (quoted) value = value.slice(1, -1);
    if (value.includes('"') || value.includes('`')) return null;
    if (key === 'shape') {
      const shape = FLOW_SHAPES_BY_NAME.get(value);
      if (!shape) return null;
      typed.shape = shape.id;
      continue;
    }
    if (key === 'label') {
      // A label written bare here may hold anything a bracket label may not,
      // except the comma that would have ended it. Quoted, it may hold that too.
      if (!quoted && !flowBareLabelOk(value) && value !== '') return null;
      typed.text = decodeFlowLabel(value);
      continue;
    }
    // Handed straight back on save, so nothing here has to understand either —
    // only that a brace or a comma in one would have ended the value.
    if (key === 'icon' || key === 'img') {
      if (!quoted && !flowBareLabelOk(value)) return null;
      typed[key] = value;
      continue;
    }
    return null;
  }
  return { typed, rest: rest.slice(close + 1) };
}

// One node, declared with a shape (`A["text"]` or `A@{ shape: … }`) or just
// named (`A`); a named-only node carries neither shape nor text and the caller
// supplies both. An opener that leads nowhere is stepped over rather than
// refused, since several are shared — its brackets are then still in `rest`, no
// connector matches them, and the statement fails anyway.
function takeFlowNode(rest) {
  const id = FLOW_ID_RE.exec(rest);
  if (!id) return null;
  const after = rest.slice(id[0].length);
  // A class written straight onto the box, which any of the three forms below
  // may carry. Taken here so all three get it from one place.
  const withClass = (node, left) => {
    const marked = FLOW_NODE_CLASS_RE.exec(left);
    if (marked) node.className = marked[1];
    return { node, rest: marked ? left.slice(marked[0].length) : left };
  };
  if (after.startsWith('@{')) {
    const taken = takeFlowTyped(after);
    if (!taken) return null;
    return withClass(
      {
        id: id[0],
        shape: taken.typed.shape,
        text: taken.typed.text,
        icon: taken.typed.icon,
        img: taken.typed.img,
        typed: true,
      },
      taken.rest,
    );
  }
  for (const shape of FLOW_SHAPES_BY_OPENER) {
    if (!after.startsWith(shape.open)) continue;
    const label = takeFlowLabel(after.slice(shape.open.length), shape.close);
    if (!label) continue;
    return withClass({ id: id[0], shape: shape.id, text: label.text }, label.rest);
  }
  return withClass({ id: id[0], shape: null, text: null }, after);
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
  // `A e1@--> B` names the line, so something further down can point at it —
  // the only thing that does is an animation. The name sits between the box and
  // the connector, and nothing else may: if what follows is not a connector,
  // this is not a line at all.
  let name = null;
  const named = FLOW_EDGE_NAME_RE.exec(rest);
  if (named) {
    name = named[1];
    rest = rest.slice(named[0].length);
  }
  const found = takeFlowConnector(rest);
  if (!found) return null;
  found.link.name = name;
  return found;
}

function takeFlowConnector(rest) {
  for (const form of FLOW_EDGE_LABELED) {
    const match = form.re.exec(rest);
    if (!match) continue;
    // A "label" of nothing but dots is a longer dotted edge — `-.....->` is a
    // rank hint, not `-.` around the text `...`. Keep looking.
    if (!/[^\s.]/.test(match[1])) continue;
    const label = flowLinkLabel(match[1]);
    if (label === false) return null;
    return { link: { label, line: form.line, ends: form.ends, stretch: 0 }, rest: rest.slice(match[0].length) };
  }
  for (const spelling of FLOW_EDGE_TOKENS) {
    const match = spelling.re.exec(rest);
    if (!match) continue;
    let after = rest.slice(match[0].length);
    let label = null;
    if (after.startsWith('|')) {
      const end = after.indexOf('|', 1);
      if (end < 0) return null;
      label = flowLinkLabel(after.slice(1, end));
      if (label === false) return null;
      after = after.slice(end + 1);
    }
    return {
      link: { label, line: spelling.line, ends: spelling.ends, stretch: match[1].length - spelling.least },
      rest: after,
    };
  }
  return null;
}

// A connector's label, quoted or not. `false` means refuse the diagram; null
// means there was no label worth keeping.
function flowLinkLabel(raw) {
  let label = String(raw).trim();
  if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
  if (label.includes('"')) return false;
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
            stretch: pending.stretch,
            name: pending.name,
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

// What beats the parser on a line, named. The first row that matches wins, so
// the narrower spellings go above the looser ones — `@{` before an edge id,
// both before a bare hyphen. Nothing here decides anything: a probe only runs
// on a line the parser has already refused, and the fallback below is the
// honest answer when none of them fits.
const FLOW_REFUSALS = [
  { re: /^click\b/, what: 'a click written a way we cannot read' },
  { re: /@\{[^}]*\b(?:w|h|pos|constraint)\b/, what: 'a typed box with a size or a place of its own' },
  { re: /@\{/, what: 'a shape name mermaid doesn’t have' },
  { re: /~~~/, what: 'an invisible line' },
  { re: /`/, what: 'a markdown label with no quotes around it' },
  { re: /;/, what: 'a semicolon between statements' },
  // A dash past what the grammar spells: `-->` is two, `---` is three, and one
  // more of either is mermaid's rank hint. Same again for the thick line.
  { re: /-{3,}[>ox]|-{4,}|={3,}[>ox]|={4,}|-\.{2,}/, what: 'a longer arrow' },
];

function flowFeatureIn(line) {
  const text = line.trim();
  if (flowQuoteLeftOpen(text)) return 'a label whose quote never closes';
  for (const probe of FLOW_REFUSALS) if (probe.re.test(text)) return probe.what;
  return '';
}

// The sentence for a line the parser stopped on. `what` is passed in where the
// caller already knows the cause; otherwise the probes pick it out.
function flowLineRefusal(line, number, what) {
  const named = what || flowFeatureIn(line);
  return named
    ? 'Line ' + number + ' uses ' + named + ', which the canvas doesn’t model yet.'
    : 'Line ' + number + ' is more than the canvas models yet.';
}

function flowRefused(why) {
  return { graph: null, refusal: why };
}

// An odd number of quotes: the label opened and never closed, so the statement
// carries on to the next line. Counted rather than matched, because a regex for
// "an odd number of these" is a regex nobody can read.
function flowQuoteLeftOpen(text) {
  return (String(text).split('"').length - 1) % 2 === 1;
}

// Whether what is inside the braces is an animation and nothing else. A single
// unknown key sends the line back to the box parser, which is where `shape` and
// `label` are read — and if it is neither, the diagram is refused whole.
function flowIsAnimation(body) {
  const parts = flowTypedParts(body).filter((part) => part.trim());
  if (!parts.length) return false;
  return parts.every((part) => {
    const at = part.indexOf(':');
    return at > 0 && FLOW_ANIMATION_KEYS.includes(part.slice(0, at).trim());
  });
}

// What `subgraph …` names: an id and a title, an id alone, or a title alone.
// Mermaid takes all three and the id is what an arrow can point at, so a group
// named only by its title uses that title as its id — which is what mermaid
// does with it too.
function flowGroupFromHeading(heading, parent) {
  const group = { id: '', text: '', direction: null, parent, classes: [], style: null };
  const titled = FLOW_SUBGRAPH_TITLED_RE.exec(heading);
  if (titled) {
    const label = takeFlowLabel(titled[2] + ']', ']');
    if (!label || label.rest) return null;
    group.id = titled[1];
    group.text = label.text;
    return group;
  }
  if (heading.startsWith('"')) {
    const label = takeFlowLabel(heading, '');
    if (!label || label.rest) return null;
    group.id = label.text;
    group.text = label.text;
    return group;
  }
  const id = FLOW_ID_RE.exec(heading);
  if (!id || id[0] !== heading) return null;
  group.id = heading;
  group.text = heading;
  return group;
}

// Text in, graph out, or null for a diagram we do not model. Everything above
// the header — YAML front matter, `%%{init}%%`, comments, blank lines — is kept
// as it was written and handed straight back by renderFlow.
function parseFlow(text) {
  return walkFlow(text).graph;
}

// Why it refused, in one sentence, or '' for text that parses. A second walk
// rather than a field on the graph: a refusal has no graph to carry it, and the
// notice needs the sentence only when there is nothing else to show.
function flowRefusal(text) {
  return walkFlow(text).refusal;
}

// The walk both of those read. One graph or one reason, never half of each.
function walkFlow(text) {
  if (typeof text !== 'string') return flowRefused('There is nothing here to read.');
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
    if (close < 0) return flowRefused('The front matter above it never closes.');
    for (let i = 0; i <= close; i += 1) prelude.push(lines[i]);
    at = close + 1;
  }
  while (at < lines.length && (FLOW_COMMENT_RE.test(lines[at]) || !lines[at].trim())) {
    prelude.push(lines[at]);
    at += 1;
  }
  const header = FLOW_HEADER_RE.exec(at < lines.length ? lines[at] : '');
  if (!header) {
    // Most of these are another kind of diagram entirely, and its own first word
    // says which — the reader's word, not a name we made up for it.
    const word = /^[A-Za-z0-9_-]+/.exec(at < lines.length ? lines[at].trim() : '');
    return flowRefused(
      word
        ? 'Only flowcharts open on the canvas, and this one starts with “' + word[0] + '”.'
        : 'This has no flowchart line to start it.',
    );
  }
  at += 1;
  const graph = {
    prelude,
    direction: (header[1] || 'TD').toUpperCase(),
    // Comments and accessibility lines from inside the body. They go back at the
    // top of it rather than exactly where they were: nothing structural holds
    // them in place, and a canvas edit reorders the statements around them.
    notes: [],
    // `classDef` lines, kept exactly as written: they name colors, which is a
    // vocabulary of one word we do not speak.
    classDefs: [],
    linkStyleDefault: null,
    // `click A call fn()` lines, kept whole and doing nothing. The page renders
    // at mermaid's strict level and has no `unsafe-eval`, so they never ran; they
    // are written back so a save does not delete a line the reader wrote.
    deadClicks: [],
    // Every group, flat and in the order they were opened; `parent` is what
    // nests them. Flat because a box names its group by id, and a tree would
    // make that lookup a walk.
    groups: [],
    nodes: [],
    edges: [],
  };
  const byId = new Map();
  const byGroup = new Map();
  // The groups we are inside of, innermost last.
  const open = [];
  const inside = () => (open.length ? open[open.length - 1] : null);
  // A class, a style or a link style may be written before the thing it paints,
  // and a link style counts the edges that exist once the whole block is read.
  // So they are collected here and attached at the end.
  const painting = [];
  for (; at < lines.length; at += 1) {
    // A label may be written across two lines, and mermaid wraps it where the
    // break is — so the break is part of the label and the statement is not
    // over until the quote closes. Joined here rather than in the statement
    // parser, which reads one line and should carry on doing so.
    const began = at;
    let line = lines[at];
    while (flowQuoteLeftOpen(line) && at + 1 < lines.length) {
      at += 1;
      line += '\n' + lines[at];
    }
    if (!line.trim()) continue;
    if (FLOW_COMMENT_RE.test(line) || FLOW_ACC_RE.test(line)) {
      graph.notes.push(line.trim());
      continue;
    }
    if (FLOW_CLASSDEF_RE.test(line)) {
      graph.classDefs.push(line.trim());
      continue;
    }
    const opened = FLOW_SUBGRAPH_RE.exec(line);
    if (opened) {
      const group = flowGroupFromHeading(opened[1], inside());
      if (!group) return flowRefused(flowLineRefusal(line, began + 1, 'a subgraph we can’t read the name of'));
      // A box may already exist under this name because an arrow above pointed
      // at the group before it was opened — §19 does exactly that. That one is
      // taken back out at the end; a second group of the same name is not.
      if (byGroup.has(group.id)) {
        return flowRefused(flowLineRefusal(line, began + 1, 'a name another subgraph already has'));
      }
      byGroup.set(group.id, group);
      graph.groups.push(group);
      open.push(group.id);
      continue;
    }
    if (FLOW_END_RE.test(line)) {
      if (!open.length) return flowRefused(flowLineRefusal(line, began + 1, 'an `end` with no subgraph above it'));
      open.pop();
      continue;
    }
    const turned = FLOW_DIRECTION_RE.exec(line);
    if (turned) {
      const group = byGroup.get(inside());
      // At the top level the header already said which way it runs, and mermaid
      // ignores a second answer. Refusing beats keeping a line that does nothing.
      if (!group) return flowRefused(flowLineRefusal(line, began + 1, 'a direction outside a subgraph'));
      group.direction = turned[1].toUpperCase();
      continue;
    }
    const named = FLOW_CLASS_RE.exec(line);
    if (named) {
      const ids = named[1]
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      painting.push({ kind: 'class', ids, name: named[2], line, number: began + 1 });
      continue;
    }
    const styled = FLOW_STYLE_RE.exec(line);
    if (styled) {
      painting.push({ kind: 'style', ids: [styled[1]], rule: styled[2], line, number: began + 1 });
      continue;
    }
    const linked = FLOW_LINKSTYLE_RE.exec(line);
    if (linked) {
      painting.push({ kind: 'linkStyle', which: linked[1], rule: linked[2], line, number: began + 1 });
      continue;
    }
    // `e1@{ animate: true }` gives a named line its animation. The same spelling
    // with a `shape` or a `label` in it is a box, so the keys decide which, and
    // only these two keys are ours to write back.
    // `click A "…"` sends a box somewhere. It may be written above the box it
    // names, so it waits with the classes and the styles and is attached once
    // every box is known. A `call` line is kept whole and left dead: a document
    // must not be able to name a function inside the app and have it run.
    const clicked = FLOW_CLICK_RE.exec(line.trim());
    if (clicked) {
      painting.push({ kind: 'click', ids: [clicked[1]], href: clicked[2], tip: clicked[3] || null, line, number: began + 1 });
      continue;
    }
    if (FLOW_CLICK_CALL_RE.test(line.trim())) {
      graph.deadClicks.push(line.trim());
      continue;
    }
    const attributed = FLOW_EDGE_ATTR_RE.exec(line);
    if (attributed && flowIsAnimation(attributed[2])) {
      painting.push({ kind: 'animate', name: attributed[1], rule: attributed[2].trim(), line, number: began + 1 });
      continue;
    }
    const statement = parseFlowStatement(line);
    if (!statement) return flowRefused(flowLineRefusal(line, began + 1));
    for (const found of statement.declared) {
      let node = byId.get(found.id);
      if (!node) {
        // A node mentioned only in an edge shows its own id, which is what
        // mermaid draws. Writing it back as a declaration says the same thing.
        node = {
          id: found.id,
          shape: FLOW_SHAPES[0].id,
          text: found.id,
          group: inside(),
          classes: [],
          style: null,
          icon: null,
          img: null,
          href: null,
          hrefTip: null,
          shapedBy: '',
        };
        byId.set(node.id, node);
        graph.nodes.push(node);
      } else if (!node.shapedBy && node.group === null && found.shape) {
        // Named in passing outside, spelled out inside: the box belongs where it
        // was spelled out. Mermaid reads it that way and so does the reader.
        node.group = inside();
      }
      if (found.className && !node.classes.includes(found.className)) node.classes.push(found.className);
      if (found.typed) {
        // The typed form may follow a box already drawn in brackets and change
        // its shape — that is what mermaid does with it, and section 14 of the
        // guide teaches it. Two typed shapes for one box is still a guess.
        if (found.shape) {
          if (node.shapedBy === 'typed') {
            return flowRefused(flowLineRefusal(line, began + 1, 'a box given a second shape'));
          }
          node.shapedBy = 'typed';
          node.shape = found.shape;
        }
        if (found.text != null) node.text = found.text;
        if (found.icon != null) node.icon = found.icon;
        if (found.img != null) node.img = found.img;
      } else if (found.shape) {
        // Two shapes for one node is a document whose meaning depends on which
        // one mermaid keeps. Not one to guess at.
        if (node.shapedBy) return flowRefused(flowLineRefusal(line, began + 1, 'a box given a second shape'));
        node.shapedBy = 'bracket';
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
        stretch: link.stretch || 0,
        name: link.name || null,
        animate: null,
        style: null,
      });
    }
  }
  if (open.length) return flowRefused('A subgraph in it never ends.');
  // An arrow may name a group, and §19 points one at a group declared further
  // down — so a box invented for that name is only known to be a group once the
  // whole block has been read. Take it back out; the edge keeps the name.
  for (const [id, node] of byId) {
    if (!byGroup.has(id)) continue;
    if (node.shapedBy || node.classes.length || node.style) {
      return flowRefused('“' + id + '” is a subgraph and a box at once.');
    }
    byId.delete(id);
    graph.nodes = graph.nodes.filter((other) => other !== node);
  }
  // Now that every box and every line is known, what paints them can be put
  // where it belongs. A rule for something that isn't there refuses the
  // diagram: dropping it would be an edit nobody asked for, and keeping it
  // would write a rule that paints nothing.
  for (const item of painting) {
    if (item.kind === 'animate') {
      const edge = graph.edges.find((other) => other.name === item.name);
      if (!edge) return flowRefused(flowLineRefusal(item.line, item.number, 'a line no arrow is named after'));
      edge.animate = item.rule;
      continue;
    }
    if (item.kind === 'linkStyle') {
      if (item.which === 'default') {
        graph.linkStyleDefault = item.rule;
        continue;
      }
      for (const raw of item.which.split(',')) {
        const which = raw.trim();
        if (!which) continue;
        const edge = graph.edges[Number(which)];
        if (!edge) return flowRefused(flowLineRefusal(item.line, item.number, 'a style for a line that isn’t there'));
        edge.style = item.rule;
      }
      continue;
    }
    for (const id of item.ids) {
      // A group takes a class and a style the same way a box does.
      const painted = byId.get(id) || byGroup.get(id);
      if (!painted) return flowRefused(flowLineRefusal(item.line, item.number, 'a box that isn’t there'));
      if (item.kind === 'style') painted.style = item.rule;
      else if (item.kind === 'click') {
        painted.href = item.href;
        painted.hrefTip = item.tip;
      } else if (!painted.classes.includes(item.name)) painted.classes.push(item.name);
    }
  }
  if (!graph.nodes.length) return flowRefused('There are no boxes in it yet.');
  for (const node of graph.nodes) delete node.shapedBy;
  return { graph, refusal: '' };
}

// One box, written the shortest way it can be said: brackets where the shape
// has them, the typed form where it does not. A shape with brackets is never
// written typed, so there is one spelling of each box and the round trip has
// nothing to choose between.
function flowNodeText(node) {
  const shape = flowShape(node.shape);
  const label = '"' + encodeFlowLabel(node.text) + '"';
  // A picture or an icon is only sayable in the typed form, so a box carrying one
  // is written that way whatever shape it has.
  const extra = [];
  if (node.icon) extra.push('icon: "' + node.icon + '"');
  if (node.img) extra.push('img: "' + node.img + '"');
  if (!extra.length && shape.open) return node.id + shape.open + label + shape.close;
  return node.id + '@{ shape: ' + shape.id + ', label: ' + label + (extra.length ? ', ' + extra.join(', ') : '') + ' }';
}

// The `click` line for a box that has one. Written under the boxes because it
// names one, and in the short spelling: `href` is optional and both forms draw
// the same anchor.
function flowClickText(node) {
  const tip = node.hrefTip ? ' "' + node.hrefTip + '"' : '';
  return 'click ' + node.id + ' "' + node.href + '"' + tip;
}

// One group and everything inside it, then the groups inside that, one indent
// deeper each time. Written where the group was opened, so nesting survives.
function flowWriteGroups(graph, parent, depth, lines) {
  const pad = FLOW_INDENT.repeat(depth);
  for (const group of graph.groups || []) {
    if (group.parent !== parent) continue;
    lines.push(pad + 'subgraph ' + group.id + '["' + encodeFlowLabel(group.text) + '"]');
    if (group.direction) lines.push(pad + FLOW_INDENT + 'direction ' + group.direction);
    for (const node of graph.nodes) {
      if (node.group === group.id) lines.push(pad + FLOW_INDENT + flowNodeText(node));
    }
    flowWriteGroups(graph, group.id, depth + 1, lines);
    lines.push(pad + 'end');
  }
}

// Graph out, text in. Every node is written as a declaration and every label is
// quoted: both are always legal, and between them they remove a class of bug and
// make renderFlow(parseFlow(text)) an identity for anything we wrote.
function renderFlow(graph) {
  if (!graph) return '';
  const lines = graph.prelude.slice();
  lines.push('flowchart ' + graph.direction);
  for (const note of graph.notes) lines.push(FLOW_INDENT + note);
  for (const raw of graph.classDefs || []) lines.push(FLOW_INDENT + raw);
  // Boxes in no group first, then the groups, each with its own inside it. A
  // box says which group it is in, so nothing here depends on where it sits in
  // the list — dragging one among its neighbors cannot move it out of a group.
  for (const node of graph.nodes) {
    if (!node.group) lines.push(FLOW_INDENT + flowNodeText(node));
  }
  flowWriteGroups(graph, null, 1, lines);
  for (const edge of graph.edges) {
    const token = flowEdgeToken(flowEdgeLine(edge.line), flowEdgeEnd(edge.ends), edge.stretch);
    const label = edge.label ? '|"' + encodeFlowLabel(edge.label) + '"|' : '';
    const name = edge.name ? edge.name + '@' : '';
    lines.push(FLOW_INDENT + edge.from + ' ' + name + token + label + ' ' + edge.to);
  }
  // An animation names the line it moves, so it goes under all of them.
  for (const edge of graph.edges) {
    if (edge.animate && edge.name) lines.push(FLOW_INDENT + edge.name + '@{ ' + edge.animate + ' }');
  }
  // One `class` line per class, naming every box that carries it — rather than
  // `:::` on the box, which the typed form cannot take. Boxes in declaration
  // order, classes in the order they were first used.
  const wearing = new Map();
  const painted = graph.nodes.concat(graph.groups || []);
  for (const thing of painted) {
    for (const name of thing.classes || []) {
      if (!wearing.has(name)) wearing.set(name, []);
      wearing.get(name).push(thing.id);
    }
  }
  // By name, not by whichever box happened to wear it first: a group moves its
  // boxes down the file, and the order of these lines must not follow that.
  for (const name of [...wearing.keys()].sort()) {
    lines.push(FLOW_INDENT + 'class ' + wearing.get(name).join(',') + ' ' + name);
  }
  for (const thing of painted) {
    if (thing.style) lines.push(FLOW_INDENT + 'style ' + thing.id + ' ' + thing.style);
  }
  if (graph.linkStyleDefault) lines.push(FLOW_INDENT + 'linkStyle default ' + graph.linkStyleDefault);
  // Counted afresh: a link style names an edge by its place in the file, so
  // moving or deleting a line moves what its color is attached to.
  graph.edges.forEach((edge, index) => {
    if (edge.style) lines.push(FLOW_INDENT + 'linkStyle ' + index + ' ' + edge.style);
  });
  for (const node of graph.nodes) {
    if (node.href) lines.push(FLOW_INDENT + flowClickText(node));
  }
  for (const raw of graph.deadClicks || []) lines.push(FLOW_INDENT + raw);
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
  const node = {
    id: flowNextId(graph, 'n'),
    shape: flowShape(type).id,
    text: text || 'Step',
    group: null,
    classes: [],
    style: null,
    icon: null,
    img: null,
    href: null,
    hrefTip: null,
  };
  graph.nodes.push(node);
  return node;
}

function flowFindNode(graph, id) {
  return graph.nodes.find((node) => node.id === id) || null;
}

function flowFindEdge(graph, id) {
  return graph.edges.find((edge) => edge.id === id) || null;
}

function flowFindGroup(graph, id) {
  return (graph.groups || []).find((group) => group.id === id) || null;
}

// ---- the groups the canvas makes -------------------------------------------

// A group's id is written into the file and an arrow can point at it, so it
// cannot be the name of a box or of another group. Named after the boxes it was
// made from is what a reader would expect, but those names are the reader's;
// `g1` is ours, the way `n1` and `e1` are.
function flowNextGroupId(graph) {
  const taken = new Set(
    graph.nodes
      .map((node) => node.id)
      .concat((graph.groups || []).map((group) => group.id))
      .concat(graph.edges.map((edge) => edge.name).filter(Boolean)),
  );
  let n = 1;
  while (taken.has('g' + n)) n += 1;
  return 'g' + n;
}

// A new group around the boxes named, inside whatever group they were already
// in. Boxes from two different groups cannot be gathered into one: the answer
// would have to be which group the new one goes in, and there is no answer.
function flowGroupNodes(graph, ids, text) {
  if (!graph.groups) graph.groups = [];
  const nodes = ids.map((id) => flowFindNode(graph, id)).filter(Boolean);
  if (!nodes.length) return null;
  const parents = new Set(nodes.map((node) => node.group));
  if (parents.size > 1) return null;
  const group = {
    id: flowNextGroupId(graph),
    text: text || 'Group',
    direction: null,
    parent: nodes[0].group,
    classes: [],
    style: null,
  };
  graph.groups.push(group);
  for (const node of nodes) node.group = group.id;
  return group;
}

// Take the group away and leave everything it held. Its boxes go back to
// whatever held it, so a nested group does not fall out of its parent, and
// nothing it drew is left pointing at a name that is gone.
function flowUngroup(graph, id) {
  const group = flowFindGroup(graph, id);
  if (!group) return;
  for (const node of graph.nodes) if (node.group === id) node.group = group.parent;
  for (const other of graph.groups) if (other.parent === id) other.parent = group.parent;
  graph.groups = graph.groups.filter((other) => other.id !== id);
  // An arrow that pointed at the group has nothing to point at any more.
  graph.edges = graph.edges.filter((edge) => edge.from !== id && edge.to !== id);
}

// Put a box in a group, or take it out of every group with `null`.
function flowMoveNodeToGroup(graph, id, groupId) {
  const node = flowFindNode(graph, id);
  if (!node) return;
  if (groupId !== null && !flowFindGroup(graph, groupId)) return;
  node.group = groupId;
}

// Connect two nodes, unless that edge is already drawn. Returns the edge either
// way, so the canvas can select it.
function flowConnect(graph, from, to) {
  if (!flowFindNode(graph, from) || !flowFindNode(graph, to)) return null;
  const existing = graph.edges.find((edge) => edge.from === from && edge.to === to);
  if (existing) return existing;
  const edge = {
    id: flowNextId(graph, 'e'),
    from,
    to,
    label: null,
    line: 'solid',
    ends: 'arrow',
    stretch: 0,
    name: null,
    animate: null,
    style: null,
  };
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
    stretch: edge.stretch,
    name: null,
    animate: null,
    style: edge.style,
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
  const copy = {
    id: flowNextId(graph, 'n'),
    shape: node.shape,
    text: node.text,
    group: node.group,
    classes: (node.classes || []).slice(),
    style: node.style,
  };
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
