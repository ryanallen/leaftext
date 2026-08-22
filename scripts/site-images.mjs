#!/usr/bin/env node
// The pictures the published pages serve, written as lossless WebP on the runner and named that way by the pages the deploy uploads. The site serves 61 paletted PNGs weighing 5,336 KB; the same pixels as lossless WebP weigh 3,318 KB, and every one of the 61 decodes back identical.
//
//   node scripts/site-images.mjs           name what a publish would write and rewrite
//   node scripts/site-images.mjs --write    encode every picture and move the pages onto it
//   node scripts/site-images.mjs --check    self-test the rewrite, offline (`just verify`)
//
// **Nothing here ever reaches the repository.** The masters stay PNG, so `scripts/capture-screenshot.ps1`, `scripts/compose-shots.mjs`, `scripts/check-shot-edges.mjs` and the app's own three hand-written PNG codecs never learn a second format. The publish writes a WebP beside each master and rewrites the pages in the workspace `actions/upload-pages-artifact` takes, the same way `scripts/site-assets.mjs` bakes the front page.
//
// The PNG stays beside the WebP in the deployed copy, so an address somebody has already linked to still answers.
//
// `index.html`, `docs/index.html` and everything `scripts/seo-gen.mjs` writes are left alone: both pages name `imgs/leaftext.png` as their `og:image` and `twitter:image`, and a social scraper is not the reader's browser.
//
// The references come from `scripts/doc-images.mjs`, which is the one scanner for what a page asks for. A second one would rewrite the two worked examples on the theming page into advice naming a file the author does not have.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentationPages, referencesIn } from './doc-images.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The one folder every picture the site serves lives in. */
export const PICTURE_DIR = 'imgs';

/** libwebp at full effort. Lossless beats the PNG on all 61 pictures and lossy comes out larger on the set, so there is one setting for every kind of picture. Method 6 is where the saving lives: method 0 leaves 1,372 KB of it on the table. */
export const ENCODE = ['-lossless', '-q', '100', '-m', '6'];

/** Every picture under `imgs/`, repo-relative. */
export function pictures(dir = PICTURE_DIR) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = posix.join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...pictures(rel));
    else if (name.endsWith('.png')) out.push(rel);
  }
  return out;
}

/** Whether a reference is one this converts: a PNG under the pictures folder. Anything else is left exactly as the page wrote it. */
export function convertible(path) {
  return path.startsWith(`${PICTURE_DIR}/`) && path.endsWith('.png');
}

/** The same address with a WebP ending. */
export function asWebp(path) {
  return path.replace(/\.png$/, '.webp');
}

/**
 * One page with every convertible reference moved onto its WebP, and the references that moved.
 *
 * The scanner says where each address sits, so the rewrite is a splice at those offsets rather than a search and replace — which is what keeps a picture named inside a code span or a fence spelled the way the author wrote it.
 */
export function rewritePage(page, text) {
  const moved = referencesIn(page, text)
    .filter((reference) => convertible(reference.path))
    .sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const reference of moved) {
    out += text.slice(at, reference.start) + asWebp(reference.src);
    at = reference.end;
  }
  return { text: out + text.slice(at), moved };
}

/**
 * Every reference a rewrite of this page would leave pointing at nothing.
 *
 * A page naming a picture nobody encoded is a broken frame, which is worse than the heavier picture this replaces — so the publish stops on one. Whether a picture is there is handed in rather than read, because the encoder only ever runs on the runner and this is the half `just verify` can prove.
 */
export function strandedIn(page, text, there = (path) => existsSync(join(root, path))) {
  return rewritePage(page, text)
    .moved.filter((reference) => !there(asWebp(reference.path)))
    .map((reference) => `${page} would name '${asWebp(reference.src)}' — no ${asWebp(reference.path)}`);
}

// The exports above are what `scripts/check-site.mjs` reads, so nothing below runs when it does.
if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  main();
}

function main() {
  if (process.argv.includes('--check')) return selfTest();
  if (process.argv.includes('--write')) return writePublished();
  return report();
}

/** What a publish would do, without doing any of it. */
function report() {
  const found = pictures();
  for (const picture of found) {
    console.log(`${existsSync(join(root, asWebp(picture))) ? 'wrote' : '  no '} ${asWebp(picture)}`);
  }
  let moved = 0;
  let pages = 0;
  for (const page of documentationPages()) {
    const count = rewritePage(page, readFileSync(join(root, page), 'utf8')).moved.length;
    if (!count) continue;
    moved += count;
    pages += 1;
  }
  console.log(`${found.length} pictures, and ${moved} references across ${pages} pages to move onto them`);
}

/** Encode every picture and move the pages onto the result. Both halves are held before either is written, so a publish that cannot finish leaves the pages exactly as they came out of the checkout. */
function writePublished() {
  const found = pictures();
  if (!found.length) {
    console.error(`there are no pictures under ${PICTURE_DIR}/, so the pages would be moved onto files nothing wrote`);
    process.exit(1);
  }

  let encoded = 0;
  let already = 0;
  let before = 0;
  let after = 0;
  for (const picture of found) {
    const webp = asWebp(picture);
    before += statSync(join(root, picture)).size;
    // A cache restored from an earlier run has already paid for this one. The key is the contents of the pictures folder, so a restored WebP is always the one this master would produce.
    if (existsSync(join(root, webp))) already += 1;
    else {
      try {
        execFileSync('cwebp', [...ENCODE, join(root, picture), '-o', join(root, webp)], { stdio: 'ignore' });
      } catch (error) {
        console.error(`cwebp could not write ${webp}: ${error.message}`);
        console.error('the encoder is libwebp at full effort, which the publish workflow installs with `sudo apt-get install -y webp`.');
        process.exit(1);
      }
      encoded += 1;
    }
    if (!existsSync(join(root, webp))) {
      console.error(`cwebp reported no fault and wrote no ${webp}`);
      process.exit(1);
    }
    after += statSync(join(root, webp)).size;
  }

  // Every page, rewritten in memory and held against the disk before a byte of it is written. A page naming a picture nobody encoded is a broken frame, and a broken frame is worse than the heavier picture this replaces.
  const problems = [];
  const rewritten = [];
  let moved = 0;
  for (const page of documentationPages()) {
    const source = readFileSync(join(root, page), 'utf8');
    const { text, moved: references } = rewritePage(page, source);
    if (!references.length) continue;
    problems.push(...strandedIn(page, source));
    moved += references.length;
    rewritten.push([page, text]);
  }

  if (problems.length) {
    console.error('the publish would deploy a page naming a picture nobody wrote:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  for (const [page, text] of rewritten) writeFileSync(join(root, page), text);

  const kb = (bytes) => Math.round(bytes / 1024).toLocaleString();
  console.log(
    `pictures: ${encoded} encoded and ${already} already written, ${kb(before)} KB of PNG served as ${kb(after)} KB of WebP, and ${moved} references across ${rewritten.length} pages moved onto them`
  );
}

/** The rewrite, read against the four things it must not do and the one it must. It needs no encoder and no network, which is why `just verify` can run it. */
function selfTest() {
  const problems = [];
  const rewrite = (text) => rewritePage('README.md', text).text;

  const plain = rewrite('![a](imgs/leaftext.png)\n');
  if (plain !== '![a](imgs/leaftext.webp)\n') problems.push(`a picture the page draws was not moved onto its WebP: ${JSON.stringify(plain)}`);

  const tag = rewrite('<img src="imgs/leaftext.png" alt="a">\n');
  if (tag !== '<img src="imgs/leaftext.webp" alt="a">\n') problems.push(`a picture drawn by a raw-HTML tag was not moved: ${JSON.stringify(tag)}`);

  const span = '`![a](imgs/leaftext.png)`\n';
  if (rewrite(span) !== span) problems.push('a picture named inside a code span was rewritten, and the theming page writes one to show an author the shape of the line');

  const fence = '```md\n![a](imgs/leaftext.png)\n```\n';
  if (rewrite(fence) !== fence) problems.push('a picture named inside a fenced block was rewritten, and the theming page writes one to show an author the shape of the line');

  const elsewhere = '![a](https://example.org/imgs/a.png)\n';
  if (rewrite(elsewhere) !== elsewhere) problems.push("a picture on somebody else's host was rewritten, and no file here could ever answer it");

  const outside = '![a](docs/not-a-shot.png)\n';
  if (rewrite(outside) !== outside) problems.push(`a PNG outside ${PICTURE_DIR}/ was rewritten, and nothing encodes one`);

  const mixed = 'One ![a](imgs/leaftext.png), a `![b](imgs/home.png)` span, then ![c](imgs/home.png).\n';
  if (rewrite(mixed) !== 'One ![a](imgs/leaftext.webp), a `![b](imgs/home.png)` span, then ![c](imgs/home.webp).\n') {
    problems.push(`a line carrying a drawn picture either side of a code span came out wrong: ${JSON.stringify(rewrite(mixed))}`);
  }

  // The refusal that stops a publish. The encoder never runs here, so the disk is stood in for: a run where every picture landed, and one where the last of them did not.
  const drawn = '![a](imgs/leaftext.png)\n';
  if (strandedIn('README.md', drawn, () => true).length) problems.push('a page was called broken over a picture that was written');
  const caught = strandedIn('README.md', drawn, () => false);
  if (caught.length !== 1 || !caught[0].includes('imgs/leaftext.webp')) {
    problems.push('a page naming a picture nobody wrote went uncounted, and the publish would deploy the broken frame');
  }

  // And the one thing that must be true of the real tree: every picture a page asks for is one this converts, so no page is left half moved.
  let asked = 0;
  const stranded = [];
  for (const page of documentationPages()) {
    for (const reference of referencesIn(page, readFileSync(join(root, page), 'utf8'))) {
      asked += 1;
      if (!convertible(reference.path)) stranded.push(`${page} asks for '${reference.src}', which is not a PNG under ${PICTURE_DIR}/`);
    }
  }
  problems.push(...stranded);

  if (problems.length) {
    console.error('the publish cannot be trusted to move the pages onto their WebP:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(
    `pictures: ${asked} references, every one a PNG under ${PICTURE_DIR}/, moved onto WebP where the page draws them, left alone inside a code span, inside a fence, on another host and outside ${PICTURE_DIR}/, and a page naming one nobody wrote stops the publish`
  );
}
