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

// The last box in a ticket is the owner's, unticked until they ask for `/done`, because a machine agreeing with itself is not evidence. A plan without one goes fully ticked on machine work alone, and the retirement report below then tells somebody to move it into `done/` before the owner has looked at anything. Owed from the day the plan is written: waiting for the first ticked box meets the fault in the middle of somebody's phase, where the section cannot be seen and gets written by whoever is nearest the code rather than by whoever scoped the plan.
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

/** A live plan nobody can approve, whatever state its work is in. A struck owner's box is a section that exists — the shape the ticket skill asks for where nothing is pressed. */
function ownerBoxOwed(file, text) {
  if (!livePlan(file)) return false;
  return ownerBoxes(text).length === 0;
}

// Where the section sits, so the two rules below can ask. `at` is the heading `ownerBoxes` reads — the first one anywhere in the file — and `copies` says whether that is the only one.
function ownerHeadingPlaces(text) {
  const lines = text.split('\n');
  let inPhases = false;
  let lastPhaseHeading = -1;
  let at = -1;
  let copies = 0;
  lines.forEach((line, i) => {
    if (/^##(?!#)\s/.test(line)) {
      inPhases = /^##\s+Phases\s*$/.test(line);
      return;
    }
    if (OWNER_HEADING.test(line)) {
      copies += 1;
      if (at === -1) at = i;
    }
    if (inPhases && /^###(?!#)\s/.test(line)) lastPhaseHeading = i;
  });
  return { at, lastPhaseHeading, copies };
}

// The section has one place: the last `###` inside `## Phases`, which is where every live plan carrying it already keeps it. One question catches every way it can move — below the record, left in the middle of the phases, written under no `## Phases` heading at all, or a second copy further down, which `ownerBoxes` never reads because it takes the first.
//
// Silent where there is no section at all: that is `ownerBoxOwed`'s refusal, and naming one plan twice teaches nobody anything.
function ownerSectionMisplaced(file, text) {
  if (!livePlan(file)) return false;
  const { at, lastPhaseHeading, copies } = ownerHeadingPlaces(text);
  if (at === -1) return false;
  return copies > 1 || at !== lastPhaseHeading;
}

// The gesture written loose is the expensive one: 21 live plans carried it as a box under `### Every phase ends the same way`, which is the line every phase ends with rather than a section anybody looks in, and a release refuses a plan whose one open box sits outside the section — so each of them would have stopped a release at the end of its last phase.
//
// Narrow on purpose. Every one of those 21 boxes opened with these three words, and a plan that genuinely needs the word owner inside a phase writes it anywhere but the front of a box.
const LOOSE_GESTURE = /^The owner /;

/** The one-based line of every box outside the owner's section that opens as the owner's gesture. */
function looseOwnerBoxes(file, text) {
  if (!livePlan(file)) return [];
  const lines = text.split('\n');
  const { at } = ownerHeadingPlaces(text);
  let end = at === -1 ? -1 : at + 1;
  while (end > -1 && end < lines.length && !/^#{1,6}[ \t]/.test(lines[end])) end += 1;
  const out = [];
  lines.forEach((line, i) => {
    if (at !== -1 && i > at && i < end) return;
    const box = BOX.exec(line);
    if (box && LOOSE_GESTURE.test(box[2])) out.push(i + 1);
  });
  return out;
}

/** A live plan that is genuinely done: nothing left open, and the owner's own box ticked or struck. */
function retirementReady(file, text) {
  if (!livePlan(file)) return false;
  const states = boxStates(text);
  const owner = ownerBoxes(text);
  // Only a ticked owner's box finishes a plan. A struck one says nothing is pressed, which is not the owner having looked at what was built, so a plan carrying one stays live until they say so.
  return states.includes('ticked')
    && !states.includes('open')
    && owner.length > 0
    && owner.every((state) => state === 'ticked');
}

// This tree fills a whole day in a day — 257 of its lines say `15 August 2026` — so a date on its own is not an answer to when: two stamps written the same day cannot be put in order, and neither can be told from twelve hours old. Every date the workflow writes carries the time beside it, off this machine's clock.
//
// **The cutoff is what makes the rule shippable.** The 1,600 dates already in the tree were written by passes that never recorded a time, and a time nobody wrote down cannot be invented — `/pm` already refuses a guessed date in the refused log. So this holds what is written from here rather than lying about what is behind it.
const DATED_FROM = 20260819;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// `D Month YYYY`, which is how every stamp in the plan tree is written. `2026-08-19` is a different shape and is left alone, which is also how the cutoff is written wherever a page names it: a boundary is not a stamp, and nothing recorded a time for it.
const DATED = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})`, 'g');

// A time straight after the date, in either clock: `, 9:11pm`, ` 9:11 pm`, `, 21:11`.
const TIME_AFTER = /^,?\s*\d{1,2}:\d{2}/;

// Future stamps need the actual time, not only evidence that one follows.
const STAMP_TIME = /^,?\s*(\d{1,2}):(\d{2})(?:\s*([ap]m))?/i;

/** The one-based line number of every date written on or after the cutoff that carries no time after it. */
export function datesWithoutTime(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const found of line.matchAll(DATED)) {
      const on = Number(found[3]) * 10000 + (MONTHS.indexOf(found[2]) + 1) * 100 + Number(found[1]);
      if (on < DATED_FROM) continue;
      if (TIME_AFTER.test(line.slice(found.index + found[0].length))) continue;
      out.push(i + 1);
    }
  });
  return out;
}

/** The line and stamp of every dated stamp at or after the cutoff that is later than now. */
export function datesAheadOfClock(text, now) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const found of line.matchAll(DATED)) {
      const on = Number(found[3]) * 10000 + (MONTHS.indexOf(found[2]) + 1) * 100 + Number(found[1]);
      if (on < DATED_FROM) continue;
      const time = STAMP_TIME.exec(line.slice(found.index + found[0].length));
      if (!time) continue;
      let hour = Number(time[1]);
      if (time[3]) hour = (hour % 12) + (time[3].toLowerCase() === 'pm' ? 12 : 0);
      const stamp = new Date(Number(found[3]), MONTHS.indexOf(found[2]), Number(found[1]), hour, Number(time[2]));
      if (stamp.getFullYear() !== Number(found[3]) || stamp.getMonth() !== MONTHS.indexOf(found[2]) || stamp.getDate() !== Number(found[1]) || stamp.getHours() !== hour || stamp.getMinutes() !== Number(time[2])) continue;
      if (stamp > now) out.push({ line: i + 1, stamp: `${found[0]}${time[0]}` });
    }
  });
  return out;
}

const DATE_CASES = [
  ['a date before the cutoff is left where it is', 'Found 15 August 2026 while building.', []],
  ['a date on the cutoff with no time is refused', '> **Not built.** A plan. Asked for 19 August 2026.', [1]],
  ['a date after the cutoff with no time is refused', 'Shipped 3 September 2026, v1.30.0.', [1]],
  ['the same date with a time passes', '> **Not built.** A plan. Asked for 19 August 2026, 9:11pm.', []],
  ['a time on the round clock is a time too', '**Last ranked 19 August 2026, 21:11.** Live: 4.', []],
  ['a time with a space before it is a time too', 'Designed 19 August 2026 9:11 am.', []],
  ['every date on a line is read, not just the first', 'Found 19 August 2026, 9:11pm, and again 20 August 2026.', [1]],
  ['an ISO date is a different shape and is not read', 'The 2026-08-19 sweep found five.', []],
  ['the line number is the one a reader opens', 'a\nb\nAsked for 19 August 2026.\n', [3]],
];

const AHEAD_OF_CLOCK_CASES = [
  ['a stamp an hour ahead is refused', 'Designed 19 August 2026, 10:11pm.', [{ line: 1, stamp: '19 August 2026, 10:11pm' }], []],
  ['a stamp a minute behind passes', 'Designed 19 August 2026, 9:10pm.', [], []],
  ['a stamp before the cutoff is untouched however far ahead it reads', 'Found 15 August 2026, 11:11pm.', [], []],
  ['a date with no time only fails the existing rule', 'Designed 19 August 2026.', [], [1]],
  ['a malformed stamp stays for its own validation ticket', 'Designed 31 February 2027, 9:11pm.', [], []],
];

function dateSelfTest() {
  const fails = [];
  for (const [name, text, want] of DATE_CASES) {
    const got = datesWithoutTime(text);
    if (got.join(',') !== want.join(',')) fails.push(`${name}: got [${got}], want [${want}]`);
  }
  return fails;
}

function aheadOfClockSelfTest() {
  const now = new Date(2026, 7, 19, 21, 11);
  const fails = [];
  for (const [name, text, wantAhead, wantDayOnly] of AHEAD_OF_CLOCK_CASES) {
    const gotAhead = datesAheadOfClock(text, now);
    const gotDayOnly = datesWithoutTime(text);
    if (JSON.stringify(gotAhead) !== JSON.stringify(wantAhead)) {
      fails.push(`${name}: got ahead ${JSON.stringify(gotAhead)}, want ${JSON.stringify(wantAhead)}`);
    }
    if (gotDayOnly.join(',') !== wantDayOnly.join(',')) {
      fails.push(`${name}: got day-only [${gotDayOnly}], want [${wantDayOnly}]`);
    }
  }
  return fails;
}

const OWNER_CASES = [
  [
    'a started plan with no owner\'s box is refused, and is not retirement',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n',
    { owed: true, ready: false, misplaced: false, loose: [] },
  ],
  [
    'the same plan with an open owner\'s box passes, and is not retirement',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] Open a file and confirm the line wraps\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'an owner\'s box ticked with every other box is the plan that shipped',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [x] Open a file and confirm the line wraps\n',
    { owed: false, ready: true, misplaced: false, loose: [] },
  ],
  [
    'a fully ticked plan with no owner\'s box is refused rather than reported as shipped',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [x] Test: it wraps\n',
    { owed: true, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a heading with nothing under it approves nothing',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [x] Built\n\n### The owner\'s box\n\n## What an earlier draft got wrong\n',
    { owed: true, ready: false, misplaced: false, loose: [] },
  ],
  [
    'the owner\'s box is read out of its own section, never the phase above it',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [ ] Not built yet\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a curled apostrophe is the same heading',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [x] Built\n\n### The owner’s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a plan nobody has started is refused too, so the fault is met while it is being written',
    '../docs/features/reading/a.md',
    '## Phases\n\n- [ ] Build it\n',
    { owed: true, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a shipped plan is not held to either rule',
    '../docs/done/app/a.md',
    '## Phases\n\n- [x] Built\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a plan whose last unticked box is struck through is ready to retire',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [ ] ~~Moved to tags.md~~\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: true, misplaced: false, loose: [] },
  ],
  [
    'a struck owner\'s box is a section that exists and nobody\'s word, so the plan stays live',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] ~~Nothing to press; this changes how a plan is counted~~\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a plan of nothing but struck boxes is nobody\'s work, so it stays live',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [ ] ~~Moved to tags.md~~\n\n### The owner\'s box\n\n- [ ] ~~Nothing to press~~\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a box struck part way along is a box whose wording changed, and it is still work',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n- [ ] The pane and ~~the pager~~\n\n### The owner\'s box\n\n- [x] Confirmed\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a section written below the record is not where every other plan keeps it',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n## What an earlier draft got wrong\n\n### The owner\'s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false, misplaced: true, loose: [] },
  ],
  [
    'a section left in the middle of the phases is the same fault',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] Confirm it\n\n### Phase 2\n\n- [ ] Build the rest\n',
    { owed: false, ready: false, misplaced: true, loose: [] },
  ],
  [
    'a section under no phases heading at all is not at the end of the phases',
    '../docs/features/reading/a.md',
    '## How it is built\n\n### The owner\'s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false, misplaced: true, loose: [] },
  ],
  [
    'a second copy further down is refused, since the reader takes the first and nobody reads the other',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### The owner\'s box\n\n- [ ] Confirm it\n\n## What an earlier draft got wrong\n\n### The owner\'s box\n\n- [ ] Confirm it again\n',
    { owed: false, ready: false, misplaced: true, loose: [] },
  ],
  [
    'a gesture written as a loose box under the line every phase ends with is named by its line',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] Built\n\n### Every phase ends the same way\n\n- [ ] The owner says it works\n\n### The owner\'s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false, misplaced: false, loose: [9] },
  ],
  [
    'a phase that says owner mid-sentence is left alone, since only the front of a box is read',
    '../docs/features/reading/a.md',
    '## Phases\n\n### Phase 1\n\n- [x] The pane opens the folder the owner last chose\n\n### The owner\'s box\n\n- [ ] Confirm it\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
  [
    'a shipped plan is held to neither, so the record it is stays the record it is',
    '../docs/done/app/a.md',
    '## Phases\n\n### Phase 1\n\n- [ ] The owner says it works\n\n### The owner\'s box\n\n- [ ] Confirm it\n\n## What an earlier draft got wrong\n\n### The owner\'s box\n\n- [ ] Again\n',
    { owed: false, ready: false, misplaced: false, loose: [] },
  ],
];

function ownerSelfTest() {
  const fails = [];
  for (const [name, file, text, want] of OWNER_CASES) {
    const owed = ownerBoxOwed(file, text);
    const ready = retirementReady(file, text);
    const misplaced = ownerSectionMisplaced(file, text);
    const loose = looseOwnerBoxes(file, text);
    if (owed !== want.owed) fails.push(`${name}: owed ${owed}, want ${want.owed}`);
    if (ready !== want.ready) fails.push(`${name}: retirement ${ready}, want ${want.ready}`);
    if (misplaced !== want.misplaced) fails.push(`${name}: placement ${misplaced}, want ${want.misplaced}`);
    if (loose.join(',') !== want.loose.join(',')) fails.push(`${name}: loose ${loose.join(',') || 'nothing'}, want ${want.loose.join(',') || 'nothing'}`);
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

// The page teaching a reader what the top of the window holds walks the bar left to right, so its sentence has to name the controls at the right in the order the bar draws them. It shipped naming them palette, Export PDF, Open, plus while the bar drew palette, Open, plus, Export PDF — and the alt text two lines above that sentence already named them the drawn way, so the page contradicted itself in two lines that touch.
//
// The order is never written down here. It is read off `src/assets/app-shell.html`, because the four are siblings in one container and nothing reorders them at any width, and because a list of them in this file is a second copy of the bar that rots the first time a control moves. Holding the sentence to the alt text instead would catch the two disagreeing and never catch them drifting together, which is the failure that just shipped.
//
// What is written down is only how each button is *spelled* in prose, which no markup can answer: `newButton` is `**+**` in the paragraph and "plus" in the alt text.
//
// A control added to that group with no spelling here fails the check, which is right — a new button in the bar owes the page a mention.
//
// **What this cannot see: a control in that group that is not an `icon-button`.** The update bell is one, and the page names it in its own paragraph rather than in the left-to-right walk.
const APP_BAR_SHELL = 'src/assets/app-shell.html';
const APP_BAR_PAGE = 'docs/01-features/02-navigation.md';
const APP_BAR_GROUP = 'app-actions-items';
const APP_BAR_HEADING = /^###[ \t]+The app bar[ \t]*$/;

/** How each right-hand control is spelled where the page names it. More than one because the alt text and the paragraph beneath it say the same button different ways. */
const APP_BAR_PHRASES = {
  themeSheetOpen: ['palette'],
  openButton: ['Open'],
  newButton: ['**+**', 'plus'],
  exportPdfButton: ['Export PDF'],
};

// The markup inside one container, with the closing tag counted rather than searched for: the actions group holds the update panel, so the first `</div>` after it closes that panel and every button in the bar sits past it.
function groupMarkup(html, cls) {
  const at = html.indexOf(`class="${cls}"`);
  if (at === -1) return null;
  const open = html.lastIndexOf('<div', at);
  if (open === -1) return null;
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, tag.index);
  }
  return null;
}

/** The ids of the bar's right-hand controls, in the order the markup draws them; null where the group is not there at all. */
export function appBarControls(html) {
  const markup = groupMarkup(html, APP_BAR_GROUP);
  if (markup === null) return null;
  return [...markup.matchAll(/<button\b[^>]*>/g)]
    .filter((tag) => /\bclass="[^"]*\bicon-button\b/.test(tag[0]))
    .map((tag) => /\bid="([^"]+)"/.exec(tag[0])?.[1] ?? '');
}

/** The picture's alt text and the paragraph under it, out of the page's app bar section; null where either is missing. */
export function appBarLines(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => APP_BAR_HEADING.test(line));
  if (at === -1) return null;
  let alt = null;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    const line = lines[i].trim();
    if (!line) continue;
    if (alt === null) {
      const picture = /^!\[([^\]]*)\]\(/.exec(line);
      if (!picture) break;
      alt = picture[1];
      continue;
    }
    return { alt, paragraph: line };
  }
  return null;
}

// Case-sensitive, and whole-word where the spelling has word edges — so "opens the theme picker" is not the Open button, while `**+**` still matches with no word character in it.
function namedAt(line, spelling) {
  const literal = spelling.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
  const lead = /^\w/.test(spelling) ? '\\b' : '';
  const tail = /\w$/.test(spelling) ? '\\b' : '';
  return line.search(new RegExp(`${lead}${literal}${tail}`));
}

/** Every way the page's two lines disagree with the order the markup draws the bar's right-hand controls in. */
export function appBarOrderFaults(html, text, phrases = APP_BAR_PHRASES) {
  const controls = appBarControls(html);
  if (controls === null || !controls.length) return [`${APP_BAR_SHELL}  ->  no controls found inside .${APP_BAR_GROUP}`];
  const unspelled = controls.filter((id) => !phrases[id]);
  if (unspelled.length) return unspelled.map((id) => `${APP_BAR_SHELL}  ->  #${id} is in the bar and the page has no word for it`);
  const lines = appBarLines(text);
  if (lines === null) return [`${APP_BAR_PAGE}  ->  the app bar section has no picture with a paragraph under it`];
  const drawn = controls.map((id) => phrases[id][0]);
  const out = [];
  for (const [where, line] of [["the picture's alt text", lines.alt], ['the paragraph under the picture', lines.paragraph]]) {
    const found = controls.map((id) => ({ id, at: Math.min(...phrases[id].map((word) => namedAt(line, word)).filter((i) => i !== -1), Infinity) }));
    const missing = found.filter((control) => control.at === Infinity);
    if (missing.length) {
      for (const control of missing) out.push(`${APP_BAR_PAGE}  ->  ${where} never names ${phrases[control.id][0]}`);
      continue;
    }
    const said = [...found].sort((a, b) => a.at - b.at).map((control) => phrases[control.id][0]);
    if (said.join(', ') !== drawn.join(', ')) out.push(`${APP_BAR_PAGE}  ->  ${where} names them ${said.join(', ')}; the bar draws them ${drawn.join(', ')}`);
  }
  return out;
}

const APP_BAR_ADVICE = [
  'the page walks the bar left to right, so it names the controls at the right in the order the markup puts them',
  'inside `.app-actions-items` — both in the picture\'s alt text and in the paragraph under it. Reorder the words, or,',
  'where a control was added to the bar, give it a phrase in `APP_BAR_PHRASES` and a mention on the page.',
];

const APP_BAR_MARKUP = [
  '<div class="app-trailing-items" id="appTrailingItems">',
  '<div class="app-actions-items" id="appActionsItems">',
  '<details class="update-menu" id="updateMenu" hidden><summary id="updateSummary" class="icon-button"></summary><div class="update-panel"><button type="button" class="update-button" id="updateButton"></button></div></details>',
  '<button type="button" id="themeSheetOpen" class="icon-button theme-button"></button>',
  '<button type="button" id="openButton" class="icon-button open-button"></button>',
  '<button type="button" id="newButton" class="icon-button new-button"></button>',
  '<button type="button" id="exportPdfButton" class="icon-button export-button" hidden></button>',
  '</div>',
  '<div class="window-controls"><button type="button" class="window-control" id="winClose"></button></div>',
  '</div>',
].join('\n');

const appBarPage = (alt, paragraph) => `## The chrome\n\n### The app bar\n\n![${alt}](../../imgs/navigation.png)\n\n${paragraph}\n\n### Export a PDF\n`;

const DRAWN_ALT = 'The Leaftext app bar: the leaf mark, then the theme palette, Open, plus and Export PDF at the right';
const DRAWN_PARAGRAPH = 'At the right the palette that opens the [theme picker](06-themes.md#choose), Open, **+** ([new document](07-editing.md#new-document)), and [Export PDF](#export-a-pdf).';
const SHIPPED_PARAGRAPH = 'At the right the palette that opens the [theme picker](06-themes.md#choose), [Export PDF](#export-a-pdf), Open, and **+** ([new document](07-editing.md#new-document)).';
const OUT_OF_ORDER = 'palette, Export PDF, Open, **+**; the bar draws them palette, Open, **+**, Export PDF';

const APP_BAR_CASES = [
  ['both lines naming them the way the bar draws them passes, and the update panel inside the group does not end it early', APP_BAR_MARKUP, appBarPage(DRAWN_ALT, DRAWN_PARAGRAPH), []],
  [
    'the order the page shipped with is refused, naming the line and both orders',
    APP_BAR_MARKUP,
    appBarPage(DRAWN_ALT, SHIPPED_PARAGRAPH),
    [`${APP_BAR_PAGE}  ->  the paragraph under the picture names them ${OUT_OF_ORDER}`],
  ],
  [
    'the alt text is held to the same source, so the two lines cannot drift together either',
    APP_BAR_MARKUP,
    appBarPage('The Leaftext app bar: the theme palette, Export PDF, Open and plus at the right', SHIPPED_PARAGRAPH),
    [
      `${APP_BAR_PAGE}  ->  the picture's alt text names them ${OUT_OF_ORDER}`,
      `${APP_BAR_PAGE}  ->  the paragraph under the picture names them ${OUT_OF_ORDER}`,
    ],
  ],
  [
    'a button added to the group with no word on the page is refused',
    APP_BAR_MARKUP.replace('<button type="button" id="exportPdfButton"', '<button type="button" id="printButton" class="icon-button print-button"></button>\n<button type="button" id="exportPdfButton"'),
    appBarPage(DRAWN_ALT, DRAWN_PARAGRAPH),
    [`${APP_BAR_SHELL}  ->  #printButton is in the bar and the page has no word for it`],
  ],
  [
    'a line that never names one of them is refused as missing rather than as out of order',
    APP_BAR_MARKUP,
    appBarPage(DRAWN_ALT, 'At the right the palette that opens the [theme picker](06-themes.md#choose), Open, and [Export PDF](#export-a-pdf).'),
    [`${APP_BAR_PAGE}  ->  the paragraph under the picture never names **+**`],
  ],
  [
    'the word that opens the theme picker is not read as the Open button',
    APP_BAR_MARKUP,
    appBarPage(DRAWN_ALT, 'At the right the palette that opens the [theme picker](06-themes.md#choose), Open, **+** ([new document](07-editing.md#new-document)), and [Export PDF](#export-a-pdf).'),
    [],
  ],
  [
    'a page whose app bar section has lost its picture is refused',
    APP_BAR_MARKUP,
    '## The chrome\n\n### The app bar\n\nAt the right the palette, Open, **+** and [Export PDF](#export-a-pdf).\n',
    [`${APP_BAR_PAGE}  ->  the app bar section has no picture with a paragraph under it`],
  ],
  ['markup with no actions group at all is refused', '<div class="app-trailing"></div>\n', appBarPage(DRAWN_ALT, DRAWN_PARAGRAPH), [`${APP_BAR_SHELL}  ->  no controls found inside .${APP_BAR_GROUP}`]],
];

function appBarSelfTest() {
  const fails = [];
  for (const [name, html, text, want] of APP_BAR_CASES) {
    const got = appBarOrderFaults(html, text);
    if (got.join('\n') !== want.join('\n')) fails.push(`${name}: got [${got.join(' | ') || 'nothing'}], want [${want.join(' | ') || 'nothing'}]`);
  }
  return fails;
}

const OWNER_ADVICE = [
  'the last box in a ticket is the owner\'s, unticked until they say the thing works — a machine agreeing with itself is not evidence.',
  'Write `### The owner\'s box` at the end of the phases in each, with one box holding the gesture the owner makes to see the thing,',
  'in what they will look at — see the "ticket" skill. Where the subject genuinely has nothing to press, strike the box with that reason.',
];

const PLACEMENT_ADVICE = [
  'the section is the last `###` inside `## Phases` — below every phase and above the record, which is where',
  'every other plan keeps it and where the next reader looks. Move it there, and where there are two copies,',
  'keep the one at the end of the phases: the reader takes the first, so the other is a gesture nobody sees.',
];

const LOOSE_ADVICE = [
  'a box opening "The owner " is the gesture only the owner makes, and it belongs under `### The owner\'s box`.',
  'Left in a phase it is work a build ticks off, and left under the line every phase ends with it is the one open',
  'box a release finds outside the section — which stops that release at the end of the last phase. Move it in.',
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

const dateFails = dateSelfTest();
if (dateFails.length) {
  console.error('dates: the reader is wrong, so nothing was read:');
  for (const line of dateFails) console.error(`  ${line}`);
  process.exit(1);
}

const aheadOfClockFails = aheadOfClockSelfTest();
if (aheadOfClockFails.length) {
  console.error('ahead-of-clock dates: the reader is wrong, so nothing was read:');
  for (const line of aheadOfClockFails) console.error(`  ${line}`);
  process.exit(1);
}

const strikeFails = strikeSelfTest();
if (strikeFails.length) {
  console.error('struck boxes: the reader is wrong, so nothing was read:');
  for (const line of strikeFails) console.error(`  ${line}`);
  process.exit(1);
}

const appBarFails = appBarSelfTest();
if (appBarFails.length) {
  console.error('the app bar order: the reader is wrong, so nothing was read:');
  for (const line of appBarFails) console.error(`  ${line}`);
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

// Nothing left open, the owner's own box ticked, and still filed as live work: the ticket shipped and nobody moved it. A plan with no boxes at all is a report or an index, not work with a finish line. The same pass asks the drawing question, the owner's-box question and the struck-box question, so each live ticket is read once.
const finished = [];
const undrawn = [];
const unapprovable = [];
const misplaced = [];
const loose = [];
const reasonless = [];

// Every file in the plan tree, not only the live half: a shipped note, a retired row and a refused row each carry a date, and each is written after the cutoff by a pass that has to read the clock for it.
const dayOnly = [];
const aheadOfClock = [];
const now = new Date();
for (const file of rows.map(([f]) => f)) {
  if (!file.startsWith('../docs/')) continue;
  const text = readFileSync(join(plans, file.slice('../docs/'.length)), 'utf8');
  for (const at of datesWithoutTime(text)) dayOnly.push(`${file}:${at}`);
  for (const found of datesAheadOfClock(text, now)) aheadOfClock.push(`${file}:${found.line}  ->  "${found.stamp}"`);
}

for (const file of rows.map(([f]) => f)) {
  if (!livePlan(file)) continue;
  const text = readFileSync(join(plans, file.slice('../docs/'.length)), 'utf8');
  for (const at of strikesWithoutReason(text)) reasonless.push(`${file}:${at}`);
  for (const at of looseOwnerBoxes(file, text)) loose.push(`${file}:${at}`);
  if (ownerSectionMisplaced(file, text)) misplaced.push(file);
  const states = boxStates(text);
  const ticked = states.filter((state) => state === 'ticked').length;
  const retired = states.filter((state) => state === 'retired').length;
  const count = `${ticked} ${ticked === 1 ? 'box' : 'boxes'} ticked${retired ? `, ${retired} struck through` : ''}`;
  if (retirementReady(file, text)) finished.push(`${file} (${count})`);
  if (ownerBoxOwed(file, text)) unapprovable.push(file);
  if (drawingOwed(file, text)) undrawn.push(file);
}

if (dayOnly.length) {
  console.error('these dates say what day it was and not what time:');
  for (const at of dayOnly) console.error(`  ${at}`);
  console.error('this tree fills a whole day in a day, so a date on its own cannot say which of two');
  console.error('stamps came first or whether one is twelve minutes old. Write the time beside it —');
  console.error('18 August 2026, 9:11pm — off this machine\'s clock (Get-Date), which keeps Arizona');
  console.error('time all year. See "Every date carries the time beside it" in AGENTS.md.');
  process.exit(1);
}

if (aheadOfClock.length) {
  console.error(`these stamps are later than this machine's local clock (${now.toLocaleString('en-US')}):`);
  for (const stamp of aheadOfClock) console.error(`  ${stamp}`);
  console.error('read the clock and write the time it says. A stamp records something finished, so it cannot be ahead of the check that reads it.');
  process.exit(1);
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

if (misplaced.length) {
  console.error('these live plans keep the owner\'s box where the next reader will not look:');
  for (const file of misplaced) console.error(`  ${file}  ->  "### The owner's box" is not the last ### inside ## Phases`);
  for (const line of PLACEMENT_ADVICE) console.error(line);
  process.exit(1);
}

if (loose.length) {
  console.error('these live plans write the owner\'s gesture as a box outside the owner\'s section:');
  for (const at of loose) console.error(`  ${at}`);
  for (const line of LOOSE_ADVICE) console.error(line);
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

const outOfOrder = appBarOrderFaults(
  readFileSync(join(root, APP_BAR_SHELL), 'utf8'),
  readFileSync(join(root, APP_BAR_PAGE), 'utf8'),
);

if (outOfOrder.length) {
  console.error('the app bar page does not name the bar\'s right-hand controls the way the bar draws them:');
  for (const line of outOfOrder) console.error(`  ${line}`);
  for (const line of APP_BAR_ADVICE) console.error(line);
  process.exit(1);
}

const folders = new Set(rows.map(([file]) => file.slice(0, file.lastIndexOf('/')) || '.'));
const links = `${opened} document links all opening something`;
console.log(`docs: ${rows.length} Markdown files across ${folders.size} folders, every one with a role, no shipped plan left in a live folder, every live plan carrying a box only the owner can tick at the end of its phases and nowhere else, every struck box saying where its work went, every live ticket that adds a control saying what it looks like, the app bar page naming the bar's right-hand controls in the order the markup draws them, every date written since 19 August 2026 saying what time it was, ${links}`);
