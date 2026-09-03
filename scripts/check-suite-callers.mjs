#!/usr/bin/env node
// The complete suite is the owner's to start, and this refuses every pass that would start one behind them.
//
//   node scripts/check-suite-callers.mjs           the real skills (`just verify`)
//   node scripts/check-suite-callers.mjs --check   the same, after the self-test on made-up skills
//
// Without it the calls come back one at a time, in whichever pass feels unproven that week, and nobody notices until the whole cost is back: a two-phase ticket once paid for a 54-second suite eight times — after each phase, at the end of the build, twice inside the release, once inside the release command itself, and twice more while the ticket was retired.
//
// The build is refused along with the rest. The suite is the whole checkout rather than one ticket, so two builds beside each other pay twice for one answer — and a suite red on a file the build never opened leaves that pass waiting on another session with nothing of its own left to do. One search ticket finished its phase and then sat twenty minutes on a generated file another build was still moving, while the owner watched a build that was already done.
//
// What every other pass runs instead is the narrow check about what it wrote: the format tests, the design checks, the front-end boot, the document checks, the Rust documentation build. Those are seconds and they prove the thing that moved. The suite recompiles the app and reruns the tests, and after a build nothing between it and the tag edits a line of either.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

// The two skills the complete gate belongs to. `check` is the gate written down, so every sentence in it is about running the suite; `test` is the pass the owner says out loud, which reads the running order for the tickets a build has actually landed and points the gate at that batch. Every other skill, the build included, may name the suite and may not run it.
export const GATE_OWNERS = new Set(['check', 'test']);

// A directive is one sentence telling a reader to run the complete gate. Read as a sentence rather than a line, because a paragraph is one line in this tree and a line-wide match would read a whole argument as a call.
//
// Three things are deliberately not calls. A sentence saying the gate *fails* on something is describing a consequence — `just check-docs` is in `just verify`, so one written and left fails the build. A sentence refusing the gate is the rule this check enforces, written down where its reader needs it. And a narrow recipe is not the suite, however many of them a line names.
//
// `run` counts as the instruction rather than as the noun: it opens the sentence, or follows one of the words an instruction is joined on with. `the next run`, `its own run` and `the suite runs` are all descriptions of when something happens, and every one of those appears in the tree explaining where a narrow check lives.
const RUNS = /(?:^\W*|\b(?:then|and|to|also|must|should|will|can|please|so|first|finally|before|after|now)\s+)run\b/i;
const THE_GATE = /(?:^|[^-\w])(?:\$|\/)check\b|`just verify`/;
const REFUSED = /\b(?:never|not|rather than|instead of|forbid|no longer|stop|stops|without|nothing|none|no)\b/i;

/// Every sentence of a skill that directs its reader to run the complete gate, with the line it sits on.
export function gateDirectives(text) {
  const found = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const sentence of lines[i].split(/(?<=[.!?])\s+/)) {
      if (!THE_GATE.test(sentence)) continue;
      if (!RUNS.test(sentence)) continue;
      if (REFUSED.test(sentence)) continue;
      found.push({ line: i + 1, sentence: sentence.trim() });
    }
  }
  return found;
}

/// Every skill that runs the complete gate when it should not.
export function ownershipFaults(skills) {
  const faults = [];
  for (const [name, text] of skills) {
    if (GATE_OWNERS.has(name)) continue;
    for (const { line, sentence } of gateDirectives(text)) {
      faults.push(`${name} runs the complete suite at line ${line}: ${sentence}`);
    }
  }
  return faults;
}

/// The gate with nobody left to run it is the other way this rots: the owner's own pass has to still call it, or a ticket ships proved by nothing.
export function someoneOwnsTheGate(skills) {
  const owner = skills.find(([name]) => name === 'test');
  if (!owner) return 'there is no /test skill for the owner to run the suite from';
  if (!gateDirectives(owner[1]).length) return 'the /test skill no longer runs the complete suite at all, so nothing the owner asks for proves a ticket';
  return '';
}

/// Every skill in this checkout, as name and text.
export function skillsInTree(dir = here) {
  const root = join(dir, '.agents', 'skills');
  const out = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name, 'SKILL.md');
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    out.push([name, readFileSync(file, 'utf8')]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test, on made-up skills.
// ---------------------------------------------------------------------------

export function selfTest() {
  const fails = [];
  const one = (name, text) => ownershipFaults([[name, text]]);

  // The build is refused now as well, its one call as much as a second: the gate is the owner's to start.
  if (!one('dev', 'Then run [`/check`](../check/SKILL.md), once.\n').length) fails.push("the build's own call was let through");
  if (one('dev', 'Run `/check` after each phase.\nThen run `/check` again at the end.\n').length !== 2) fails.push('a build running the suite twice was not refused both times');

  // The two gate skills are every sentence about running the suite, so neither is counted.
  if (one('check', 'Run `just verify` from the top, then run it again.\n').length) fails.push('the gate skill was held to its own rule');
  if (one('test', 'Run `/sync-tests` across the batch, then run `just verify` once.\n').length) fails.push("the owner's gate pass was held to the rule it exists to run");

  // Every other pass is refused, whatever it calls itself.
  for (const name of ['git-release', 'done', 'ticket', 'design', 'pm', 'shell-fragment', 'add-format', 'design-tokens', 'code-comments', 'sync-docs', 'sync-tests']) {
    if (!one(name, 'Then run `/sync-docs`, `/code-comments` and `/check`, in that order.\n').length) fails.push(`${name} calling the gate was let through`);
  }
  if (!one('git-release', 'Run `just verify` before the commit.\n').length) fails.push('a pass running the suite by its own name was let through');

  // What is not a call: a consequence, a refusal, and a narrow recipe.
  if (one('pm', 'A cell that disagrees fails when `just verify` runs.\n').length) fails.push('a sentence saying the suite fails on something was read as a call to run it');
  if (one('sync-docs', 'A page written and left fails the build, because `just check-doc-images` runs inside `just verify`.\n').length) fails.push('a sentence explaining where a narrow check runs was read as a call');
  if (one('add-format', 'Run the format tests, never the complete suite: `just verify` belongs to the pass the owner starts.\n').length) fails.push('a sentence refusing the gate was read as a call to run it');
  if (one('code-comments', 'Build Rust documentation, and do not run `/check` — the owner pays for the suite once.\n').length) fails.push('a refusal written the other way round was read as a call');
  if (one('design-tokens', 'Run `just check-tokens check-icons check-literals`.\n').length) fails.push('a narrow check was read as the complete gate');
  if (one('design-tokens', 'An edit there is lost on the next run, and `just verify` fails first.\n').length) fails.push('`run` as a noun was read as an instruction to run');
  if (one('sync-tests', 'A self-test at the top of its own run, and a line in `just verify`.\n').length) fails.push('a rule about where a new check belongs was read as a call');
  if (one('shell-fragment', 'Run `just check-shell` against the fragments in their real order.\n').length) fails.push('the front-end boot was read as the complete gate');

  // A paragraph is one line in this tree, so a sentence is the unit. A refusal and a call on the same line are still two sentences.
  const mixed = one('done', 'This pass runs no complete gate. Then run `/check` anyway.\n');
  if (mixed.length !== 1) fails.push(`a line carrying a refusal and a call answered ${mixed.length} faults rather than the one call`);

  // The gate with nobody left to run it is the other way this rots.
  if (someoneOwnsTheGate([['test', 'Tick the box and stop.\n']]) === '') fails.push('an owner pass that no longer runs the suite at all was let through');
  if (someoneOwnsTheGate([['dev', 'Run `just verify`.\n']]) === '') fails.push('a tree with no /test skill was let through');
  if (someoneOwnsTheGate([['test', 'Then run [`/check`](../check/SKILL.md) over the batch.\n']]) !== '') fails.push("the owner pass's own call was not recognized");

  return fails;
}

// ---------------------------------------------------------------------------

function main() {
  const fails = selfTest();
  if (fails.length) {
    console.error('the suite-caller rule does not hold on made-up skills:');
    for (const fail of fails) console.error(`  ${fail}`);
    process.exit(1);
  }

  const skills = skillsInTree();
  const problems = ownershipFaults(skills);
  const lost = someoneOwnsTheGate(skills);
  if (lost) problems.push(lost);
  if (problems.length) {
    console.error('the complete suite is the owner to start, and something else is starting one:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Run the narrow checks about what that pass writes instead — the format tests, the design checks, the front-end boot, the document checks, the Rust documentation build.');
    process.exit(1);
  }
  console.log(`suite callers: ${skills.length} skills read, the owner's own pass holds the one run of the complete suite, and every other pass proves what it writes with the narrow checks about it`);
}

if (process.argv[1] && process.argv[1].endsWith('check-suite-callers.mjs')) {
  main();
}
