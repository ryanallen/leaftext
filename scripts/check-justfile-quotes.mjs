#!/usr/bin/env node
// Quote characters around an interpolation reach Windows programs as part of the argument. Recipes must hand arguments over bare.
//
//   node scripts/check-justfile-quotes.mjs   fail on a quoted interpolation (`just verify`)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quotedInterpolation = /(["'])\{\{[^{}]*\}\}\1/g;

function quotedInterpolations(text) {
  const found = [];
  let recipe = null;
  for (const [index, line] of text.split('\n').entries()) {
    const header = line.match(/^([a-z][a-z0-9-]*)\b.*:/);
    if (header) {
      recipe = header[1];
      continue;
    }
    if (!/^\s+/.test(line) || !recipe) continue;
    for (const match of line.matchAll(quotedInterpolation)) {
      found.push({ line: index + 1, recipe, interpolation: match[0] });
    }
  }
  return found;
}

const CASES = [
  ['an unquoted interpolation', 'ask request:\n    node tool.mjs {{ request }}', false],
  ['ordinary quoted text', 'say:\n    node tool.mjs "a quoted sentence"', false],
  ['a double-quoted interpolation', 'ask request:\n    node tool.mjs "{{ request }}"', true],
  ['a single-quoted interpolation', "ask request:\n    node tool.mjs '{{ request }}'", true],
];
const problems = [];
for (const [name, source, shouldFail] of CASES) {
  const found = quotedInterpolations(source);
  if (shouldFail && !found.length) problems.push(`this check misses ${name}`);
  if (!shouldFail && found.length) problems.push(`this check rejects ${name}`);
}

for (const found of quotedInterpolations(readFileSync(join(root, 'Justfile'), 'utf8'))) {
  problems.push(`Justfile:${found.line}: ${found.recipe} surrounds ${found.interpolation} with quote characters`);
}

if (problems.length) {
  console.error('quoted Justfile interpolations reach the called program:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('Justfile: every interpolation is passed without surrounding quote characters');
