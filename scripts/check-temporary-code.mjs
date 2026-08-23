#!/usr/bin/env node
// Measuring code is written to answer one question and is meant to leave with the answer, and nothing here made it leave. The event-counting probe in the window loop said `TEMPORARY` in the first word of its own comment, named a box that had been cut when its ticket was rewritten, and shipped in every copy from v1.21.2 until somebody read the file for another reason.
//
//   node scripts/check-temporary-code.mjs   fail on a source line calling itself temporary (`just verify`)
//
// Two words, shouted, as whole words: `TEMPORARY` and `FIXME`. Both assert the same thing — this block is not meant to stay as it is — and both return nothing at all across the folders read here, so the rule starts clean rather than opening with a list of exceptions. The other candidates were refused on counts rather than taste: `XXX` is four base64 font bytes and a doc comment about a unicode escape and has never once been used here as a marker, and `TODO` and `HACK` have an honest standing use, since a note about work genuinely coming later is not the claim that a block should not exist.
//
// Capitals are the whole rule. The lower-case word has an ordinary life in prose here — four sentences about a scratch directory — and none of them is a label on a block.
//
// There is no escape, and that is the point. Every other check here that can be wrong carries a way to say so on the line, because the thing it refuses has a legitimate use. This one does not: a marker somebody means to keep is a marker that should not say temporary, and the way to keep the code is to delete the word and write what the block is for. An escape would be a way of shipping the exact block this was written for.
//
// It reads the tree rather than the diff. The probe passed every gate for a day after it was committed, so a pass keyed on what changed would have gone quiet at the same moment.
//
// The plan tree is not read on purpose: a ticket about a temporary block has to be able to say so, and `check-docs` already covers those files for what a plan owes.
//
// The rules are proved on made-up lines before the real tree is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The folders that ship. `wix/` and `installer/` decide what a reader ends up running as much as `src/` does.
const ROOTS = ['src', 'scripts', 'wix', 'installer'];

/// Nothing of ours is in these.
const SKIP = new Set(['target', 'node_modules', '.git', 'dist', '.tmp']);

/// Somebody else's code, never edited here, and where every `XXX` in the repo turns out to live.
const VENDOR = 'src/assets/vendor/';

/// This file is not read: it carries both markers as its own test cases, and every one of them would be a finding.
const SELF = 'scripts/check-temporary-code.mjs';

/// Bytes rather than words. A marker cannot be read out of these, and reading them as text is how a check finds one nobody wrote.
const BINARY = /\.(woff2?|ttf|otf|png|ico|jpe?g|webp|gif|zip|msi|exe|dmg)$/i;

/// A block calling itself temporary, shouted, as a whole word.
const MARKER = /\b(TEMPORARY|FIXME)\b/;

/// Whether a path is one this pass reads.
export function reads(path) {
  if (path === SELF) return false;
  if (path.startsWith(VENDOR)) return false;
  if (BINARY.test(path)) return false;
  return ROOTS.some((folder) => path.startsWith(`${folder}/`));
}

/// What is wrong with a set of files. Pure, so every refusal can be proved on input nobody has to keep in step.
export function problems(files) {
  const found = [];
  for (const { path, text } of files) {
    if (!reads(path)) continue;
    text.split('\n').forEach((line, index) => {
      const hit = MARKER.exec(line);
      if (!hit) return;
      found.push(`${path}:${index + 1} says ${hit[1]} — a block labeled temporary ships until somebody takes it out, and nothing but this asks. Delete the code, or delete the word and write what the block is for`);
    });
  }
  return found;
}

const CASES = [
  ['a shouted marker in a comment is refused, and named on its own line',
    [{ path: 'src/app/event_loop.rs', text: 'fn probe() {}\n// TEMPORARY: counts every event so the loop can be measured.' }], 1, 'src/app/event_loop.rs:2'],
  ['the other word is refused too',
    [{ path: 'src/data.rs', text: '// FIXME: this parser drops the trailing field.' }], 1],
  ['the lower-case word in prose passes',
    [{ path: 'src/journal.rs', text: '/// Point a journal at a temporary directory.' }], 0],
  ['a capitalized word in prose passes, because only the shout is a label',
    [{ path: 'src/journal.rs', text: '/// Temporary directories are cleaned up by the OS.' }], 0],
  ['the doc comment about a unicode escape passes',
    [{ path: 'src/data.rs', text: '/// A `\\uXXXX` escape is decoded here.' }], 0],
  ['the words nobody here uses as a marker pass',
    [{ path: 'src/a.rs', text: '// TODO: the pager gains a filter later.\n// HACK\n// XXX' }], 0],
  ['a longer word carrying the marker passes',
    [{ path: 'src/a.rs', text: 'const TEMPORARYISH: u8 = 1;\nlet x = PREFIXME;' }], 0],
  ['a marker under the vendored folder is never read',
    [{ path: 'src/assets/vendor/mermaid.js', text: '// FIXME: upstream leaves this here.' }], 0],
  ['this pass own file is never read',
    [{ path: SELF, text: '// TEMPORARY' }], 0],
  ['a file outside the folders that ship is never read',
    [{ path: 'docs/02-development/02-building.md', text: 'It fails on TEMPORARY or FIXME.' }], 0],
  ['a marker in the installer is refused, because it decides what a reader runs',
    [{ path: 'installer/src/apply.rs', text: '// TEMPORARY: skip the registry write while testing.' }], 1],
  ['a marker in the packaging file is refused too',
    [{ path: 'wix/main.wxs', text: '<!-- FIXME: the shortcut folder is guessed. -->' }], 1],
  ['two markers in one file are two findings',
    [{ path: 'src/a.rs', text: '// TEMPORARY\nlet x = 1;\n// FIXME' }], 2],
  ['a font file is not read as words',
    [{ path: 'src/assets/noto.woff2', text: 'TEMPORARY' }], 0],
];

const testFails = [];
for (const [name, files, want, wantNamed] of CASES) {
  const got = problems(files);
  if (got.length !== want) testFails.push(`${name}: ${got.length} findings, wanted ${want}`);
  else if (wantNamed && !got[0].startsWith(wantNamed)) testFails.push(`${name}: named ${got[0].split(' ')[0]}, wanted ${wantNamed}`);
}
if (testFails.length) {
  console.error('temporary code: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((folder) => sources(join(root, folder)))
  .map((full) => relative(root, full).split(sep).join('/'))
  .filter(reads)
  .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

const found = problems(files);
if (found.length) {
  console.error('a block of code that says it is temporary:');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`temporary code: ok (${files.length} files read)`);
