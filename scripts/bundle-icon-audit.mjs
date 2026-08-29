#!/usr/bin/env node
// design/icons.md holds the decision — one label and one answer per outside pack, on every icon row — and this draws it: three sheets putting each of the app's own drawings beside what the same job looks like in six candidate packs, and three photographs of them for a ticket to carry.
//
//   node scripts/bundle-icon-audit.mjs           write the three pages and photograph each at its own height
//   node scripts/bundle-icon-audit.mjs --check   fail on drift in the pages, offline, with no browser (`just verify`)
//
// The chart is the generated view of the app's source rather than a list beside it. A pack's cell reads its vendored drawing off `src/assets/icon-packs/<pack>/`; a cell saying `leaftext` repeats the app's own mask and says so, because a blank in this chart is a decision nobody made and that is how share and network shapes ended up where the app draws a graph.
//
// **The verification path never opens a browser.** The pages are HTML this file writes, so drift in them is a string compare; whether a photograph reaches the last row is not a question a parser can answer, and putting a browser launch on every `just verify` would spend one on every check in the tree. `--write` measures each page and photographs it at its own content height; `--check` reads the pages alone.
//
// Every drawing arrives as a mask and is never rewritten. An earlier pass inserted raw SVG into the page and then edited its fills and strokes, which reduced a multipart drawing such as the sidepanel to one part and made every comparison beside it untrustworthy.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = join(root, '..', 'docs');
const check = process.argv.includes('--check');

const SHEETS = 3;
const page = (n) => join(plans, 'imgs', 'wireframes', `theme-icon-sets-audit-${n}.html`);
const shot = (n) => join(plans, 'imgs', `theme-icon-sets-audit-${n}.png`);

// The pack versions the audit was taken against, said under each column so a reader knows which release a candidate came from. A pack whose drawings are replaced from a newer release moves its number here.
const VERSIONS = {
  feather: '4.29.2',
  lucide: '1.37.0',
  tabler: '3.46.0',
  remix: '4.9.1',
  phosphor: '2.1.1',
  heroicons: '2.2.0',
};

const md = readFileSync(join(root, 'design/icons.md'), 'utf8');

/** The Packs table, in the order it lists them. `leaftext` first: it is the app's own set and the column every other one falls back to. */
function packs() {
  const section = /\n## Packs\n([\s\S]*?)(?=\n## |$)/.exec(md);
  if (!section) throw new Error('design/icons.md has no ## Packs section');
  return section[1]
    .split('\n')
    .map((line) => (line.startsWith('|') ? line.split('|').slice(1, -1).map((cell) => cell.trim()) : []))
    .filter((cells) => cells.length === 4 && cells[0] !== 'Pack' && !/^-{3,}$/.test(cells[1]))
    .map(([name]) => name);
}

const PACKS = packs();
const OUTSIDE = PACKS.filter((pack) => pack !== 'leaftext');
const COLUMNS = 6 + PACKS.length;

/** Every icon row: its drawing, its audit label, its six decisions and the sentence saying where it is worn. */
function rows() {
  const out = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== COLUMNS || cells[0] === 'Name' || /^-{3,}$/.test(cells[1])) continue;
    const [name, file, source, , , audit, ...rest] = cells;
    const worn = rest.pop();
    out.push({ name, file, source, audit, decided: rest, worn });
  }
  return out;
}

// The mask each class compiles to, read out of the generated stylesheet rather than off the `.svg`: what this chart has to show is the drawing that ships, weight stamped and all, and the file on disk is only what it was saved as.
function compiledMasks() {
  const css = readFileSync(join(root, 'src/assets/icons.css'), 'utf8');
  const at = css.indexOf('\n:root {');
  const block = css.slice(at, css.indexOf('\n}', at));
  return new Map([...block.matchAll(/--lt-icon-([a-z0-9-]+): (url\("[^"]*"\));/g)].map((hit) => [hit[1], hit[2]]));
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A mask goes into a `style` attribute here, so it is base64 rather than percent-encoded: a drawing carries quotes of its own either way, and one written raw closes the attribute it sits in. The bytes are the drawing's, said in another alphabet — nothing about it is rewritten, which is the whole rule this chart broke once already.
const asMask = (svg) => {
  const body = svg.replace(/currentColor/g, '#000').replace(/\s*\n\s*/g, ' ').replace(/>\s+</g, '><').trim();
  return `url('data:image/svg+xml;base64,${Buffer.from(body, 'utf8').toString('base64')}')`;
};

/** A `url("data:image/svg+xml,…")` out of the compiled stylesheet, said the way a `style` attribute can carry it. */
const asAttribute = (uri) => asMask(decodeURIComponent(uri.replace(/^url\("data:image\/svg\+xml,/, '').replace(/"\)$/, '')));

const STYLE = `*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#15181d;font:14px/1.35 Inter,Segoe UI,sans-serif}.sheet{width:1900px;padding:34px 42px 42px}.eyebrow{margin:0 0 4px;color:#596274;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:0 0 8px;font-size:29px}.intro{margin:0 0 24px;color:#596274;font-size:15px}table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;background:white;border:1px solid #d9dee7;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(33,42,57,.08)}th,td{border-right:1px solid #e4e7ed;border-bottom:1px solid #e4e7ed}thead th{height:64px;padding:10px 8px;background:#eef1f5;text-align:center;font-size:14px}thead th:first-child{width:270px;text-align:left;padding-left:18px}thead th:nth-child(2){background:#e4e8ef}thead small{display:block;margin-top:3px;color:#6c7482;font-size:11px;font-weight:500}tbody th{width:270px;padding:10px 14px;text-align:left;vertical-align:middle}tbody th strong{display:block;margin-left:32px;font-size:15px}tbody th small{display:block;margin:3px 0 0 32px;color:#6c7482;font-size:10px;font-weight:400;line-height:1.25}.number{float:left;display:grid;width:24px;height:24px;place-items:center;border-radius:50%;background:#222a37;color:#fff;font-size:11px}td{height:84px;padding:8px;text-align:center;vertical-align:middle}.current{background:#f4f6f9}.fallback{background:#f8f3e8}.icon{display:grid;height:38px;place-items:center}.glyph{display:block;width:30px;height:30px;background:#171a1f;-webkit-mask:var(--glyph) center/contain no-repeat;mask:var(--glyph) center/contain no-repeat}td small{display:block;overflow:hidden;margin-top:4px;color:#667080;font:10px/1.15 ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}tr:last-child th,tr:last-child td{border-bottom:0}th:last-child,td:last-child{border-right:0}`;

/** What one cell shows and what it is called: the pack's own vendored drawing, a borrow it names, or the Leaftext mask it keeps. */
function cell(row, pack, masks) {
  const said = row.decided[OUTSIDE.indexOf(pack)];
  if (said === 'leaftext') {
    return { mask: asAttribute(masks.get(row.name)), said: `keep Leaftext · ${row.file} · ${row.source}`, kept: true };
  }
  const at = join(root, 'src/assets/icon-packs', pack, `${row.name}.svg`);
  if (!existsSync(at)) throw new Error(`design/icons.md gives ${row.name} the ${pack} drawing "${said}", and ${pack}/${row.name}.svg is not there`);
  const borrowed = /^([a-z][a-z0-9-]*):(.+)$/.exec(said);
  const name = borrowed ? `${borrowed[1][0].toUpperCase()}${borrowed[1].slice(1)} · ${borrowed[2]}` : said;
  return { mask: asMask(readFileSync(at, 'utf8')), said: name, kept: false };
}

/** One sheet of the chart, as the whole page. */
function sheet(n, mine, masks) {
  const head = [
    `<th scope="col">Icon and where it is worn</th>`,
    `<th scope="col">Leaftext<small>The app's own mixed set</small></th>`,
    ...OUTSIDE.map((pack) => `<th scope="col">${pack[0].toUpperCase()}${pack.slice(1)}<small>${VERSIONS[pack] ?? 'vendored here'}</small></th>`),
  ].join('');
  const body = mine
    .map(({ row, at }) => {
      const cells = OUTSIDE.map((pack) => {
        const { mask, said, kept } = cell(row, pack, masks);
        return `<td${kept ? ' class="fallback"' : ''}><div class="icon"><span class="glyph" style="--glyph:${mask}"></span></div><small>${escape(said)}</small></td>`;
      }).join('');
      const own = `<td class="current"><div class="icon"><span class="glyph" style="--glyph:${asAttribute(masks.get(row.name))}"></span></div><small>${escape(`${row.file} · ${row.source}`)}</small></td>`;
      return `<tr><th scope="row"><span class="number">${at}</span><strong>${escape(row.audit)}</strong><small>${escape(row.worn)}</small></th>${own}${cells}</tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Leaftext icon audit ${n}</title><style>\n  ${STYLE}</style></head><body><main class="sheet"><p class="eyebrow">Complete app audit · sheet ${n} of ${SHEETS}</p><h1>Every Leaftext icon beside ${OUTSIDE.length} candidate packs</h1><p class="intro">Leaftext is the app's own mixed set and a theme pack of its own. Each outside column shows that pack's drawing for the same job, a borrow it names, or the Leaftext drawing it keeps.</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></main></body></html>`;
}

// The drawing rules prove themselves on a made-up row before the real sixty-three are read: a check that has only ever seen good rows is one nobody has watched refuse anything, and a row reaching the app without reaching this chart is the exact thing the chart exists to stop.
function selfTest() {
  const fails = [];
  const masks = new Map([['x', `url("data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>')}")`]]);
  const kept = OUTSIDE.map(() => 'leaftext');
  const row = { name: 'x', file: 'x.svg', source: 'leaftext', audit: 'Made up', decided: kept, worn: 'Nowhere; this row is a test.' };
  const html = sheet(1, [{ row, at: 1 }], masks);

  const drawn = [...html.matchAll(/<td( class="[^"]*")?><div class="icon">[\s\S]*?<small>(.*?)<\/small><\/td>/g)].map((hit) => hit[2]);
  if (drawn.length !== PACKS.length) fails.push(`a made-up row drew ${drawn.length} cells, and there are ${PACKS.length} packs`);
  if (drawn.some((said) => !said)) fails.push('a made-up row left a cell with no drawing named, and a blank here is a decision nobody made');
  if (!html.includes('<strong>Made up</strong>')) fails.push('the chart printed something other than the audit label the row carries');
  if (!html.includes("--glyph:url('data:image/svg+xml;base64,")) fails.push('a drawing reached the page as something other than a mask a style attribute can carry');

  // And a row whose decision names a drawing nobody vendored, which is how an icon lands in the app under one theme and nowhere else.
  const missing = { ...row, decided: OUTSIDE.map((_, at) => (at === 0 ? 'plus' : 'leaftext')) };
  try {
    sheet(1, [{ row: missing, at: 1 }], masks);
    fails.push('a decision naming a drawing nobody vendored was drawn rather than refused');
  } catch (error) {
    if (!String(error.message).includes('is not there')) fails.push(`a missing drawing was refused for the wrong reason: ${error.message}`);
  }
  return fails;
}

const selfTestFails = selfTest();
if (selfTestFails.length) {
  console.error('bundle-icon-audit: the drawing rules do not hold, so nothing was read:');
  for (const fail of selfTestFails) console.error(`  ${fail}`);
  process.exit(1);
}

const all = rows();
if (all.length < 30) throw new Error(`design/icons.md gave only ${all.length} icons`);
const masks = compiledMasks();
for (const row of all) {
  if (!masks.has(row.name)) throw new Error(`src/assets/icons.css declares no drawing for ${row.name} — run \`just bundle-icons\``);
}
const per = Math.ceil(all.length / SHEETS);
const pages = [];
for (let n = 1; n <= SHEETS; n++) {
  const mine = all.slice((n - 1) * per, n * per).map((row, i) => ({ row, at: (n - 1) * per + i + 1 }));
  pages.push({ n, html: sheet(n, mine, masks), last: mine.at(-1) });
}

const drifted = pages.filter(({ n, html }) => {
  let current = '';
  try {
    current = readFileSync(page(n), 'utf8');
  } catch {
    current = '';
  }
  return current !== html;
});

if (check) {
  if (drifted.length) {
    console.error('the icon audit has drifted from design/icons.md — run `just bundle-icon-audit`:');
    for (const { n } of drifted) console.error(`  ../docs/imgs/wireframes/theme-icon-sets-audit-${n}.html`);
    process.exit(1);
  }
  const missing = pages.filter(({ n }) => !existsSync(shot(n)));
  if (missing.length) {
    console.error('the icon audit has pages nobody photographed — run `just bundle-icon-audit`:');
    for (const { n } of missing) console.error(`  ../docs/imgs/theme-icon-sets-audit-${n}.png`);
    process.exit(1);
  }
  const last = pages.map(({ last }) => last.at).join(', ');
  console.log(`icon audit: ${all.length} icons beside ${OUTSIDE.length} packs across ${SHEETS} sheets, ${all.length * OUTSIDE.length} decisions all made, every sheet photographed and rows ${last} the last on theirs`);
  process.exit(0);
}

for (const { n, html } of pages) writeFileSync(page(n), html);

// The photograph is the browser's, and it is measured before it is taken: the sheets differ in height because the sentences under the names differ in length, so one number clips the tallest and pads the rest.
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = BROWSERS.find((path) => existsSync(path));
if (!browser) {
  console.log(`icon audit: wrote ${pages.length} pages; no Edge or Chrome here, so nothing was photographed`);
  process.exit(0);
}

const heights = [];
for (const { n } of pages) {
  const dir = mkdtempSync(join(tmpdir(), 'leaf-icon-audit-'));
  const measured = join(dir, 'measure.html');
  writeFileSync(measured, readFileSync(page(n), 'utf8').replace('</body>', `<script>document.title = 'H=' + Math.ceil(document.querySelector('.sheet').getBoundingClientRect().height)</script></body>`));
  const said = execFileSync(browser, ['--headless=new', '--disable-gpu', `--user-data-dir=${dir}`, '--window-size=1900,3000', '--virtual-time-budget=8000', '--dump-dom', `file:///${measured.replace(/\\/g, '/')}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const height = Number(/H=(\d+)/.exec(said)?.[1]);
  if (!height) throw new Error(`sheet ${n} would not measure itself, so it cannot be photographed at its own height`);
  heights.push(height);
  execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', `--screenshot=${shot(n).replace(/\\/g, '/')}`, `--window-size=1900,${height}`, `file:///${page(n).replace(/\\/g, '/')}`]);
}

console.log(`icon audit: wrote ${pages.length} pages of ${all.length} icons beside ${OUTSIDE.length} packs, photographed at ${heights.join(', ')} pixels — each sheet's own measured height`);
