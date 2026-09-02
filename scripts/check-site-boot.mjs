#!/usr/bin/env node
// Boot the code that draws the two published sites, offline, and read the finished page.
//
//   node scripts/check-site-boot.mjs   fail on a script that cannot boot
//
// Nothing else in the suite ever runs these files: `check-site.mjs` reads paths out of them as text, and `check-shell.mjs` boots the app's own front end, which is a different program in a different page. So a typo in the loader, a missing export or a script that throws as it loads reaches a reader as a blank page, and the first thing that notices is somebody opening the site.
//
// The three stand-ins are a page, a fetch and the renderer module. They are stand-ins because the module is built into a folder `.gitignore` refuses and the network is not the suite's to reach — a check that needed either would skip itself on a fresh checkout, which is a check that passes by doing nothing.
//
// **What is read is the finished page, never the absence of a throw.** Both entry readers turn a mid-boot fault into a status line over whatever was already drawn, so a boot that died partway still resolves cleanly with content on the page. Every assertion below is on the end state.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

// The one table of what the app reads, shared with the other checks that ask it rather than copied into each.
import { appExtensions } from './app-formats.mjs';

// The stand-in page every boot below runs against — markup parsed into a tree, a query over what is standing, and events that reach a listener the way it was registered. A file of its own because this one reached the tree's line ceiling.
import { addListener, dispatch, escapeAttribute, escapeText, leafEvent, queryAll, removeListener, standInPage } from './check-site-boot/page.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

const problems = [];
const check = (name, run) => {
  try {
    const answer = run();
    return answer && typeof answer.then === 'function' ? answer.catch((error) => problems.push(`${name}: ${message(error)}`)) : answer;
  } catch (error) {
    problems.push(`${name}: ${message(error)}`);
    return undefined;
  }
};
const message = (error) => (error && error.message ? error.message : String(error));
// A boot does most of its work in promises nobody awaits, so a throw inside one would otherwise leave only a page that never finished.
process.on('unhandledRejection', (error) => problems.push(`something a boot started threw: ${message(error)}${error && error.stack ? '\n    ' + error.stack.split('\n').slice(1, 4).join('\n    ') : ''}`));
const want = (ok, said) => {
  if (!ok) throw new Error(said);
};

// ---- the stand-in module ----------------------------------------------------
//
// A real `WebAssembly.Memory` with a bump allocator behind it, so the length-prefixed byte protocol in `site/leaftext-core.js` is exercised rather than mocked away. The four arms are the loader's own — `leaf_alloc`, `leaf_free`, `leaf_render_bytes`, `leaf_formats` — which is why `check-shell.mjs`'s stand-in module cannot stand in here: it exports the browser host's.
//
// **There is no `leaf_render` arm on purpose.** A document arrives as the file's own bytes and the byte arm reads them; a page that still decodes one to text and calls the text arm throws here rather than passing, which is the whole of what a check over which arm the page calls is worth.

/** The waiting strip the renderer draws at the foot of every document, taken off `src/pager.rs` so the stand-in draws what the app draws. */
function waitingPager() {
  const source = read('src/pager.rs');
  const found = /r#"(<nav class="docs-pager docs-pager-loading[\s\S]*?)"#/.exec(source);
  if (!found) throw new Error('could not find the waiting pager strip in src/pager.rs');
  return found[1];
}

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** The six formats that are zips rather than text, so their words are inside the file rather than being it. */
const PACKAGED_FORMATS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

/** What a zip begins with, which is how the app tells a package from a file that merely ends `.docx`. */
const ARCHIVE_MARK = [0x50, 0x4b, 0x03, 0x04];

/** The byte a zip ends on. A real archive is read from its end first — the record saying what is inside sits there — and that end is a byte no UTF-8 decoder can carry, which is why a decoded package is refused here as it is by the app. */
const ARCHIVE_END = 0xff;

/**
 * A package as its bytes, for a check that serves one: the archive mark, the words, and a byte no UTF-8 decoder can read.
 *
 * That last byte is the point of it. A page reading this file as text gets a replacement character where the archive ends, so the file stops being an archive at all — which is exactly what the site did to every Word file before the pages handed bytes over, and what makes a check here fail rather than quietly pass.
 */
function packagedBytes(source) {
  const words = new TextEncoder().encode(source);
  const bytes = new Uint8Array(ARCHIVE_MARK.length + words.length + 1);
  bytes.set(ARCHIVE_MARK, 0);
  bytes.set(words, ARCHIVE_MARK.length);
  bytes[bytes.length - 1] = ARCHIVE_END;
  return bytes;
}

/** The words a document's bytes hold, or null where those bytes are not a document that format can read. Packaged formats are unpacked; everything else is decoded the way the window decodes a file it read off the disk, byte order mark and all. */
function sourceFromBytes(bytes, path) {
  const extension = (path.split('.').pop() || '').toLowerCase();
  if (PACKAGED_FORMATS.has(extension)) {
    if (!ARCHIVE_MARK.every((byte, at) => bytes[at] === byte)) return null;
    if (bytes[bytes.length - 1] !== ARCHIVE_END) return null;
    return new TextDecoder().decode(bytes.slice(ARCHIVE_MARK.length, bytes.length - 1));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.slice(3));
  return new TextDecoder().decode(bytes);
}

/** What the XML reader draws over bytes that are not the document their name says: a page titled after the file, holding one line. This is the fault the ticket is about, kept here so a page that goes back to text is read drawing it. */
function parseErrorDocument(path) {
  const name = path.split('/').pop() || path;
  const extension = (path.split('.').pop() || 'md').toLowerCase();
  return { title: name, html: `<p>XML parse error. unknown token at 1:1</p>\n${waitingPager()}`, format: extension };
}

/** A document as the module answers it: a title, HTML and the format. Headings and paragraphs, a line beginning with `<` kept as it stands, and the renderer's own waiting strip at the foot. */
function drawnDocument(source, path) {
  const html = [];
  let title = '';
  for (const block of source.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    if (text.startsWith('<')) {
      html.push(text);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      const level = heading[1].length;
      const words = inline(heading[2]);
      if (!title) title = heading[2].trim();
      html.push(`<h${level} id="${slug(heading[2])}">${words}</h${level}>`);
      continue;
    }
    html.push(`<p>${inline(text)}</p>`);
  }
  html.push(waitingPager());
  const extension = (path.split('.').pop() || 'md').toLowerCase();
  return { title, html: html.join('\n'), format: extension === 'md' ? 'markdown' : extension };
}

const inline = (text) => text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeAttribute(href)}">${escapeText(label)}</a>`);

/** The module, standing behind a stand-in `WebAssembly`. Nothing is fetched and no wasm is built. */
function standInModule() {
  const memory = new WebAssembly.Memory({ initial: 8 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let top = 8;
  const alloc = (length) => {
    const needed = top + length + 8;
    if (needed > memory.buffer.byteLength) memory.grow(Math.ceil((needed - memory.buffer.byteLength) / 65536) + 1);
    const at = top;
    top += Math.ceil(Math.max(length, 1) / 8) * 8;
    return at;
  };
  const borrow = (at, length) => decoder.decode(new Uint8Array(memory.buffer, at, length));
  const answer = (text) => {
    const bytes = encoder.encode(text);
    const at = alloc(bytes.length + 4);
    new DataView(memory.buffer).setUint32(at, bytes.length, true);
    new Uint8Array(memory.buffer).set(bytes, at + 4);
    return at;
  };
  let renders = 0;
  const exports = {
    memory,
    leaf_alloc: (length) => alloc(length),
    // A bump allocator hands nothing back, which is the whole of what a stand-in owes here: the page's job is to call this, and it does.
    leaf_free: () => {},
    // The one door every document on both sites comes through. Bytes, never text: the page hands over what the file holds and this is where a package stops being noise.
    leaf_render_bytes: (bodyAt, bodyLength, pathAt, pathLength) => {
      renders += 1;
      const path = borrow(pathAt, pathLength);
      const body = new Uint8Array(memory.buffer, bodyAt, bodyLength).slice();
      const source = sourceFromBytes(body, path);
      const document = source === null ? parseErrorDocument(path) : drawnDocument(source, path);
      return answer(JSON.stringify(document));
    },
    leaf_formats: () => answer(appExtensions(root).join(' ')),
  };
  return { exports, renders: () => renders };
}

/** `WebAssembly`, answering with the stand-in whichever way the loader asks — it streams first and falls back to the whole buffer when a host serves the module as anything but `application/wasm`. */
function standInWebAssembly(module_) {
  return {
    Memory: WebAssembly.Memory,
    instantiate: async () => ({ instance: { exports: module_.exports }, module: {} }),
    instantiateStreaming: async () => ({ instance: { exports: module_.exports }, module: {} }),
  };
}

// ---- the stand-in fetch -----------------------------------------------------
//
// One table of addresses on this site, resolved against the page asking, and nothing else reachable: an address off this origin throws, which is how the docs nav's first strategy is proved rather than assumed. Anything on this site with no entry answers 404, the way a static host does.

function standInResponse(body, { ok = true, status = 200 } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const response = {
    ok,
    status,
    headers: { get: () => 'text/plain' },
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    clone: () => standInResponse(bytes, { ok, status }),
  };
  return response;
}

function standInFetch(pageAddress, files) {
  const asked = [];
  const origin = new URL(pageAddress).origin;
  const fetch = async (url) => {
    const resolved = new URL(String(url), pageAddress);
    if (resolved.origin !== origin) throw new Error(`this check reaches no network, and something asked for ${resolved.href}`);
    asked.push(resolved.pathname);
    const body = files[resolved.pathname];
    return body === undefined ? standInResponse('', { ok: false, status: 404 }) : standInResponse(body);
  };
  fetch.asked = () => asked;
  return fetch;
}

// ---- the globals a browser has and Node does not -----------------------------

function standInWindow(document, address) {
  const listeners = new Map();
  const window = {
    document,
    listeners,
    innerWidth: 1200,
    innerHeight: 900,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    location: address,
    scrollTo(_left, top) {
      window.scrollY = Number(top) || 0;
    },
    addEventListener(type, handler, options) {
      addListener(listeners, type, handler, options);
    },
    removeEventListener(type, handler, options) {
      removeListener(listeners, type, handler, options);
    },
    // The same walk the page uses, so a window listener can be read back by dispatching rather than by reaching into the map behind it.
    dispatchEvent: (event) => dispatch(window, event),
    // Hover and a fine pointer, so the link tooltip installs rather than returning at its first line; the device is never dark, so the settings menu resolves `system` to light.
    matchMedia: (query) => ({ matches: /hover|pointer/.test(String(query)), media: String(query), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    setTimeout,
    clearTimeout,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    getComputedStyle: (element) => ({ getPropertyValue: (name) => (name === '--lt-space-8' ? '8px' : element.style.getPropertyValue(name)) }),
  };
  window.self = window;
  window.window = window;
  document.defaultView = window;
  return window;
}

/** A page's address, with a settable `href` — the front page's inline module changes the whole address to hand a docs link to the docs reader, and a stub that swallowed it could only report that nothing happened. */
function standInAddress(start) {
  let url = new URL(start);
  return {
    get href() {
      return url.href;
    },
    set href(value) {
      url = new URL(String(value), url);
    },
    get origin() {
      return url.origin;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hostname() {
      return url.hostname;
    },
    get hash() {
      return url.hash;
    },
    set hash(value) {
      url = new URL(String(value).startsWith('#') ? String(value) : '#' + String(value), url);
    },
    assign(value) {
      url = new URL(String(value), url);
    },
    replace(value) {
      url = new URL(String(value), url);
    },
  };
}

/** Everything the site's files reach for on a global, installed for one boot. */
function installGlobals({ document, window, fetch, wasm }) {
  const held = {
    document,
    window,
    self: window,
    location: window.location,
    fetch,
    WebAssembly: wasm,
    localStorage: storeStandIn(),
    navigator: { userAgent: 'leaftext-check', clipboard: undefined },
    matchMedia: window.matchMedia,
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    // On the global as well as on the window, because the site guards on `window.ResizeObserver` and then constructs the bare name — which is the same object in a browser and nothing at all here.
    ResizeObserver: window.ResizeObserver,
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    CSS: { escape: (value) => String(value).replace(/[^\w-]/g, (letter) => '\\' + letter) },
    history: { pushState() {}, replaceState() {}, back() {}, forward() {} },
  };
  for (const [name, value] of Object.entries(held)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  return held;
}

function storeStandIn() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
    removeItem: (key) => held.delete(key),
    clear: () => held.clear(),
  };
}

// ---- the stand-in page's own event walk --------------------------------------
//
// The harness, not the site, and everything below rests on it: a page that hands every event to every listener passes a listener a browser would never call.

check('the stand-in page calls a listener the way it was registered', () => {
  const document = standInPage('<html><body><article id="root"><p><img id="picture"></p></article></body></html>', 'https://leaf.test/');
  const window = standInWindow(document, standInAddress('https://leaf.test/'));
  const root = document.getElementById('root');
  const picture = document.getElementById('picture');
  const heard = [];
  const captures = () => heard.push('captures');
  const bubbles = () => heard.push('bubbles');

  // An image's `error` does not bubble, so of two listeners on the same ancestor a browser calls only the capturing one.
  root.addEventListener('error', captures, true);
  root.addEventListener('error', bubbles);
  picture.dispatchEvent(leafEvent('error'));
  want(heard.join(',') === 'captures', `an ancestor heard ${JSON.stringify(heard)} of an event a browser does not bubble, where it calls the capturing listener and nothing else`);

  // A browser matches on the handler and the capture flag together, so this takes off neither.
  heard.length = 0;
  root.removeEventListener('error', captures);
  picture.dispatchEvent(leafEvent('error'));
  want(heard.join(',') === 'captures', 'a removal with no capture flag took a capturing listener off, so the page reports gone a listener a browser still calls');
  heard.length = 0;
  root.removeEventListener('error', captures, true);
  picture.dispatchEvent(leafEvent('error'));
  want(heard.length === 0, 'a removal naming the capture flag left the listener standing');

  // The other half of the same pair: an event a browser does bubble reaches the listener that only bubbles.
  heard.length = 0;
  root.addEventListener('click', bubbles);
  picture.dispatchEvent(leafEvent('click'));
  want(heard.join(',') === 'bubbles', `a bubbling event reached ${JSON.stringify(heard)} above the element it happened on`);

  // `stopPropagation` ends the walk on the way down as it does on the way up.
  heard.length = 0;
  const stops = (event) => {
    heard.push('captures');
    event.stopPropagation();
  };
  root.addEventListener('click', stops, true);
  picture.dispatchEvent(leafEvent('click'));
  want(heard.join(',') === 'captures', `a capturing listener that stopped the walk was followed by ${JSON.stringify(heard.slice(1))}`);

  // A listener registered `once` is called once, and comes off before it is called — so a handler that dispatches its own type again does not re-enter itself.
  let counted = 0;
  const countOne = () => {
    counted += 1;
    if (counted < 5) picture.dispatchEvent(leafEvent('load'));
  };
  picture.addEventListener('load', countOne, { once: true });
  picture.dispatchEvent(leafEvent('load'));
  picture.dispatchEvent(leafEvent('load'));
  want(counted === 1, `a listener registered once was called ${counted} times, so a check counting what a picture triggers is counting something a browser would not do`);

  // `passive` promises a browser the handler will not cancel the event and nothing else, so the page takes it and calls the handler.
  let scrolled = 0;
  window.addEventListener('scroll', () => (scrolled += 1), { passive: true });
  window.dispatchEvent(leafEvent('scroll'));
  want(scrolled === 1, 'a window listener registered `{ passive: true }` was never called, so the flag was read as an options object with no listener behind it');
});

// ---- phase 1: the loader and the pager --------------------------------------

const loader = pathToFileURL(join(root, 'site/leaftext-core.js')).href;
const pagerModule = pathToFileURL(join(root, 'site/pager.js')).href;

const RENDERER_META = '<meta name="leaftext-renderer" content="assets/leaftext/">';

const module_ = standInModule();
{
  const document = standInPage(`<html><head><title>Leaftext</title>${RENDERER_META}</head><body><article id="content" class="markdown-body"></article></body></html>`, 'https://leaf.test/docs/');
  const window = standInWindow(document, standInAddress('https://leaf.test/docs/'));
  // The module's own bytes are never read — a stand-in `WebAssembly` answers with the arms — so what this has to serve is a response, at the address the page's own tag names.
  const fetch = standInFetch('https://leaf.test/docs/', { '/docs/assets/leaftext/leaftext.wasm': 'a module nothing parses' });
  installGlobals({ document, window, fetch, wasm: standInWebAssembly(module_) });
}

const { rendererBase, createLeaftext } = await import(loader);
// The deadline every page fetch now runs under. Its real limit is ten seconds of silence, which is a check that sits still for ten seconds, so the stall below sets its own and puts the real one back.
const { setSilenceLimit, fetchWatched } = await import(pathToFileURL(join(root, 'site/fetches.js')).href);
// The publish's own bake, run here rather than described: the page the front reader is booted over below is the page a visitor is served.
const { bakeFrontPage } = await import(pathToFileURL(join(root, 'scripts/site-assets.mjs')).href);
const { fillPager } = await import(pagerModule);
const { installPictureFallback } = await import(pathToFileURL(join(root, 'site/pictures.js')).href);
const { installLinkTooltip } = await import(pathToFileURL(join(root, 'site/link-tooltip.js')).href);
const { initMinimap } = await import(pathToFileURL(join(root, 'site/minimap.js')).href);

check('a page naming no renderer', () => {
  const bare = standInPage('<html><head><title>Nothing</title></head><body></body></html>', 'https://leaf.test/');
  let threw = null;
  try {
    rendererBase(bare);
  } catch (error) {
    threw = error;
  }
  want(threw, 'a page with no <meta name="leaftext-renderer"> loaded a renderer anyway, so it reaches across a network nobody asked it to');
  want(/leaftext-renderer/.test(threw.message), `the page was refused with a message that does not name the tag it wants: ${threw.message}`);
});

check('a relative renderer folder', () => {
  const page = standInPage(`<html><head>${RENDERER_META}</head><body></body></html>`, 'https://leaf.test/docs/');
  want(rendererBase(page).href === 'https://leaf.test/docs/assets/leaftext/', `a relative folder resolved to ${rendererBase(page).href}, not against the page that named it`);
  const rooted = standInPage('<html><head><meta name="leaftext-renderer" content="/assets/leaftext/"></head><body></body></html>', 'https://leaf.test/docs/');
  want(rendererBase(rooted).href === 'https://leaf.test/assets/leaftext/', `a rooted folder resolved to ${rendererBase(rooted).href}`);
  const unslashed = standInPage('<html><head><meta name="leaftext-renderer" content="/assets/leaftext"></head><body></body></html>', 'https://leaf.test/');
  want(rendererBase(unslashed).href === 'https://leaf.test/assets/leaftext/', 'a folder written without its trailing slash lost its last segment');
});

await check('the loader over the stand-in module', async () => {
  const leaf = await createLeaftext();
  const extensions = appExtensions(root);
  want(leaf.formats.join(' ') === extensions.join(' '), `the loader answered ${leaf.formats.join(' ')}, not the app's own table`);
  for (const extension of extensions) want(leaf.opens(`a/document.${extension}`), `the loader says it cannot open a .${extension}, which its own format list names`);
  want(leaf.opens('README.MD'), 'an extension in capitals was refused, and a real folder holds those');
  want(leaf.opens('page.md#a-heading') && leaf.opens('page.md?v=2'), 'an anchor or a query stopped a document being a document');
  want(!leaf.opens('notes.pdf') && !leaf.opens('mdown'), 'the loader opens a file the app cannot read');
  const drawn = leaf.render('# A document\n\nA paragraph.', 'notes.md');
  want(drawn && drawn.title === 'A document', `the loader drew ${drawn ? JSON.stringify(drawn.title) : 'nothing'} as the title`);
  want(drawn.html.includes('<h1 id="a-document">'), 'the drawn document came back without the heading the module rendered');
  want(drawn.html.includes('docs-pager-loading'), "the drawn document has no waiting strip, so the pager's own check below would prove nothing");
});

check('the pager fills the strip', () => {
  const document = globalThis.document;
  const content = document.createElement('article');
  content.innerHTML = drawnDocument('# One\n\nText.', 'one.md').html;
  want(content.querySelector('.docs-pager-loading'), 'the waiting strip written into a page could not be queried back, which is markup a script wrote in');
  fillPager(content, { href: '#/one', label: 'One' }, { href: '#/two', label: 'Two' });
  const strip = content.querySelector('.docs-pager');
  want(strip, 'the strip is gone after being filled with two neighbors');
  want(!strip.classList.contains('docs-pager-loading'), 'the filled strip is still waiting, so a reader watches it spin over two buttons that are already there');
  want(!strip.hasAttribute('aria-busy'), 'the filled strip still says it is busy');
  const previous = strip.querySelector('.docs-pager-prev');
  const next = strip.querySelector('.docs-pager-next');
  want(previous && next, 'the filled strip is missing a button');
  want(previous.getAttribute('href') === '#/one' && next.getAttribute('href') === '#/two', 'a pager button points somewhere other than the page it was given');
  want(next.getAttribute('data-pager-title') === 'Two', 'a pager button lost the page name its hover card reads');
  want(next.textContent.includes('Two'), 'a pager button does not name the page it opens');
});

check('the pager takes the strip out', () => {
  const document = globalThis.document;
  const alone = document.createElement('article');
  alone.innerHTML = drawnDocument('# Alone\n\nText.', 'alone.md').html;
  fillPager(alone, null, null);
  want(!alone.querySelector('.docs-pager'), 'a document with no neighbors kept the waiting strip, which is a promise the page cannot keep');
  const oneSided = document.createElement('article');
  oneSided.innerHTML = drawnDocument('# Side\n\nText.', 'side.md').html;
  fillPager(oneSided, null, { href: '#/next', label: 'Next page' });
  const strip = oneSided.querySelector('.docs-pager');
  want(strip && !strip.querySelector('.docs-pager-prev'), 'a document with one neighbor drew a button for the one it does not have');
  want(strip.querySelector('.docs-pager-next'), 'a document with one neighbor lost the button it does have');
  const bare = document.createElement('article');
  bare.innerHTML = '<p>No strip in this one.</p>';
  fillPager(bare, { href: '#/one', label: 'One' }, null);
  want(bare.innerHTML === '<p>No strip in this one.</p>', 'a document the renderer left no strip in was written into anyway');
});

check('a picture a browser cannot decode falls back to the PNG beside it', () => {
  const document = globalThis.document;
  const content = document.createElement('article');
  content.innerHTML = '<p><img src="imgs/one.webp" alt="one"><img src="imgs/two.webp" alt="two"><img src="imgs/three.png" alt="three"></p>';
  const [one, two, three] = content.querySelectorAll('img');
  // What the browser had already decided before the module ran: a picture it could not decode is finished with no width, and one that drew is finished with a width.
  one.complete = true;
  two.complete = true;
  two.naturalWidth = 800;
  three.complete = true;
  installPictureFallback(content);
  want(one.getAttribute('src') === 'imgs/one.png', 'a picture that was already standing there failed and was left naming the WebP, which is the broken frame on the front page the publish bakes');
  want(two.getAttribute('src') === 'imgs/two.webp', 'a picture that drew perfectly was moved onto the PNG, so every reader now fetches the heavier set');
  want(three.getAttribute('src') === 'imgs/three.png', 'a picture that was never a WebP was rewritten');
  // The other half: one that fails after the sweep has run, which is every picture on a page the reader drew itself.
  two.naturalWidth = 0;
  two.dispatchEvent(leafEvent('error', { target: two }));
  want(two.getAttribute('src') === 'imgs/two.png', 'a picture that failed after the page was drawn kept its WebP address');
  // The PNG failing too must not send it round again.
  one.setAttribute('src', 'imgs/one.webp');
  one.dispatchEvent(leafEvent('error', { target: one }));
  want(one.getAttribute('src') === 'imgs/one.webp', 'a picture already put back once was swapped again, so a folder with no PNG loops');
  // The docs reader draws every route into one article, so the second call must sweep without stacking a second listener.
  installPictureFallback(content);
  want((content.listeners.get('error') || []).length === 1, 'the listener went on twice, so one failure is answered twice');
});

check('the link tooltip is taken down by a scroll under it', () => {
  const document = globalThis.document;
  const holder = document.createElement('article');
  holder.innerHTML = '<p id="tooltip-line"><a href="https://example.test/">a link</a></p>';
  document.body.appendChild(holder);
  installLinkTooltip(holder);
  const tip = document.querySelector('.link-hover-tip');
  const link = holder.querySelector('a');
  want(tip, 'the tooltip was never put on the page, so there is nothing here to take down');
  link.dispatchEvent(leafEvent('pointerover', { target: link }));
  want(!tip.hidden, 'hovering a link never raised the tooltip, so what a scroll does to it cannot be read');
  // On a child rather than on the element the listener sits on: a listener on its own target is called whatever flag it carries, so a scroll dispatched at `holder` would pass with the capture gone and prove nothing.
  document.getElementById('tooltip-line').dispatchEvent(leafEvent('scroll'));
  want(tip.hidden, 'the page scrolled and the tooltip stayed standing over a link that has moved out from under it');
  holder.remove();
  tip.remove();
});

await check('a picture that arrives rebuilds the minimap once rather than on every event it fires', async () => {
  const document = globalThis.document;
  const source = document.createElement('article');
  source.innerHTML = '<h1>One</h1><p><img id="late" src="imgs/one.png"></p>';
  // What the reading column is laid out at; the thumbnail is scaled off it.
  source.layoutWidth = 700;
  document.body.appendChild(source);
  // A picture still on its way, which is the only kind the script watches — one already standing needs no listener — and what a picture on this page is until a check says otherwise.
  const late = document.getElementById('late');
  initMinimap(source);
  const rail = document.querySelector('.document-minimap');
  const held = rail.querySelector('.document-minimap-content');
  // The width the stylesheet lays a visible rail out at, on the rail and on what the thumbnail is scaled to; a rail measuring nothing is one it took off the page and gets no thumbnail.
  rail.layoutWidth = 62;
  held.clientWidth = 62;

  late.dispatchEvent(leafEvent('load'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const drawn = held.firstChild;
  want(drawn, 'a picture arriving never rebuilt the thumbnail, so there is nothing here to count');
  // The rebuild replaces the whole clone, so a second one is a different node standing where the first was.
  late.dispatchEvent(leafEvent('load'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  want(held.firstChild === drawn, 'a second event from the same picture rebuilt the whole thumbnail again, so a listener registered once is being called every time the picture speaks');

  // The rail's own window listener, read back by dispatching rather than by reaching into the map. The handler takes no event, so the window is the honest place to fire from: this is the page having scrolled.
  const viewport = rail.querySelector('.document-minimap-viewport');
  const document_ = document.documentElement;
  document_.scrollHeight = 4000;
  viewport.style.top = '';
  globalThis.window.scrollY = 2000;
  globalThis.window.dispatchEvent(leafEvent('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  want(viewport.style.top && viewport.style.top !== '0px', `the page scrolled and the rectangle in the rail stayed at ${JSON.stringify(viewport.style.top)}, so the window's own listener was never reached`);
  globalThis.window.scrollY = 0;
  source.remove();
  rail.remove();
});

// ---- phase 2: both entry readers --------------------------------------------
//
// The documents below are fixtures, not the site's own pages: what is under test is the code between the module and a reader, and a fixture is the only way to say what the finished page should hold. Every address one of them asks for is served here, so a reader that reached anywhere else fails rather than quietly falling back.

const SITE_README = [
  '# Leaftext',
  'A reader for your own documents. The source is at https://github.com/leaftext/leaftext, and the guide starts at [the introduction](docs/01-introduction.md).',
  'A [vault](docs/GLOSSARY.md#vault) is a folder you pointed the app at.',
  '<blockquote><p>One line<br>and the next</p></blockquote>',
  '<pre class="highlight" data-language="rust"><code class="language-rust">fn main() {}</code></pre>',
  // A picture, so a boot meets the two paths that read one: the fallback that puts a WebP the browser refused back on the PNG beside it, and the thumbnail that waits for one still arriving.
  '<p><img src="imgs/one.webp" alt="one"></p>',
  '## Reading a document',
  'The document is drawn first and edited in place.',
].join('\n\n');

const DOCS_README = ['# Documentation', 'Every page of the guide, starting with [the introduction](01-introduction.md).', '<blockquote><p>One line<br>and the next</p></blockquote>', '## What is here', 'The list is built from the folder itself, so a page appears by existing.'].join('\n\n');

const GLOSSARY = ['# Glossary', '## Vault', 'A folder you told the app to watch.', '## Locus', "A block's address in a document."].join('\n\n');

const INTRODUCTION = ['# Introduction', 'What the app is for.'].join('\n\n');

const listing = (title, names) => `<html><head><title>Index of ${title}</title></head><body><h1>Index of ${title}</h1><ul>` + [`<li><a href="../">../</a></li>`, ...names.map((name) => `<li><a href="${name}">${name}</a></li>`)].join('') + '</ul></body></html>';

const SITE_FILES = {
  '/assets/leaftext/leaftext.wasm': 'a module nothing parses',
  '/README.md': SITE_README,
  '/docs/': listing('/docs/', ['README.md', 'GLOSSARY.md', '01-introduction.md', 'guide/']),
  '/docs/guide/': listing('/docs/guide/', ['README.md', 'themes.md']),
  '/docs/README.md': DOCS_README,
  '/docs/GLOSSARY.md': GLOSSARY,
  '/docs/01-introduction.md': INTRODUCTION,
  '/docs/guide/README.md': '# Guide\n\nHow to use it.',
  '/docs/guide/themes.md': '# Themes\n\nEleven families.',
};

/** A Word file sitting beside the guide's pages: a package, so its words are inside the file rather than being it. */
const REPORT = ['# Quarterly report', 'What the quarter did.'].join('\n\n');

/** The same guide, plus a package and a page written in UTF-16 — the two shapes a document arrives in that a decode to text loses. */
const PACKAGED_FILES = {
  ...SITE_FILES,
  '/docs/report.docx': packagedBytes(REPORT),
  '/docs/marked.md': utf16Bytes('# Marked\n\nWritten with a byte order mark on the front.'),
};

/** A document written the way an editor on Windows still writes one: UTF-16, little-endian, with the mark that says so. Read as UTF-8 it is a heading nobody can see. */
function utf16Bytes(source) {
  const bytes = new Uint8Array(2 + source.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  const view = new DataView(bytes.buffer);
  for (let at = 0; at < source.length; at += 1) view.setUint16(2 + at * 2, source.charCodeAt(at), true);
  return bytes;
}

/** Wait for the page to settle, or give up — a reader boots through several awaited fetches, and there is nothing to read until they land. */
async function settled(done, said) {
  for (let tries = 0; tries < 600; tries += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(said);
}

let boots = 0;

/** One reader, booted against its own page. Every import carries a fresh query, because Node keys its module cache on the resolved URL: without one a second boot returns the first instance, runs nothing, and reports a boot that never happened. */
async function bootReader(file, page, address, files, { wrap = null, markup = null, from = root, mermaid = null } = {}) {
  const document = standInPage(markup || read(page), address);
  const window = standInWindow(document, standInAddress(address));
  if (mermaid) window.mermaid = mermaid;
  const fetch = wrap ? wrap(standInFetch(address, files), address) : standInFetch(address, files);
  const module_ = standInModule();
  installGlobals({ document, window, fetch, wasm: standInWebAssembly(module_) });
  boots += 1;
  await import(pathToFileURL(join(from, file)).href + `?boot=${boots}`);
  return { document, window, fetch, module_ };
}

const frontPage = await check('the front page boots', async () => {
  const page = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES);
  const { document } = page;
  const content = document.getElementById('content');
  await settled(() => content.childNodes.length > 0 && document.getElementById('status').hidden, 'the front page never finished: its content stayed empty or its status line stayed up');
  want(document.getElementById('status').hidden, 'the front page left its status line standing, which is the reader saying it gave up over whatever it had already drawn');
  want(content.querySelector('h1'), 'the front page has no heading in it, so the module rendered nothing the page kept');
  want(content.textContent.includes('drawn first and edited in place'), "the front page is missing the README's own words");
  want(document.title === 'Leaftext', `the browser tab reads ${JSON.stringify(document.title)}, not the document's own title`);
  want(!content.querySelector('.docs-pager'), 'the one README kept a Previous/Next strip, which is a promise a single-page site cannot keep');
  // The helpers each entry pulls in, read off the page rather than off the absence of a throw: a helper that failed leaves its own mark missing.
  want(content.querySelector('.document-outline'), 'no outline was built, so the pass over the headings did not run');
  want(content.querySelector('.has-anchor-link'), 'no block carries a gutter permalink, so the numbering pass did not run');
  want(content.querySelector('.code-copy'), 'a fenced block has no copy button');
  want(content.querySelector('.blockquote-line'), 'a verse blockquote was not split into its lines');
  want(document.getElementById('siteSettings'), 'the settings menu is not on the page');
  want(document.querySelector('.document-minimap'), 'the minimap rail was never built');
  return page;
});

/** The one picture the front page's fixture carries, on the page a boot drew. */
const pictureOn = (page) => page.document.getElementById('content').querySelector('img');

check('a picture still on its way keeps its address and is waited for', () => {
  // The ordinary reader: a browser that reads WebP is handed the WebP, and the thumbnail redraws itself once the picture lands and the page reflows around it. Neither half could be read off a page before, because every element on one claimed to have finished with nothing to show.
  const picture = pictureOn(frontPage);
  want(picture, 'the front page drew no picture, so neither path that reads one was reached at all');
  want(picture.getAttribute('src') === 'imgs/one.webp', `a picture nothing had failed on is asking for ${JSON.stringify(picture.getAttribute('src'))}, so every reader whose browser reads WebP fetches the heavier set`);
  want(!picture.dataset.pictureFallback, 'a picture nothing had failed on was marked as already put back, so its own failure later would be ignored');
  const load = (picture.listeners.get('load') || []).length;
  const failed = (picture.listeners.get('error') || []).length;
  want(load === 1, `a picture still arriving carries ${load} load listeners, so the thumbnail is drawn against a document the picture has not taken its room in yet and never redrawn`);
  want(failed === 1, 'a picture still arriving is not watched for failing, so the thumbnail keeps a gap where one never came');
});

check('a picture that fails after the page is drawn goes to the PNG beside it', () => {
  // The rare reader, on a page rather than on an element built by hand: the listener half of the fallback, reached through the walk the drawn document actually carries.
  const picture = pictureOn(frontPage);
  picture.dispatchEvent(leafEvent('error', { target: picture }));
  want(picture.getAttribute('src') === 'imgs/one.png', `a picture the browser refused is still asking for ${JSON.stringify(picture.getAttribute('src'))}, so the reader is left looking at a broken frame`);
  want(picture.dataset.pictureFallback === 'png', 'the picture was put back without being marked, so a PNG that also fails sends it round again');
});

/** The rail after a boot, and the thumbnail element the script draws into. */
const railOf = (page) => ({ rail: page.document.querySelector('.document-minimap'), content: page.document.querySelector('.document-minimap-content') });

await check('the minimap draws into a rail the stylesheet left on the page and into nothing otherwise', async () => {
  // A default boot measures nothing, which is what a rail the stylesheet took off the page measures; giving one a width is the stylesheet leaving it there.
  const gone = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES);
  await settled(() => gone.document.getElementById('content').childNodes.length > 0 && railOf(gone).content, 'the reader never finished, so there was no rail to read');
  await new Promise((resolve) => setTimeout(resolve, 20));
  want(railOf(gone).content.childNodes.length === 0, 'a rail measuring nothing was given a thumbnail, which is the script drawing every scroll frame into something no reader can see');

  const laidOut = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES);
  await settled(() => laidOut.document.getElementById('content').childNodes.length > 0 && railOf(laidOut).content, 'the second reader never finished');
  const { rail, content } = railOf(laidOut);
  // What the stylesheet's own --minimap-width lays a visible rail out at.
  rail.layoutWidth = 62;
  laidOut.window.dispatchEvent(leafEvent('resize'));
  await settled(() => content.childNodes.length > 0, 'a rail the stylesheet left on the page was never given a thumbnail, so the script gave up on a rail a reader can see');
  want(content.querySelector('.document-minimap-preview'), 'the rail was filled with something that is not the document thumbnail');
});

await check('a boot that failed is not read as a pass', async () => {
  // The same reader, with no README anywhere: it catches the fault into its status line, and this is what stops that reading as a finished page.
  const page = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', { '/assets/leaftext/leaftext.wasm': 'a module nothing parses' });
  const status = page.document.getElementById('status');
  // The page ships with its status line hidden and empty, so what is waited for is that line speaking at all.
  await settled(() => !status.hidden && status.textContent, 'a boot with no document to draw never said so: its page is still blank and silent, which is a reader who cannot tell a slow page from a dead one');
  want(!status.hidden, 'a reader that could not find a document said nothing');
  want(page.document.getElementById('content').childNodes.length === 0, 'a failed boot drew something anyway');
  want(status.textContent.includes('Could not load'), `the status line says ${JSON.stringify(status.textContent)}`);
});

/** A fetch that never answers for one path, which is the fault this whole ticket is about: a connection that neither finishes nor fails. */
function stallsOn(path) {
  return (base, address) => {
    const fetch = async (url, options) => {
      if (new URL(String(url), address).pathname === path) return new Promise(() => {});
      return base(url, options);
    };
    fetch.asked = base.asked;
    return fetch;
  };
}

/** A fetch whose first attempt at one path dies, the way a dropped connection does, and whose second is answered. */
function diesOnceOn(path) {
  return (base, address) => {
    let died = false;
    const fetch = async (url, options) => {
      if (new URL(String(url), address).pathname === path && !died) {
        died = true;
        throw new Error('the connection dropped');
      }
      return base(url, options);
    };
    fetch.asked = base.asked;
    return fetch;
  };
}

await check('a fetch that never answers ends as a sentence rather than a wait', async () => {
  // Ten real seconds of silence is the live limit; this check sets its own and puts the real one back, which is the whole reason the limit is settable.
  setSilenceLimit(30);
  try {
    const page = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES, { wrap: stallsOn('/assets/leaftext/leaftext.wasm') });
    const status = page.document.getElementById('status');
    await settled(() => !status.hidden && status.textContent, 'a page whose renderer never answered is still sitting there silent, which is the fault: a reader cannot tell it from a slow one and only a refresh gets past it');
    want(status.textContent.includes('could not be loaded'), `the status line says ${JSON.stringify(status.textContent)}`);
    want(status.textContent.includes('stopped waiting'), 'the page gave up without saying the connection went quiet, so a reader is told the renderer is broken when it is the network');
    want(page.document.getElementById('content').childNodes.length === 0, 'a page that drew nothing claimed to have drawn something');
  } finally {
    setSilenceLimit();
  }
});

await check('a fetch that dies once is answered on the retry', async () => {
  const page = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES, { wrap: diesOnceOn('/assets/leaftext/leaftext.wasm') });
  const { document, fetch } = page;
  const content = document.getElementById('content');
  await settled(() => content.childNodes.length > 0 && document.getElementById('status').hidden, 'a connection that dropped once and would have been answered the second time was never asked again, so the reader gave up on a page that was there');
  want(content.textContent.includes('drawn first and edited in place'), "the retry drew a page without the README's own words in it");
  want(fetch.asked().filter((path) => path === '/assets/leaftext/leaftext.wasm').length === 1, 'the module was asked for more than once after it answered, so the retry runs over a connection that did not fail');
});

await check('a body that stops halfway is not waited on for ever', async () => {
  // The two boots above stall before the answer arrives. This one answers, hands over some of the body and then goes quiet — the case a deadline on the answer alone would sit through, and the reason the deadline is bumped by every chunk rather than set once.
  setSilenceLimit(30);
  const wasFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('the first bytes arrived'));
          },
        }),
        { status: 200 },
      );
    let said = null;
    try {
      await fetchWatched('https://leaf.test/half-a-document.md');
    } catch (error) {
      said = message(error);
    }
    want(said, 'a body that arrived halfway and then went quiet was waited on for ever, which is the fault with the wait moved one step later');
    want(said.includes('stopped waiting'), `the wait ended saying ${JSON.stringify(said)}`);
  } finally {
    globalThis.fetch = wasFetch;
    setSilenceLimit();
  }
});

await check('a front page baked at publish is read as drawn', async () => {
  // What the publish uploads: the same markup, with the document already written into its content element. Nothing here is waited for, so nothing here can stall.
  const baked = bakeFrontPage(read('index.html'), { html: drawnDocument(SITE_README, 'README.md').html });
  const page = await bootReader('site/reader.js', 'index.html', 'https://leaf.test/', SITE_FILES, { markup: baked });
  const { document, fetch } = page;
  const content = document.getElementById('content');
  want(content.textContent.includes('drawn first and edited in place'), 'the baked page lost the words the publish wrote into it');
  await settled(() => content.querySelector('.document-outline'), 'the baked page was never decorated, so its words are there and nothing else is');
  want(!fetch.asked().includes('/README.md'), 'the baked page fetched the README it was already holding, which is the second wait this change exists to remove');
  want(document.getElementById('status').hidden, 'the baked page left a status line standing over a document it had already drawn');
  want(document.title === 'Leaftext', `the browser tab reads ${JSON.stringify(document.title)}, not the document's own title`);
  want(content.querySelector('.has-anchor-link'), 'no block on the baked page carries a gutter permalink, so the numbering pass did not run');
  want(!content.querySelector('.docs-pager'), 'the baked page kept a Previous/Next strip, which is a promise a single-page site cannot keep');
  want(document.querySelector('.document-minimap'), 'the baked page has no minimap rail');
  // The renderer still arrives, and what it is for now is the glossary rather than the document: the auto-linker runs only once the module has answered.
  await settled(() => fetch.asked().includes('/docs/GLOSSARY.md'), 'the renderer never reached the baked page, so the words the glossary defines would never be linked to their entries');
});

const docsPage = await check('the docs reader boots', async () => {
  const page = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/', SITE_FILES);
  const { document, fetch } = page;
  const content = document.getElementById('content');
  const sidebar = document.getElementById('sidebar');
  await settled(() => content.childNodes.length > 0 && document.getElementById('status').hidden, 'the docs reader never finished: its content stayed empty or its status line stayed up');
  want(document.getElementById('status').hidden, 'the docs reader left its status line standing over whatever it had drawn');
  want(content.textContent.includes('built from the folder itself'), "the docs index is missing the README's own words");
  want(document.title === 'Documentation — Leaftext', `the browser tab reads ${JSON.stringify(document.title)}, which is not the page and the site`);
  // The nav is the whole reason this reader exists, and it is built from a listing rather than from a list anybody maintains.
  const links = sidebar.querySelectorAll('.docs-nav-link');
  want(links.length >= 2, `the sidebar carries ${links.length} links, so the tree it was built from did not arrive`);
  want(links.some((link) => link.textContent === 'Introduction'), 'the sidebar dropped a page the folder listing named');
  want(sidebar.querySelectorAll('.docs-nav-group').length === 1, 'a folder in the listing became no group in the sidebar');
  want(links.every((link) => !/^\d/.test(link.getAttribute('data-route'))), "a page's ordering prefix reached its address");
  want(document.getElementById('mobileNav').querySelectorAll('option').length >= 3, 'the mobile page list is empty');
  // The strip the renderer left waiting, filled from the sidebar's order rather than from anything the page holds.
  const strip = content.querySelector('.docs-pager');
  want(strip && !strip.classList.contains('docs-pager-loading'), 'the docs index kept a waiting strip, which is the fault that cost a browser session to find');
  want(strip.querySelector('.docs-pager-next'), 'the index has no Next button, though the sidebar knows what follows it');
  want(!strip.querySelector('.docs-pager-prev'), 'the index drew a Previous button, and nothing comes before it');
  // The first strategy is a directory listing; the second is the GitHub API, which is off this origin and would have thrown.
  want(fetch.asked().includes('/docs/'), 'the nav never asked for a directory listing, so it went straight to the API');
  want(fetch.asked().includes('/README.md'), "the site's own README was never read, so the repo behind the fallback is unknown");
  return page;
});

/** One address served the way `res.text()` leaves it: the bytes decoded to a string and encoded again. A package loses its words that way and a byte order mark takes the heading with it, which is what a page reaching for text rather than bytes hands the module. */
function decodedOn(path) {
  return (base, address) => {
    const fetch = async (url, options) => {
      const response = await base(url, options);
      if (new URL(String(url), address).pathname !== path) return response;
      return {
        ...response,
        arrayBuffer: async () => {
          const bytes = new Uint8Array(await response.arrayBuffer());
          return new TextEncoder().encode(new TextDecoder().decode(bytes)).buffer;
        },
      };
    };
    fetch.asked = base.asked;
    return fetch;
  };
}

await check('the docs reader draws a Word file, and draws the parse error where the page decoded it first', async () => {
  const drawn = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/#/report.docx', PACKAGED_FILES);
  const words = drawn.document.getElementById('content');
  await settled(() => words.childNodes.length > 0, 'the docs reader never drew the Word file it routed to');
  want(words.textContent.includes('What the quarter did'), `the Word file drew as ${JSON.stringify(words.textContent.slice(0, 120))}, not its own words`);
  want(!words.textContent.includes('parse error'), 'the Word file drew as a parse error, so the page handed the module a decode of it rather than its bytes');
  want(drawn.document.title.startsWith('Quarterly report'), `the browser tab reads ${JSON.stringify(drawn.document.title)}, not the document's own title`);

  // The same file, one decode earlier: this is what the reader met before the pages handed bytes over, and it is a page blaming the file rather than saying the site cannot read it.
  const lost = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/#/report.docx', PACKAGED_FILES, { wrap: decodedOn('/docs/report.docx') });
  const ruined = lost.document.getElementById('content');
  await settled(() => ruined.childNodes.length > 0, 'the decoded Word file drew nothing at all, where the fault is that it draws something wrong');
  want(ruined.textContent.includes('parse error'), 'a Word file decoded to text drew as a document rather than as the parse error the XML reader gives it, so this check would pass over the fault it exists to hold');
});

await check('a plain document and one written with a byte order mark both draw through that same call', async () => {
  const plain = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/#/01-introduction', PACKAGED_FILES);
  const words = plain.document.getElementById('content');
  await settled(() => words.childNodes.length > 0, 'the docs reader never drew a plain Markdown page');
  want(words.textContent.includes('What the app is for'), `the Markdown page drew as ${JSON.stringify(words.textContent.slice(0, 120))}`);

  const marked = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/#/marked.md', PACKAGED_FILES);
  const heading = marked.document.getElementById('content');
  await settled(() => heading.childNodes.length > 0, 'the docs reader never drew the byte-order-marked page');
  want(marked.document.title.startsWith('Marked'), `a document written in UTF-16 drew under the tab title ${JSON.stringify(marked.document.title)}, so its mark reached the renderer as words`);
  want(heading.textContent.includes('byte order mark on the front'), 'the byte-order-marked page lost its words, which is a document nobody thought was broken breaking here');
});

await check('both published readers give a flowchart group title its natural width and spacing', async () => {
  for (const [file, page, address, sourcePath, source] of [
    ['site/reader.js', 'index.html', 'https://leaf.test/', '/README.md', SITE_README],
    ['docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/', '/docs/README.md', DOCS_README],
  ]) {
    const configs = [];
    const mermaid = {
      initialize: (config) => configs.push(config),
      run: async ({ nodes }) => nodes.forEach((node) => (node.dataset.processed = 'true')),
    };
    const files = { ...SITE_FILES, [sourcePath]: `${source}\n\n<pre class="mermaid">flowchart TD\n  subgraph One\n    A\n  end</pre>` };
    const booted = await bootReader(file, page, address, files, { mermaid });
    await settled(() => configs.length > 0, `${file} never handed its diagram configuration to Mermaid`);
    const config = configs[0];
    want(config.flowchart.subGraphTitleMargin.top === 8 && config.flowchart.subGraphTitleMargin.bottom === 8, `${file} gave a group title ${JSON.stringify(config.flowchart && config.flowchart.subGraphTitleMargin)} rather than eight pixels on both sides`);
    want(/\.cluster-label div/.test(config.themeCSS) && /white-space:\s*nowrap/.test(config.themeCSS) && /max-width:\s*none/.test(config.themeCSS), `${file} handed Mermaid no one-line group-title rule`);
    want(booted.document.getElementById('content').querySelector('pre.mermaid').dataset.processed === 'true', `${file} configured Mermaid without drawing the group`);
  }
});

check('a route link inside a document reaches the router', () => {
  const { document } = docsPage;
  const content = document.getElementById('content');
  // The pager's own buttons are inside the rendered document, so the in-page-anchor branch would look for an element with the id "/introduction", find none, and cancel the click — which is what a reader sees as a button that does nothing.
  const next = content.querySelector('.docs-pager-next');
  want(next && next.getAttribute('href').startsWith('#/'), 'the Next button does not carry a route');
  const press = leafEvent('click', { target: next });
  dispatch(next, press);
  want(!press.defaultPrevented, 'the Next button was canceled by the page, so the address never changes and the button does nothing');
  const jump = content.querySelector('a[href^="#"]:not([href^="#/"])') || (() => {
    const link = document.createElement('a');
    link.setAttribute('href', '#what-is-here');
    content.appendChild(link);
    return link;
  })();
  const inPage = leafEvent('click', { target: jump });
  dispatch(jump, inPage);
  want(inPage.defaultPrevented, 'an in-page jump was left to the browser, so the reader loses the route it is on');
});

check('a quoted passage broken into lines is drawn as those lines', () => {
  const { document } = docsPage;
  const paragraph = document.getElementById('content').querySelector('.blockquote-lines');
  want(paragraph, 'a hard-broken quote on a documentation page kept one paragraph, so the hanging indent steps every line after the first to the right and verse comes out as a staircase');
  want(paragraph.querySelectorAll('.blockquote-line').length === 2, 'a quote broken once did not come out as two lines');
});

await check('the glossary is fetched from wherever the tree says it is', async () => {
  // This folder holds one, so it is a page of the folder and asked for beside the others.
  await settled(() => docsPage.fetch.asked().includes('/docs/GLOSSARY.md'), 'the reader never asked for the glossary its own folder holds, so no word on any page links to its entry');
  // A folder holding none: that site keeps its glossary one level up, and the reader climbs out for it rather than asking this folder for one it does not have.
  const above = { ...SITE_FILES, '/docs/': listing('/docs/', ['README.md', '01-introduction.md', 'guide/']), '/GLOSSARY.md': GLOSSARY };
  delete above['/docs/GLOSSARY.md'];
  const page = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/', above);
  const content = page.document.getElementById('content');
  await settled(() => content.childNodes.length > 0, 'the reader drew nothing at all on a site whose glossary sits above the documentation folder');
  await settled(() => page.fetch.asked().includes('/GLOSSARY.md'), "a folder with no glossary in it never sent the reader up to the site's own, so that site loses every glossary link it has");
  want(!page.fetch.asked().includes('/docs/GLOSSARY.md'), 'the reader asked this folder for a glossary the tree had already said it does not hold');
});

await check('the docs reader draws when the origin carries no picture fallback', async () => {
  const scratch = checkoutWithout('site/pictures.js');
  try {
    const { document } = await bootReader('docs/docs.js', 'docs/index.html', 'https://leaf.test/docs/', SITE_FILES, { from: scratch });
    const content = document.getElementById('content');
    await settled(() => content.childNodes.length > 0 && document.getElementById('status').hidden, 'a reader on an origin carrying no site/pictures.js drew nothing at all — one decoration that site has no pictures for took its whole documentation down');
    want(content.textContent.includes('built from the folder itself'), "the reader survived the missing fallback but never drew the page's own words");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

check("the front page hands a docs link to the docs reader", () => {
  // The one piece of code here that is not a file: an inline module in the front page's foot, pulled out of the page and run the way the page runs it.
  const address = standInAddress('https://leaf.test/');
  const document = standInPage(read('index.html'), 'https://leaf.test/');
  const window = standInWindow(document, address);
  const inline = queryAll(document, 'script').filter((script) => script.getAttribute('type') === 'module' && !script.hasAttribute('src'));
  want(inline.length === 1, `the front page carries ${inline.length} inline modules, and this check reads one`);
  vm.runInContext(inline[0].textContent, vm.createContext({ document, location: address, window, URL, console }));
  const content = document.getElementById('content');
  const press = (href) => {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    content.appendChild(link);
    const event = leafEvent('click', { target: link });
    dispatch(link, event);
    return event;
  };
  const routed = press('docs/features/themes.md');
  want(routed.defaultPrevented, 'a docs link was left to the browser, which serves the raw Markdown rather than drawing it');
  want(address.href === 'https://leaf.test/docs/#/features/themes', `a docs link went to ${address.href}`);
  // Back to the page the link was pressed on: a browser would have left it by now, and the next link is written relative to the front page rather than to where the last one landed.
  address.href = 'https://leaf.test/';
  press('docs/features/themes.md#colors');
  want(address.href === 'https://leaf.test/docs/#/features/themes#colors', `a docs link with a section went to ${address.href}`);
  address.href = 'https://leaf.test/';
  const before = address.href;
  const external = press('https://leaftext.com/docs/features/themes.md');
  want(!external.defaultPrevented, 'a link to another site was intercepted');
  want(address.href === before, `a link to another site moved this one to ${address.href}`);
});

/** A checkout with one file taken out of it, so a reader can be booted over an origin that does not carry that file. Only what a reader statically pulls in is copied — the vendored libraries are script tags rather than imports, and never reached here. */
function checkoutWithout(missing) {
  const scratch = join(tmpdir(), `leaf-site-boot-${process.pid}-${missing.replace(/[^a-z0-9]+/gi, '-')}`);
  rmSync(scratch, { recursive: true, force: true });
  for (const file of bootedFiles()) {
    if (file === missing) continue;
    const to = join(scratch, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(root, file), to);
  }
  return scratch;
}

/** Every file the two entry readers pull in, which is every file booted: a helper that throws as it loads fails its entry's boot. */
function bootedFiles() {
  const found = new Set();
  const walk = (file) => {
    if (found.has(file)) return;
    found.add(file);
    const folder = file.slice(0, file.lastIndexOf('/'));
    for (const one of read(file).matchAll(/from\s+'(\.[^']+\.js)'/g)) {
      walk(new URL(one[1], `leaf:/${folder}/`).pathname.replace(/^\/+/, ''));
    }
  };
  walk('site/reader.js');
  walk('docs/docs.js');
  return found;
}

const files = bootedFiles();

check('every file the site owns is booted by one of the two readers', () => {
  const owned = readdirSync(join(root, 'site')).filter((name) => name.endsWith('.js'));
  const missed = owned.filter((name) => !files.has(`site/${name}`));
  want(!missed.length, `${missed.join(', ')} under site/ is imported by neither reader, so nothing here ever runs it`);
});

// ---- the splitter the speed reader waits to build ----------------------------
//
// Node keys its module cache on the resolved URL, and the boots above have already imported this module through both readers — so each load below carries a fresh query. Without one the counting `Intl` sees nothing built, and the check passes on code that never changed.

await check('the published speed reader builds its splitter only for a word that needs it and never again', async () => {
  const realIntl = globalThis.Intl;
  const load = async (intl) => {
    Object.defineProperty(globalThis, 'Intl', { value: intl, writable: true, configurable: true });
    return import(`${pathToFileURL(join(root, 'site/speed-reader.js')).href}?first-word=${boots}-${Math.random()}`);
  };
  const words = (text) => {
    const document = standInPage(`<html><body><article class="markdown-body"><p>${text}</p></article></body></html>`, 'https://leaf.test/');
    installGlobals({ document, window: standInWindow(document, standInAddress('https://leaf.test/')) });
    return document.querySelector('.markdown-body');
  };
  try {
    let built = 0;
    const counting = {
      Segmenter: class {
        constructor() {
          built += 1;
        }
        segment(text) {
          return Array.from(text, (character) => ({ segment: character }));
        }
      },
    };
    const reader = await load(counting);
    want(built === 0, `loading the module built ${built} splitters, so every published page pays for a reading mode it may never turn on`);
    const first = words('reading');
    reader.applySpeedReader(first);
    want(built === 0, `an ordinary Latin word built ${built} splitters rather than taking its lead and tail straight from the word`);
    want(first.querySelector('.speed-reader-anchor').textContent === 'rea', `the first word came out anchored on ${JSON.stringify(first.querySelector('.speed-reader-anchor').textContent)}`);
    const accented = words('caf\u00e9');
    reader.applySpeedReader(accented);
    want(built === 1, `the first word outside the direct path built ${built} splitters`);
    want(accented.querySelector('.speed-reader-anchor').textContent === 'ca', `the accented word came out anchored on ${JSON.stringify(accented.querySelector('.speed-reader-anchor').textContent)}`);
    const decomposed = words('cafe\u0301');
    reader.applySpeedReader(decomposed);
    want(decomposed.querySelector('.speed-reader-anchor').textContent === 'ca', `the decomposed word came out anchored on ${JSON.stringify(decomposed.querySelector('.speed-reader-anchor').textContent)}`);
    want(decomposed.textContent === 'cafe\u0301', `the decomposed accent moved away from its letter: ${JSON.stringify(decomposed.textContent)}`);
    const astral = words('\u{10400}\u{10428}\u{10428}');
    reader.applySpeedReader(astral);
    want(astral.querySelector('.speed-reader-anchor').textContent === '\u{10400}', `the astral word was cut through a letter: ${JSON.stringify(astral.querySelector('.speed-reader-anchor').textContent)}`);
    reader.applySpeedReader(words('na\u00efve'));
    want(built === 1, `a second document took the splitter count to ${built}, so it is built per document rather than held`);
    // A browser with no `Intl.Segmenter` answers `null` rather than nothing, which is why the held value is told apart by `undefined`: asked twice, it goes to `Intl` once and walks by code point both times.
    let asked = 0;
    const bare = {
      get Segmenter() {
        asked += 1;
        return undefined;
      },
    };
    const bareReader = await load(bare);
    const plain = words('reading');
    bareReader.applySpeedReader(plain);
    want(asked === 0, `an ordinary word asked a browser with no segmenter for one ${asked} times`);
    bareReader.applySpeedReader(words('caf\u00e9'));
    bareReader.applySpeedReader(words('na\u00efve'));
    want(asked === 1, `a browser with no segmenter was asked for one ${asked} times, so the construction is retried on every word`);
    want(plain.querySelector('.speed-reader-anchor').textContent === 'rea', 'a browser with no segmenter stopped splitting words, so its reader loses every bold lead');
  } finally {
    Object.defineProperty(globalThis, 'Intl', { value: realIntl, writable: true, configurable: true });
  }
});

// ---- the report -------------------------------------------------------------

if (problems.length) {
  console.error('the code that draws the published sites does not boot:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('a reader of either site sees this as a blank page, or as a status line over a half-drawn document.');
  process.exit(1);
}
console.log(`site boot: ${files.size} files booted offline across ${boots} boots against a stand-in page, fetch and module, plus the inline module in the front page's foot — every boot read for its finished page rather than for the absence of a throw`);
