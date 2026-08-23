#!/usr/bin/env node
// Open leaftext.com on this machine: the two pages a visitor opens, served the way the deploy serves them.
//
//   node scripts/serve-site.mjs                the site, its front page baked the way a visitor gets it
//   node scripts/serve-site.mjs --unbaked      the front page as the tree keeps it, which is the other branch its reader takes
//   node scripts/serve-site.mjs --port 8181
//
// This is not `preview-web`, which serves a folder of somebody's documents written out as a static site. These are the repository's own `index.html` and `docs/index.html`. With nothing serving them, a change to either — or to the stylesheet they share — is proved on `file://`, where a module script cannot be fetched at all and the page paints correctly and then sits empty for ever with nothing on it saying why, or on the live site after everybody already has it.
//
// **The bake is in memory and nothing here reaches the tree.** `site-assets.mjs --write` puts the drawn README into the tracked `index.html`, and `check-site.mjs` then refuses that page until somebody puts it back — so a preview built on it would leave the gate red until it was undone by hand. The bake is already a pure function, so its answer goes straight to the browser.
//
// **The renderer a browser draws these pages through is the one that was just built.** The module, its stylesheet and its version are answered out of the build below, off `publishedAssets` in `site-assets.mjs`, which is the one table this and the publish both read. Served off the tree they come from `assets/leaftext/`, which only the publish writes — so a page is drawn through however old the last publish-shaped run left that folder, and the front page through two renderers at once: baked through the build below, decorated through the copy on disk.
//
// **Baked and unbaked are two different first paints, and the reader branches on which it got.** Baked, the words are in the first response and the module arrives afterwards as a decoration; unbaked, the page waits on the module and fetches the document itself. Every visitor to leaftext.com gets the first, so that is what this serves; `--unbaked` is for reading the second.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT_MODULE, FRONT_DOCUMENT, FRONT_PAGE, bakeFrontPage, publishedAssets } from './site-assets.mjs';
import { fileWithin, listenLocally, typeOf } from './serve-static.mjs';
import { instantiateCore } from './web-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const portFlag = args.indexOf('--port');
const port = portFlag === -1 ? 8124 : Number(args[portFlag + 1]);

/// Refused before anything listens, in the same words the publish uses, rather than after a browser has been opened on a page that cannot draw. Nothing here builds the module: that is a wait somebody chooses, the way `preview-web` needs the same one through the export.
if (!existsSync(BUILT_MODULE)) {
  console.error('the renderer is not built — run: just build-web');
  process.exit(1);
}

// The module is loaded whichever first paint is being read, because the pages are drawn through it either way. `--unbaked` is a second first paint, not a second renderer.
const front = join(root, FRONT_PAGE);
const leaf = await instantiateCore(BUILT_MODULE);
const bakedPage = args.includes('--unbaked')
  ? null
  : bakeFrontPage(readFileSync(front, 'utf8'), leaf.render(readFileSync(join(root, FRONT_DOCUMENT), 'utf8'), FRONT_DOCUMENT));

// Keyed by the file each one lands at, so a request is answered by where its URL resolves rather than by what it says.
const publishedHere = new Map([...publishedAssets(leaf, readFileSync(BUILT_MODULE))].map(([path, bytes]) => [join(root, path), bytes]));

const server = createServer(async (request, response) => {
  // Refuse anything outside the repository, whatever the URL says.
  const file = fileWithin(root, request.url);
  if (!file) {
    response.writeHead(403).end('no');
    return;
  }
  if (bakedPage && file === front) {
    response.writeHead(200, { 'content-type': typeOf(front), 'cache-control': 'no-store' });
    response.end(bakedPage);
    return;
  }
  const published = publishedHere.get(file);
  if (published !== undefined) {
    response.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' });
    response.end(published);
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not here');
  }
});

// The address is `serve-static.mjs`'s to hand out, so a port something else already answers on stops this rather than being printed as ours. The docs page is spelled off the address it answered with, so the host is written in one place for both lines.
const extra = (address) => [`${address}/docs/`, `Serving the site as GitHub Pages would, front page ${bakedPage ? 'baked' : 'unbaked'}. Stop it with Ctrl+C.`];
if (!(await listenLocally(server, port, { extra })).address) process.exit(1);
