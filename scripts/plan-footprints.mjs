#!/usr/bin/env node
// Which live tickets can be built alongside which. The running order says what to pick up now and cannot say what to pick up now *as well*, so somebody starting a second agent answers that by reading two plans and hoping — and hoping wrong is not a merge conflict, it is one agent's edit silently replacing another's.
//
//   node scripts/plan-footprints.mjs <ticket>   that row's partners, highest-ranked first, with the total
//   node scripts/plan-footprints.mjs --check    the reader, the pairing and the cell, on made-up footprints
//   node scripts/plan-footprints.mjs --write    the `Devs with` column, into every row of the running order
//
// A ticket's footprint is the files its build will write, written under `## What it writes`. It is not the ticket's citations — those are files a plan *read*, and 55 live tickets quote a rule out of `app/AGENTS.md` without touching it — so it is written rather than derived, and `/ticket`, `/design` and `/dev` each keep it.
//
// Which is why the one thing refused about a path is the spelling: every one is written from the top of the pair of repositories — `app/…` or `docs/…` — because both halves hold a `README.md` and an `AGENTS.md`, so a bare path names two different files, and because the tree cites one file from two roots today, which a set comparison reads as two files.
//
// **Existence is never asked, and a path is never resolved.** 86 of the 153 live tickets name a path in their phases that is not on the disk, 239 paths of 267, and they are the modules, scripts and fragments those builds exist to create — so a refusal on existence would refuse more than half the tree for planning correctly. Comparing the string is also what makes two tickets that will both create the same module collide before either has, which is the pair this column most needs to catch. Nothing separates a new file from a mistyped one: `app/src/fooo.rs` sits in a folder that is there exactly the way `app/src/agent/mod.rs` does, and a typo inside a real root is caught by `/design` opening the footprint against the code and by the phase that cannot compile it.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';
import { links, planRows } from './plan-rows.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

// Where a live ticket lives. Not exported: both plan checks carry the same three folders for their own walks, and a third name for one list is a third place it can go wrong.
const LIVE_PLANS = ['features', 'refactor', 'fixes'];

const FOOTPRINT_HEADING = /^##(?!#)[ \t]+What it writes[ \t]*$/;

const FOOTPRINT_ROOTS = ['app/', 'docs/'];

// The shared plan files a build can still reach, with the reason each one is here. A ticket writes them down like any other — the section is what this build writes, and leaving them out to help the comparison is the section lying about the work.
//
// `docs/PLAN.md`: no build authors a cell in it. Its stage is written in its own ticket and the column is computed, so the two writes a build can make here — `just bundle-devs-with` and `just bundle-plan-status` — are both derived, and two builds running either produce the same bytes from the same tickets rather than landing on each other's edit. The authored rewrites are `/pm`'s and `/done`'s, and neither runs beside a build.
//
// `docs/README.md` and `docs/GLOSSARY.md`: a build reaches these only by filing what it found beside its work, which appends a row to a table rather than rewriting the file.
//
// **`docs/tracks/` and the `docs/TRACKS.md` above it are deliberately not on this list.** Read out of the skills they have one writer — `/pm`, giving a subject its first track a file and the index its row — and no build among them, so they are real colliders and two tickets planning to write either are told so. The folder counts the way any folder does: a ticket naming `docs/tracks/` collides with every ticket naming a track file inside it.
//
// **`app/AGENTS.md` is deliberately not on it either.** It is the biggest single false collider among citations, and a workflow ticket genuinely does change the guide: excluding it would call two such tickets safe together, which is the one mistake that costs somebody's work.
export const EXCLUDED = ['docs/PLAN.md', 'docs/README.md', 'docs/GLOSSARY.md'];

/// The lines of a ticket's footprint section, or null where it carries none — which is a different answer from a section carrying no files.
function footprintSection(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => FOOTPRINT_HEADING.test(line));
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^##(?!#)[ \t]/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// Read out of the first cell of every table row, so the phase column beside it is never mistaken for a path. The header and the dashes carry no backticks and fall out on their own, and a row naming a whole folder carries several — a sweep across `docs/features/` is one row and three paths is one row.
/// Every path a footprint names, in order. Empty where it writes nothing; null where there is no section at all.
export function footprintPaths(text) {
  const body = footprintSection(text);
  if (body === null) return null;
  const out = [];
  for (const line of body) {
    if (!line.trimStart().startsWith('|')) continue;
    const first = line.trim().replace(/^\|/, '').split('|')[0] ?? '';
    for (const [, path] of first.matchAll(/`([^`\n]+)`/g)) out.push(path);
  }
  return out;
}

/// Whether a ticket says anything at all about what it writes. `—` is a section: it says the build writes no file.
export function hasFootprint(text) {
  return footprintSection(text) !== null;
}

/// Every footprint path spelled from neither root, said as it is written. A path that climbs is one of these too: a footprint is compared as the string it is written as, so anything resolved outside its own root cannot be compared at all.
export function footprintMisspelled(text) {
  return (footprintPaths(text) ?? []).filter((path) => path.includes('..') || !FOOTPRINT_ROOTS.some((root) => path.startsWith(root)));
}

/// What one ticket's build actually claims, with the excluded shared plan files dropped and its own file dropped — one ticket has one writer.
export function claimedBy(ticket, text) {
  const own = `docs/${ticket}`;
  return (footprintPaths(text) ?? []).filter((path) => path !== own && !EXCLUDED.includes(path));
}

// A row naming a folder claims everything inside it, so a sweep across `docs/features/` is never called safe beside a ticket in that folder. Read as a prefix on the written string: a footprint that names `app/src/assets/shell/` and one that names `app/src/assets/shell/state.js` are the same file being written twice.
//
// **A split is read as the same claim from both sides.** Splitting a file leaves its name standing over the folder the work moved into — `scripts/check-shell.mjs` is a 101-line entry over 43 files in `scripts/check-shell/` — and a footprint written before the split goes on naming the file, because nothing moves it. So a claim's stem is read as the folder beside it: `foo.ext` and anything under `foo/` are one file. On 25 August 2026, 9:52am the column sent two sessions into one file for want of this: one footprint said `app/scripts/check-shell.mjs`, the other `app/scripts/check-shell/page.mjs`, and the pairing called them each other's safest partner. It over-reports where a split really did leave two separate things, which costs a pair somebody could have built alongside — the cheap direction, against an edit one of two sessions loses.
const stemFolder = (claim) => (claim.endsWith('/') ? null : `${claim.replace(/.[^./]+$/, '')}/`);
/// Whether two claims are the same file, one inside the other, one inside the folder the other was split into, or neither.
export function sharesFile(a, b) {
  const inside = (folder, claim) => folder !== null && claim.startsWith(folder);
  return a === b
    || inside(a.endsWith('/') ? a : null, b)
    || inside(b.endsWith('/') ? b : null, a)
    || inside(stemFolder(a), b)
    || inside(stemFolder(b), a);
}

/// Every file two footprints both write. Empty means the two builds touch nothing in common.
export function overlap(left, right) {
  const found = [];
  for (const a of left) {
    for (const b of right) {
      if (!sharesFile(a, b)) continue;
      found.push(a.length >= b.length ? a : b);
    }
  }
  return [...new Set(found)].sort();
}

// A wait is not a parallel run, whatever the two file lists say: the blocked ticket cannot start, so naming it as a partner would send somebody at work that is not ready. Read both ways, because only the waiting row's own cell is the source.
/// Whether either of two rows waits on the other.
export function waitsOnEachOther(rows, left, right) {
  const cell = (name) => rows.find((row) => row.ticket === name)?.blockers ?? [];
  return cell(left).includes(right) || cell(right).includes(left);
}

/// Every live ticket this one shares no file with, in the running order's own order. `rows` is the order, `claims` maps a ticket to what its build writes.
export function partnersFor(rows, claims, ticket) {
  const mine = claims.get(ticket);
  if (!mine) return [];
  return rows
    .filter((row) => row.ticket && row.ticket !== ticket && claims.has(row.ticket))
    .filter((row) => overlap(mine, claims.get(row.ticket)).length === 0)
    .filter((row) => !waitsOnEachOther(rows, ticket, row.ticket))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
    .map((row) => row.ticket);
}

function markdown(dir, base) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const at = join(dir, name);
    if (statSync(at).isDirectory()) out.push(...markdown(at, base));
    else if (name.endsWith('.md')) out.push(relative(base, at).split(/[\\/]/).join('/'));
  }
  return out;
}

/// What every live ticket claims, keyed by its path inside the plan tree — `refactor/workflow/a.md`, the way a running-order row links it.
export function claimsInTree(plans = planTree(here)) {
  const claims = new Map();
  for (const folder of LIVE_PLANS) {
    for (const file of markdown(join(plans, folder), plans)) {
      const text = readFileSync(join(plans, file), 'utf8');
      if (!hasFootprint(text)) continue;
      claims.set(file, claimedBy(file, text));
    }
  }
  return claims;
}

// The running order is an LF file (`.gitattributes`), and this writes it back line by line.
const NL = '\n';

/// How many partners a cell names before it stops and gives a total instead. Three, because 87 partners is not a list anybody reads and the reader's question is what to pick up next, not a census.
export const CELL_BOUND = 3;

/// The header this column is written under, and where it sits — after `Track`, before `Why`, which is the one spot no positional read in either plan check moves over.
export const CELL_HEADING = 'Devs with';

/// What one row's cell says: the highest-ranked partners, then the total in brackets where more were left out. `—` where nothing is disjoint.
export function cellFor(partners) {
  if (!partners.length) return '—';
  const named = partners.slice(0, CELL_BOUND);
  const link = (path) => `[${path.split('/').pop().replace(/\.md$/, '')}](${path})`;
  const shown = named.map(link).join(', ');
  return partners.length > CELL_BOUND ? `${shown} (${partners.length} in all)` : shown;
}

// A cell is written by the bundler and never by hand, so what it may look like is one shape: an em dash, or one to three links with an optional count after them. Anything else is a hand edit, which is the thing phase 5's refusal is for.
const CELL_LINK = String.raw`\[[^\]]+\]\([^)\s]+\)`;
export const CELL_SHAPE = new RegExp(`^(?:—|${CELL_LINK}(?:, ${CELL_LINK}){0,${CELL_BOUND - 1}}(?: \\(\\d+ in all\\))?)$`);

// Written straight over the table's own pipes rather than through a row reader, because the cell has to land in a fixed place in a line whose every other cell is left byte for byte as it was.
/// The running order with this column written into every row — added after `Track` where it is not there yet, replaced where it is.
export function withColumn(planText, rows, claims) {
  const answered = new Map();
  for (const row of rows) {
    if (!row.ticket || !claims.has(row.ticket)) continue;
    answered.set(row.ticket, cellFor(partnersFor(rows, claims, row.ticket)));
  }
  const out = [];
  // Where the column goes in the table being read, and where it already sits. Both are read off each header row, so a file that carries the column and one that does not are the same walk, and a table with no header is left alone.
  let spot = null;
  let already = null;
  for (const line of planText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      out.push(line);
      spot = null;
      already = null;
      continue;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const bare = () => (already === null ? cells : cells.filter((_, i) => i !== already));
    const write = (value) => {
      const kept = bare();
      out.push(`| ${[...kept.slice(0, spot), value, ...kept.slice(spot)].join(' | ')} |`);
    };
    if (cells[0] === '#') {
      const held = cells.indexOf(CELL_HEADING);
      already = held === -1 ? null : held;
      const track = bare().indexOf('Track');
      // With no Track column the cell goes where Track would have put it: second from the end, since `Why` is always last.
      spot = track === -1 ? bare().length - 1 : track + 1;
      write(CELL_HEADING);
      continue;
    }
    if (spot === null) {
      out.push(line);
      continue;
    }
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      write('---');
      continue;
    }
    // A struck row is retired and names no live work, so it keeps whatever it was written with.
    const ticket = links(cells[1] ?? '')[0] ?? null;
    const held = already === null ? '—' : (cells[already] ?? '—');
    write(ticket && answered.has(ticket) ? answered.get(ticket) : held);
  }
  return out.join(NL);
}

// Each row: what it proves, the section as written, and the paths the reader should find — `null` for no section at all.
const FOOTPRINT_CASES = [
  [
    'the reader finds every path in the file column and none of the phase column',
    '## Phases\n\n- [ ] a\n\n## What it writes\n\n| file | phase |\n|---|---|\n| `app/src/format.rs` | 1 |\n| `docs/GLOSSARY.md` | 2, 3 |\n\n## What an earlier draft got wrong\n',
    ['app/src/format.rs', 'docs/GLOSSARY.md'],
  ],
  [
    'a section that is absent reads as absent, not as writing nothing',
    '## Phases\n\n- [ ] a\n\n## What an earlier draft got wrong\n',
    null,
  ],
  [
    'a ticket that writes nothing has a section and no paths',
    '## What it writes\n\n—\n',
    [],
  ],
  [
    'the header row and the dashes are not paths',
    '## What it writes\n\n| file | phase |\n| --- | --- |\n| `app/Justfile` | 1 |\n',
    ['app/Justfile'],
  ],
  [
    'a row naming a whole folder carries every path in its cell',
    '## What it writes\n\n| file | phase |\n|---|---|\n| every live ticket under `docs/features/`, `docs/refactor/` | 2 |\n',
    ['docs/features/', 'docs/refactor/'],
  ],
  [
    'the section stops at the next `##`, so a later table is not read into it',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `app/Justfile` | 1 |\n\n## What an earlier draft got wrong\n\n| a | b |\n|---|---|\n| `app/gone.rs` | x |\n',
    ['app/Justfile'],
  ],
  [
    'a `###` inside the section does not end it',
    '## What it writes\n\n### the app\n\n| file | phase |\n|---|---|\n| `app/Justfile` | 1 |\n',
    ['app/Justfile'],
  ],
];

function footprintSelfTest() {
  const fails = [];
  for (const [name, text, want] of FOOTPRINT_CASES) {
    const got = footprintPaths(text);
    const same = want === null ? got === null : got !== null && got.join(',') === want.join(',');
    if (!same) fails.push(`${name}: got ${got === null ? 'no section' : `[${got.join(' | ')}]`}, want ${want === null ? 'no section' : `[${want.join(' | ')}]`}`);
  }
  return fails;
}

// Each row: what it proves, the section, and the paths that should be refused.
const FOOTPRINT_PATH_CASES = [
  [
    'a path from either root passes',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `app/src/format.rs` | 1 |\n| `docs/GLOSSARY.md` | 2 |\n',
    [],
  ],
  [
    'a file the build will create passes, in a folder that is not there either',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `app/src/agent/mod.rs` | 1 |\n| `app/scripts/plan-footprints.mjs` | 3 |\n',
    [],
  ],
  [
    'the same file spelled from no root is refused, since it names one file in each half of the pair',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `src/format.rs` | 1 |\n',
    ['src/format.rs'],
  ],
  [
    'a bare basename is refused, which is how the tree spells a citation and never a footprint',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `state.js` | 1 |\n',
    ['state.js'],
  ],
  [
    'a path climbing out is refused, because a footprint is compared as a name and never resolved',
    '## What it writes\n\n| file | phase |\n|---|---|\n| `../../GLOSSARY.md` | 1 |\n| `app/../docs/GLOSSARY.md` | 2 |\n',
    ['../../GLOSSARY.md', 'app/../docs/GLOSSARY.md'],
  ],
  [
    'a ticket with no section is refused by its own rule and not by this one',
    '## Phases\n\n- [ ] a\n',
    [],
  ],
];

function footprintPathSelfTest() {
  const fails = [];
  for (const [name, text, want] of FOOTPRINT_PATH_CASES) {
    const got = footprintMisspelled(text);
    if (got.join(',') !== want.join(',')) fails.push(`${name}: got [${got.join(' | ') || 'nothing'}], want [${want.join(' | ') || 'nothing'}]`);
  }
  return fails;
}

// A made-up running order and a made-up set of footprints, so the pairing is proved before the real tree is opened. Six rows, each one a case the column has to get right.
const PAIR_ORDER = `# Leaftext Plan Log

## Tier 1 — wrong today

| # | Ticket | Status | Blocks | Blocked by | Track | Why |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [a](fixes/reading/a.md) | Ready | — | — | t | … |
| 2 | [b](fixes/reading/b.md) | Ready | — | — | t | … |
| 3 | [c](fixes/reading/c.md) | Ready | — | — | t | … |
| 4 | [d](fixes/reading/d.md) | Ready | — | [a](fixes/reading/a.md) | t | … |
| 5 | [e](fixes/reading/e.md) | Ready | — | — | t | … |
| 6 | [f](fixes/reading/f.md) | Ready | — | — | t | … |
`;

const PAIR_CLAIMS = new Map([
  // Shares a real file with b, and nothing with c, e or f.
  ['fixes/reading/a.md', ['app/src/format.rs']],
  ['fixes/reading/b.md', ['app/src/format.rs', 'app/AGENTS.md']],
  // Shares only the guide with b, which is on purpose not excluded, and nothing at all with e.
  ['fixes/reading/c.md', ['app/AGENTS.md']],
  // Waits on a, and shares no file with it.
  ['fixes/reading/d.md', ['app/src/lib.rs']],
  // Writes a module that is not on the disk yet — and so does f.
  ['fixes/reading/e.md', ['app/src/agent/mod.rs']],
  // Names the folder e's file sits in.
  ['fixes/reading/f.md', ['app/src/agent/']],
  // Names a file by the name it had before it was split, the way 41 live footprints did.
  ['fixes/reading/g.md', ['app/src/shell.rs']],
  // Names a file inside the folder that split left behind.
  ['fixes/reading/h.md', ['app/src/shell/parts.rs']],
]);

const PAIR_CASES = [
  ['a pair sharing a real file is not disjoint', 'fixes/reading/a.md', 'fixes/reading/b.md', false],
  ['a pair sharing only the guide is not disjoint, because a workflow ticket really writes it', 'fixes/reading/b.md', 'fixes/reading/c.md', false],
  ['a pair sharing nothing is disjoint', 'fixes/reading/a.md', 'fixes/reading/c.md', true],
  ['a pair where one waits on the other is never disjoint, whatever their files say', 'fixes/reading/a.md', 'fixes/reading/d.md', false],
  ['a pair both of which will create the same file that is not there yet is not disjoint', 'fixes/reading/e.md', 'fixes/reading/f.md', false],
  ['a pair where one names the folder the other\'s file sits in is not disjoint', 'fixes/reading/f.md', 'fixes/reading/e.md', false],
  ['a pair sharing nothing but a made-up module is disjoint', 'fixes/reading/c.md', 'fixes/reading/e.md', true],
  ['a pair where one names a file and the other names the folder that file was split into is not disjoint', 'fixes/reading/g.md', 'fixes/reading/h.md', false],
  ['and the same pair read the other way round', 'fixes/reading/h.md', 'fixes/reading/g.md', false],
  ['a file whose stem is not a folder anybody writes still collides with nothing', 'fixes/reading/g.md', 'fixes/reading/c.md', true],
];

// What the exclusion list actually promises, read on its own rather than through the six-row order above, so adding a case here perturbs no other one. A pair differing only in an excluded file is called safe on purpose; a pair differing only in a shared plan file that is **not** excluded has to be called colliding, which is the whole of what taking a file off that list buys.
const EXCLUSION_CASES = [
  ['the running order', 'docs/PLAN.md', true],
  ['the ticket index', 'docs/README.md', true],
  ['the planning glossary', 'docs/GLOSSARY.md', true],
  ['the subject order index', 'docs/TRACKS.md', false],
  ['one subject order', 'docs/tracks/performance.md', false],
  ['the whole folder of them', 'docs/tracks/', false],
  ['the guide', 'app/AGENTS.md', false],
];

/// Two made-up tickets writing a source file each and `path` between them, and whether the pairing then calls them safe together.
function safeSharing(path) {
  const section = (own) => `## What it writes\n\n| file | phase |\n|---|---|\n| \`${own}\` | 1 |\n| \`${path}\` | 1 |\n`;
  const left = claimedBy('fixes/reading/left.md', section('app/src/one.rs'));
  const right = claimedBy('fixes/reading/right.md', section('app/src/two.rs'));
  return overlap(left, right).length === 0;
}

function exclusionSelfTest() {
  const faults = [];
  for (const [name, path, safe] of EXCLUSION_CASES) {
    const got = safeSharing(path);
    if (got === safe) continue;
    faults.push(safe
      ? `a pair sharing nothing but ${name} is called colliding, and ${path} is on the exclusion list`
      : `a pair sharing nothing but ${name} is called safe together, and ${path} is not on the exclusion list — one of them would land on the other's edit`);
  }
  return faults;
}

function pairSelfTest() {
  const rows = planRows(PAIR_ORDER);
  const fails = [];
  if (rows.length !== 6) fails.push(`the made-up running order read as ${rows.length} rows, want 6`);
  for (const [name, left, right, want] of PAIR_CASES) {
    const got = overlap(PAIR_CLAIMS.get(left), PAIR_CLAIMS.get(right)).length === 0
      && !waitsOnEachOther(rows, left, right);
    if (got !== want) fails.push(`${name}: got ${got}, want ${want}`);
  }
  // The shared plan files are dropped before a pair is ever compared, which is what the case above rests on.
  const shared = claimedBy('fixes/reading/a.md', '## What it writes\n\n| file | phase |\n|---|---|\n| `docs/PLAN.md` | 1 |\n| `docs/GLOSSARY.md` | 1 |\n| `app/src/lib.rs` | 1 |\n');
  if (shared.join(',') !== 'app/src/lib.rs') fails.push(`the four shared plan files are not dropped: got [${shared.join(' | ')}]`);
  // A ticket never collides with itself.
  const own = claimedBy('fixes/reading/a.md', '## What it writes\n\n| file | phase |\n|---|---|\n| `docs/fixes/reading/a.md` | 1 |\n| `app/src/lib.rs` | 1 |\n');
  if (own.join(',') !== 'app/src/lib.rs') fails.push(`a ticket's own file is not dropped: got [${own.join(' | ')}]`);
  // The order is the running order's, not the tree's.
  const order = partnersFor(rows, PAIR_CLAIMS, 'fixes/reading/c.md');
  if (order.join(',') !== 'fixes/reading/a.md,fixes/reading/d.md,fixes/reading/e.md,fixes/reading/f.md') fails.push(`partners came back as [${order.join(' | ')}]`);
  return fails;
}

// The cell and the column it lands in, proved on the made-up order above before the real file is ever rewritten. A bundler that writes the wrong cell into 153 rows is caught by nobody until somebody reads one.
function cellSelfTest() {
  const fails = [];
  const say = (name, got, want) => {
    if (got !== want) fails.push(`${name}: got \`${got}\`, want \`${want}\``);
  };
  say('nothing disjoint reads as an em dash', cellFor([]), '—');
  say('one partner is one link and no count', cellFor(['refactor/a/one.md']), '[one](refactor/a/one.md)');
  say('three partners are three links and no count, because the links are all of them',
    cellFor(['refactor/a/one.md', 'refactor/a/two.md', 'refactor/a/three.md']),
    '[one](refactor/a/one.md), [two](refactor/a/two.md), [three](refactor/a/three.md)');
  say('four partners are the three highest-ranked and the total',
    cellFor(['refactor/a/one.md', 'refactor/a/two.md', 'refactor/a/three.md', 'refactor/a/four.md']),
    '[one](refactor/a/one.md), [two](refactor/a/two.md), [three](refactor/a/three.md) (4 in all)');
  for (const shape of ['—', '[one](refactor/a/one.md)', '[one](refactor/a/one.md), [two](refactor/a/two.md) (9 in all)']) {
    if (!CELL_SHAPE.test(shape)) fails.push(`the shape a bundler writes is refused by its own rule: \`${shape}\``);
  }
  for (const shape of ['', 'one', '[one](refactor/a/one.md), [two](b.md), [three](c.md), [four](d.md)', '[one](refactor/a/one.md) (lots in all)']) {
    if (CELL_SHAPE.test(shape)) fails.push(`a cell nothing here writes is allowed: \`${shape}\``);
  }

  const written = withColumn(PAIR_ORDER, planRows(PAIR_ORDER), PAIR_CLAIMS);
  const header = written.split(NL).find((line) => line.trim().startsWith('| #'));
  say('the column lands after Track and before Why',
    header.trim(), `| # | Ticket | Status | Blocks | Blocked by | Track | ${CELL_HEADING} | Why |`);
  const separator = written.split(NL).find((line) => /^\|\s*---/.test(line.trim()));
  say('the separator gains a column with the header', separator.trim(), '| --- | --- | --- | --- | --- | --- | --- | --- |');
  // Found by its Ticket cell, not by the name appearing anywhere in the line: every row now carries other rows' names in the new column.
  const rowOf = (name) => written.split(NL).find((line) => line.includes(`| [${name}](fixes/reading/${name}.md) |`));
  say('a row whose partners are all of them carries no count',
    rowOf('a').split('|')[7].trim(), '[c](fixes/reading/c.md), [e](fixes/reading/e.md), [f](fixes/reading/f.md)');
  say('a row with four partners carries the three highest-ranked and the total',
    rowOf('c').split('|')[7].trim(), '[a](fixes/reading/a.md), [d](fixes/reading/d.md), [e](fixes/reading/e.md) (4 in all)');
  // Writing over a file that already carries the column has to leave one of it, not two.
  const twice = withColumn(written, planRows(written), PAIR_CLAIMS);
  say('writing the column twice writes it once', twice, written);
  const rows = planRows(written);
  if (rows.length !== 6) fails.push(`the rewritten order read as ${rows.length} rows, want 6`);
  if (rows[0] && rows[0].why !== '…') fails.push(`Why is no longer the last cell: got \`${rows[0].why}\``);
  return fails;
}

export function selfTest() {
  return [...footprintSelfTest(), ...footprintPathSelfTest(), ...pairSelfTest(), ...exclusionSelfTest(), ...cellSelfTest()];
}

// Only when run as a command. Both plan checks import this module, and neither wants its report.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split('\\').join('/')}`).href) {
  const fails = selfTest();
  if (fails.length) {
    console.error('footprints: the reader or the pairing is wrong, so nothing was read:');
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }
  if (process.argv.includes('--write')) {
    const plans = planTree(here);
    const at = join(plans, 'PLAN.md');
    const before = readFileSync(at, 'utf8');
    const claims = claimsInTree(plans);
    const after = withColumn(before, planRows(before), claims);
    if (after === before) {
      console.log(`${CELL_HEADING}: already what the footprints say`);
      process.exit(0);
    }
    writeFileSync(at, after, 'utf8');
    const named = planRows(after).filter((row) => row.ticket && claims.has(row.ticket)).length;
    console.log(`${CELL_HEADING}: written into ${named} rows of the running order, off ${claims.size} footprints`);
    process.exit(0);
  }
  const asked = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (!asked.length) {
    console.log('footprints: the reader answers a section, a folder row and a ticket that writes nothing, refuses a path spelled from neither root and passes one the build will create, and the pairing holds a shared file, a shared guide, a wait, two builds creating one file, a folder holding the other\'s file and a pair sharing nothing, and every shared plan file is read for whether a pair whose one common file is that one is called safe');
    process.exit(0);
  }
  const plans = planTree(here);
  const claims = claimsInTree(plans);
  const rows = planRows(readFileSync(join(plans, 'PLAN.md'), 'utf8'));
  for (const arg of asked) {
    // Named however it is easiest to name: the path a row links, a path from the pair's top, or the file name on its own.
    const wanted = [...claims.keys()].find((key) => key === arg || `docs/${key}` === arg || key.endsWith(`/${arg}`) || key === arg.replace(/^docs\//, ''));
    if (!wanted) {
      console.error(`no live ticket named ${arg}`);
      process.exit(1);
    }
    const found = partnersFor(rows, claims, wanted);
    const at = (name) => rows.find((row) => row.ticket === name)?.position ?? '?';
    console.log(`${wanted} (row ${at(wanted)}) shares no file with ${found.length} of the ${claims.size} live tickets:`);
    for (const name of found) console.log(`  ${String(at(name)).padStart(4)}  ${name}`);
  }
}
