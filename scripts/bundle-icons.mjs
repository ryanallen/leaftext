#!/usr/bin/env node
// design/icons.md is the list of icons; this compiles it into src/assets/icons.css, one `.lt-icon-<name>` mask class each. The page then wears an icon by name — `<span class="lt-icon lt-icon-back"></span>` — so a drawing used five times is in the app once. The code-view icon was pasted in five places, the heading icon three.
//
//   node scripts/bundle-icons.mjs           write src/assets/icons.css and src/assets/mermaid-icons.js
//   node scripts/bundle-icons.mjs --check   fail on drift in either, after proving the copy rule on made-up rows (`just verify`)
//
// The second output is the same rows as an icon set mermaid can be handed, so `A@{ icon: "leaf:back" }` in a diagram draws the app's own back arrow. It is generated for the same reason the stylesheet is: design/icons.md stays the only place an icon is named, and a second hand-written list of them would drift the way the stroke weights did. Without it mermaid substitutes its own unknown-icon glyph — an 80x80 square in a hardcoded #087ebf, which is the one color in a diagram no theme chose.
//
// A mask reads only alpha, so the copy in the URI is painted flat black and the visible color comes from `background-color: currentColor` on the base class. That is what made the move possible at all: `normalize_svg_icon_colors` had already turned every fill and stroke into `currentColor`, so no icon carried a color.
//
// A row marked `heavy` gets a second mask drawn at the heavy weight, published as `--lt-icon-<name>-heavy` so a rule can swap to it — the active view is drawn bolder as well as brighter, and a mask has no strokes to thicken. The footnote arrow is not listed: the renderer hands it out as markup. `missing-image.svg` has a row, because a diagram falls back to it.
//
// The row's Stroke cell is the line weight, and it is stamped over whatever the file draws at. A drawing arrives carrying its tool's number; left alone those drift, and this set had reached seven weights before the column existed.
//
// The row's Source cell is the pack the drawing came from, and a pack named there has to have its license notice beside the drawings. The box beside a weight is the box that number was set for, and a drawing in a wider box is scaled up to it: a weight only means a thickness once you know how many units across the drawing is, so left alone a 32-unit drawing taking the regular weight comes out at three quarters of everything beside it.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const target = 'src/assets/icons.css';
const setTarget = 'src/assets/mermaid-icons.js';
const themeTarget = 'src/theme.rs';
// The third generated answer, and the only one that is a slice of another file rather than a file of its own: where each pack's block sits in the sheet above, so an exported page can be handed the one pack it wears.
const RANGES_START = '// GENERATED from design/icons.md by `just bundle-icons` — do not edit by hand.';
const RANGES_END = '// END GENERATED ICON PACKS';

// The named line weights and the box each was set for, read out of the Stroke table so both values live in design/ like every other one. `—` is a drawing with no strokes at all, held to no box.
const md = readFileSync(join(root, 'design/icons.md'), 'utf8');
const WEIGHTS = new Map([['—', null]]);
const BOXES = new Map([['—', null]]);
for (const [, name, value, box] of md.matchAll(/^\| (regular|heavy|hairline) \| ([0-9.]+) \| ([0-9.]+) \|/gm)) {
  WEIGHTS.set(name, value);
  BOXES.set(name, box);
}
for (const named of ['regular', 'heavy', 'hairline']) {
  if (!WEIGHTS.has(named)) throw new Error(`design/icons.md has no ${named} row in its Stroke table`);
  if (!BOXES.get(named)) throw new Error(`design/icons.md gives ${named} no Box in its Stroke table`);
}

// The packs a theme family may wear, read out of the Packs table. `leaftext` is the set below it — the app's own drawings, held to the Stroke table's boxes and weights — and every other row is an outside set with a folder of its own, its own box, and its own answer to whether it draws with strokes at all. Both are needed before a pack can compile: Phosphor draws in a 256-unit box and Remix fills rather than strokes, and the weight rule above would refuse either of them whole.
const PACKS = new Map();
const packsSection = /\n## Packs\n([\s\S]*?)(?=\n## |$)/.exec(md);
if (!packsSection) throw new Error('design/icons.md has no ## Packs section, so nothing says which sets a family may wear');
for (const line of packsSection[1].split('\n')) {
  const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map((cell) => cell.trim()) : [];
  if (cells.length !== 4 || cells[0] === 'Pack' || /^-{3,}$/.test(cells[1])) continue;
  const [name, notice, box, drawn] = cells;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`design/icons.md: "${name}" is not a pack name`);
  PACKS.set(name, { notice, box, stroked: /\bstroked\b/.test(drawn) });
}
if (!PACKS.has('leaftext')) throw new Error('design/icons.md has no leaftext row in its Packs table, so the app\'s own set is not a pack a family can name');
/** Every pack but this app's own, which has no folder of drawings and takes the Stroke table's rule instead. */
const outsidePacks = () => [...PACKS.keys()].filter((pack) => pack !== 'leaftext');

// An icon row is its drawing, then the label and one decision per outside pack, then the sentence saying where it is worn: five, one, six, one. Written down because the row is read positionally and a column added in the middle would otherwise slide the sentence into a decision.
const ICON_COLUMNS = 6 + PACKS.size;

// The rows that carry a class, and the ones that only carry a drawing.
const rows = [];
for (const line of md.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  if (cells.length !== ICON_COLUMNS || cells[0] === 'Name' || /^-{3,}$/.test(cells[1])) continue;
  const [name, file, source, stroke, heavy, audit, ...rest] = cells;
  const worn = rest.pop();
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`design/icons.md: "${name}" is not an icon name`);
  if (!WEIGHTS.has(stroke)) throw new Error(`design/icons.md: ${name} asks for stroke "${stroke}", which the Stroke table does not name`);
  rows.push({ name, file, source, stroke, heavy: heavy.toLowerCase() === 'yes', audit, decided: rest, worn });
}
if (rows.length < 30) throw new Error(`design/icons.md gave only ${rows.length} icons`);

// A notice is named for its pack and then its license. The file name is capitalized and the row is not, so the case is set aside.
const noticeFor = (source, notices) => [...notices].find((f) => f.toLowerCase().startsWith(`${source.toLowerCase()}-`));
// Everything one row can be wrong about on its own, in one place so a made-up row can be put through the same code the sixty go through. `svg` is the drawing's text and `notices` the `.md` files beside it; it hands back what is wrong with the row, empty when nothing is.
function rowProblems({ name, file, source, stroke }, svg, notices) {
  const found = [];
  if (!source || source === '—') found.push(`design/icons.md gives ${name} no Source, so nobody can say which pack ${file} came from`);
  else if (source !== 'leaftext' && !noticeFor(source, notices)) {
    found.push(`design/icons.md sources ${name} to ${source}, but src/assets/ carries no ${source}-<license>.md notice for it`);
  }
  const box = BOXES.get(stroke);
  if (box) {
    const drawn = VIEWBOX.exec(svg);
    if (!drawn) found.push(`src/assets/${file} has no square viewBox, so ${name}'s ${stroke} weight cannot be held to a box`);
    else if (drawn[1] !== box || drawn[2] !== box) {
      found.push(`src/assets/${file} is drawn in a ${drawn[1]}x${drawn[2]} box, but design/icons.md gives ${name} the ${stroke} stroke, which is set for ${box}`);
    }
  }
  return found;
}

// Everything one row's six decisions can be wrong about. A decision is what that pack draws this job with: its own drawing by name, `<pack>:<name>` where the audit approved a borrow from another pack, `<name> filled` where a pack's own outline path is filled instead, or `leaftext` where the pack has nothing for this job and keeps the drawing the reader already knows. A row missing one is a drawing nobody chose, which is how share and network shapes ended up where the app draws a graph.
//
// The `leaftext` half is the one that has to agree with the disk, and it is the only half that can: a decision naming a drawing is a name in somebody else's pack, and nothing here can look it up. So `leaftext` must have no file and anything else must have one.
const PROTECTED = new Set(['leaf', 'windows', 'apple']);
function decisionProblems({ name, audit, decided }, drawings) {
  const found = [];
  if (!audit) found.push(`design/icons.md gives ${name} no audit label, so the chart has nothing to call it`);
  const packs = outsidePacks();
  if (decided.length !== packs.length) {
    found.push(`design/icons.md gives ${name} ${decided.length} of ${packs.length} pack decisions, so at least one pack has no answer for it`);
    return found;
  }
  decided.forEach((said, at) => {
    const pack = packs[at];
    if (!said) return found.push(`design/icons.md leaves ${name} undecided under ${pack}`);
    if (PROTECTED.has(name) && said !== 'leaftext') {
      found.push(`design/icons.md gives ${name} the ${pack} drawing "${said}", and the app's own marks are never an outside pack's`);
      return;
    }
    const has = (drawings.get(pack) || new Map()).has(name);
    if (said === 'leaftext' && has) found.push(`design/icons.md says ${name} keeps the Leaftext drawing under ${pack}, and src/assets/icon-packs/${pack}/${name}.svg is there`);
    if (said !== 'leaftext' && !has) found.push(`design/icons.md gives ${name} the ${pack} drawing "${said}", and src/assets/icon-packs/${pack}/${name}.svg is not there`);
  });
  return found;
}

// Everything one outside drawing can be wrong about, held to the box its own pack's row declares. Never the pack's weight: what is stamped is the icon row's, and only where the drawing has strokes to stamp — a filled glyph inside a stroked pack is a drawing, not a fault. A borrowed drawing arrives in the lending pack's box, so it is held to that row's box rather than the wearer's — which is why the decision column has to be read before the box is chosen.
function packProblems(pack, icon, svg, drewIt = pack) {
  const from = PACKS.get(drewIt) ? drewIt : pack;
  const { box } = PACKS.get(from);
  const found = [];
  const drawn = VIEWBOX.exec(svg);
  if (!drawn) found.push(`src/assets/icon-packs/${pack}/${icon}.svg has no square viewBox, so nothing can say what box it is drawn in`);
  else if (drawn[1] !== drawn[2]) found.push(`src/assets/icon-packs/${pack}/${icon}.svg is drawn in a ${drawn[1]}x${drawn[2]} box, and every icon here is square`);
  else if (drawn[1] !== box) {
    const said = from === pack ? `design/icons.md says ${pack} draws in ${box}` : `design/icons.md borrows it from ${from}, which draws in ${box}`;
    found.push(`src/assets/icon-packs/${pack}/${icon}.svg is drawn in a ${drawn[1]}-unit box, and ${said}`);
  }
  return found;
}

/** Which pack actually drew the file in `<pack>/<icon>.svg`, off that row's decision: itself, or the one a `<pack>:<name>` borrow names. */
function drewIt(pack, icon) {
  const row = rows.find((one) => one.name === icon);
  const said = row && row.decided[outsidePacks().indexOf(pack)];
  const borrowed = said && /^([a-z][a-z0-9-]*):/.exec(said);
  return borrowed ? borrowed[1] : pack;
}

const problems = [];
const present = new Set(readdirSync(join(root, 'src/assets')).filter((f) => f.endsWith('.svg')));
const notices = new Set(readdirSync(join(root, 'src/assets')).filter((f) => f.endsWith('.md')));
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

const head = [
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
// The weight a drawing actually takes. A number in the Stroke table is a thickness only alongside the box it was set for, so the same number in a wider box draws a thinner line: the window's hairline is 1 in 12 units, and a pack's 24-unit drawing took that 1 and came out at half the app's own line. The same box, or either box unknown, hands the row's own characters straight back, so an unchanged drawing compiles byte for byte.
function weightInBox(value, setFor, drawnIn) {
  if (!value || !setFor || !drawnIn || setFor === drawnIn) return value;
  return String(Number(((Number(value) * Number(drawnIn)) / Number(setFor)).toFixed(4)));
}
// The box a pack's drawing is actually in: its own pack's, or the box of the pack a borrow names, which is the lookup the box check already makes.
const boxDrawnIn = (pack, from) => (PACKS.get(from) || PACKS.get(pack)).box;
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
// Two rows that land on one mask are two controls wearing one drawing — Remove vault wore the Back arrow, and a plain folder wore the open one. The comparison is on the mask rather than the file, after the row's weight is stamped: an inert attribute or a stray newline cannot hide a copy, and the speed reader's two rows — one shape at two named weights — are two masks and not a copy.
function collisions(masks) {
  const seen = new Map();
  const found = [];
  for (const mask of masks) {
    const first = seen.get(mask.uri);
    if (first) found.push(`${mask.label} draws the same mask as ${first.label} — one of them is a copy of the other`);
    else seen.set(mask.uri, mask);
  }
  return found;
}
// The rules prove their own refusals on made-up rows, ahead of the real table: a check that only ever sees good rows is one nobody has watched refuse anything, and putting this last would skip it on the runs where something is actually wrong.
if (check) {
  const one = { label: 'a (a.svg)', uri: 'x' };
  const fails = [];
  if (collisions([one, { label: 'b (b.svg)', uri: 'x' }]).length !== 1) fails.push('two rows on one mask were accepted');
  if (collisions([one, { label: 'b (b.svg)', uri: 'y' }]).length) fails.push('two different masks were called a copy');

  const box = (n) => `<svg viewBox="0 0 ${n} ${n}"><path d="M0 0" stroke-width="1.5"/></svg>`;
  const held = new Set(['Heroicons-MIT.md']);
  const row = (source, stroke) => ({ name: 'x', file: 'x.svg', source, stroke });
  const refuses = [
    ['a row with no Source', row('', 'regular'), box(24), held, 'no Source'],
    ['a Source naming a pack with no notice', row('feather', 'regular'), box(24), held, 'no feather-<license>.md'],
    ['a regular drawing in a 32-unit box', row('leaftext', 'regular'), box(32), held, 'is set for 24'],
    ['a hairline drawing in a 24-unit box', row('leaftext', 'hairline'), box(24), held, 'is set for 12'],
  ];
  for (const [what, made, svg, notices_, wanted] of refuses) {
    const got = rowProblems(made, svg, notices_).join(' ');
    if (!got.includes(wanted)) fails.push(`${what} was not refused (got "${got || 'nothing'}")`);
  }
  // And the other direction, so a rule refuses the wrong row rather than every row.
  const accepts = [
    ['a leaftext row with no notice anywhere', row('leaftext', 'regular'), box(24), new Set()],
    ['a pack whose notice is capitalized', row('heroicons', 'regular'), box(24), held],
    ['a strokeless drawing in a 64-unit box', row('leaftext', '—'), box(64), new Set()],
    ['a hairline drawing in a 12-unit box', row('heroicons', 'hairline'), box(12), held],
  ];
  for (const [what, made, svg, notices_] of accepts) {
    const got = rowProblems(made, svg, notices_);
    if (got.length) fails.push(`${what} was refused: ${got.join(' ')}`);
  }

  // The scale, on made-up weights and boxes. The accepted cases are the point of this one: the same hairline row has to land at 1 in the box it was set for and at 2 in a pack drawing twice as wide, and every regular row has to come out where it already is or sixty drawings move.
  const scales = [
    ['a hairline row on a 24-unit pack drawing', ['1', '12', '24'], '2'],
    ['a hairline row on the 12-unit drawing it was set for', ['1', '12', '12'], '1'],
    ['a regular row on a 24-unit drawing', ['1.5', '24', '24'], '1.5'],
    ['a heavy row on a 12-unit drawing', ['2.25', '24', '12'], '1.125'],
    ['a hairline row on a 256-unit drawing', ['1', '12', '256'], '21.3333'],
    ['a strokeless row, held to no box at all', [null, null, null], null],
  ];
  for (const [what, [value, setFor, drawnIn], wanted] of scales) {
    const got = weightInBox(value, setFor, drawnIn);
    if (got !== wanted) fails.push(`${what} was stamped at ${got}, not ${wanted}`);
  }
  // Which box a drawing is measured in. A borrowed one arrives in the lending pack box, so it is scaled against that rather than against the box of the pack wearing it — the same lookup the box refusals above make.
  const measured = [
    ['a drawing borrowed from the 256-unit pack', ['feather', 'phosphor'], '256'],
    ['a drawing a pack made for itself', ['feather', 'feather'], '24'],
    ['a borrow naming a pack the table does not carry', ['feather', 'nobody'], '24'],
  ];
  for (const [what, [pack, from], wanted] of measured) {
    const got = boxDrawnIn(pack, from);
    if (got !== wanted) fails.push(`${what} was measured in a ${got}-unit box, not a ${wanted}-unit one`);
  }

  // The pack rules, proved the same way and on the same made-up shapes. A pack is where an outside set's box and stroke stop being the weight table's business, so the refusals are what stop a folder of drawings nobody declared compiling into a theme.
  const boxes = new Set(['24', '256']);
  const refusesPack = [
    ['a drawing with no viewBox', 'feather', '<svg><path d="M0 0"/></svg>', 'no square viewBox'],
    ['a drawing that is not square', 'feather', '<svg viewBox="0 0 24 16"><path d="M0 0"/></svg>', 'every icon here is square'],
    ['a drawing in a box its pack does not draw in', 'feather', box(33), 'design/icons.md says feather draws in 24'],
    ['a drawing borrowed from a pack with a bigger box', 'feather', box(256), 'design/icons.md says feather draws in 24'],
    ['a 24-unit drawing dropped into the pack that draws at 256', 'phosphor', box(24), 'design/icons.md says phosphor draws in 256'],
  ];
  for (const [what, pack, svg, wanted] of refusesPack) {
    const got = packProblems(pack, 'x', svg).join(' ');
    if (!got.includes(wanted)) fails.push(`${what} was not refused (got "${got || 'nothing'}")`);
  }
  for (const [what, pack, svg] of [
    ['a stroked drawing in its pack\'s own box', 'feather', box(24)],
    ['a filled drawing in its pack\'s own bigger box', 'phosphor', box(256)],
  ]) {
    const got = packProblems(pack, 'x', svg);
    if (got.length) fails.push(`${what} was refused: ${got.join(' ')}`);
  }
  // The decision rules, on made-up rows put through the same code the sixty-three go through. Every one of these is a way a new icon reaches the app without anybody choosing what it looks like under six other themes, which is the whole reason the column exists.
  const drew = new Map([['feather', new Map([['x', '<svg/>']])], ['lucide', new Map()]]);
  const decision = (name, decided, audit = name) => ({ name, audit, decided });
  const six = (...said) => [...said, ...Array(outsidePacks().length - said.length).fill('leaftext')];
  const refusesDecision = [
    ['a row with no audit label', decision('x', six('x'), ''), 'no audit label'],
    ['a row short of a decision', { name: 'x', audit: 'x', decided: ['x'] }, 'of 6 pack decisions'],
    ['a decision left empty', decision('x', ['x', '', 'leaftext', 'leaftext', 'leaftext', 'leaftext']), 'leaves x undecided under lucide'],
    ['a decision naming a drawing nobody vendored', decision('x', six('x', 'thing')), 'src/assets/icon-packs/lucide/x.svg is not there'],
    ['a fallback claimed where a drawing is vendored', decision('x', six('leaftext')), 'src/assets/icon-packs/feather/x.svg is there'],
    ['an outside drawing offered for one of the app\'s own marks', decision('leaf', six('leaf')), 'marks are never an outside pack'],
  ];
  for (const [what, made, wanted] of refusesDecision) {
    const got = decisionProblems(made, drew).join(' ');
    if (!got.includes(wanted)) fails.push(`${what} was not refused (got "${got || 'nothing'}")`);
  }
  for (const [what, made] of [
    ['a complete row whose every decision agrees with the disk', decision('x', six('x'))],
    ['a protected mark kept in every pack', decision('leaf', six(), 'logo')],
  ]) {
    const got = decisionProblems(made, drew);
    if (got.length) fails.push(`${what} was refused: ${got.join(' ')}`);
  }

  // A pack row owes a license notice, exactly as a row's Source does. Read here off the same table the compile reads, so a row that stopped naming one is caught before a single drawing of it ships.
  for (const [pack, { notice }] of PACKS) {
    if (pack === 'leaftext') continue;
    if (!/^[A-Za-z][A-Za-z0-9]*-[A-Za-z0-9.]+\.md$/.test(notice)) {
      fails.push(`design/icons.md gives ${pack} the notice "${notice}", which is not a <Pack>-<License>.md file name`);
    }
  }

  if (fails.length) {
    console.error('bundle-icons: the row rules do not hold:');
    for (const fail of fails) console.error(`  ${fail}`);
    process.exit(1);
  }
}

// The second pass, over the pack folders. The scan of `src/assets/` is one level deep and refuses a loose `.svg` no row names; a pack folder is refused the same way, by a pack with no row and by a drawing named after no icon — otherwise a file dropped in the wrong folder compiles into a theme nobody chose.
const packFolder = (pack) => join(root, 'src/assets/icon-packs', pack);
const packDrawings = new Map();
let packsFolder = [];
try {
  packsFolder = readdirSync(join(root, 'src/assets/icon-packs'), { withFileTypes: true });
} catch {
  packsFolder = [];
}
for (const entry of packsFolder) {
  if (!entry.isDirectory()) {
    problems.push(`src/assets/icon-packs/${entry.name} is not a pack folder, and only a pack's folder belongs there`);
    continue;
  }
  if (!PACKS.has(entry.name) || entry.name === 'leaftext') {
    problems.push(`src/assets/icon-packs/${entry.name}/ has no row in design/icons.md's Packs table, so no theme can name it`);
    continue;
  }
  const drawings = new Map();
  for (const file of readdirSync(packFolder(entry.name))) {
    if (!file.endsWith('.svg')) {
      problems.push(`src/assets/icon-packs/${entry.name}/${file} is not a drawing, and a pack folder holds nothing else`);
      continue;
    }
    const icon = file.slice(0, -4);
    if (!rows.some((row) => row.name === icon)) {
      problems.push(`src/assets/icon-packs/${entry.name}/${file} is named after no icon in design/icons.md, so nothing would ever wear it`);
      continue;
    }
    const svg = readFileSync(join(packFolder(entry.name), file), 'utf8');
    problems.push(...packProblems(entry.name, icon, svg, drewIt(entry.name, icon)));
    drawings.set(icon, svg);
  }
  packDrawings.set(entry.name, drawings);
}
for (const pack of outsidePacks()) {
  if (!packDrawings.has(pack)) continue;
  const { notice } = PACKS.get(pack);
  if (!notices.has(notice)) problems.push(`design/icons.md gives ${pack} the notice ${notice}, which is not in src/assets/`);
}
// Every row's six decisions, asked only once every pack folder has been read: the answer to "does this pack draw this job" is the folder, and half of what a decision claims is exactly that.
for (const row of rows) problems.push(...decisionProblems(row, packDrawings));

// Which pack each theme family wears, off a `**Pack:**` header line beside `**Family ID:**` — a family file has no per-family table to add a column to, and the header lines are already how a family declares itself. A file written before packs existed names none and gets `leaftext`, which is the set it is already wearing, so an old family is not a blank theme.
const familyPacks = new Map();
for (const file of readdirSync(join(root, 'themes')).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
  const family = readFileSync(join(root, 'themes', file), 'utf8');
  const id = /^\*\*Family ID:\*\*\s*`([^`]+)`/m.exec(family);
  if (!id) {
    problems.push(`themes/${file} names no Family ID, so nothing can say which pack it wears`);
    continue;
  }
  const named = /^\*\*Pack:\*\*\s*`([^`]+)`/m.exec(family);
  const pack = named ? named[1] : 'leaftext';
  if (!PACKS.has(pack)) {
    problems.push(`themes/${file} wears ${pack}, which has no row in design/icons.md's Packs table`);
    continue;
  }
  familyPacks.set(id[1], pack);
}

let drawn = 0;
const values = [];
const classes = [];
const heavy = [];
const set = [];
const masks = [];
for (const row of rows) {
  const { name, file, stroke, heavy: wantsHeavy } = row;
  const raw = readFileSync(join(root, 'src/assets', file), 'utf8');
  problems.push(...rowProblems(row, raw, notices));
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
  // No scale here: one of the app's own drawings is refused unless it sits in the box its weight was set for.
  const stamped = wanted ? atWeight(raw, wanted) : raw;
  const uri = `url("data:image/svg+xml,${encode(stamped)}")`;
  masks.push({ label: `${name} (${file})`, uri });
  values.push(`  --lt-icon-${name}: ${uri};`);
  classes.push(`.lt-icon-${name} {`, `  -webkit-mask-image: var(--lt-icon-${name});`, `  mask-image: var(--lt-icon-${name});`, '}');
  const entry = iconSetEntry(name, stamped);
  if (!entry) problems.push(`src/assets/${file} has no viewBox, or no <svg> wrapper, so ${name} cannot be an icon in a diagram`);
  else set.push(entry);
  drawn += 1;
  if (!wantsHeavy) continue;
  // Heavy is set for a 24-unit box, and the row being drawn may not be in one, so the second mask is scaled the same way a pack's drawing is.
  const heavier = weightInBox(WEIGHTS.get('heavy'), BOXES.get('heavy'), BOXES.get(stroke));
  const bolder = `url("data:image/svg+xml,${encode(atWeight(raw, heavier))}")`;
  masks.push({ label: `${name} heavy (${file})`, uri: bolder });
  heavy.push(`  --lt-icon-${name}-heavy: ${bolder};`);
}
problems.push(...collisions(masks));

// One block per pack, not one per family: eleven families sharing six packs is six copies of a drawing rather than eleven, and a drawing is the expensive thing in this file. The selector list is every family wearing that pack, and a family wearing `leaftext` needs no block at all — the root is already its set.
const packBlocks = [];
const uncovered = [];
for (const pack of outsidePacks()) {
  const drawings = packDrawings.get(pack);
  if (!drawings || !drawings.size) continue;
  const wearing = [...familyPacks].filter(([, worn]) => worn === pack).map(([family]) => family).sort();
  const covers = [];
  for (const row of rows) {
    const svg = drawings.get(row.name);
    // A pack with no file for this job declares nothing, so the root value stands and the reader sees the drawing they already know. That is the fallback, and it is a value left alone rather than a value written.
    if (!svg) { uncovered.push(`${pack} has no ${row.name}, so it keeps ${row.file}`); continue; }
    // The icon row's weight, scaled to the box this drawing is in and stamped only where there are strokes to stamp: a filled glyph inside a stroked pack, and every drawing of a filled pack, take none. A borrowed drawing arrives in the lending pack's box, so the box comes off the same lookup the box check makes rather than off the pack wearing it.
    const wanted = WEIGHTS.get(row.stroke);
    const drawnIn = boxDrawnIn(pack, drewIt(pack, row.name));
    const stamped = wanted && STROKE_WIDTH.test(svg) ? atWeight(svg, weightInBox(wanted, BOXES.get(row.stroke), drawnIn)) : svg;
    STROKE_WIDTH.lastIndex = 0;
    covers.push(`  --lt-icon-${row.name}: url("data:image/svg+xml,${encode(stamped)}");`);
  }
  if (!covers.length) continue;
  // Two ways in, one copy of the drawings. `data-leaf-theme` on the page root is what the app writes, and `data-leaf-pack` is a name any element can take — which is how the design-system gallery shows all seven packs on one page, where seven page roots do not exist. Nothing in the app ever writes the second.
  const worn = wearing.length ? `worn by ${wearing.join(', ')}` : 'worn by no family yet';
  packBlocks.push({
    pack,
    lines: [
      `/* The ${pack} pack, ${worn}. Every drawing it does not cover keeps the one above. */`,
      [...wearing.map((family) => `:root[data-leaf-theme="${family}"]`), `[data-leaf-pack="${pack}"]`].join(',\n') + ' {',
      ...covers,
      '}',
    ],
  });
}

// Every drawing is a value the page root declares and the class reads, which is what lets a theme family redeclare the ones its pack covers without touching a class. It is also smaller: written into the rule a drawing is stored twice, once for each of the two mask properties, and written as a value it is stored once. The bolder masks sit in the same block, because a rule that swaps to one belongs to the component with an active state rather than to the icon.
const cssLines = [
  ...head,
  '/* Every drawing, declared once, so a theme family can redeclare the ones its pack covers. */',
  ':root {',
  ...values,
  ...(heavy.length ? ['  /* The bolder drawing an active control swaps to. */', ...heavy] : []),
  '}',
];
// Where each pack's block starts and ends in the sheet being written, in bytes, counted as the lines go in: this is the only place a block's exact shape is known, so reading the boundaries back off the finished CSS would be a second parser of the same thing.
const packRanges = [];
let at = cssLines.reduce((bytes, line) => bytes + Buffer.byteLength(line, 'utf8') + 1, 0);
for (const block of packBlocks) {
  const start = at;
  for (const line of block.lines) at += Buffer.byteLength(line, 'utf8') + 1;
  packRanges.push([block.pack, start, at]);
  cssLines.push(...block.lines);
}
cssLines.push(...classes);
const css = cssLines.join('\n') + '\n';

// A fragment of the page's one script, so it declares a `const` and nothing else — there is no module loader to export to. decorate.js hands it to mermaid.registerIconPacks once, and rewrites an `icon:` it cannot find to the missing-picture row before mermaid ever sees the block.
if (!set.some((entry) => entry.startsWith("  'missing-image'"))) {
  problems.push('design/icons.md has no missing-image row, which is the mark a diagram falls back to');
}
const js = [
  '// Generated from design/icons.md by `just bundle-icons`. Do not edit. The app\'s own drawings as an icon set mermaid can draw a box with: `A@{ icon: "leaf:back" }`.',
  "const LEAF_MERMAID_ICON_PREFIX = 'leaf';",
  'const LEAF_MERMAID_ICONS = {',
  `  prefix: ${JSON.stringify('leaf')},`,
  '  icons: {',
  ...set.map((entry) => '  ' + entry),
  '  },',
  '};',
].join('\n') + '\n';

// The pack ranges as the table `src/theme.rs` slices `icons.css` by. Spliced between markers rather than written as a file of its own, because these numbers are only true of the exact sheet written above them and the two have to move together.
const theme = readFileSync(join(root, themeTarget), 'utf8');
const rangesFrom = theme.indexOf(RANGES_START);
const rangesTo = theme.indexOf(RANGES_END, rangesFrom);
if (rangesFrom < 0 || rangesTo < 0) {
  throw new Error(`${themeTarget} is missing the generated icon-pack markers`);
}
const rangesBlock = [
  RANGES_START,
  "/// Where each outside icon pack's block sits inside `assets/icons.css`, as `(pack, start, end)` byte offsets. Only true of the exact sheet beside them, which is why one generator writes both.",
  // One row per line whatever the count: rustfmt would fold a short list onto one line and the next run here would unfold it, so `just verify` would fail on drift with nothing to fix.
  '#[rustfmt::skip]',
  "pub(crate) const LEAF_ICON_PACK_RANGES: &[(&str, usize, usize)] = &[",
  ...packRanges.map(([pack, start, end]) => `    ("${pack}", ${start}, ${end}),`),
  '];',
  RANGES_END,
].join('\n');
const themeNext =
  theme.slice(0, rangesFrom) + rangesBlock + theme.slice(rangesTo + RANGES_END.length);

if (problems.length) {
  console.error('design/icons.md and the files disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const written = [];
for (const [path, wanted] of [[target, css], [setTarget, js], [themeTarget, themeNext]]) {
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
// What each pack does not cover, named one line at a time rather than counted, so the decision about a gap is made off a list rather than off somebody noticing a control looks wrong. Written rather than checked: a gap is not a fault, it is a drawing the reader keeps.
if (!check && uncovered.length) {
  console.log(`icons: ${uncovered.length} jobs no outside pack draws, each keeping the drawing it has:`);
  for (const gap of uncovered) console.log(`  ${gap}`);
}
const wearing = [...familyPacks.values()].filter((pack) => pack !== 'leaftext').length;
const made = `${drawn} classes, ${heavy.length} heavy masks and ${set.length} diagram icons from ${rows.length} rows, plus ${packDrawings.size} outside packs worn by ${wearing} of ${familyPacks.size} families`;
console.log(written.length ? `icons: wrote ${made} to ${written.join(' and ')}` : `icons: ${made} — every generated file matches`);
