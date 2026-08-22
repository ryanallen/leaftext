#!/usr/bin/env node
// Look at the exported static site on this machine.
//
//   node scripts/serve-web.mjs                       Emptyguru, if it is beside this repo
//   node scripts/serve-web.mjs <folder>              any folder of documents
//   node scripts/serve-web.mjs <folder> --port 8181
//
// **Nothing here is part of the result.** `export-web.mjs` writes a folder that reads on any static host with no server at all — that is the whole point, and it is how Emptyguru is published today. This exists only because a page cannot fetch its neighbors off `file://`, so there is no other way to open the export locally. It serves the exported folder and nothing else: no rendering, no rewriting, no state. The two pages leaftext.com is made of are somewhere else entirely, and `serve-site.mjs` is what opens those.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileWithin, typeOf } from './serve-static.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'web', 'dist', 'site');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const portFlag = args.indexOf('--port');
const port = portFlag === -1 ? 8123 : Number(args[portFlag + 1]);
const folder = args.filter((arg, index) => !arg.startsWith('--') && (portFlag === -1 || index !== portFlag + 1))[0];

// Export first, so what is served is always what would be published.
execFileSync('node', [join(root, 'scripts', 'export-web.mjs'), ...(folder ? [folder] : [])], {
  cwd: root,
  stdio: 'inherit',
});

if (!existsSync(join(site, 'index.html'))) {
  console.error('the export produced no page');
  process.exit(1);
}

createServer(async (request, response) => {
  // Refuse anything outside the exported folder, whatever the URL says.
  const file = fileWithin(site, request.url);
  if (!file) {
    response.writeHead(403).end('no');
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': typeOf(file),
      'cache-control': 'no-store',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not here');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`http://localhost:${port}`);
  console.log('Serving the exported folder as a static host would. Stop it with Ctrl+C.');
});
