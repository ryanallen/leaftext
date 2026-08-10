#!/usr/bin/env node
// Two agents can work this checkout at once, and the OS temp folder is the one place they can write over each other. A scratch path built from a fixed name is one file with two writers: the conformance run wrote its child's output to one path per suite, and a second run beside it truncated the file the first was about to read — which failed the gate on a clean tree and sent the reader to a renamed test.
//
//   node scripts/check-scratch-names.mjs   fail on a scratch path with a fixed name (`just verify`)
//
// A name belongs to one run when something is interpolated into it — `std::process::id()` is what most of the suite already uses — or when the OS hands it out (`mkdtemp`). A variable path segment is not enough: `join("leaf-journal").join(name)` gave every journal test a folder of its own and every run the same three.
//
// Four temp paths are fixed on purpose and one more is never written, so the rule cannot simply refuse all of them. Each carries a row below with the reason, and a row that matches nothing fails too — a list of exceptions nobody prunes is how a rule stops being read.
//
// The rules are proved on made-up files before the real tree is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/// Nothing of ours is in these.
const SKIP = new Set(['target', 'node_modules', '.git', 'dist', '.tmp', 'vendor']);

/// This file is not read: it carries made-up scratch paths as its own test cases, and every one of them would be a finding.
const SELF = 'scripts/check-scratch-names.mjs';

/// A fixed name that has to stay fixed: the file it is in, enough of the name to find it, and why. The reason is the point — without it the row is just a way of turning the rule off.
export const ON_PURPOSE = [
  ['src/app/tests.rs', 'leaf-link-fixtures',
    'only builds a name for a link test to resolve against; nothing is ever written there'],
  ['src/tests/mod.rs', 'leaf-render-fixtures',
    'only builds a name for an image test to resolve against; nothing is ever written there'],
  ['src/tests/conformance/mod.rs', 'leaftext-conformance',
    'the stand-in every Markdown case is rendered against, and never written — a path that varied per case would move the rendered answer under the normalizer'],
  ['installer/src/apply.rs', 'leaftext-uninstall.exe',
    'shipping code: where the uninstaller copies itself so it can delete the folder it was running from'],
  ['scripts/check-driver.mjs', 'leaftext-driver-check.bmp',
    'the driver is only ever run dry here, and the check asserts nothing appeared at that path'],
];

/// Where a scratch path starts.
const OPENER = /(?:std::env::temp_dir|env::temp_dir|temp_dir|tmpdir)\s*\(\s*\)/g;

/// Every scratch path a file builds, from the start of the line it begins on to the end of the statement — or to the closing brace, because a path returned as a function's last expression has no semicolon.
///
/// A path is one only where the temp folder is joined onto, which is how every one in this tree is built. The folder handed to something whole — a sweep, a walk — names no file and is left alone.
export function scratchPaths(text) {
  const found = [];
  for (const match of text.matchAll(OPENER)) {
    const after = text.slice(match.index + match[0].length);
    const joined = /^\s*\.join\s*\(/.test(after) || /\bjoin\s*\(\s*$/.test(text.slice(0, match.index));
    if (!joined) continue;
    const from = text.lastIndexOf('\n', match.index) + 1;
    const rest = text.slice(from);
    const end = rest.search(/;|\n\s*\}/);
    found.push({
      line: text.slice(0, from).split('\n').length,
      source: end === -1 ? rest.slice(0, 400) : rest.slice(0, end),
    });
  }
  return found;
}

/// Whether the name belongs to one run. `{{` and `}}` are an escaped brace in a Rust format string, not a value.
export function unique(source) {
  if (/mkdtemp/i.test(source)) return true;
  if (/\$\{/.test(source)) return true;
  if (/format!/.test(source)) return /\{[^{}]*\}/.test(source.replace(/\{\{|\}\}/g, ''));
  return false;
}

/// What is wrong with a set of files and a set of rows. Pure, so both refusals can be proved on input nobody has to keep in step.
export function problems(files, rows) {
  const found = [];
  const matched = new Set();
  for (const { path, text } of files) {
    for (const { line, source } of scratchPaths(text)) {
      if (unique(source)) continue;
      const row = rows.find(([file, name]) => file === path && source.includes(name));
      if (row) {
        matched.add(row);
        continue;
      }
      found.push(`${path}:${line} builds a scratch path with a fixed name — two runs of the suite at once share it. Put this run's own in it (\`std::process::id()\`), or add a row to ${SELF} saying why it has to be fixed`);
    }
  }
  for (const row of rows) {
    if (!matched.has(row)) {
      found.push(`${SELF} excuses ${row[1]} in ${row[0]}, and nothing there builds that path any more — a stale row is how a list of exceptions stops being read`);
    }
  }
  return found;
}

const CASES = [
  ['a fixed name is refused',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }], [], 1],
  ['this run\'s own process id passes',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-fixture-{}", std::process::id()));' }], [], 0],
  ['a variable segment is not unique, because every run passes the same one',
    [{ path: 'a.rs', text: 'std::env::temp_dir().join("leaf-journal").join(name)\n}' }], [], 1],
  ['a name the OS hands out passes',
    [{ path: 'a.mjs', text: "const p = mkdtempSync(join(tmpdir(), 'leaf-drive-'));" }], [], 0],
  ['a template literal passes',
    [{ path: 'a.mjs', text: 'const p = join(tmpdir(), `leaf-${process.pid}.json`);' }], [], 0],
  ['a fixed name in a JavaScript file is refused too',
    [{ path: 'a.mjs', text: "const p = join(tmpdir(), 'leaf-fixed.json');" }], [], 1],
  ['a fixed name with a row is allowed',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }],
    [['a.rs', 'leaf-fixture', 'never written']], 0],
  ['a row for another file does not excuse it',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join("leaf-fixture");' }],
    [['b.rs', 'leaf-fixture', 'never written']], 2],
  ['a row that matches nothing is refused',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-{}", std::process::id()));' }],
    [['a.rs', 'leaf-gone', 'never written']], 1],
  ['the temp folder handed over whole names no file',
    [{ path: 'a.mjs', text: "sweep(tmpdir(), 'leaftext-keycode-');" }], [], 0],
  ['an escaped brace is not a value',
    [{ path: 'a.rs', text: 'let d = std::env::temp_dir().join(format!("leaf-{{fixed}}"));' }], [], 1],
];

const testFails = [];
for (const [name, files, rows, want] of CASES) {
  const got = problems(files, rows).length;
  if (got !== want) testFails.push(`${name}: ${got} findings, wanted ${want}`);
}
if (testFails.length) {
  console.error('scratch names: the rules are wrong, so nothing was read:');
  for (const line of testFails) console.error(`  ${line}`);
  process.exit(1);
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(rs|mjs|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = sources(root)
  .map((full) => relative(root, full).split(sep).join('/'))
  .filter((path) => path !== SELF)
  .map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));

const found = problems(files, ON_PURPOSE);
if (found.length) {
  console.error('a scratch path two runs would share:');
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}

const paths = files.reduce((n, { text }) => n + scratchPaths(text).length, 0);
console.log(`scratch names: ok (${paths} scratch paths, ${ON_PURPOSE.length} fixed on purpose)`);
