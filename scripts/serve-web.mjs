#!/usr/bin/env node
// Look at the exported static site on this machine.
//
//   node scripts/serve-web.mjs                       Emptyguru, if it is beside this repo
//   node scripts/serve-web.mjs <folder>              any folder of documents
//   node scripts/serve-web.mjs <folder> --port 8181
//
// **Nothing here is part of the result.** `export-web.mjs` writes a folder that reads on any static host with no server at all — that is the whole point, and it is how Emptyguru is published today. This exists only because a page cannot fetch its neighbors off `file://`, so there is no other way to open the export locally. It serves the exported folder and nothing else: no rendering, no rewriting, no state.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.eml': 'message/rfc822',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

createServer(async (request, response) => {
  const asked = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  // Refuse anything outside the exported folder, whatever the URL says.
  const file = resolve(site, '.' + (asked === '/' ? '/index.html' : asked));
  if (!file.startsWith(site)) {
    response.writeHead(403).end('no');
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
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
