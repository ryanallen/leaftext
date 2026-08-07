#!/usr/bin/env node
// The two modules a browser loads, and what each costs on the wire.
//
//   node scripts/build-web.mjs           build both, print both sizes, hold the ceiling
//   node scripts/build-web.mjs --check   the same, without rebuilding if the files are there
//
// Two modules and not one because the highlighter is most of the weight and most documents have no code in them: a page downloads the core, and fetches the second only for a document that turns out to have a fence. The ceiling below is what makes that split worth having — let the core drift past it and the decision quietly stops being true.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = 'wasm32-unknown-unknown';
const built = join(root, 'target', target, 'release', 'leaftext_web.wasm');
const out = join(root, 'web', 'dist');

// What a page may pay before a word appears. The core measured 631 KB the day it was first built; this leaves room for the renderer to grow without leaving room for the highlighter to creep back in.
const CORE_CEILING_BROTLI = 800 * 1024;

const check = process.argv.includes('--check');

/** Compressed as a browser would receive it. Brotli is what every host serves wasm with. */
function sizes(file) {
  const bytes = readFileSync(file);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

function build(name, features) {
  const args = ['build', '--release', '-p', 'leaftext-web', '--target', target];
  if (features) args.push('--features', features);
  try {
    execFileSync('cargo', args, { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.error(`\ncargo could not build the ${name} module.`);
    console.error(`If the target is missing: rustup target add ${target}`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, `leaftext-${name}.wasm`);
  copyFileSync(built, file);
  return { file, ...sizes(file) };
}

if (check && !existsSync(built)) {
  console.error('nothing built yet — run `just build-web` first');
  process.exit(1);
}

const core = build('core', null);
const highlight = build('highlight', 'highlight');
// The whole app in a browser, page and front end included. An embedding product has no use for either, which is why they are not in the two above.
const app = build('app', 'shell');

// A module that builds is not a module that renders. Both are loaded and asked for a document, which is the only thing here a compiler cannot check.
const fixture = '# Hello\n\nA paragraph with a [link](https://example.com).\n\n- [x] done\n\n```rust\nfn main() {}\n```\n';

/** Load a module and render `fixture` through it, the way an embedding page does: write bytes in, read a length-prefixed answer out. */
async function render(file, source = fixture) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file), {});
  const exports = instance.exports;
  const encoder = new TextEncoder();
  const write = (text) => {
    const bytes = encoder.encode(text);
    const at = exports.leaf_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer).set(bytes, at);
    return [at, bytes.length];
  };
  const [text, sourceLen] = write(source);
  const [path, pathLen] = write('notes.md');
  const answer = exports.leaf_render(text, sourceLen, path, pathLen);
  if (!answer) throw new Error('the module refused the document');
  const length = new DataView(exports.memory.buffer).getUint32(answer, true);
  const json = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, answer + 4, length));
  exports.leaf_free(text, sourceLen);
  exports.leaf_free(path, pathLen);
  exports.leaf_free(answer, 4 + length);
  return JSON.parse(json);
}

const problems = [];
const rendered = { core: await render(core.file), highlight: await render(highlight.file) };

for (const [name, document] of Object.entries(rendered)) {
  if (document.title !== 'Hello') problems.push(`${name}: the title came back as ${JSON.stringify(document.title)}`);
  if (!document.html.includes('<h1 id="hello">')) problems.push(`${name}: no heading in the rendered document`);
  if (!document.html.includes('rel="noopener noreferrer"')) problems.push(`${name}: the sanitizer did not run`);
  if (document.blocks.length === 0) problems.push(`${name}: no block ranges, so nothing could be edited`);
  if (document.tasks.length !== 1) problems.push(`${name}: ${document.tasks.length} task markers, expected 1`);
}
// The whole reason there are two: the core leaves a fence plain, and the second module colors it.
if (rendered.core.html.includes('<span class="syn-')) problems.push('the core module colored code, so the highlighter is in it after all');
if (!rendered.highlight.html.includes('<span class="syn-')) problems.push('the second module did not color code, so there is no reason to fetch it');

// Same syntax dumps, different regex engine — the desktop's is a C library with no browser build. The markup both have to produce is pinned in one file, and the desktop's half of this is a test beside the fixtures.
const fence = JSON.parse(readFileSync(join(root, 'web', 'fence.json'), 'utf8'));
const fenced = await render(highlight.file, fence.markdown);
if (!fenced.html.includes(fence.code_html)) {
  problems.push('the browser module colors a fence differently from the desktop — see web/fence.json');
  problems.push(`  it rendered: ${fenced.html.slice(0, 400)}`);
}

if (problems.length) {
  console.error('the browser modules do not do what they are for:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log('');
console.log(`core       ${kb(core.raw)} raw, ${kb(core.gzip)} gzip, ${kb(core.brotli)} brotli`);
console.log(`+colors    ${kb(highlight.raw)} raw, ${kb(highlight.gzip)} gzip, ${kb(highlight.brotli)} brotli`);
console.log(`whole app  ${kb(app.raw)} raw, ${kb(app.gzip)} gzip, ${kb(app.brotli)} brotli`);
console.log(`all three in ${out}`);

if (core.brotli > CORE_CEILING_BROTLI) {
  console.error('');
  console.error(`The core module is ${kb(core.brotli)} compressed, over its ${kb(CORE_CEILING_BROTLI)} ceiling.`);
  console.error('A page pays this before it can draw anything. Either something heavy joined the core, or the highlighter has crept back into it.');
  process.exit(1);
}
