#!/usr/bin/env node
// The published pages fetch files by path, and a wrong path is a 404 nobody sees until the page is live — the front page's glossary sheet asked the site root for a file that has only ever lived in docs/.
//
//   node scripts/check-site.mjs   fail on a fetched path with no file
//
// Each entry page's own folder is the base, read off the <script> tag it loads, so the page saying where the file is and the file being there cannot drift. Only literal paths can be checked; a path built at runtime is skipped.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createSocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLink } from '../site/link-tooltip.js';
import { discoveryFiles } from './seo-gen.mjs';
import { fileWithin, listenLocally, staticServer, typeOf } from './serve-static.mjs';
import { ASSET_DIR, FRONT_PAGE, MODULE_PATH, PUBLISHED, bakeFrontPage, frontPageIsEmpty, previewAnswers } from './site-assets.mjs';

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

// Both published readers configure Mermaid for themselves, so each one owes the same room and one-line group title the app carries.
const GROUP_TITLE_CONFIG = [
  "const subgraphTitleGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lt-space-8')) || 0;",
  'flowchart: { subGraphTitleMargin: { top: subgraphTitleGap, bottom: subgraphTitleGap } },',
  "themeCSS: '.cluster-label div { white-space: nowrap !important; width: max-content !important; max-width: none !important; }',",
];
const missingGroupTitleConfig = (source) => GROUP_TITLE_CONFIG.filter((line) => !source.includes(line));
for (const file of ['site/reader.js', 'docs/docs.js']) {
  const missing = missingGroupTitleConfig(read(file));
  if (missing.length) problems.push(`${file} leaves a flowchart group title without its one-line rule or the spacing around it`);
}
for (let skipped = 0; skipped < GROUP_TITLE_CONFIG.length; skipped += 1) {
  const incomplete = GROUP_TITLE_CONFIG.filter((_line, index) => index !== skipped).join('\n');
  if (missingGroupTitleConfig(incomplete).length !== 1) problems.push('the group-title check does not refuse each missing part of a published Mermaid configuration');
}

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

/// The local preview bakes the front page in memory and hands it to a browser. Nothing it does may reach the tree: `--write` overwrites the tracked page and the block above then fails the gate until somebody puts it back, so a preview built that way would leave every checkout it ran in red. Nothing else in the suite would notice.
{
  const before = read(FRONT_PAGE);
  bakeFrontPage(before, { html: '<p>Served, never written.</p>' });
  if (read(FRONT_PAGE) !== before) problems.push(`baking ${FRONT_PAGE} the way the local preview does wrote over the tracked page, which leaves the gate red until somebody puts it back by hand`);
  if (!frontPageIsEmpty(read(FRONT_PAGE))) problems.push(`${FRONT_PAGE} stopped being an empty holder after a bake, so the preview would be putting a document into the tree`);
}

/// The answer both previews give a browser is one function in `serve-static.mjs`, and nothing else anywhere runs a request through either server: without this, the branch that hands over the renderer just built can be taken back out with every other check still green and a browser served whatever the last publish left in `assets/leaftext/`. So it is started here on a port the machine hands out, over a folder in the repository and a map this check wrote, and asked for each of the four branches a browser can land in.
{
  const served = join(root, 'site');
  const ahead = 'answered ahead of the disk';
  const server = staticServer(served, new Map([['styles.css', ahead]]));
  const started = await listenLocally(server, 0, { quiet: true });
  if (!started.address) {
    problems.push(`the preview server would not start on a port the machine handed out: ${started.message}`);
  } else {
    // The map's own file exists on disk and says something else, so an answer off disk here is the fault this whole boot is for rather than a missing file.
    for (const [url, status, type, body] of [
      ['/styles.css', 200, 'text/css; charset=utf-8', ahead],
      ['/reader.js', 200, 'text/javascript; charset=utf-8', read('site/reader.js')],
      ['/..%2fAGENTS.md', 403, null, null],
      ['/nobody-wrote-this.md', 404, null, null],
    ]) {
      const answer = await fetch(`${started.address}${url}`);
      const got = await answer.text();
      if (answer.status !== status) {
        problems.push(`a preview server answered ${url} with ${answer.status} rather than ${status}`);
        continue;
      }
      if (type && answer.headers.get('content-type') !== type) problems.push(`a preview server handed ${url} over as ${answer.headers.get('content-type')} rather than ${type}`);
      if (body !== null && got !== body) problems.push(`a preview server answered ${url} with ${got.length} bytes that are not the ${body.length} it was meant to hand over`);
    }
    server.closeAllConnections();
    server.close();
  }
}

/// The export preview is the same server with nothing answered ahead of the disk, and the type table is the half of it a browser is strictest about: a module handed over as anything but `application/wasm` is one a browser refuses to stream-compile. So the table is read here through a real response rather than only as a function, over a folder written for this and thrown away after.
{
  const served = mkdtempSync(join(tmpdir(), 'leaftext-preview-'));
  const files = [
    ['a.md', '# Served\n', 'text/markdown; charset=utf-8'],
    ['a.wasm', '\0asm', 'application/wasm'],
    ['a.unlisted', 'bytes', 'application/octet-stream'],
  ];
  for (const [name, body] of files) writeFileSync(join(served, name), body);
  const server = staticServer(served);
  const started = await listenLocally(server, 0, { quiet: true });
  if (!started.address) {
    problems.push(`the export preview would not start on a port the machine handed out: ${started.message}`);
  } else {
    for (const [name, body, type] of files) {
      const answer = await fetch(`${started.address}/${name}`);
      const got = await answer.text();
      if (answer.status !== 200) problems.push(`the export preview answered ${name} with ${answer.status} rather than serving it off the folder it was pointed at`);
      else if (answer.headers.get('content-type') !== type) problems.push(`the export preview handed ${name} over as ${answer.headers.get('content-type')} rather than ${type}`);
      else if (got !== body) problems.push(`the export preview answered ${name} with something other than the bytes on disk`);
    }
    server.closeAllConnections();
    server.close();
  }
  rmSync(served, { recursive: true, force: true });
}

/// What the site preview hands that server ahead of the disk has to be the published table itself plus the baked front page: a published file missing from it goes back to being served off `assets/leaftext/`, and a stale copy there draws a page that looks right. Asked with a stand-in module and no module bytes, so this stays offline and needs no build.
{
  const standIn = { styles: () => 'a stylesheet', render: () => ({ html: '<h1 id="drawn">Drawn</h1>' }) };
  const wanted = [...PUBLISHED, FRONT_PAGE];
  const baked = previewAnswers(standIn, 'the module');
  const answered = [...baked.keys()];
  if (answered.join(' ') !== wanted.join(' ')) {
    problems.push(`the local preview answers ${answered.join(', ') || 'nothing'} for itself where it owes ${wanted.join(', ')} — a published file it does not answer is served off disk, which is whatever the last publish left there`);
  } else if (frontPageIsEmpty(baked.get(FRONT_PAGE))) {
    problems.push(`the local preview answers ${FRONT_PAGE} with its content element still empty, which is the blank page a reader waits in front of`);
  }
  // Unbaked is the reader's other first paint, not its other renderer, so the three published files are answered there too.
  const plain = [...previewAnswers(standIn, 'the module', { baked: false }).keys()];
  if (plain.join(' ') !== PUBLISHED.join(' ')) {
    problems.push(`unbaked, the local preview answers ${plain.join(', ') || 'nothing'} for itself where it owes ${PUBLISHED.join(', ')} — so --unbaked reads the tree's page through the renderer on disk rather than the one just built`);
  }
}

// The address a preview prints is what a person opens and what `just drive-web` is pointed at, so a port something else already answers on may not be handed out as this server's. A program holding the wildcard address lets every loopback bind through with no error at all, so a probe is the only thing that finds it — and it has to ask both families, because a holder on one is invisible from the other. Offline, and on ports the machine hands out, so nothing here waits on 8123 or 8124 being free.
{
  const free = createSocketServer();
  const started = await listenLocally(free, 0, { quiet: true });
  if (!started.address) {
    problems.push(`a preview server refused a port nothing was answering on: ${started.message}`);
  } else {
    const bound = free.address();
    if (bound.address !== '127.0.0.1') problems.push(`a preview server bound ${bound.address} rather than 127.0.0.1, so previewing a folder of somebody's notes publishes it to anything that can reach this machine`);
    if (started.lines[0] !== `http://127.0.0.1:${bound.port}`) problems.push(`a preview server printed ${started.lines[0]} while listening on 127.0.0.1:${bound.port}, so the address it hands out is not the one it serves`);
    free.close();
  }
  // Both wildcard families, because each is the one a probe asking only the other would report as free.
  for (const [held, options] of [['0.0.0.0', { port: 0, host: '0.0.0.0' }], ['[::]', { port: 0, host: '::', ipv6Only: true }]]) {
    const holder = createSocketServer();
    const taken = await new Promise((settle) => holder.listen(options, () => settle(holder.address())).once('error', () => settle(null)));
    if (!taken) continue; // A machine with no IPv6 cannot hold `[::]` to be found on it, and that is not a fault in the server.
    const asked = createSocketServer();
    const answer = await listenLocally(asked, taken.port, { quiet: true });
    if (answer.address) {
      problems.push(`a preview server bound port ${taken.port} beside a program already holding ${held} and printed ${answer.address}, which opens that program's site rather than this one`);
      asked.close();
    } else if (!answer.message.includes(String(taken.port)) || !answer.message.includes(answer.taken)) {
      problems.push(`a preview server refused port ${taken.port} without naming both the port and the family that answered, so nothing in the line says which --port to move to: ${answer.message}`);
    }
    holder.close();
  }
}

// Both preview servers name a file's type and refuse a path through one module, so there is one type table rather than two that drift and one refusal rather than one of them forgetting `..`. A URL is somebody else's string: what is checked is where it resolves to, never what it says.
{
  const served = join(root, 'web', 'dist', 'site');
  for (const [url, wanted] of [['/', join(served, 'index.html')], ['/docs/', join(served, 'docs', 'index.html')], ['/site/styles.css', join(served, 'site', 'styles.css')]]) {
    const got = fileWithin(served, url);
    if (got !== wanted) problems.push(`a preview server would answer ${url} with ${got ?? 'nothing'} rather than ${wanted}`);
  }
  // A browser's own URL parser folds `..` away — encoded as `%2e%2e` too — so a plain climb lands back at the served root, exactly as it does on a static host. What survives it is an encoded slash, which is one segment to the parser and a climb once it is decoded, and that is the case this refusal is here for.
  for (const url of ['/../AGENTS.md', '/a/../../AGENTS.md', '/%2e%2e/AGENTS.md']) {
    const got = fileWithin(served, url);
    if (got !== join(served, 'AGENTS.md')) problems.push(`a preview server answered ${url} with ${got ?? 'nothing'} rather than the file of that name inside the folder it serves`);
  }
  for (const url of ['/..%2fAGENTS.md', '/docs%2f..%2f..%2fAGENTS.md']) {
    if (fileWithin(served, url)) problems.push(`a preview server would serve ${url}, which lands outside the folder it is serving`);
  }
  if (fileWithin(`${served}-elsewhere`, '/index.html')?.startsWith(served + '/')) problems.push('a preview server read a folder whose name merely starts with the served one as inside it');
  for (const [file, wanted] of [['a/leaftext.wasm', 'application/wasm'], ['README.md', 'text/markdown; charset=utf-8'], ['x.HTML', 'text/html; charset=utf-8'], ['b/thing.unknown', 'application/octet-stream']]) {
    if (typeOf(file) !== wanted) problems.push(`a preview server would hand ${file} over as ${typeOf(file)} rather than ${wanted}`);
  }
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
  // The pictures are the third generated thing the publish writes and never commits. Taken out of the workflow it is not a broken site, which is why nothing else would ever notice: the pages go on naming the PNG masters and every reader pays 2,018 KB for it.
  const pictures = workflow.indexOf('scripts/site-images.mjs --write');
  if (pictures < 0) {
    problems.push('the publish workflow does not run `scripts/site-images.mjs --write`, so it deploys 5,336 KB of PNG where 3,318 KB of WebP would serve the same pixels');
  } else if (pictures > workflow.indexOf('scripts/site-assets.mjs --write')) {
    // The front page's document is the README, which draws 25 pictures. Baked before they are moved, the one page every visitor lands on keeps the PNGs while every page behind it gets the WebP — and it is the front page, so nobody would think to look.
    problems.push('the publish workflow moves the pages onto their WebP after it bakes the front page, so the front page is baked from a README still naming the PNGs');
  }
}

// The reading column is measured in characters, and it has to stay that way. The type on both published sites grows with the window on purpose, so a column frozen at a pixel count means the line gets *shorter* the bigger the screen — 104 characters at a 1280-wide window, 66 at 2530. Nothing offline can lay a page out and count them, so what is held here is the unit: a `ch` in the value is the one thing that makes the column grow alongside the type. The reading itself is driven, `just drive-web <url> size:2530,1400 …`.
const column = /--content-width:\s*([^;]+);/.exec(read('site/styles.css'));
if (!column) {
  problems.push('site/styles.css no longer sets --content-width, and that is the one width every published page is read through');
} else if (!/\d(?:\.\d+)?ch\b/.test(column[1])) {
  problems.push(
    `--content-width is '${column[1].trim()}', which has no character measure in it — the type above it grows with the window, so a column that does not gives a reader a shorter line the better their screen is`
  );
}

// The front page has no left-hand chrome, so the rail's reserve on the right alone leaves the reading column half a rail left of center in the window a visitor is looking at. The two reserves are held to each other here: the page naming itself, the rule that matches, the same number of states handing each one back, and no other rule taking the left one away on its own. Nothing offline lays a page out, so the fault is invisible in the source of any one of those read alone.
const stylesheet = read('site/styles.css');
const namesItself = /<body\b[^>]*\bclass="[^"]*\bfront-page\b/;
if (!namesItself.test(read(FRONT_PAGE))) {
  problems.push(`${FRONT_PAGE} no longer names its body 'front-page', so the stylesheet cannot tell it from the docs reader and its column goes back to sitting half a rail left of center`);
}
if (namesItself.test(read('docs/index.html'))) {
  problems.push("docs/index.html names its body 'front-page', which would give the docs reader a rail reserve on the left it already spends on its sidebar");
}
if (!/body\.front-page\s*\{\s*padding-left:\s*var\(--minimap-width\)/.test(stylesheet)) {
  problems.push("site/styles.css no longer reserves the rail's width down the front page's left, so the column sits half a rail left of center in the window");
}
const givesRightBack = (stylesheet.match(/body\s*\{\s*padding-right:\s*0/g) || []).length;
const givesLeftBack = (stylesheet.match(/body\.front-page\s*\{\s*padding-left:\s*0/g) || []).length;
if (!givesRightBack) {
  problems.push('site/styles.css no longer reclaims the rail reserve anywhere, so a page with no rail keeps a gap where it would have been');
} else if (givesRightBack !== givesLeftBack) {
  problems.push(
    `site/styles.css gives the rail's right reserve back in ${givesRightBack} places and the front page's matching left reserve in ${givesLeftBack} — a state that reclaims one and not the other draws the column off center by half a rail`
  );
}

// A rule zeroing the body's left padding for something else — the docs reader reclaiming its sidebar — lands on the front page too and takes the rail's reserve with it, so the column goes off center again by whatever the reader last switched off.
for (const [, whole] of stylesheet.matchAll(/^([^{}]*\bbody\b[^{}]*?)\{\s*padding-left:\s*0/gm)) {
  // A selector reaches back over whatever comment sits above it, so the rule itself is the last line of the match.
  const selector = whole.trimEnd().split('\n').pop().trim();
  if (!/\bbody\b/.test(selector) || /front-page/.test(selector)) continue;
  problems.push(
    `site/styles.css zeroes the body's left padding for '${selector}' without saying whether it means the front page — there that padding is the rail's reserve, so taking it draws the column off center by half a rail`
  );
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
  `site: ${checked} fetched paths across ${PAGES.length} pages and ${addresses} advertised addresses, every one a file, none behind a fragment, both entry pages naming their own source and the AI indexes in the head and in a noscript block, every discovery file the one the generator would write today, a pager button's card names its page, and ${named} paths into the renderer the publish builds, every one written by it and refused by .gitignore, and a front page the tree keeps empty and the publish fills, over a reading column measured in characters and centered in the whole window — plus both preview servers, booted here on ports the machine handed out: the one answer they share hands over what is asked ahead of the disk, then the disk with the type the table names, refuses a path climbing out of the folder it serves and 404s a file nobody wrote; the site preview bakes its front page without touching the tracked one and answers all ${PUBLISHED.length} published files out of the build it baked with, baked and unbaked alike; and either of them prints the loopback address it actually bound and refuses a port a program holding either wildcard family already answers on`
);
