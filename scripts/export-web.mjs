#!/usr/bin/env node
// Write a folder of documents out as a static Leaftext site: no server, no build step at the far end, nothing to run.
//
//   node scripts/export-web.mjs <folder> [--out <folder>]
//
// **There is no server in the result.** Everything the page needs is a file beside it — the app's own page, its front end, its stylesheet, the renderer as a module, the vendored runtimes, the list of documents, and the documents themselves. Drop the folder on any static host and it reads. That is the whole point: Emptyguru is published this way today, and a version of it that needed a server would be a step backwards.
//
// A page cannot fetch its neighbors off `file://`, so looking at the result on this machine still wants something serving files — `just preview-web` does that, and serves nothing the export does not contain.

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instantiateCore } from './web-module.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web', 'dist');

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const out = resolve(outFlag === -1 ? join(dist, 'site') : args[outFlag + 1]);
const folderArg = args.filter((arg, index) => !arg.startsWith('--') && (outFlag === -1 || index !== outFlag + 1))[0];
const source = resolve(folderArg || join(root, '..', '..', 'dharma', 'emptyguru'));

if (!existsSync(source)) {
  console.error(`no folder at ${source}`);
  process.exit(1);
}
const module_ = join(dist, 'leaftext-app.wasm');
if (!existsSync(module_)) {
  console.error('the browser modules are not built yet — run: just build-web');
  process.exit(1);
}

// The page's own policy names the desktop's asset scheme and forbids WebAssembly, both of which are wrong for a static site: the assets sit beside the page and the renderer *is* WebAssembly.
const POLICY =
  "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'";

// The front end sends its first command while it boots, before a module script can have run. Keeping them is what stops the first paint being lost.
const IPC_QUEUE =
  '<script>window.__leafPending=[];window.ipc={postMessage:(m)=>window.__leafPending.push(m)};</script>';

/** Every document under the folder, deepest last, labeled by something a person can pick from. */
async function findDocuments(dir, base = dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await findDocuments(path, base, found);
      continue;
    }
    if (!/\.(md|markdown|mdown|xml|json|yaml|yml|eml|mht|mhtml)$/i.test(entry.name)) continue;
    const relativePath = relative(base, path).split(sep).join('/');
    found.push({ path: relativePath, depth: relativePath.split('/').length });
  }
  return found;
}

const leaf = await instantiateCore(module_);
const documents = (await findDocuments(source)).sort(
  (a, b) => a.depth - b.depth || a.path.localeCompare(b.path)
);

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });

const page = leaf
  .page()
  .replace(/content="default-src[^"]*"/, `content="${POLICY}"`)
  .replace('</head>', `${IPC_QUEUE}<script>${leaf.boot()}</script></head>`)
  .replace('</body>', '<script type="module" src="assets/boot.js"></script></body>');

await writeFile(join(out, 'index.html'), page);
await writeFile(join(out, 'assets', 'app.js'), leaf.script());
await writeFile(join(out, 'assets', 'app.css'), leaf.styles());
await writeFile(join(out, 'documents.json'), JSON.stringify(documents));
await cp(module_, join(out, 'assets', 'leaftext.wasm'));

// The page's own host, and the loader under it.
for (const name of ['boot.js', 'host.js']) {
  await cp(join(root, 'web', 'preview', name), join(out, 'assets', name));
}

// The runtimes the page fetches by name when a document turns out to need one: a diagram, some math, the map, the source view.
await cp(join(root, 'src', 'assets', 'vendor'), join(out, 'assets'), { recursive: true });

// The documents themselves, under the same paths the listing names.
for (const entry of documents) {
  const target = join(out, 'source', entry.path);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(source, entry.path.split('/').join(sep)), target);
}

console.log(`${documents.length} documents from ${source}`);
console.log(`static site in ${out} — every file it needs is in there`);
