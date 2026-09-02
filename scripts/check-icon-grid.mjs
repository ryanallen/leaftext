#!/usr/bin/env node
// The window's minimize, maximize, restore and close, measured against the pixel grid each is actually worn on. They looked lighter than the palette and folder buttons beside them while carrying the same color: an outside pack draws them in a 24-unit box, `bundle-icons` gives the stroke the right one-pixel width for that box, and the drawing's own whole-unit center then lands on a pixel boundary, splitting the line over two rows at half its ink in each.
//
//   node scripts/check-icon-grid.mjs   report every window mask against both grids, and fail on one a move would hold (`just verify`)
//
// It reads the masks that actually ship rather than the drawings behind them, out of `src/assets/icons.css`, because that sheet is what the window wears: the row's weight is already stamped, an outside pack's block has already replaced the app's own drawing, and the grid a stroke lands on is a fact about the compiled mask. The two sizes it is worn at come out of `src/assets/reading/app-bar.css`, so a chip or a dot that changes size is measured at its new size rather than at a number written down twice.
//
// The geometry is `icon-grid.mjs`'s, shared with the compiler that moves these masks, so what is checked here and what is published there cannot drift apart.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxOf, flatStrokes, gridShift, shiftedViewBox, wornWindowSizes } from './icon-grid.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

// The rows whose weight belongs to the platform's chrome rather than to us, read off design/icons.md so the four are never written down a second time.
function hairlineRows(md) {
  const names = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length > 8 && cells[3] === 'hairline') names.push(cells[0]);
  }
  return names;
}

// A mask value back into the drawing it was made from. The compiler's escaping is five characters and a quote swap, so this is the same five read the other way; the quote swap needs no undoing, because everything downstream reads either quote.
const decode = (uri) =>
  uri
    .replace(/%3C/g, '<')
    .replace(/%3E/g, '>')
    .replace(/%7B/g, '{')
    .replace(/%7D/g, '}')
    .replace(/%23/g, '#')
    .replace(/%25/g, '%');

// Every drawing the sheet declares, filed under the pack that declares it. The root block is the app's own set, and each block after it is one outside pack replacing the drawings it covers, which is exactly the shape a reader wearing that pack sees.
function masksByPack(css) {
  const packs = new Map([['leaftext', new Map()]]);
  let inside = 'leaftext';
  for (const line of css.split('\n')) {
    const opened = /^(.*)\{\s*$/.exec(line);
    if (opened) {
      const named = /\[data-leaf-pack="([a-z0-9-]+)"\]/.exec(opened[1]);
      inside = named ? named[1] : 'leaftext';
      if (!packs.has(inside)) packs.set(inside, new Map());
      continue;
    }
    const declared = /^\s*--lt-icon-([a-z0-9-]+):\s*url\("data:image\/svg\+xml,(.*)"\);\s*$/.exec(line);
    if (declared) packs.get(inside).set(declared[1], decode(declared[2]));
  }
  return packs;
}

/**
 * What one drawing at one worn size is: held, a move away from held, or something nothing here can hold.
 *
 * The two answers are different on purpose. A stroke one move would put on the grid is refused, because a mask that could be right and is not is exactly the fault this exists for. A diagonal, a curve, a filled drawing and a square whose two edges are a fractional number of pixels apart are named and let through: no move holds any of them, so failing would be a build nobody could make pass without redrawing a mark.
 */
function judge(svg, size) {
  const drawn = boxOf(svg);
  if (!drawn) return { named: ['no square viewBox, so nothing can say what a coordinate in it is worth'] };
  const flat = flatStrokes(svg);
  const measured = gridShift(flat, drawn, size);
  const named = [...measured.unjudged, ...measured.conflicts];
  // A drawing can be neither refused nor held: the close cross asks for no move because every stroke in it is a diagonal, and a square whose edges are a fraction apart asks for none because no move would work.
  const judged = flat.strokes.x.length + flat.strokes.y.length;
  const stuck = measured.conflicts.length;
  if (measured.held || stuck) return { drawn, named, judged, stuck };
  return { drawn, named, judged, stuck, move: measured.shift };
}

// The rules prove their own refusals on made-up drawings before the real masks are read, so a run where nothing is wrong is still a run that watched the grid refuse something.
const madeUp = (box, drawn) => `<svg viewBox="0 0 ${box} ${box}">${drawn}</svg>`;
const lineAt = (box, y, width) => madeUp(box, `<line x1="2" y1="${y}" x2="${box - 2}" y2="${y}" stroke="#000" stroke-width="${width}"/>`);
const midline = (box, width) => lineAt(box, box / 2, width);
const squareOf = (box, side, width) => madeUp(box, `<rect x="${(box - side) / 2}" y="${(box - side) / 2}" width="${side}" height="${side}" stroke="#000" stroke-width="${width}"/>`);
const fails = [];
for (const [what, svg, size, wanted] of [
  ['a 24-unit midline stroke at the chip size', midline(24, 2), 12, 1],
  ['the same stroke at the dot size', midline(24, 2), 8, 1.5],
  ['a 12-unit midline stroke at the dot size', midline(12, 1), 8, 0.75],
]) {
  const { move } = judge(svg, size);
  if (!move) fails.push(`${what} was let through, and a stroke centered on the box's own midline splits over two rows`);
  else if (Math.abs(move.y - wanted) > 1e-6) fails.push(`${what} was told to move ${move.y} units, not ${wanted}`);
  // And the other direction: the move it named has to be a move that works, measured by putting the drawing through it and asking again.
  else if (judge(shiftedViewBox(svg, move), size).move) fails.push(`${what} was still off the grid after its own move of ${move.y} units`);
}
for (const [what, svg, size] of [
  ['a stroke already centered in its own pixel row', lineAt(12, 6.5, 1), 12],
  ['a rectangle whose four sides all land', squareOf(24, 18, 2), 12],
]) {
  const { move, named } = judge(svg, size);
  if (move || named.length) fails.push(`${what} was called off the grid: ${named.join(' ') || `move ${JSON.stringify(move)}`}`);
}
for (const [what, svg, size, named] of [
  ['a diagonal', madeUp(24, '<line x1="6" y1="6" x2="18" y2="18" stroke="#000" stroke-width="2"/>'), 12, 'a diagonal'],
  ['a curve', madeUp(24, '<path d="M6 6C10 6 14 18 18 18" stroke="#000" stroke-width="2"/>'), 12, 'curves'],
  ['a filled drawing', madeUp(24, '<path d="M5 11V13H19V11H5Z" fill="#000"/>'), 12, 'filled drawing'],
  ['a 5.5-unit square at the chip size', squareOf(12, 5.5, 1), 12, 'no one move holds them both'],
  ['a 7-unit square at the dot size', squareOf(12, 7, 1), 8, 'no one move holds them both'],
]) {
  const answered = judge(svg, size);
  if (!answered.named.join(' ').includes(named)) fails.push(`${what} was not named as something no move holds (got "${answered.named.join(' ') || 'nothing'}")`);
  if (answered.move) fails.push(`${what} was refused with a move of ${JSON.stringify(answered.move)}, and no move holds it`);
}
if (fails.length) {
  console.error('check-icon-grid: the grid rules do not hold:');
  for (const fail of fails) console.error(`  ${fail}`);
  process.exit(1);
}

const windows = hairlineRows(read('design/icons.md'));
if (windows.length < 4) throw new Error(`design/icons.md gives only ${windows.length} hairline rows, and the window's own four are what this measures`);
const sizes = wornWindowSizes(read('src/assets/reading/app-bar.css'));
for (const { worn, size } of sizes) {
  if (!size) throw new Error(`src/assets/reading/app-bar.css no longer says how wide ${worn}'s mark is drawn, so nothing can say which grid it lands on`);
}
const packs = masksByPack(read('src/assets/icons.css'));

const off = [];
const cannot = [];
let held = 0;
for (const { worn, size, variant } of sizes) {
  for (const [pack, masks] of packs) {
    for (const name of windows) {
      // The window wears the variant held to this grid where the sheet publishes one, and the ordinary mask before phase 2 compiles them; a pack with no drawing for this job declares neither and the reader keeps the app's own, which the root block was already measured for.
      const svg = masks.get(`${name}-${variant}`) || masks.get(name);
      if (!svg) continue;
      const { drawn, named, judged, stuck, move } = judge(svg, size);
      for (const said of named) cannot.push(`${pack} ${name} on ${worn}: ${said}`);
      if (!move) {
        if (judged > 0 && !stuck) held += 1;
        continue;
      }
      const asked = ['x', 'y']
        .filter((axis) => move[axis])
        .map((axis) => `${axis} by ${move[axis]} units (${((move[axis] * size) / drawn.box).toFixed(4)}px)`)
        .join(' and ');
      off.push(`${pack} ${name} on ${worn}: move ${asked}`);
    }
  }
}

// What cannot be judged is written down rather than counted, because a diagonal nobody can hold and a rectangle whose sides are a fraction apart are two different answers and only the second is a drawing that could be redrawn.
if (cannot.length) {
  console.log(`icon grid: ${cannot.length} window marks the grid cannot judge, each left as it is drawn:`);
  for (const said of cannot) console.log(`  ${said}`);
}
if (off.length) {
  console.error(`icon grid: ${off.length} window masks miss the grid they are worn on:`);
  for (const line of off) console.error(`  ${line}`);
  console.error('A stroke centered on a pixel boundary draws at half its ink in each of two rows, which is what makes these marks look paler than the buttons beside them.');
  process.exit(1);
}
console.log(`icon grid: ${held} window masks land on the grid they are worn on, across ${packs.size} packs and ${sizes.length} sizes`);
