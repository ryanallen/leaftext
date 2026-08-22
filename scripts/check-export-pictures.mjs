#!/usr/bin/env node
// An export that copies documents and nothing else publishes a folder whose every local picture is drawn as the app's own broken mark: a `.png` beside a note is never even seen. What travels is read off the render instead, and this holds that reading.
//
//   node scripts/check-export-pictures.mjs   fail when the reading changes shape (`just verify`)
//
// Offline on purpose: the whole export needs the WebAssembly module, which the gate never builds, so `just export-web` stays its own recipe and this is the half a gate can hold. It reads fixture markup in the shape the renderer emits — the same `<img>` a Markdown picture, a raw HTML tag and a diagram box all come out as.

import { picturesInRenderedHtml } from './site-pictures.mjs';

const CASES = [
  [
    'a Markdown picture beside its document',
    '<p><img src="source/notes/imgs/shot.png" alt="Shot"></p>',
    [{ address: 'source/notes/imgs/shot.png', file: 'notes/imgs/shot.png' }],
  ],
  [
    'a raw HTML tag, which the render has already resolved the same way',
    '<img src="source/imgs/raw.png" alt="Raw" width="4" height="4">',
    [{ address: 'source/imgs/raw.png', file: 'imgs/raw.png' }],
  ],
  [
    'a document at the top of the site, whose own folder is empty',
    '<p><img src="source/imgs/top.png" alt="Top"></p>',
    [{ address: 'source/imgs/top.png', file: 'imgs/top.png' }],
  ],
  ['an address the browser fetches for itself', '<img src="https://example.com/pic.png" alt="Remote">', []],
  ['one carrying its own bytes', '<img src="data:image/gif;base64,R0lGOD" alt="Inline">', []],
  ['a protocol-relative address, which is somebody else’s host too', '<img src="//example.com/pic.png" alt="Other">', []],
  ['a document with no picture in it at all', '<h1>Notes</h1><p>Words.</p>', []],
  [
    'the same picture named twice, which is one file to copy',
    '<img src="source/imgs/one.png" alt="A"><img src="source/imgs/one.png" alt="B">',
    [{ address: 'source/imgs/one.png', file: 'imgs/one.png' }],
  ],
  [
    'a name written with an entity in it, which is how the attribute is spelled and not how the file is',
    '<img src="source/imgs/a&amp;b.png" alt="Ampersand">',
    [{ address: 'source/imgs/a&b.png', file: 'imgs/a&b.png' }],
  ],
  [
    'every picture on the page, in the order the document names them',
    '<img src="source/imgs/two.png" alt="Two"><p>Words.</p><img src="source/notes/one.png" alt="One">',
    [
      { address: 'source/imgs/two.png', file: 'imgs/two.png' },
      { address: 'source/notes/one.png', file: 'notes/one.png' },
    ],
  ],
];

// An address with no file behind it is the export's own to count, not this reading's: what is asked for is read here, and whether the folder holds it is a question about the folder.
const problems = [];
for (const [name, html, expected] of CASES) {
  const found = picturesInRenderedHtml(html, 'source');
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    problems.push(`${name}: ${JSON.stringify(found)} where the export needs ${JSON.stringify(expected)}`);
  }
}

// The base is handed over rather than written in, because it is the same value the page is told and the two must not drift.
const elsewhere = picturesInRenderedHtml('<img src="files/imgs/shot.png" alt="Shot">', 'files');
if (elsewhere.length !== 1 || elsewhere[0].file !== 'imgs/shot.png') {
  problems.push(`a site serving its documents under another name read ${JSON.stringify(elsewhere)}`);
}

if (problems.length) {
  console.error('the export would not carry the pictures its documents ask for:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`export pictures: ${CASES.length + 1} readings, and every one names the file to copy and the address to copy it to`);
