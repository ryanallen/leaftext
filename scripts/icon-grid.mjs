#!/usr/bin/env node
// Where a drawing's flat strokes land once it is worn at a size, and the smallest move that puts them on whole device pixels. Two files read it: `check-icon-grid.mjs`, which reports what is off the grid, and `bundle-icons.mjs`, which moves the window masks onto it. One copy of the geometry, because a checker measuring the grid differently from the compiler would pass a mask nobody had held.
//
// A stroke reads as solid when its worn width sits inside as few device pixel rows as it can. A one-pixel line centered on a pixel boundary is spread half and half over two rows and draws at half its ink in each, which is the pale minimize the window controls shipped; the same line centered in the middle of one row fills that row. So the target a stroke is held to is the middle of the smallest whole number of rows wide enough for it: a half-integer for anything up to one pixel across, a whole one for anything up to two.
//
// Only a stroke running flat along an axis can be judged. A diagonal or a curve crosses the grid at every point along itself and no move makes it solid, so it is named rather than treated as clean; a filled drawing carries no strokes at all and is named the same way.

/**
 * The two places a window mark is worn, each with the name its grid-held mask takes.
 *
 * Both sizes come out of `app-bar.css`'s own rules, so a chip or a dot that changes size is measured and compiled at its new size rather than at a number written down a second time. The variant is named after the place rather than the size, so the name in the stylesheet does not move when the size does.
 */
export function wornWindowSizes(css) {
  const sizeIn = (selector) => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) return null;
    const found = /width:\s*([\d.]+)px/.exec(css.slice(at, css.indexOf('}', at)));
    return found ? Number(found[1]) : null;
  };
  return [
    { worn: 'the Windows chip', variant: 'chip', size: sizeIn('.window-control .lt-icon') },
    { worn: 'the Mac dot', variant: 'dot', size: sizeIn('.mac-frame .window-control .lt-icon') },
  ];
}

/** A tag and everything inside its angle brackets. The trailing slash of a self-closing tag rides along in the attribute text, where the attribute reader ignores it. */
const TAG = /<([a-zA-Z][\w-]*)([^>]*)>/g;
const ATTRIBUTE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs;
/** A path command letter, or one number of its arguments. */
const PATH_TOKEN = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
/** The path commands that leave the straight line: an arc, and every curve. Where one ends depends on control points nothing here reads, so a path carrying one is named rather than half judged. */
const CURVED = /[CcSsQqTtAa]/;
const VIEWBOX = /viewBox\s*=\s*(["'])\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\1/;
/** Close enough to a whole number to be one. These numbers come out of divisions by three and by twenty-four, so an exact comparison would call a held stroke off the grid. */
const NEAR = 1e-6;

/** Every attribute written on one tag. */
function attributesOf(text) {
  const found = new Map();
  for (const [, name, , value] of text.matchAll(ATTRIBUTE)) found.set(name, value);
  return found;
}

/** The box a drawing is in, off its own viewBox, which is the one measurement saying what a coordinate inside it is worth. A drawing with none, or one that is not square, cannot be worn to a grid at all. */
export function boxOf(svg) {
  const found = VIEWBOX.exec(svg);
  if (!found) return null;
  const [, , minX, minY, width, height] = found;
  if (Number(width) !== Number(height)) return null;
  return { box: Number(width), at: { x: Number(minX), y: Number(minY) } };
}

/** The straight runs of one path, as pairs of points. A path that curves anywhere gives none, because nothing here can follow it to where the next straight run starts. */
function pathRuns(d) {
  if (CURVED.test(d)) return null;
  const tokens = d.match(PATH_TOKEN) || [];
  const runs = [];
  let command = '';
  let at = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let index = 0;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    // A repeated coordinate pair after a move is a line, which is how `M6 6 12 12` draws one.
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    const base = command === command.toLowerCase() ? at : { x: 0, y: 0 };
    let next = at;
    switch (command.toUpperCase()) {
      case 'M':
        at = { x: base.x + number(), y: base.y + number() };
        start = at;
        continue;
      case 'L':
        next = { x: base.x + number(), y: base.y + number() };
        break;
      case 'H':
        next = { x: base.x + number(), y: at.y };
        break;
      case 'V':
        next = { x: at.x, y: base.y + number() };
        break;
      case 'Z':
        next = start;
        break;
      default:
        return null;
    }
    runs.push([at, next]);
    at = next;
  }
  return runs;
}

/** The straight runs of the other shapes, written as the same pairs of points a path gives. A rounded rectangle keeps its four sides: the corner radius eats the ends of them and leaves the long flat middles the eye is reading. */
function shapeRuns(tag, has) {
  const at = (name) => Number(has.get(name) || 0);
  if (tag === 'line') return [[{ x: at('x1'), y: at('y1') }, { x: at('x2'), y: at('y2') }]];
  if (tag === 'rect') {
    const [x, y, width, height] = [at('x'), at('y'), at('width'), at('height')];
    return [
      [{ x, y }, { x: x + width, y }],
      [{ x, y: y + height }, { x: x + width, y: y + height }],
      [{ x, y }, { x, y: y + height }],
      [{ x: x + width, y }, { x: x + width, y: y + height }],
    ];
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const numbers = (has.get('points') || '').match(PATH_TOKEN) || [];
    const points = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: Number(numbers[i]), y: Number(numbers[i + 1]) });
    const runs = points.slice(1).map((point, index) => [points[index], point]);
    if (tag === 'polygon' && points.length > 2) runs.push([points[points.length - 1], points[0]]);
    return runs;
  }
  return null;
}

const SHAPES = new Set(['path', 'line', 'rect', 'polyline', 'polygon', 'circle', 'ellipse']);

/**
 * Every stroke in a drawing that runs flat along an axis, and a sentence for each thing that cannot be judged.
 *
 * A stroke is filed under the axis its center sits on, so `y` holds the horizontal strokes — their center is a `y` coordinate, and moving the drawing up or down is what puts them on the grid.
 */
export function flatStrokes(svg) {
  const root = attributesOf((/<svg([^>]*)>/.exec(svg) || ['', ''])[1]);
  const strokes = { x: [], y: [] };
  const unjudged = [];
  let shapes = 0;
  for (const [, tag, text] of svg.matchAll(TAG)) {
    if (!SHAPES.has(tag)) continue;
    shapes += 1;
    const has = attributesOf(text);
    // A pack draws its stroke and its weight on the `<svg>` and leaves each shape bare, so both are read through the root — and a shape saying `stroke="none"` is the decoy backdrop Tabler puts under every drawing.
    const paint = has.get('stroke') ?? root.get('stroke');
    if (!paint || paint === 'none') continue;
    const width = Number(has.get('stroke-width') ?? root.get('stroke-width') ?? 1);
    if (tag === 'circle' || tag === 'ellipse') {
      unjudged.push(`a ${tag}, which meets the grid at a different place the whole way around`);
      continue;
    }
    const runs = tag === 'path' ? pathRuns(has.get('d') || '') : shapeRuns(tag, has);
    if (runs === null) {
      unjudged.push(`a ${tag} that curves, whose stroke crosses the grid at every point along itself`);
      continue;
    }
    for (const [from, to] of runs) {
      const flatX = Math.abs(from.x - to.x) < NEAR;
      const flatY = Math.abs(from.y - to.y) < NEAR;
      if (flatX && flatY) continue;
      if (flatY) strokes.y.push({ at: from.y, width });
      else if (flatX) strokes.x.push({ at: from.x, width });
      else unjudged.push(`a diagonal in a ${tag}, which no move makes solid`);
    }
  }
  if (shapes && !strokes.x.length && !strokes.y.length && !unjudged.length) {
    unjudged.push('a filled drawing, which has no strokes to hold to a grid');
  }
  return { strokes, unjudged };
}

/** The place a stroke of this worn width has to be centered on: the middle of the smallest whole number of device pixel rows wide enough to hold it. */
const wantedCenter = (worn) => Math.ceil(worn - NEAR) / 2;

/** The move, in worn pixels, that puts one center where it belongs, written as the smaller of the two ways there. */
function moveOnto(center, worn) {
  const off = (((wantedCenter(worn) - center) % 1) + 1) % 1;
  return off > 0.5 ? off - 1 : off;
}

/**
 * The smallest move, in the drawing's own units, that holds every flat stroke of it to the grid it is worn on — and what it could not hold.
 *
 * One drawing takes one move, so the strokes on an axis have to want the same one. Where two want different moves, moving the drawing cannot hold it at all: the two are a distance apart that is not a whole number of pixels at this size, which is a fault in the drawing rather than in where it sits.
 *
 * `drawn` is the whole viewBox rather than only its width, because a move already made is carried by the origin: a coordinate lands where it is measured from, not where it is written.
 */
export function gridShift({ strokes, unjudged }, drawn, worn) {
  const scale = worn / drawn.box;
  const shift = { x: 0, y: 0 };
  const conflicts = [];
  for (const axis of ['x', 'y']) {
    let wanted = null;
    for (const stroke of strokes[axis]) {
      const move = moveOnto((stroke.at - drawn.at[axis]) * scale, stroke.width * scale);
      if (wanted === null) wanted = move;
      // A whole pixel apart is the same move: one asked to go half a pixel back and the other half a pixel on, and both land.
      else if (Math.abs(move - wanted) > NEAR && Math.abs(Math.abs(move - wanted) - 1) > NEAR) {
        const flat = axis === 'y' ? 'horizontal' : 'vertical';
        conflicts.push(`its ${flat} strokes ask for moves ${move.toFixed(4)}px and ${wanted.toFixed(4)}px apart, so no one move holds them both`);
        wanted = 0;
        break;
      }
    }
    shift[axis] = Number((((wanted || 0) / scale)).toFixed(6));
  }
  return { shift, conflicts, unjudged, held: !conflicts.length && !shift.x && !shift.y };
}

/** A number as short as it can be written, so an unmoved drawing compiles byte for byte the way it always did. */
const short = (value) => String(Number(value.toFixed(4)));

/** The drawing with its window moved rather than its ink: the viewBox origin carries the move, so nothing is pushed past an edge and clipped, and the file on disk is left where the pack wrote it. */
export function shiftedViewBox(svg, shift) {
  const drawn = boxOf(svg);
  if (!drawn || (!shift.x && !shift.y)) return svg;
  const moved = `viewBox="${short(drawn.at.x - shift.x)} ${short(drawn.at.y - shift.y)} ${short(drawn.box)} ${short(drawn.box)}"`;
  return svg.replace(VIEWBOX, moved);
}
