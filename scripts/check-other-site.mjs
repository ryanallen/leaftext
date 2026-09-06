#!/usr/bin/env node
// Whether the other published site's copies of the shared front-end files still say what this one's do. Both sites run one front end; the other checkout has no Rust and no harness, so a fix written here reaches it only when somebody carries it, and nothing noticed when somebody did not — its reading column stayed a fixed width for hours after this one's became the app's own measure, which drew its words hard against the left of the window.
//
//   node scripts/check-other-site.mjs          say what each shared file is, and what drifted
//   node scripts/check-other-site.mjs --check  exit 1 on drift (`just verify`)
//
// Every run drives its own faults against trees written for it — a shared file changed on one side only, one missing from the other checkout, a row naming no file at all, an exempt row with no reason beside it, third-party bytes differing by one byte, and a thing in a walked folder that no row names — because the comparison is skipped everywhere except this machine, and a check that is usually silent is one nobody would notice going blind.
//
// The table is a list of paths rather than a folder, so a file dropped in beside the ones it names is compared by nothing. The folders in FOLDERS are walked for exactly that: a thing there with no row stops the build until somebody says what it is. The walk and the rows are read whatever machine this runs on, so a file added with no answer beside it fails everywhere, including where the comparison below is skipped.
//
// It compares what the code does rather than what the bytes are: this repository unwrapped its comments for `just check-wrapping` and the other copy kept the hard wraps, so a byte comparison reports eleven faults that are not faults. Comments, blank lines and line endings come out before anything is compared. Third-party bytes are the one exception and are compared exactly, because a font has no code to read.
//
// The other checkout lives on this machine only, so this skips when it is not there and says which folder it looked in. That is the cost of the option taken: green in this repository's workflows while the two sites disagree. It runs on the machine both trees are edited from, which is the machine the carry is made on.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one table of what the app reads, asked rather than restated: the walk below has to know which files in a documentation folder are documents.
import { listedExtensions } from './app-formats.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the other site's checkout sits on this machine, relative to this one. */
const OTHER = join(root, '..', '..', 'dharma', 'emptyguru');

// Every thing both checkouts hold, which of four answers it is, and — where it is not `shared` — why not. `shared` must agree and is compared by what its code does. `own` is that site's own writing and is never compared. `here` is this repository's alone and must have no copy over there. `vendored` is third-party bytes neither site writes, compared exactly rather than by its code, a folder row covering every file under it. Four answers rather than two because one word cannot carry three meanings: `own` already means the other site's writing, and third-party bytes are neither that nor this site's alone. **The reason column is what the table is for** — a file exempt from the comparison with nothing beside it saying why is a decision nobody was asked to make. Two folders, because the front end the two sites run is not all under `site/`: the documentation reader and its stylesheet sit one folder over, beside the pages they draw.
const FILES = [
  ['site/styles.css', 'shared'],
  ['site/reader.js', 'own', "it draws each site's own front page, with its own glossary names and its own failure sentence, so a carry would break it"],
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
  ['site/pictures.js', 'here', "it puts a picture a browser cannot decode back to the PNG beside it, and the other site holds no picture of any kind, no page there asks for one, and it has no workflow, so nothing there could ever write the WebP the fallback exists for — a carry would put dead code in somebody else's repository to make a check green"],
  ['site/noto-fonts.css', 'vendored', 'a copy of the faces the app itself is compiled with, written here by `sync-vendor` and held to `src/assets` by `check-vendor` — nobody here writes a byte of it'],
  ['site/Noto-OFL.txt', 'vendored', 'the license the faces beside it ship under, carried word for word from `src/assets`'],
  ['site/vendor', 'vendored', 'mermaid, KaTeX and highlight.js as their authors published them — mostly copies of `src/assets/vendor` that `sync-vendor` writes, and all of them bytes neither site writes'],
  ['docs/docs.js', 'shared'],
  ['docs/docs.css', 'shared'],
  ['docs/index.html', 'own', 'each site draws its documentation front page in its own brand and its own words, ninety-one lines apart on purpose'],
  ['docs/render-docs-check.mjs', 'here', "this repository's own script, and no business of the other site's"],
];

/** The answers a row may carry, said back to whoever has to give one to a new file. */
const ANSWERS = ['shared', 'own', 'here', 'vendored'];

// The folders walked for a thing nobody wrote a row for, and how each is read. `documents` is a folder whose pages are what it is for, so a document and a folder of documents are passed over and everything else owes a row. `entries` is a folder that is all front end, so every entry owes one — a directory included, as a single row covering what is under it, because `site/vendor` is one decision and not twenty-four.
const FOLDERS = [
  ['docs', 'documents'],
  ['site', 'entries'],
];

// Lines the two sites differ on for a reason, each with the reason. A shared file is allowed exactly these and nothing else, so the next real difference still fails.
const ALLOWED = [
  ['site/styles.css', /^(Arial,|'Segoe UI Emoji'\);)/, 'the other site sets Chinese faces in its body stack, which wraps that one declaration differently'],
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

/** Every file under a path, named relative to it, or the empty name when the path is a file — so one row is read the same way whether it names a file or a folder. */
function filesUnder(at) {
  if (!statSync(at).isDirectory()) return [''];
  const found = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...filesUnder(join(at, entry.name)).map((one) => `${entry.name}/${one}`));
    else found.push(entry.name);
  }
  return found.sort();
}

/** The same bytes with the other machine's line endings taken out. Read one byte at a time so a font survives the round trip untouched. */
function unwound(bytes) {
  return Buffer.from(bytes.toString('binary').replace(/\r\n/g, '\n'), 'binary');
}

/** What differs between two copies of third-party bytes, compared exactly rather than by code, a folder row covering every file under it either side. A line ending is excused the way the code comparison excuses one: a checkout written out with the other machine's endings is not a different copy. */
function bytesDiffer(path, a, b) {
  const problems = [];
  const here = filesUnder(a);
  const there = filesUnder(b);
  for (const one of here) {
    const name = one ? `${path}/${one}` : path;
    if (!there.includes(one)) {
      problems.push(`${name} is third-party bytes this site carries and the other checkout has not, so the two sites are running different copies`);
      continue;
    }
    const mine = readFileSync(join(a, one));
    const theirs = readFileSync(join(b, one));
    if (mine.equals(theirs) || unwound(mine).equals(unwound(theirs))) continue;
    problems.push(`${name} is third-party bytes and the two copies are not the same — ${mine.length} bytes here and ${theirs.length} there. Run \`just sync-vendor\` and carry the result across, or say in its row why the two differ`);
  }
  for (const one of there) {
    if (!here.includes(one)) problems.push(`${path}/${one} is third-party bytes the other checkout carries and this one has not, so the two sites are running different copies`);
  }
  return problems;
}

/** What drifted between the two checkouts, one problem per line. Empty when they agree, or when the other checkout is not on this machine. */
export function drift(here, there) {
  const problems = [];
  for (const [path, kind] of FILES) {
    const a = join(here, path);
    const b = join(there, path);
    // A row naming nothing in this checkout is `unheld`'s to refuse and it runs first, so this only has to not read a file that is not there.
    if (!existsSync(a)) continue;
    if (kind === 'here') {
      if (existsSync(b)) problems.push(`${path} is in the table as this repository's alone and the other checkout has one too, so two files are being written and nothing says which is which`);
      continue;
    }
    if (kind === 'own') continue;
    if (!existsSync(b)) {
      problems.push(`${path} is in the table and not in the other checkout, so that site is drawing its pages without it`);
      continue;
    }
    if (kind === 'vendored') {
      problems.push(...bytesDiffer(path, a, b));
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

/** Every thing in the walked folders of this checkout that no row names, one problem per line. A documentation folder is walked for what is not a document, because documents are what it is for and a page nested deeper is documentation too; the front-end folder is walked whole, a directory counting as one entry rather than being descended into. */
export function unrowed(here, extensions) {
  const rowed = new Set(FILES.map(([path]) => path));
  const opens = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
  const problems = [];
  for (const [folder, reading] of FOLDERS) {
    const at = join(here, folder);
    if (!existsSync(at)) {
      problems.push(`${folder}/ is walked for things no row names, and this checkout has no such folder`);
      continue;
    }
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (reading === 'documents' && (entry.isDirectory() || opens.test(entry.name))) continue;
      const path = `${folder}/${entry.name}`;
      if (rowed.has(path)) continue;
      problems.push(`${path} has no row saying what it is, so nothing compares it and nothing says it should not be compared. Give it a row in FILES — ${ANSWERS.join(', ')} — with the reason beside it where it is not shared`);
    }
  }
  return problems;
}

/** Every row holding nothing: one naming a thing this checkout does not have, and one exempt from the comparison with no reason beside it. A row naming nothing reads exactly like a file being watched, and an exemption nobody wrote a reason for is the decision this table exists to record. */
export function unheld(here, files = FILES) {
  const problems = [];
  for (const [path, kind, reason] of files) {
    if (!existsSync(join(here, path))) problems.push(`${path} is in the table and not in this checkout, so the row is watching nothing`);
    if (kind !== 'shared' && !reason) problems.push(`${path} is in the table as \`${kind}\` and says nothing about why it is not compared, so the next reader has to guess and the row records no decision`);
  }
  return problems;
}

/** Prove the comparison refuses the faults it exists for, against trees written for the purpose. A check nobody has watched fail is a check that passes on a broken tree. */
function selfTest() {
  const scratch = join(tmpdir(), `leaf-other-site-${process.pid}`);
  const a = join(scratch, 'here');
  const b = join(scratch, 'there');
  const extensions = listedExtensions(root);
  try {
    // The trees are built from what the walked folders actually hold, never from `FILES`: a self-test that writes the list back out passes by agreeing with the list it is checking, which is the blindness this whole check exists to end.
    for (const side of [a, b]) {
      for (const [folder] of FOLDERS) {
        mkdirSync(join(side, folder), { recursive: true });
        for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
          const at = join(side, folder, entry.name);
          if (!entry.isDirectory()) {
            writeFileSync(at, 'const shared = 1;\n');
            continue;
          }
          mkdirSync(at, { recursive: true });
          writeFileSync(join(at, 'carried.woff2'), 'bytes\n');
        }
      }
    }
    for (const [path, kind] of FILES) {
      // A vendored row keeps the bytes the mirror wrote: it is compared exactly, so a wrapped comment is a real difference there rather than an excused one.
      if (kind === 'vendored') continue;
      const body = kind === 'own' ? 'const own = 1;\n' : 'const shared = 1;\n';
      writeFileSync(join(a, path), body);
      if (kind === 'here') rmSync(join(b, path), { force: true });
      else writeFileSync(join(b, path), `/* wrapped\n   differently */\n${body}`);
    }
    if (unrowed(a, extensions).length) throw new Error(`a walked folder holds something no row names: ${unrowed(a, extensions)[0]}`);
    if (unheld(a).length) throw new Error(`a tree holding every row was reported: ${unheld(a)[0]}`);
    if (drift(a, b).length) throw new Error(`two trees whose code agrees were reported as drift: ${drift(a, b)[0]}`);

    writeFileSync(join(b, 'site/reader.js'), 'const theirOwn = 2;\n');
    if (drift(a, b).length) throw new Error("a file the table calls that site's own was compared anyway");

    writeFileSync(join(b, 'site/pager.js'), 'const shared = 2;\n');
    if (!drift(a, b).some((problem) => problem.startsWith('site/pager.js'))) throw new Error('a shared file changed on one side only was not refused');

    rmSync(join(b, 'site/pager.js'));
    if (!drift(a, b).some((problem) => problem.includes('not in the other checkout'))) throw new Error('a shared file missing from the other checkout was not refused');
    writeFileSync(join(b, 'site/pager.js'), 'const shared = 1;\n');

    // The fault the second folder was added for: a shared file that is not under `site/` and says something different on one side.
    writeFileSync(join(b, 'docs/docs.js'), 'const shared = 3;\n');
    if (!drift(a, b).some((problem) => problem.startsWith('docs/docs.js'))) throw new Error('a shared file outside site/ changed on one side only was not refused');
    writeFileSync(join(b, 'docs/docs.js'), 'const shared = 1;\n');

    // The `here` answer has to exempt a file the other checkout does not have, or it exempts nothing — and refuse one it does have, which is two files being written with nothing saying which is which.
    if (drift(a, b).some((problem) => problem.startsWith('site/pictures.js'))) throw new Error("a file the table calls this repository's alone was refused for being absent from the other checkout");
    writeFileSync(join(b, 'site/pictures.js'), 'const theirs = 1;\n');
    if (!drift(a, b).some((problem) => problem.startsWith('site/pictures.js'))) throw new Error("a file the table calls this repository's alone was in the other checkout and was not refused");
    rmSync(join(b, 'site/pictures.js'));

    // Third-party bytes are compared exactly, so one byte is a fault — and a line ending is not, because a checkout written out with the other machine's endings is not a different copy.
    writeFileSync(join(b, 'site/Noto-OFL.txt'), 'const shared = 2;\n');
    if (!drift(a, b).some((problem) => problem.startsWith('site/Noto-OFL.txt'))) throw new Error('a vendored file differing by one byte was not refused');
    writeFileSync(join(b, 'site/Noto-OFL.txt'), 'const shared = 1;\r\n');
    if (drift(a, b).length) throw new Error('a vendored file differing only in its line endings was refused');
    writeFileSync(join(b, 'site/Noto-OFL.txt'), 'const shared = 1;\n');

    // A folder row covers every file under it, either side.
    writeFileSync(join(b, 'site/vendor/carried.woff2'), 'other bytes\n');
    if (!drift(a, b).some((problem) => problem.startsWith('site/vendor/carried.woff2'))) throw new Error('a file under a vendored folder differing on one side was not refused');
    writeFileSync(join(b, 'site/vendor/carried.woff2'), 'bytes\n');
    writeFileSync(join(b, 'site/vendor/extra.woff2'), 'bytes\n');
    if (!drift(a, b).some((problem) => problem.startsWith('site/vendor/extra.woff2'))) throw new Error('a file under a vendored folder that only the other checkout has was not refused');
    rmSync(join(b, 'site/vendor/extra.woff2'));

    // A row naming no file at all, whatever kind it is: the row does nothing and reads exactly like a file being watched.
    rmSync(join(a, 'docs/render-docs-check.mjs'));
    if (!unheld(a).some((problem) => problem.startsWith('docs/render-docs-check.mjs'))) throw new Error("a row naming no file was not refused, and it is this repository's own rather than a shared one");
    writeFileSync(join(a, 'docs/render-docs-check.mjs'), 'const mine = 1;\n');

    // A row exempt from the comparison with no reason beside it, which is the exemption nobody was asked to make.
    if (!unheld(a, [['site/pager.js', 'own']]).some((problem) => problem.includes('says nothing about why'))) throw new Error('a row exempt from the comparison with no reason beside it was not refused');
    if (unheld(a, [['site/pager.js', 'shared']]).length) throw new Error('a shared row was asked for a reason it does not owe');

    // The walk: a thing in a walked folder that no row names. A documentation folder passes over its documents and the folders of documents nested in it; the front-end folder passes over nothing, and a directory there is one entry owing its own row.
    writeFileSync(join(a, 'docs/scratch-page.md'), '# A page\n');
    writeFileSync(join(a, 'docs/scratch-page.xml'), '<TEI/>\n');
    mkdirSync(join(a, 'docs/scratch-guide'), { recursive: true });
    writeFileSync(join(a, 'docs/scratch-guide/themes.md'), '# Themes\n');
    if (unrowed(a, extensions).length) throw new Error('a document, a second format and a folder of documents were asked for rows');
    writeFileSync(join(a, 'docs/stray.js'), 'const stray = 1;\n');
    if (!unrowed(a, extensions).some((problem) => problem.startsWith('docs/stray.js'))) throw new Error('a file that is not a document and has no row was not refused');
    rmSync(join(a, 'docs/stray.js'));

    writeFileSync(join(a, 'site/stray.js'), 'const stray = 1;\n');
    if (!unrowed(a, extensions).some((problem) => problem.startsWith('site/stray.js'))) throw new Error('a file under site/ with no row was not refused');
    rmSync(join(a, 'site/stray.js'));
    writeFileSync(join(a, 'site/stray.md'), '# Not a document here\n');
    if (!unrowed(a, extensions).some((problem) => problem.startsWith('site/stray.md'))) throw new Error('a document-looking file under site/ was passed over, and nothing in that folder is a document');
    rmSync(join(a, 'site/stray.md'));
    mkdirSync(join(a, 'site/strays'), { recursive: true });
    if (!unrowed(a, extensions).some((problem) => problem.startsWith('site/strays'))) throw new Error('a folder under site/ with no row was not refused');
    rmSync(join(a, 'site/strays'), { recursive: true });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const check = process.argv.includes('--check');
  // The list is read against the folder before the self-test, because the self-test builds its trees from that same folder: a file with no row would otherwise stop it with a stack trace instead of the sentence saying which four answers it may be given.
  const strays = [...unrowed(root, listedExtensions(root)), ...unheld(root)];
  if (strays.length) {
    console.error('the table of shared files and the folders it is read against disagree:');
    for (const problem of strays) console.error(`  ${problem}`);
    process.exit(check ? 1 : 0);
  }
  selfTest();
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
  const counted = (kind) => FILES.filter(([, one]) => one === kind).length;
  console.log(
    `other site: ${counted('shared')} shared files saying the same thing on both, compared by what their code does rather than by their bytes, ${counted('vendored')} rows of third-party bytes compared exactly, ${counted('own')} left alone as that site's own and ${counted('here')} as this repository's alone — ${FILES.length} rows, ${ALLOWED.length} line the two differ on for a written reason, and ${FOLDERS.map(([folder]) => folder + '/').join(' and ')} walked for anything with no row at all`
  );
}
