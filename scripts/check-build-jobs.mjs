#!/usr/bin/env node
// Every compile in the gate is a Cargo command, so one setting decides whether a gate leaves the machine usable. This holds it where it is; CARGO_BUILD_JOBS raises it for a run without touching the committed default.
//
//   node scripts/check-build-jobs.mjs --check   fail on a missing, malformed or raised default (`just verify`)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = '.cargo/config.toml';
const SHARE = 2;

// All the grammar this rule needs: a `jobs` key under `[build]`, with whatever it was given.
export function buildJobs(text) {
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const pair = line.match(/^jobs\s*=\s*(.+?)\s*$/);
    if (pair && section === 'build') return pair[1];
  }
  return null;
}

export function faults(text) {
  const value = buildJobs(text);
  if (value === null) return [`${CONFIG} sets no build job count, so every compile takes every core`];
  if (!/^\d+$/.test(value)) return [`${CONFIG} sets the build job count to ${value}, which is not a whole number of cores`];
  const jobs = Number(value);
  if (jobs === 0) return [`${CONFIG} sets the build job count to 0, which is Cargo's word for every core`];
  if (jobs > SHARE) return [`${CONFIG} sets the build job count to ${jobs}, above the ${SHARE} this repo gives a gate — raise it for one run with CARGO_BUILD_JOBS instead`];
  return [];
}

const CASES = [
  ['the committed default', '[build]\njobs = 2\n', false],
  ['a smaller share', '[build]\njobs = 1\n', false],
  ['the setting written under a comment', '# why\n[build]\njobs = 2\n', false],
  ['a jobs key belonging to another section', '[net]\njobs = 8\n\n[build]\njobs = 2\n', false],
  ['no jobs key at all', '[build]\nrustflags = []\n', true],
  ['an empty file', '', true],
  ['a word where the count goes', '[build]\njobs = "all"\n', true],
  ['zero, which Cargo reads as every core', '[build]\njobs = 0\n', true],
  ['a count above the share', '[build]\njobs = 16\n', true],
];

const problems = [];
for (const [name, source, shouldFail] of CASES) {
  const found = faults(source);
  if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
  if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
}

let committed = null;
try {
  committed = readFileSync(join(root, CONFIG), 'utf8');
} catch {
  problems.push(`${CONFIG} is not there, so Cargo gives every compile the whole machine`);
}
if (committed !== null) problems.push(...faults(committed));

if (problems.length) {
  console.error('the gate does not leave the machine usable:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`${CONFIG}: every compile takes ${SHARE} jobs, and CARGO_BUILD_JOBS raises it for one run`);
