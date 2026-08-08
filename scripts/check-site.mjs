#!/usr/bin/env node
// The published pages fetch files by path, and a wrong path is a 404 nobody sees until the page is live — the front page's glossary sheet asked the site root for a file that has only ever lived in docs/.
//
//   node scripts/check-site.mjs   fail on a fetched path with no file
//
// Each entry page's own folder is the base, read off the <script> tag it loads, so the page saying where the file is and the file being there cannot drift. Only literal paths can be checked; a path built at runtime is skipped.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLink } from '../site/link-tooltip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The pages a browser opens, and the module each one boots.
const PAGES = ['index.html', 'docs/index.html'];

// Paths the page is written to do without. Each is tried and its failure handled, so a missing file is the normal case rather than a broken page.
const OPTIONAL = new Set([
  'README.xml', // the front page reads a TEI README if one is served instead
]);

// A fetched document, and the glossary the sheet and the auto-linker load.
const PATTERNS = [
  /fetch\(\s*'([^']+)'/g,
  /glossaryUrl:\s*'([^']+)'/g,
  /glossaryUrl:\s*\[([^\]]+)\]/g,
];

function entryScript(page) {
  const html = readFileSync(join(root, page), 'utf8');
  const tag = /<script[^>]+src="([^"]+\.js)"/.exec(html);
  if (!tag) throw new Error(`${page} loads no module`);
  return posix.join(posix.dirname(page.split('\\').join('/')), tag[1]);
}

// The scripts one page's module pulls in, so a path written in a shared helper is still checked against the page that supplies it. One level is all we need.
function localImports(script) {
  const source = readFileSync(join(root, script), 'utf8');
  const base = posix.dirname(script);
  return [...source.matchAll(/from\s+'(\.[^']+\.js)'/g)].map((m) => posix.join(base, m[1]));
}

const problems = [];
let checked = 0;
for (const page of PAGES) {
  const script = entryScript(page);
  const base = posix.dirname(page.split('\\').join('/'));
  for (const file of [script, ...localImports(script)]) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        for (const raw of match[1].split(',')) {
          const path = raw.trim().replace(/^'|'$/g, '');
          // Runtime-built paths and anything off this site cannot be checked.
          if (!/^\.{0,2}[\w./-]+\.(md|xml|json|txt)$/.test(path)) continue;
          checked += 1;
          const onDisk = posix.normalize(posix.join(base, path));
          if (OPTIONAL.has(onDisk)) continue;
          if (!existsSync(join(root, onDisk))) {
            problems.push(`${file} (loaded by ${page}) fetches '${path}' — no ${onDisk}`);
          }
        }
      }
    }
  }
}

// And what the hover card says about a pager button. The href is a `#/route`, so the in-page-jump branch answers it unless the page the pager stamped on the button is read ahead of everything — which is a thing nothing else here runs the site's script to find out.
const anchor = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null) });
const pager = describeLink(anchor({ href: '#/reading/002-rains', 'data-pager-title': 'The Rains Retreat' }));
if (pager.kind !== 'The Rains Retreat') problems.push(`a pager button's card calls it '${pager.kind}', not the page it opens`);
if (pager.detail !== '#/reading/002-rains') problems.push(`a pager button's card lost its address: '${pager.detail}'`);
const jump = describeLink(anchor({ href: '#a-heading' }));
if (jump.kind !== 'In-page jump') problems.push(`an ordinary fragment link became '${jump.kind}'`);

if (problems.length) {
  console.error('the published pages ask for files that are not there:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('a path in a shared helper is relative to the page that loads it, not to the helper.');
  process.exit(1);
}
console.log(`site: ${checked} fetched paths across ${PAGES.length} pages, every one a file, and a pager button's card names its page`);
