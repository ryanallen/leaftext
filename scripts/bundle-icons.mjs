#!/usr/bin/env node
// design/icons.md is the list of icons; this compiles it into src/assets/icons.css, one `.lt-icon-<name>` mask class each. The page then wears an icon by name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. The code-view icon was pasted in five places, the heading icon three.
//
//   node scripts/bundle-icons.mjs           write src/assets/icons.css
//   node scripts/bundle-icons.mjs --check   fail on drift (`just verify`)
//
// A mask reads only alpha, so the copy in the URI is painted flat black and the visible color comes from `background-color: currentColor` on the base class. That is what made the move possible at all: `normalize_svg_icon_colors` had already turned every fill and stroke into `currentColor`, so no icon carried a color.
//
// A row marked `heavy` gets a second mask drawn at the heavy weight, published as `--lt-icon-<name>-heavy` so a rule can swap to it — the active view is drawn bolder as well as brighter, and a mask has no strokes to thicken. `missing-image.svg` and the footnote arrow are not listed: the renderer hands those out as markup.
//
// The row's Stroke cell is the line weight, and it is stamped over whatever the file draws at. A drawing arrives carrying its tool's number; left alone those drift, and this set had reached seven weights before the column existed.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const target = 'src/assets/icons.css';

// The named line weights, read out of the Stroke table so the values live in design/ like every other one. `—` is a drawing with no strokes at all.
const md = readFileSync(join(root, 'design/icons.md'), 'utf8');
const WEIGHTS = new Map([['—', null]]);
for (const [, name, value] of md.matchAll(/^\| (regular|heavy|hairline) \| ([0-9.]+) \|/gm)) {
  WEIGHTS.set(name, value);
}
for (const named of ['regular', 'heavy', 'hairline']) {
  if (!WEIGHTS.has(named)) throw new Error(`design/icons.md has no ${named} row in its Stroke table`);
}

// The rows that carry a class, and the ones that only carry a drawing.
const rows = [];
for (const line of md.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 5 || cells[0] === 'Name' || /^-{3,}$/.test(cells[1])) continue;
  const [name, file, stroke, heavy] = cells;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`design/icons.md: "${name}" is not an icon name`);
  if (!WEIGHTS.has(stroke)) throw new Error(`design/icons.md: ${name} asks for stroke "${stroke}", which the Stroke table does not name`);
  rows.push({ name, file, stroke, heavy: heavy.toLowerCase() === 'yes' });
}
if (rows.length < 30) throw new Error(`design/icons.md gave only ${rows.length} icons`);

const problems = [];
const present = new Set(readdirSync(join(root, 'src/assets')).filter((f) => f.endsWith('.svg')));
for (const { file } of rows) {
  if (!present.has(file)) problems.push(`design/icons.md names ${file}, which is not in src/assets/`);
}
// The footnote arrow is the renderer's own markup, written into the document, so it has no row and no class.
const HANDED_OUT_AS_MARKUP = new Set(['arrow-uturn-left.svg']);
for (const file of present) {
  if (HANDED_OUT_AS_MARKUP.has(file)) continue;
  if (!rows.some((row) => row.file === file)) problems.push(`src/assets/${file} has no row in design/icons.md`);
}

// A data: URI inside a CSS url(""): the characters a URL cannot carry raw, and double quotes swapped for single so the value survives its own quoting.
function encode(svg) {
  return svg
    .replace(/currentColor/g, '#000')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .trim()
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\{/g, '%7B')
    .replace(/\}/g, '%7D');
}

const lines = [
  '/* Generated from design/icons.md by `just bundle-icons`. Do not edit. */',
  '/* One class per icon, drawn as a mask so the control it sits in colors it. */',
  '.lt-icon {',
  '  display: inline-block;',
  '  flex: none;',
  '  width: 16px;',
  '  height: 16px;',
  '  background-color: currentColor;',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '}',
];
// Every stroke in a drawing, set to one weight. The row decides; the number a file happens to carry is only a note, and the check below holds the two together.
const STROKE_WIDTH = /stroke-width=(['"])[\d.]+\1/g;
const atWeight = (svg, value) => svg.replace(STROKE_WIDTH, `stroke-width="${value}"`);
let drawn = 0;
const heavy = [];
for (const { name, file, stroke, heavy: wantsHeavy } of rows) {
  const raw = readFileSync(join(root, 'src/assets', file), 'utf8');
  const drawnAt = [...raw.matchAll(STROKE_WIDTH)].map((match) => match[0]);
  const wanted = WEIGHTS.get(stroke);
  if (Boolean(drawnAt.length) !== Boolean(wanted)) {
    problems.push(
      wanted
        ? `design/icons.md gives ${name} the ${stroke} stroke, but ${file} draws none`
        : `${file} draws a stroke, so ${name} needs a weight in design/icons.md rather than the dash`
    );
    continue;
  }
  // What you open has to be what ships, so a file drawn at another weight is named rather than quietly restamped.
  const off = drawnAt.find((match) => !match.includes(`"${wanted}"`));
  if (off) {
    problems.push(`src/assets/${file} draws ${off}, but design/icons.md gives ${name} the ${stroke} stroke (${wanted})`);
    continue;
  }
  const uri = `url("data:image/svg+xml,${encode(wanted ? atWeight(raw, wanted) : raw)}")`;
  lines.push(`.lt-icon-${name} {`, `  -webkit-mask-image: ${uri};`, `  mask-image: ${uri};`, '}');
  drawn += 1;
  if (!wantsHeavy) continue;
  const bolder = atWeight(raw, WEIGHTS.get('heavy'));
  heavy.push(`  --lt-icon-${name}-heavy: url("data:image/svg+xml,${encode(bolder)}");`);
}
if (heavy.length) {
  // Properties rather than classes: the rule that swaps to one belongs to the component that has an active state, not to the icon.
  lines.push('/* The bolder drawing an active control swaps to. */', ':root {', ...heavy, '}');
}
const css = lines.join('\n') + '\n';

if (problems.length) {
  console.error('design/icons.md and the files disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

let current = '';
try {
  current = readFileSync(join(root, target), 'utf8');
} catch {
  current = '';
}
if (current === css) {
  console.log(`icons: ${drawn} classes and ${heavy.length} heavy masks from ${rows.length} rows — ${target} matches`);
  process.exit(0);
}
if (check) {
  console.error(`${target} has drifted from design/icons.md — run \`just bundle-icons\``);
  process.exit(1);
}
writeFileSync(join(root, target), css);
console.log(`icons: wrote ${drawn} classes and ${heavy.length} heavy masks to ${target}`);
