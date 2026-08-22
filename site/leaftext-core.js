// leaftext-core.js
// ---------------------------------------------------------------------------
// The app's own renderer, loaded into a page.
//
// This is what replaced the three hand-written reader files that used to sit beside it. They were a second implementation of the desktop's renderer, and a third lived in the other site, so every fix had to land three times and two of them stopped agreeing. Now there is one: the desktop's own render path, compiled for the browser, fetched as a module.
//
// **Where the module comes from is the page's to say**, in a `<meta name="leaftext-renderer">` in its head. leaftext.com serves its own; Emptyguru names leaftext.com's, because it has no Rust to build one with and GitHub Pages sends `access-control-allow-origin: *` on every asset. There is no default: a page that forgot the tag should say so plainly rather than quietly reaching across a network nobody asked it to.
//
// **The colors are not in here.** The core leaves a fence plain with `class="language-…"` on it, which is exactly what `codeblocks.js` colors with the runtime the page already ships — so the module with the highlighter in it, nearly three times the size, is never fetched.
//
// Strings cross as bytes: write with `leaf_alloc`, read a little-endian `u32` length off the front of an answer, free both. Nothing else here is a protocol.
// ---------------------------------------------------------------------------

import { fetchWatchedStream } from './fetches.js';

const RENDERER_META = 'leaftext-renderer';
const MODULE_FILE = 'leaftext.wasm';

/** Where this page says the renderer lives. Resolved against the page so a relative folder works from any depth. */
export function rendererBase(doc = document) {
  const meta = doc.querySelector(`meta[name="${RENDERER_META}"]`);
  const named = meta && meta.getAttribute('content');
  if (!named) {
    throw new Error(`this page has no <meta name="${RENDERER_META}"> saying where the renderer is`);
  }
  return new URL(named.endsWith('/') ? named : named + '/', doc.baseURI || location.href);
}

/** One loaded module, and the reads and writes across its memory. */
async function load(url) {
  // Through the watchdog, because this is the biggest thing either site waits on and a stalled connection here is the whole page: the deadline and its one retry cover the compile as well as the fetch, so a body that goes quiet halfway is asked for again rather than left hanging.
  const instance = await fetchWatchedStream(url, async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    // Streaming compiles as the bytes arrive; a host serving the module as anything but `application/wasm` falls back to the whole buffer rather than failing.
    try {
      return (await WebAssembly.instantiateStreaming(response.clone(), {})).instance;
    } catch (error) {
      return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance;
    }
  });
  const api = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const write = (text) => {
    const bytes = encoder.encode(text);
    const at = api.leaf_alloc(bytes.length);
    new Uint8Array(api.memory.buffer).set(bytes, at);
    return [at, bytes.length];
  };
  const read = (answer) => {
    if (!answer) return null;
    const length = new DataView(api.memory.buffer).getUint32(answer, true);
    const text = decoder.decode(new Uint8Array(api.memory.buffer, answer + 4, length));
    api.leaf_free(answer, 4 + length);
    return text;
  };

  return {
    render(source, path) {
      const [text, textLen] = write(source);
      const [name, nameLen] = write(path);
      const answer = read(api.leaf_render(text, textLen, name, nameLen));
      api.leaf_free(text, textLen);
      api.leaf_free(name, nameLen);
      return answer ? JSON.parse(answer) : null;
    },
    formats: () => (read(api.leaf_formats()) || '').split(' ').filter(Boolean),
  };
}

/**
 * Load the renderer this page names and answer with what a reading view needs.
 *
 *   formats            every extension the app can read, off its own one table — never a second list in site code
 *   render(text, path) the document, as the app draws it: `{ title, html, format, … }`. The path decides the format, so a `.xml` gets the TEI reader and a `.json` the data one, with nothing here choosing.
 *   opens(path)        whether this renderer would read that file at all
 *
 * Throws when the module cannot be reached, which is a page telling its reader the renderer is down rather than sitting on a document that never arrives.
 */
export async function createLeaftext() {
  const base = rendererBase();
  const module_ = await load(new URL(MODULE_FILE, base));
  const formats = module_.formats();
  const pattern = new RegExp(`\\.(${formats.join('|')})$`, 'i');
  return {
    formats,
    opens: (path) => pattern.test(String(path).split(/[?#]/)[0]),
    render: (source, path) => module_.render(source, path || 'document.md'),
  };
}
