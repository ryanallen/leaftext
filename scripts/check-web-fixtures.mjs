#!/usr/bin/env node
// Every format the app reads has a document the browser modules can be proved on.
//
//   node scripts/check-web-fixtures.mjs   (`just verify`)
//
// `scripts/build-web.mjs` renders one fixture per spelling through a real wasm module and refuses to finish without one. That is the honest check and it cannot join `just verify`: it needs the wasm32 target, and a machine without one would go red having done nothing wrong. So it runs at publish time only — which is how three spellings were added to `src/format.rs` with no fixture beside them, and both published sites went a day and twenty-two pushes without deploying while every gate stayed green.
//
// This asks the cheaper half of the same question with no target and no build: `src/format.rs` is the one table of what the app reads, `scripts/web-fixtures.mjs` is the one table of what the browser modules are proved on, and every spelling in the first owes an entry in the second. It reads both rather than holding a list of its own.
//
// **It answers both directions.** A spelling with no fixture is the failure that cost the day; a fixture keyed to a spelling `src/format.rs` no longer names is a document nothing renders, which is the same drift running the other way and is invisible without being asked for.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentRows } from './app-formats.mjs';
import { FORMAT_FIXTURES, PACKAGE_FIXTURES } from './web-fixtures.mjs';

/** What is wrong, given the spellings the app reads and the spellings the fixtures cover. Both are plain lists, so the reading above and the made-up tables below go through one body. */
export function problemsWith(spellings, covered) {
  const problems = [];
  const has = new Set(covered);
  for (const spelling of spellings) {
    if (!has.has(spelling)) problems.push(`the app reads .${spelling} and no fixture renders one — add it to scripts/web-fixtures.mjs`);
  }
  const reads = new Set(spellings);
  for (const spelling of covered) {
    if (!reads.has(spelling)) problems.push(`a fixture renders .${spelling} and the app no longer reads it — take it out of scripts/web-fixtures.mjs`);
  }
  return problems;
}

/** A table naming a spelling nothing renders, and one whose fixture the app no longer reads. Held against made-up input rather than only against the files it reads, because a reader held only to the tree it lives in passes on the day that tree moves. */
const CASES = [
  ['a spelling with no fixture', ['md', 'docm'], ['md'], 'the app reads .docm'],
  ['a fixture nothing reads', ['md'], ['md', 'wpd'], 'the app no longer reads it'],
  ['both at once', ['md', 'docm'], ['md', 'wpd'], 'the app reads .docm'],
  ['in step', ['md', 'docm'], ['docm', 'md'], null],
];

/** What is wrong with the reader, on the made-up tables above. Empty when every one is answered the way it has to be. */
export function selfTest() {
  const failed = [];
  for (const [name, spellings, covered, want] of CASES) {
    const got = problemsWith(spellings, covered);
    if (want === null) {
      if (got.length) failed.push(`${name}: named ${JSON.stringify(got)} where it had to pass`);
    } else if (!got.some((line) => line.includes(want))) {
      failed.push(`${name}: named ${JSON.stringify(got)}, which does not say ${JSON.stringify(want)}`);
    }
  }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const failed = selfTest();
  if (failed.length) {
    console.error('web fixtures: the reader is wrong, so nothing it says about the tree is held:');
    for (const line of failed) console.error(`  ${line}`);
    process.exitCode = 1;
  } else {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const spellings = documentRows(readFileSync(join(root, 'src/format.rs'), 'utf8')).flatMap(([, each]) => each);
    const covered = [...Object.keys(FORMAT_FIXTURES), ...Object.keys(PACKAGE_FIXTURES)];
    const problems = problemsWith(spellings, covered);
    if (problems.length) {
      console.error('web fixtures: the browser modules cannot be proved on every format the app reads:');
      for (const line of problems) console.error(`  ${line}`);
      process.exitCode = 1;
    } else {
      console.log(`web fixtures: ok (${CASES.length} made-up tables answered, and all ${spellings.length} spellings src/format.rs names have a fixture)`);
    }
  }
}
