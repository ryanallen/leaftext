#!/usr/bin/env node
// The theme gallery: every color, value, icon and component the app has, on one page at leaftext.com/gallery.html, with a switcher so any of the 11 themes can be looked at in light or dark.
//
//   node scripts/bundle-gallery.mjs           write gallery.html
//   node scripts/bundle-gallery.mjs --check   fail on drift (`just verify`)
//
// It stands alone: one file, its stylesheet inside it, nothing fetched. So it works from the site, from a checkout, and from a file on disk.
//
// Two sources, both compiled rather than typed:
//
//   design/*.md      what exists — the names, the values, the components, the samples
//   cargo --dump-css the stylesheet, because the theme compiler is Rust and a second
//                    one written in node would drift from it the first week
//
// A component row with no sample markup fails the build rather than drawing an empty box, and a sample that does not use its own class fails too.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const target = 'gallery.html';

// `| a | b | …` rows under a `## Heading`, with the heading they sit under.
function tables(file) {
  const rows = [];
  let group = '';
  for (const line of readFileSync(join(root, 'design', file), 'utf8').split('\n')) {
    if (line.startsWith('## ')) group = line.slice(3).trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || cells.some((c) => /^-{3,}$/.test(c))) continue;
    if (['Token', 'Component', 'Name'].includes(cells[0])) continue;
    rows.push({ group, cells });
  }
  return rows;
}

const colors = tables('colors.md');
const tokens = tables('tokens.md');
// The rows that name a drawing: icons.md also carries the Stroke table, which is values, not icons.
const icons = tables('icons.md').filter(({ cells }) => /\.svg$/.test(cells[1] || ''));
// Only the first table: the document prefixes and states after it account for classes, they are not components with markup to draw.
const components = tables('components.md').filter(({ group }) => !group.startsWith('What a document') && !group.startsWith('State'));

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

// The families, read out of the theme bundle so the switcher cannot list one that does not exist or miss one that does.
const bundle = readFileSync(join(root, 'src/assets/themes.md'), 'utf8');
const families = [];
for (const block of bundle.split('\n# ').slice(1)) {
  const name = block.split('\n')[0].trim();
  const id = (block.match(/\*\*Family ID:\*\*\s*`([a-z0-9-]+)`/) || [])[1];
  if (id) families.push({ id, name });
}
if (families.length < 5) throw new Error(`expected the theme families, got ${families.length}`);

// The app's own compiled stylesheet. Built once; a release always has a binary.
const css = execFileSync('cargo', ['run', '--quiet', '--', '--dump-css'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (!css.includes('--lt-background')) throw new Error('--dump-css gave no stylesheet');

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function byGroup(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row.cells);
  }
  return groups;
}

// A number is not a value you can see. Anything whose meaning is visual gets drawn with itself: a corner rounded by it, a bar that wide, text at that size. Keyed off the token's own name, so a new one is drawn without anybody adding it here.
function drawn(name) {
  const v = `var(--${name})`;
  if (/^lt-radius-/.test(name)) return `<i class="demo tile" style="border-radius:${v}"></i>`;
  if (/^lt-space-/.test(name)) return `<i class="demo bar" style="width:${v}"></i>`;
  if (/^lt-stroke-/.test(name)) return `<i class="demo rule" style="height:${v}"></i>`;
  if (/^lt-opacity-/.test(name)) return `<i class="demo tile" style="opacity:${v}"></i>`;
  if (/^lt-shadow-/.test(name)) return `<i class="demo tile shade" style="box-shadow:${v}"></i>`;
  if (/^lt-text-/.test(name) || /-size$/.test(name)) return `<i class="demo type" style="font-size:${v}">Ag</i>`;
  if (/^lt-weight-/.test(name) || /-weight$/.test(name)) return `<i class="demo type" style="font-weight:${v}">Ag</i>`;
  if (/^lt-leading-/.test(name) || /-line$/.test(name)) {
    return `<i class="demo type lines" style="line-height:${v}">Two lines of it, so the gap shows</i>`;
  }
  if (/^lt-tracking-/.test(name)) return `<i class="demo type" style="letter-spacing:${v}">Spacing</i>`;
  return '';
}

const out = [];
out.push('<!doctype html>');
out.push('<!-- Generated from design/ by `just bundle-gallery`. Do not edit. -->');
out.push('<html lang="en" data-leaf-theme="fern" data-leaf-appearance="light" data-theme="light">');
out.push('<meta charset="utf-8">');
out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
out.push('<title>Leaftext themes — every color, value, icon and component</title>');
out.push('<meta name="description" content="Every theme Leaftext ships, drawn: all 82 colors, the type and spacing scales, every icon and every part of the interface, in light and dark.">');
// The app's own stylesheet, inside the page so it stands alone.
out.push('<style>');
out.push(css.trimEnd());
out.push('</style>');
out.push('<style>');
// The app never scrolls its own body — the reader does the scrolling — so its stylesheet pins `body { overflow: hidden }`. This is an ordinary page and has to undo that, or everything below the fold is unreachable.
out.push('  html, body { overflow: visible; height: auto; }');
out.push('  body { margin: 0; padding: 0 24px 48px; background: var(--lt-background); color: var(--lt-foreground); font-family: var(--app-font); }');
out.push('  header.top { position: sticky; top: 0; z-index: 2; padding: 16px 0 12px; background: var(--lt-background); border-bottom: var(--lt-stroke-1) solid var(--lt-border); }');
out.push('  h1 { font-size: 22px; margin: 0 0 4px; }');
out.push('  h2 { font-size: 15px; margin: 32px 0 4px; scroll-margin-top: 140px; }');
out.push('  .tabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 14px 0 -13px; }');
out.push('  .tabs button { font: inherit; font-size: var(--lt-text-13); font-weight: var(--lt-weight-600); padding: var(--lt-space-8) var(--lt-space-14); border: var(--lt-stroke-1) solid transparent; border-bottom: 0; border-radius: var(--lt-radius-lg) var(--lt-radius-lg) 0 0; background: transparent; color: var(--lt-muted-foreground); cursor: pointer; }');
out.push('  .tabs button b { font-weight: var(--lt-weight-400); opacity: var(--lt-opacity-60); margin-left: var(--lt-space-4); }');
out.push('  .tabs button:hover { color: var(--lt-foreground); background: var(--lt-surface-muted); }');
// The open tab joins the page below it: same fill, and the strip's own line broken under it by a matching border.
out.push('  .tabs button[aria-selected="true"] { color: var(--lt-foreground); background: var(--lt-background); border-color: var(--lt-border); box-shadow: 0 var(--lt-stroke-1) 0 0 var(--lt-background); }');
out.push('  .panel h2 { margin-top: 20px; }');
out.push('  h3 { font-size: 12px; margin: 20px 0 6px; color: var(--lt-muted-foreground); font-weight: var(--lt-weight-600); }');
out.push('  p.lead { margin: 0 0 8px; color: var(--lt-muted-foreground); font-size: var(--lt-text-12); max-width: 70ch; }');
out.push('  .pick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }');
out.push('  .pick button { font: inherit; font-size: var(--lt-text-12); padding: var(--lt-space-4) var(--lt-space-10); border: var(--lt-stroke-1) solid var(--lt-border); border-radius: var(--lt-radius-pill); background: var(--lt-surface); color: var(--lt-muted-foreground); cursor: pointer; }');
out.push('  .pick button[aria-pressed="true"] { background: var(--lt-primary); border-color: var(--lt-primary); color: var(--lt-primary-foreground); }');
out.push('  .wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(152px, 1fr)); gap: 10px 12px; align-items: start; }');
out.push('  .wall.wide { grid-template-columns: repeat(auto-fill, minmax(224px, 1fr)); }');
// The stroke matters: a color the same as the page has no edge of its own, and without one the swatch reads as a missing swatch.
out.push('  .swatch i { display: block; height: 40px; border-radius: var(--lt-radius-md); border: var(--lt-stroke-1) solid var(--lt-border-strong); }');
out.push('  .swatch code, .value code { font-family: var(--code-font); font-size: var(--lt-text-10); color: var(--lt-muted-foreground); overflow-wrap: anywhere; }');
out.push('  .value code { display: block; }');
out.push('  .value .demo { display: block; margin: 2px 0 5px; color: var(--lt-foreground); font-family: var(--app-font); font-style: normal; }');
out.push('  .value .tile { width: 44px; height: 26px; background: var(--lt-primary); }');
out.push('  .value .shade { width: 64px; height: 34px; margin: 8px 0 12px; background: var(--lt-surface-elevated); }');
out.push('  .value .bar { height: 10px; min-width: var(--lt-stroke-1); background: var(--lt-accent); }');
out.push('  .value .rule { width: 60px; background: var(--lt-foreground); }');
out.push('  .value .lines { max-width: 190px; }');
// A sample that sends you to another tab rather than repeating what is on it.
out.push('  .stage a.jump { display: inline-flex; align-items: center; gap: var(--lt-space-8); color: var(--lt-link); font-size: var(--lt-text-13); }');
out.push('  .glyph { width: 84px; text-align: center; }');
out.push('  .glyph .lt-icon { width: 24px; height: 24px; }');
out.push('  .glyph code { display: block; }');
// `isolation` is the one that matters: the parts that sit over the app carry a high layer, and without a layer of its own here the card's contents paint over the header the page scrolls under.
out.push('  .part { border: var(--lt-stroke-1) solid var(--lt-border); border-radius: var(--lt-radius-lg); padding: 12px; margin: 0 0 12px; isolation: isolate; }');
out.push('  .part > header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 10px; flex-wrap: wrap; }');
out.push('  .part h3 { margin: 0; }');
out.push('  .part .built { color: var(--lt-muted-foreground); font-size: var(--lt-text-10); }');
// Padding keeps a sample's own border, and the shadow it throws, off the clip.
out.push('  .stage { position: relative; overflow: hidden; min-height: 40px; padding: 18px 22px; }');
// A part that fixes, floats or slides itself would sit over the page rather than in its own box, so each sample's outermost element is pinned back into the flow — the slide-up sheets included. What is inside it keeps its own positioning, which is what the minimap's viewport needs. max-width is not forced: a sample says how wide it should be drawn, and the stage clips anything wider anyway.
out.push('  .stage > * { position: relative !important; inset: auto !important; margin: 0 !important; max-width: 100%; max-height: 260px !important; }');
// Not the spinner: its transform is the spin, and this would hold it still.
out.push('  .stage > *:not(.lt-spinner) { transform: none !important; }');
// Two panels stack; two buttons stand side by side, so they get the gap sideways.
out.push('  .stage > * + * { margin-top: 8px !important; }');
out.push('  .stage > :is(button, a, span, code, i, svg) { margin: 0 8px 0 0 !important; }');
out.push('</style>');

out.push('<header class="top">');
out.push('<h1>Leaftext themes, drawn</h1>');
out.push(`<p class="lead">Every one of the ${families.length} themes, in light and dark: all ${colors.length} colors, the ${tokens.length} values that do not change with the theme, all ${icons.length} icons, and all ${components.length} parts of the interface — painted by the app's own stylesheet. Pick one.</p>`);
out.push('<div class="pick" id="familyPick">');
for (const { id, name } of families) {
  out.push(`<button type="button" data-family="${id}" aria-pressed="${id === 'fern'}">${escape(name)}</button>`);
}
out.push('</div>');
out.push('<div class="pick" id="appearancePick">');
for (const mode of ['light', 'dark']) {
  out.push(`<button type="button" data-appearance="${mode}" aria-pressed="${mode === 'light'}">${mode[0].toUpperCase() + mode.slice(1)}</button>`);
}
out.push('</div>');
out.push('<div class="tabs" role="tablist">');
for (const [panel, label] of [
  ['colors', `Colors <b>${colors.length}</b>`],
  ['values', `Values <b>${tokens.length}</b>`],
  ['icons', `Icons <b>${icons.length}</b>`],
  ['interface', `Interface <b>${components.length}</b>`],
]) {
  const first = panel === 'colors';
  out.push(`<button type="button" role="tab" data-panel="${panel}" aria-selected="${first}" aria-controls="${panel}">${label}</button>`);
}
out.push('</div>');
out.push('</header>');

out.push('<section class="panel" id="colors" role="tabpanel">');
out.push(`<p class="lead">${colors.length} names. The theme picked above gives each one its value; a family that changed one would change it everywhere at once.</p>`);
for (const [group, rows] of byGroup(colors)) {
  out.push(`<h3>${escape(group)}</h3><div class="wall">`);
  for (const [name] of rows) {
    out.push(`<div class="swatch"><i style="background: var(--lt-${name})"></i><code>${name}</code></div>`);
  }
  out.push('</div>');
}

out.push('</section>');
out.push('<section class="panel" id="values" role="tabpanel" hidden>');
out.push(`<p class="lead">${tokens.length} values that are the same whatever theme is on: the spacing, the type scale, the corners, how long things take.</p>`);
for (const [group, rows] of byGroup(tokens)) {
  out.push(`<h3>${escape(group)}</h3><div class="wall wide">`);
  for (const [name, value] of rows) {
    out.push(
      `<div class="value"><code>${name}</code>${drawn(name)}` +
        `<code>${escape(value.replace(/^`|`$/g, ''))}</code></div>`
    );
  }
  out.push('</div>');
}

out.push('</section>');
out.push('<section class="panel" id="icons" role="tabpanel" hidden>');
out.push(`<p class="lead">${icons.length} icons. Each takes the color of whatever it sits in, which is why they follow the theme.</p><div class="wall">`);
for (const { cells } of icons) {
  out.push(`<div class="glyph"><span class="lt-icon lt-icon-${cells[0]}"></span><code>${cells[0]}</code></div>`);
}
out.push('</div>');

out.push('</section>');
out.push('<section class="panel" id="interface" role="tabpanel" hidden>');
out.push(`<p class="lead">${components.length} parts, each drawn here exactly as the app draws it.</p>`);
for (const { cells } of components) {
  const [name, family, built, sample] = cells;
  const markup = sample.replace(/^`|`$/g, '').split('\\|').join('|');
  out.push('<section class="part">');
  out.push(`<header><h3>${escape(name)}</h3><code class="built">.${family}</code><span class="built">${escape(built.replace(/`/g, ''))}</span></header>`);
  out.push(`<div class="stage">${markup}</div>`);
  out.push('</section>');
}

out.push('</section>');

// The switcher writes the same two attributes the app's own bootstrap writes, which is the whole mechanism: every color is defined under a selector reading them.
out.push('<script>');
out.push('  const root = document.documentElement;');
out.push('  const wire = (id, attr) => {');
out.push('    document.getElementById(id).addEventListener("click", (event) => {');
out.push('      const button = event.target.closest("button");');
out.push('      if (!button) return;');
out.push('      const value = button.dataset[attr];');
out.push('      root.dataset[attr === "family" ? "leafTheme" : "leafAppearance"] = value;');
out.push('      if (attr === "appearance") root.dataset.theme = value;');
out.push('      for (const other of event.currentTarget.querySelectorAll("button")) {');
out.push('        other.setAttribute("aria-pressed", String(other === button));');
out.push('      }');
out.push('    });');
out.push('  };');
out.push('  wire("familyPick", "family");');
out.push('  wire("appearancePick", "appearance");');
out.push('  // The tabs: one panel at a time, and the address bar remembers which.');
out.push('  const tabs = document.querySelector(".tabs");');
out.push('  const show = (name) => {');
out.push('    for (const tab of tabs.querySelectorAll("button")) {');
out.push('      const open = tab.dataset.panel === name;');
out.push('      tab.setAttribute("aria-selected", String(open));');
out.push('      document.getElementById(tab.dataset.panel).hidden = !open;');
out.push('    }');
out.push('  };');
out.push('  tabs.addEventListener("click", (event) => {');
out.push('    const tab = event.target.closest("button");');
out.push('    if (!tab) return;');
out.push('    show(tab.dataset.panel);');
out.push('    history.replaceState(null, "", "#" + tab.dataset.panel);');
out.push('  });');
// On load and on every jump, so a link from one panel to another opens that tab.
out.push('  const fromHash = () => {');
out.push('    const name = location.hash.slice(1);');
out.push('    if (document.getElementById(name)) show(name);');
out.push('  };');
out.push('  addEventListener("hashchange", fromHash);');
out.push('  fromHash();');
out.push('</script>');
out.push('</html>');

const html = out.join('\n') + '\n';

let current = '';
try {
  current = readFileSync(join(root, target), 'utf8');
} catch {
  current = '';
}
if (current === html) {
  console.log(`gallery: ${families.length} themes, ${components.length} components, ${icons.length} icons — ${target} matches`);
  process.exit(0);
}
if (check) {
  console.error(`${target} has drifted from design/ — run \`just bundle-gallery\``);
  process.exit(1);
}
writeFileSync(join(root, target), html);
console.log(`gallery: wrote ${families.length} themes, ${components.length} components, ${icons.length} icons to ${target}`);
