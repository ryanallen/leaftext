#!/usr/bin/env node
// Every color, every value, every icon and every component on one page, drawn by the
// app's own stylesheet — so a change to the interface can be looked at instead of
// imagined.
//
//   node scripts/bundle-gallery.mjs           write src/assets/gallery.html
//   node scripts/bundle-gallery.mjs --check   fail on drift (`just verify`)
//
// Generated from design/, so it cannot fall behind: a token added there appears here,
// and a component row with no sample markup fails the build rather than showing an
// empty box. The page links `app.css`, which is the real stylesheet with the real
// theme, and carries the theme bootstrap's own attributes so the picker in it works.
//
// It is served over the asset protocol beside app.css and app.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const target = 'src/assets/gallery.html';

// `| a | b | …` rows under a `## Heading`, with the heading they sit under.
function tables(markdown) {
  const rows = [];
  let group = '';
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) group = line.slice(3).trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || cells.some((c) => /^-{3,}$/.test(c))) continue;
    if (['Token', 'Component', 'Name'].includes(cells[0])) continue;
    rows.push({ group, cells });
  }
  return rows;
}

const colors = tables(readFileSync(join(root, 'design/colors.md'), 'utf8'));
const tokens = tables(readFileSync(join(root, 'design/tokens.md'), 'utf8'));
const icons = tables(readFileSync(join(root, 'design/icons.md'), 'utf8'));
const components = tables(readFileSync(join(root, 'design/components.md'), 'utf8'));

const problems = [];
for (const { cells } of components) {
  const [name, family, , sample] = cells;
  const markup = (sample || '').replace(/^`|`$/g, '').split('\\|').join('|');
  if (!markup) problems.push(`design/components.md: ${name} has no sample to draw`);
  else if (!markup.includes(family)) {
    problems.push(`design/components.md: ${name}'s sample does not use .${family}`);
  }
}
if (problems.length) {
  console.error('the gallery cannot be drawn:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One block per group, so the page reads in the same order design/ does.
function byGroup(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row.cells);
  }
  return groups;
}

const out = [];
out.push('<!-- Generated from design/ by `just bundle-gallery`. Do not edit. -->');
out.push('<meta charset="utf-8">');
out.push('<title>Leaftext — the interface, drawn</title>');
out.push('<link rel="stylesheet" href="{{APP_CSS_URL}}">');
out.push('<style>');
out.push('  body { margin: 0; padding: 24px; background: var(--lt-background); color: var(--lt-foreground); font-family: var(--app-font); }');
out.push('  h1 { font-size: 22px; margin: 0 0 4px; }');
out.push('  h2 { font-size: 15px; margin: 32px 0 4px; }');
out.push('  h3 { font-size: 12px; margin: 20px 0 6px; color: var(--lt-muted-foreground); font-weight: var(--lt-weight-600); }');
out.push('  p.lead { margin: 0 0 8px; color: var(--lt-muted-foreground); font-size: var(--lt-text-12); }');
out.push('  .wall { display: flex; flex-wrap: wrap; gap: 8px; }');
out.push('  .swatch { width: 132px; }');
out.push('  .swatch i { display: block; height: 40px; border-radius: var(--lt-radius-md); box-shadow: var(--lt-shadow-hairline); }');
out.push('  .swatch code, .value code { font-family: var(--code-font); font-size: var(--lt-text-10); color: var(--lt-muted-foreground); word-break: break-all; }');
out.push('  .value { width: 200px; }');
out.push('  .glyph { width: 84px; text-align: center; color: var(--lt-foreground); }');
out.push('  .glyph .lt-icon { width: 24px; height: 24px; }');
out.push('  .glyph code { display: block; }');
out.push('  .part { border: var(--lt-stroke-1) solid var(--lt-border); border-radius: var(--lt-radius-lg); padding: 12px; margin: 0 0 12px; }');
out.push('  .part > header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 10px; }');
out.push('  .part h3 { margin: 0; }');
out.push('  .part .built { color: var(--lt-muted-foreground); font-size: var(--lt-text-10); }');
out.push('  .stage { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }');
out.push('</style>');
out.push('<h1>The interface, drawn</h1>');
out.push('<p class="lead">Generated from <code>design/</code> and painted by the app\'s own stylesheet. Switch theme in the app and reopen to see this in it.</p>');

out.push('<h2>Colors</h2>');
out.push(`<p class="lead">${colors.length} names. Each theme gives all of them a value; these are the one in force.</p>`);
for (const [group, rows] of byGroup(colors)) {
  out.push(`<h3>${escape(group)}</h3><div class="wall">`);
  for (const [name] of rows) {
    out.push(`<div class="swatch"><i style="background: var(--lt-${name})"></i><code>${name}</code></div>`);
  }
  out.push('</div>');
}

out.push('<h2>Values</h2>');
out.push(`<p class="lead">${tokens.length} tokens that do not change with the theme.</p>`);
for (const [group, rows] of byGroup(tokens)) {
  out.push(`<h3>${escape(group)}</h3><div class="wall">`);
  for (const [name, value] of rows) {
    out.push(`<div class="value"><code>${name}</code><br><code>${escape(value.replace(/^`|`$/g, ''))}</code></div>`);
  }
  out.push('</div>');
}

out.push('<h2>Icons</h2>');
out.push(`<p class="lead">${icons.length} icons, each a mask class taking the color of what it sits in.</p><div class="wall">`);
for (const { cells } of icons) {
  out.push(`<div class="glyph"><span class="lt-icon lt-icon-${cells[0]}"></span><code>${cells[0]}</code></div>`);
}
out.push('</div>');

out.push('<h2>Components</h2>');
out.push(`<p class="lead">${components.length} of them, each drawn from its row in <code>design/components.md</code>.</p>`);
for (const { cells } of components) {
  const [name, family, built, sample] = cells;
  const markup = sample.replace(/^`|`$/g, '').split('\\|').join('|');
  out.push('<section class="part">');
  out.push(`<header><h3>${escape(name)}</h3><code class="built">.${family}</code><span class="built">${escape(built.replace(/`/g, ''))}</span></header>`);
  out.push(`<div class="stage">${markup}</div>`);
  out.push('</section>');
}

const html = out.join('\n') + '\n';

let current = '';
try {
  current = readFileSync(join(root, target), 'utf8');
} catch {
  current = '';
}
if (current === html) {
  console.log(`gallery: ${components.length} components, ${icons.length} icons, ${colors.length} colors — ${target} matches`);
  process.exit(0);
}
if (check) {
  console.error(`${target} has drifted from design/ — run \`just bundle-gallery\``);
  process.exit(1);
}
writeFileSync(join(root, target), html);
console.log(`gallery: wrote ${components.length} components, ${icons.length} icons, ${colors.length} colors to ${target}`);
