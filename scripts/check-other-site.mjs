#!/usr/bin/env node
// Whether the other published site's copies of the shared front-end files still say what this one's do. Both sites run one front end; the other checkout has no Rust and no harness, so a fix written here reaches it only when somebody carries it, and nothing noticed when somebody did not — its reading column stayed a fixed width for hours after this one's became the app's own measure, which drew its words hard against the left of the window.
//
//   node scripts/check-other-site.mjs          say what each shared file is, and what drifted
//   node scripts/check-other-site.mjs --check  exit 1 on drift (`just verify`)
//
// Every run first drives its own faults against trees written for it — a shared file changed on one side only, one missing from the other checkout, a row naming no file at all, and a file in a walked folder that no row names — because the comparison is skipped everywhere except this machine, and a check that is usually silent is one nobody would notice going blind.
//
// The table is a list of paths rather than a folder, so a file dropped in beside the ones it names is compared by nothing. The folders in FOLDERS are walked for exactly that: a file there that is not a document and has no row stops the build until somebody says what it is. That is how the documentation reader and its stylesheet forked while both their headers said they were shared verbatim.
//
// It compares what the code does rather than what the bytes are: this repository unwrapped its comments for `just check-wrapping` and the other copy kept the hard wraps, so a byte comparison reports eleven faults that are not faults. Comments, blank lines and line endings come out before anything is compared.
//
// The other checkout lives on this machine only, so this skips when it is not there and says which folder it looked in. That is the cost of the option taken: green in this repository's workflows while the two sites disagree. It runs on the machine both trees are edited from, which is the machine the carry is made on.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one table of what the app reads, asked rather than restated: the walk below has to know which files in a documentation folder are documents.
import { appExtensions } from './app-formats.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the other site's checkout sits on this machine, relative to this one. */
const OTHER = join(root, '..', '..', 'dharma', 'emptyguru');

// Every file both checkouts hold, and which of three things it is. `shared` must agree; `own` is that site's own writing and is never compared — `reader.js` draws its front page, with its own glossary names and its own failure sentence, so a carry would break it; `here` is this repository's alone and has no copy over there at all. Two folders are named, because the front end the two sites run is not all under `site/`: the documentation reader and its stylesheet sit one folder over and forked while their own headers said they were shared.
const FILES = [
  ['site/styles.css', 'shared'],
  ['site/reader.js', 'own'],
  ['site/fetches.js', 'shared'],
  ['site/pager.js', 'shared'],
  ['site/docs-nav.js', 'shared'],
  ['site/glossary.js', 'shared'],
  ['site/minimap.js', 'shared'],
  ['site/settings.js', 'shared'],
  ['site/anchors.js', 'shared'],
  ['site/outline.js', 'shared'],
  ['site/link-tooltip.js', 'shared'],
  ['site/blockquotes.js', 'shared'],
  ['site/codeblocks.js', 'shared'],
  ['site/speed-reader.js', 'shared'],
  ['site/leaftext-core.js', 'shared'],
  ['docs/docs.js', 'shared'],
  ['docs/docs.css', 'shared'],
  // Each site's own front page for its documentation: its own brand, its own words, and ninety-one lines apart on purpose.
  ['docs/index.html', 'own'],
  // This repository's own script, and no business of the other site's.
  ['docs/render-docs-check.mjs', 'here'],
];

// The folders walked for a file nobody wrote a row for. `FILES` is a list of paths rather than a folder, so a file dropped in beside the ones it names is compared by nothing and nothing says so.
const FOLDERS = ['docs'];

// Lines the two sites differ on for a reason, each with the reason. A shared file is allowed exactly these and nothing else, so the next real difference still fails.
const ALLOWED = [
  ['site/styles.css', /^(Arial,|'Segoe UI Emoji';)/, 'the other site sets Chinese faces in its body stack, which wraps that one declaration differently'],
];

/** What a file says, with comments, blank lines and line endings taken out. */
export function code(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '').trim())
    .filter(Boolean);
}

/** Whether a line the two sites disagree on is one they are allowed to disagree on. */
function excused(path, line) {
  return ALLOWED.some(([file, pattern]) => file === path && pattern.test(line));
}

/** What drifted between the two checkouts, one problem per line. Empty when they agree, or when the other checkout is not on this machine. */
export function drift(here, there) {
  const problems = [];
  for (const [path, kind] of FILES) {
    const a = join(here, path);
    const b = join(there, path);
    // Every row is checked for the file it names before anything is compared, whatever kind it is. A row naming nothing is a row doing nothing, and it reads exactly like a file being watched.
    if (!existsSync(a)) {
      problems.push(`${path} is in the table and not in this checkout, so nothing is comparing it`);
      continue;
    }
    if (kind === 'here') {
      if (existsSync(b)) problems.push(`${path} is in the table as this repository's alone and the other checkout has one too, so two files are being written and nothing says which is which`);
      continue;
    }
    if (kind === 'own') continue;
    if (!existsSync(b)) {
      problems.push(`${path} is in the table and not in the other checkout, so that site is drawing its pages without it`);
      continue;
    }
    const la = code(readFileSync(a, 'utf8'));
    const lb = code(readFileSync(b, 'utf8'));
    const onlyHere = la.filter((l) => !lb.includes(l) && !excused(path, l));
    const onlyThere = lb.filter((l) => !la.includes(l) && !excused(path, l));
    if (!onlyHere.length && !onlyThere.length) continue;
    const sample = (onlyHere[0] || onlyThere[0]).slice(0, 90);
    problems.push(
      `${path} says different things on the two sites — ${onlyHere.length} lines only here and ${onlyThere.length} only there, the first of them \`${sample}\`. Carry the change across, or give it a row in ALLOWED with the reason the two differ`
    );
  }
  return problems;
}

/** Every file in the walked folders of this checkout that no row names, one problem per line. Documents are what those folders are for and are skipped by the app's own table of what it reads; a folder is skipped because a page nested deeper is documentation too. */
export function unrowed(here, extensions) {
  const rowed = new Set(FILES.map(([path]) => path));
  const opens = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
  const problems = [];
  for (const folder of FOLDERS) {
    const at = join(here, folder);
    if (!existsSync(at)) {
      problems.push(`${folder}/ is walked for files no row names, and this checkout has no such folder`);
      continue;
    }
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory() || opens.test(entry.name)) continue;
      const path = `${folder}/${entry.name}`;
      if (rowed.has(path)) continue;
      problems.push(`${path} is not a document and no row says what it is, so nothing compares it and nothing says it should not be compared. Give it a row in FILES`);
    }
  }
  return problems;
}

/** Prove the comparison refuses the faults it exists for, against trees written for the purpose. A check nobody has watched fail is a check that passes on a broken tree. */
function selfTest() {
  const scratch = join(tmpdir(), `leaf-other-site-${process.pid}`);
  const a = join(scratch, 'here');
  const b = join(scratch, 'there');
  const extensions = ['md', 'xml'];
  try {
    for (const side of [a, b]) for (const folder of ['site', ...FOLDERS]) mkdirSync(join(side, folder), { recursive: true });
    for (const [path, kind] of FILES) {
      const body = kind === 'own' ? 'const own = 1;\n' : 'const shared = 1;\n';
      writeFileSync(join(a, path), body);
      if (kind !== 'here') writeFileSync(join(b, path), `/* wrapped\n   differently */\n${body}`);
    }
    if (drift(a, b).length) throw new Error('two trees whose code agrees were reported as drift');

    writeFileSync(join(b, 'site/reader.js'), 'const theirOwn = 2;\n');
    if (drift(a, b).length) throw new Error("a file the table calls that site's own was compared anyway");

    writeFileSync(join(b, 'site/pager.js'), 'const shared = 2;\n');
    const changed = drift(a, b);
    if (!changed.some((problem) => problem.startsWith('site/pager.js'))) throw new Error('a shared file changed on one side only was not refused');

    rmSync(join(b, 'site/pager.js'));
    if (!drift(a, b).some((problem) => problem.includes('not in the other checkout'))) throw new Error('a shared file missing from the other checkout was not refused');
    writeFileSync(join(b, 'site/pager.js'), 'const shared = 1;\n');

    // The fault the second folder was added for: a shared file that is not under `site/` and says something different on one side.
    writeFileSync(join(b, 'docs/docs.js'), 'const shared = 3;\n');
    if (!drift(a, b).some((problem) => problem.startsWith('docs/docs.js'))) throw new Error('a shared file outside site/ changed on one side only was not refused');
    writeFileSync(join(b, 'docs/docs.js'), 'const shared = 1;\n');

    // A row naming no file at all, whatever kind it is: the row does nothing and reads exactly like a file being watched.
    rmSync(join(a, 'docs/render-docs-check.mjs'));
    if (!drift(a, b).some((problem) => problem.startsWith('docs/render-docs-check.mjs'))) throw new Error("a row naming no file was not refused, and it is this repository's own rather than a shared one");
    writeFileSync(join(a, 'docs/render-docs-check.mjs'), 'const mine = 1;\n');

    // The walk: a file in a walked folder that is not a document and has no row.
    if (unrowed(a, extensions).length) throw new Error('a folder holding only rowed files and documents was reported');
    writeFileSync(join(a, 'docs/README.md'), '# A page\n');
    writeFileSync(join(a, 'docs/GLOSSARY.xml'), '<TEI/>\n');
    mkdirSync(join(a, 'docs/guide'), { recursive: true });
    writeFileSync(join(a, 'docs/guide/themes.md'), '# Themes\n');
    if (unrowed(a, extensions).length) throw new Error('a document, a second format and a folder of documents were asked for rows');
    writeFileSync(join(a, 'docs/stray.js'), 'const stray = 1;\n');
    if (!unrowed(a, extensions).some((problem) => problem.startsWith('docs/stray.js'))) throw new Error('a file that is not a document and has no row was not refused');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const check = process.argv.includes('--check');
  selfTest();
  const strays = unrowed(root, appExtensions(root));
  if (strays.length) {
    console.error('a file the two sites might share has no row saying so:');
    for (const problem of strays) console.error(`  ${problem}`);
    process.exit(check ? 1 : 0);
  }
  if (!existsSync(OTHER)) {
    console.log(`other site: skipped, no checkout at ${OTHER} — this comparison runs on the machine both trees are edited from`);
    process.exit(0);
  }
  const problems = drift(root, OTHER);
  if (problems.length) {
    console.error('the other site is running a different front end:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(check ? 1 : 0);
  }
  const shared = FILES.filter(([, kind]) => kind === 'shared').length;
  const own = FILES.filter(([, kind]) => kind === 'own').length;
  const mine = FILES.filter(([, kind]) => kind === 'here').length;
  console.log(
    `other site: ${shared} shared files saying the same thing on both, compared by what their code does rather than by their bytes, ${own} left alone as that site's own and ${mine} as this repository's alone, ${ALLOWED.length} line the two differ on for a written reason, and ${FOLDERS.map((folder) => folder + '/').join(' and ')} walked for a file that is not a document and has no row`
  );
}
