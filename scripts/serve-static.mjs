// The half both preview servers share: which type a file is handed over as, and where a URL is allowed to land.
//
// Two servers carrying two copies of a type table is a document that draws under one command and downloads under the other, and a path refusal written twice is the one of them that forgot `..`. Neither is part of what is published — `export-web.mjs` writes a folder that reads on any static host, and leaftext.com is served by GitHub Pages — so this is only what it takes to open either of them on this machine.

import { extname, resolve, sep } from 'node:path';

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
