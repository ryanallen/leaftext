#!/usr/bin/env node
// Which pictures the documentation asks for, and which of them are not there.
// A page that names a screenshot nobody ever took renders a broken frame at
// leaftext.com, and nothing else in the repo notices.
//
//   node scripts/doc-images.mjs           list every reference, missing ones last
//   node scripts/doc-images.mjs --missing just the missing ones, one per line
//   node scripts/doc-images.mjs --check   exit 1 if any are missing
//
// Not in `just verify`: the tree has a backlog of these, and a check that is red
// before anybody touches it stops being read. `/sync-docs` runs it instead.

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

// A picture named inside code — a fenced block or a `span` — is the shape of a
// line someone writes, not a file this repo has. The theming page shows an author
// how to add a preview image that way, and counting those as missing hides the real
// number behind noise nobody can clear.
function withoutCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

const pages = ['README.md', ...markdownFiles('docs')];
const references = [];
for (const page of pages) {
  const text = withoutCode(readFileSync(join(root, page), 'utf8'));
  // Markdown images, plus the `<img src>` a raw-HTML block can carry.
  const found = [
    ...text.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g),
    ...text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g),
  ];
  for (const [, src] of found) {
    if (/^(?:https?:|data:|#)/.test(src)) continue;
    const path = resolve(join(root, dirname(page)), src);
    references.push({
      page,
      src,
      path: relative(root, path).split('\\').join('/'),
      there: existsSync(path),
    });
  }
}

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
