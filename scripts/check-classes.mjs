#!/usr/bin/env node
// Every class the stylesheet paints has to be accounted for, so a new part of the interface joins the design system instead of growing beside it.
//
//   node scripts/check-classes.mjs   report every unaccounted class (`just verify`)
//
// Three ways to account for one, all in design/components.md:
//
//   a component row       the interface. Needs a class family, what builds it, and the
//                         markup the gallery draws it with — so it appears on the page
//                         at leaftext.com/gallery.html by existing.
//   a document prefix     what the renderer writes into a rendered page: footnotes,
//                         alerts, syntax colors, a TEI header. Those are not parts of
//                         the app's own interface and have no state to show.
//   a state name          `is-selected`, `open`, `frameless`: a flag on something that
//                         is already listed, not a thing of its own.
//
// Anything else fails here, with the class and a line. That is the point: the answer to "where does this new panel go" cannot be "nowhere".

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleParts } from './reading-css.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A comment mentioning `block-controls.js` is not a class. Blank the comments, keeping each line's length so the line numbers still point at the right place. Each part of the stylesheet is read on its own, so a hit names the file a reader opens rather than a line in the concatenation.
const code = ruleParts().flatMap(({ path, css }) => {
  let inComment = false;
  return css.split('\n').map((line, index) => {
    let text = line;
    if (inComment) {
      const end = text.indexOf('*/');
      if (end < 0) return { path, n: index + 1, text: '' };
      text = ' '.repeat(end + 2) + text.slice(end + 2);
      inComment = false;
    }
    text = text.replace(/\/\*.*?\*\//g, (m) => ' '.repeat(m.length));
    const open = text.indexOf('/*');
    if (open >= 0) {
      inComment = true;
      text = text.slice(0, open);
    }
    // `[href*="GLOSSARY.md#"]` names a file, not a class.
    text = text.replace(/\[[^\]]*\]/g, (m) => ' '.repeat(m.length));
    return { path, n: index + 1, text };
  });
});

// The three tables in design/components.md.
const md = readFileSync(join(root, 'design/components.md'), 'utf8');
const components = [];
const documents = [];
const states = [];
let table = '';
for (const line of md.split('\n')) {
  if (line.startsWith('## ')) table = line.slice(3).trim().toLowerCase();
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (!cells.length || cells.some((c) => /^-{3,}$/.test(c))) continue;
  if (['Component', 'Prefix', 'Name'].includes(cells[0])) continue;
  if (table.startsWith('what a document')) documents.push(cells[0]);
  else if (table.startsWith('state')) states.push(cells[0]);
  else if (cells.length >= 4) {
    // A component owns its family, plus whatever other prefixes are its parts.
    const also = (cells[4] || '').split(/[,\s]+/).filter(Boolean);
    components.push([cells[1], ...also]);
  }
}
if (components.length < 20) throw new Error(`expected the component rows, got ${components.length}`);
if (!documents.length) throw new Error('design/components.md has no document-prefix table');

const owns = (prefix, cls) => cls === prefix || cls.startsWith(prefix + '-');
const accounted = (cls) =>
  components.some((prefixes) => prefixes.some((p) => owns(p, cls))) ||
  documents.some((p) => owns(p, cls)) ||
  states.includes(cls) ||
  /^(?:is|has|no)-/.test(cls);

const unaccounted = new Map();
for (const { path, n, text } of code) {
  for (const match of text.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
    const cls = match[1];
    if (accounted(cls) || unaccounted.has(cls)) continue;
    unaccounted.set(cls, { path, n });
  }
}

if (unaccounted.size) {
  console.error(`${unaccounted.size} class(es) nothing accounts for:`);
  for (const [cls, where] of unaccounted) console.error(`  ${where.path}:${where.n}  .${cls}`);
  console.error(
    'Add it to design/components.md: a component row (with the markup the gallery draws it\n' +
      'with), a document prefix if the renderer writes it into a page, or a state name.'
  );
  process.exit(1);
}
const counted = new Set();
for (const { text } of code) {
  for (const match of text.matchAll(/\.([a-z][a-z0-9-]*)/g)) counted.add(match[1]);
}
console.log(
  `classes: ${counted.size} accounted for — ${components.length} components, ` +
    `${documents.length} document prefixes, ${states.length} states`
);
