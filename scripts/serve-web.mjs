#!/usr/bin/env node
// Look at the exported static site on this machine.
//
//   node scripts/serve-web.mjs                       Emptyguru, if it is beside this repo
//   node scripts/serve-web.mjs <folder>              any folder of documents
//   node scripts/serve-web.mjs <folder> --port 8181
//
// **Nothing here is part of the result.** `export-web.mjs` writes a folder that reads on any static host with no server at all — that is the whole point, and it is how Emptyguru is published today. This exists only because a page cannot fetch its neighbors off `file://`, so there is no other way to open the export locally. It serves the exported folder and nothing else: no rendering, no rewriting, no state. The two pages leaftext.com is made of are somewhere else entirely, and `serve-site.mjs` is what opens those.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenLocally, staticServer } from './serve-static.mjs';

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

// The answer is `serve-static.mjs`'s, handed nothing to answer ahead of the disk: this serves an exported folder and nothing else, where the site preview also answers its baked front page and the files the publish writes.
const server = staticServer(site);

// The address is `serve-static.mjs`'s to hand out, so a port something else already answers on stops this rather than being printed as ours.
if (!(await listenLocally(server, port, { extra: () => ['Serving the exported folder as a static host would. Stop it with Ctrl+C.'] })).address) process.exit(1);
