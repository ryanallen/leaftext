#!/usr/bin/env node
// Which pictures the documentation asks for, and which of them are not there. A page that names a screenshot nobody ever took renders a broken frame at leaftext.com, and nothing else in the repo notices.
//
//   node scripts/doc-images.mjs           list every reference, missing ones last
//   node scripts/doc-images.mjs --missing just the missing ones, one per line
//   node scripts/doc-images.mjs --check   self-test the scanner, then exit 1 if any are missing (`just verify`)
//
// `--check` is in `just verify`. A gate that is red before anybody touches it stops being read, so the pictures a page asks for are taken in the same edit that names them.

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

// A picture named inside code — a fenced block or a `span` — is the shape of a line someone writes, not a file this repo has. The theming page shows an author how to add a preview image that way, and counting those as missing hides the real number behind noise nobody can clear.
function withoutCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

// Every picture one page asks for, and whether it is there. The page is what the path is resolved from, so the same `src` means different files on two pages.
function referencesIn(page, text) {
  const clean = withoutCode(text);
  // Markdown images, plus the `<img src>` a raw-HTML block can carry.
  const found = [
    ...clean.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g),
    ...clean.matchAll(/<img[^>]*\ssrc="([^"]+)"/g),
  ];
  const out = [];
  for (const [, src] of found) {
    if (/^(?:https?:|data:|#)/.test(src)) continue;
    const path = resolve(join(root, dirname(page)), src);
    out.push({
      page,
      src,
      path: relative(root, path).split('\\').join('/'),
      there: existsSync(path),
    });
  }
  return out;
}

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
  if (problems.length) {
    console.error('the scanner cannot be trusted to find a missing picture:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('scanner: finds a picture that is not there, and passes one that is, one written inside code, and one on another host');
}

const pages = ['README.md', ...markdownFiles('docs')];
const references = pages.flatMap((page) => referencesIn(page, readFileSync(join(root, page), 'utf8')));

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
