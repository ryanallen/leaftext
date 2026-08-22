#!/usr/bin/env node
// Which pictures the documentation asks for, and which of them are not there. A page that names a screenshot nobody ever took renders a broken frame at leaftext.com, and nothing else in the repo notices.
//
//   node scripts/doc-images.mjs           list every reference, missing ones last
//   node scripts/doc-images.mjs --missing just the missing ones, one per line
//   node scripts/doc-images.mjs --check   self-test the scanner, then exit 1 if any are missing (`just verify`)
//
// `--check` is in `just verify`. A gate that is red before anybody touches it stops being read, so the pictures a page asks for are taken in the same edit that names them.
//
// `referencesIn` and `documentationPages` are exported because `scripts/site-images.mjs` rewrites the same references at publish time. One scanner, so a picture named inside a code fence stays the shape of a line an author writes rather than becoming advice naming a file they do not have.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function markdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = posix.join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...markdownFiles(rel));
    else if (name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Every page the site serves as a document, front page first. */
export function documentationPages() {
  return ['README.md', ...markdownFiles('docs')];
}

// A picture named inside code — a fenced block or a `span` — is the shape of a line someone writes, not a file this repo has. The theming page shows an author how to add a preview image that way, and counting those as missing hides the real number behind noise nobody can clear.
//
// Blanked to spaces rather than cut out, so every offset below is an offset into the page as it sits on disk. That is what lets the publish rewrite a reference in place, and it also stops a code span joining the text either side of it into a match neither half made.
function withoutCode(text) {
  const blank = (run) => run.replace(/[^\n]/g, ' ');
  return text.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

// Every picture one page asks for, and whether it is there. The page is what the path is resolved from, so the same `src` means different files on two pages. `start` and `end` bound the address itself in the original text.
export function referencesIn(page, text) {
  const clean = withoutCode(text);
  // Markdown images, plus the `<img src>` a raw-HTML block can carry.
  const found = [
    ...clean.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g),
    ...clean.matchAll(/<img[^>]*\ssrc="([^"]+)"/g),
  ];
  const out = [];
  for (const match of found) {
    const src = match[1];
    if (/^(?:https?:|data:|#)/.test(src)) continue;
    const path = resolve(join(root, dirname(page)), src);
    const start = match.index + match[0].lastIndexOf(src);
    out.push({
      page,
      src,
      path: relative(root, path).split('\\').join('/'),
      there: existsSync(path),
      start,
      end: start + src.length,
    });
  }
  return out;
}

// The two exports above are what `scripts/site-images.mjs` imports, so nothing below runs when it does.
if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  main();
}

function main() {
  if (process.argv.includes('--check')) {
    // A check that cannot fail is not a check: the hole this gate exists to catch, and the three things that are not one.
    const problems = [];
    const gone = referencesIn('README.md', '![a](imgs/no-such-picture.png)');
    if (gone.length !== 1 || gone[0].there) problems.push('a reference to a picture that is not there went uncounted, which is the whole fault this refuses');
    const here = referencesIn('README.md', '<img src="imgs/leaftext.png">');
    if (here.length !== 1 || !here[0].there) problems.push('a reference to a picture that is there was called missing');
    if (referencesIn('README.md', '`![a](imgs/no-such-picture.png)`').length) {
      problems.push('a picture named inside code was counted, and the theming page writes one to show an author the shape of the line');
    }
    if (referencesIn('README.md', '![a](https://example.org/a.png)').length) {
      problems.push("a picture on somebody else's host was counted, and no file here could ever answer it");
    }
    const placed = '# A page\n\n![a](imgs/leaftext.png)\n';
    const [only] = referencesIn('README.md', placed);
    if (!only || placed.slice(only.start, only.end) !== 'imgs/leaftext.png') {
      problems.push('the address a reference was found at did not sit where the scanner said, and the publish rewrites a page by those two numbers');
    }
    if (problems.length) {
      console.error('the scanner cannot be trusted to find a missing picture:');
      for (const problem of problems) console.error(`  ${problem}`);
      process.exit(1);
    }
    console.log('scanner: finds a picture that is not there, and passes one that is, one written inside code, and one on another host, and says where each address sits');
  }

  const references = documentationPages().flatMap((page) => referencesIn(page, readFileSync(join(root, page), 'utf8')));

  const missing = references.filter((r) => !r.there);

  if (process.argv.includes('--missing')) {
    for (const { page, src, path } of missing) console.log(`${page}\t${src}\t${path}`);
  } else {
    const byPage = new Map();
    for (const r of missing) {
      if (!byPage.has(r.page)) byPage.set(r.page, []);
      byPage.get(r.page).push(r);
    }
    console.log(`${references.length} pictures asked for, ${missing.length} not there`);
    for (const [page, rows] of byPage) {
      console.log(`  ${page}`);
      for (const { src, path } of rows) console.log(`    ${src}  ->  ${path}`);
    }
  }

  if (process.argv.includes('--check') && missing.length) process.exit(1);
}
