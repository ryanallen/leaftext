#!/usr/bin/env node
// The event loop never returns, so for years the only way a test could hold one of its handlers was to read `event_loop.rs` as a string and assert its text contained a call. Ten tests did that, and what they held was spelling: every one of them was watched passing with the behavior it named deleted, and one measured a handler two hundred lines from its own subject. The handlers are functions now, so the reads are gone and this refuses the next one.
//
//   node scripts/check-loop-not-read-as-text.mjs           fail on a test that reads the loop as text
//   node scripts/check-loop-not-read-as-text.mjs --check   self-test the refusal, then check the suite
//
// One read is allowed, by the exact assertion it makes rather than by a pattern: the Windows branch of the shadow band's resize reaches `drag_resize_window` on a window no test can build, so that one call is spelled rather than answered. A list keyed loosely enough to be convenient is the thing that swallows the next one.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The four test trees. A read of the loop from any of them is the same claim. */
const TREES = ['src/app/tests', 'src/tests', 'src/store/tests.rs', 'installer/src/tests.rs'];

/** Both spellings the suite uses — the binary's own `event_loop.rs`, and the same file reached from the library's tree — and the bytes form beside the string one, since a read is a read. */
const READ = /include_(?:str|bytes)!\(\s*"[^"]*event_loop\.rs"\s*\)/g;

/** The one thing about the loop no value can answer, allowed by its exact string. */
export const ALLOWED = 'source.contains("reader.window.drag_resize_window(direction)")';

/** Faults in one test file. A read is allowed only inside a test that goes on to make the one assertion above, and only one test in the whole suite may. */
export function faults(name, source) {
  const problems = [];
  for (const hit of source.matchAll(READ)) {
    const rest = source.slice(hit.index);
    const end = rest.indexOf('\n}\n');
    const test = end === -1 ? rest : rest.slice(0, end);
    if (test.includes(ALLOWED)) continue;
    problems.push(`${name} reads the loop as text with \`${hit[0]}\` — move the handler into a function the test can call, the way the nine before it were moved`);
  }
  return problems;
}

/** How many times a source makes the one allowed assertion. The exception is a single test, not a shape other tests may take. */
export function exceptions(source) {
  return source.split(ALLOWED).length - 1;
}

/** Every `.rs` file under a path, whether it names a file or a folder. */
function files(path) {
  const full = join(root, path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(path, entry.name)) : entry.name.endsWith('.rs') ? [join(full, entry.name)] : []
  );
}

const PLAIN = 'let source = include_str!("event_loop.rs");\n    assert!(source.contains("something"));\n}\n';
const RELATIVE = 'let source = include_str!("../app/event_loop.rs");\n    assert!(source.contains("something"));\n}\n';
const BYTES = 'let source = include_bytes!("event_loop.rs");\n}\n';
const EXCEPTED = `let source = include_str!("event_loop.rs");\n    assert!(${ALLOWED});\n}\n`;
const OTHER = 'let source = include_str!("render.rs");\n    assert!(source.contains("something"));\n}\n';

const CASES = [
  ['a test reading the loop from the binary\'s own tree', PLAIN, true],
  ['a test reading the loop from the library\'s tree', RELATIVE, true],
  ['a test reading the loop as bytes', BYTES, true],
  ['the one read that keeps the platform call', EXCEPTED, false],
  ['a test reading some other source', OTHER, false],
];

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, source, shouldFail] of CASES) {
    const found = faults('a test file', source);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
  }
  if (exceptions(EXCEPTED) !== 1) problems.push('this check does not see the one allowed assertion');
  if (exceptions(EXCEPTED + EXCEPTED) !== 2) problems.push('this check does not see the allowed assertion being copied');
}

let excepted = 0;
let read = 0;
for (const path of TREES.flatMap(files)) {
  const source = readFileSync(path, 'utf8');
  const name = relative(root, path).split('\\').join('/');
  problems.push(...faults(name, source));
  for (const _ of source.matchAll(READ)) read += 1;
  excepted += exceptions(source);
}

// The exception is one test, not a shape other tests may take.
if (excepted > 1) problems.push(`${excepted} tests make the one allowed assertion, and only one may — the rest are reading the loop for something a value could answer`);

if (problems.length) {
  console.error('a test holds an event-loop handler by reading its source:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('What such a test holds is spelling. Every one of the ten before it passed with the behavior it named deleted.');
  process.exit(1);
}
console.log(`event loop: ${read} test read of its source across 4 test trees, the one platform call no value can answer`);
