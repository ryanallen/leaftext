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
//
// A link crossing between the two repositories is resolved inside the other tree's own root rather than wherever climbing out of this one lands, because only a primary checkout has them side by side: a session's copy is the app alone, so every skill linking into the plan tree opened nothing there. The one thing that cannot be looked up is an app file the owner has and a copy was cut before, so the owner's app is a second place to look and a link found only there is reported rather than failed.
//
// It also refuses a live ticket that adds a control and never says what it looks like. See `drawingOwed` for what that question really asks and what it cannot see.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree, primaryAppRoot } from './agent-workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plans = planTree(root);

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
  ['learn/ticket-workflow-medium/skills', "this repo's own skills, copied for sharing — held to their sources by `check-learn-snapshots`"],
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

// Where a link landed, said as a path inside the repository sitting beside this one — or null where it never left its own tree, which is an ordinary dead link and nobody's cut.
export function crossesTo(at, parent, sibling) {
  const out = relative(parent, at).split(sep).join('/');
  return out.startsWith(`${sibling}/`) ? out.slice(sibling.length + 1) : null;
}

// What one link that failed to open really is. A crossing link is looked for again inside the other tree's own root; `ownersRoot` is the second place a plan document's link into the app may be, and it is null wherever there is no second place — every app-side link, and every link at all in a primary checkout.
export function crossingLink({ at, parent, sibling, otherRoot, ownersRoot, exists }) {
  const inner = crossesTo(at, parent, sibling);
  if (inner === null) return 'gone';
  if (exists(join(otherRoot, inner))) return 'opens';
  if (ownersRoot && exists(join(ownersRoot, inner))) return 'waiting';
  return 'gone';
}

// One run's failed links, kept apart: what nothing has, and what only the app copy the owner reads has. A run reporting both without naming them apart is one somebody reads as clean.
export function classifyLinks(links, verdict) {
  const dead = [];
  const waiting = [];
  for (const link of links) {
    const said = verdict(link);
    if (said === 'opens') continue;
    (said === 'waiting' ? waiting : dead).push(link);
  }
  return { dead, waiting };
}

// The two trees as three roots: the owner's pair, and the copy a session is checking. Written out so the cases below read as the shapes they are.
const OWNERS_APP = resolve('/leaftext/app');
const OWNERS_PLANS = resolve('/leaftext/docs');
const SESSION_APP = resolve('/ws/leaftext/app');

// Each row: what it proves, where the ordinary resolution landed, which roots to ask, what is on the disk, and the verdict.
const CROSSING_CASES = [
  [
    'a link out of the app into the plan tree opens against the plan tree the check reads',
    { at: resolve(SESSION_APP, '..', 'docs', 'GLOSSARY.md'), parent: resolve(SESSION_APP, '..'), sibling: 'docs', otherRoot: OWNERS_PLANS, ownersRoot: null },
    [join(OWNERS_PLANS, 'GLOSSARY.md')],
    'opens',
  ],
  [
    'a link out of the plan tree into the app opens against the checkout being checked',
    { at: resolve(OWNERS_PLANS, '..', 'app', 'scripts', 'here.mjs'), parent: resolve(OWNERS_PLANS, '..'), sibling: 'app', otherRoot: SESSION_APP, ownersRoot: OWNERS_APP },
    [join(SESSION_APP, 'scripts', 'here.mjs')],
    'opens',
  ],
  [
    'a dead link inside one tree is nobody\'s cut and still fails',
    { at: resolve(SESSION_APP, 'docs', 'gone.md'), parent: resolve(SESSION_APP, '..'), sibling: 'docs', otherRoot: OWNERS_PLANS, ownersRoot: null },
    [],
    'gone',
  ],
  [
    'a link into an app file only the copy the owner reads has is held rather than failed',
    { at: resolve(OWNERS_PLANS, '..', 'app', 'scripts', 'new.mjs'), parent: resolve(OWNERS_PLANS, '..'), sibling: 'app', otherRoot: SESSION_APP, ownersRoot: OWNERS_APP },
    [join(OWNERS_APP, 'scripts', 'new.mjs')],
    'waiting',
  ],
  [
    'the same link in a primary checkout, where both app roots are one folder, still fails',
    { at: resolve(OWNERS_PLANS, '..', 'app', 'scripts', 'new.mjs'), parent: resolve(OWNERS_PLANS, '..'), sibling: 'app', otherRoot: OWNERS_APP, ownersRoot: null },
    [],
    'gone',
  ],
  [
    'a link into an app file nobody has fails in a session too',
    { at: resolve(OWNERS_PLANS, '..', 'app', 'scripts', 'never.mjs'), parent: resolve(OWNERS_PLANS, '..'), sibling: 'app', otherRoot: SESSION_APP, ownersRoot: OWNERS_APP },
    [],
    'gone',
  ],
];

function crossingSelfTest() {
  const fails = [];
  for (const [name, link, disk, want] of CROSSING_CASES) {
    const got = crossingLink({ ...link, exists: (path) => disk.includes(path) });
    if (got !== want) fails.push(`${name}: got ${got}, want ${want}`);
  }
  // A held link and a dead one arriving in the same run is the case a reader has to be able to tell apart, so it is asked directly rather than read off the rows above.
  const held = CROSSING_CASES[3];
  const nowhere = CROSSING_CASES[5];
  const { dead, waiting } = classifyLinks(
    [{ name: 'held', ...held[1] }, { name: 'nowhere', ...nowhere[1] }],
    (link) => crossingLink({ ...link, exists: (path) => held[2].includes(path) }),
  );
  const names = (links) => links.map((link) => link.name).join();
  if (names(waiting) !== 'held' || names(dead) !== 'nowhere') {
    fails.push(`a run carrying both kinds did not keep them apart: waiting [${names(waiting)}], dead [${names(dead)}]`);
  }
  return fails;
}

const DONE_REPOINTS_ADVICE = 'and /done repoints the links pointing at the ticket it moves, so this means that step was skipped; repoint it.';
const DONE_REPOINTS_STEP = 'Take the links pointing *at* it with it: search both trees for its file name and repoint every one';

function adviceSelfTest() {
  const done = readFileSync(join(root, '.agents', 'skills', 'done', 'SKILL.md'), 'utf8');
  return done.includes(DONE_REPOINTS_STEP)
    ? []
    : [`${DONE_REPOINTS_ADVICE}  ->  .agents/skills/done/SKILL.md no longer says it repoints every link pointing at the ticket it moves`];
}

const selfTestFails = [...linkSelfTest(), ...crossingSelfTest()];
if (selfTestFails.length) {
  console.error('links: the code strip or the crossing rule is wrong, so nothing was read:');
  for (const line of selfTestFails) console.error(`  ${line}`);
  process.exit(1);
}

const adviceFails = adviceSelfTest();
if (adviceFails.length) {
  console.error('advice: a line below no longer matches the /done step it names:');
  for (const line of adviceFails) console.error(`  ${line}`);
  process.exit(1);
}

// Where work that has not shipped lives. Used twice: a plan with every box ticked does not belong here, and a plan here that adds a control owes a drawing.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];
const livePlan = (file) => LIVE_PLANS.some((p) => file.startsWith(`../docs/${p}/`));

// A ticket that adds, moves or restyles anything in the window carries a `## What it looks like` section, so whoever builds it can see it first — v0.1.479 put a second search box, a `?` button and a popup panel into the library pane with no line of the plan asking for any of them, and all three came straight back out.
//
// No script can read a ticket and answer "does this change the window", so this asks an exact question that catches the same tickets: do the phases name `design/components.md`. They cannot dodge it — `check-classes.mjs` refuses any class the stylesheet paints with no row in that file, so a ticket adding a control has to name it.
//
// **What this cannot see: a ticket that moves or restyles a control without touching `design/`.** That is a real gap, and the one-off sweep in `../docs/refactor/workflow/ticket-drawings.md` is what covered it. Nothing here notices if it reopens.
//
// The section is also how a ticket says no in writing: where nothing new is drawn it is one sentence saying so and why, which is what stops the rule refusing a ticket it has no business refusing.
function phasesSection(text) {
  const out = [];
  let inPhases = false;
  for (const line of text.split('\n')) {
    if (/^##(?!#)\s/.test(line)) {
      inPhases = /^##\s+Phases\s*$/.test(line);
      continue;
    }
    if (inPhases) out.push(line);
  }
  return out.join('\n');
}

function drawingOwed(file, text) {
  if (!livePlan(file)) return false;
  if (/^##[ \t]+What it looks like[ \t]*$/m.test(text)) return false;
  return /design\/components\.md/.test(phasesSection(text));
}

const DRAWING_CASES = [
  [
    'phases naming the component table with no drawn section is refused',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [ ] A row in `design/components.md`\n',
    true,
  ],
  [
    'the same ticket with the section passes',
    '../docs/features/reading/a.md',
    '## What it looks like\n\n![a](../../imgs/a.png)\n\n## Phases\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
  [
    'a section saying nothing is drawn, with no picture in it, satisfies the rule',
    '../docs/features/reading/a.md',
    '## What it looks like\n\nNothing new is drawn.\n\n## Phases\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
  [
    'the same file name in prose outside the phases does not trip it',
    '../docs/features/reading/a.md',
    '## How it is built\n\nEvery class is already in `design/components.md`.\n\n## Phases\n\n- [ ] Nothing new\n',
    false,
  ],
  [
    'a heading that only starts with Phases is not the phases',
    '../docs/features/reading/a.md',
    '## Phases and what they cost\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
  [
    'a shipped ticket is not held to the rule',
    '../docs/done/app/a.md',
    '## Phases\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
  [
    'a refused ticket is not held to the rule',
    '../docs/canceled/a.md',
    '## Phases\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
  [
    'a published page is not a ticket',
    'docs/01-features/a.md',
    '## Phases\n\n- [ ] A row in `design/components.md`\n',
    false,
  ],
];

function drawingSelfTest() {
  const fails = [];
  for (const [name, file, text, want] of DRAWING_CASES) {
    const got = drawingOwed(file, text);
    if (got !== want) fails.push(`${name}: got ${got}, want ${want}`);
  }
  return fails;
}

const drawingFails = drawingSelfTest();
if (drawingFails.length) {
  console.error('drawings: the matcher is wrong, so nothing was read:');
  for (const line of drawingFails) console.error(`  ${line}`);
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

// Every phase ticked and still filed as live work: the ticket shipped and nobody moved it. A plan with no boxes at all is a report or an index, not work with a finish line. The same pass asks the drawing question, so each live ticket is read once.
const finished = [];
const undrawn = [];
for (const file of rows.map(([f]) => f)) {
  if (!livePlan(file)) continue;
  const text = readFileSync(join(plans, file.slice('../docs/'.length)), 'utf8');
  const ticked = (text.match(/^\s*- \[x\]/gm) || []).length;
  const open = (text.match(/^\s*- \[ \]/gm) || []).length;
  if (ticked > 0 && open === 0) finished.push(`${file} (${ticked} ${ticked === 1 ? 'box' : 'boxes'}, all ticked)`);
  if (drawingOwed(file, text)) undrawn.push(file);
}

if (undrawn.length) {
  console.error('these live tickets add a control and never say what it looks like:');
  for (const file of undrawn) console.error(`  ${file}  ->  no "## What it looks like" section`);
  console.error('their phases name design/components.md, which only a ticket adding a control has to do.');
  console.error('Draw it: write the sketch as HTML in ../docs/imgs/wireframes/<ticket>.html, photograph it with');
  console.error('node scripts/wireframe.mjs, and embed the picture under that heading — see the "ticket" skill.');
  console.error('If nothing new is drawn, the section is one sentence saying so and why.');
  process.exit(1);
}

if (finished.length) {
  console.error('these plans have every box ticked and are still filed as live work:');
  for (const file of finished) console.error(`  ${file}`);
  console.error('move each into a subject folder under ../docs/done/, move its row in');
  console.error('../docs/README.md under Shipped, and strike its row in ../docs/PLAN.md');
  console.error('and move that row into ../docs/done/PLAN.md. That is /sync-docs step "plan".');
  process.exit(1);
}

// In a primary checkout the owner's app is this checkout, so there is no second place to look and nothing can ever be held there.
const ownersApp = resolve(primaryAppRoot(root));
const ownersAppRoot = ownersApp === resolve(root) ? null : ownersApp;

let opened = 0;
const failed = [];
for (const [base, file, shown] of scanned) {
  const from = join(base, dirname(file));
  const app = base === root;
  for (const { line, target } of deadLinks(readFileSync(join(base, file), 'utf8'), (t) => {
    opened++;
    return existsSync(resolve(from, decodeURIComponent(t)));
  })) {
    failed.push({
      shown: `${shown}:${line}  ->  ${target}`,
      at: resolve(from, decodeURIComponent(target)),
      parent: resolve(base, '..'),
      // The folder each repository sits under beside the other, read off the roots rather than written down twice.
      sibling: app ? basename(plans) : basename(root),
      otherRoot: app ? plans : root,
      ownersRoot: app ? null : ownersAppRoot,
    });
  }
}

const { dead, waiting } = classifyLinks(failed, (link) => crossingLink({ ...link, exists: existsSync }));

if (waiting.length) {
  console.log('these links open in the app copy the owner reads and not in this one, which was cut before that file landed:');
  for (const link of waiting) console.log(`  ${link.shown}`);
  console.log(`  Fix them in ${ownersApp}; this session leaves them alone.`);
}

if (dead.length) {
  console.error('these links open nothing:');
  for (const link of dead) console.error(`  ${link.shown}`);
  console.error('point each at where the file is now. A ticket that shipped moved into ../docs/done/,');
  console.error(DONE_REPOINTS_ADVICE);
  process.exit(1);
}

const folders = new Set(rows.map(([file]) => file.slice(0, file.lastIndexOf('/')) || '.'));
const links = waiting.length
  ? `${opened} document links, ${waiting.length} waiting on the app copy the owner reads and the rest opening something`
  : `${opened} document links all opening something`;
console.log(`docs: ${rows.length} Markdown files across ${folders.size} folders, every one with a role, no shipped plan left in a live folder, every live ticket that adds a control saying what it looks like, ${links}`);
