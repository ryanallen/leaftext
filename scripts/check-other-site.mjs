#!/usr/bin/env node
// Whether the other published site's copies of the shared front-end files still say what this one's do. Both sites run one front end; the other checkout has no Rust and no harness, so a fix written here reaches it only when somebody carries it, and nothing noticed when somebody did not — its reading column stayed a fixed width for hours after this one's became the app's own measure, which drew its words hard against the left of the window.
//
//   node scripts/check-other-site.mjs          say what each shared file is, and what drifted
//   node scripts/check-other-site.mjs --check  exit 1 on drift (`just verify`)
//
// Every run first drives its own two faults against trees written for it — a shared file changed on one side only, and a shared file missing from the other checkout — because the comparison is skipped everywhere except this machine, and a check that is usually silent is one nobody would notice going blind.
//
// It compares what the code does rather than what the bytes are: this repository unwrapped its comments for `just check-wrapping` and the other copy kept the hard wraps, so a byte comparison reports eleven faults that are not faults. Comments, blank lines and line endings come out before anything is compared.
//
// The other checkout lives on this machine only, so this skips when it is not there and says which folder it looked in. That is the cost of the option taken: green in this repository's workflows while the two sites disagree. It runs on the machine both trees are edited from, which is the machine the carry is made on.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the other site's checkout sits on this machine, relative to this one. */
const OTHER = join(root, '..', '..', 'dharma', 'emptyguru');

// Every file under `site/` both checkouts hold, and which of two things it is. `shared` must agree; `own` is that site's own writing and is never compared — `reader.js` draws its front page, with its own glossary names and its own failure sentence, so a carry would break it.
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
];

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
    if (kind === 'own') continue;
    const a = join(here, path);
    const b = join(there, path);
    if (!existsSync(a)) {
      problems.push(`${path} is in the table and not in this checkout, so nothing is comparing it`);
      continue;
    }
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

/** Prove the comparison refuses the two faults it exists for, against trees written for the purpose. A check nobody has watched fail is a check that passes on a broken tree. */
function selfTest() {
  const scratch = join(tmpdir(), `leaf-other-site-${process.pid}`);
  const a = join(scratch, 'here');
  const b = join(scratch, 'there');
  try {
    for (const side of [a, b]) mkdirSync(join(side, 'site'), { recursive: true });
    for (const [path, kind] of FILES) {
      const body = kind === 'own' ? 'const own = 1;\n' : 'const shared = 1;\n';
      writeFileSync(join(a, path), body);
      writeFileSync(join(b, path), `/* wrapped\n   differently */\n${body}`);
    }
    if (drift(a, b).length) throw new Error('two trees whose code agrees were reported as drift');

    writeFileSync(join(b, 'site/reader.js'), 'const theirOwn = 2;\n');
    if (drift(a, b).length) throw new Error("a file the table calls that site's own was compared anyway");

    writeFileSync(join(b, 'site/pager.js'), 'const shared = 2;\n');
    const changed = drift(a, b);
    if (!changed.some((problem) => problem.startsWith('site/pager.js'))) throw new Error('a shared file changed on one side only was not refused');

    rmSync(join(b, 'site/pager.js'));
    if (!drift(a, b).some((problem) => problem.includes('not in the other checkout'))) throw new Error('a shared file missing from the other checkout was not refused');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const check = process.argv.includes('--check');
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
  const shared = FILES.filter(([, kind]) => kind === 'shared').length;
  const own = FILES.length - shared;
  console.log(
    `other site: ${shared} shared files saying the same thing on both, compared by what their code does rather than by their bytes, ${own} left alone as that site's own, and ${ALLOWED.length} line the two differ on for a written reason`
  );
}
