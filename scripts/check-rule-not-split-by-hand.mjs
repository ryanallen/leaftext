#!/usr/bin/env node
// A stylesheet test reaches one rule through `rule_body`, which anchors its find to the start of a line and refuses a selector the stylesheet opens twice. Written out longhand — `css.split(".tab-close {").nth(1).and_then(|rest| rest.split('}').next())` — it carries neither guard: a selector that only ends a longer one is answered off that longer rule, and a selector opening two is answered with whichever comes first. Twenty-two places were written that way, and the pass that moved seventy of them by hand was followed the next day by a test written in the longhand again. This refuses it.
//
//   node scripts/check-rule-not-split-by-hand.mjs           fail on a test that splits the stylesheet on a selector
//   node scripts/check-rule-not-split-by-hand.mjs --check   self-test the refusal, then check the suite
//
// It sees a literal and nothing else. A selector held in a variable — a closure handed five heads, a loop over two, a name composed from a class — is invisible to it, and two of the calls this was written to replace were exactly that shape. So it is a fence against the shape being copied from the test next door, never a proof that nothing in the suite splits a rule out by hand.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The four test trees. A hand-split rule in any of them is the same claim. */
const TREES = ['src/app/tests', 'src/tests', 'src/store/tests.rs', 'installer/src/tests.rs'];

/** A `split` on a string literal that opens like a selector — after an optional leading newline, which is how a hand-written anchor is spelled — and ends with the brace that opens a rule. The other brace-ending splits in these trees are JavaScript function heads read out of the page script, and none of those starts with a selector character. */
const SPLIT = /\.split\(\s*&?"((?:\\n)?[.#:[][^"]*\{)"\s*\)/g;

/** Faults in one test file. */
export function faults(name, source) {
  const problems = [];
  for (const hit of source.matchAll(SPLIT)) {
    const line = source.slice(0, hit.index).split('\n').length;
    problems.push(`${name}:${line} splits the stylesheet on \`${hit[1]}\` — call \`rule_body(css, "${hit[1]}")\`, which anchors the match to the start of a line and refuses a selector opening two rules`);
  }
  return problems;
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

const CAUGHT = 'let close = css.split(".tab-close {").nth(1);\\n';
const ANCHORED = 'let tab = css.split("\\n.tab {").nth(1);\\n';
const HELD = 'let block = css.split(&rule).nth(1);\\n';
const CUT = "let body = rest.split('}').next();\\n";
const FUNCTION_HEAD = 'let fn = script.split("function endLibraryMotion(restarting) {").nth(1);\\n';
const HELPER = 'let close = rule_body(css, ".tab-close {");\\n';

const CASES = [
  ['a test splitting the stylesheet on a selector', CAUGHT, true],
  ['a test anchoring its own selector with a newline', ANCHORED, true],
  ['a selector held in a variable, which this cannot see', HELD, false],
  ['a split on the closing brace', CUT, false],
  ['a split on a JavaScript function head', FUNCTION_HEAD, false],
  ['a test reading its rule through the helper', HELPER, false],
];

const problems = [];
if (process.argv.includes('--check')) {
  for (const [name, source, shouldFail] of CASES) {
    const found = faults('a test file', source);
    if (shouldFail && !found.length) problems.push(`this check passes ${name}`);
    if (!shouldFail && found.length) problems.push(`this check refuses ${name}: ${found[0]}`);
  }
}

let read = 0;
for (const path of TREES.flatMap(files)) {
  const source = readFileSync(path, 'utf8');
  const name = relative(root, path).split('\\\\').join('/');
  problems.push(...faults(name, source));
  read += 1;
}

if (problems.length) {
  console.error('a test slices a rule out of the stylesheet by hand:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('The longhand is `rule_body` without either of its guards, so a selector that only ends a longer rule, or that opens two, is answered silently.');
  process.exit(1);
}
console.log(`stylesheet rules: ${read} test files across 4 test trees, none splitting a rule out on a selector of its own`);
