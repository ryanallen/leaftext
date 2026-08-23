#!/usr/bin/env node
// `AGENTS.md` calls the `## Source files` section of the architecture page the file map and sends a session to it the moment work reaches a source file. Nothing read it against the disk, and it went three modules short — a session that opened it for one of them learned nothing and went reading the tree, which is the whole cost the map exists to avoid.
//
//   node scripts/check-doc-modules.mjs   fail on a module the file map does not name (`just verify`)
//
// The pointer to the page is already held: `scripts/gate-rules.mjs` fails when `AGENTS.md` stops calling that page the file map. This is the other half — the page held to what is actually under `src/`.
//
// **The section is written two ways on purpose, so this cannot ask for one entry per file.** A single-file concern gets its own bold entry; a directory gets one entry whose prose names each sibling, and most modules in the tree are named only that way. Asking for an entry each would fail on scores of files that are working as written.
//
// So the mention is scoped rather than loose. A module counts as named when it appears in its own bold entry, or inside the bold entry for its directory, and a directory's entry covers that directory's own `mod.rs` — which is the section's own opening sentence, that a directory's `mod.rs` holds its shared vocabulary. The looser rule this replaced — a bare file name anywhere in the section — was measured passing `src/app/mod.rs`, which no line of the `src/app/` entry names: three other directories' entries carry the words `mod.rs` and covered for it.
//
// Two refusals, because they catch two different things:
//
//   a module with no mention   code was written and the map was not told, so the map now says
//                              that file does not exist.
//   a directory with no entry  a whole subject went in with nothing describing it, and every
//                              module under it would otherwise be reported one at a time.
//
// The three test trees are skipped rather than described: the section's own last entry already says where a test goes, so there is no second list anywhere of what counts as one.
//
// Both refusals are proved on made-up input before either real file is opened, so a matcher that quietly stops matching fails the build instead of passing everything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAGE = 'docs/02-development/01-architecture.md';
const SECTION = '## Source files';

/** The three test trees the section's own last entry names. Skipped rather than mapped. */
const TEST_TREES = ['src/tests/', 'src/app/tests.rs', 'src/store/tests.rs'];

// The tree has had scores of modules for its whole life. A count far off that means the walk stopped matching, not that the app shrank — and an empty walk would otherwise pass a page that named nothing.
const FEWEST_MODULES = 60;
const FEWEST_ENTRIES = 25;

/** Every `.rs` under `src/`, in posix spelling, outside the three test trees. */
function walkModules(from, at = 'src') {
  const found = [];
  for (const entry of readdirSync(join(from, at), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${at}/${entry.name}`;
    if (TEST_TREES.some((tree) => path === tree || path.startsWith(tree))) continue;
    if (entry.isDirectory()) found.push(...walkModules(from, path));
    else if (entry.name.endsWith('.rs')) found.push(path);
  }
  return found;
}

/** The bullets under `## Source files`: each one's subject — the backticked path its bold lead opens with — and the whole line, which is the whole entry, since `just check-wrapping` refuses a paragraph broken across lines anywhere in this tree. */
function sectionEntries(markdown) {
  const at = markdown.indexOf(`\n${SECTION}\n`);
  if (at === -1) throw new Error(`${PAGE} no longer has a ${SECTION} heading`);
  const rest = markdown.slice(at + SECTION.length + 2);
  const end = rest.search(/^## /m);
  const body = end === -1 ? rest : rest.slice(0, end);
  return [...body.matchAll(/^- \*\*`([^`]+)`\*\*.*$/gm)].map((m) => ({ subject: m[1], text: m[0] }));
}

/** The directory a module sits in, with its trailing slash: `src/app/link_preview.rs` gives `src/app/`. */
function directoryOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** What is wrong with a given set of modules and a given set of entries. Pure, so the refusals can be proved on input nobody has to keep in step. */
function problems(modules, entries) {
  const found = [];
  const bySubject = new Map(entries.map((entry) => [entry.subject, entry.text]));

  // A directory with nothing describing it is reported once, rather than as one failure per module under it.
  const missingDirectories = new Set();
  for (const path of modules) {
    const directory = directoryOf(path);
    if (directory === 'src/' || bySubject.has(directory)) continue;
    missingDirectories.add(directory);
  }
  for (const directory of [...missingDirectories].sort()) {
    const held = modules.filter((path) => directoryOf(path) === directory).length;
    found.push(`${directory} holds ${held} module(s) and has no entry at all — a directory gets one entry whose prose names each of its siblings`);
  }

  for (const path of modules) {
    if (bySubject.has(path)) continue;
    const directory = directoryOf(path);
    if (directory === 'src/') {
      found.push(`${path} has no entry of its own, and nothing describes the root of the tree — a module directly under src/ gets its own bold entry`);
      continue;
    }
    const entry = bySubject.get(directory);
    if (entry === undefined) continue; // Already reported as a directory with no entry.
    const name = path.slice(directory.length);
    // The section's own opening sentence: a directory's `mod.rs` holds its shared vocabulary, and the directory's entry is what describes that.
    if (name === 'mod.rs') continue;
    if (entry.includes(`\`${name}\``) || entry.includes(`\`${path}\``)) continue;
    found.push(`${path} is named neither in an entry of its own nor inside the entry for ${directory} — name it in that entry's prose, beside the siblings it sits with`);
  }
  return found;
}

// ---- the refusals, on made-up input -----------------------------------------

function selfTest() {
  const broken = [];
  const page = [
    '# A made-up page',
    '',
    SECTION,
    '',
    'A sentence that is not an entry.',
    '',
    '- **`src/alpha.rs`** — its own entry.',
    '- **`src/thing/`** — a directory. `one.rs` is named here, and so is `two.rs`.',
    '- **`src/other/`** — another directory, which happens to mention `stray.rs`.',
    '',
    '## Somewhere else',
    '',
    '- **`src/beyond.rs`** — past the section, so it is not an entry.',
    '',
  ].join('\n');

  const entries = sectionEntries(page);
  if (entries.map((entry) => entry.subject).join(',') !== 'src/alpha.rs,src/thing/,src/other/') {
    broken.push(`the section reader found ${JSON.stringify(entries.map((entry) => entry.subject))} — it has either stopped matching a bullet or run past the section`);
  }

  const clean = problems(['src/alpha.rs', 'src/thing/mod.rs', 'src/thing/one.rs', 'src/thing/two.rs'], entries);
  if (clean.length) broken.push(`a tree the page describes was called wrong: ${clean.join('; ')}`);

  // 1. A module named nowhere at all.
  if (!problems(['src/thing/three.rs'], entries).some((one) => one.includes('src/thing/three.rs is named neither'))) {
    broken.push('a module named nowhere passed');
  }
  // 2. A module named only inside another directory's entry — the fault the loose rule let through.
  if (!problems(['src/thing/stray.rs'], entries).some((one) => one.includes('src/thing/stray.rs is named neither'))) {
    broken.push("a module named only inside another directory's entry passed");
  }
  // 3. A directory with no entry at all, reported once rather than per module.
  const undescribed = problems(['src/nowhere/one.rs', 'src/nowhere/two.rs'], entries);
  if (!undescribed.some((one) => one.startsWith('src/nowhere/ holds 2 module(s)'))) {
    broken.push('a directory with no entry passed');
  }
  if (undescribed.length !== 1) {
    broken.push(`a directory with no entry was reported ${undescribed.length} times instead of once`);
  }
  // 4. A `mod.rs` is covered by its directory's own entry, which is the section's own convention.
  if (problems(['src/thing/mod.rs'], entries).length) {
    broken.push("a directory's own mod.rs was refused, though the directory's entry is what describes it");
  }
  // 5. A module at the root of the tree owes an entry of its own, since nothing describes `src/`.
  if (!problems(['src/loose.rs'], entries).some((one) => one.includes('nothing describes the root of the tree'))) {
    broken.push('a root module with no entry of its own passed');
  }
  return broken;
}

const broken = selfTest();
if (broken.length) {
  console.error('check-doc-modules cannot check anything — its own matchers are wrong:');
  for (const one of broken) console.error(`  ${one}`);
  process.exit(1);
}

const modules = walkModules(root);
if (modules.length < FEWEST_MODULES) {
  console.error(`only ${modules.length} modules came off src/, and the tree has never had fewer than ${FEWEST_MODULES}.`);
  console.error('The walk has stopped matching, so this check would pass a page that named nothing.');
  process.exit(1);
}

const entries = sectionEntries(readFileSync(join(root, PAGE), 'utf8'));
if (entries.length < FEWEST_ENTRIES) {
  console.error(`only ${entries.length} entries came off ${SECTION} in ${PAGE}, and it has never had fewer than ${FEWEST_ENTRIES}.`);
  console.error('The section reader has stopped matching, so this check would refuse the whole tree.');
  process.exit(1);
}

const found = problems(modules, entries);
if (found.length) {
  console.error(`${found.length} module(s) the file map does not name:`);
  for (const one of found) console.error(`  ${one}`);
  console.error(`The map is ${SECTION} in ${PAGE}, and AGENTS.md sends a session to it the moment work reaches a source file. A module missing from it reads as a module that does not exist.`);
  process.exit(1);
}

const directories = new Set(modules.map((path) => directoryOf(path)).filter((directory) => directory !== 'src/'));
console.log(
  `doc modules: ${modules.length} modules under src/ outside the three test trees, every one named in its own entry ` +
    `or inside the entry for its directory, across ${entries.length} entries and ${directories.size} described directories`
);
