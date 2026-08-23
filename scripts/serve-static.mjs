// The half both preview servers share: which address they hand out, which type a file is served as, and where a URL is allowed to land.
//
// Two servers carrying two copies of a type table is a document that draws under one command and downloads under the other, and a path refusal written twice is the one of them that forgot `..`. Neither is part of what is published — `export-web.mjs` writes a folder that reads on any static host, and leaftext.com is served by GitHub Pages — so this is only what it takes to open either of them on this machine.

import { connect } from 'node:net';
import { extname, resolve, sep } from 'node:path';

/// The two loopback families, both probed, because a program holding the wildcard address answers on one of them and lets a bind on the other through with no error at all.
const LOOPBACK = ['127.0.0.1', '::1'];

/// Whether anything already answers on this port on one family. It connects rather than binds: watched here, a foreign program holding `0.0.0.0` and `[::]` let `listen(port, '127.0.0.1')` and `listen(port, '::1')` both succeed with no error, so `EADDRINUSE` never arrives and nothing may be written as though it will.
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

/// How both previews start. It refuses a port anything already answers on, binds loopback alone — so a folder of somebody's notes is not published to the network for as long as the server is up — and prints the address it actually bound, which is what makes the line a person opens, and points `just drive-web` at, this server's own rather than a name that may resolve to somebody else's. `extra` is handed that address and answers with whatever else the server prints. Answers `{ address, lines }` where it listened and `{ taken, message }` where it did not; `quiet` is for a test that wants the answer without the output.
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
