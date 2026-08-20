#!/usr/bin/env node
// UserPromptSubmit hook. Refuses a build on a ticket nobody has designed. Reading a plan against the code is what turns a wish into work somebody can build, and a build that skipped it writes code off a plan whose own words have never been opened — which is how a phase gets built the way the plan guessed rather than the way the code is.
//
//   node scripts/gate-design.mjs           the hook payload on stdin
//   node scripts/gate-design.mjs --check   self-test (`just verify`)
//
// Blocks rather than warns: this is the one order in the workflow that cannot be recovered afterwards, because the code is already written by the time anybody notices. The message names the ticket and says to run /design over it, which is the whole way past.
//
// Only a message naming the build skill with its host's sign and carrying a path into the plan tree is read. A path that cannot be opened is somebody else's refusal — a hook that guesses at a missing file wedges a session over a typo.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keep } from './hook-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(root, '..', 'docs');

/** The dated `Designed` line /design writes. The same test check-plan-stage.mjs makes of a row's stage. */
export function isDesigned(ticket) {
  return /\*\*Designed\s+\d/.test(ticket);
}

/** The plan paths a message naming the build skill hands over, or [] when it names no build. */
export function ticketsIn(prompt) {
  if (!/(^|\s)[$/]dev\b/i.test(prompt)) return [];
  return [...prompt.matchAll(/(?:^|[\s"'`(])((?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'`()]*docs[\\/][^\s"'`()]*\.md)/g)].map((m) => m[1]);
}

/** The reason a build is refused, or '' when it may go ahead. `read` opens a path the message named. */
export function refusal(prompt, read) {
  for (const path of ticketsIn(prompt)) {
    let ticket = null;
    try {
      ticket = read(path);
    } catch {
      continue; // A path that will not open is a typo or another tree's file, and holding the turn over one is a hook nobody can get past.
    }
    if (!isDesigned(ticket)) return `${path} has no dated Designed line, so it has never been read against the code. Run /design over it first, and leave its running-order row at \`Ready\` until that pass writes one.`;
  }
  return '';
}

const DESIGNED = '# A plan\n\n> **Designed 19 August 2026, 7:07pm.** Citations opened.\n';
const PLAIN = '# A plan\n\n> **Not built.** A plan.\n';
const READ = (path) => {
  if (path.includes('designed')) return DESIGNED;
  if (path.includes('plain')) return PLAIN;
  throw new Error('no such file');
};

const CASES = [
  ['a build on a designed ticket', '/dev ../docs/refactor/a/designed.md', false],
  ['a build on a ticket nobody designed', '/dev ../docs/refactor/a/plain.md', true],
  ['a build named with the other host sign', '$dev ../docs/refactor/a/plain.md', true],
  ['a build on a Windows path', '/dev C:\\work\\leaftext\\docs\\refactor\\a\\plain.md', true],
  ['a build naming a path that will not open', '/dev ../docs/refactor/a/gone.md', false],
  ['a build with no path at all', '/dev the top of the running order', false],
  ['another skill over an undesigned ticket', '/ticket ../docs/refactor/a/plain.md', false],
  ['prose that merely says the word', 'the dev tree holds ../docs/refactor/a/plain.md', false],
];

if (process.argv.includes('--check')) {
  const fails = [];
  for (const [name, prompt, shouldRefuse] of CASES) {
    const found = refusal(prompt, READ);
    if (shouldRefuse && !found) fails.push(`gate-design: ${name} is let through`);
    if (!shouldRefuse && found) fails.push(`gate-design: ${name} is refused — ${found}`);
  }
  if (fails.length) {
    for (const fail of fails) console.error(fail);
    process.exit(1);
  }
  console.log(`gate-design: ok (${CASES.length} messages read, a build on an undesigned plan refused)`);
  process.exit(0);
}

let raw = '';
try {
  raw = readFileSync(0, 'utf8');
} catch {
  process.exit(0); // No payload is no message to read, and a hook that cannot read one must never hold a turn.
}
keep('gate-design', raw);

let prompt = '';
try {
  prompt = JSON.parse(raw).prompt ?? '';
} catch {
  process.exit(0);
}

let reason = '';
try {
  reason = refusal(prompt, (path) => readFileSync(isAbsolute(path) ? path : join(TREE, path.replace(/^\.\.[\\/]docs[\\/]/, '')), 'utf8'));
} catch {
  process.exit(0); // A broken gate must never wedge a session.
}

if (reason) {
  console.error(`a build was asked for on a plan nobody has designed:\n  ${reason}`);
  process.exit(2);
}
process.exit(0);
