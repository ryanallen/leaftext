#!/usr/bin/env node
// What a track's steps say they wait on. The running order was ordering 93 rows on cost alone because the one column that could have moved a row — `Blocked by` — was written by hand and empty in every row of the file, so the rule refusing a row placed above what it waits on had nothing to walk and the Progress trunk sat twelve rows below its own dependents.
//
//   node scripts/plan-waits.mjs --check   the reader, the resolver and both cells, on made-up tracks
//   node scripts/plan-waits.mjs --write   `Blocked by`, `Blocks` and `Track`, into every row of it
//
// A wait is declared in one place: the `Waits on` cell of a step's own row under `docs/tracks/`, written by whoever wrote the order. A cell names step numbers of its own track, links to live tickets on another track, or `—`.
//
// **`—` is the honest answer and the commonest one.** 69 of 100 live step rows say nothing in their prose about what they wait on, and `—` is exactly what all 93 rows of the running order said before this column existed — so a silent step leaves its row ranked on cost the way it always was, and the column is filled honestly rather than completely.
//
// **A wait crossing a track is ordinary.** `docs/tracks/container-documents.md` already says slide-editor's step 12 waits on api-documents, which is a step of Remote storage, so a cell may link a ticket instead of naming a number.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planTree } from './plan-tree.mjs';
import { links, planRows } from './plan-rows.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The header this column is written under, and the two cells it sits after.
export const WAITS_HEADING = 'Waits on';

// A subject's own file opens with the subject, so its track is read at either heading level — the file's title is the track.
const PART_HEADING = /^#{1,2}(?!#)\s+(.+?)\s*$/;

// A heading's own anchor, the way every Markdown renderer in this tree spells one: lowercased, punctuation dropped, spaces hyphenated.
export function anchor(heading) {
  return heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

// A row writes `\|` in its own prose, so splitting on every pipe reads three cells as five.
const BACKSLASH = String.fromCharCode(92);
function rowCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cell = '';
  for (let at = 0; at < trimmed.length; at += 1) {
    if (trimmed[at] === BACKSLASH) {
      cell += trimmed[at] + (trimmed[at + 1] ?? '');
      at += 1;
      continue;
    }
    if (trimmed[at] === '|') {
      out.push(cell.trim());
      cell = '';
      continue;
    }
    cell += trimmed[at];
  }
  out.push(cell.trim());
  return out;
}

// A step number is a number, sometimes with a letter after it: `docs/tracks/tables.md` numbers four of its reading steps `4`, `4a`, `4c` and `4d`, and the letter is what tells them apart.
const STEP = /^\d+[a-z]?$/;

const EMPTY = /^[—–-]$/;

/// Every track file read into `{ anchor, steps }`, where a step is `{ step, ticket, waits, line, cell }` — `waits` is null where the file carries no such column, so a track written without one is outside the rule rather than failing every row of it.
//
// A part file sits one folder below the running order, so its rows name a ticket a folder further out. The path is kept the way a running-order row links it, which is the key every rule here compares against.
export function trackTables(files) {
  const tables = [];
  for (const [name, text] of files) {
    let title = null;
    let column = null;
    const steps = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const heading = PART_HEADING.exec(line);
      if (heading) {
        if (title === null) title = heading[1];
        continue;
      }
      if (!line.startsWith('|')) continue;
      const cells = rowCells(line);
      if (cells[0] === 'step') {
        const at = cells.indexOf(WAITS_HEADING);
        column = at === -1 ? null : at;
        continue;
      }
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      if (!STEP.test(cells[0])) continue;
      steps.push({
        step: cells[0],
        ticket: (links(cells[1] ?? '')[0] ?? '').replace(/^\.\.\//, '') || null,
        waits: column === null ? null : (cells[column] ?? '—'),
        cell: cells[column ?? 1] ?? '',
        line: i + 1,
      });
    }
    tables.push({ file: name, title, anchor: title === null ? null : anchor(title), steps });
  }
  return tables;
}

/// What one `Waits on` cell names, split into the step numbers of its own track and the tickets it links. `—` gives neither.
export function readWaits(cell) {
  if (cell === null || EMPTY.test(cell.trim()) || cell.trim() === '') return { steps: [], tickets: [], unread: [] };
  const steps = [];
  const tickets = [];
  const unread = [];
  for (const raw of cell.split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const linked = links(part);
    if (linked.length) {
      for (const path of linked) tickets.push(path.replace(/^\.\.\//, ''));
      continue;
    }
    if (STEP.test(part)) {
      steps.push(part);
      continue;
    }
    unread.push(part);
  }
  return { steps, tickets, unread };
}

// Every refusal a cell can earn, read off the tables alone. Whether a row is ranked well is the ranker's; whether a declared wait is *true* is the track author's. What is held here is that a cell can be resolved at all.
/// `live` is the set of live ticket paths, or null where the caller has none to give — the self-test reads the shape of a cell without a tree of tickets behind it.
export function waitsProblems(tables, live = null) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'waits', subject, message });
  const everyStep = new Set();
  for (const table of tables) {
    for (const step of table.steps) if (step.ticket) everyStep.add(step.ticket);
  }
  for (const table of tables) {
    const own = new Set(table.steps.map((s) => s.step));
    for (const step of table.steps) {
      if (step.waits === null) continue;
      const { steps, tickets, unread } = readWaits(step.waits);
      for (const word of unread) {
        say(table.file, `${table.file} line ${step.line}: step ${step.step} says it waits on "${word}", and a cell names a step number of its own track, a link to a ticket on another track, or —`);
      }
      for (const named of steps) {
        if (named === step.step) {
          say(table.file, `${table.file} line ${step.line}: step ${step.step} waits on itself, so nothing can ever be built before it`);
          continue;
        }
        if (!own.has(named)) {
          say(table.file, `${table.file} line ${step.line}: step ${step.step} waits on step ${named}, and this track has no such step — a wait on another track's work is written as a link to the ticket`);
        }
      }
      for (const named of tickets) {
        if (named === step.ticket) {
          say(table.file, `${table.file} line ${step.line}: step ${step.step} links its own ticket as what it waits on, so nothing can ever be built before it`);
          continue;
        }
        if (live !== null && !live.has(named) && !everyStep.has(named)) {
          say(table.file, `${table.file} line ${step.line}: step ${step.step} waits on ${named}, and no track holds it as a step`);
        }
      }
    }
  }
  return problems;
}

// A ticket is one row of the running order however many steps of a track it holds — five live tickets hold two or three each, and `ebook-documents` is container-documents 3, 4 and 5 — so its wait is the union of its steps' cells with its own steps taken back out. Picking one of its steps instead would answer honestly for that step and wrongly for the row.
/// `{ ticket => Set(ticket it waits on) }`, resolved off the tracks. A wait naming a step resolves to the ticket at that step of that same track; a wait linking a ticket is that ticket.
export function waitsByTicket(tables) {
  const mine = new Map();
  for (const table of tables) {
    const at = new Map(table.steps.map((s) => [s.step, s.ticket]));
    for (const step of table.steps) {
      if (!step.ticket) continue;
      if (!mine.has(step.ticket)) mine.set(step.ticket, new Set());
      const { steps, tickets } = readWaits(step.waits);
      for (const named of steps) {
        const found = at.get(named);
        if (found) mine.get(step.ticket).add(found);
      }
      for (const named of tickets) mine.get(step.ticket).add(named);
    }
  }
  // A ticket holding two steps of one track declares each against the other; that is the row waiting on itself.
  for (const [ticket, set] of mine) set.delete(ticket);
  return mine;
}

// A shipped or held blocker reads as a wait that is over, so both columns hold live tickets only — which is what makes a track keep its own history in the same table the ranking reads.
/// `{ ticket => [blocker, …] }` in running-order position, for the live rows only.
export function blockersFor(rows, tables) {
  const declared = waitsByTicket(tables);
  const at = new Map(rows.filter((r) => r.ticket).map((r) => [r.ticket, r.position ?? Infinity]));
  const out = new Map();
  for (const row of rows) {
    if (!row.ticket) continue;
    const found = [...(declared.get(row.ticket) ?? new Set())]
      .filter((name) => at.has(name))
      .sort((a, b) => at.get(a) - at.get(b));
    out.set(row.ticket, found);
  }
  return out;
}

/// `{ ticket => [dependent, …] }` in running-order position — `Blocked by` read the other way.
export function dependentsFor(rows, tables) {
  const blockers = blockersFor(rows, tables);
  const at = new Map(rows.filter((r) => r.ticket).map((r) => [r.ticket, r.position ?? Infinity]));
  const out = new Map([...blockers.keys()].map((ticket) => [ticket, []]));
  for (const [ticket, found] of blockers) {
    for (const blocker of found) {
      if (!out.has(blocker)) out.set(blocker, []);
      out.get(blocker).push(ticket);
    }
  }
  for (const list of out.values()) list.sort((a, b) => at.get(a) - at.get(b));
  return out;
}

/// A cell of links, `—` where there are none. `bound` stops the naming and gives a total instead, the way `Devs with` does; left out, every one is named.
export function cellOf(tickets, bound = Infinity) {
  if (!tickets.length) return '—';
  const link = (path) => `[${path.split('/').pop().replace(/\.md$/, '')}](${path})`;
  const named = tickets.slice(0, bound).map(link).join(', ');
  return tickets.length > bound ? `${named} (${tickets.length} in all)` : named;
}

/// How many dependents a `Blocks` cell names before it stops and gives a total. Three, the same bound `Devs with` took over this same table: under a declared wait the Progress trunk blocks eighteen tickets, and eighteen links in a cell held to one sentence is not a cell anybody reads.
export const BLOCKS_BOUND = 3;

// The running order is an LF file (`.gitattributes`), and this writes it back line by line. Written straight over the table's own pipes rather than through a row reader, because both cells have to land in a fixed place in a line whose every other cell is left byte for byte as it was.
const NL = '\n';

/// The running order with both columns written into every live row, off the declared waits.
export function withWaits(planText, rows, tables) {
  const blockers = blockersFor(rows, tables);
  const dependents = dependentsFor(rows, tables);
  const answered = new Map();
  for (const [ticket, found] of blockers) {
    answered.set(ticket, [cellOf(dependents.get(ticket) ?? [], BLOCKS_BOUND), cellOf(found)]);
  }
  const out = [];
  let spots = null;
  for (const line of planText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      out.push(line);
      spots = null;
      continue;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] === '#') {
      const blocks = cells.indexOf('Blocks');
      const blockedBy = cells.indexOf('Blocked by');
      spots = blocks === -1 || blockedBy === -1 ? null : [blocks, blockedBy];
      out.push(line);
      continue;
    }
    if (spots === null) {
      out.push(line);
      continue;
    }
    // A struck row is retired and names no live work, so it keeps whatever it was written with.
    const ticket = links(cells[1] ?? '')[0] ?? null;
    if (!ticket || !answered.has(ticket)) {
      out.push(line);
      continue;
    }
    const [blocks, blockedBy] = answered.get(ticket);
    cells[spots[0]] = blocks;
    cells[spots[1]] = blockedBy;
    out.push(`| ${cells.join(' | ')} |`);
  }
  return out.join(NL);
}

// Every refusal is proved on made-up track files before the real folder is opened. Each case is a fault a hand-written cell can carry.
const HEAD = '| step | Work | Waits on |\n|---|---|---|\n';
const track = (title, ...rows) => `# ${title}\n\nWhat this subject is.\n\n${HEAD}${rows.map((r) => `${r}\n`).join('')}`;

const WITH_COLUMN = track('A subject',
  '| 1 | [one](../refactor/a/one.md) — the trunk | — |',
  '| 2 | [two](../refactor/a/two.md) — on the trunk | 1 |',
  '| 4c | [suffix](../refactor/a/suffix.md) — a lettered step | 2 |');
const WITHOUT_COLUMN = '# A bare subject\n\nWhat this subject is.\n\n| step | Work |\n|---|---|\n| 1 | [one](../refactor/a/one.md) |\n';
const MISSING_STEP = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | 9 |');
const CROSS_TRACK = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | [other](../refactor/b/other.md) |');
const OTHER_TRACK = track('Another subject', '| 1 | [other](../refactor/b/other.md) | — |');
const OWN_STEP = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | 2 |');
const OWN_TICKET = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | [two](../refactor/a/two.md) |');
const IN_WORDS = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | the trunk above |');
const GONE_TICKET = track('A subject',
  '| 1 | [one](../refactor/a/one.md) | — |',
  '| 2 | [two](../refactor/a/two.md) | [gone](../refactor/b/gone.md) |');

const WAITS_LIVE = new Set(['refactor/a/one.md', 'refactor/a/two.md', 'refactor/a/suffix.md', 'refactor/b/other.md']);

const WAITS_CASES = [
  ['a step table carrying the column passes, lettered steps and all', [WITH_COLUMN], []],
  ['a step table written without the column is outside the rule rather than failing every row of it', [WITHOUT_COLUMN], []],
  ['a cell naming a step its own track does not have is refused, and the step is named',
    [MISSING_STEP], ['waits a-subject.md'], 'this track has no such step'],
  ['a cell naming a ticket on another track passes, because a wait crossing a track is ordinary',
    [CROSS_TRACK, OTHER_TRACK], []],
  ['a cell naming its own step is refused, because nothing can ever be built before it',
    [OWN_STEP], ['waits a-subject.md'], 'waits on itself'],
  ['a cell linking its own ticket is refused the same way', [OWN_TICKET], ['waits a-subject.md'], 'links its own ticket'],
  ['a cell written in words is refused, because nothing can resolve one', [IN_WORDS], ['waits a-subject.md'], 'and a cell names a step number'],
  ['a cell linking a ticket no track holds as a step is refused', [GONE_TICKET], ['waits a-subject.md'], 'no track holds it as a step'],
];

/// What the reader found, so a case can assert the shape without asserting a refusal.
const READER_CASES = [
  ['an em dash reads as no wait at all', '—', { steps: [], tickets: [] }],
  ['a bare number is a step of its own track', '1', { steps: ['1'], tickets: [] }],
  ['a lettered number is one step, not two', '4c', { steps: ['4c'], tickets: [] }],
  ['a comma-separated list is every one of them', '3, 4, 5', { steps: ['3', '4', '5'], tickets: [] }],
  ['a link is a ticket rather than a step', '[api](../features/storage/api-documents.md)', { steps: [], tickets: ['features/storage/api-documents.md'] }],
  ['a number and a link in one cell are both read', '2, [api](../features/storage/api.md)', { steps: ['2'], tickets: ['features/storage/api.md'] }],
];

// The `Track` cell is the same authored-cell fault one level down: its step number was written by hand and copied forward, and four of the 93 named a step their track no longer gave — one of them a track the ticket is not a step of at all, which a reader cannot see because the link opens a real table.
//
// **A step is sorted on its number first and its letter second**, because `docs/tracks/tables.md` numbers four of its reading steps `4`, `4a`, `4c` and `4d` and plain string order puts `10` before `4`.
function stepOrder(step) {
  const found = /^(\d+)([a-z]?)$/.exec(step);
  return found ? [Number(found[1]), found[2]] : [Infinity, step];
}

/// The track a ticket is a step of, and the earliest step it holds there — `null` where no track holds it. Where the row already names a track that holds it, that one is kept: a ticket the tree has put on two tracks is `/pm`'s to settle, not this writer's.
export function trackHolding(tables, ticket, said = null) {
  const holding = tables.filter((table) => table.steps.some((step) => step.ticket === ticket));
  if (!holding.length) return null;
  const table = holding.find((t) => t.anchor === said) ?? holding[0];
  const steps = table.steps
    .filter((step) => step.ticket === ticket)
    .map((step) => step.step)
    .sort((a, b) => {
      const [an, al] = stepOrder(a);
      const [bn, bl] = stepOrder(b);
      return an - bn || al.localeCompare(bl);
    });
  return { anchor: table.anchor, title: table.title, step: steps[0] ?? null };
}

/// What one row's `Track` cell says, written from the tracks themselves.
export function trackCell(found) {
  return `[${found.title}](tracks/${found.anchor}.md) step ${found.step}`;
}

// Written straight over the table's own pipes, the way both blocker columns are, so every other cell of the line is left byte for byte as it was.
/// The running order with every live row's `Track` cell written from the track that holds it.
export function withTrack(planText, tables, live) {
  const out = [];
  let spot = null;
  for (const line of planText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      out.push(line);
      spot = null;
      continue;
    }
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] === '#') {
      const at = cells.indexOf('Track');
      spot = at === -1 ? null : at;
      out.push(line);
      continue;
    }
    const ticket = links(cells[1] ?? '')[0] ?? null;
    if (spot === null || !ticket || !live.has(ticket)) {
      out.push(line);
      continue;
    }
    const said = /tracks\/([a-z0-9-]+)\.md/.exec(cells[spot] ?? '');
    const found = trackHolding(tables, ticket, said ? said[1] : null);
    if (found === null || found.step === null) {
      out.push(line);
      continue;
    }
    cells[spot] = trackCell(found);
    out.push(`| ${cells.join(' | ')} |`);
  }
  return out.join(NL);
}

// Both columns are generated, so what is refused is a cell that is not what the writer would have written — a hand edit, or a track whose order moved under it.
/// Every row of the running order whose two cells disagree with the declared waits.
export function columnProblems(planText, rows, tables) {
  const problems = [];
  const say = (subject, message) => problems.push({ rule: 'waits-column', subject, message });
  const written = withWaits(planText, rows, tables);
  if (written === planText) return problems;
  const before = planText.split(/\r?\n/);
  const after = written.split(/\r?\n/);
  for (let i = 0; i < after.length; i += 1) {
    if (before[i] === after[i]) continue;
    const ticket = links(before[i] ?? '')[0] ?? `line ${i + 1}`;
    say(ticket, `line ${i + 1}: the row for ${ticket} says "${(before[i] ?? '').trim()}" and the declared waits give "${after[i].trim()}" — both columns are computed off the \`${WAITS_HEADING}\` cells under docs/tracks/, so a cell that disagrees is a hand edit or a track that moved under it. Run \`just bundle-waits\``);
  }
  return problems;
}

// A made-up running order and a made-up folder of tracks, so both columns are proved before the real file is ever rewritten. Six rows, each one a case the writer has to get right.
const WAITS_ORDER = `# Leaftext Plan Log

## Tier 1 — wrong today

| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [trunk](features/a/trunk.md) | Ready | — | — | t | — | … |
| 2 | [leaf](features/a/leaf.md) | Ready | — | — | t | — | … |
| 3 | [twig](features/a/twig.md) | Ready | — | — | t | — | … |
| 4 | [bud](features/a/bud.md) | Ready | — | — | t | — | … |
| 5 | [both](features/b/both.md) | Ready | — | — | t | — | … |
| 6 | [far](features/c/far.md) | Ready | — | — | t | — | … |
`;

// One track whose trunk everything waits on, one whose steps are all preference, and one holding a ticket across two steps with a wait out to another track.
const WAITS_TRACKS = [
  ['a-family.md', track('A family',
    '| 1 | [trunk](../features/a/trunk.md) | — |',
    '| 2 | [leaf](../features/a/leaf.md) | 1 |',
    '| 3 | [twig](../features/a/twig.md) | 1 |',
    '| 4 | [bud](../features/a/bud.md) | 1, [gone](../done/a/gone.md) |',
    '| 5 | [shipped](../done/a/shipped.md) | 1 |')],
  ['a-preference.md', track('A preference',
    '| 1 | [far](../features/c/far.md) | — |')],
  ['a-pair.md', track('A pair',
    '| 1 | [both](../features/b/both.md) | [trunk](../features/a/trunk.md) |',
    '| 2 | [both](../features/b/both.md) | 1 |',
    '| 3 | [gone](../done/a/gone.md) | 2 |')],
];

export function selfTest() {
  const fails = [];
  for (const [name, cell, want] of READER_CASES) {
    const got = readWaits(cell);
    if (got.steps.join(',') !== want.steps.join(',') || got.tickets.join(',') !== want.tickets.join(',')) {
      fails.push(`${name}: got steps [${got.steps}] tickets [${got.tickets}], want steps [${want.steps}] tickets [${want.tickets}]`);
    }
  }
  for (const [name, texts, want, said] of WAITS_CASES) {
    const tables = trackTables(texts.map((text) => [`${anchor(PART_HEADING.exec(text.split('\n')[0])[1])}.md`, text]));
    const found = waitsProblems(tables, WAITS_LIVE);
    const got = found.map((p) => `${p.rule} ${p.subject}`).sort();
    if (got.join(', ') !== [...want].sort().join(', ')) fails.push(`${name}: got [${got}], want [${want}]`);
    if (said && !found.some((p) => p.message.includes(said))) fails.push(`${name}: no message said \`${said}\``);
  }
  // The reader is the one thing every rule above rests on, so it is proved against a table written the way the real folder writes one.
  const [table] = trackTables([['a-subject.md', WITH_COLUMN]]);
  if (table.anchor !== 'a-subject') fails.push(`the track's anchor read as \`${table.anchor}\`, want \`a-subject\``);
  if (table.steps.length !== 3) fails.push(`the table read as ${table.steps.length} steps, want 3`);
  if (table.steps[2]?.step !== '4c') fails.push(`the lettered step read as \`${table.steps[2]?.step}\`, want \`4c\``);
  if (table.steps[1]?.ticket !== 'refactor/a/two.md') fails.push(`the ticket read as \`${table.steps[1]?.ticket}\``);
  const [bare] = trackTables([['a-bare-subject.md', WITHOUT_COLUMN]]);
  if (bare.steps[0]?.waits !== null) fails.push('a table with no Waits on column answered a cell rather than nothing');
  fails.push(...columnSelfTest());
  return fails;
}

// Both columns, written into the made-up order above. A writer that puts the wrong cell into 93 rows is caught by nobody until somebody reads one.
function columnSelfTest() {
  const fails = [];
  const say = (name, got, want) => {
    if (got !== want) fails.push(`${name}: got \`${got}\`, want \`${want}\``);
  };
  const tables = trackTables(WAITS_TRACKS);
  const rows = planRows(WAITS_ORDER);
  if (rows.length !== 6) fails.push(`the made-up running order read as ${rows.length} rows, want 6`);
  const blockers = blockersFor(rows, tables);
  const dependents = dependentsFor(rows, tables);
  say('a declared wait becomes a cell', cellOf(blockers.get('features/a/leaf.md')), '[trunk](features/a/trunk.md)');
  say('a wait on a ticket that has shipped is dropped, and the live one beside it kept',
    cellOf(blockers.get('features/a/bud.md')), '[trunk](features/a/trunk.md)');
  say('a track whose every step writes an em dash produces no cell at all', cellOf(blockers.get('features/c/far.md')), '—');
  say('a ticket holding two steps takes the union of them, with its own steps out',
    cellOf(blockers.get('features/b/both.md')), '[trunk](features/a/trunk.md)');
  say('more dependents than the bound are the highest-ranked and the total',
    cellOf(dependents.get('features/a/trunk.md'), BLOCKS_BOUND),
    '[leaf](features/a/leaf.md), [twig](features/a/twig.md), [bud](features/a/bud.md) (4 in all)');
  say('a row nothing waits on says so', cellOf(dependents.get('features/c/far.md'), BLOCKS_BOUND), '—');

  const written = withWaits(WAITS_ORDER, rows, tables);
  // Found by its Ticket cell, not by the name appearing anywhere in the line: every row now carries other rows' names in the two new cells.
  const rowOf = (name) => written.split(NL).find((line) => /^\|\s*\d+\s*\|\s*\[([^\]]+)\]/.exec(line)?.[1] === name);
  say('the two cells land in the Blocks and Blocked by places and nothing else moves',
    rowOf('leaf').trim(),
    '| 2 | [leaf](features/a/leaf.md) | Ready | — | [trunk](features/a/trunk.md) | t | — | … |');
  say('writing the columns twice writes them once', withWaits(written, planRows(written), tables), written);
  const after = planRows(written);
  if (after.length !== 6) fails.push(`the rewritten order read as ${after.length} rows, want 6`);
  if (after[0] && after[0].why !== '…') fails.push(`Why is no longer the last cell: got \`${after[0].why}\``);

  // A cell the writer would not have written, which is the whole of what `--check` refuses.
  const clean = columnProblems(written, planRows(written), tables);
  if (clean.length) fails.push(`the column the tracks give is refused by its own rule: ${clean.map((p) => p.message).join('; ')}`);
  const edited = written.replace('| [trunk](features/a/trunk.md) | t | — | … |', '| — | t | — | … |');
  const found = columnProblems(edited, planRows(edited), tables);
  if (!found.length) fails.push('a hand-edited Blocked by cell is allowed');
  else if (!found.some((p) => p.message.includes('a hand edit or a track that moved under it'))) {
    fails.push(`the refusal did not say what to run: ${found[0].message}`);
  }

  // The `Track` cell's own step number, which is the same authored-cell fault one level down.
  const lettered = trackTables([['a-lettered-subject.md', track('A lettered subject',
    '| 4 | [wide](../features/a/wide.md) | — |',
    '| 4c | [cards](../features/a/cards.md) | 4 |',
    '| 10 | [late](../features/a/late.md) | 4c |',
    '| 4a | [early](../features/a/late.md) | 4 |')]]);
  const cell = (ticket, said) => {
    const held = trackHolding(lettered, ticket, said);
    return held === null ? null : trackCell(held);
  };
  say('a step carrying a letter suffix keeps the letter whole',
    cell('features/a/cards.md'), '[A lettered subject](tracks/a-lettered-subject.md) step 4c');
  say('a ticket holding two steps is named by the earliest, on the number before the letter',
    cell('features/a/late.md'), '[A lettered subject](tracks/a-lettered-subject.md) step 4a');
  if (cell('features/a/nowhere.md') !== null) fails.push('a ticket no track holds was given a Track cell anyway');
  const order = withTrack(WAITS_ORDER, tables, new Set(['features/a/trunk.md']));
  const trunkRow = order.split(NL).find((line) => /^\|\s*1\s*\|/.test(line));
  say('the cell is written from the track that holds the row, and nothing else on the line moves',
    trunkRow.trim(),
    '| 1 | [trunk](features/a/trunk.md) | Ready | — | — | [A family](tracks/a-family.md) step 1 | — | … |');
  return fails;
}

/// Every track file under `docs/tracks/`, as the pairs `trackTables` takes.
export function trackFiles(plans) {
  const folder = join(plans, 'tracks');
  return readdirSync(folder)
    .filter((name) => name.endsWith('.md'))
    .map((name) => [name, readFileSync(join(folder, name), 'utf8')]);
}

// Only when run as a command. `check-plan.mjs` imports this module and does not want its report.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split(BACKSLASH).join('/')}`).href) {
  const fails = selfTest();
  if (fails.length) {
    console.error('waits: the reader, the resolver or the writer is wrong, so no track was read:');
    for (const line of fails) console.error(`  ${line}`);
    process.exit(1);
  }
  if (process.argv.includes('--write')) {
    const plans = planTree(here);
    const at = join(plans, 'PLAN.md');
    const before = readFileSync(at, 'utf8');
    const tables = trackTables(trackFiles(plans));
    const live = new Set(planRows(before).map((row) => row.ticket).filter(Boolean));
    const after = withTrack(withWaits(before, planRows(before), tables), tables, live);
    if (after === before) {
      console.log('Blocked by, Blocks and Track: already what the tracks say');
      process.exit(0);
    }
    writeFileSync(at, after, 'utf8');
    const blockers = blockersFor(planRows(after), tables);
    const waiting = [...blockers.values()].filter((found) => found.length).length;
    console.log(`Blocked by, Blocks and Track: written into ${blockers.size} rows of the running order, ${waiting} of them waiting on something`);
    process.exit(0);
  }
  console.log(`waits: the reader answers an em dash, a bare step, a lettered step, a list and a link; the rule refuses a step its own track does not have, a step waiting on itself, a cell written in words and a link no track holds; the writer drops a shipped blocker, unions a ticket's two steps, bounds Blocks at ${BLOCKS_BOUND} with the total and refuses a cell it would not have written; and the Track cell is written from the track holding the row, at the earliest step it holds there, letter suffix and all — while a table with no ${WAITS_HEADING} column stays outside all of it`);
}
