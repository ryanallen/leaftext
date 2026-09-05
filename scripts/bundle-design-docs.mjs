#!/usr/bin/env node
// The published design-system page, written from design/ so it cannot drift from what the app draws. Every count and every name in it is read, not typed.
//
//   node scripts/bundle-design-docs.mjs           write the page
//   node scripts/bundle-design-docs.mjs --check   fail on drift (`just verify`)
//
// It is a summary and a pointer, not a copy: the four files under design/ are the source and are readable on their own, so repeating all 284 rows here would only be a second place to go stale. What the page carries is the shape of the system, the counts, and the commands.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const target = 'docs/02-development/05-design-system.md';

function rows(file) {
  const out = [];
  let group = '';
  for (const line of readFileSync(join(root, 'design', file), 'utf8').split('\n')) {
    if (line.startsWith('## ')) group = line.slice(3).trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || cells.some((c) => /^-{3,}$/.test(c))) continue;
    if (['Token', 'Component', 'Name', 'Pack'].includes(cells[0])) continue;
    out.push({ group, cells });
  }
  return out;
}

const colors = rows('colors.md');
const tokens = rows('tokens.md');
// Every set a theme family can wear, this app's own included.
const packs = rows('icons.md').filter(({ group, cells }) => group === 'Packs' && cells.length === 4);
// An icon row is its drawing, then the audit label and one decision per outside pack, then the sentence saying where it is worn. Counted off the Packs table, so a seventh pack widens the row here too.
const ICON_COLUMNS = 6 + packs.length;
// The rows that name a drawing, not the Stroke table's weights and not the Packs table's sets — a pack row has four columns where an icon row has six.
const icons = rows('icons.md').filter(({ cells }) => cells.length === ICON_COLUMNS && /\.svg$/.test(cells[1] || ''));
// Only the first table: the document prefixes and states after it account for classes, they are not components with markup to draw.
const components = rows('components.md').filter(({ group }) => !group.startsWith('What a document') && !group.startsWith('State'));
const themes = readFileSync(join(root, 'src/assets/themes.md'), 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('**Family ID:**')).length;

const group = (list) => {
  const counts = new Map();
  for (const { group: g } of list) counts.set(g, (counts.get(g) || 0) + 1);
  return counts;
};

const lines = [];
lines.push('<!-- Generated from design/ by `just bundle-design-docs`. Do not edit. -->');
lines.push('# Design system');
lines.push('');
lines.push(`> Every value in Leaftext's interface comes from a token. ${colors.length} of them are colors, which each theme sets for itself; ${tokens.length} are everything else, one value for the whole app. Nothing is written by hand, and a check fails the build when something is.`);
lines.push('');
lines.push('Four files under `design/` are the source. Each is plain Markdown, so Leaftext opens them.');
lines.push('');
lines.push('| File | Holds | Compiles to |');
lines.push('| --- | --- | --- |');
lines.push(`| \`design/colors.md\` | ${colors.length} color names and what each is for — no values, because a color's value belongs to a theme | the token contract in \`src/theme.rs\` |`);
lines.push(`| \`design/tokens.md\` | ${tokens.length} values that do not change with the theme | \`src/assets/tokens.css\` |`);
lines.push(`| \`design/icons.md\` | ${icons.length} icons | \`src/assets/icons.css\`, one mask class each |`);
lines.push(`| \`design/components.md\` | ${components.length} components, and the markup each is drawn with | \`src/assets/gallery.html\` |`);
lines.push('');
lines.push('## Colors');
lines.push('');
const optional = colors.filter(({ cells }) => cells[1]);
lines.push(`Grouped by what they dress. Every one of the ${themes} theme families gives ${colors.length - optional.length} of them a value, in light and in dark, and the app refuses to start if one is missing. ${optional.length === 1 ? 'The last is optional' : `The other ${optional.length} are optional`}: leave it out and the compiler copies the value of the color named beside it, so a family only says what it wants to differ.`);
lines.push('');
lines.push('| Group | Colors |');
lines.push('| --- | --- |');
for (const [name, count] of group(colors)) lines.push(`| ${name} | ${count} |`);
lines.push('');
lines.push('See [Theming](04-theming.md) for how a theme is written and how the compiler checks it.');
lines.push('');
lines.push('## Values');
lines.push('');
lines.push('One value each, whatever theme is on.');
lines.push('');
lines.push('| Group | Tokens |');
lines.push('| --- | --- |');
for (const [name, count] of group(tokens)) lines.push(`| ${name} | ${count} |`);
lines.push('');
lines.push('Widths, heights and positional offsets are **not** tokens: they are one component\'s geometry, used once, and a name for each would buy nothing. Nor is a document\'s `em` sizing, which follows the text on purpose.');
lines.push('');
lines.push('## Icons');
lines.push('');
lines.push(`${icons.length} icons, each a class drawn with \`mask-image\`. A mask reads only transparency, so the icon takes the color of whatever it sits in — and a drawing used in five places is in the app once. A control with a bolder active state swaps to a second mask rather than thickening a stroke a mask does not have. An outside pack redeclares that bolder mask beside its resting one; a filled pack has no stroke to stamp, so both masks use its own drawing and the pressed button changes color alone. Each row also names the pack its drawing came from, so a pack with no license notice in the app is refused, and its line weight names the box the drawing must be in.`);
lines.push('');
lines.push(`Every drawing is a value the page root declares and the class reads, which is what lets a theme family bring its own. A family names a whole pack on a \`**Pack:**\` line in its own file; the pack's drawings are copied into \`src/assets/icon-packs/<pack>/\`, one file per icon name, and compiled into one block of values under every family wearing it. A pack with no drawing for one of the ${icons.length} jobs declares nothing for it, so the value at the root stands and the reader keeps the drawing they already know. \`leaftext\` is a pack too — the app's own mixed set, a permanent choice, and the fallback for all ${packs.length - 1} outside ones.`);
lines.push('');
lines.push('## Components');
lines.push('');
lines.push(`${components.length} components. Each row names its class family, what builds it, and the markup the gallery draws it with — so a component that loses its styling, or gains a class nobody listed, fails the build.`);
lines.push('');
lines.push('| Component | Class family |');
lines.push('| --- | --- |');
for (const { cells } of components) lines.push(`| ${cells[0]} | \`.${cells[1]}\` |`);
lines.push('');
lines.push('## Looking at it');
lines.push('');
lines.push('[**leaftext.com/gallery.html**](https://leaftext.com/gallery.html) draws all of it on one page — every theme, every color, every value, every icon, and every part of the interface — with a switcher for the family and for light or dark.');
lines.push('');
lines.push('`just bundle-gallery` builds it from the four files above plus the app\'s own compiled stylesheet, which it gets by running the binary with `--dump-css`. The theme compiler is Rust, and a second one written in JavaScript would drift from it inside a week.');
lines.push('');
lines.push('It is a page in the repo, not a feature in the app: looking at every component is a job for whoever is building Leaftext, so it has no place in a reader\'s settings menu.');
lines.push('');
lines.push('## Keeping it');
lines.push('');
lines.push('`just verify` runs all of these. Each fails with the file and the line.');
lines.push('');
lines.push('| Check | Fails when |');
lines.push('| --- | --- |');
lines.push('| `check-tokens` | a generated token file has drifted from `design/`, a theme sets a color nothing lists, or a component row names a class family nothing styles |');
lines.push('| `check-icons` | `icons.css` has drifted, a row names a file that is not there, an SVG has no row, a row names no pack or one with no license notice, a drawing is in a box its weight was not set for, a pack covers a bolder state without declaring its mask, or two rows compile to the same mask |');
lines.push('| `check-gallery` | the gallery has drifted, or a component has no sample to draw it with |');
lines.push('| `check-classes` | a class in `src/assets/reading/` is not accounted for — as a component, as something a rendered document brings, or as a state |');
lines.push('| `check-design-docs` | this page has drifted from `design/` |');
lines.push('| `check-verify` | one of these checks is not in `just verify` |');
lines.push('| `check-literals` | a color, spacing, text size, weight, stroke, line height, letter spacing, opacity, duration, easing, shadow or layer is written by hand in `src/assets/reading/` |');
lines.push('| `check-themes` | the embedded theme bundle has drifted from `themes/` |');
lines.push('');
lines.push('To change a value: edit the file under `design/`, run `just bundle-tokens` (or `bundle-icons`, `bundle-gallery`), and never edit a generated file.');
lines.push('');

const page = lines.join('\n');

let current = '';
try {
  current = readFileSync(join(root, target), 'utf8');
} catch {
  current = '';
}
if (current === page) {
  console.log(`design docs: ${target} matches design/`);
  process.exit(0);
}
if (check) {
  console.error(`${target} has drifted from design/ — run \`just bundle-design-docs\``);
  process.exit(1);
}
writeFileSync(join(root, target), page);
console.log(`design docs: wrote ${target}`);
