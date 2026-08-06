#!/usr/bin/env node
// Fail on a diagram drawn with box characters in any Markdown here or in the plan tree next door.
//
//   node scripts/check-ascii-art.mjs
//
// A drawn box comes out ragged in every renderer that matters — the app's own, GitHub's, an editor's — because none of them uses a fixed advance for the characters beside it, and it breaks outright the moment a label runs long. A wireframe in a ticket is what the owner reads to approve an interface, so it has to be a picture: `scripts/wireframe.mjs` writes one from an HTML sketch, using the browser already on the machine.
//
// Only the top-left corners `┌` and `╔` are refused. That is the mark of a hand-drawn frame and nothing else emits one — `cargo tree` output pasted into a ticket uses `└──` and `├──`, which are real evidence and stay.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TREES = [ROOT, resolve(ROOT, '..', 'docs')];
const SKIPPED = new Set(['node_modules', 'target', 'dist', '.git', 'vendor']);

/// The corner a hand-drawn frame opens with. Nothing else in this tree writes one.
const CORNERS = /[┌╔]/;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry) || entry.startsWith('.') && entry !== '.agents') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.md')) out.push(path);
  }
}

const files = [];
for (const tree of TREES) walk(tree, files);

const found = [];
for (const path of files) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      // Backticked, the character is the rule naming itself rather than somebody drawing with it.
      if (CORNERS.test(line.replace(/`[^`]*`/g, ''))) {
        found.push(`${relative(ROOT, path)}:${index + 1}`);
      }
    });
}

if (found.length) {
  console.error('A diagram drawn with box characters, which no renderer lines up:');
  found.forEach((where) => console.error(`  ${where}`));
  console.error('Draw it as HTML under ../docs/imgs/wireframes/ and run scripts/wireframe.mjs.');
  process.exit(1);
}
console.log(`ascii art: none in ${files.length} Markdown files — every diagram is a picture`);
