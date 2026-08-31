#!/usr/bin/env node
// A test that reads its subject's Rust source as a string and asserts the text contains a call holds spelling, not behavior. Ten such tests were watched passing with the behavior each named deleted, and one measured a handler two hundred lines from its own subject. This refuses the next one, across every `.rs` file the four test trees can reach.
//
//   node scripts/check-source-not-read-as-text.mjs           fail on a test that reads Rust source as text
//   node scripts/check-source-not-read-as-text.mjs --check   self-test the refusal, then check the suite
//
// A read is kept only where the subject cannot be a value at all — a web view, a native window, a `WindowBuilder` chain, a Mac arm nothing here compiles, or a crate the test tree cannot see. Each of those is one row of `ALLOWED` below, keyed on the exact assertion its test makes and carrying the reason beside it. A row that covers no read is a fault here: one shared allowance with nothing beside it goes on passing after the read it was written for is gone, and starts quietly guarding whatever else happens to make the same assertion.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The four test trees. A read of Rust source from any of them is the same claim. */
const TREES = ['src/app/tests', 'src/tests', 'src/store/tests.rs', 'installer/src/tests.rs'];

/** Both spellings a read takes — the string form and the bytes form, since a read is a read — and the file it names. */
const READ = /include_(?:str|bytes)!\(\s*"([^"]*\.rs)"\s*\)/g;

/**
 * The reads that stay, one row each: the test file, the source it reads, the exact assertion that read exists to make, and why that assertion cannot be a value.
 *
 * Exact rather than a pattern on purpose. A list keyed loosely enough to be convenient is the thing that swallows the next one.
 */
export const ALLOWED = [
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"only the PDF and picture renders have a hold to release: {body}"',
    because: '`export_page` takes a `&WebView`, and nothing in this suite can build one',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"{function} starts its render before the paper rules reach the page: {body}"',
    because: 'both page writers take a `&WebView`',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"the picture render no longer writes the engine\'s bytes unchanged: {picture}"',
    because: '`export_page` takes a `&WebView`',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"the native sheet does not cover the whole export work: {body}"',
    because: '`export_page` takes a `&WebView`',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'export_cover.rs',
    asserts: '"every early return must uncover the reader through the cover\'s drop: {cover}"',
    because: 'the cover is a native sheet raised on a window no test can build',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'window_cmds.rs',
    asserts: '"the native sheet must take the color the page reports for its own frame: {chrome}"',
    because: 'the color reaches a platform call on that same native sheet',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"the ask must not open a dialog nobody can answer: {body}"',
    because: '`write_page_pdf_at` takes a `&WebView`',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"a Mac export must raise no panel: {body}"',
    because: 'a Mac arm nothing here compiles, let alone runs',
  },
  {
    file: 'src/app/tests/export.rs',
    reads: 'fileops.rs',
    asserts: '"the export names the file after the document and reads nothing else of it: {body}"',
    because: '`export_page` takes a `&WebView`',
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'main.rs',
    asserts: '"{call} belongs once, in the macOS window arm"',
    because: 'a `WindowBuilder` chain is not a value, and nothing here can build the window it makes',
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'main.rs',
    asserts: '"the platform shadow is still on, so the app draws a second one inside it"',
    because: 'the same builder chain',
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'window_cmds.rs',
    asserts: 'source.contains("reader.window.drag_resize_window(direction)")',
    because: "the direction reaches the platform's own resize loop, on a window no test can build",
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'window_cmds.rs',
    asserts: 'source.contains("reader.window.set_fullscreen(fullscreen_after(fullscreen))")',
    because: 'the decision reaches a full-screen call on a window no test can build, and the kind it must not reach is a Mac-only call nothing here compiles',
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'main.rs',
    asserts: '"the window and the web view are the two things that take the keyboard, and one of them no longer asks for none"',
    because: 'the window builder chain and the web view builder chain, neither of which is a value any test can build',
  },
  {
    file: 'src/app/tests/window.rs',
    reads: 'event_loop.rs',
    asserts: '"the event loop pulls the window forward without asking whether anybody can see it"',
    because: 'surfacing takes a `&tao::window::Window`, and nothing in this suite can build one',
  },
  {
    file: 'src/tests/app_shell_chrome_export.rs',
    reads: 'fileops.rs',
    asserts: '"only the PDF and picture renders have a hold to release"',
    because: "this is the library's own test tree, which cannot name a module of the binary at all",
  },
  {
    file: 'src/tests/settings_paths.rs',
    reads: 'launch.rs',
    asserts: '"the EXE installer must open nothing on a silent run"',
    because: 'the installer is a binary crate with no library target, so nothing here can `use` it',
  },
  {
    file: 'src/tests/settings_paths.rs',
    reads: 'plan.rs',
    asserts: '"installer/src/plan.rs must name the app once"',
    because: 'the same crate, and the read takes the value rather than asserting a call',
  },
  {
    file: 'src/tests/settings_paths.rs',
    reads: 'plan.rs',
    asserts: '"installer/src/plan.rs must hold one table of extensions"',
    because: 'the same crate, and the read takes the value rather than asserting a call',
  },
  {
    file: 'src/tests/settings_paths.rs',
    reads: 'plan.rs',
    asserts: '"installer/src/plan.rs must hold one table of owned extensions"',
    because: 'the same crate, and the read takes the value rather than asserting a call',
  },
  {
    file: 'src/tests/updater.rs',
    reads: 'plan.rs',
    asserts: '"installer/src/plan.rs must name {name} once"',
    because: 'the same crate, and the read takes the value rather than asserting a call',
  },
  {
    file: 'src/tests/updater.rs',
    reads: 'exit.rs',
    asserts: '"installer/src/exit.rs must name {name} once"',
    because: 'the same crate, and the read takes the value rather than asserting a call',
  },
];

/** The body a read sits in, from the read to the end of its function. What the read exists to assert is in here or nowhere. */
function bodyAfter(source, at) {
  const rest = source.slice(at);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Faults in one test file, and which allowance rows this file's reads used.
 *
 * A row covers one read, not a shape other reads may take: it is taken out of `spare` as it is used, so a second read making the same assertion is refused rather than waved through.
 */
export function faults(name, source, spare = ALLOWED.slice()) {
  const problems = [];
  const used = [];
  for (const hit of source.matchAll(READ)) {
    const read = hit[1].split('/').pop();
    const body = bodyAfter(source, hit.index);
    const at = spare.findIndex((row) => row.file === name && row.reads === read && body.includes(row.asserts));
    if (at === -1) {
      problems.push(`${name} reads ${read} as text with \`${hit[0]}\` — move the subject into a function the test can call, the way the nine before it were moved, or give it a row in ALLOWED saying which limit it is`);
      continue;
    }
    used.push(spare[at]);
    spare.splice(at, 1);
  }
  return { problems, used };
}

/** Faults in the rows themselves: a row with no reason says nothing, and a row nothing uses is one that has gone quiet. */
export function rowFaults(rows, used) {
  const problems = [];
  for (const row of rows) {
    if (!row.because || !row.because.trim()) {
      problems.push(`the allowance for ${row.file} reading ${row.reads} carries no reason, and a reason is the whole of what a row is for`);
    }
    if (!used.includes(row)) {
      problems.push(`nothing in the four test trees makes the assertion the allowance for ${row.file} reading ${row.reads} was written for — that read is gone, so its row goes too`);
    }
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

const problems = [];
if (process.argv.includes('--check')) {
  const KEPT = ALLOWED[11];
  const STAND = [
    {
      name: 'a test reading a source file it has no allowance for',
      file: 'src/app/tests/somewhere.rs',
      source: 'let source = include_str!("../vaults.rs");\n    assert!(source.contains("something"));\n}\n',
      fails: true,
    },
    {
      name: 'a test reading a source file as bytes',
      file: 'src/app/tests/somewhere.rs',
      source: 'let source = include_bytes!("../vaults.rs");\n}\n',
      fails: true,
    },
    {
      name: 'a read reaching the same file from the library\'s tree',
      file: 'src/tests/somewhere.rs',
      source: 'let source = include_str!("../app/vaults.rs");\n    assert!(source.contains("something"));\n}\n',
      fails: true,
    },
    {
      name: 'a kept read, under its own row',
      file: KEPT.file,
      source: `let source = include_str!("../${KEPT.reads}");\n    assert!(${KEPT.asserts});\n}\n`,
      fails: false,
    },
    {
      name: 'a kept read whose assertion has gone',
      file: KEPT.file,
      source: `let source = include_str!("../${KEPT.reads}");\n    assert!(source.contains("something else"));\n}\n`,
      fails: true,
    },
    {
      name: "another test borrowing a kept read's own assertion",
      file: KEPT.file,
      source: `let source = include_str!("../${KEPT.reads}");\n    assert!(${KEPT.asserts});\n}\n`.repeat(2),
      fails: true,
    },
    {
      name: 'a test reading something that is not Rust',
      file: 'src/app/tests/somewhere.rs',
      source: 'let table = include_str!("../../design/icons.md");\n}\n',
      fails: false,
    },
  ];
  for (const stand of STAND) {
    const found = faults(stand.file, stand.source).problems;
    if (stand.fails && !found.length) problems.push(`this check passes ${stand.name}`);
    if (!stand.fails && found.length) problems.push(`this check refuses ${stand.name}: ${found[0]}`);
  }

  // A row with no reason, and a row nothing reads any more: both are faults in the table rather than in a test.
  const noReason = { file: 'src/app/tests/somewhere.rs', reads: 'vaults.rs', asserts: '"x"', because: '  ' };
  if (!rowFaults([noReason], [noReason]).length) problems.push('this check passes an allowance row whose reason is empty');
  if (rowFaults([KEPT], []).length !== 1) problems.push('this check passes an allowance row nothing in the trees reads for');
  if (rowFaults([KEPT], [KEPT]).length) problems.push('this check refuses an allowance row that is doing its job');
  console.log(`refusal: ${STAND.length} readings answered, and a row with no reason and a row nothing reads for both refused`);
}

const spare = ALLOWED.slice();
const used = [];
let read = 0;
for (const path of TREES.flatMap(files)) {
  const source = readFileSync(path, 'utf8');
  const name = relative(root, path).split('\\').join('/');
  const found = faults(name, source, spare);
  problems.push(...found.problems);
  used.push(...found.used);
  for (const _ of source.matchAll(READ)) read += 1;
}
problems.push(...rowFaults(ALLOWED, used));

if (problems.length) {
  console.error('a test holds its subject by reading its Rust source:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('What such a test holds is spelling. Every one of the ten before it passed with the behavior it named deleted.');
  process.exit(1);
}
console.log(`source as text: ${read} test reads of a Rust file across 4 test trees, every one a web view, a window, a builder chain, a Mac arm or a crate the tree cannot see, and every allowance still read for`);
