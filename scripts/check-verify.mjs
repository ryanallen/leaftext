#!/usr/bin/env node
// A check nobody runs is not a check. Every `check-*` target in the Justfile has to be
// in `just verify`, so writing one is enough to have it enforced — and dropping one
// from the list fails here rather than going quiet.
//
//   node scripts/check-verify.mjs   report anything missing (`just verify`)
//
// It also holds the other direction: a name in `verify` that is not a real target
// would make the whole suite fail with just's own error, which says nothing useful
// about which rule stopped being checked.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const justfile = readFileSync(join(root, 'Justfile'), 'utf8');

const targets = new Set(
  [...justfile.matchAll(/^([a-z][a-z0-9-]*):/gm)].map((m) => m[1]).filter((t) => t !== 'verify')
);
const verify = justfile
  .split('\n')
  .find((line) => line.startsWith('verify:'));
if (!verify) throw new Error('the Justfile has no verify recipe');
const runs = new Set(verify.replace('verify:', '').trim().split(/\s+/).filter(Boolean));

const problems = [];
// Every guard runs. `check` and `test` are cargo's, and they are in the list too.
for (const target of targets) {
  if (!target.startsWith('check-') && target !== 'format-check') continue;
  if (!runs.has(target)) problems.push(`just verify does not run ${target}`);
}
for (const step of runs) {
  if (!targets.has(step)) problems.push(`just verify runs ${step}, which is not a target`);
}

if (problems.length) {
  console.error('the verify suite and the Justfile disagree:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('A rule with no check in `verify` is a rule that holds only while someone remembers it.');
  process.exit(1);
}
console.log(`verify: ${runs.size} steps, and every check the Justfile defines is one of them`);
