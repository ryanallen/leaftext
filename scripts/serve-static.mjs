// The half both preview servers share: which address they hand out, which type a file is served as, where a URL is allowed to land, and the answer either of them gives a browser.
//
// Two servers carrying two copies of a type table is a document that draws under one command and downloads under the other, a path refusal written twice is the one of them that forgot `..`, and a request handler written twice is the one of them the gate never boots. Neither is part of what is published — `export-web.mjs` writes a folder that reads on any static host, and leaftext.com is served by GitHub Pages — so this is only what it takes to open either of them on this machine.

import { connect } from 'node:net';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/// Both families, because a wildcard holder answers on one of them and is invisible from the other.
const LOOPBACK = ['127.0.0.1', '::1'];

/// Whether anything already answers on this port on one family. It connects rather than binds: a foreign program holding `0.0.0.0` and `[::]` lets `listen(port, '127.0.0.1')` and `listen(port, '::1')` both succeed with no error, so `EADDRINUSE` never arrives and nothing may be written as though it will.
function answers(port, host) {
  return new Promise((settle) => {
    const socket = connect({ port, host });
    const done = (found) => {
      socket.destroy();
      settle(found);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false)); // Refused, or a family this machine has not got: either way nothing is there.
  });
}

/// How both previews start: refuse a port anything already answers on, bind loopback alone so a folder of somebody's notes is not published to the network, and print the address actually bound rather than a name that may resolve to somebody else's. `extra` is handed that address and answers with the server's other lines. Answers `{ address, lines }` where it listened and `{ taken, message }` where it did not; `quiet` is for a test that wants the answer without the output.
export async function listenLocally(server, port, { extra = () => [], quiet = false } = {}) {
  for (const host of LOOPBACK) {
    if (!(await answers(port, host))) continue;
    const message = `something is already answering on port ${port} at ${host}, so that address is not this server's to hand out — stop it, or move this one with --port`;
    if (!quiet) console.error(message);
    return { taken: host, message };
  }
  await new Promise((listening) => server.listen(port, '127.0.0.1', listening));
  const address = `http://127.0.0.1:${server.address().port}`;
  const lines = [address, ...extra(address)];
  if (!quiet) for (const line of lines) console.log(line);
  return { address, lines };
}

/// Every type either preview hands out. Anything else is served as bytes, so a browser saves it rather than drawing it — the honest answer for a file neither site publishes.
export const TYPES = {
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

/// What a file is served as. `.wasm` is the one that has to be right rather than merely plausible: a browser refuses to stream-compile a module handed over as anything else.
export function typeOf(file) {
  return TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
}

/// The file a URL asks for, or `null` where it lands outside the folder being served. The resolved path is what is checked rather than the asked one, because `..` and an encoded slash both read as ordinary characters until the path is worked out. A URL ending in a slash takes that folder's `index.html`, which is what a static host does with one.
export function fileWithin(root, url) {
  let asked;
  try {
    asked = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null; // A URL nothing can decode names no file.
  }
  const file = resolve(root, '.' + (asked.endsWith('/') ? `${asked}index.html` : asked));
  // The separator is what makes this a folder test rather than a string test: a sibling folder whose name merely starts with this one's is outside it.
  return file === root || file.startsWith(root + sep) ? file : null;
}

/// The answer both previews give a browser, and the only one either of them has: refuse a path landing outside the folder, hand over what is answered ahead of the disk, then the disk, then a 404. `ahead` is keyed by path within `root` — the site preview hands over its baked front page and the three files the publish writes, the export preview hands over nothing — so nothing that fills it spells an absolute path.
export function staticServer(root, ahead = new Map()) {
  const answered = new Map([...ahead].map(([path, bytes]) => [join(root, path), bytes]));
  return createServer(async (request, response) => {
    // Refuse anything outside the folder being served, whatever the URL says.
    const file = fileWithin(root, request.url);
    if (!file) {
      response.writeHead(403).end('no');
      return;
    }
    const ours = answered.get(file);
    if (ours !== undefined) {
      response.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' });
      response.end(ours);
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
}
