#!/usr/bin/env node
// A running-order row's stage is a claim about the ticket beside it, so the ticket is where it is written and this is what carries it across. A stage typed into the shared running order instead is the one thing a build does to a file every other build also writes: two sessions in one checkout, told by the order's own column that they share no file, both editing the same 150-row list.
//
//   node scripts/check-plan-stage.mjs           fail on a cell that is not what its ticket's dated lines say (`just verify`)
//   node scripts/check-plan-stage.mjs --check   self-test the reading, then check the real files
//   node scripts/check-plan-stage.mjs --write   write every live row's Status cell from its ticket
//
// Four stages, each resting on a dated line the ticket carries and one pass writes: `Designed` on /design's, `Dev` on the `Building since` line /dev writes when it opens a phase, `Released` on /git-release's, and `Ready` on a ticket with none of them, which claims nothing. Every one of those lines is in the ticket's own file, which has one writer, so a build writes its stage where it already writes its boxes.
//
// A cell is refused for disagreeing with the ticket rather than only for claiming too much: a row saying `Designed` over a build that started is as misleading as one saying `Dev` over a plan nobody read, and the owner reads this file to see whether a build is happening.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PLAN = join(root, '..', 'docs', 'PLAN.md');
const TREE = join(root, '..', 'docs');

// Every stage above Ready is a claim that the ticket has been designed.
const NEEDS_DESIGN = new Set(['Designed', 'Dev', 'Released']);

/** The dated `Designed` line /design writes, which is what every stage above Ready rests on. */
export function isDesigned(ticket) {
  return /\*\*Designed\s+\d/.test(ticket);
}

// The other proof a build has started, and one every ticket already carries. The dated line covers only the stretch before the first box goes in, which is the longest part of a build and the stretch a reader most needs an answer for.
const TICKED = /^[ \t]*- \[x\]/mi;

// The dated line the two stages above `Designed` rest on, richest first. `Designed` is not in here: it is the floor a designed ticket falls back to once neither of these nor a ticked box has answered.
const LINES = [
  ['Released', /\*\*Released\s+\d/],
  ['Dev', /\*\*Building since\s+\d/],
];

/** What a ticket's own dated lines say its stage is. `Ready` is the answer for a ticket carrying none of them, which is a plan nobody has opened yet.
 *
 * The dated lines are read out of the opening block alone — everything above the first `##` heading, which is where all three are written. Below it a ticket quotes other tickets' lines as evidence and its own record quotes its own, and a stage read out of a quotation is a stage nobody claimed. Only this reading is narrowed: the shared `isDesigned` two gates carry is [a-quoted-designed-line-passes-the-gate-that-guards-a-build](../../docs/refactor/workflow/a-quoted-designed-line-passes-the-gate-that-guards-a-build.md)'s to fix, and it is filed. */
export function stageOf(ticket) {
  const opening = ticket.split(/^##(?!#)/m)[0];
  for (const [stage, line] of LINES) if (line.test(opening)) return stage;
  if (!isDesigned(opening)) return 'Ready';
  return TICKED.test(ticket) ? 'Dev' : 'Designed';
}

/** The running order with every live row's Status cell written from its ticket. A row whose ticket cannot be opened keeps the cell it has: a link pointing at nothing is check-plan.mjs's to name, and blanking the cell would hide it. */
export function written(plan, read) {
  return plan
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\|\s*\d+\s*\|\s*\[[^\]]*\]\(([^)]+\.md)\)[^|]*\|)(\s*)([^|]+?)(\s*)\|/);
      if (!m) return line;
      let stage;
      try {
        stage = stageOf(read(m[2]));
      } catch {
        return line;
      }
      // The match ends on the cell's closing bar, so it is written back — dropping it merges Status into Blocks and shifts every later column of the row one to the left.
      return m[1] + m[3] + stage + m[5] + '|' + line.slice(m[0].length);
    })
    .join('\n');
}

/** Every live row as `{ position, path, stage }`. A row with no link or no stage cell is somebody else's check to refuse. */
export function rows(plan) {
  const found = [];
  for (const line of plan.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*\[[^\]]*\]\(([^)]+\.md)\)[^|]*\|\s*([^|]+?)\s*\|/);
    if (m) found.push({ position: Number(m[1]), path: m[2], stage: m[3] });
  }
  return found;
}

/** Faults in one plan, each naming the row a reader would believe. `read` opens a ticket by its plan-relative path. */
export function faults(plan, read) {
  const problems = [];
  for (const { position, path, stage } of rows(plan)) {
    let ticket = null;
    try {
      ticket = read(path);
    } catch {
      continue; // A row pointing at nothing is check-plan.mjs's to name, and naming it twice buries the one that matters.
    }
    if (NEEDS_DESIGN.has(stage) && !isDesigned(ticket)) {
      problems.push(`row ${position} says \`${stage}\` and ${path} carries no dated Designed line, so the running order claims a stage the ticket never reached — run /design over it, or put the row back to \`Ready\``);
      continue;
    }
    const said = stageOf(ticket);
    if (said !== stage) problems.push(`row ${position} says \`${stage}\` and ${path}'s own dated lines say \`${said}\` — the cell is written from the ticket, so a cell that disagrees is a hand edit or a line that moved under it. Run \`just bundle-plan-status\``);
  }
  return problems;
}

const HEAD = '| # | Ticket | Status | Blocks | Blocked by | Track | Devs with | Why here |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
const DESIGNED = '# A plan\n\n> **Designed 19 August 2026, 7:07pm.** Citations opened.\n';
const PLAIN = '# A plan\n\n> **Not built.** A plan.\n';
const BUILDING = `${DESIGNED}> **Building since 19 August 2026, 8:02pm.**\n`;
const TICKING = `${DESIGNED}\n## Phases\n\n- [x] the first box\n- [ ] the second\n`;
const SHIPPED = `${BUILDING}> **Released 19 August 2026, 9:40pm, v1.2.3.**\n`;
// A ticket quoting another's dated line below its first heading, which is what the record and the measured table are full of.
const QUOTING = `${PLAIN}\n## Why\n\nIt cites > **Designed 14 August 2026.** as evidence about a different plan.\n`;
const TICKETS = {
  'refactor/a/designed.md': DESIGNED,
  'refactor/a/building.md': BUILDING,
  'refactor/a/ticking.md': TICKING,
  'refactor/a/shipped.md': SHIPPED,
  'refactor/a/quoting.md': QUOTING,
};
const READ = (path) => TICKETS[path] ?? PLAIN;

const CASES = [
  ['a Ready row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Ready | — | — | — | — | first |`, false],
  ['a Designed row whose ticket carries the line', `${HEAD}| 1 | [d](refactor/a/designed.md) | Designed | — | — | — | — | first |`, false],
  ['a Dev row whose ticket is only designed', `${HEAD}| 1 | [d](refactor/a/designed.md) | Dev | — | — | — | — | first |`, true],
  ['a Released row whose ticket is only designed', `${HEAD}| 1 | [d](refactor/a/designed.md) | Released | — | — | — | — | first |`, true],
  ['a Designed row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Designed | — | — | — | — | first |`, true],
  ['a Dev row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Dev | — | — | — | — | first |`, true],
  ['a Released row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Released | — | — | — | — | first |`, true],
  ['a Dev row whose ticket is dated as building', `${HEAD}| 1 | [b](refactor/a/building.md) | Dev | — | — | — | — | first |`, false],
  ['a Dev row whose ticket has a box ticked', `${HEAD}| 1 | [t](refactor/a/ticking.md) | Dev | — | — | — | — | first |`, false],
  ['a Released row whose ticket carries the shipped line', `${HEAD}| 1 | [s](refactor/a/shipped.md) | Released | — | — | — | — | first |`, false],
  ['a Ready row whose ticket only quotes a dated line below its first heading', `${HEAD}| 1 | [q](refactor/a/quoting.md) | Ready | — | — | — | — | first |`, false],
  ['a Designed row whose ticket is dated as building', `${HEAD}| 1 | [b](refactor/a/building.md) | Designed | — | — | — | — | first |`, true],
  ['a Designed row whose ticket has a box ticked', `${HEAD}| 1 | [t](refactor/a/ticking.md) | Designed | — | — | — | — | first |`, true],
  ['a Dev row whose ticket has shipped', `${HEAD}| 1 | [s](refactor/a/shipped.md) | Dev | — | — | — | — | first |`, true],
  ['a Ready row whose ticket has been designed', `${HEAD}| 1 | [d](refactor/a/designed.md) | Ready | — | — | — | — | first |`, true],
];

// What `--write` has to get right, beyond the cell itself: every other column of the row survives it. The first run of it dropped the cell's closing bar and shifted all 150 rows one column left.
const WRITTEN = [
  ['a stale cell is written down to what the ticket says', `${HEAD}| 1 | [d](refactor/a/designed.md) | Dev | — | — | — | — | first |`, '| 1 | [d](refactor/a/designed.md) | Designed | — | — | — | — | first |'],
  ['a stale cell is written up to what the ticket says', `${HEAD}| 1 | [b](refactor/a/building.md) | Ready | — | — | — | — | first |`, '| 1 | [b](refactor/a/building.md) | Dev | — | — | — | — | first |'],
  ['a row whose ticket cannot be opened keeps its cell', `${HEAD}| 1 | [g](refactor/a/gone.md) | Dev | — | — | — | — | first |`, '| 1 | [g](refactor/a/gone.md) | Dev | — | — | — | — | first |'],
];

const openTicket = (path) => readFileSync(join(TREE, path), 'utf8');

if (process.argv.includes('--write')) {
  const before = readFileSync(PLAN, 'utf8');
  const after = written(before, openTicket);
  if (after !== before) writeFileSync(PLAN, after);
  const moved = rows(after).filter(({ position }, at) => rows(before)[at]?.stage !== rows(after)[at]?.stage).length;
  console.log(`plan status: ${rows(after).length} cells written from their tickets, ${moved} of them moved`);
  process.exit(0);
}

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, plan, shouldFail] of CASES) {
    const found = faults(plan, READ);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
  }
  const opener = (path) => {
    if (!(path in TICKETS) && path !== 'refactor/a/plain.md') throw new Error('no such ticket');
    return READ(path);
  };
  for (const [name, plan, want] of WRITTEN) {
    const got = written(plan, opener).split('\n').at(-1);
    if (got !== want) problems.push(`writing ${name} gave \`${got}\` and not \`${want}\``);
  }
  const twice = written(written(WRITTEN[0][1], opener), opener);
  if (twice !== written(WRITTEN[0][1], opener)) problems.push('writing the cells twice gave a different file the second time');
  if (!problems.length) console.log(`reading: ${CASES.length} made-up rows answered or refused, and ${WRITTEN.length} written back with every other column of the row intact`);
}

problems.push(...faults(readFileSync(PLAN, 'utf8'), openTicket));

if (problems.length) {
  console.error('the running order claims a stage a ticket never reached:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('plan stage: every live row carries the stage its ticket\'s own dated lines say, and every one above `Ready` has a ticket carrying a dated Designed line');
