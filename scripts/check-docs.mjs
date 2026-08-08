#!/usr/bin/env node
// Every Markdown file here and in the plan folder next door has a role — something `/sync-docs` knows how to keep true. A file matching none is one nobody looks at again, which is how a whole folder of plans went unswept.
//
//   node scripts/check-docs.mjs            fail on a file with no role
//   node scripts/check-docs.mjs --list     every file and its role
//
// Roles are folder patterns, so a new page needs no edit here and a new *top* folder does: a new kind of document is a decision about who keeps it true. A subject folder inside one (`features/editing/`) inherits its parent's role by prefix.
//
// It also fails on a plan whose boxes are all ticked and which is still filed as live work. v0.1.462 shipped `scroll-position` and left it there, so the running order still called it next up. `/sync-docs` and `/done` both own the move; this is the thing that notices when neither ran.
//
// And it opens every document link both trees make. Retiring a ticket moves the file and fixes its own links, never the ones pointing at it, so each retirement left a few dead — forty of them by August 2026, twelve inside live tickets.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = join(root, '..', 'docs');

// Each row: where the files are, and what keeps them true. Order matters — the first match wins, so a specific folder goes above the folder holding it.
const ROLES = [
  ['docs/01-features', 'published: what a reader sees'],
  ['docs/02-development', 'published: how it is built'],
  ['docs', 'published: the entry pages and the glossary'],
  ['design', 'source of a token, an icon or a component — generated from, never by hand'],
  ['themes', "source of a color's value"],
  ['.agents/skills', 'a repeatable job'],
  ['src/assets', 'a third-party license notice shipped in the app'],
  ['wix', 'installer text'],
  ['.', 'the repo root: the guide, the readme, and their symlinks'],
];

const PLAN_ROLES = [
  ['features', 'plan: the app cannot do it yet'],
  ['refactor', 'plan: it does it, this changes how'],
  ['fixes', 'plan: something is wrong and this is the fix'],
  ['done', 'shipped, kept for the reasoning (with the retired running-order rows)'],
  ['canceled', 'decided against, kept for the reasoning'],
  ['tests', 'a document to open in the app, not a plan'],
  ['learn', "writing from elsewhere, kept to read — not about this app, so nothing here can go stale"],
  ['.', 'the ticket index, and the glossary of the words it is written in'],
];

// Generated or vendored: hundreds of files nobody here writes.
const SKIP = new Set(['node_modules', 'target', 'dist', '.git', 'vendor', 'conformance']);

function markdown(dir, base) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdown(full, base));
    else if (entry.name.endsWith('.md')) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function roleFor(file, roles) {
  const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
  for (const [prefix, role] of roles) {
    if (prefix === '.' ? folder === '.' : folder === prefix || folder.startsWith(`${prefix}/`)) {
      return role;
    }
  }
  return null;
}

// Somebody else's writing, kept to read. Nothing here edits it, so a dead link in it is not a build failure.
const LINK_SKIP = ['learn/'];

// Every document link a page makes that opens nothing. Only a target ending `.md`: `theme-color-reference.md` writes `[button 1](src)` on purpose because that page is meant to be rendered, and a picture is `doc-images.mjs`'s job.
//
// Code comes out first, or a page teaching an author how to write a link fails on its own example. Fences are tracked a line at a time and the inline span dropped after, because `rdb.md` writes a fence marker inside a span — one regex over the whole file swallows the wrong stretch, hiding a real dead link and inventing two inside a sample table.
function deadLinks(text, exists) {
  const out = [];
  let fenced = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const [, src] of lines[i].replace(/`[^`\n]*`/g, '').matchAll(/\[[^\]]*\]\(\s*([^)\s]+)/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(src)) continue;
      const target = src.split('#')[0];
      if (!target.endsWith('.md') || exists(target)) continue;
      out.push({ line: i + 1, target });
    }
  }
  return out;
}

// The strip is the whole risk here, so it is proved on every run before either tree is read.
const LINK_CASES = [
  ['a link to a file that is not there fails the check', '[a](gone.md)\n', ['gone.md']],
  ['a link to a file that is there passes', '[a](there.md)\n', []],
  ['the same text inside backticks passes', 'write it as `[a](gone.md)` here\n', []],
  ['the same text inside a fenced block passes', '```\n[a](gone.md)\n```\n', []],
  ['a fence marker inside an inline span does not open a block', '| Fenced ` ```leafdb ` block |\n[a](gone.md)\n', ['gone.md']],
  ['a fenced block after one is still read as code', '| Fenced ` ```leafdb ` block |\n\n```\n[a](gone.md)\n```\n', []],
  ['an anchor on a real file passes, and the anchor itself is not checked', '[a](there.md#no-such-heading)\n', []],
  ['a target that is not a .md file is never opened', '[button 1](src)\n', []],
  ['a link out to the web is not ours to open', '[a](https://example.com/gone.md)\n', []],
];

function linkSelfTest() {
  const fails = [];
  for (const [name, text, want] of LINK_CASES) {
    const got = deadLinks(text, (t) => t === 'there.md').map((d) => d.target);
    if (got.join(',') !== want.join(',')) fails.push(`${name}: got [${got}], want [${want}]`);
  }
  return fails;
}

const selfTestFails = linkSelfTest();
if (selfTestFails.length) {
  console.error('links: the code strip is wrong, so nothing was read:');
  for (const line of selfTestFails) console.error(`  ${line}`);
  process.exit(1);
}

const rows = [];
const orphans = [];
const scanned = [];
for (const [base, roles, label] of [
  [root, ROLES, ''],
  [plans, PLAN_ROLES, '../docs/'],
]) {
  let files;
  try {
    statSync(base);
    files = markdown(base, base).sort();
  } catch {
    continue;
  }
  for (const file of files) {
    const role = roleFor(file, roles);
    if (role) rows.push([`${label}${file}`, role]);
    else orphans.push(`${label}${file}`);
    if (!LINK_SKIP.some((skip) => file.startsWith(skip))) scanned.push([base, file, `${label}${file}`]);
  }
}

if (process.argv.includes('--list')) {
  const width = Math.max(...rows.map((r) => r[0].length));
  for (const [file, role] of rows) console.log(`${file.padEnd(width)}  ${role}`);
}

if (orphans.length) {
  console.error('these Markdown files have no role, so nothing keeps them true:');
  for (const file of orphans) console.error(`  ${file}`);
  console.error('add the folder to ROLES in scripts/check-docs.mjs, and say in');
  console.error('.agents/skills/sync-docs/SKILL.md how that kind of document is kept current.');
  process.exit(1);
}

// Every phase ticked and still filed as live work: the ticket shipped and nobody moved it. A plan with no boxes at all is a report or an index, not work with a finish line.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];
const finished = [];
for (const file of rows.map(([f]) => f)) {
  if (!LIVE_PLANS.some((p) => file.startsWith(`../docs/${p}/`))) continue;
  const text = readFileSync(join(plans, file.slice('../docs/'.length)), 'utf8');
  const ticked = (text.match(/^\s*- \[x\]/gm) || []).length;
  const open = (text.match(/^\s*- \[ \]/gm) || []).length;
  if (ticked > 0 && open === 0) finished.push(`${file} (${ticked} ${ticked === 1 ? 'box' : 'boxes'}, all ticked)`);
}

if (finished.length) {
  console.error('these plans have every box ticked and are still filed as live work:');
  for (const file of finished) console.error(`  ${file}`);
  console.error('move each into a subject folder under ../docs/done/, move its row in');
  console.error('../docs/README.md under Shipped, and strike its row in ../docs/PLAN.md');
  console.error('and move that row into ../docs/done/PLAN.md. That is /sync-docs step "plan".');
  process.exit(1);
}

let opened = 0;
const dead = [];
for (const [base, file, shown] of scanned) {
  const from = join(base, dirname(file));
  for (const { line, target } of deadLinks(readFileSync(join(base, file), 'utf8'), (t) => {
    opened++;
    return existsSync(resolve(from, decodeURIComponent(t)));
  })) {
    dead.push(`${shown}:${line}  ->  ${target}`);
  }
}

if (dead.length) {
  console.error('these links open nothing:');
  for (const line of dead) console.error(`  ${line}`);
  console.error('point each at where the file is now. A ticket that shipped moved into ../docs/done/,');
  console.error('and /done fixes only the links inside the ticket it moves, not the ones pointing at it.');
  process.exit(1);
}

const folders = new Set(rows.map(([file]) => file.slice(0, file.lastIndexOf('/')) || '.'));
console.log(`docs: ${rows.length} Markdown files across ${folders.size} folders, every one with a role, no shipped plan left in a live folder, ${opened} document links all opening something`);
