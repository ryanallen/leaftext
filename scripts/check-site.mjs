#!/usr/bin/env node
// The published pages fetch files by path, and a wrong path is a 404 nobody sees until the page is live — the front page's glossary sheet asked the site root for a file that has only ever lived in docs/.
//
//   node scripts/check-site.mjs   fail on a fetched path with no file
//
// Each entry page's own folder is the base, read off the <script> tag it loads, so the page saying where the file is and the file being there cannot drift. Only literal paths can be checked; a path built at runtime is skipped.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLink } from '../site/link-tooltip.js';
import { discoveryFiles } from './seo-gen.mjs';
import { ASSET_DIR, FRONT_PAGE, MODULE_PATH, PUBLISHED, bakeFrontPage, frontPageIsEmpty } from './site-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The pages a browser opens, and the module each one boots.
const PAGES = ['index.html', 'docs/index.html'];

// Paths the page is written to do without. Each is tried and its failure handled, so a missing file is the normal case rather than a broken page.
const OPTIONAL = new Set([
  'README.xml', // the front page reads a TEI README if one is served instead
]);

// A fetched document, and the glossary the sheet and the auto-linker load. Every page fetch goes through the watchdog in site/fetches.js, so the name is read with its ending open — a renamed call must not quietly stop a path being checked.
const PATTERNS = [
  /fetch\w*\(\s*'([^']+)'/g,
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

// Every address a discovery file names has to be one a crawler can fetch. A fragment never reaches the server, so 18 doc routes shipped in the sitemap all answering with the same empty shell.
const origin = 'https://' + readFileSync(join(root, 'CNAME'), 'utf8').trim();

// The file the static host serves for an address: a folder serves its index.html, everything else is the path itself. Anything off this site cannot be checked.
function fileFor(url) {
  if (!url.startsWith(origin + '/')) return null;
  const path = url.slice(origin.length + 1);
  return path === '' || path.endsWith('/') ? path + 'index.html' : path;
}

const read = (name) => readFileSync(join(root, name), 'utf8');
const matches = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]);
const sitemapUrls = matches(read('sitemap.xml'), /<loc>([^<]+)<\/loc>/g);
const advertised = [
  ['sitemap.xml', sitemapUrls],
  ['sitemap-md.txt', read('sitemap-md.txt').split('\n').filter(Boolean)],
  ['llms.txt', matches(read('llms.txt'), /\]\((https?:[^)]+)\)/g)],
  ['llms-full.txt', matches(read('llms-full.txt'), /^- (?:Page|Markdown): (\S+)$/gm)],
];

for (const url of sitemapUrls) {
  if (url.includes('#')) problems.push(`sitemap.xml advertises '${url}' — the server only ever sees '${url.split('#')[0]}'`);
}
let addresses = 0;
for (const [name, urls] of advertised) {
  for (const url of urls) {
    const file = fileFor(url);
    if (!file) continue;
    addresses += 1;
    if (!existsSync(join(root, file))) problems.push(`${name} advertises '${url}' — no ${file}`);
  }
}

// An entry page answers with a shell, so it has to name its own Markdown twice: in the head for a machine, in a `noscript` block for a body read without the script. An AI given the shell and neither guessed at a hostname that does not exist and gave up.
const INDEXES = ['llms.txt', 'llms-full.txt'];
for (const page of PAGES) {
  const html = read(page);
  const base = posix.dirname(page.split('\\').join('/'));
  const resolve = (href) => posix.normalize(posix.join(base, href));
  const source = /<link[^>]*\brel="alternate"[^>]*\btype="text\/markdown"[^>]*\bhref="([^"]+)"/.exec(html);
  if (!source) problems.push(`${page} names no Markdown source — a fetcher gets the loading shell and nothing else`);
  const alternates = matches(html, /<link[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/g);
  for (const index of INDEXES) {
    if (!alternates.some((href) => resolve(href) === index)) problems.push(`${page} has no alternate link to ${index}`);
  }
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
  if (!noscript) problems.push(`${page} has no noscript block, so a reader without the script is handed a blank page`);
  // A waiting line is a promise about a thing the page cannot see the end of: the connection it is waiting on may never finish and never fail, and then the line stands for ever over a page that is never drawn. The status element stays and speaks only when something failed.
  if (/Loading/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) problems.push(`${page} carries a waiting line, which is a promise it cannot keep when a connection stalls — the status element speaks only when something failed`);
  const links = [...alternates, ...(noscript ? matches(noscript[1], /<a[^>]*\bhref="([^"]+)"/g) : [])];
  for (const href of links) {
    const file = resolve(href);
    addresses += 1;
    if (!existsSync(join(root, file))) problems.push(`${page} points at '${href}' — no ${file}`);
  }
}

// Nothing regenerates the discovery files but somebody remembering to, so run the generator here and hold the committed files to it. Dates are left out: a `<lastmod>` is a file's last commit date, which the commit that changes the file cannot know in advance.
const undated = (text) =>
  text
    .split('\n')
    .filter((line) => !line.includes('<lastmod>'))
    .join('\n');
const names = (lines) => lines.filter((line) => line.trim()).slice(0, 3).join(', ') || 'nothing';
for (const [name, body] of Object.entries(discoveryFiles().files)) {
  const committed = undated(read(name)).split('\n');
  const fresh = undated(body).split('\n');
  const was = new Set(committed);
  const now = new Set(fresh);
  const gained = fresh.filter((line) => !was.has(line));
  const lost = committed.filter((line) => !now.has(line));
  if (!gained.length && !lost.length) continue;
  problems.push(`${name} is stale — it should gain ${names(gained)} and lose ${names(lost)}`);
}

// And what the hover card says about a pager button. The href is a `#/route`, so the in-page-jump branch answers it unless the page the pager stamped on the button is read ahead of everything — which is a thing nothing else here runs the site's script to find out.
const anchor = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null) });
const pager = describeLink(anchor({ href: '#/reading/002-rains', 'data-pager-title': 'The Rains Retreat' }));
if (pager.kind !== 'The Rains Retreat') problems.push(`a pager button's card calls it '${pager.kind}', not the page it opens`);
if (pager.detail !== '#/reading/002-rains') problems.push(`a pager button's card lost its address: '${pager.detail}'`);
const jump = describeLink(anchor({ href: '#a-heading' }));
if (jump.kind !== 'In-page jump') problems.push(`an ordinary fragment link became '${jump.kind}'`);

// ---- the renderer the publish builds ---------------------------------------
//
// The module and the stylesheet are the two files on this site that are not in it: the publish workflow builds them and serves them beside the pages, so nothing generated ever enters the tree. That leaves two ways for the pages to end up fetching nothing — a page naming a path the build does not write, and the build being taken out of the publish — and neither shows up until the site is live. Both are read here instead. The workflow itself ships unproven, the way every workflow in this repo does; this is the half that can be proved with nothing running.

const published = new Set(PUBLISHED);

/** Every file a browser is served from this repo, so a path written in any of them is checked wherever it was written. */
function siteSources() {
  const found = new Set(PAGES);
  for (const folder of ['site', 'docs']) {
    for (const name of readdirSync(join(root, folder))) {
      if (/\.(js|css|html)$/i.test(name)) found.add(`${folder}/${name}`);
    }
  }
  return [...found];
}

let named = 0;
for (const file of siteSources()) {
  for (const match of readFileSync(join(root, file), 'utf8').matchAll(new RegExp(`${ASSET_DIR}/[\\w.-]+`, 'g'))) {
    named += 1;
    if (!published.has(match[0])) {
      problems.push(`${file} fetches '${match[0]}' — the publish writes ${PUBLISHED.join(', ')} and nothing else`);
    }
  }
}

// The module is fetched by a path the page builds at runtime out of the folder it names in its head, so the literal scan above cannot see it. Read that folder and try the file against it, which is the same arithmetic `site/leaftext-core.js` does.
for (const page of PAGES) {
  const html = readFileSync(join(root, page), 'utf8');
  const meta = /<meta[^>]*\bname="leaftext-renderer"[^>]*\bcontent="([^"]+)"/.exec(html);
  if (!meta) {
    problems.push(`${page} says nowhere the renderer is, so it loads no reader at all`);
    continue;
  }
  const folder = meta[1].replace(/^\/+|\/+$/g, '');
  // Another site naming this one across origins is answered by that site's own check, not this one.
  if (/^[a-z][a-z0-9+.-]*:/i.test(folder)) continue;
  named += 1;
  const wanted = `${folder}/${MODULE_PATH.split('/').pop()}`;
  if (!published.has(wanted)) {
    problems.push(`${page} loads its renderer from '${meta[1]}' — the publish writes ${MODULE_PATH}`);
  }
}

// The front page is the one published file that is also a committed one: the repository keeps it empty and the publish writes the document into the workspace copy the deploy uploads. Both halves are read here, because a baked page committed by hand would go stale the moment the README changed and nobody would see it until a reader met yesterday's words.
if (!frontPageIsEmpty(read(FRONT_PAGE))) {
  problems.push(`${FRONT_PAGE} already holds a document — the publish bakes one into the copy it uploads, and a baked page in the tree serves whatever the README said the day somebody committed it`);
} else {
  const baked = bakeFrontPage(read(FRONT_PAGE), { html: '<h1 id="baked">Baked</h1><p>The words are in the first response.</p>' });
  if (frontPageIsEmpty(baked)) problems.push(`the publish would upload ${FRONT_PAGE} with its content element still empty, which is the blank page a reader waits in front of`);
  if (!baked.includes('The words are in the first response.')) problems.push(`the bake dropped the document it was handed, so ${FRONT_PAGE} would be published without it`);
  let refused = false;
  try {
    bakeFrontPage(read(FRONT_PAGE), { html: '' });
  } catch {
    refused = true;
  }
  if (!refused) problems.push(`the publish would write ${FRONT_PAGE} over a document the renderer drew nothing for, and a page baked empty is worse than one that was never baked`);
}

// Nothing the publish writes may be a file somebody committed: a 2.7 MB compiled module and a generated stylesheet are a worse tree to work in than the drift they end.
for (const path of PUBLISHED) {
  if (!gitIgnores(path)) problems.push(`.gitignore does not refuse ${path}, so a built file can enter the tree`);
}

const publish = join(root, '.github', 'workflows', 'publish-site.yml');
if (!existsSync(publish)) {
  problems.push('nothing publishes this site, so the pages are served as they stand and the renderer is never built');
} else {
  const workflow = readFileSync(publish, 'utf8');
  for (const step of ['just build-web', 'scripts/site-assets.mjs --write']) {
    if (!workflow.includes(step)) problems.push(`the publish workflow does not run \`${step}\`, so it deploys pages with no renderer beside them`);
  }
}

/** Whether `.gitignore` refuses a path, by the folder rules it actually writes rather than by matching the whole name. */
function gitIgnores(path) {
  const rules = readFileSync(join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim().replace(/^\/+|\/+$/g, ''))
    .filter((line) => line && !line.startsWith('#'));
  return rules.some((rule) => path === rule || path.startsWith(`${rule}/`));
}

if (problems.length) {
  console.error('the published pages ask for files that are not there:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('a path in a shared helper is relative to the page that loads it, not to the helper.');
  console.error('an advertised address is regenerated by scripts/seo-gen.mjs, not edited by hand.');
  process.exit(1);
}
console.log(
  `site: ${checked} fetched paths across ${PAGES.length} pages and ${addresses} advertised addresses, every one a file, none behind a fragment, both entry pages naming their own source and the AI indexes in the head and in a noscript block, every discovery file the one the generator would write today, a pager button's card names its page, and ${named} paths into the renderer the publish builds, every one written by it and refused by .gitignore, and a front page the tree keeps empty and the publish fills`
);
