#!/usr/bin/env node
// design/icons.md is the list of icons; this compiles it into src/assets/icons.css, one `.lt-icon-<name>` mask class each. The page then wears an icon by name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. The code-view icon was pasted in five places, the heading icon three.
//
//   node scripts/bundle-icons.mjs           write src/assets/icons.css and src/assets/mermaid-icons.js
//   node scripts/bundle-icons.mjs --check   fail on drift in either (`just verify`)
//
// The second output is the same rows as an icon set mermaid can be handed, so `A@{ icon: "leaf:back" }` in a diagram draws the app's own back arrow. It is generated for the same reason the stylesheet is: design/icons.md stays the only place an icon is named, and a second hand-written list of them would drift the way the stroke weights did. Without it mermaid substitutes its own unknown-icon glyph — an 80x80 square in a hardcoded #087ebf, which is the one color in a diagram no theme chose.
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
const setTarget = 'src/assets/mermaid-icons.js';

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
// What a drawing is once the `<svg>` wrapper is off it: the body an icon set carries, sized by the viewBox it was drawn in. `currentColor` is left alone, so the icon takes the ink of the diagram it lands in rather than a color of its own.
const VIEWBOX = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;
const OUTER_SVG = /^[\s\S]*?<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/;
function iconSetEntry(name, svg) {
  const box = VIEWBOX.exec(svg);
  const inner = OUTER_SVG.exec(svg);
  if (!box || !inner) return null;
  const body = inner[1].replace(/\s*\n\s*/g, '').trim();
  return `  '${name}': { body: ${JSON.stringify(body)}, width: ${box[1]}, height: ${box[2]} },`;
}
let drawn = 0;
const heavy = [];
const set = [];
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
  const stamped = wanted ? atWeight(raw, wanted) : raw;
  const uri = `url("data:image/svg+xml,${encode(stamped)}")`;
  lines.push(`.lt-icon-${name} {`, `  -webkit-mask-image: ${uri};`, `  mask-image: ${uri};`, '}');
  const entry = iconSetEntry(name, stamped);
  if (!entry) problems.push(`src/assets/${file} has no viewBox, or no <svg> wrapper, so ${name} cannot be an icon in a diagram`);
  else set.push(entry);
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

// A fragment of the page's one script, so it declares a `const` and nothing else — there is no module loader to export to. decorate.js hands it to mermaid.registerIconPacks once, and rewrites an `icon:` it cannot find to the missing-picture row before mermaid ever sees the block.
if (!set.some((entry) => entry.startsWith("  'missing-image'"))) {
  problems.push('design/icons.md has no missing-image row, which is the mark a diagram falls back to');
}
const js = [
  '// Generated from design/icons.md by `just bundle-icons`. Do not edit.',
  '// The app\'s own drawings as an icon set mermaid can draw a box with: `A@{ icon: "leaf:back" }`.',
  "const LEAF_MERMAID_ICON_PREFIX = 'leaf';",
  'const LEAF_MERMAID_ICONS = {',
  `  prefix: ${JSON.stringify('leaf')},`,
  '  icons: {',
  ...set.map((entry) => '  ' + entry),
  '  },',
  '};',
].join('\n') + '\n';

if (problems.length) {
  console.error('design/icons.md and the files disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const written = [];
for (const [path, wanted] of [[target, css], [setTarget, js]]) {
  let current = '';
  try {
    current = readFileSync(join(root, path), 'utf8');
  } catch {
    current = '';
  }
  if (current === wanted) continue;
  if (check) {
    console.error(`${path} has drifted from design/icons.md — run \`just bundle-icons\``);
    process.exit(1);
  }
  writeFileSync(join(root, path), wanted);
  written.push(path);
}
const made = `${drawn} classes, ${heavy.length} heavy masks and ${set.length} diagram icons from ${rows.length} rows`;
console.log(written.length ? `icons: wrote ${made} to ${written.join(' and ')}` : `icons: ${made} — both files match`);
