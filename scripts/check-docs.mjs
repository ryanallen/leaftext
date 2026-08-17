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
import { planTree } from './plan-tree.mjs';

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

// What one link that failed to open really is. A crossing link is looked for again inside the other tree's own root, because the two trees are separate repositories and a relative link between them resolves against neither.
export function crossingLink({ at, parent, sibling, otherRoot, exists }) {
  const inner = crossesTo(at, parent, sibling);
  if (inner === null) return 'gone';
  return exists(join(otherRoot, inner)) ? 'opens' : 'gone';
}

// The two trees, written out so the cases below read as the shapes they are.
const APP = resolve('/leaftext/app');
const PLANS = resolve('/leaftext/docs');

// Each row: what it proves, where the ordinary resolution landed, which root to ask, what is on the disk, and the verdict.
const CROSSING_CASES = [
  [
    'a link out of the app into the plan tree opens against the plan tree',
    { at: resolve(APP, '..', 'docs', 'GLOSSARY.md'), parent: resolve(APP, '..'), sibling: 'docs', otherRoot: PLANS },
    [join(PLANS, 'GLOSSARY.md')],
    'opens',
  ],
  [
    'a link out of the plan tree into the app opens against the checkout',
    { at: resolve(PLANS, '..', 'app', 'scripts', 'here.mjs'), parent: resolve(PLANS, '..'), sibling: 'app', otherRoot: APP },
    [join(APP, 'scripts', 'here.mjs')],
    'opens',
  ],
  [
    'a dead link inside one tree is nobody\'s crossing and still fails',
    { at: resolve(APP, 'docs', 'gone.md'), parent: resolve(APP, '..'), sibling: 'docs', otherRoot: PLANS },
    [],
    'gone',
  ],
  [
    'a link into an app file nobody has fails',
    { at: resolve(PLANS, '..', 'app', 'scripts', 'never.mjs'), parent: resolve(PLANS, '..'), sibling: 'app', otherRoot: APP },
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

// The last box in a ticket is the owner's, unticked until they ask for `/done`, because a machine agreeing with itself is not evidence. A plan without one goes fully ticked on machine work alone, and the retirement report below then tells somebody to move it into `done/` before the owner has looked at anything. Owed from the day the plan is written: waiting for the first ticked box met the fault in the middle of somebody's phase, where the section cannot be seen and gets written by whoever was nearest the code rather than by whoever scoped the plan.
//
// The heading is matched with either apostrophe, since a ticket written in an editor that curls them is the same section.
const OWNER_HEADING = /^###[ \t]+The owner[’']s box[ \t]*$/;

const BOX = /^\s*- \[( |x)\]\s*(.*)$/;

// A strike that closes, and whatever follows it — the reason the box was retired. The closing pair keeps the count in step with the page: Markdown draws `~~moved` as ordinary text with two tildes in front of it, so reading the opening alone drops a box a person can still see.
const STRUCK = /^~~.*?~~(.*)$/;

// Striking a box retires it — the work moved or changed shape, and the line stays so nobody re-plans it — so it is neither work left nor evidence, and every count here reads it through this one function. Retired only where the strike is the first thing after the box: one part way along is a box whose wording changed, and it is still work.
/** `ticked`, `open` or `retired` for a box line; null for anything else. */
function boxState(line) {
  const box = BOX.exec(line);
  if (!box) return null;
  if (box[1] === 'x') return 'ticked';
  return STRUCK.test(box[2]) ? 'retired' : 'open';
}

// A struck box is out of every count that decides when a plan is finished, so the reason written after the strike is the only record of where the work went. Anything non-whitespace counts: nowhere in the tree says how a reason is written, and a check cannot judge whether a sentence explains anything anyway.
/** The one-based line number of every struck box in a document that carries no reason after the strike. */
function strikesWithoutReason(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const box = BOX.exec(line);
    if (!box || box[1] === 'x') return;
    const struck = STRUCK.exec(box[2]);
    if (struck && !struck[1].trim()) out.push(i + 1);
  });
  return out;
}

/** Every box in a document, in order, as its state. */
function boxStates(text) {
  return text.split('\n').map(boxState).filter(Boolean);
}

/** Every box under the owner's own heading, as its state. Empty where the section is missing or carries none, which approves nothing either way. */
function ownerBoxes(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => OWNER_HEADING.test(line));
  if (at === -1) return [];
  const boxes = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^#{1,6}[ \t]/.test(lines[i])) break;
    const state = boxState(lines[i]);
    if (state) boxes.push(state);
  }
  return boxes;
}

/** A live plan nobody can approve, whatever state its work is in. A struck owner's box is a section that exists — the shape the ticket skill asks for where nothing is pressed. Refused from the day the plan is written rather than from the first ticked box, because the fault is in the plan and waiting for a tick meets it in the middle of somebody's phase. */
function ownerBoxOwed(file, text) {
  if (!livePlan(file)) return false;
  return ownerBoxes(text).length === 0;
}

/** A live plan that is genuinely done: nothing left open, and the owner's own box ticked or struck. */
function retirementReady(file, text) {
  if (!livePlan(file)) return false;
  const states = boxStates(text);
  const owner = ownerBoxes(text);
  return states.includes('ticked')
    && !states.includes('open')
    && owner.length > 0
    && owner.every((state) => state !== 'open');
}

const OWNER_CASES = [
  [
    'a started plan with no owner\'s box is refused, and is not retirement',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n',
    { owed: true, ready: false },
  ],
  [
    'the same plan with an open owner\'s box passes, and is not retirement',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] Open a file and confirm the line wraps\n',
    { owed: false, ready: false },
  ],
  [
    'an owner\'s box ticked with every other box is the plan that shipped',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [x] Open a file and confirm the line wraps\n',
    { owed: false, ready: true },
  ],
  [
    'a fully ticked plan with no owner\'s box is refused rather than reported as shipped',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [x] Test: it wraps\n',
    { owed: true, ready: false },
  ],
  [
    'a heading with nothing under it approves nothing',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [x] Built\n\n### The owner\'s box\n\n## What an earlier draft got wrong\n',
    { owed: true, ready: false },
  ],
  [
    'the owner\'s box is read out of its own section, never the phase above it',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [ ] Not built yet\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: false },
  ],
  [
    'a curled apostrophe is the same heading',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [x] Built\n\n### The owner’s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false },
  ],
  [
    'a plan nobody has started is refused too, so the fault is met while it is being written',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [ ] Build it\n',
    { owed: true, ready: false },
  ],
  [
    'a shipped plan is not held to either rule',
    '../docs/done/app/a.md',
    '## Phases\n\n- [x] Built\n',
    { owed: false, ready: false },
  ],
  [
    'a plan whose last unticked box is struck through is ready to retire',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [ ] ~~Moved to tags.md~~\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: true },
  ],
  [
    'a struck owner\'s box is a section that exists and an owner who answered',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] ~~Nothing to press; this changes how a plan is counted~~\n',
    { owed: false, ready: true },
  ],
  [
    'a plan of nothing but struck boxes is nobody\'s work, so it stays live',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [ ] ~~Moved to tags.md~~\n\n### The owner\'s box\n\n- [ ] ~~Nothing to press~~\n',
    { owed: false, ready: false },
  ],
  [
    'a box struck part way along is a box whose wording changed, and it is still work',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [ ] The pane and ~~the pager~~\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: false },
  ],
];

function ownerSelfTest() {
  const fails = [];
  for (const [name, file, text, want] of OWNER_CASES) {
    const owed = ownerBoxOwed(file, text);
    const ready = retirementReady(file, text);
    if (owed !== want.owed) fails.push(`${name}: owed ${owed}, want ${want.owed}`);
    if (ready !== want.ready) fails.push(`${name}: retirement ${ready}, want ${want.ready}`);
  }
  return fails;
}

const STRIKE_CASES = [
  [
    'a struck box with nothing after the strike is refused, and its line is named',
    '## Phases\n\n- [ ] ~~Moved to tags.md~~\n',
    [3],
    ['retired'],
  ],
  [
    'a struck box carrying its reason passes',
    '## Phases\n\n- [ ] ~~Moved to tags.md~~ — the pager owns it now\n',
    [],
    ['retired'],
  ],
  [
    'a reason written without an em dash passes, since nothing says how one is written',
    '## Phases\n\n- [ ] ~~Moved to tags.md~~: the pager owns it now\n',
    [],
    ['retired'],
  ],
  [
    'a strike that never closes is work left, which is what the page draws',
    '## Phases\n\n- [ ] ~~Moved to tags.md\n',
    [],
    ['open'],
  ],
  [
    'whitespace after the strike is not a reason',
    '## Phases\n\n- [ ] ~~Moved to tags.md~~   \n',
    [3],
    ['retired'],
  ],
  [
    'a box struck part way along is still work, and is never asked for a reason',
    '## Phases\n\n- [ ] The pane and ~~the pager~~\n',
    [],
    ['open'],
  ],
  [
    'a ticked box is untouched',
    '## Phases\n\n- [x] Built\n',
    [],
    ['ticked'],
  ],
  [
    'a struck owner\'s box is held to the same rule as any other',
    '### The owner\'s box\n\n- [ ] ~~Press something in the app~~\n',
    [3],
    ['retired'],
  ],
];

function strikeSelfTest() {
  const fails = [];
  for (const [name, text, wantLines, wantStates] of STRIKE_CASES) {
    const lines = strikesWithoutReason(text);
    const states = boxStates(text);
    if (lines.join(',') !== wantLines.join(',')) fails.push(`${name}: refused ${lines.join(',') || 'nothing'}, want ${wantLines.join(',') || 'nothing'}`);
    if (states.join(',') !== wantStates.join(',')) fails.push(`${name}: read as ${states.join(',')}, want ${wantStates.join(',')}`);
  }
  return fails;
}

const OWNER_ADVICE = [
  'the last box in a ticket is the owner\'s, unticked until they say the thing works — a machine agreeing with itself is not evidence.',
  'Write `### The owner\'s box` at the end of the phases in each, with one box holding the gesture the owner makes to see the thing,',
  'in what they will look at — see the "ticket" skill. Where the subject genuinely has nothing to press, strike the box with that reason.',
];

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

const ownerFails = ownerSelfTest();
if (ownerFails.length) {
  console.error('the owner\'s box: the matcher is wrong, so nothing was read:');
  for (const line of ownerFails) console.error(`  ${line}`);
  process.exit(1);
}

const strikeFails = strikeSelfTest();
if (strikeFails.length) {
  console.error('struck boxes: the reader is wrong, so nothing was read:');
  for (const line of strikeFails) console.error(`  ${line}`);
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

// Nothing left open, the owner's own box answered, and still filed as live work: the ticket shipped and nobody moved it. A plan with no boxes at all is a report or an index, not work with a finish line. The same pass asks the drawing question, the owner's-box question and the struck-box question, so each live ticket is read once.
const finished = [];
const undrawn = [];
const unapprovable = [];
const reasonless = [];
for (const file of rows.map(([f]) => f)) {
  if (!livePlan(file)) continue;
  const text = readFileSync(join(plans, file.slice('../docs/'.length)), 'utf8');
  for (const at of strikesWithoutReason(text)) reasonless.push(`${file}:${at}`);
  const states = boxStates(text);
  const ticked = states.filter((state) => state === 'ticked').length;
  const retired = states.filter((state) => state === 'retired').length;
  const count = `${ticked} ${ticked === 1 ? 'box' : 'boxes'} ticked${retired ? `, ${retired} struck through` : ''}`;
  if (retirementReady(file, text)) finished.push(`${file} (${count})`);
  if (ownerBoxOwed(file, text)) unapprovable.push(file);
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

if (unapprovable.length) {
  console.error('these live plans have no box the owner can tick:');
  for (const file of unapprovable) console.error(`  ${file}  ->  no "### The owner's box" section`);
  for (const line of OWNER_ADVICE) console.error(line);
  process.exit(1);
}

if (reasonless.length) {
  console.error('these live plans strike a box through and never say where the work went:');
  for (const at of reasonless) console.error(`  ${at}`);
  console.error('a struck box is out of every count that decides when a plan is finished, so the reason');
  console.error('written after the strike is the only record the work existed. Put it on the same line —');
  console.error('what moved it, or what it became. See "Struck through" in ../docs/GLOSSARY.md.');
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
    });
  }
}

const dead = failed.filter((link) => crossingLink({ ...link, exists: existsSync }) !== 'opens');

if (dead.length) {
  console.error('these links open nothing:');
  for (const link of dead) console.error(`  ${link.shown}`);
  console.error('point each at where the file is now. A ticket that shipped moved into ../docs/done/,');
  console.error(DONE_REPOINTS_ADVICE);
  process.exit(1);
}

const folders = new Set(rows.map(([file]) => file.slice(0, file.lastIndexOf('/')) || '.'));
const links = `${opened} document links all opening something`;
console.log(`docs: ${rows.length} Markdown files across ${folders.size} folders, every one with a role, no shipped plan left in a live folder, every live plan carrying a box only the owner can tick, every struck box saying where its work went, every live ticket that adds a control saying what it looks like, ${links}`);
