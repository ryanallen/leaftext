#!/usr/bin/env node
// A running-order row's stage is a claim about the ticket beside it, and nothing read the two together — so a row said `Designed` or `Dev` for a plan nobody had designed, and the owner read a build happening that had never been read against the code.
//
//   node scripts/check-plan-stage.mjs           fail on a live row claiming a stage its ticket never reached
//   node scripts/check-plan-stage.mjs --check   self-test the comparison, then check the real files
//
// `Designed`, `Dev` and `Released` all rest on the same fact: the ticket carries a dated `Designed` line, which is the only thing /design writes and the only proof the plan was opened against the code. `Ready` claims nothing, so it is never refused.

import { readFileSync } from 'node:fs';
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
    if (!NEEDS_DESIGN.has(stage)) continue;
    let ticket = null;
    try {
      ticket = read(path);
    } catch {
      continue; // A row pointing at nothing is check-plan.mjs's to name, and naming it twice buries the one that matters.
    }
    if (!isDesigned(ticket)) problems.push(`row ${position} says \`${stage}\` and ${path} carries no dated Designed line, so the running order claims a stage the ticket never reached — run /design over it, or put the row back to \`Ready\``);
  }
  return problems;
}

const HEAD = '| # | Ticket | Status | Blocks | Blocked by | Track | Why here |\n| --- | --- | --- | --- | --- | --- | --- |\n';
const DESIGNED = '# A plan\n\n> **Designed 19 August 2026, 7:07pm.** Citations opened.\n';
const PLAIN = '# A plan\n\n> **Not built.** A plan.\n';
const READ = (path) => (path === 'refactor/a/designed.md' ? DESIGNED : PLAIN);

const CASES = [
  ['a Ready row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Ready | — | — | — | first |`, false],
  ['a Designed row whose ticket carries the line', `${HEAD}| 1 | [d](refactor/a/designed.md) | Designed | — | — | — | first |`, false],
  ['a Dev row whose ticket carries the line', `${HEAD}| 1 | [d](refactor/a/designed.md) | Dev | — | — | — | first |`, false],
  ['a Released row whose ticket carries the line', `${HEAD}| 1 | [d](refactor/a/designed.md) | Released | — | — | — | first |`, false],
  ['a Designed row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Designed | — | — | — | first |`, true],
  ['a Dev row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Dev | — | — | — | first |`, true],
  ['a Released row whose ticket was never designed', `${HEAD}| 1 | [p](refactor/a/plain.md) | Released | — | — | — | first |`, true],
];

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, plan, shouldFail] of CASES) {
    const found = faults(plan, READ);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
  }
}

problems.push(...faults(readFileSync(PLAN, 'utf8'), (path) => readFileSync(join(TREE, path), 'utf8')));

if (problems.length) {
  console.error('the running order claims a stage a ticket never reached:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('plan stage: every live row above `Ready` has a ticket carrying a dated Designed line');
