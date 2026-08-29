#!/usr/bin/env node
// One ticket pays for the complete suite once, at the end of its build. This refuses every other automatic caller.
//
//   node scripts/check-suite-callers.mjs           the real skills (`just verify`)
//   node scripts/check-suite-callers.mjs --check   the same, after the self-test on made-up skills
//
// Without it the calls come back one at a time, in whichever pass feels unproven that week, and nobody notices until the whole cost is back: a two-phase ticket once paid for a 54-second suite eight times — after each phase, at the end of the build, twice inside the release, once inside the release command itself, and twice more while the ticket was retired.
//
// What every other pass runs instead is the narrow check about what it wrote: the format tests, the design checks, the front-end boot, the document checks, the Rust documentation build. Those are seconds and they prove the thing that moved. The suite recompiles the app and reruns the tests, and after a build nothing between it and the tag edits a line of either.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

// The two skills the complete gate belongs to. `check` is the gate written down, so every sentence in it is about running the suite; `dev` is the one pass that calls it without being asked, once, after its last phase.
export const GATE_OWNERS = new Set(['check', 'dev']);

/// How many automatic calls the build is allowed. One: after the last phase.
export const BUILD_CALLS = 1;

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

/// Every skill that automatically runs the complete gate when it should not, and a build that runs it more than once.
export function ownershipFaults(skills) {
  const faults = [];
  for (const [name, text] of skills) {
    const found = gateDirectives(text);
    if (!found.length) continue;
    if (name === 'check') continue;
    if (!GATE_OWNERS.has(name)) {
      for (const { line, sentence } of found) faults.push(`${name} runs the complete suite at line ${line}: ${sentence}`);
      continue;
    }
    if (found.length > BUILD_CALLS) {
      faults.push(`dev runs the complete suite ${found.length} times and owns ${BUILD_CALLS}: ${found.map((f) => `line ${f.line}`).join(', ')}`);
    }
  }
  return faults;
}

/// A build with no automatic call at all is the other way this rots: nothing would then prove a ticket before it ships.
export function buildOwnsItsCall(skills) {
  const dev = skills.find(([name]) => name === 'dev');
  if (!dev) return 'there is no build skill to own the one check';
  const found = gateDirectives(dev[1]);
  if (!found.length) return 'the build skill no longer runs the complete suite at all, so nothing proves a ticket before it ships';
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

  // The build's one call passes, and a second one in the same file does not.
  if (one('dev', 'Then run [`/check`](../check/SKILL.md), once.\n').length) fails.push("the build's one call was refused");
  if (one('dev', 'Run `/check` after each phase.\nThen run `/check` again at the end.\n').length !== 1) fails.push('a build running the suite twice was let through');

  // The gate skill itself is every sentence about running the suite, so it is never counted.
  if (one('check', 'Run `just verify` from the top, then run it again.\n').length) fails.push('the gate skill was held to its own rule');

  // Every other pass is refused, whatever it calls itself.
  for (const name of ['git-release', 'done', 'ticket', 'design', 'pm', 'shell-fragment', 'add-format', 'design-tokens', 'code-comments', 'sync-docs', 'sync-tests']) {
    if (!one(name, 'Then run `/sync-docs`, `/code-comments` and `/check`, in that order.\n').length) fails.push(`${name} calling the gate was let through`);
  }
  if (!one('git-release', 'Run `just verify` before the commit.\n').length) fails.push('a pass running the suite by its own name was let through');

  // What is not a call: a consequence, a refusal, and a narrow recipe.
  if (one('pm', 'A cell that disagrees fails when `just verify` runs.\n').length) fails.push('a sentence saying the suite fails on something was read as a call to run it');
  if (one('sync-docs', 'A page written and left fails the build, because `just check-doc-images` runs inside `just verify`.\n').length) fails.push('a sentence explaining where a narrow check runs was read as a call');
  if (one('add-format', 'Run the format tests, never the complete suite: `just verify` belongs to the build that called this.\n').length) fails.push('a sentence refusing the gate was read as a call to run it');
  if (one('code-comments', 'Build Rust documentation, and do not run `/check` — the build that called this pays for it once.\n').length) fails.push('a refusal written the other way round was read as a call');
  if (one('design-tokens', 'Run `just check-tokens check-icons check-literals`.\n').length) fails.push('a narrow check was read as the complete gate');
  if (one('design-tokens', 'An edit there is lost on the next run, and `just verify` fails first.\n').length) fails.push('`run` as a noun was read as an instruction to run');
  if (one('sync-tests', 'A self-test at the top of its own run, and a line in `just verify`.\n').length) fails.push('a rule about where a new check belongs was read as a call');
  if (one('shell-fragment', 'Run `just check-shell` against the fragments in their real order.\n').length) fails.push('the front-end boot was read as the complete gate');

  // A paragraph is one line in this tree, so a sentence is the unit. A refusal and a call on the same line are still two sentences.
  const mixed = one('done', 'This pass runs no complete gate. Then run `/check` anyway.\n');
  if (mixed.length !== 1) fails.push(`a line carrying a refusal and a call answered ${mixed.length} faults rather than the one call`);

  // The build losing its call is the other way this rots.
  if (buildOwnsItsCall([['dev', 'Tick the box and stop.\n']]) === '') fails.push('a build that no longer runs the suite at all was let through');
  if (buildOwnsItsCall([['check', 'Run `just verify`.\n']]) === '') fails.push('a tree with no build skill was let through');
  if (buildOwnsItsCall([['dev', 'Then run [`/check`](../check/SKILL.md), once.\n']]) !== '') fails.push("the build's own call was not recognized");

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
  const lost = buildOwnsItsCall(skills);
  if (lost) problems.push(lost);
  if (problems.length) {
    console.error('a ticket pays for the complete suite once, at the end of its build, and something else is running it:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Run the narrow checks about what that pass writes instead — the format tests, the design checks, the front-end boot, the document checks, the Rust documentation build.');
    process.exit(1);
  }
  console.log(`suite callers: ${skills.length} skills read, the build owns the one automatic run of the complete suite and still has it, and every other pass proves what it writes with the narrow checks about it`);
}

if (process.argv[1] && process.argv[1].endsWith('check-suite-callers.mjs')) {
  main();
}
