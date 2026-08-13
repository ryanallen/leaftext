// Run the WebView front-end: does it parse, does it boot, and is the code view's edit arithmetic right (it decides what gets written to a file).
//
// Nothing else runs this script before a user does, and a fragment that throws as it loads opens a blank window. Order is load-bearing, so both the fragment list and the fake page's elements are read from the app itself — APP_SHELL_SCRIPT_PARTS in lib.rs and the ids and classes in app-shell.html.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { POLICY, sitePage } from './web-page.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (name, run) => {
  try {
    run();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
  }
};
// For a check that has to let the page's own promises settle before it can look. Its failure lands in the same list, and the report at the foot waits for every one of them.
const settled = [];
const checkSettled = (name, run) => {
  settled.push(
    Promise.resolve()
      .then(run)
      .catch((error) => failures.push(`${name}: ${error && error.message ? error.message : error}`)),
  );
};

// ---- the script, assembled the way the binary assembles it ------------------

function shellSource() {
  const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
  const partsNamed = (constant) => {
    const list = lib.match(new RegExp(constant + ': &\\[&str\\] = &\\[([\\s\\S]*?)\\];'));
    if (!list) throw new Error(`could not find ${constant} in src/lib.rs`);
    return [...list[1].matchAll(/include_str!\("assets\/(.*?)"\)/g)].map((m) => m[1]);
  };
  // One list, served as one file behind the page's one script tag — so booting them joined in this order is exactly what the web view does.
  const names = partsNamed('APP_SHELL_SCRIPT_PARTS');
  if (names.length < 10) throw new Error(`expected the whole fragment list, got ${names.length}`);
  const page = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
  const tags = (page.match(/<script/g) || []).length;
  // The theme bootstrap is the other one, and it runs before this in its own scope.
  if (tags !== 2) throw new Error(`the page should carry two script tags, found ${tags}`);
  return {
    names,
    source: names.map((name) => readFileSync(join(root, 'src/assets', name), 'utf8')).join(''),
  };
}

// ---- a fake page, built from the ids the real one declares ------------------

function pageMarkup() {
  return readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
}

function elementIds() {
  return [...pageMarkup().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}

/** The page's own Element, so `target instanceof Element` answers the way it does in the app. */
class FakeElement {}

/** Take a node out of whatever is holding it, so a move is a move rather than a second listing. */
function detachChild(child) {
  const held = child && child.parentElement && child.parentElement.children;
  if (!held) return;
  const at = held.indexOf(child);
  if (at >= 0) held.splice(at, 1);
}

/** A stand-in element: enough surface to be wired up, and inert when used. */
function fakeElement(id = '') {
  const element = Object.assign(new FakeElement(), {
    id,
    tagName: 'DIV',
    hidden: false,
    checked: false,
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    clientHeight: 0,
    clientWidth: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    isConnected: true,
    dataset: {},
    // A real record, because a custom property set on an element is how the page changes a layout without a class: the published site closes the pane's breadcrumb band by taking its height to zero, and a stub that answered '' would let a test watching for it pass with nothing set.
    style: (() => {
      const held = new Map();
      return {
        setProperty(name, value) {
          held.set(name, value);
        },
        removeProperty(name) {
          held.delete(name);
        },
        getPropertyValue: (name) => held.get(name) ?? '',
      };
    })(),
    // A real set, because a class is how the page changes a whole layout without touching a single element: an embed takes the bar, the pane and the floating toolbar down with one on the body. A stub that always answered false would let a check watching for one pass with nothing added.
    classList: (() => {
      const held = new Set();
      return {
        add: (...names) => names.forEach((name) => held.add(name)),
        remove: (...names) => names.forEach((name) => held.delete(name)),
        toggle: (name, on) => (on === undefined ? (held.has(name) ? held.delete(name) : held.add(name)) : on ? held.add(name) : held.delete(name)),
        contains: (name) => held.has(name),
      };
    })(),
    children: [],
    parentElement: null,
    // Kept rather than swallowed, the way the document's and the window's are: a check raises a made-up event on an element and gets the page's own handler. What a link click sends is the page's own choice, and a dropped listener leaves nothing but the source text to read it off.
    listeners: new Map(),
    addEventListener(type, handler) {
      if (typeof handler !== 'function') return;
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const held = this.listeners.get(type) || [];
      const at = held.indexOf(handler);
      if (at >= 0) held.splice(at, 1);
    },
    // Real moves, because moving a node is the whole of what the app-bar fold does: it takes buttons out of their containers and later puts each one back where it was standing. A stub that returns the child reads as "put back" while nothing moved.
    appendChild(child) {
      detachChild(child);
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    prepend(child) {
      detachChild(child);
      this.children.unshift(child);
      child.parentElement = this;
      return child;
    },
    removeChild: (child) => {
      detachChild(child);
      return child;
    },
    insertBefore: (child) => child,
    // A real removal, because a control taken out of the page is a control the rest of the shell has to cope with being gone: the published site takes the history strip out, and a stub that returned quietly would leave every later query still answering with it.
    remove() {
      detachChild(this);
      const drop = (node) => {
        node.isConnected = false;
        for (const child of node.children) drop(child);
      };
      drop(this);
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    hasAttribute: () => false,
    setPointerCapture() {},
    releasePointerCapture() {},
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    closest: () => null,
    matches: () => false,
    contains: () => false,
    // The page writes its own markup into these and then reaches back into it, so a query finds something — as it would once that markup is really there.
    querySelector: (selector) => fakeElement(String(selector)),
    // Nothing has been rendered yet at boot, so a list of them is empty.
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }),
    getContext: () => null,
  });
  return element;
}

/** One stand-in per element the markup names, nested the way the page nests them. The app-bar fold takes buttons out of their containers and later puts each back where it was standing, so a flat bag of elements cannot say whether it worked — a wide window left the Mac's dots in the menu until the app was quit, and nothing here could see it. */
function pageElements() {
  const markup = pageMarkup();
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const byId = new Map();
  // First element carrying a class answers a query for it, the way querySelector's first match does.
  const byClass = new Map();
  const open = [];
  for (const tag of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [, closing, rawName, attrs] = tag;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = open.map((one) => one.name).lastIndexOf(name);
      if (at >= 0) open.length = at;
      continue;
    }
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    const classAttr = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
    let node = null;
    if (id || classAttr) {
      node = fakeElement(id || '');
      node.className = classAttr;
      // Shipped hidden in the markup, which is how the window's own three buttons reach a browser: only a native window frame reveals them, and a stand-in that started every element visible could not tell the two apart. `aria-hidden` is not this, so the boundary matters.
      if (/(^|\s)hidden(\s|=|$)/.test(attrs)) node.hidden = true;
      if (id) byId.set(id, node);
      for (const one of classAttr.split(/\s+/)) if (one && !byClass.has(one)) byClass.set(one, node);
      const holder = [...open].reverse().find((one) => one.node);
      if (holder) holder.node.appendChild(node);
    }
    if (!voids.has(name) && !/\/\s*$/.test(attrs)) open.push({ name, node });
  }
  return { byId, byClass };
}

function fakePage() {
  const { byId, byClass } = pageElements();
  // Every id the markup declares has a stand-in, including any the walker's nesting missed.
  for (const id of elementIds()) if (!byId.has(id)) byId.set(id, fakeElement(id));
  // Only what the page really declares gets an answer. A selector for a class or id the markup does not have returns null, the way it would in the app. An element taken out of the page stops answering, the way it does in a browser: a query only finds what is still in the document.
  const standing = (node) => (node && node.isConnected !== false ? node : null);
  const find = (selector) => {
    const one = String(selector).trim();
    if (one.startsWith('#')) return standing(byId.get(one.slice(1)));
    // The page's own element, not a fresh one each call: two fragments asking for the same container have to get the same container, or one of them writes into a copy nobody reads.
    if (/^\.[A-Za-z0-9_-]+$/.test(one)) return standing(byClass.get(one.slice(1)));
    return null;
  };
  const document = {
    documentElement: fakeElement('documentElement'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    // Unknown ids answer null, exactly as the real page does — so code that guards on a missing element is exercised, not papered over. An id taken out of the page is one of them.
    getElementById: (id) => standing(byId.get(id)),
    querySelector: find,
    // Nothing is loaded at boot, so a list query is legitimately empty.
    querySelectorAll: () => [],
    createElement: (tag) => fakeElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    // Nothing is rendered here, so a walk over an element finds no nodes — which is what a walk over the fake page's empty elements would find.
    createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => fakeElement('fragment'),
    createRange: () => ({
      setStart() {},
      setEnd() {},
      selectNodeContents() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      getClientRects: () => [],
      cloneRange() {
        return this;
      },
      collapse() {},
    }),
    // Kept rather than swallowed, so a check can raise a made-up event on the page and get the page's own handlers. Every fragment that watches the document is on this list, in the order they registered, which is the order the real page calls them in.
    listeners: new Map(),
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const held = this.listeners.get(type) || [];
      const at = held.indexOf(handler);
      if (at >= 0) held.splice(at, 1);
    },
    fonts: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
    visibilityState: 'visible',
    activeElement: null,
  };
  return { document, byId };
}

// The stand-in window's size. Named because the app surface has to report the same box: it is the window until its own edge becomes a shadow, and everything that places an overlay reads it.
const VIEW_WIDTH = 1080;
const VIEW_HEIGHT = 820;

/** A real address and a real history stack. The published page has both and the browser's own host spends them: it decides whether a link leaves the site by comparing origins, and it writes an entry per document opened so the browser's own Back has somewhere to go. A stub that swallows a push can only ever report that nothing happened. */
function fakeAddress(start, raise) {
  const entries = [{ state: null, url: start }];
  let at = 0;
  const resolve = (url) => (url === undefined || url === null ? entries[at].url : new URL(String(url), entries[at].url).href);
  const location = {
    origin: new URL(start).origin,
    get href() {
      return entries[at].url;
    },
    get hash() {
      const cut = entries[at].url.indexOf('#');
      return cut === -1 ? '' : entries[at].url.slice(cut);
    },
  };
  // One gesture, and browsers differ about which event announces it, so both are raised — a host that answered only one of them would be right on one browser.
  const travel = (delta) => {
    const to = Math.min(entries.length - 1, Math.max(0, at + delta));
    if (to === at) return false;
    at = to;
    raise('popstate', { state: entries[at].state });
    raise('hashchange', {});
    return true;
  };
  const history = {
    get length() {
      return entries.length;
    },
    get state() {
      return entries[at].state;
    },
    pushState(state, _title, url) {
      // Forward is gone the moment a new entry is added, the way it is in a browser.
      entries.length = at + 1;
      entries.push({ state, url: resolve(url) });
      at = entries.length - 1;
    },
    replaceState(state, _title, url) {
      entries[at] = { state, url: resolve(url) };
    },
    back: () => travel(-1),
    forward: () => travel(1),
    go: (delta) => travel(delta || 0),
  };
  return {
    location,
    history,
    urls: () => entries.map((one) => one.url),
    states: () => entries.map((one) => one.state),
    at: () => at,
  };
}

function runShell(source, extras = {}) {
  const { document, byId } = fakePage();
  // The app surface is the window at rest. A stand-in reporting an empty box would put every overlay in the page at the origin, and read as though the app had no room in it.
  const surface = byId.get('appSurface');
  if (surface) {
    surface.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: VIEW_WIDTH,
      bottom: VIEW_HEIGHT,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
    });
  }
  const noop = () => {};
  const frames = new Map();
  let frameId = 0;
  // Kept rather than swallowed, the way the document's are: a check raises a made-up event on the window and gets the page's own handlers. The mouse's own back button and the browser's own history both arrive this way.
  const windowListeners = new Map();
  const address = fakeAddress('https://leaf.test/', (type, event) => {
    for (const handler of [...(windowListeners.get(type) || [])]) handler(event);
  });
  const sandbox = {
    console: { log: noop, warn: noop, error: noop, debug: noop, info: noop },
    document,
    addEventListener(type, handler) {
      if (typeof handler !== 'function') return;
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const held = windowListeners.get(type) || [];
      const at = held.indexOf(handler);
      if (at >= 0) held.splice(at, 1);
    },
    dispatchEvent: () => true,
    innerWidth: VIEW_WIDTH,
    innerHeight: VIEW_HEIGHT,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    location: address.location,
    history: address.history,
    // The stack itself, so a check can walk it and read back what each entry was stamped with.
    __address: address,
    __windowListeners: windowListeners,
    navigator: { userAgent: 'leaf-check', platform: 'test', clipboard: { writeText: noop } },
    performance: { now: () => 0 },
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    queueMicrotask: noop,
    // A real queue, not a stub that swallows the callback: a job that puts itself straight back on the frame queue is a page that never goes idle, and a stub can only ever report that nothing happened.
    requestAnimationFrame: (fn) => {
      frameId += 1;
      frames.set(frameId, fn);
      return frameId;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
    fetch: () => new Promise(() => {}),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    // Real implementations, not stubs: the web view has these and so does Node, and the offset arithmetic below depends on them being genuine.
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    Element: FakeElement,
    // No cascade here, but a custom property set on the element itself does come back out of a real browser's computed style, and the page reads its own writes that way.
    getComputedStyle: (element) => ({ getPropertyValue: (name) => (element && element.style && typeof element.style.getPropertyValue === 'function' ? element.style.getPropertyValue(name) : ''), color: 'rgb(0, 0, 0)' }),
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    // The host injects these before any page script runs.
    ipc: { postMessage: noop },
    __leafFrameless: false,
    __leafMacFrame: false,
    __leafMaximized: false,
    __leafSettings: {},
    __leafInitialState: { recent: [], favorites: [], document: null },
    __leafVaults: { vaults: [], active: 0 },
    __leafVersion: '0.0.0',
    __leafUpdateAsset: '',
    __leafDocumentExts: ['md', 'markdown', 'mdown', 'xml', 'json', 'yaml', 'yml', 'eml', 'mht', 'mhtml'],
    __leafSettingsUnreadable: false,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // The theme bootstrap normally runs first and publishes these; it lives in a separate <script>, so stand them in. It publishes the vendored runtimes' URLs too, which the fragments destructure on load — so a missing entry here reads as a boot failure, not a stub.
  sandbox.__lt = {
    assets: {
      mermaid: 'leaf-asset://mermaid.min.js',
      katex: 'leaf-asset://katex/katex.min.js',
      pixi: 'leaf-asset://pixi.min.js',
      pixiUnsafeEval: 'leaf-asset://pixi-unsafe-eval.min.js',
      d3Force: 'leaf-asset://d3-force.min.js',
      monaco: 'leaf-asset://monaco/monaco.js',
      monacoCss: 'leaf-asset://monaco/monaco.css',
    },
  };
  sandbox.leafTheme = {
    getMode: () => 'system',
    getFamily: () => 'fern',
    setMode() {},
    setFamily() {},
    subscribe() {},
    appearance: () => 'light',
  };

  // Run every frame the page has asked for, and every frame those ask for in turn, until there are none left. A job that re-arms itself never reaches that point, so the cap is the failure rather than a hang.
  sandbox.__frames = {
    waiting: () => frames.size,
    drain: (cap = 200) => {
      let ran = 0;
      while (frames.size) {
        if (ran >= cap) throw new Error(`the page kept asking for another animation frame (${cap} of them)`);
        const [id, fn] = frames.entries().next().value;
        frames.delete(id);
        ran += 1;
        fn(0);
      }
      return ran;
    },
  };

  // Whatever this run needs on top of the page: the browser host's fetch, its module, and the queue the export writes above it.
  Object.assign(sandbox, extras);

  const context = vm.createContext(sandbox);
  new vm.Script(source, { filename: 'app-shell.js' }).runInContext(context);
  return context;
}

// ---- 1. it parses -----------------------------------------------------------

const { names, source } = shellSource();
check('the page parses', () => {
  new vm.Script(source, { filename: 'app-shell.js' });
});

// ---- 2. it boots ------------------------------------------------------------

let booted = null;
check('the page boots', () => {
  booted = runShell(source);
});

// ---- 3. the arithmetic that can damage a file -------------------------------

// The code view does not send the buffer, it sends what changed — and the host splices that straight into the text it will write to disk. These are the functions that work it out.
if (booted) {
  const { sourceSpliceSince, lineIndexAtByteOffset, byteOffsetAtLineIndex, rangesAfterCommit, fencedCodeInnerSpan } =
    booted;

  // The two things the field block asks the page for ride on `data-leaf-` attributes the renderer stamped on the table, so the names have to agree across Rust and here. They are read from the DOM rather than passed in, which means a rename on either side is silent: the class stops arriving and nothing throws.
  check('a note gets the style it asked for and one growl for what did not land', () => {
    const win = booted.window;
    const growls = [];
    const wasNotice = win.leafShowNotice;
    // A stand-in reader: one table carrying what the renderer stamped, and one body to receive the class.
    const layout = (asked, unread) => {
      const added = [];
      const table = { dataset: { leafDocClasses: asked, leafUnread: unread } };
      const body = { classList: { add: (...names) => added.push(...names) } };
      return {
        added,
        root: { querySelector: (selector) => (selector === '.frontmatter' ? table : body) },
      };
    };
    const run = (asked, unread) => {
      const stand = layout(asked, unread);
      growls.length = 0;
      win.leafShowNotice = (message) => growls.push(message);
      try {
        win.applyFrontmatterAsks(stand.root);
      } finally {
        win.leafShowNotice = wasNotice;
      }
      return stand.added;
    };

    const added = run('document-body-wide', '"midnight" — no style of that name here');
    if (!added.includes('document-body-wide')) throw new Error(`the class the note asked for never reached the page: ${JSON.stringify(added)}`);
    if (growls.length !== 1) throw new Error(`one growl for the whole block, not ${growls.length}`);
    if (!growls[0].includes('midnight')) throw new Error(`the growl does not say what did not land: ${growls[0]}`);

    // Nothing to say, nothing said -- a note whose block read cleanly must not growl at all.
    if (run('', '').length !== 0) throw new Error('a class was added out of an empty attribute');
    if (growls.length !== 0) throw new Error('a clean block still growled');
  });

  // The walk pairs rendered elements with the host's spans in document order and throws every range away if it cannot line them up, so one span too many leaves a whole document uneditable and says nothing. The field block is the standing case: the page skips its div, and the host has to leave the fences out to match (`block_source_map_leaves_out_a_leading_field_block`).
  check('a note that opens with a field block still gets a range on every block', () => {
    const source = '---\ntitle: Notes\n---\n\n# Heading\n\nA paragraph.\n';
    // The spans the host reports for that document, which the Rust side pins by slicing them back out of it.
    const blocks = [
      { id: 0, kind: 'heading', start: 22, end: 31, editable: true },
      { id: 1, kind: 'paragraph', start: 33, end: 45, editable: true },
    ];
    const element = (tag, className) => ({
      nodeType: 1,
      tagName: tag,
      dataset: {},
      children: [],
      classList: { contains: (name) => name === className },
    });
    const body = { children: [element('DIV', 'frontmatter'), element('H1', ''), element('P', '')] };
    booted.attachMarkdownBlockRanges(body, blocks, source);

    const [field, heading, paragraph] = body.children;
    if ('srcStart' in field.dataset) throw new Error('the field block took a source range, so it is being edited as Markdown');
    if (heading.dataset.srcStart !== '22' || paragraph.dataset.srcStart !== '33') throw new Error(`the ranges did not land: ${JSON.stringify([heading.dataset, paragraph.dataset])}`);
    if (source.slice(Number(paragraph.dataset.srcStart), Number(paragraph.dataset.srcEnd)) !== 'A paragraph.') throw new Error('the paragraph range does not slice back to the paragraph');
  });

  // The other side of the same bargain: a comment is stripped before the page sees it, so the host must not report a span for it (`block_source_map_leaves_out_a_comment_between_two_paragraphs`). This proves both halves — the spans it now reports stamp every element, and the span it used to report would have left the whole note uneditable.
  check('a note with a comment line in it gets a range on every block', () => {
    const source = 'Before.\n\n<!-- a note -->\n\nAfter.\n';
    const paragraphs = [
      { id: 0, kind: 'paragraph', start: 0, end: 7, editable: true },
      { id: 1, kind: 'paragraph', start: 26, end: 32, editable: true },
    ];
    const element = () => ({ nodeType: 1, tagName: 'P', dataset: {}, children: [], classList: { contains: () => false } });
    const drawn = () => ({ children: [element(), element()] });

    const body = drawn();
    booted.attachMarkdownBlockRanges(body, paragraphs, source);
    const [before, after] = body.children;
    if (source.slice(Number(before.dataset.srcStart), Number(before.dataset.srcEnd)) !== 'Before.') throw new Error('the first paragraph range does not slice back to it');
    if (source.slice(Number(after.dataset.srcStart), Number(after.dataset.srcEnd)) !== 'After.') throw new Error('the second paragraph range does not slice back to it');
    // The blank-page pair opens on a document with no `[data-src-start]` anywhere, which is why an unstamped note claimed to be a new one.
    if (!body.children.every((el) => 'srcStart' in el.dataset)) throw new Error('a block was left unstamped, so the page would offer the new-document lines over a note with content');

    // What the host used to send: a span for the comment, with no element to pair it with.
    const withComment = drawn();
    booted.attachMarkdownBlockRanges(withComment, [paragraphs[0], { id: 1, kind: 'html_block', start: 9, end: 24, editable: false }, { ...paragraphs[1], id: 2 }], source);
    if (withComment.children.some((el) => 'srcStart' in el.dataset)) throw new Error('a span with no element still stamped, so the guard that makes this fix necessary is gone');
  });

  // A footnote is written in the middle of a note and drawn at the foot of the page, so the host reports its block last and the walk pairs the two lists by position — it has no other way to know where the renderer moved it. Before that, every element from the footnote down wore the block above it: the paragraph under it opened on the footnote's own words and typing there wrote over them (`block_source_map_reports_a_footnote_where_the_page_draws_it`).
  check('a note with a footnote in the middle gets a range on every block', () => {
    const source = '# Title\n\nBefore the note.[^1]\n\n[^1]: The note itself.\n\nAfter the note.\n\n---\n\nThe last words.\n';
    // In the order the page draws them, which is the order the host reports them in: tag, class, kind, and the source the element is showing.
    const drawn = [
      ['H1', '', 'heading', '# Title'],
      ['P', '', 'paragraph', 'Before the note.[^1]'],
      ['P', '', 'paragraph', 'After the note.'],
      ['HR', '', 'rule', '---'],
      ['P', '', 'paragraph', 'The last words.'],
      ['DIV', 'footnote-definition', 'footnote_definition', '[^1]: The note itself.'],
    ];
    const blocks = drawn.map(([, , kind, text], id) => ({
      id,
      kind,
      start: source.indexOf(text),
      end: source.indexOf(text) + text.length,
      editable: kind === 'paragraph' || kind === 'heading',
    }));
    const body = {
      children: drawn.map(([tag, className]) => ({
        nodeType: 1,
        tagName: tag,
        dataset: {},
        children: [],
        classList: { contains: (name) => className !== '' && name === className },
      })),
    };
    booted.attachMarkdownBlockRanges(body, blocks, source);

    body.children.forEach((el, index) => {
      const [, , kind, text] = drawn[index];
      if (!('srcStart' in el.dataset)) throw new Error(`the ${kind} was left unstamped, so the note is read-only with nothing saying why`);
      const shown = source.slice(Number(el.dataset.srcStart), Number(el.dataset.srcEnd));
      if (shown !== text) throw new Error(`the ${kind} wears somebody else's bytes: ${JSON.stringify(shown)}`);
      if (el.dataset.blockKind !== kind) throw new Error(`the ${kind} is stamped as a ${el.dataset.blockKind}`);
    });
    // The last block of the file used to inherit the rule above it, and a rule is the one kind the page never opens.
    if (body.children[4].dataset.editable !== 'true') throw new Error('the last block of the file cannot be edited');
  });

  // The count guard only fires on a block left over or an element with no block, and a list that drifted out of order keeps both counts equal — so a kind that can only ever be one tag is the second thing held to the element it landed on. Four kinds and no others: the rest have more than one tag each and would refuse documents that are fine.
  check('a block whose kind cannot be the element it landed on stamps nothing', () => {
    const source = 'A paragraph.\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const element = (tag, className) => ({
      nodeType: 1,
      tagName: tag,
      dataset: {},
      children: [],
      classList: { contains: (name) => className !== undefined && name === className },
    });
    const stamped = (blocks, tags) => {
      const body = { children: tags.map((tag) => element(tag)) };
      booted.attachMarkdownBlockRanges(body, blocks, source);
      return body.children.filter((el) => 'srcStart' in el.dataset).length;
    };
    // Each of the four kinds, handed the wrong element, with a good paragraph in front of it to prove the refusal drops that one too rather than stamping what it liked.
    const good = { id: 0, kind: 'paragraph', start: 0, end: 12, editable: true };
    const wrong = [
      ['rule', 'P'],
      ['table', 'DIV'],
      ['list', 'P'],
      ['footnote_definition', 'P'],
    ];
    for (const [kind, tag] of wrong) {
      const count = stamped([good, { id: 1, kind, start: 14, end: 17, editable: false }], ['P', tag]);
      if (count !== 0) throw new Error(`a ${kind} on a <${tag.toLowerCase()}> still stamped ${count} of 2 blocks`);
    }
    // The same four kinds on the elements they belong to still stamp, or the guard would take editing away from every document that has one.
    const right = [
      ['rule', 'HR'],
      ['table', 'TABLE'],
      ['list', 'UL'],
      ['list', 'OL'],
    ];
    for (const [kind, tag] of right) {
      const count = stamped([good, { id: 1, kind, start: 14, end: 17, editable: false }], ['P', tag]);
      if (count !== 2) throw new Error(`a ${kind} on its own <${tag.toLowerCase()}> stamped ${count} of 2 blocks`);
    }
    // A footnote definition is the one of the four that needs its class as well as its tag.
    const definition = { id: 1, kind: 'footnote_definition', start: 14, end: 17, editable: false };
    const body = { children: [element('P'), element('DIV', 'footnote-definition')] };
    booted.attachMarkdownBlockRanges(body, [good, definition], source);
    if (!body.children.every((el) => 'srcStart' in el.dataset)) throw new Error('a footnote definition on its own div was refused');
  });

  // The drift as it arrived: the host reported its blocks in the order the file was written, and the page draws the footnote at the foot. Fourteen blocks, fourteen elements, every pair wrong from the footnote on — and nothing said so. This is that list, handed in unfixed, refused by the kind check alone.
  check('the footnote drift is refused by the kind check on its own', () => {
    const source = '# Title\n\nBefore the note.[^1]\n\n[^1]: The note itself.\n\nAfter the note.\n\n---\n\nThe last words.\n';
    // In the order the file was written, which is what the host used to report.
    const written = [
      ['heading', '# Title'],
      ['paragraph', 'Before the note.[^1]'],
      ['footnote_definition', '[^1]: The note itself.'],
      ['paragraph', 'After the note.'],
      ['rule', '---'],
      ['paragraph', 'The last words.'],
    ];
    const blocks = written.map(([kind, text], id) => ({
      id,
      kind,
      start: source.indexOf(text),
      end: source.indexOf(text) + text.length,
      editable: kind === 'paragraph' || kind === 'heading',
    }));
    // In the order the page draws them, with the definition at the foot.
    const body = {
      children: [
        ['H1', ''],
        ['P', ''],
        ['P', ''],
        ['HR', ''],
        ['P', ''],
        ['DIV', 'footnote-definition'],
      ].map(([tag, className]) => ({
        nodeType: 1,
        tagName: tag,
        dataset: {},
        children: [],
        classList: { contains: (name) => className !== '' && name === className },
      })),
    };
    booted.attachMarkdownBlockRanges(body, blocks, source);
    if (body.children.some((el) => 'srcStart' in el.dataset)) throw new Error('the drift stamped a range, so a click into one block would write over another');
  });

  // ---- footnotes edit as they are drawn ---------------------------------------
  //
  // A stand-in element with enough of a node to be serialized and enough of a class list to be tested. `text` is a bare text node; anything else is an element.
  const node = (tag, options = {}) => {
    const classes = new Set((options.className || '').split(/\s+/).filter(Boolean));
    const attributes = { id: options.id || '', ...(options.attributes || {}) };
    const kids = (options.children || []).map((child) => (typeof child === 'string' ? { nodeType: 3, nodeValue: child, textContent: child } : child));
    const wired = [];
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      dataset: options.dataset ? { ...options.dataset } : {},
      childNodes: kids,
      children: kids.filter((child) => child.nodeType === 1),
      wired,
      classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      getAttribute: (name) => (name in attributes ? attributes[name] : null),
      hasAttribute: (name) => name in attributes && attributes[name] !== '',
      setAttribute() {},
      removeAttribute() {},
      addEventListener: (type) => wired.push(type),
      get textContent() {
        return kids.map((child) => child.textContent || '').join('');
      },
    };
    // Enough of a query to answer the safety tests: a comma list of tags and classes, matched against the whole subtree.
    const descendants = (from) => from.children.flatMap((child) => [child, ...descendants(child)]);
    const matching = (selector) => {
      const wants = String(selector).split(',').map((one) => one.trim());
      return descendants(el).filter((child) =>
        wants.some((one) => (one.startsWith('.') ? child.classList.contains(one.slice(1)) : child.tagName.toLowerCase() === one.split(/[ :]/)[0])),
      );
    };
    el.querySelector = (selector) => matching(selector)[0] || null;
    el.querySelectorAll = (selector) => matching(selector);
    el.cloneNode = () => node(tag, { ...options, children: (options.children || []).map((child) => (typeof child === 'string' ? child : child.cloneNode())) });
    kids.forEach((child) => {
      if (child.nodeType !== 1) return;
      child.remove = () => {
        el.children = el.children.filter((one) => one !== child);
        el.childNodes = el.childNodes.filter((one) => one !== child);
      };
    });
    return el;
  };
  // A footnote as the renderer draws it at the foot of the page: the number it wears and the arrow back are the renderer's, not the file's.
  const drawnFootnote = (name, words, range) =>
    node('div', {
      className: 'footnote-definition',
      id: name,
      dataset: range ? { blockKind: 'footnote_definition', srcStart: String(range[0]), srcEnd: String(range[1]) } : { blockKind: 'footnote_definition' },
      children: [
        node('sup', { className: 'footnote-definition-label', children: ['1'] }),
        node('p', { children: [...words, node('a', { className: 'footnote-backref', attributes: { href: '#fnref-' + name }, children: [node('svg', {})] })] }),
      ],
    });

  // A footnote reference is a superscript number on screen and `[^name]` in the file, so a paragraph carrying one used to drop out of typing-as-it-looks and open as raw source instead. The name is on the element; the number is assigned by first use and cannot be written back.
  check('a sentence carrying a footnote is typed in as it looks and keeps its marker', () => {
    const marker = node('sup', { className: 'footnote-reference', id: 'fnref-why', children: [node('a', { attributes: { href: '#why' }, children: ['1'] })] });
    const paragraph = node('p', { dataset: { blockKind: 'paragraph' }, children: ['Before the note.', marker, ' After it.'] });
    if (!booted.markdownBlockWysiwygSafe(paragraph)) throw new Error('a paragraph with a footnote in it still opens as raw source');
    const written = booted.blockDomToMarkdown(paragraph);
    if (written !== 'Before the note.[^why] After it.') throw new Error(`the marker did not survive the write-back: ${JSON.stringify(written)}`);
  });

  // The other end of the same complaint: the footnote's own words at the foot of the page. The number and the back-arrow are drawn into the block and are not in the file, so both come off on the way out and the marker is rebuilt from the name.
  check('a footnote at the foot of the page is typed in as it looks', () => {
    const definition = drawnFootnote('why', ['The note itself.']);
    if (!booted.footnoteDefinitionWysiwygSafe(definition)) throw new Error('the footnote still opens as raw source');
    const written = booted.blockDomToMarkdown(definition);
    if (written !== '[^why]: The note itself.') throw new Error(`the footnote wrote back wrong: ${JSON.stringify(written)}`);

    // A footnote holding a second paragraph is indented in the file and that indent cannot be read off the page, so it keeps the source editor.
    const two = drawnFootnote('why', ['First.']);
    two.children.push(node('p', { children: ['Second.'] }));
    if (booted.footnoteDefinitionWysiwygSafe(two)) throw new Error('a two-paragraph footnote was offered the as-it-looks editor');
  });

  // A footnote written inside a quote is lifted out and drawn at the foot, so the quote on screen no longer holds it — writing the quote back from what is drawn would delete that line. Its own lines go back on the end, taken from the file rather than rebuilt (`block_source_map_marks_the_block_a_footnote_was_written_inside`).
  check('a quote a footnote was written in keeps that footnote when the quote is typed in', () => {
    const source = 'Text [^x] here.\n\n> a quote line\n>\n> [^x]: the note\n\nAfter.\n';
    const definition = drawnFootnote('x', ['the note'], [36, 50]);
    const quote = node('blockquote', {
      dataset: { blockKind: 'blockquote', holdsFootnote: 'true', srcStart: '17', srcEnd: '50' },
      children: [node('p', { children: ['a quote line'] })],
    });
    const body = { children: [quote, definition], querySelectorAll: () => [definition] };
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    appEl.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery.call(appEl, selector));
    let written;
    let emptied;
    try {
      booted.window.leafBlocksResynced({ source });
      written = booted.blockDomToMarkdown(quote);
      // The quote drawn with nothing in it — its only content was the footnote — writes back as the footnote alone rather than as an empty quote.
      quote.children.length = 0;
      quote.childNodes.length = 0;
      emptied = booted.blockDomToMarkdown(quote);
    } finally {
      appEl.querySelector = wasQuery;
    }
    if (written !== '> a quote line\n>\n> [^x]: the note') throw new Error(`the footnote's line was lost writing the quote back: ${JSON.stringify(written)}`);
    if (emptied !== '> [^x]: the note') throw new Error(`an empty-looking quote wrote the footnote out of the file: ${JSON.stringify(emptied)}`);
  });

  // A list written with blank lines between its items draws each item's words in a paragraph of their own, and any paragraph in a list used to send the whole list to the raw-source editor — so spacing a list out took typing-as-it-looks away from it. The blank lines go back on the way out, or the list would close up under the reader.
  check('a list with blank lines between its items is typed in as it looks', () => {
    const item = (words) => node('li', { children: [node('p', { children: [words] })] });
    const list = node('ul', { dataset: { blockKind: 'list' }, children: [item('First item.'), item('Second item.')] });
    if (!booted.listWysiwygSafe(list)) throw new Error('a list spaced out with blank lines still opens as raw source');
    const written = booted.blockDomToMarkdown(list);
    if (written !== '- First item.\n\n- Second item.') throw new Error(`the blank line between the items was lost: ${JSON.stringify(written)}`);

    // A list whose items sit together writes back the way it always has, with no blank line invented between them.
    const tight = node('ul', { dataset: { blockKind: 'list' }, children: [node('li', { children: ['First item.'] }), node('li', { children: ['Second item.'] })] });
    if (booted.blockDomToMarkdown(tight) !== '- First item.\n- Second item.') throw new Error('a list whose items sit together came back spaced out');

    // An item holding a second paragraph is a continuation whose indent cannot be read off the page, so it keeps the source editor.
    const twoParagraphs = node('ul', { children: [node('li', { children: [node('p', { children: ['First.'] }), node('p', { children: ['Continued.'] })] })] });
    if (booted.listWysiwygSafe(twoParagraphs)) throw new Error('an item with two paragraphs was offered the as-it-looks editor');
  });

  // The other way that same empty-looking quote can be written over: the plus in the margin writes its block onto the line it is offered on, which is a delete rather than an edit. Clicking it still opens it.
  check('the plus is not offered on a quote a footnote was lifted out of', () => {
    const quote = (holds) => ({ tagName: 'BLOCKQUOTE', dataset: holds ? { holdsFootnote: 'true' } : {}, textContent: '', querySelector: () => null });
    if (!booted.blockAcceptsInsert(quote(false))) throw new Error('the plus stopped being offered on an empty line');
    if (booted.blockAcceptsInsert(quote(true))) throw new Error("pressing the plus there would write over the footnote's line");
  });

  // The ask pipe's reader half is one call into this function (`READER_STATE` in src/pipe.rs), so nothing else in the suite notices when an element it reads is renamed — the next `{"ask":"state","reader":true}` would be the first to find out, and what it loses is silent.
  check('the page can say what the reader sees', () => {
    const readerState = () => booted.window.leafReaderState();
    const state = readerState();
    for (const field of ['scrollTop', 'scrollHeight', 'viewportHeight', 'codeView', 'panels', 'selection', 'renderInFlight']) {
      if (!(field in state)) throw new Error(`the reader half has no ${field}`);
    }
    for (const field of ['scrollTop', 'scrollHeight', 'viewportHeight']) {
      if (!Number.isFinite(state[field])) throw new Error(`${field} came back ${state[field]}`);
    }
    for (const panel of ['library', 'map', 'findBar', 'glossary']) {
      if (typeof state.panels[panel] !== 'boolean') throw new Error(`${panel} is not open or shut, it is ${state.panels[panel]}`);
    }
    // Nothing is rendered on the fake page, so there is no block to be anchored to.
    if (state.anchor !== null) throw new Error(`an empty page claimed an anchor: ${JSON.stringify(state.anchor)}`);
    if (state.selection !== null) throw new Error(`nothing is selected, and it said ${JSON.stringify(state.selection)}`);

    // Each panel read off its own element, so a renamed id fails here rather than answering "shut" for ever.
    const spinner = booted.document.getElementById('readerLoading');
    const bar = booted.document.getElementById('findBar');
    const sheet = booted.document.getElementById('glossarySheet');
    const shell = booted.document.getElementById('libraryShell');
    const wasContains = shell.classList.contains;
    try {
      spinner.hidden = false;
      bar.hidden = false;
      sheet.hidden = false;
      shell.classList.contains = () => false;
      const open = readerState();
      if (!open.renderInFlight) throw new Error('a render in flight was reported as settled');
      if (!open.panels.findBar || !open.panels.glossary) throw new Error('an open panel was reported shut');
      if (!open.panels.library) throw new Error('the library pane was reported shut while it is open');

      spinner.hidden = true;
      bar.hidden = true;
      sheet.hidden = true;
      shell.classList.contains = (name) => name === 'library-closed';
      const shut = readerState();
      if (shut.renderInFlight) throw new Error('a settled page was reported as rendering');
      if (shut.panels.findBar || shut.panels.glossary) throw new Error('a shut panel was reported open');
      if (shut.panels.library) throw new Error('a closed library pane was reported open');
    } finally {
      shell.classList.contains = wasContains;
      spinner.hidden = false;
      bar.hidden = false;
      sheet.hidden = false;
    }
  });

  // A pager button opens a page, and three things have to agree about that: the card, the middle click and the menu. Only the card is ever handed the button, so the answer comes off the address — a `file://` URL, which the scheme branch would otherwise call an app command.
  check('a pager button is another page to the card, the middle click and the menu alike', () => {
    const { linkHoverInfo, linkHoverKind, isAnotherPageHref } = booted;
    const href = 'file:///docs/002-rains.md';
    const pager = linkHoverInfo(href);
    if (pager.kind !== 'Another page') throw new Error(`the card calls it ${pager.kind}`);
    if (pager.detail !== href) throw new Error(`the address moved: ${pager.detail}`);

    // The kind is what gates the line-count request, so this is also what puts a length on that card.
    if (linkHoverKind(href) !== 'Another page') throw new Error(`the menu reads a pager link as ${linkHoverKind(href)}`);
    if (!isAnotherPageHref(href)) throw new Error('a middle click on a pager button has nowhere to open');

    // An ordinary document link keeps the answer it has, and a file that is not a page is still not one.
    if (linkHoverInfo('notes/other.md').kind !== 'Another page') throw new Error('a plain link stopped being a page');
    if (linkHoverInfo('file:///docs/logo.png').kind !== 'App link') throw new Error('a file the app cannot read became a page');
  });

  // The card follows the pointer at a fixed offset, which lands inside a target this size — so it covered the very page name it had just been given. The preview makes the card taller, but the page name still stays clear.
  check('the taller card over a pager button stands clear of it', () => {
    const { positionLinkHoverTip } = booted;
    const tip = vm.runInContext('linkHoverTip', booted);
    const wasRect = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200 });
    const target = (title, top) => ({
      getAttribute: (name) => (name === 'data-pager-title' ? title : null),
      getBoundingClientRect: () => ({ top, bottom: top + 70, left: 100, right: 775, width: 675, height: 70 }),
    });
    const place = (link, y) => {
      booted.__hovered = link;
      vm.runInContext('activeHoverLink = __hovered;', booted);
      positionLinkHoverTip({ clientX: 400, clientY: y });
      return tip.style.top;
    };
    try {
      // Pointer in the middle of a button two thirds down the window: the card goes above the whole button, not to the pointer.
      if (place(target('The Rains Retreat', 600), 620) !== '390px') throw new Error(`the card landed at ${tip.style.top} instead of above the button`);
      // A button at the top of the window has no room above it, so the card goes under it rather than off screen.
      if (place(target('The Rains Retreat', 20), 40) !== '100px') throw new Error(`with no room above, the card landed at ${tip.style.top}`);
      // An ordinary link is not a big target, and its card follows the pointer until the window edge keeps it on screen.
      if (place(target(null, 600), 620) !== '402px') throw new Error(`an ordinary link's card moved to ${tip.style.top}`);
    } finally {
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('activeHoverLink = null;', booted);
      delete booted.__hovered;
    }
  });

  check('a linked-note preview waits for a rest, ignores old answers and fades without blinking', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    const wasStyle = booted.getComputedStyle;
    const wasSend = booted.ipc.postMessage;
    const waiting = [];
    const cleared = [];
    const sent = [];
    booted.setTimeout = (fn, delay) => {
      waiting.push({ fn, delay });
      return waiting.length;
    };
    booted.clearTimeout = (id) => cleared.push(id);
    // Only the root answers the duration token; the preview box keeps answering with the shrink it is carrying.
    booted.getComputedStyle = (element) => (element === booted.document.documentElement ? { getPropertyValue: () => '300ms' } : wasStyle(element));
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    // The host wraps every answer in the note it rendered, and the card is the width of that note: 692px of note inside a 250px picture box.
    const note = fakeElement('article');
    note.offsetWidth = 692;
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 200 })];
    const wasQuery = previewDocument.querySelector;
    const wasBoxWidth = preview.clientWidth;
    try {
      preview.clientWidth = 250;
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      vm.runInContext('activeHoverToken = 30; activeHoverLink = {}; linkHoverPointer = { clientX: 300, clientY: 300 }; linkHoverTip.hidden = false; showLinkHoverPreviewPlaceholder(); requestLinkPreview("notes/linked.md", 30);', booted);
      if (preview.hidden || preview.classList.contains('is-loaded')) throw new Error('the full card did not keep its placeholder while the preview waited');
      if (waiting.length !== 1 || waiting[0].delay !== 300) throw new Error('the preview did not wait for the deliberate-reveal token');
      if (sent.length !== 0) throw new Error('the preview asked before the pointer rested');
      waiting.shift().fn();
      if (sent.length !== 1 || sent[0].command !== 'previewLink') throw new Error('the rested pointer did not send one preview ask');
      previewDocument.scrollHeight = 200;
      booted.window.leafLinkPreview(30, '<p>Opening.</p>');
      booted.__frames.drain();
      if (!preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Opening.</p>') throw new Error('the host answer did not fade into the placeholder');
      if (preview.style.height !== '73px') throw new Error(`the preview did not shrink to its opening: ${preview.style.height}`);
      if (tip.innerHTML.indexOf('link-hover-tip-preview') > tip.innerHTML.indexOf('link-hover-tip-kind')) throw new Error('the preview is not above the existing rows');
      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip-preview-placeholder') || !css.includes('var(--lt-grain-dot)')) throw new Error('the preview placeholder has no dot grain');
      if (!css.includes('border-bottom: var(--lt-stroke-1) solid var(--lt-border)')) throw new Error('the preview has no divider above its words');
      if (!css.includes('width: calc(100% / var(--link-preview-shrink))') || !css.includes('.link-hover-tip-preview-document {\n  width: 100%')) throw new Error('the rendered opening does not fill the preview card');
      if (!css.includes('contain: inline-size') || !css.includes('  --link-preview-shrink: 0.36;\n  position: relative;\n  contain: inline-size;\n  width: 100%')) throw new Error('the rendered opening can still widen its tooltip');
      vm.runInContext('hideLinkHoverTip();', booted);
      booted.window.leafLinkPreview(30, '<p>Old.</p>');
      if (!preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Opening.</p>') throw new Error('the exit fade replaced the opening with a spinner');
      if (tip.hidden || tip.classList.contains('shown')) throw new Error('hiding skipped the slow fade');
      vm.runInContext('showLinkHoverTip({ clientX: 300, clientY: 300 });', booted);
      booted.__frames.drain();
      if (!tip.classList.contains('shown') || cleared.length === 0) throw new Error('a re-hover did not cancel the pending hide');
      vm.runInContext('hideLinkHoverTip();', booted);
      waiting.at(-1).fn();
      if (!tip.hidden) throw new Error('the fade fallback did not hide the card');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
      booted.getComputedStyle = wasStyle;
      booted.ipc.postMessage = wasSend;
      previewDocument.querySelector = wasQuery;
      preview.clientWidth = wasBoxWidth;
      vm.runInContext('activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview();', booted);
    }
  });

  check('the preview shrink is written once and read off the box that carries it', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const fragment = readFileSync(join(root, 'src/assets/shell/glossary.js'), 'utf8');
    const written = (text) => (text.match(/0\.36(?!\d)/g) || []).length;
    if (!css.includes('--link-preview-shrink: 0.36;')) throw new Error('the shrink is not a property of the picture box');
    if (written(css) !== 1) throw new Error(`the stylesheet writes the shrink ${written(css)} times instead of once`);
    if (written(fragment) !== 0) throw new Error('the fragment still writes the shrink down rather than reading it off the box');
    try {
      // The height follows whatever the box is carrying, so a measured card shrinks by what it measured rather than by a number in the script.
      preview.classList.add('is-loaded');
      previewDocument.scrollHeight = 200;
      preview.style.setProperty('--link-preview-shrink', '0.5');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (preview.style.height !== '100px') throw new Error(`the height ignored the box's own shrink: ${preview.style.height}`);
      preview.style.setProperty('--link-preview-shrink', '0.36');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (preview.style.height !== '72px') throw new Error(`the stylesheet's own shrink did not size the box: ${preview.style.height}`);
    } finally {
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      previewDocument.scrollHeight = 0;
    }
  });

  check('a card is the width of the note in it, with no background left over down its side', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasQuery = previewDocument.querySelector;
    const wasWidth = preview.clientWidth;
    // A note held to 75 characters draws 692px at the window the card was measured in, inside a 250px picture box.
    const note = fakeElement('article');
    note.offsetWidth = 692;
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 200 })];
    try {
      preview.clientWidth = 250;
      preview.classList.add('is-loaded');
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '692px') throw new Error(`the note was laid out at ${scale.style.width} rather than at its own width`);
      const shrink = Number.parseFloat(preview.style.getPropertyValue('--link-preview-shrink'));
      if (shrink.toFixed(3) !== '0.361') throw new Error(`the shrink came out ${shrink} rather than the box over the note`);
      if (Math.abs(692 * shrink - 250) > 0.001) throw new Error('the drawn note does not reach both edges of its box');
      if (preview.style.height !== '73px') throw new Error(`the height did not follow the new shrink: ${preview.style.height}`);
      // A fresh answer is measured on its own: the card it replaces takes its shrink and its layer width with it.
      vm.runInContext('setLinkHoverPreview("<p>Next.</p>");', booted);
      if (scale.style.width !== '' || preview.style.getPropertyValue('--link-preview-shrink') !== '') throw new Error('a new answer would be measured inside the width of the card before it');
      // An answer with no note in it keeps the stylesheet's own shrink rather than none at all, which the harness has no cascade to hand it.
      previewDocument.querySelector = wasQuery;
      previewDocument.scrollHeight = 100;
      preview.style.setProperty('--link-preview-shrink', '0.36');
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '') throw new Error('a card with no note to measure still pinned its layer to a width');
      if (preview.style.height !== '36px') throw new Error(`a card with no note to measure did not fall back to the stylesheet's shrink: ${preview.style.height}`);
    } finally {
      previewDocument.querySelector = wasQuery;
      previewDocument.scrollHeight = 0;
      previewDocument.innerHTML = '';
      preview.clientWidth = wasWidth;
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      preview.style.removeProperty('--link-preview-shrink');
      scale.style.width = '';
      booted.__frames.drain();
    }
  });

  check('a note is measured with room to spread, so a card is never held to the last one’s width', () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const wasQuery = previewDocument.querySelector;
    const wasWidth = preview.clientWidth;
    // The note answers with whatever room it was given, the way a 75-character cap inside a narrow layer would.
    const note = fakeElement('article');
    note.children = [Object.assign(fakeElement('p'), { offsetTop: 0, offsetHeight: 100 })];
    Object.defineProperty(note, 'offsetWidth', { get: () => (scale.style.width === '100vw' ? 900 : 400) });
    try {
      preview.clientWidth = 250;
      preview.classList.add('is-loaded');
      previewDocument.querySelector = (selector) => (selector === 'article' ? note : wasQuery(selector));
      // A wider window after a narrower card: the layer is still carrying the last measurement.
      scale.style.width = '400px';
      vm.runInContext('sizeLinkHoverPreview();', booted);
      if (scale.style.width !== '900px') throw new Error(`the note was capped at the last card's width and measured ${scale.style.width}`);
    } finally {
      previewDocument.querySelector = wasQuery;
      preview.clientWidth = wasWidth;
      preview.classList.remove('is-loaded');
      preview.style.removeProperty('height');
      preview.style.removeProperty('--link-preview-shrink');
      scale.style.width = '';
    }
  });

  check('a new link keeps its hover when an old link finishes leaving', () => {
    const { positionLinkHoverTip } = booted;
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = {
        href,
        getAttribute: (name) => (name === 'href' ? href : null),
        getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
      };
      item.closest = () => item;
      return item;
    };
    const first = link('https://example.com/first');
    const second = link('https://example.com/second');
    const event = (target, relatedTarget = { body: true }) => ({ target, relatedTarget, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const wasRect = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 240, bottom: 120, width: 240, height: 120 });
    try {
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      hover('startLinkHover', event(second));
      hover('endLinkHover', event(first));
      if (vm.runInContext('activeHoverLink', booted) !== second || tip.hidden) throw new Error('an old exit closed the re-entered link');
      hover('startLinkHover', event(second));
      if (vm.runInContext('activeHoverLink', booted) !== second) throw new Error('moving within one link restarted its hover');
      positionLinkHoverTip(event(second));
    } finally {
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('hideLinkHoverTip();', booted);
      delete booted.__hoverEvent;
    }
  });

  check('a rapid link handoff settles on the link under the pointer', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const first = link('notes/first.md');
    const second = link('notes/second.md');
    const event = (target) => ({ target, relatedTarget: { body: true }, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const wasElementFromPoint = booted.document.elementFromPoint;
    booted.document.elementFromPoint = () => second;
    try {
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      booted.__frames.drain();
      if (vm.runInContext('activeHoverLink', booted) !== second || tip.hidden) throw new Error('the link under the pointer did not keep its card');
      // The handoff builds a plain position: a copied pointer event loses its coordinates in the web view.
      if (vm.runInContext('linkHoverPointer.clientX', booted) !== 240) throw new Error('the handed-off card lost its place');
    } finally {
      booted.document.elementFromPoint = wasElementFromPoint;
      vm.runInContext('hideLinkHoverTip();', booted);
      delete booted.__hoverEvent;
    }
  });

  // The card floats beside the page, so replacing the page cannot take it along — the render hides it itself, outright, because the leave's fade exists for a slide to a neighboring link and a fresh page has none.
  check('a fresh render hides the hover card and clears the hovered link', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const spot = link('notes/first.md');
    const hover = () => {
      booted.__hoverEvent = { target: spot, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('startLinkHover(__hoverEvent);', booted);
      booted.__frames.drain();
    };
    try {
      hover();
      if (tip.hidden || !tip.classList.contains('shown')) throw new Error('the card never came up to be rendered over');
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('the render left the card floating over the fresh page');
      if (vm.runInContext('activeHoverLink', booted) !== null) throw new Error('the render left a link hovered, so the same spot could never raise a new card');
      if (vm.runInContext('linkHoverEndFade', booted) !== null) throw new Error('the render left a fade running instead of hiding outright');
      // The same spot raises a new card on the next pointer move.
      hover();
      if (tip.hidden || vm.runInContext('activeHoverLink', booted) !== spot) throw new Error('the spot the card was on could not raise a new one');
      // A render landing mid-fade ends the fade and hides in the same frame, not at the fade's own pace.
      vm.runInContext('hideLinkHoverTip();', booted);
      if (tip.hidden) throw new Error('the leave hid outright, so the mid-fade case went untested');
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      if (!tip.hidden || vm.runInContext('linkHoverEndFade', booted) !== null) throw new Error('a render mid-fade did not cut the fade short');
    } finally {
      vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
      delete booted.__hoverEvent;
    }
  });

  check('a leave settles at the pointer and never clears a newer hover', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const link = (href) => {
      const item = { href, getAttribute: (name) => (name === 'href' ? href : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
      item.closest = () => item;
      return item;
    };
    const first = link('notes/first.md');
    const second = link('notes/second.md');
    const event = (target) => ({ target, relatedTarget: { body: true }, clientX: 240, clientY: 210 });
    const hover = (name, value) => {
      booted.__hoverEvent = value;
      vm.runInContext(`${name}(__hoverEvent);`, booted);
    };
    const reset = () => vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
    const wasElementFromPoint = booted.document.elementFromPoint;
    try {
      // A hover that began after the leave was scheduled is not the settle's to touch, even with nothing under the pointer.
      booted.document.elementFromPoint = () => null;
      hover('startLinkHover', event(first));
      booted.__frames.drain();
      hover('endLinkHover', event(first));
      booted.__newLink = second;
      vm.runInContext('activeHoverLink = __newLink;', booted);
      booted.__frames.drain();
      if (vm.runInContext('activeHoverLink', booted) !== second || !tip.classList.contains('shown')) throw new Error('an old leave cleared the newer hover');
      // The settle looks where the pointer is now, not where the leave event said it was, and hands that place to the next card.
      reset();
      const seen = [];
      booted.document.elementFromPoint = (x, y) => { seen.push(String([x, y])); return second; };
      hover('startLinkHover', event(first));
      hover('endLinkHover', event(first));
      hover('recordLinkHoverPoint', { clientX: 500, clientY: 400 });
      booted.__frames.drain();
      if (seen.at(-1) !== '500,400') throw new Error(`the settle looked where the pointer used to be: ${seen.at(-1)}`);
      if (vm.runInContext('activeHoverLink', booted) !== second) throw new Error('the link under the pointer lost the handoff');
      if (vm.runInContext('linkHoverPointer.clientY', booted) !== 400) throw new Error('the handed-off card lost the pointer’s newest place');
      // A leave with no destination is a pointer gone from the window: hide at once, no settle to wait on.
      reset();
      hover('startLinkHover', event(first));
      booted.__frames.drain();
      hover('endLinkHover', { target: first, relatedTarget: null, clientX: 240, clientY: 210 });
      if (vm.runInContext('activeHoverLink', booted) !== null || tip.classList.contains('shown')) throw new Error('a pointer that left the window kept its card');
      if (booted.__frames.waiting() !== 0) throw new Error('a window leave still waited for a settle');
      // A preview the reader has already seen returns rendered, never as a spinner.
      reset();
      previewDocument.scrollHeight = 100;
      vm.runInContext('linkPreviewCache.set("notes/first.md", "<p>Seen.</p>")', booted);
      hover('startLinkHover', event(first));
      if (preview.hidden || !preview.classList.contains('is-loaded') || previewDocument.innerHTML !== '<p>Seen.</p>') throw new Error('a seen preview came back as a spinner');
      // The card carries the fixed-width mark while its preview is open, so every preview card is one width.
      if (!tip.classList.contains('has-preview')) throw new Error('a card with a preview is still sized by its own words');
      booted.__frames.drain();
      vm.runInContext('hideLinkHoverPreview();', booted);
      if (tip.classList.contains('has-preview')) throw new Error('a card without a preview kept the fixed width');
      // An exiting card stops its spinner with it.
      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip:not(.shown) .link-hover-tip-preview-spinner')) throw new Error('an exiting card still spins its spinner');
      if (!css.includes('.link-hover-tip.has-preview {\n  width: 17rem;\n}')) throw new Error('a preview card has no fixed width of its own');
      // The card is the width of its picture, so the address under it has to break mid-path rather than push the card wider.
      if (!css.slice(css.indexOf('.link-hover-tip-detail {'), css.indexOf('.link-hover-tip-lines {')).includes('overflow-wrap: anywhere;')) throw new Error('a long address would widen the card rather than wrapping inside it');
      // The shared halftone fades across a fraction of the box; a card this small needs the fade inside its own band or it shows nothing.
      if (!css.includes('.link-hover-tip::before {') || !css.includes('var(--lt-mask-opaque) calc(100% - 34px)')) throw new Error('the card has no fade stops of its own for the halftone shadow');
    } finally {
      booted.document.elementFromPoint = wasElementFromPoint;
      vm.runInContext('linkPreviewCache.delete("notes/first.md"); hideLinkHoverTip(); endLinkHoverFade();', booted);
      reset();
      delete booted.__hoverEvent;
      delete booted.__newLink;
    }
  });

  check('the format bar steps heading levels and stops at both ends', () => {
    const { steppedHeadingLevel, blockFormatChanges } = booted;
    const BIGGER = -1;
    const SMALLER = 1;
    const is = (got, want, what) => {
      if (got !== want) throw new Error(`${what}: got ${got}, wanted ${want}`);
    };

    is(steppedHeadingLevel(6, BIGGER), 5, 'h6 bigger'); // one level, not a jump
    is(steppedHeadingLevel(2, BIGGER), 1, 'h2 bigger'); // h1 is reachable
    is(steppedHeadingLevel(1, SMALLER), 2, 'h1 smaller');
    is(steppedHeadingLevel(1, BIGGER), 0, 'h1 bigger'); // nothing above `#`
    is(steppedHeadingLevel(6, SMALLER), 0, 'h6 smaller'); // nothing below `######`
    is(steppedHeadingLevel(0, BIGGER), 2, 'text bigger'); // body text steps in at `##`
    is(steppedHeadingLevel(0, SMALLER), 0, 'text smaller'); // nothing to shrink

    // What grays out. A button with nowhere to go must be the disabled one.
    const bigger = { step: BIGGER };
    const smaller = { step: SMALLER };
    const text = {};
    const quote = { quote: true };
    is(blockFormatChanges(bigger, 'heading', 1), false, 'bigger at h1');
    is(blockFormatChanges(smaller, 'heading', 6), false, 'smaller at h6');
    is(blockFormatChanges(bigger, 'heading', 6), true, 'bigger at h6');
    is(blockFormatChanges(text, 'paragraph', 0), false, 'text on a paragraph');
    is(blockFormatChanges(text, 'heading', 2), true, 'text on a heading');
    is(blockFormatChanges(quote, 'blockquote', 0), false, 'quote on a quote');
    is(blockFormatChanges(quote, 'paragraph', 0), true, 'quote on a paragraph');

    // The marker each press writes. Null means write nothing at all — a freshly typed line commits through this, so a bad marker there writes the words twice.
    const { blockFormatMarker } = booted;
    is(blockFormatMarker(bigger, 6), '##### ', 'h6 bigger marker');
    is(blockFormatMarker(bigger, 2), '# ', 'h2 bigger marker');
    is(blockFormatMarker(bigger, 1), null, 'h1 bigger marker');
    is(blockFormatMarker(smaller, 6), null, 'h6 smaller marker');
    is(blockFormatMarker(bigger, 0), '## ', 'text bigger marker');
    is(blockFormatMarker(text, 2), '', 'text marker');
    is(blockFormatMarker(quote, 0), '> ', 'quote marker');
  });

  check('a fenced code block offers its inside and never its fences', () => {
    // The reader edits the inside only, so the fences cannot be typed away. The span is spliced verbatim: a wrong end writes code over a fence.
    const inside = (src) => {
      const span = fencedCodeInnerSpan(src);
      return span ? src.slice(span.from, span.to) : null;
    };
    const keeps = (src, want) => {
      const got = inside(src);
      if (got !== want) throw new Error(`${JSON.stringify(src)} -> ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      // Replacing the span must leave both fences standing.
      if (got !== null) {
        const span = fencedCodeInnerSpan(src);
        const rebuilt = src.slice(0, span.from) + 'X' + src.slice(span.to);
        if (!/^[ \t]*(`{3,}|~{3,})/.test(rebuilt) || !/(`{3,}|~{3,})[ \t]*$/.test(rebuilt)) {
          throw new Error(`rewriting ${JSON.stringify(src)} broke a fence: ${JSON.stringify(rebuilt)}`);
        }
      }
    };

    keeps('```\ncode\n```', 'code');
    keeps('```rust\nlet x = 1;\n```', 'let x = 1;'); // the language stays on the fence
    keeps('```\n\n```', ''); // what the insert row writes: one empty line
    keeps('```\na\nb\n```', 'a\nb'); // several lines
    keeps('```\ncode\n\n```', 'code\n'); // a trailing blank line is code
    keeps('~~~\ncode\n~~~', 'code'); // tildes
    keeps('````\n```\n````', '```'); // a fence inside a longer fence
    keeps('  ```\n  code\n  ```', '  code'); // indented, inside a list
    keeps('```\ncafé 😀\n```', 'café 😀'); // multi-byte, where the offsets matter
    keeps('    indented code', null); // no fences to hide
    keeps('```\nunterminated', null); // no end to trust
    keeps('```\n```', null); // no line inside to edit
  });

  // Clearing the text out of a paragraph or a heading used to write the leftovers into the file — a bare `##`, or the literal text `<br>` that Chromium leaves in an emptied contenteditable. So an empty serialization is a delete of the whole line, and the range it deletes has to swallow one blank line too: a mapped range stops short of the separator (`trim_block_end`), so splicing the range alone stacks the blank lines from both sides.
  check('a block typed empty is taken away, and takes one blank line with it', () => {
    const { blockSerializationEmpty, blockDeleteRange, commitBlockEdit } = booted;

    // What counts as nothing left. The `<br>` and the hashes are what the serializer writes for an empty block, not text somebody typed.
    const empty = (text, kind, want) => {
      if (blockSerializationEmpty(text, kind) !== want) {
        throw new Error(`${JSON.stringify(text)} as a ${kind}: got ${!want}`);
      }
    };
    empty('', 'paragraph', true);
    empty('<br>', 'paragraph', true);
    empty('<br/>', 'paragraph', true);
    empty('<br><br>', 'paragraph', true); // however many it leaves
    empty('  ', 'paragraph', true);
    empty('##', 'heading', true);
    empty('## ', 'heading', true);
    empty('###### <br>', 'heading', true);
    empty('still here', 'paragraph', false);
    empty('## Named', 'heading', false);
    empty('#', 'paragraph', false); // a paragraph whose text is one hash is text

    // The range, over the real buffer. Deleting it must leave the neighbors one blank line apart, and never two. The offsets are UTF-8 bytes, so the cut is made on bytes.
    const leaves = (source, start, end, want) => {
      const span = blockDeleteRange(source, start, end);
      const bytes = Buffer.from(source, 'utf8');
      const got = Buffer.concat([bytes.subarray(0, span.start), bytes.subarray(span.end)]).toString('utf8');
      if (got !== want) throw new Error(`${JSON.stringify(source)} minus [${start},${end}) -> ${JSON.stringify(got)}`);
    };
    leaves('A\n\nB\n\nC', 3, 4, 'A\n\nC'); // the middle one
    leaves('A\n\nB\n\nC', 0, 1, 'B\n\nC'); // the first one
    leaves('A\n\nB\n\nC', 6, 7, 'A\n\nB'); // the last one takes the run before it
    leaves('A\n\nB\n', 3, 4, 'A'); // and so does one with only a trailing newline after it
    leaves('B\n', 0, 1, ''); // the only block leaves an empty buffer
    leaves('A\n\n\n\nB', 0, 1, 'B'); // an extra blank line somebody left goes with it
    leaves('# T\n\ncafé 😀\n\nZ', 5, 16, '# T\n\nZ'); // multi-byte, where the offsets matter

    // And the commit itself: what reaches the host.
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const block = (kind, tag, start, end) => ({
      tagName: tag,
      isConnected: true,
      dataset: { blockKind: kind, srcStart: String(start), srcEnd: String(end) },
      childNodes: [],
      textContent: '',
      previousElementSibling: null,
      nextElementSibling: null,
    });
    const edits = () => posted.filter((message) => message.command === 'editBlock');
    try {
      const source = '# Title\n\nA paragraph.\n\n```\ncode\n```\n';
      booted.window.leafBlocksResynced({ source });

      // The paragraph, emptied: its own range plus the blank line under it, replaced by nothing.
      posted.length = 0;
      commitBlockEdit(block('paragraph', 'P', 9, 21), '<br>');
      const gone = edits();
      if (gone.length !== 1) throw new Error(`emptying a paragraph sent ${gone.length} edits`);
      if (gone[0].text !== '') throw new Error(`it wrote ${JSON.stringify(gone[0].text)}`);
      const after = source.slice(0, gone[0].start) + source.slice(gone[0].end);
      if (after !== '# Title\n\n```\ncode\n```\n') throw new Error(`the buffer became ${JSON.stringify(after)}`);
      if (after.includes('<br>')) throw new Error('the leftover break was written into the file');

      // The heading, emptied: no bare hashes left behind.
      posted.length = 0;
      commitBlockEdit(block('heading', 'H1', 0, 7), '# ');
      const headingGone = edits();
      if (headingGone.length !== 1) throw new Error(`emptying a heading sent ${headingGone.length} edits`);
      const withoutHeading = source.slice(0, headingGone[0].start) + source.slice(headingGone[0].end);
      if (withoutHeading !== 'A paragraph.\n\n```\ncode\n```\n') {
        throw new Error(`the buffer became ${JSON.stringify(withoutHeading)}`);
      }
      if (/#/.test(withoutHeading)) throw new Error('the hashes were written into the file');

      // Emptying the inside of a fence leaves an empty fence, not a missing one: the raw-source editor commits a range narrower than its block, and empty there means empty code.
      posted.length = 0;
      const fence = block('code_block', 'PRE', 23, 34);
      commitBlockEdit(fence, '', { start: 27, end: 31 });
      const inner = edits();
      if (inner.length !== 1) throw new Error(`emptying a fence sent ${inner.length} edits`);
      if (inner[0].start !== 27 || inner[0].end !== 31) {
        throw new Error(`the fence's own range was widened to [${inner[0].start},${inner[0].end})`);
      }
      const emptyFence = source.slice(0, 27) + source.slice(31);
      if (!emptyFence.includes('```\n\n```')) throw new Error(`the fence went: ${JSON.stringify(emptyFence)}`);

      // A narrower range on a paragraph is refused the same way — the guard is the range, not only the kind.
      posted.length = 0;
      commitBlockEdit(block('paragraph', 'P', 9, 21), '', { start: 9, end: 15 });
      if (edits()[0].end !== 15) throw new Error('a partial paragraph commit was turned into a delete');

      // The only block in a document: the buffer empties, and no caret is claimed — bindReadingEditor opens the blank pair instead.
      posted.length = 0;
      vm.runInContext('pendingCaret = null;', booted);
      booted.window.leafBlocksResynced({ source: 'Alone\n' });
      commitBlockEdit(block('paragraph', 'P', 0, 5), '<br>');
      const only = edits();
      if (only.length !== 1 || only[0].start !== 0 || only[0].end !== 6) {
        throw new Error(`the only block deleted [${only[0].start},${only[0].end})`);
      }
      if (vm.runInContext('pendingCaret', booted) !== null) {
        throw new Error('a caret was claimed in a document with nothing left to put it in');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.window.leafBlocksResynced({ source: '' });
      vm.runInContext('pendingCaret = null;', booted);
    }
  });

  // A selection can already cross blocks — Ctrl+A makes one — and each block is its own editing host, so the browser has no answer for Delete on it. The splice that answers it runs from the first touched block's start to the last one's end, which is the widest range anything in the reading view writes: getting it wrong takes out text nobody selected.
  check('Delete over a run of blocks keeps the two ends and nothing between them', () => {
    const { blockRunForDelete, crossBlockDeletePlan, blockMarkerOf, blockCanBeCutInHalf } = booted;

    // The run the splice is allowed to cover. Refusing leaves the key to the browser, which is the right answer for a selection inside one block.
    const block = (kind, start, end, tag) => ({
      tagName: tag || (kind === 'heading' ? 'H2' : 'P'),
      dataset: { blockKind: kind, srcStart: String(start), srcEnd: String(end) },
      childNodes: [],
      querySelector: () => null,
      parentElement: null,
      previousElementSibling: null,
      nextElementSibling: null,
    });
    const body = (...blocks) => {
      const parent = { children: blocks };
      blocks.forEach((one, index) => {
        one.parentElement = parent;
        one.previousElementSibling = blocks[index - 1] || null;
        one.nextElementSibling = blocks[index + 1] || null;
      });
      return blocks;
    };

    const [a, b, c] = body(block('paragraph', 0, 1), block('paragraph', 3, 4), block('paragraph', 6, 7));
    const run = blockRunForDelete(a, c);
    if (!run || run.elements.length !== 3) throw new Error('a run of three siblings was refused');
    if (JSON.stringify(run.ranges) !== '[[0,1],[3,4],[6,7]]') throw new Error(`the ranges came back ${JSON.stringify(run.ranges)}`);
    if (blockRunForDelete(b, b)) throw new Error('a selection inside one block should be left to the browser');
    if (blockRunForDelete(c, a)) throw new Error('a backwards run should be refused');
    // A raw-HTML wrapper nests the blocks after it, so the two ends can have different parents.
    const [nested] = body(block('paragraph', 9, 10));
    if (blockRunForDelete(a, nested)) throw new Error('two ends under different parents were spliced');
    // A range the host would refuse: the map drifted and two blocks overlap.
    const [bad, worse] = body(block('paragraph', 0, 9), block('paragraph', 4, 12));
    if (blockRunForDelete(bad, worse)) throw new Error('overlapping ranges were spliced');
    // A block that is only in the DOM has no offset to splice at.
    const [real, blank] = body(block('paragraph', 0, 1), block('paragraph', 3, 3));
    if (blockRunForDelete(real, blank)) throw new Error('a blank line was made one end of a splice');

    // Which kinds may be cut part way. Everything else the selection touches goes whole — only these two round-trip from their rendered DOM back to source.
    if (!blockCanBeCutInHalf(block('paragraph', 0, 1))) throw new Error('a paragraph cannot be cut');
    if (!blockCanBeCutInHalf(block('heading', 0, 1))) throw new Error('a heading cannot be cut');
    for (const kind of ['code_block', 'table', 'list', 'blockquote', 'html_block', 'rule']) {
      if (blockCanBeCutInHalf(block(kind, 0, 1))) throw new Error(`a ${kind} was cut in half`);
    }
    // And a paragraph the app cannot rebuild from its rendered DOM — one holding a picture — goes whole like the rest.
    const withPicture = block('paragraph', 0, 1);
    withPicture.querySelector = () => ({});
    if (blockCanBeCutInHalf(withPicture)) throw new Error('a paragraph holding a picture was cut in half');
    if (blockMarkerOf(block('heading', 0, 1, 'H3')) !== '### ') throw new Error('a heading lost its level');
    if (blockMarkerOf(block('paragraph', 0, 1)) !== '') throw new Error('a paragraph was given a marker');

    // And the splice. The source is four blocks; a selection from the middle of the first to the middle of the last has to leave one block holding both halves.
    const source = '# Title\n\nFirst paragraph.\n\n```\ncode\n```\n\nLast paragraph.\n';
    const at = (text) => source.indexOf(text);
    const half = (markdown) => ({ markdown, text: markdown.length });
    const applied = (plan) => source.slice(0, plan.start) + plan.text + source.slice(plan.end);

    const across = crossBlockDeletePlan(
      source,
      { start: at('First'), marker: '' },
      { end: source.length - 1, marker: '' },
      half('First'),
      half('paragraph.'),
    );
    if (applied(across) !== '# Title\n\nFirstparagraph.\n') {
      throw new Error(`across four blocks left ${JSON.stringify(applied(across))}`);
    }
    // The fence in the middle was never serialized — it is simply not in the replacement.
    if (applied(across).includes('```')) throw new Error('a block in the middle survived');

    // A selection ending inside the fence takes the fence whole rather than half of it: that end survives as nothing.
    const intoFence = crossBlockDeletePlan(
      source,
      { start: at('First'), marker: '' },
      { end: at('```\ncode\n```') + '```\ncode\n```'.length, marker: '' },
      half('First'),
      half(''),
    );
    if (applied(intoFence) !== '# Title\n\nFirst\n\nLast paragraph.\n') {
      throw new Error(`into a fence left ${JSON.stringify(applied(intoFence))}`);
    }

    // The joined block keeps the kind of the first block that kept any of its own text, so a heading cut part way is still a heading.
    const fromHeading = crossBlockDeletePlan(
      source,
      { start: 0, marker: '# ' },
      { end: at('First') + 'First paragraph.'.length, marker: '' },
      half('Ti'),
      half('paragraph.'),
    );
    if (applied(fromHeading) !== '# Tiparagraph.\n\n```\ncode\n```\n\nLast paragraph.\n') {
      throw new Error(`from a heading left ${JSON.stringify(applied(fromHeading))}`);
    }
    // And where the first block went whole, the last one's kind is what is left to keep — a heading's words do not come back as body text.
    const ontoHeading = crossBlockDeletePlan(
      source,
      { start: at('```'), marker: '' },
      { end: source.length - 1, marker: '## ' },
      half(''),
      half('paragraph.'),
    );
    if (applied(ontoHeading) !== '# Title\n\nFirst paragraph.\n\n## paragraph.\n') {
      throw new Error(`onto a heading left ${JSON.stringify(applied(ontoHeading))}`);
    }

    // Both ends empty: the whole run goes, and the range eats one blank line the way one emptied block does.
    const fenceEnd = at('```\ncode\n```') + '```\ncode\n```'.length;
    const whole = crossBlockDeletePlan(source, { start: at('First'), marker: '' }, { end: fenceEnd, marker: '' }, half(''), half(''));
    if (applied(whole) !== '# Title\n\nLast paragraph.\n') throw new Error(`the whole run left ${JSON.stringify(applied(whole))}`);
    if (applied(whole).includes('\n\n\n')) throw new Error('the blank lines from both sides were left stacked');
  });

  // Ctrl+A widens a step per press with the caret in a block — the block, its section, the page — and the section is what the outline draws as one part of the document. The rule has to be the predictable one: stop at the next heading whatever its size, so pressing twice never takes more than what was on screen.
  check('a section is a heading and everything under it, down to the next heading', () => {
    const { blockSectionRun, selectAllStep } = booted;
    // A document as a run of siblings, written the way the outline reads it.
    const page = (...kinds) => {
      const blocks = kinds.map((kind, index) => ({
        dataset: { blockKind: kind === 'p' ? 'paragraph' : 'heading', srcStart: String(index * 10), srcEnd: String(index * 10 + 5) },
        name: kind + index,
      }));
      const parent = { children: blocks };
      blocks.forEach((one) => { one.parentElement = parent; });
      return blocks;
    };
    const named = (run) => (run ? run.map((one) => one.name).join(' ') : null);
    const sectionOf = (blocks, index, want) => {
      const got = named(blockSectionRun(blocks[index]));
      if (got !== want) throw new Error(`the section of ${blocks[index].name} is ${got}, wanted ${want}`);
    };

    // A paragraph under an h3 under an h2: the nearest heading above it is the h3, so that is the section — the second press never reaches the h2's whole part.
    const nested = page('h2', 'p', 'h3', 'p', 'p', 'h2', 'p');
    sectionOf(nested, 3, 'h32 p3 p4');
    sectionOf(nested, 4, 'h32 p3 p4');
    // The h2 itself stops at the h3 under it and goes no further.
    sectionOf(nested, 0, 'h20 p1');
    // The last heading in the document takes everything left.
    sectionOf(nested, 5, 'h25 p6');
    sectionOf(nested, 6, 'h25 p6');
    // A document opening with body text: from the first block down to the first heading.
    const leading = page('p', 'p', 'h2', 'p');
    sectionOf(leading, 0, 'p0 p1');
    sectionOf(leading, 1, 'p0 p1');
    // A heading with nothing under it is its own section, which is what sends the second press on to the page instead.
    const lone = page('p', 'h2');
    sectionOf(lone, 1, 'h21');
    // No headings at all: the section is the whole document, so the second press and the third agree.
    sectionOf(page('p', 'p', 'p'), 1, 'p0 p1 p2');

    // Which press it is, read off what is already selected rather than counted — so moving the caret between two presses starts again, with nothing to reset.
    const step = (spans, covers, whole, want, what) => {
      const got = selectAllStep(spans, covers, whole);
      if (got !== want) throw new Error(`${what}: step ${got}, wanted ${want}`);
    };
    step(false, 0, 40, 1, 'a caret in a block'); // nothing selected: the browser takes the block
    step(false, 12, 40, 1, 'a word highlighted'); // part of it: still the browser's
    step(false, 40, 40, 2, 'the whole block'); // the block is taken, so the section is next
    step(true, 60, 40, 3, 'a selection past the block'); // the section is taken, so the page is next
    step(false, 0, 0, 2, 'an empty block'); // nothing to select, so the first press takes the section

    // And whether there is a caret in a block at all, which is what decides between stepping and the one press that takes the page. A locked document has no editing host, so it keeps the Ctrl+A it always had.
    const { caretBlockForSelectAll } = booted;
    const inApp = booted.document.getElementById('app');
    const wasContains = inApp.contains;
    inApp.contains = (node) => !!node && node.inApp === true;
    try {
      const host = (attributes, inside) => {
        const block = {
          nodeType: 1,
          dataset: attributes.editingSource ? { editingSource: 'true' } : {},
          inApp: inside !== false,
          getAttribute: (name) => (name === 'contenteditable' ? attributes.contenteditable || null : null),
        };
        block.closest = () => block;
        return block;
      };
      if (!caretBlockForSelectAll(host({ contenteditable: 'true' }))) {
        throw new Error('an unlocked block does not step');
      }
      if (caretBlockForSelectAll(host({}))) throw new Error('a locked block steps instead of taking the page');
      if (caretBlockForSelectAll(host({ contenteditable: 'true', editingSource: true }))) {
        throw new Error('a block showing its raw source lost the browser’s own select-all');
      }
      if (caretBlockForSelectAll(host({ contenteditable: 'true' }, false))) {
        throw new Error('a block outside the document was stepped through');
      }
      if (caretBlockForSelectAll({ nodeType: 1, closest: () => null, inApp: true })) {
        throw new Error('something that is not a block was read as one');
      }
    } finally {
      inApp.contains = wasContains;
    }
  });

  // Ctrl+Z used to bow out whenever the keystroke landed in a block you can type in, and after a delete the caret is in one — so the press did nothing while the Undo button beside it worked. A block only owns the key while it has keystrokes of its own to take back.
  check('Ctrl+Z reaches the app’s undo unless the block has typing to take back', () => {
    const { nativeUndoOwnsKey } = booted;
    const inApp = booted.document.getElementById('app');
    const wasContains = inApp.contains;
    inApp.contains = () => true;
    try {
      const block = (state) => {
        const el = Object.assign(new FakeElement(), {
          nodeType: 1,
          tagName: 'P',
          dataset: { blockKind: 'paragraph', srcStart: '0', srcEnd: '5' },
          childNodes: [],
          classList: { contains: (name) => name === 'leaf-editable' },
          getAttribute: (name) => (name === 'contenteditable' ? 'true' : null),
          __editingActive: state.editing === true,
          __editBaseline: state.baseline,
        });
        el.closest = () => el;
        return el;
      };
      // A block being typed in: its own text has moved off the baseline, so the browser's keystroke undo is the right one.
      if (!nativeUndoOwnsKey(block({ editing: true, baseline: 'something else' }))) {
        throw new Error('a block mid-typing lost its native undo');
      }
      // The same block with nothing typed yet — where the caret lands after a delete or a split.
      if (nativeUndoOwnsKey(block({ editing: true, baseline: '' }))) {
        throw new Error('a block with no keystrokes of its own still swallowed Ctrl+Z');
      }
      if (nativeUndoOwnsKey(block({ editing: false, baseline: undefined }))) {
        throw new Error('a block nobody has typed in swallowed Ctrl+Z');
      }
      // The code view is Monaco's, always.
      vm.runInContext('codeViewActive = true;', booted);
      if (!nativeUndoOwnsKey(block({ editing: false, baseline: undefined }))) {
        throw new Error('Monaco lost its own undo');
      }
      vm.runInContext('codeViewActive = false;', booted);
      // Nothing editable under the key at all: the app's undo, as before.
      if (nativeUndoOwnsKey(Object.assign(new FakeElement(), { nodeType: 1, closest: () => null }))) {
        throw new Error('a press outside every field was treated as typing');
      }
    } finally {
      inApp.contains = wasContains;
      vm.runInContext('codeViewActive = false;', booted);
    }
  });

  // The delete is behind the same padlock as the rest of the editing layer, and the code view has its own. Neither refusal is visible — the key just does nothing — so both are held here rather than left to be found by hand.
  check('the cross-block delete is behind the padlock and out of the code view', () => {
    const { handleBlockRunDeleteKey } = booted;
    let reads = 0;
    let prevented = 0;
    const wasSelection = booted.getSelection;
    booted.getSelection = () => {
      reads += 1;
      return null; // Past the guards, and then nothing to delete.
    };
    const press = (key) => {
      reads = 0;
      prevented = 0;
      handleBlockRunDeleteKey({ key, preventDefault: () => { prevented += 1; } });
    };
    try {
      // Locked, which is how every document opens.
      booted.setReadingUnlocked(false);
      vm.runInContext("codeViewActive = false; currentDocumentFormat = 'markdown';", booted);
      press('Delete');
      if (reads) throw new Error('a locked document read the selection');
      press('Backspace');
      if (reads) throw new Error('a locked document read the selection on Backspace');

      // Unlocked, the same press gets as far as reading the selection — which is what proves the padlock is what refused above.
      booted.setReadingUnlocked(true);
      press('Delete');
      if (reads !== 1) throw new Error('an unlocked document did not reach the selection');
      press('Backspace');
      if (reads !== 1) throw new Error('Backspace does not answer a cross-block selection');
      if (prevented) throw new Error('the browser was stopped with no run to splice');
      // No other key is this one's business.
      for (const key of ['a', 'Enter', 'ArrowLeft', 'x']) {
        press(key);
        if (reads) throw new Error(`${key} was read as a delete`);
      }

      // The code view has its own editor and its own padlock.
      vm.runInContext('codeViewActive = true;', booted);
      press('Delete');
      if (reads) throw new Error('the code view was answered by the reading view’s delete');
      vm.runInContext('codeViewActive = false;', booted);

      // And a document that is not Markdown has no block map to splice against.
      vm.runInContext("currentDocumentFormat = 'xml';", booted);
      press('Delete');
      if (reads) throw new Error('an XML document was spliced by the Markdown delete');
    } finally {
      booted.getSelection = wasSelection;
      booted.setReadingUnlocked(false);
      vm.runInContext("codeViewActive = false; currentDocumentFormat = 'markdown';", booted);
    }
  });

  // The padlock is the one control whose whole job is to say this document can be changed, so it stands only where that is true. A page that proved no source range has nothing to click into, and pressing it there costs a whole re-render and shows nothing — which reads as a broken button. The tray's other tools do not go with it, and the source view's padlock is a different switch on the same document.
  check('the reading padlock leaves the tray on a document that proved nothing', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    try {
      read('currentDocumentBindsAnything = true;');
      booted.renderViewTools('reading');
      if (read('readerLockButton.hidden')) throw new Error('a document that proved a range lost its padlock');
      if (read('speedReaderButton.hidden')) throw new Error('the speed reader left the tray with the padlock');

      read('currentDocumentBindsAnything = false;');
      booted.renderViewTools('reading');
      if (!read('readerLockButton.hidden')) throw new Error('a document that proved nothing kept its padlock');
      if (read('speedReaderButton.hidden')) throw new Error('the speed reader went with the padlock');

      // The source view edits the whole file whatever the page proved, so its own padlock stands on the very same document.
      booted.renderViewTools('code');
      if (read('readerLockButton.hidden')) throw new Error('the source view lost its padlock');
    } finally {
      read('currentDocumentBindsAnything = true;');
      booted.renderViewTools('reading');
    }
  });

  // The answer comes off the payload the host already sends, and it is read as a document binds — so an email that proved nothing and an empty note, which has no blocks either, must not come out the same.
  check('a document binds something when it is Markdown or a block proved a range', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const bind = (doc) => {
      booted.bindReadingEditor(doc, { deferCaret: true });
      return read('currentDocumentBindsAnything');
    };
    try {
      if (!bind({ format: 'markdown', blocks: [], source: '' })) {
        throw new Error('an empty note lost the padlock it is unlocked to type into');
      }
      if (bind({ format: 'eml', blocks: [], source: 'Subject: packed\r\n' })) {
        throw new Error('a document with no proved range still claimed one');
      }
      if (!bind({ format: 'eml', blocks: [{ id: 0, kind: 'email_header', start: 9, end: 15 }], source: 'Subject: packed\r\n' })) {
        throw new Error('a proved range did not put the padlock back');
      }
    } finally {
      read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; currentDocumentBindsAnything = true;");
    }
  });

  // A message's words are typed on where they are drawn, and the one thing that may never happen is Markdown syntax landing in somebody's mail. So the serializer writes text and nothing else, and a block only opens for typing when what it writes equals the bytes its range cuts.
  check('an email block serializes back to the file’s own bytes', () => {
    const { emailBlockDomToText } = booted;
    // A drawn paragraph: two lines joined by a break, with a bare address linkified the way the renderer draws one.
    const text = (value) => ({ nodeType: 3, nodeValue: value });
    const element = (tag, children) => ({
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: children,
      dataset: {},
    });
    const paragraph = element('p', [
      text('Read '),
      element('a', [text('https://example.com/page')]),
      element('br', []),
      text('before Friday.'),
    ]);
    const written = emailBlockDomToText(paragraph, '\r\n');
    if (written !== 'Read https://example.com/page\r\nbefore Friday.') {
      throw new Error(`the serializer did not write the file’s bytes: ${JSON.stringify(written)}`);
    }
    // The ending is the one the block's own slice uses, never the browser's.
    if (emailBlockDomToText(paragraph, '\n') !== 'Read https://example.com/page\nbefore Friday.') {
      throw new Error('the serializer ignored the line ending it was given');
    }
    // Nothing a Markdown serializer would add: no asterisks, no bracket form for the link.
    if (/[*[\]`]/.test(written)) throw new Error(`Markdown syntax reached a message: ${written}`);
  });

  // The gate over that serializer: a block opens for typing only where its output is the slice. A row the reader re-spelled -- a date, an address list the parser rejoined -- has to keep the raw-slice editor, or typing on it would rewrite bytes nobody touched.
  check('an email block opens for typing only where the page can write its bytes back', () => {
    const { emailBlockTypeableInPlace } = booted;
    const source = 'From: a@example.com\r\nDate: 3 Aug 2026 09:00 +0000\r\n\r\nOne line.\r\n';
    const read = (expression) => vm.runInContext(expression, booted);
    const block = (start, end, drawn) => ({
      dataset: { srcStart: String(start), srcEnd: String(end) },
      nodeType: 1,
      tagName: 'P',
      childNodes: [{ nodeType: 3, nodeValue: drawn }],
    });
    const wasSource = read('currentDocumentSource');
    try {
      read(`currentDocumentSource = ${JSON.stringify(source)};`);
      // The paragraph, drawn exactly as the file spells it.
      if (!emailBlockTypeableInPlace(block(source.indexOf('One line.'), source.indexOf('One line.') + 9, 'One line.'))) {
        throw new Error('a paragraph drawn as the file spells it did not open for typing');
      }
      // The date row. Drawn as the file spells it, it opens; re-spelled by the reader into a fuller form, it must not.
      const value = '3 Aug 2026 09:00 +0000';
      const dateStart = source.indexOf(value);
      const dateEnd = dateStart + value.length;
      if (!emailBlockTypeableInPlace(block(dateStart, dateEnd, value))) {
        throw new Error('a row drawn as the file spells it did not open for typing');
      }
      if (emailBlockTypeableInPlace(block(dateStart, dateEnd, 'Mon, 3 Aug 2026 09:00:00 +0000'))) {
        throw new Error('a row the reader re-spelled opened for typing over bytes it does not match');
      }
      // A paragraph running over two lines, drawn the way the renderer draws one: two runs of text with a break between them and no character of the page's own.
      const over = 'One line.\r\nAnd another.';
      const twoLines = {
        dataset: { srcStart: '0', srcEnd: String(over.length) },
        nodeType: 1,
        tagName: 'P',
        childNodes: [
          { nodeType: 3, nodeValue: 'One line.' },
          { nodeType: 1, tagName: 'BR', childNodes: [] },
          { nodeType: 3, nodeValue: 'And another.' },
        ],
      };
      read(`currentDocumentSource = ${JSON.stringify(over)};`);
      if (!emailBlockTypeableInPlace(twoLines)) {
        throw new Error('a paragraph over two lines fell back to the raw editor');
      }
      // The fault it had: one newline of the page's own after the break, and the paragraph can never be written back.
      twoLines.childNodes[2] = { nodeType: 3, nodeValue: '\nAnd another.' };
      if (emailBlockTypeableInPlace(twoLines)) {
        throw new Error('a paragraph carrying a character the message has not got opened for typing');
      }

      read(`currentDocumentSource = ${JSON.stringify(source)};`);
      // A block with no usable range is nobody's to type on.
      if (emailBlockTypeableInPlace({ dataset: {}, childNodes: [] })) {
        throw new Error('a block with no range opened for typing');
      }
    } finally {
      read(`currentDocumentSource = ${JSON.stringify(wasSource)};`);
    }
  });

  // The grab bar is offered where a block's range is the whole block. In a message that is a body paragraph and nothing else: a header value's range is the value inside a labeled line, so dragging one would leave its label behind — the same reason JSON and YAML have no gutter at all.
  check('only a message’s body paragraphs are offered the grab bar', () => {
    const { blockGutterTargetAllowed } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const block = (kind) => ({ dataset: { blockKind: kind } });
    const wasFormat = read('currentDocumentFormat');
    try {
      read("currentDocumentFormat = 'eml';");
      if (!blockGutterTargetAllowed(block('email_paragraph'))) {
        throw new Error('a body paragraph was refused the grab bar');
      }
      for (const kind of ['email_header', 'email_body']) {
        if (blockGutterTargetAllowed(block(kind))) {
          throw new Error(`${kind} was offered a grab bar it cannot be dragged by`);
        }
      }
      if (blockGutterTargetAllowed(null)) throw new Error('nothing at all was offered a grab bar');

      // Every block of a note still qualifies — the rule above is the message's alone.
      read("currentDocumentFormat = 'markdown';");
      if (!blockGutterTargetAllowed(block('paragraph')) || !blockGutterTargetAllowed(block('table'))) {
        throw new Error('a note lost the gutter it already had');
      }
    } finally {
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)};`);
    }
  });

  // The plus writes a block into a file that is a list of blocks. A message is an envelope with parts in it, so the only thing a reader can add without rewriting it is another paragraph of a body — and the blank line that separates two of them has to be written in that message's own ending, not the browser's.
  check('a message is offered one thing to add, and its blank line is its own', () => {
    const { blockInsertOptions, documentLineEnding } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const wasFormat = read('currentDocumentFormat');
    const wasSource = read('currentDocumentSource');
    try {
      read("currentDocumentFormat = 'eml'; currentDocumentSource = 'Subject: a\\r\\n\\r\\nOne.\\r\\n';");
      const offered = blockInsertOptions(null);
      if (offered.length !== 1 || offered[0].blank !== 'text') {
        throw new Error(`a message was offered ${JSON.stringify(offered.map((one) => one.id))}`);
      }
      if (documentLineEnding() !== '\r\n') throw new Error('a message written with \\r\\n was given \\n');

      // The same message written the other way keeps that.
      read("currentDocumentSource = 'Subject: a\\n\\nOne.\\n';");
      if (documentLineEnding() !== '\n') throw new Error('a message written with \\n was given \\r\\n');

      // A note is unaffected: it gets its whole menu, and its separator was always \n.
      read("currentDocumentFormat = 'markdown';");
      if (blockInsertOptions(null).length < 5) throw new Error('a note lost entries from its plus');
      if (documentLineEnding() !== '\n') throw new Error('a note stopped being written with \\n');
    } finally {
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)}; currentDocumentSource = ${JSON.stringify(wasSource)};`);
    }
  });

  // Half a message opens and half of it does not, and nothing on the page said which — the same fault the padlock had. A press on a shut part says why; a press on one that opens says nothing, because it is about to open.
  check('a part of a message that cannot open says why when it is pressed', () => {
    const { wireEmailClosedParts } = booted;
    const said = [];
    const wasToast = booted.leafToast;
    // A stand-in body that records the one listener, so a press can be raised at it.
    let press = null;
    const body = {
      addEventListener: (type, handler) => {
        if (type === 'pointerdown') press = handler;
      },
    };
    // `closest` answers for whichever ancestors this element is said to have.
    const at = (...held) => ({ closest: (selector) => (held.includes(selector) ? {} : null) });
    try {
      booted.leafToast = (message) => said.push(message);
      wireEmailClosedParts(body);
      if (!press) throw new Error('nothing listens for a press on the page');

      press({ target: at('.email-body') });
      if (said.length !== 1 || !said[0].includes('source view')) {
        throw new Error(`a packed body did not say where to edit it: ${JSON.stringify(said)}`);
      }
      press({ target: at('.email-headers') });
      if (said.length !== 2 || !said[1].includes('source view')) {
        throw new Error(`a coded header did not say where to edit it: ${JSON.stringify(said)}`);
      }
      // A part that opens answers for itself, and the attachment list is files rather than words.
      press({ target: at('[data-src-start]', '.email-body') });
      press({ target: at('.email-attachments') });
      if (said.length !== 2) throw new Error(`a part that opens was growled at: ${JSON.stringify(said)}`);
    } finally {
      booted.leafToast = wasToast;
    }
  });

  // The gutter works over the blocks standing in the page, and a message is the first document whose blocks are not all children of it — its paragraphs stand inside the body section. Two symptoms fell out of the one line: the gutter vanished the moment the pointer left the words for the margin, and the last paragraph never had a space under it for the plus.
  check('the gutter sees a message’s paragraphs, not the section around them', () => {
    const { blockGutterOccupants, aimBlockGutterBelow } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const wasSpace = booted.aimBlockGutterAtSpace;
    // A block with height, so the occupant filter keeps it.
    const block = (name, held = [], classes = [], range = true) => ({
      name,
      children: held,
      dataset: range ? { srcStart: '0', srcEnd: '4' } : {},
      classList: { contains: (one) => classes.includes(one) },
      getBoundingClientRect: () => ({ top: 0, bottom: 10 }),
    });
    const stand = (children) => {
      inApp.querySelector = (selector) =>
        selector === '.document-body' ? { children } : wasQuery.call(inApp, selector);
    };
    try {
      const first = block('first');
      const last = block('last');
      const after = block('after');
      // A plain-text body: the section holds no range of its own, and the paragraphs inside it are the blocks.
      stand([block('heading'), block('section', [first, last], ['email-body'], false), after]);
      const held = blockGutterOccupants().map((el) => el.name);
      if (held.join() !== 'heading,first,last,after') {
        throw new Error(`the gutter saw ${JSON.stringify(held)}`);
      }

      // The last paragraph of a body now has something under it, which is where the plus waits.
      let space = null;
      booted.aimBlockGutterAtSpace = (given) => {
        space = given;
      };
      aimBlockGutterBelow(last);
      if (!space || space.above !== last || space.below !== after) {
        throw new Error('the last paragraph of a body was offered no space below it');
      }

      // An HTML body carries its own range, so it stays one block and nothing inside it is offered anything.
      stand([block('section', [block('inside')], ['email-body'])]);
      if (blockGutterOccupants().map((el) => el.name).join() !== 'section') {
        throw new Error('a body that is one editable block was taken apart');
      }

      // A note is untouched: nothing in it claims that class, so every block is its own.
      stand([block('one'), block('two')]);
      if (blockGutterOccupants().map((el) => el.name).join() !== 'one,two') {
        throw new Error('a note’s own blocks changed');
      }
    } finally {
      inApp.querySelector = wasQuery;
      booted.aimBlockGutterAtSpace = wasSpace;
    }
  });

  // A table is written back by re-serializing the whole thing, and the dashes line under the header is what carries each column's alignment. Deleting across two cells can take a whole cell out, and a changed column count is when that line is rebuilt instead of copied — a wrong rebuild un-centers a column with nothing on screen to show for it.
  check('a rebuilt dashes line keeps each column aligned', () => {
    const { tableDelimiterCells, tableDelimiterRow } = booted;
    const column = (align) => ({ getAttribute: (name) => (name === 'align' ? align : null) });
    const is = (got, want) => {
      if (got !== want) throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    };

    is(tableDelimiterCells([column(null)]), '| --- |');
    is(tableDelimiterCells([column('left')]), '| :--- |');
    is(tableDelimiterCells([column('center')]), '| :---: |');
    is(tableDelimiterCells([column('right')]), '| ---: |');
    is(tableDelimiterCells([column('CENTER')]), '| :---: |'); // the attribute's case is not ours
    is(
      tableDelimiterCells([column(null), column('center'), column('right')]),
      '| --- | :---: | ---: |',
    );
    // A table with no usable source range takes the rebuilt row, alignment and all.
    is(tableDelimiterRow({ dataset: {} }, [column('right'), column(null)]), '| ---: | --- |');
  });

  // Typing one character into a cell used to rebuild every row of the table, so a table lined up by hand lost its columns. What stops that is finding the one cell that moved and sending only that; anything else — a column gained, two cells changed at once — has to fall back to the whole-table rewrite, and reporting a fallback as a one-cell edit would write the wrong bytes.
  check('a table sends the one cell that changed, and nothing when more did', () => {
    const { tableCellTexts, tableCellChange, tableCellPosition } = booted;
    const cell = (text, checked) => ({
      childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
      querySelector: () => (checked === undefined ? null : { checked }),
    });
    const row = (...cells) => {
      const tr = { children: cells };
      cells.forEach((one) => {
        one.parentElement = tr;
      });
      return tr;
    };
    const table = (head, ...body) => ({
      dataset: { blockKind: 'table' },
      querySelector: (selector) => (selector === ':scope > thead > tr' ? head : null),
      querySelectorAll: (selector) => (selector === ':scope > tbody > tr' ? body : []),
    });
    const same = (got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };

    const head = row(cell('item'), cell('cost'));
    const box = cell('', true);
    const drawn = table(head, row(cell('apple'), cell('1')), row(box, cell('a | b')));
    // A checkbox-only cell writes its live state, and a pipe in a cell is escaped so it cannot be read as a column.
    same(tableCellTexts(drawn), [
      ['item', 'cost'],
      ['apple', '1'],
      ['[x]', 'a \\| b'],
    ]);

    const before = tableCellTexts(drawn);
    same(tableCellChange(before, before), null); // nothing typed, nothing sent
    same(tableCellChange(before, [['item', 'price'], ['apple', '1'], ['[x]', 'a \\| b']]), {
      row: 0,
      column: 1,
      columns: 2,
      text: 'price',
    });
    // Two cells at once, a column gained, a row gained: all of them the whole-table rewrite's.
    same(tableCellChange(before, [['id', 'price'], ['apple', '1'], ['[x]', 'a \\| b']]), null);
    same(tableCellChange(before, [['item', 'cost', 'vat'], ['apple', '1'], ['[x]', 'a \\| b']]), null);
    same(tableCellChange(before, [['item', 'cost'], ['apple', '1']]), null);

    // A checkbox knows its own cell without a baseline to diff against; the head row is row 0.
    same(tableCellPosition(drawn, box), { row: 2, column: 0, columns: 2, text: '[x]' });
    same(tableCellPosition(drawn, head.children[1]), { row: 0, column: 1, columns: 2, text: 'cost' });
    same(tableCellPosition(drawn, cell('loose')), null);
  });

  check('a save before a block move shifts the ranges it moved', () => {
    // Dragging a block after typing in one sends two edits: the save, then the move against the buffer the save wrote. Ranges that drift here reorder the wrong text, so the host refuses a list that is not sorted and disjoint.
    const ranges = [
      [0, 10],
      [12, 20],
      [22, 30],
    ];
    const same = (got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };
    const sorted = (got) => {
      let previousEnd = -1;
      for (const [start, end] of got) {
        if (start < previousEnd || end < start) throw new Error(`out of order: ${JSON.stringify(got)}`);
        previousEnd = end;
      }
    };

    same(rangesAfterCommit(ranges, null), ranges); // nothing was typed
    // The middle block grew by 5: it keeps its start, and the one after it slides.
    const grown = rangesAfterCommit(ranges, { start: 12, end: 20, delta: 5 });
    same(grown, [
      [0, 10],
      [12, 25],
      [27, 35],
    ]);
    sorted(grown);
    // And shrank by 6.
    const shrunk = rangesAfterCommit(ranges, { start: 12, end: 20, delta: -6 });
    same(shrunk, [
      [0, 10],
      [12, 14],
      [16, 24],
    ]);
    sorted(shrunk);
    // A block edited outside the run counts too: one below it leaves the run alone, one above it slides the whole run.
    same(rangesAfterCommit(ranges, { start: 40, end: 44, delta: 9 }), ranges);
    const pushed = rangesAfterCommit([[12, 20]], { start: 0, end: 10, delta: 3 });
    same(pushed, [[15, 23]]);
  });

  check('an edit is described as the part that changed', () => {
    const apply = (previous, next) => {
      const splice = sourceSpliceSince(previous, next);
      const rebuilt =
        previous.slice(0, splice.start) +
        splice.inserted +
        previous.slice(splice.start + splice.removed);
      if (rebuilt !== next) {
        throw new Error(
          `splice of ${JSON.stringify(previous)} -> ${JSON.stringify(next)} rebuilt ` +
            `${JSON.stringify(rebuilt)} (${JSON.stringify(splice)})`
        );
      }
      if (splice.length !== next.length) {
        throw new Error(`splice reported length ${splice.length}, text is ${next.length}`);
      }
    };

    apply('hello', 'hello world'); // appended
    apply('hello world', 'hello'); // trimmed
    apply('one two three', 'one TWO three'); // replaced in the middle
    apply('same', 'same'); // untouched
    apply('', 'first words'); // from empty
    apply('all of it', ''); // to empty
    apply('a\nb\nc\n', 'a\nB\nc\n'); // across lines
    apply('café note', 'café notes'); // accented
    apply('emoji 😀 here', 'emoji 😀 there'); // after a surrogate pair
    apply('emoji 😀 here', 'emoji 🎉 here'); // replacing one
    apply('repeat repeat', 'repeat repeat repeat'); // ambiguous, repeated text
  });

  check('a surrogate pair is never split in half', () => {
    const splice = sourceSpliceSince('x😀y', 'x😀z');
    const head = splice.start > 0 ? 'x😀z'.charCodeAt(splice.start - 1) : 0;
    if (head >= 0xd800 && head <= 0xdbff) {
      throw new Error(`splice starts after a lone high surrogate at ${splice.start}`);
    }
  });

  // Find drives two engines from one field, and both of them can write to a file. The pattern is what decides which text is a match; the block rewrite is what turns a match on the page into bytes spliced into the buffer.
  check('the find bar builds the pattern its toggles promise', () => {
    const { findPattern, toggleFindFlag } = booted;
    const field = booted.document.getElementById('findInput');
    const matches = (query, text) => {
      field.value = query;
      const pattern = findPattern(true);
      return !!pattern && pattern.test(text);
    };

    // A plain query is literal text: a period finds a period.
    if (!matches('a.b', 'a.b')) throw new Error('a plain query does not find itself');
    if (!matches('a.b', 'a.b')) throw new Error('a plain query is being read as an expression');
    // And case does not matter until it is asked to.
    if (!matches('dharma', 'DHARMA')) throw new Error('find is case-sensitive by default');
    toggleFindFlag('matchCase');
    if (matches('dharma', 'DHARMA')) throw new Error('match case did not take');
    toggleFindFlag('matchCase');

    toggleFindFlag('wholeWord');
    if (matches('dharma', 'dharmakaya')) throw new Error('whole word matched inside a longer word');
    if (!matches('dharma', 'the dharma talk')) throw new Error('whole word lost a real word');
    toggleFindFlag('wholeWord');

    toggleFindFlag('regex');
    if (!matches('dhar+ma', 'dharrrma')) throw new Error('the expression toggle did not take');
    // A half-typed expression is said to be bad, not answered with silence.
    field.value = '(unclosed';
    if (findPattern(true) !== null) throw new Error('an unparseable expression was accepted');
    if (booted.findCountText() !== 'Bad expression') throw new Error('a bad expression is not named');
    toggleFindFlag('regex');
    field.value = '';
  });

  check('a replace in the reading view rewrites the block, or refuses it whole', () => {
    const { findRewriteBlock, toggleFindFlag } = booted;
    const field = booted.document.getElementById('findInput');
    const source = '# Notes\n\nThe dharma talk, and the dharma book.\n';
    booted.window.leafBlocksResynced({ source });
    // The paragraph's own byte range, as the reading view stamps it on the block.
    const start = source.indexOf('The');
    const end = source.length - 1;
    field.value = 'dharma';

    // Both occurrences the page found in this block.
    const both = findRewriteBlock({ start, end, ranks: [0, 1], total: 2 }, 'sutra');
    if (both !== 'The sutra talk, and the sutra book.') throw new Error(`replace all rewrote: ${both}`);
    // Only the one the cursor is on.
    const second = findRewriteBlock({ start, end, ranks: [1], total: 2 }, 'sutra');
    if (second !== 'The dharma talk, and the sutra book.') throw new Error(`one replace rewrote: ${second}`);
    // The page shows a match the block's source does not hold in one piece — formatting split it — so nothing is spliced rather than the wrong thing.
    if (findRewriteBlock({ start, end, ranks: [0], total: 3 }, 'sutra') !== null) {
      throw new Error('a match split by formatting was replaced anyway');
    }
    toggleFindFlag('regex');
    field.value = '(unclosed';
    if (findRewriteBlock({ start, end, ranks: [0], total: 1 }, 'sutra') !== null) {
      throw new Error('a bad expression was allowed to rewrite a block');
    }
    toggleFindFlag('regex');
    field.value = '';
  });

  check('a locked view finds and refuses to replace', () => {
    const { replaceInReading, replaceInSource } = booted;
    const posted = [];
    const growls = [];
    booted.ipc = { postMessage: (message) => posted.push(message) };
    booted.leafToast = (message) => growls.push(message);

    // Both padlocks are down on a fresh page: the refusal is a growl saying so, and nothing is written.
    replaceInReading(false);
    replaceInSource(true);
    if (growls.length !== 2) throw new Error(`a locked view said: ${JSON.stringify(growls)}`);
    if (!growls.every((growl) => growl.includes('padlock'))) {
      throw new Error(`a refusal did not name the padlock: ${JSON.stringify(growls)}`);
    }
    if (posted.some((message) => message.includes('editBlock'))) {
      throw new Error(`a locked view wrote: ${posted.join(', ')}`);
    }

    // Unlocked, the same calls fall through to "there is nothing to replace" and say nothing — which is what proves the padlock is what refused above.
    growls.length = 0;
    booted.setReadingUnlocked(true);
    booted.setCodeUnlocked(true);
    replaceInReading(false);
    replaceInSource(true);
    if (growls.length) throw new Error(`an unlocked view still refused: ${JSON.stringify(growls)}`);
    booted.setReadingUnlocked(false);
    booted.setCodeUnlocked(false);
  });

  // Carets in a read-only editor are a set of cursors every keystroke then growls at, so the button asks the padlock before it places any. And the modifier that adds one by hand is ours, not the editor's default Alt — Alt is the menu key here.
  check('a cursor on every match asks the padlock first, and Ctrl adds one by hand', () => {
    const { findSelectAllOccurrences } = booted;
    const growls = [];
    const selections = [];
    booted.leafToast = (message) => growls.push(message);
    booted.__fakeMonaco = {
      setSelections: (next) => selections.push(next),
      updateOptions: () => {},
      focus: () => {},
    };
    const range = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 7 };
    try {
      vm.runInContext('monacoEditor = __fakeMonaco; codeViewActive = true;', booted);
      vm.runInContext('findMatches = [__fakeRange];', Object.assign(booted, { __fakeRange: range }));
      // A growl is throttled, and the locked-replace check above just spent one.
      vm.runInContext('lastLockedGrowl = 0;', booted);

      // Locked, which is how every source opens: the refusal names the padlock and no caret is placed.
      findSelectAllOccurrences();
      if (selections.length) throw new Error('a locked source was given carets');
      if (growls.length !== 1 || !growls[0].includes('padlock')) {
        throw new Error(`a locked source said: ${JSON.stringify(growls)}`);
      }

      // Unlocked, every match becomes a selection with the cursor at its end — which is what proves the padlock is what refused above.
      growls.length = 0;
      booted.setCodeUnlocked(true);
      findSelectAllOccurrences();
      if (growls.length) throw new Error(`an unlocked source still refused: ${JSON.stringify(growls)}`);
      if (selections.length !== 1 || selections[0].length !== 1) {
        throw new Error(`the button set: ${JSON.stringify(selections)}`);
      }
      const one = selections[0][0];
      if (one.selectionStartColumn !== 1 || one.positionColumn !== 7) {
        throw new Error(`the cursor is not at the end of the match: ${JSON.stringify(one)}`);
      }
    } finally {
      booted.setCodeUnlocked(false);
      vm.runInContext('monacoEditor = null; codeViewActive = false; findMatches = [];', booted);
    }

    // The editor's own default is altKey; nothing else in the app sets this, so a lost line means Ctrl-click silently goes back to placing one cursor.
    if (!source.includes("multiCursorModifier: 'ctrlCmd'")) {
      throw new Error('the code view does not ask for Ctrl or Cmd as the add-a-cursor modifier');
    }
  });

  // JSON has no bundled colorizer, so its grammar is ours. Monarch compiles a grammar only when a file is first opened, so a bad rule is otherwise a wrongly colored code view on somebody's machine and nothing before it. Monaco cannot load here — no DOM, and it is installed only to regenerate the bundle — so the real rules are driven the way Monarch drives them: one line at a time, first rule that matches at the position wins, the state stack carried across lines.
  check('the JSON grammar colors a JSON file, comments and all', () => {
    const { jsonMonarchLanguage, monacoLanguageFor } = booted;
    if (monacoLanguageFor({ language: 'json' }) !== 'json') throw new Error('a .json payload is not sent to the grammar');
    const grammar = jsonMonarchLanguage();
    const tokenize = (text) => {
      const out = [];
      const stack = ['root'];
      for (const line of text.split('\n')) {
        let at = 0;
        while (at < line.length) {
          let matched = null;
          for (const [pattern, token, action] of grammar.tokenizer[stack[stack.length - 1]]) {
            const anchored = new RegExp(pattern.source, 'y');
            anchored.lastIndex = at;
            const hit = anchored.exec(line);
            if (!hit || !hit[0].length) continue;
            matched = { text: hit[0], token, action };
            break;
          }
          if (!matched) {
            at += 1; // Monarch's own fallback: one character as the default token.
            continue;
          }
          out.push([matched.text, matched.token]);
          if (matched.action === '@pop') stack.pop();
          else if (matched.action) stack.push(matched.action.slice(1));
          at += matched.text.length;
        }
      }
      return out;
    };
    const colorOf = (text, want) => {
      const found = tokenize(text).find((pair) => pair[0] === want[0]);
      if (!found) throw new Error(`${JSON.stringify(want[0])} is not a token of ${JSON.stringify(text)}`);
      if (found[1] !== want[1]) throw new Error(`${JSON.stringify(want[0])} is ${found[1]}, wanted ${want[1]}`);
    };
    // A key is `type` and a value is `string`, the way the bundled YAML grammar spells them — the same pair of colors in both formats, in one code view.
    colorOf('{ "name": "leaf" }', ['"name"', 'type']);
    colorOf('{ "name": "leaf" }', ['"leaf"', 'string']);
    colorOf('{ "name" : "leaf" }', ['"name"', 'type']); // space before the colon
    colorOf('{ "a\\"b": 1 }', ['"a\\"b"', 'type']); // an escaped quote inside a key
    colorOf('{ "on": true }', ['true', 'keyword']);
    colorOf('{ "on": null }', ['null', 'keyword']);
    colorOf('{ "n": -12.5e-3 }', ['-12.5e-3', 'number']);
    colorOf('{ "n": 0 }', ['0', 'number']);
    colorOf('[1, 2]', [',', 'delimiter']);
    // Neither is JSON, and both are in real .json files — the ones whose reading view refuses to parse, which is why their author is in the code view.
    colorOf('{ "a": 1 } // trailing note', ['// trailing note', 'comment']);
    colorOf('/* head */ { "a": 1 }', ['/*', 'comment']);
    // A block comment holds its color to the end, over a line break and a `*` that closes nothing.
    const block = tokenize('/*\n * still a comment\n */\n{ "a": 1 }');
    for (const [text, token] of block.slice(0, block.findIndex((pair) => pair[0] === '*/') + 1)) {
      if (token !== 'comment') throw new Error(`${JSON.stringify(text)} inside a block comment is ${token}`);
    }
    colorOf('/*\n * x\n */\n{ "a": 1 }', ['"a"', 'type']); // and the file carries on after it
    // An unclosed quote takes the rest of its line and no more.
    colorOf('{ "a": "oops\n{ "b": 1 }', ['"oops', 'string']);
    colorOf('{ "a": "oops\n{ "b": 1 }', ['"b"', 'type']);
    // Every color the grammar asks for has to be one the theme paints, or the text silently falls back to the foreground. `type`/`key`/`number`/`delimiter` are in defineLeafMonacoTheme for exactly these formats.
    const painted = ['string', 'number', 'keyword', 'comment', 'type', 'key', 'delimiter'];
    for (const state of Object.values(grammar.tokenizer)) {
      for (const [, token] of state) {
        if (!painted.includes(token)) throw new Error(`nothing paints ${token}`);
      }
    }
  });

  // The source view's color squares. Monaco draws them; what it is missing is anything saying where the colors are, and that is leafColorRanges — a plain function over a string, so it is driven here with no editor and no page, the way the grammar above is. The spellings are src/tests/colors.json, which the reading view's own recognizer joins when css-documents ships: one list, so the two views cannot disagree about what a color is.
  check('every color spelling in the fixture is recognized, and every non-color is not', () => {
    const { leafColorRanges } = booted;
    const fixture = JSON.parse(readFileSync(join(root, 'src/tests/colors.json'), 'utf8'));
    if (fixture.colors.length < 20) throw new Error('the color fixture has gone thin');
    const byte = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    for (const entry of fixture.colors) {
      const found = leafColorRanges(entry.value);
      // Only "anywhere" draws in the source view: a color name has no place of its own in prose, which is what "value" records for the reading view.
      if (entry.where !== 'anywhere') {
        if (found.length) throw new Error(`${JSON.stringify(entry.value)} drew ${found.length} square(s)`);
        continue;
      }
      if (found.length !== 1) throw new Error(`${JSON.stringify(entry.value)} drew ${found.length} squares`);
      const one = found[0];
      if (one.start !== 0 || one.end !== entry.value.length) {
        throw new Error(`${JSON.stringify(entry.value)} was found at ${one.start}..${one.end}`);
      }
      const rgba = byte(one.red) + byte(one.green) + byte(one.blue) + byte(one.alpha);
      if (rgba !== entry.rgba) throw new Error(`${JSON.stringify(entry.value)} is ${rgba}, wanted ${entry.rgba}`);
    }
    // And in a line rather than alone: one of this repo's own theme rows, where the value sits in a table cell inside backticks.
    const row = '| surface-muted                | `#f6f6f6` |';
    const inRow = leafColorRanges(row);
    if (inRow.length !== 1 || row.slice(inRow[0].start, inRow[0].end) !== '#f6f6f6') {
      throw new Error(`a theme table row gave ${JSON.stringify(inRow)}`);
    }
    // Two on a line, each at its own place, and the count is what the fixture cases cannot show.
    const pair = leafColorRanges('from #000000 to rgb(255 255 255)');
    if (pair.length !== 2 || pair[0].start !== 5 || pair[1].start !== 16) {
      throw new Error(`two colors on one line gave ${JSON.stringify(pair)}`);
    }
    // A gradient is not a color, but the hex values inside one are.
    if (leafColorRanges('linear-gradient(#fff, #000000)').length !== 2) {
      throw new Error('the colors inside a gradient are not drawn');
    }
  });

  // The square is a mark, not a control, and it is one for free: the color picker's hover participant is built into Monaco and never registered, so a click on the square does nothing. That decision has to survive the next regeneration of the bundle, which is by hand — hence the guard on the import list rather than on the 2.8MB output.
  check('the vendored editor bundle asks for no color picker', () => {
    const bundler = readFileSync(join(root, 'scripts/bundle-monaco.mjs'), 'utf8');
    const entry = bundler.match(/const ENTRY = `([\s\S]*?)`;/);
    if (!entry) throw new Error("could not find the bundler's import list");
    for (const line of entry[1].split('\n')) {
      if (/^import\b/.test(line) && /colorPicker|colorContribution/i.test(line)) {
        throw new Error(`the bundle asks for the color picker: ${line.trim()}`);
      }
    }
    // And nothing may offer a presentation, which is the other half: a presentation is what the editor writes back through.
    const codeView = readFileSync(join(root, 'src/assets/shell/code-view.js'), 'utf8');
    if (!/provideColorPresentations\(\)\s*\{\s*return \[\];/.test(codeView)) {
      throw new Error('the color provider offers a way to rewrite a value');
    }
    // Every language the code view can put in front of somebody: a registration lost here is a format that silently stops drawing squares.
    const registered = codeView.match(/\[([^\]]*)\]\.forEach\(\(id\) =>\s*\n?\s*monaco\.languages\.registerColorProvider/);
    if (!registered) throw new Error('nothing registers the color provider');
    for (const id of ['markdown', 'xml', 'yaml', 'json', 'plaintext']) {
      if (!registered[1].includes(`'${id}'`)) throw new Error(`${id} gets no color squares`);
    }
  });

  check('byte offsets and line numbers agree in both directions', () => {
    // The reader's place is a byte offset on the Rust side and a line number in the editor; multi-byte characters are where the two disagree.
    const text = 'ascii\ncafé and ünicode\n😀 wide\nlast';
    for (let line = 0; line < 4; line += 1) {
      const bytes = byteOffsetAtLineIndex(text, line);
      const back = lineIndexAtByteOffset(text, bytes);
      if (back !== line) {
        throw new Error(`line ${line} -> byte ${bytes} -> line ${back}`);
      }
    }
    if (byteOffsetAtLineIndex(text, 0) !== 0) throw new Error('line 0 is not byte 0');
    // "café" is five characters but six bytes, so the second line's start must account for the accent.
    if (byteOffsetAtLineIndex(text, 1) !== 'ascii\n'.length) {
      throw new Error('the second line does not start after the first');
    }
    if (byteOffsetAtLineIndex(text, 2) !== Buffer.byteLength('ascii\ncafé and ünicode\n')) {
      throw new Error('the third line does not account for multi-byte characters');
    }
  });

  // The flowchart sheet reads and writes mermaid, and Save splices what it wrote straight into the document. Everything dangerous is parseFlow refusing correctly, so both halves of that are held here: what we write must come back unchanged, and what we cannot model must come back null — never a partial graph the canvas could then save over.
  check('a flowchart we wrote survives the round trip', () => {
    const { parseFlow, renderFlow } = booted;
    const same = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused text we wrote: ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== text) {
        throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
      }
    };

    same('flowchart TD\n    A["Start"]');
    same('flowchart LR\n    A["Start"]\n    B{"Choose"}\n    A --> B');
    same('flowchart TD\n    A("Go")\n    B["Stop"]\n    A -->|"yes"| B');
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A --- B'); // the open line
    same('flowchart BT\n    A["a"]\n    B["b"]\n    C["c"]\n    A --> B\n    B --> C');
    // Every shape in the catalog, written and read back as itself. The pairs that share an opener (`[/…/]` against `[/…\\]`) are what this is for.
    same(
      'flowchart TD\n' +
        [
          'a1["rect"]',
          'a2("rounded")',
          'a3{"diamond"}',
          'a4(["stadium"])',
          'a5[["subroutine"]]',
          'a6[("cylinder")]',
          'a7(("circle"))',
          'a8((("double")))',
          'a9{{"hexagon"}}',
          'b1>"flag"]',
          'b2[/"lean right"/]',
          'b3[\\"lean left"\\]',
          'b4[/"trapezoid"\\]',
          'b5[\\"trapezoid alt"/]',
        ]
          .map((line) => '    ' + line)
          .join('\n'),
    );
    // And every connector: three line styles against seven pairs of ends.
    same(
      'flowchart LR\n    A["a"]\n    B["b"]\n' +
        [
          'A --> B',
          'A --- B',
          'A --o B',
          'A --x B',
          'A <--> B',
          'A o--o B',
          'A x--x B',
          'A -.-> B',
          'A -.- B',
          'A -.-o B',
          'A -.-x B',
          'A <-.-> B',
          'A o-.-o B',
          'A x-.-x B',
          'A ==> B',
          'A === B',
          'A ==o B',
          'A ==x B',
          'A <==> B',
          'A o==o B',
          'A x==x B',
        ]
          .map((line) => '    ' + line)
          .join('\n'),
    );
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A -.->|"maybe"| B');
    same('flowchart TD\n    A["a"]\n    B["b"]\n    A ==>|"definitely"| B');
    same('flowchart TD\n    A["say #quot;hi#quot;"]'); // a quote inside a label
    same('flowchart TD\n    A["café 😀"]'); // multi-byte, where the offsets matter
    same('flowchart TD\n    A["one<br/>two"]'); // a line break in a label
    same('flowchart TD\n    A["a"]\n    A --> A'); // a node pointing at itself
    // Front matter, directives and comments are kept exactly, because the canvas models none of them and a save must not be where they go missing.
    same('---\ntitle: Plan\n---\nflowchart TD\n    A["a"]');
    same('%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart TD\n    A["a"]');
    same('flowchart TD\n    %% a note\n    accTitle: The plan\n    A["a"]');
    // Hyphens in a box name, against the arrow that starts one character later.
    same('flowchart LR\n    read-file["Read"]\n    write-file["Write"]\n    read-file --> write-file');
    // The thirty-three shapes that have no brackets are written the typed way, and that is the only way they are ever written.
    same('flowchart TD\n    A@{ shape: cloud, label: "Somewhere else" }');
    same(
      'flowchart LR\n' +
        [
          'a@{ shape: sm-circ, label: "" }',
          'b@{ shape: doc, label: "Write it down" }',
          'c@{ shape: lin-cyl, label: "Disk" }',
          'd@{ shape: fr-circ, label: "" }',
        ]
          .map((line) => '    ' + line)
          .join('\n') +
        '\n    a --> b\n    b --> c\n    c --> d',
    );
    // A link, an icon and a picture. The `click` line goes under the boxes because it names one, and the two keys ride in the typed form because that is the only place they can be said.
    same('flowchart TD\n    A["Home"]\n    click A "https://example.com"');
    same('flowchart TD\n    A["Home"]\n    click A "https://example.com" "Opens the site"');
    same('flowchart TD\n    A@{ shape: rect, label: "Back", icon: "leaf:back" }');
    same('flowchart TD\n    A@{ shape: rect, label: "A shot", img: "shot.png" }');
    same('flowchart TD\n    A@{ shape: rect, label: "All three", icon: "leaf:back", img: "shot.png" }\n    click A "./other.md"');
    // The form that names a function is kept whole and does nothing. It goes last because it is not attached to a box at all.
    same('flowchart TD\n    A["Home"]\n    click A call go()');
  });

  // The hardest block the canvas is ever handed: the "everything at once" section of the mermaid test page. A hand-written diagram is not in the shape we write, so the test is that it opens at all and that our own writing of it is stable — the two together are what "every flowchart on that page opens in the editor" means. Kept here as a literal rather than read out of the plan tree next door: nothing else in `just verify` reaches out of this repo, and a boot check that needs a folder beside it fails on a partial clone.
  check('the hardest block on the test page opens on the canvas', () => {
    const { parseFlow, renderFlow, flowRefusal } = booted;
    const settles = (text, why) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`${why}: refused — ${flowRefusal(text)}`);
      const once = renderFlow(graph);
      const twice = renderFlow(parseFlow(once));
      if (once !== twice) throw new Error(`${why}: our own writing of it does not settle\n${once}\n---\n${twice}`);
      return { graph, written: once };
    };

    const everything = [
      '---',
      'title: One file in, one page out',
      '---',
      '%%{init: {"flowchart": {"curve": "basis"}}}%%',
      'flowchart TD',
      '  accTitle: How Leaftext turns a file into a page',
      '  accDescr: A file is read, routed by its format, parsed or shaped into a tree, then shown, edited and written back.',
      '  classDef io fill:#e0f2fe,stroke:#0369a1,color:#082f49',
      '  classDef risk fill:#ffe4e6,stroke:#b91c1c,color:#7f1d1d',
      '  classDef done fill:#dcfce7,stroke:#15803d,color:#14532d',
      '',
      '  %% one file in, one page out',
      '  file@{ shape: lean-r, label: "The file on disk" }',
      '  file --> fmt{Which format?}',
      '',
      '  fmt -->|md| md',
      '  fmt -->|xml, json, yaml| tree',
      '',
      '  subgraph md [Markdown]',
      '    direction TB',
      '    p[Parse to events] --> g[GitHub extras]',
      '    g --> h[Highlight fences]',
      '    h --> s[Sanitize]:::risk',
      '  end',
      '',
      '  subgraph tree [Tree formats]',
      '    direction TB',
      '    t1[Read to one ordered tree] --> t2[Shape rules]',
      '  end',
      '',
      '  s --> page',
      '  t2 ---> page',
      '  page@{ shape: curv-trap, label: "The reading view" }',
      '  page -.->|click a block| edit@{ shape: notch-rect, label: "Edit in place" }',
      '  edit -->|leave it| page',
      '  edit ==>|one splice| buffer@{ shape: cyl, label: "The buffer in Rust" }',
      '  buffer e1@--> file',
      '  watch[The watcher] --> watch',
      '  watch ~~~ file',
      '  e1@{ animate: true }',
      '',
      '  %% a typed shape cannot carry :::class on the same line — see section 22',
      '  class file io',
      '  class page done',
      '  linkStyle 0 stroke:#0369a1,stroke-width:2px',
    ].join('\n');

    const { written } = settles(everything, 'everything at once');
    // Each of the nine things that section was short of, still there after a save.
    for (const kept of [
      'title: One file in, one page out',
      '%%{init:',
      'accTitle: How Leaftext turns a file into a page',
      'accDescr: A file is read',
      '--->', // the stretched arrow
      '~~~', // the invisible line
      'watch --> watch', // the self-loop
      'e1@-->', // the named line
      'e1@{ animate: true }',
      'linkStyle 0 stroke:#0369a1',
    ]) {
      if (!written.includes(kept)) throw new Error(`a save lost ${kept}:\n${written}`);
    }
    // Two lines between the same pair, both kept rather than folded into one.
    if (written.split('\n').filter((line) => /^\s*(page|edit) .* (edit|page)$/.test(line)).length < 2) {
      throw new Error(`the second line between one pair went missing:\n${written}`);
    }

    // `look: handDrawn` is a whole-diagram setting, so the section says it in a block of its own.
    settles(
      [
        '---',
        'title: The same pipeline, still an argument',
        'look: handDrawn',
        '---',
        'flowchart LR',
        '  file@{ shape: lean-r, label: "The file" } --> render[Render] --> page@{ shape: curv-trap, label: "The page" }',
        '  page -.->|edit| render',
      ].join('\n'),
      'the hand-drawn block',
    );
  });

  // Each of the three is written where mermaid reads it, and a box that loses one loses the line with it — the click line goes when the link does, and the key goes from the braces when the icon or the picture does.
  check('a box gives up its link, its icon and its picture cleanly', () => {
    const { parseFlow, renderFlow, flowFindNode } = booted;
    const text = 'flowchart TD\n    A@{ shape: rect, label: "All three", icon: "leaf:back", img: "shot.png" }\n    click A "https://example.com" "Go"';
    const graph = parseFlow(text);
    if (!graph) throw new Error('the three-way box did not parse');
    const node = flowFindNode(graph, 'A');
    if (node.icon !== 'leaf:back') throw new Error(`the icon read as ${node.icon}`);
    if (node.img !== 'shot.png') throw new Error(`the picture read as ${node.img}`);
    if (node.href !== 'https://example.com') throw new Error(`the link read as ${node.href}`);
    if (node.hrefTip !== 'Go') throw new Error(`the tooltip read as ${node.hrefTip}`);

    node.href = null;
    node.hrefTip = null;
    node.icon = null;
    node.img = null;
    const back = renderFlow(graph);
    if (back.includes('click')) throw new Error(`the click line outlived the link: ${back}`);
    if (back.includes('icon:') || back.includes('img:')) throw new Error(`a key outlived its value: ${back}`);
    if (back !== 'flowchart TD\n    A["All three"]') throw new Error(`the box did not go back to brackets: ${back}`);
  });

  // `click A href "…"` is mermaid's long spelling of the same thing, so it is read and written back short — one spelling of a link in the file, the way one shape has one spelling.
  check('both spellings of a click reach the same box', () => {
    const { parseFlow, renderFlow } = booted;
    const short = parseFlow('flowchart TD\n    A["Home"]\n    click A "https://example.com"');
    const long = parseFlow('flowchart TD\n    A["Home"]\n    click A href "https://example.com"');
    if (!short || !long) throw new Error('one of the two spellings was refused');
    if (renderFlow(short) !== renderFlow(long)) throw new Error('the two spellings wrote different text');
  });

  // The canvas has no gesture that draws a box around boxes, so the menu is the whole of it: make a group, join one, leave one, take one away. Each has to leave a diagram that still says something.
  check('the canvas can make and unmake a group', () => {
    const { parseFlow, renderFlow, flowGroupNodes, flowUngroup, flowMoveNodeToGroup, flowFindGroup } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };

    const graph = one('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]\n    A --> B\n    B --> C');
    const made = flowGroupNodes(graph, ['A', 'B'], 'First half');
    if (!made) throw new Error('the group was not made');
    if (made.id !== 'g1') throw new Error(`the group is called ${made.id}`);
    const written = renderFlow(graph);
    if (!written.includes('subgraph g1["First half"]')) throw new Error(`no group in ${written}`);
    if (renderFlow(parseFlow(written)) !== written) throw new Error('the made group does not round-trip');

    // A box joins and leaves; the group holds whatever is left.
    flowMoveNodeToGroup(graph, 'C', 'g1');
    if (graph.nodes.find((node) => node.id === 'C').group !== 'g1') throw new Error('C did not join');
    flowMoveNodeToGroup(graph, 'C', null);
    if (graph.nodes.find((node) => node.id === 'C').group !== null) throw new Error('C did not leave');

    // A group inside a group: taking the outer one away leaves the inner one where the outer one was, rather than orphaning it.
    const inner = flowGroupNodes(graph, ['A'], 'Inner');
    if (inner.parent !== 'g1') throw new Error(`the inner group's parent is ${inner.parent}`);
    flowUngroup(graph, 'g1');
    if (flowFindGroup(graph, 'g1')) throw new Error('the outer group is still there');
    if (flowFindGroup(graph, inner.id).parent !== null) throw new Error('the inner group was orphaned');
    if (graph.nodes.find((node) => node.id === 'B').group !== null) throw new Error('B kept a group that is gone');
    if (!renderFlow(graph).includes('A["a"]')) throw new Error('a box went with the group');

    // Boxes from two different groups cannot be gathered into one: there would be no answer to which group the new one goes in.
    const split = one('flowchart TD\n  subgraph one\n    A[a]\n  end\n  subgraph two\n    B[b]\n  end');
    if (flowGroupNodes(split, ['A', 'B'], 'Both')) throw new Error('boxes from two groups should not group');

    // An arrow pointing at a group goes when the group does.
    const aimed = one('flowchart LR\n  X[x] --> g\n  subgraph g [G]\n    A[a]\n  end');
    flowUngroup(aimed, 'g');
    if (aimed.edges.some((edge) => edge.to === 'g')) throw new Error('an arrow still points at the group');
  });

  // A connector can be stretched, and mermaid reads the extra length as a rank hint — so the length is part of what the diagram means, and losing it on a save would redraw the whole layout. The invisible link is the one line style that takes no ends at all.
  check('a connector keeps its length, and the invisible one takes no ends', () => {
    const { parseFlow, renderFlow } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const same = (text) => {
      const back = renderFlow(one(text));
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };
    const stretch = (spelling, expected) => {
      const graph = one(`flowchart LR\n    A["a"]\n    B["b"]\n    A ${spelling} B`);
      if (graph.edges[0].stretch !== expected) {
        throw new Error(`${spelling} came back stretched ${graph.edges[0].stretch}, wanted ${expected}`);
      }
    };

    stretch('-->', 0);
    stretch('--->', 1);
    stretch('---->', 2);
    stretch('---', 0);
    stretch('----', 1);
    stretch('-.->', 0);
    stretch('-..->', 1);
    stretch('-.....->', 4);
    stretch('==>', 0);
    stretch('===>', 1);
    stretch('<-->', 0);
    stretch('<--->', 1);
    stretch('~~~', 0);
    // Every stretched spelling is written back exactly as long as it was read.
    for (const spelling of ['--->', '---->', '----', '-..->', '===>', '====', '<--->', 'o---o', 'x---x', '~~~~']) {
      same(`flowchart LR\n    A["a"]\n    B["b"]\n    A ${spelling} B`);
    }
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A ~~~ B');
    // A label still rides on a stretched arrow.
    const labeled = one('flowchart LR\n    A --->|"yes"| B');
    if (labeled.edges[0].label !== 'yes' || labeled.edges[0].stretch !== 1) {
      throw new Error(`the label or the length was lost: ${JSON.stringify(labeled.edges[0])}`);
    }
  });

  // A line can be given a name, and the one thing that uses the name is an animation. Both ride on the edge, so deleting the line takes them with it.
  check('a named line keeps its name and its animation', () => {
    const { parseFlow, renderFlow, flowDeleteEdge } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const same = (text) => {
      const back = renderFlow(one(text));
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };

    const named = one('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B');
    if (named.edges[0].name !== 'e1') throw new Error(`the name came back as ${named.edges[0].name}`);
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B');
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B\n    e1@{ animate: true }');
    same('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@==>|"go"| B\n    e1@{ animation: fast }');
    // The same spelling with a shape in it is a box, not an animation.
    const box = one('flowchart LR\n    A@{ shape: cyl, label: "Cache" }');
    if (box.nodes[0].shape !== 'cyl') throw new Error('a typed box was read as an animation');
    // An animation for a name no line carries is refused, not dropped.
    if (parseFlow('flowchart LR\n    A --> B\n    e1@{ animate: true }')) {
      throw new Error('an animation with no line should be refused');
    }
    // Deleting the line takes its name and its animation with it.
    const doomed = one('flowchart LR\n    A["a"]\n    B["b"]\n    A e1@--> B\n    e1@{ animate: true }');
    flowDeleteEdge(doomed, doomed.edges[0].id);
    if (renderFlow(doomed).includes('e1')) throw new Error('the animation outlived its line');
  });

  // Mermaid's markdown label — backticks inside the quotes — is the label's own text as far as the model is concerned. It is kept whole rather than refused, because a bold word in a box is not a reason to turn the canvas off.
  check('a markdown label survives the round trip', () => {
    const { parseFlow, renderFlow } = booted;
    const same = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== text) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
    };
    same('flowchart TD\n    A["`**bold** and *italic*`"]');
    // Mermaid wraps a markdown label where the break is, so the break is part of the label and the statement is not over until the quote closes.
    same('flowchart TD\n    A["`A longer label that\nwraps where you put the break`"]');
    const broken = parseFlow('flowchart TD\n  A["`one\ntwo`"] --> B[after]');
    if (!broken) throw new Error('a label across two lines was refused');
    if (broken.nodes[0].text !== '`one\ntwo`') throw new Error(`the break was lost: ${JSON.stringify(broken.nodes[0].text)}`);
    if (broken.edges.length !== 1) throw new Error('the arrow after the label went missing');
    // A quote that never closes at all is still refused, and says so.
    if (parseFlow('flowchart TD\n    A["never closed')) throw new Error('an unclosed label should be refused');
    same('flowchart LR\n    A["`a **bold** step`"]\n    B["plain"]\n    A --> B');
    // A bare backtick is still refused: mermaid needs the quotes for markdown, and a label we cannot quote back is one we cannot write.
    if (parseFlow('flowchart TD\n    A[`bold`]')) throw new Error('a bare backtick label should be refused');
  });

  // The picker shows the shapes under headings, and it is built from the families — so a shape whose family is misspelled is a shape nobody can ever choose, and it would go missing quietly.
  check('every shape sits under exactly one heading', () => {
    const { flowShapeCatalog, flowShapeFamilies } = booted;
    const all = flowShapeCatalog();
    const families = flowShapeFamilies();
    const seen = [];
    for (const family of families) {
      if (!family.shapes.length) throw new Error(`the heading "${family.name}" has no shapes under it`);
      const labels = family.shapes.map((shape) => shape.label);
      const sorted = labels.slice().sort((a, b) => a.localeCompare(b));
      if (labels.join('|') !== sorted.join('|')) throw new Error(`"${family.name}" is not alphabetical: ${labels}`);
      seen.push(...family.shapes.map((shape) => shape.id));
    }
    if (seen.length !== all.length) {
      const missing = all.filter((shape) => !seen.includes(shape.id)).map((shape) => shape.id);
      throw new Error(`${all.length} shapes, ${seen.length} under a heading — missing ${missing}`);
    }
    if (new Set(seen).size !== seen.length) throw new Error('a shape is under two headings');
  });

  // A subgraph is a box around boxes, and which one a box is in rides on the box — so dragging a box among its neighbors cannot take it out of its group, and deleting one cannot leave the group holding a name that is gone.
  check('subgraphs keep their boxes, their nesting and their direction', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowMoveNode, flowAddNode } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const stable = (text) => {
      const back = renderFlow(one(text));
      if (renderFlow(one(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
      return back;
    };

    // The three spellings of a group's name, all round-tripping as the same one.
    const named = one('flowchart TD\n  subgraph writing [Writing]\n    A[Draft]\n  end');
    if (named.groups[0].id !== 'writing' || named.groups[0].text !== 'Writing') {
      throw new Error(`the group came back as ${JSON.stringify(named.groups[0])}`);
    }
    if (one('flowchart TD\n  subgraph one\n    A[a]\n  end').groups[0].text !== 'one') {
      throw new Error('a group named only once should use that name as its title');
    }
    if (one('flowchart TD\n  subgraph "The middle"\n    A[a]\n  end').groups[0].text !== 'The middle') {
      throw new Error('a quoted title was not read');
    }

    stable('flowchart TD\n  subgraph writing [Writing]\n    A[Draft] --> B[Revise]\n  end\n  B --> C[Ship]');
    // Nested, each with its own direction.
    const nested = stable(
      'flowchart LR\n' +
        '  subgraph outer [Outer]\n    direction TB\n' +
        '    subgraph inner [Inner]\n      direction LR\n      A --> B\n    end\n' +
        '    inner --> C[After]\n  end\n  C --> D[Outside]',
    );
    if (!nested.includes('        direction LR')) throw new Error(`the inner direction moved: ${nested}`);
    const deep = one(nested);
    if (deep.groups.find((group) => group.id === 'inner').parent !== 'outer') {
      throw new Error('the nesting was lost');
    }
    // An arrow may name the group itself, and §19 points at one declared later. That name is a group, not a box invented for it.
    const grouped = one('flowchart LR\n  A[Input] --> group\n  subgraph group [The middle]\n    B --> C\n  end\n  group --> D[Output]');
    if (grouped.nodes.some((node) => node.id === 'group')) throw new Error('the group was also read as a box');
    if (!grouped.edges.some((edge) => edge.to === 'group')) throw new Error('the arrow into the group went missing');
    stable('flowchart LR\n  A[Input] --> group\n  subgraph group [The middle]\n    B --> C\n  end\n  group --> D[Output]');

    // A box named in passing outside and spelled out inside belongs inside.
    const adopted = one('flowchart TD\n  A --> B\n  subgraph g [G]\n    B[Spelled out here]\n  end');
    if (adopted.nodes.find((node) => node.id === 'B').group !== 'g') throw new Error('the box did not join its group');

    // What the canvas does to a grouped diagram: reordering keeps membership, deleting takes the box out and leaves the group standing.
    const edited = one('flowchart TD\n  subgraph g [G]\n    A[a]\n    B[b]\n  end\n  C[c]');
    flowMoveNode(edited, 'A', null);
    if (edited.nodes.find((node) => node.id === 'A').group !== 'g') throw new Error('a reorder moved a box out of its group');
    if (!renderFlow(edited).includes('        A["a"]')) throw new Error('the box left its group on the page');
    flowDeleteNode(edited, 'A');
    flowDeleteNode(edited, 'B');
    const emptied = renderFlow(edited);
    if (!emptied.includes('subgraph g["G"]') || !emptied.includes('end')) throw new Error('the empty group went missing');
    // A box added on the canvas is added outside every group.
    flowAddNode(edited, 'rect', 'New');
    if (edited.nodes[edited.nodes.length - 1].group !== null) throw new Error('a new box landed in a group');

    // A group takes a class and a style the way a box does.
    stable('flowchart TD\n  classDef zone fill:#eee\n  subgraph g [G]\n    A[a]\n  end\n  class g zone\n  style g stroke:#333');
  });

  // Color is the one part of a diagram the canvas has no way to set, and every way of writing it names something the reader can then delete. So it rides on the box and the line it paints, and is written back off them.
  check('classes and styles ride on what they paint', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowFlipEdge } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };
    const stable = (text) => {
      const back = renderFlow(one(text));
      if (renderFlow(one(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
      return back;
    };

    // `:::` on the box and a `class` line say the same thing, and both come back as the line — the typed form cannot carry `:::`, so there is one spelling.
    const painted = stable(
      'flowchart LR\n' +
        '  classDef warn fill:#ffe4e6\n' +
        '  A[Start] --> B[Careful]:::warn\n' +
        '  B --> C[Fine]\n' +
        '  B --> D[Also fine]\n' +
        '  class C,D ok',
    );
    if (!painted.includes('    classDef warn fill:#ffe4e6')) throw new Error('the classDef went missing');
    if (!painted.includes('    class B warn')) throw new Error(`:::warn was not carried: ${painted}`);
    if (!painted.includes('    class C,D ok')) throw new Error(`the class line was not carried: ${painted}`);

    stable('flowchart LR\n  A[Plain] --> B[Picked out]\n  style B fill:#ffe066,stroke-width:2px');
    stable('flowchart LR\n  classDef default fill:#eef2ff\n  A[a] --> B[b]');
    const lined = stable('flowchart LR\n  A --> B --> C --> D\n  linkStyle 0 stroke:#16a34a\n  linkStyle 2 stroke:#7c3aed');
    if (!lined.includes('    linkStyle 0 stroke:#16a34a') || !lined.includes('    linkStyle 2 stroke:#7c3aed')) {
      throw new Error(`the link styles moved: ${lined}`);
    }
    stable('flowchart LR\n  A --> B\n  linkStyle default stroke:#888');

    // Deleting a box takes its color with it, rather than leaving a rule that paints a box mermaid would then have to invent.
    const doomed = one('flowchart LR\n  A[a] --> B[b]\n  style B fill:#f00\n  class B warn\n  classDef warn color:#fff');
    flowDeleteNode(doomed, 'B');
    const after = renderFlow(doomed);
    if (after.includes('style B') || after.includes('class B')) throw new Error(`B's paint outlived it: ${after}`);
    if (!after.includes('classDef warn')) throw new Error('the classDef should stay — it names no box');

    // A line style follows its own line, not the number it happened to have.
    const flipped = one('flowchart LR\n  A --> B\n  B --> C\n  linkStyle 1 stroke:#f00');
    flowFlipEdge(flipped, flipped.edges[1].id);
    if (!renderFlow(flipped).includes('linkStyle 1 stroke:#f00')) throw new Error('the line lost its color');
  });

  // Typed boxes — `A@{ shape: cyl }` — are the only way to reach the shapes the brackets never covered, and mermaid takes several names for each one. We read them all and write the short one, so a file gains no second spelling.
  check('a typed box is read, and written the shortest way', () => {
    const { parseFlow, renderFlow, flowShapeCatalog } = booted;
    const one = (text) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      return graph;
    };

    // Every shape in the catalog, said the typed way, comes back as itself.
    for (const shape of flowShapeCatalog()) {
      const graph = one(`flowchart TD\n    A@{ shape: ${shape.id}, label: "x" }`);
      if (graph.nodes[0].shape !== shape.id) {
        throw new Error(`typed ${shape.id} came back as ${graph.nodes[0].shape}`);
      }
      // And so does every other name mermaid answers to for it.
      for (const alias of shape.also || []) {
        const aliased = one(`flowchart TD\n    A@{ shape: ${alias}, label: "x" }`);
        if (aliased.nodes[0].shape !== shape.id) {
          throw new Error(`${alias} came back as ${aliased.nodes[0].shape}, not ${shape.id}`);
        }
      }
    }

    // A shape with brackets is written in them, however it was written before.
    if (renderFlow(one('flowchart TD\n  A@{ shape: cylinder, label: "Cache" }')) !== 'flowchart TD\n    A[("Cache")]') {
      throw new Error('a typed cylinder was not written back in brackets');
    }
    // The typed form may follow a box already declared, and changes its shape without touching the label it already had — section 14 of the guide.
    const attached = one('flowchart LR\n  A[Plain] --> B[Becomes a cylinder]\n  B@{ shape: cyl }');
    const b = attached.nodes.find((node) => node.id === 'B');
    if (b.shape !== 'cyl' || b.text !== 'Becomes a cylinder') {
      throw new Error(`the attached shape gave ${JSON.stringify(b)}`);
    }
    // A label with the punctuation the braces are made of.
    const awkward = one('flowchart TD\n    A@{ shape: rect, label: "one, two }" }');
    if (awkward.nodes[0].text !== 'one, two }') throw new Error(`the label came back as ${awkward.nodes[0].text}`);
  });

  check('a flowchart we cannot model is refused whole', () => {
    const { parseFlow, flowRefusal } = booted;
    const refused = (text, why) => {
      const graph = parseFlow(text);
      if (graph) throw new Error(`${why}: parsed ${JSON.stringify(text)} instead of refusing`);
      // Refusing silently is the bug the notice was written to fix: every one of these has to come back with something the reader can act on.
      if (!flowRefusal(text)) throw new Error(`${why}: refused ${JSON.stringify(text)} without saying why`);
    };

    // Shapes past phase 2, and brackets that are a syntax error either way.
    refused('flowchart TD\n    A@{ shape: nosuchshape }', 'a shape mermaid does not have');
    refused('flowchart TD\n    A@{ shape: rect, w: 40, h: 20 }', 'a box given a size');
    refused('flowchart TD\n    A@{ shape: rect, label: "x"', 'braces that never close');
    refused('flowchart TD\n    A[/x]', 'an opener with the wrong closer');
    refused('flowchart TD\n    A[[x]', 'a subroutine missing half its closer');
    refused('flowchart TD\n    A((x)', 'a circle missing half its closer');
    // Edges past phase 2. Everything that changes what the diagram means.
    refused('flowchart TD\n    A["a"]\n    end', 'an end with no subgraph');
    refused('flowchart TD\n    subgraph one\n    A["a"]', 'a subgraph that never ends');
    refused('flowchart TD\n    A["a"]\n    direction LR', 'a direction outside a subgraph');
    refused('flowchart TD\n    A["a"]\n    subgraph A\n    end', 'a subgraph named after a box');
    refused('flowchart TD\n    A["a"]\n    style nosuch fill:#f9f', 'a style for a box that is not there');
    refused('flowchart TD\n    A["a"]\n    class nosuch warn', 'a class for a box that is not there');
    refused('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B\n    linkStyle 3 stroke:#f00', 'a style past the last line');
    refused('flowchart TD\n    click A "https://example.com"', 'a click on a box that is not there');
    refused('flowchart TD\n    A["a"]\n    click A _blank', 'a click written a way we cannot read');
    refused('flowchart TD\n    A["x"]; B["y"]', 'two statements on a line');
    // And things that are not a flowchart at all.
    refused('sequenceDiagram\n    a ->> b: hi', 'another diagram type');
    refused('flowchart TD', 'a header with nothing under it');
    refused('---\ntitle: Plan\nflowchart TD\n    A', 'unterminated front matter');
  });

  // A refusal the reader can do something about: which line, and what on it. The line number is what makes it worth saying at all, so it is counted from the top of the block the way the code pane numbers it — front matter and comments included.
  check('a refusal names the line and the feature', () => {
    const { parseFlow, flowRefusal } = booted;
    const says = (text, ...parts) => {
      const said = flowRefusal(text);
      for (const part of parts) {
        if (!said.includes(part)) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(said)}, wanted ${part}`);
      }
    };

    says('flowchart TD\n    A["a"]\n    end', 'Line 3', '`end` with no subgraph');
    says('flowchart TD\n    A["a"]\n    direction LR', 'Line 3', 'a direction outside a subgraph');
    says('flowchart TD\n    A["a"]\n    style nosuch fill:#f9f', 'Line 3', 'a box that isn’t there');
    says('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B\n    linkStyle 9 stroke:#f00', 'Line 5', 'a line that isn’t there');
    says('flowchart TD\n    A@{ shape: nosuchshape }', 'Line 2', 'a shape name mermaid doesn’t have');
    says('flowchart TD\n    A@{ shape: rect, w: 40 }', 'Line 2', 'a size or a place of its own');
    says('flowchart TD\n    A["a"]\n    click A _blank', 'Line 3', 'a click written a way we cannot read');
    says('flowchart TD\n    A["x"]; B["y"]', 'Line 2', 'a semicolon');
    says('flowchart TD\n    A["a"]\n    A{"a"}', 'Line 3', 'a second shape');
    // Front matter is part of the block, so it counts toward the line number.
    says('---\ntitle: Plan\n---\nflowchart TD\n    A["a"]\n    A{"a"}', 'Line 6');
    // The ones with no line to point at say what is wrong with the whole block.
    says('sequenceDiagram\n    a ->> b: hi', 'sequenceDiagram');
    says('pie\n    "a": 1', 'pie');
    says('flowchart TD', 'no boxes');
    says('---\ntitle: Plan\nflowchart TD\n    A', 'front matter');
    // And text the canvas does model says nothing at all.
    const fine = 'flowchart TD\n    A["a"]\n    B["b"]\n    A --> B';
    if (!parseFlow(fine)) throw new Error('the sample diagram did not parse');
    if (flowRefusal(fine)) throw new Error(`a diagram that parses gave ${JSON.stringify(flowRefusal(fine))}`);
  });

  // Deleting the last box leaves a diagram that is legal to be halfway through and illegal to write down — mermaid cannot draw an empty flowchart. That is the reason the canvas never re-reads its own output: round-tripping through the text here would hand back null and leave the canvas with no graph at all, leaving the canvas with nothing to add to.
  check('an emptied diagram is still a graph the canvas can add to', () => {
    const { parseFlow, renderFlow, flowDeleteNode, flowAddNode, flowMoveNode } = booted;
    const graph = parseFlow('flowchart TD\n    n1(["Start"])');
    if (!graph) throw new Error('the starter diagram did not parse');
    flowDeleteNode(graph, 'n1');
    if (graph.nodes.length) throw new Error('the box was not removed');
    const bare = renderFlow(graph);
    if (bare !== 'flowchart TD') throw new Error(`emptied to ${JSON.stringify(bare)}`);
    if (parseFlow(bare) !== null) throw new Error('a header with nothing under it should be refused');
    flowAddNode(graph, 'rect', 'Next');
    const back = renderFlow(graph);
    if (back !== 'flowchart TD\n    n1["Next"]') throw new Error(`came back as ${JSON.stringify(back)}`);

    // The sheet's undo is a copied graph, and it copies with JSON. So the graph has to be plain data all the way down — put a function or a Map on it and stepping back would quietly hand back something that isn't the same graph.
    const rich = parseFlow('---\ntitle: Plan\n---\nflowchart LR\n    %% note\n    A["a"]\n    B{"b"}\n    A -.->|"maybe"| B');
    const copied = JSON.parse(JSON.stringify(rich));
    if (renderFlow(copied) !== renderFlow(rich)) throw new Error('a copied graph is not the same graph');

    // Dragging a box among its neighbors is a reorder of the declarations, and that order is what the layout reads. It has to go the way the pointer did.
    const three = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]');
    const order = () => three.nodes.map((node) => node.id).join('');
    flowMoveNode(three, 'A', null); // dropped past the end
    if (order() !== 'BCA') throw new Error(`moving A to the end gave ${order()}`);
    flowMoveNode(three, 'A', 'B'); // dropped on B, from below
    if (order() !== 'ABC') throw new Error(`moving A before B gave ${order()}`);
  });

  // The gestures that rewire a chain rather than just add to it. Each one has to leave a diagram that still says something, because the reader is dragging a box around, not editing a graph on purpose.
  check('rewiring a chain leaves it connected', () => {
    const { parseFlow, renderFlow, flowSpliceIntoEdge, flowExtractNode, flowFlipEdge, flowDuplicateNode } = booted;
    const chain = () =>
      parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    C["c"]\n    X["x"]\n    A --> B\n    B --> C');
    const edges = (graph) => graph.edges.map((edge) => edge.from + '>' + edge.to).join(' ');

    // A loose box dropped on a line goes into that line.
    const into = chain();
    flowSpliceIntoEdge(into, 'X', into.edges[0].id);
    if (edges(into) !== 'A>X X>B B>C') throw new Error(`splice gave ${edges(into)}`);

    // A box taken out of the middle closes the gap behind it, or the chain it was in silently comes apart.
    const out = chain();
    flowExtractNode(out, 'B');
    if (edges(out) !== 'A>C') throw new Error(`extract gave ${edges(out)}`);

    // Out of one chain and into another is those two, in that order.
    const moved = chain();
    flowExtractNode(moved, 'B');
    flowSpliceIntoEdge(moved, 'B', moved.edges[0].id);
    if (edges(moved) !== 'A>B B>C') throw new Error(`move gave ${edges(moved)}`);

    // Flipping keeps the line's look and only turns it around.
    const flipped = chain();
    flipped.edges[0].label = 'yes';
    flipped.edges[0].line = 'dotted';
    flowFlipEdge(flipped, flipped.edges[0].id);
    if (edges(flipped) !== 'B>A B>C') throw new Error(`flip gave ${edges(flipped)}`);
    if (flipped.edges[0].label !== 'yes' || flipped.edges[0].line !== 'dotted') {
      throw new Error('flipping a line changed how it looks');
    }

    // A duplicate is a new box beside the original, joined to nothing.
    const copied = chain();
    const copy = flowDuplicateNode(copied, 'B');
    if (!copy || copy.id === 'B') throw new Error('the copy reused the original id');
    if (edges(copied) !== 'A>B B>C') throw new Error(`duplicating added lines: ${edges(copied)}`);
    if (renderFlow(copied).split('\n')[3] !== '    ' + copy.id + '["b"]') {
      throw new Error('the copy did not land beside the original');
    }
  });

  // A box's four + handles all mean the same thing — the next step, that way — and the chart turns when that way is across the flow. The reading depends entirely on the direction, and getting it backwards would put "the next step" above the one it follows: wrong in a way that still looks like a diagram, so nothing on screen would give it away.
  check('every + handle means the next step, that way', () => {
    const { flowBudIntent } = booted;
    // Where each handle sits is the stylesheet's business now — a handle is placed on its own side of the box mermaid drew. What each one *means* is this file's, and that is what the direction decides.
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    for (const side of ['up', 'down', 'left', 'right']) {
      if (!css.includes('.flow-bud.is-' + side)) throw new Error(`no rule places the ${side} handle`);
    }

    const means = (direction, side, want) => {
      const got = flowBudIntent(direction, side);
      const said = got.step + (got.turn ? ' turning ' + got.turn : '');
      if (said !== want) throw new Error(`${direction} ${side}: ${said}, wanted ${want}`);
    };
    // With the flow, against it, and across it — for each of the four charts.
    means('TD', 'down', 'next');
    means('TD', 'up', 'previous');
    means('TD', 'right', 'next turning LR');
    means('TD', 'left', 'next turning RL');
    means('LR', 'right', 'next');
    means('LR', 'left', 'previous');
    means('LR', 'down', 'next turning TD');
    means('LR', 'up', 'next turning BT');
    means('BT', 'up', 'next');
    means('BT', 'down', 'previous');
    means('RL', 'left', 'next');
    means('RL', 'right', 'previous');
    // TB is TD spelled the older way, and has to read the same.
    means('TB', 'down', 'next');
    means('TB', 'up', 'previous');
  });

  check('only the first box is asked which way the chart runs', () => {
    const { parseFlow, flowBudSidesFor, flowAddNode } = booted;
    const same = (got, want, what) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    };
    // One box, no direction settled: all four sides, and taking one settles it.
    const lone = parseFlow('flowchart TD\n    A["a"]');
    same(flowBudSidesFor(lone), ['up', 'down', 'left', 'right'], 'a chart of one box');
    // Two boxes: only the pair along the flow, so nothing can spin the diagram round under the pointer. Turning it is the Flow picker's job from here.
    const pair = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B');
    same(flowBudSidesFor(pair), ['down', 'up'], 'a top-down chart');
    same(flowBudSidesFor(parseFlow('flowchart LR\n    A["a"]\n    B["b"]')), ['right', 'left'], 'left to right');
    same(flowBudSidesFor(parseFlow('flowchart BT\n    A["a"]\n    B["b"]')), ['up', 'down'], 'bottom up');
    same(flowBudSidesFor(parseFlow('flowchart RL\n    A["a"]\n    B["b"]')), ['left', 'right'], 'right to left');
    // And a second box takes the other two away.
    flowAddNode(lone, 'rect', 'b');
    same(flowBudSidesFor(lone), ['down', 'up'], 'once there are two');
  });

  check('a handle across the flow turns the chart and carries on', () => {
    const { parseFlow, renderFlow, flowBudRelation, flowAddNode, flowConnect } = booted;
    const graph = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A --> B');
    // What the canvas does with what the handle asked for.
    const relation = flowBudRelation(graph, 'B', 'right');
    if (relation.turn) graph.direction = relation.turn;
    const added = flowAddNode(graph, 'rect', 'c');
    if (relation.connectFrom) flowConnect(graph, relation.connectFrom, added.id);
    const want = 'flowchart LR\n    A["a"]\n    B["b"]\n    n1["c"]\n    A --> B\n    B --> n1';
    if (renderFlow(graph) !== want) throw new Error(`turning right gave ${JSON.stringify(renderFlow(graph))}`);
    // And the handle it turned toward is now the plain "next step" one.
    if (flowBudRelation(graph, 'n1', 'right').turn) throw new Error('the chart did not stay turned');
  });

  check('a flowchart written by hand is read the way mermaid reads it', () => {
    const { parseFlow, renderFlow } = booted;
    const becomes = (text, want) => {
      const graph = parseFlow(text);
      if (!graph) throw new Error(`refused ${JSON.stringify(text)}`);
      const back = renderFlow(graph);
      if (back !== want) throw new Error(`${JSON.stringify(text)} -> ${JSON.stringify(back)}`);
      // And what we wrote is a fixed point, or Save would keep rewriting the file.
      if (renderFlow(parseFlow(back)) !== back) throw new Error(`${JSON.stringify(back)} is not stable`);
    };

    // The older keyword, no direction, bare ids, an unquoted label, a chain, and the between-the-dashes label form — all normalized on the way out.
    becomes('graph\n  A --> B', 'flowchart TD\n    A["A"]\n    B["B"]\n    A --> B');
    becomes('flowchart LR\n  A[Do it] --> B', 'flowchart LR\n    A["Do it"]\n    B["B"]\n    A --> B');
    becomes(
      'flowchart TD\n  A --> B --> C',
      'flowchart TD\n    A["A"]\n    B["B"]\n    C["C"]\n    A --> B\n    B --> C',
    );
    becomes(
      'flowchart TD\n  A -- yes --> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -->|"yes"| B',
    );
    // The dotted and thick spellings of the same thing, which mermaid writes with different dashes around the label.
    becomes(
      'flowchart TD\n  A -. maybe .-> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -.->|"maybe"| B',
    );
    becomes(
      'flowchart TD\n  A == surely ==> B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A ==>|"surely"| B',
    );
    becomes(
      'flowchart TD\n  A -. no .- B',
      'flowchart TD\n    A["A"]\n    B["B"]\n    A -.-|"no"| B',
    );
    // The `&` shorthand is read as the edges it means — every pairing of the group before the arrow with the group after it.
    becomes(
      'flowchart LR\n  A & B --> C & D',
      'flowchart LR\n' +
        ['A["A"]', 'B["B"]', 'C["C"]', 'D["D"]', 'A --> C', 'A --> D', 'B --> C', 'B --> D']
          .map((line) => '    ' + line)
          .join('\n'),
    );
  });

  // Double-clicking a shape renames it, and that only works because nothing in the canvas's pointerdown calls preventDefault: on a pointerdown it suppresses the compatibility mouse events, and dblclick is one of them. The failure is silent — every drag still works, the double-click just does nothing — so it is held here rather than left to be found by hand.
  check('the canvas keeps the double-click that renames a box', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/flow-canvas.js'), 'utf8');
    const opened = fragment.indexOf("flowCanvas.addEventListener('pointerdown'");
    const closed = fragment.indexOf("flowCanvas.addEventListener('pointermove'");
    if (opened < 0 || closed < opened) throw new Error('could not find the canvas pointerdown handler');
    const handler = fragment.slice(opened, closed);
    if (/event\.preventDefault\(\)/.test(handler)) {
      throw new Error('pointerdown calls preventDefault, which kills dblclick on a shape');
    }
    if (!/flowCanvas\.addEventListener\('dblclick'/.test(fragment)) {
      throw new Error('the canvas has no dblclick handler to keep');
    }
    // The stylesheet is what holds text selection off instead, or dragging a box sweeps a selection across the diagram.
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const rule = css.slice(css.indexOf('.flow-canvas {'), css.indexOf('.flow-canvas.is-disabled'));
    if (!/user-select:\s*none/.test(rule)) throw new Error('.flow-canvas does not turn text selection off');
  });

  // The ring around a selected box stands 8px off the shape and follows its corners — nested corners in reverse, so the outer radius is the inner plus the gap. Mermaid builds its shapes with rough.js, so there is no `rx` to read and the inner radius is measured: walk in along the corner's diagonal until the fill starts. Turning that distance back into a radius is the part that is easy to get wrong and invisible when it is.
  check('a corner radius is recovered from how far in the fill starts', () => {
    const { flowCornerRadiusFrom } = booted;
    // A circular corner of radius r has its center at (r, r), so along the diagonal the fill begins at t = r(1 − 1/√2). Feed that t back in.
    const insetFor = (radius) => radius * (1 - Math.SQRT1_2);
    for (const radius of [0, 5, 20, 28, 30, 64]) {
      const got = flowCornerRadiusFrom(insetFor(radius));
      if (Math.abs(got - radius) > 0.001) {
        throw new Error(`a corner of ${radius} came back as ${got.toFixed(2)}`);
      }
    }
    // The wrong constant — the Euclidean gap r(√2 − 1) — is out by exactly √2, which reads as "the ring did nothing" rather than as a broken number.
    const wrong = insetFor(28) / (Math.SQRT2 - 1);
    if (Math.abs(wrong - 28) < 0.001) throw new Error('the two constants are indistinguishable');

    // And a pill: its inner radius is half its height, so the ring around it — half its height plus the gap — is exactly half the ring's own height.
    const gap = 8;
    const height = 56;
    const ring = flowCornerRadiusFrom(insetFor(height / 2)) + gap;
    if (Math.abs(ring - (height + gap * 2) / 2) > 0.001) throw new Error('a pill does not stay a pill');
  });

  // The sheet has one picture in it and mermaid draws it. Two would mean one of them is a lie, and it would be ours — so nothing in the flowchart code may draw a shape, and there is no second pane to draw it into.
  check('mermaid is the only thing that draws a flowchart', () => {
    const model = readFileSync(join(root, 'src/assets/shell/flow-model.js'), 'utf8');
    const canvas = readFileSync(join(root, 'src/assets/shell/flow-canvas.js'), 'utf8');
    const page = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
    // No outlines of our own, and no layout of ours placing them.
    for (const gone of ['outline:', 'grow:', 'layoutFlow', 'flowNodeSize', 'flowEdgeGeometry']) {
      if (model.includes(gone) || canvas.includes(gone)) throw new Error(`${gone} is back`);
    }
    if (/<(polygon|ellipse)\b/.test(canvas)) throw new Error('the canvas is drawing shapes again');
    // One drawing surface: no preview pane beside it.
    if (page.includes('flowPreview')) throw new Error('the second picture is back in the page');
    if (!canvas.includes("mermaid.render('leafFlowDraw'")) throw new Error('the canvas no longer renders with mermaid');
    // The handles are laid over mermaid's drawing, keyed off what it tags. Mermaid writes a box's id on `id` as `flowchart-<id>-<n>`, not on `data-id` — reading the wrong attribute finds nothing and leaves the canvas with no handles at all, silently. Both spellings are read.
    if (!canvas.includes("svg.querySelectorAll('g.node, g[data-id]')")) {
      throw new Error('nothing reads mermaid’s boxes');
    }
    if (!canvas.includes('flowchart-(.+)-')) throw new Error('the box id is not unwrapped from mermaid’s spelling');
    if (!canvas.includes('flowEdgeDomId')) throw new Error('nothing maps mermaid’s lines back to ours');
  });

  // Nothing here borrows jsoncanvas.org's field names: mermaid cannot draw a `.canvas` file, so there is nothing to be compatible with. A node has a shape; an edge runs from one box to another.
  check('the graph says what it means and borrows nothing', () => {
    const { parseFlow } = booted;
    const graph = parseFlow('flowchart TD\n    A["a"]\n    B["b"]\n    A -.->|"maybe"| B');
    const nodeFields = Object.keys(graph.nodes[0]).sort().join(',');
    if (nodeFields !== 'classes,group,href,hrefTip,icon,id,img,shape,style,text') throw new Error(`a node carries ${nodeFields}`);
    const edgeFields = Object.keys(graph.edges[0]).sort().join(',');
    if (edgeFields !== 'animate,ends,from,id,label,line,name,stretch,style,to') throw new Error(`an edge carries ${edgeFields}`);
    for (const path of ['src/assets/shell/flow-model.js', 'src/assets/shell/flow-canvas.js']) {
      const source = readFileSync(join(root, path), 'utf8');
      for (const borrowed of ['fromNode', 'toNode', 'toEnd', 'jsoncanvas']) {
        // The model's header explains why the names went; that mention is fine.
        const hits = source.split(borrowed).length - 1;
        const allowed = borrowed === 'jsoncanvas' && path.endsWith('flow-model.js') ? 1 : 0;
        if (hits > allowed) throw new Error(`${borrowed} is back in ${path}`);
      }
    }
  });

  // Diagrams are drawn in the theme's own colors, read off :root at render time. A token that does not exist reads as an empty string, mermaid falls back to its own palette, and the diagram quietly stops matching the page — so every name in the maps is held to one that really is defined. A color comes from the contract in theme.rs, which every theme fills; everything else from the stylesheet's own block.
  check('the mermaid theme map only names tokens that exist', () => {
    // Read from the fragment rather than the booted page: a `const` in the shell script is not a property of the context, and the map should not have to become one to be checked.
    const fragment = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const maps = fragment.slice(
      fragment.indexOf('const MERMAID_COLOR_MAP'),
      fragment.indexOf('function themeTokenValue'),
    );
    if (!maps) throw new Error('could not find the mermaid theme maps in decorate.js');
    const used = [...new Set([...maps.matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]))];
    if (used.length < 15) throw new Error(`expected the whole map, got ${used.length} tokens`);
    const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
    const contract = theme.slice(
      theme.indexOf('LEAF_SEMANTIC_TOKEN_CONTRACT'),
      theme.indexOf('fn leak_str'),
    );
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const tokens = readFileSync(join(root, 'src/assets/tokens.css'), 'utf8');
    const defined = new Set([
      ...[...contract.matchAll(/'?"(--lt-[a-z0-9-]+)"/g)].map((m) => m[1]),
      ...[...tokens.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
      ...[...css.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
    ]);
    if (defined.size < 50) throw new Error(`only found ${defined.size} tokens`);
    const missing = used.filter((token) => !defined.has(token));
    if (missing.length) throw new Error(`no such token: ${missing.join(', ')}`);

    // A token that exists is not a token the text sits on, and the map names the fill purely so the ink can be measured against it. A failed diagram's words were measured against the red of the bomb beside them and printed near-black on a near-black block — legible only if you already knew what it said.
    const printedOn = [...maps.matchAll(/errorTextColor: \['(--[a-z0-9-]+)'\]/g)].map((m) => m[1]);
    const cell = css.slice(css.indexOf('pre.mermaid[data-processed="true"]'));
    const fill = (cell.match(/background-color: var\((--[a-z0-9-]+)\)/) || [])[1];
    if (!fill) throw new Error('the diagram cell no longer names the surface it is drawn on');
    if (printedOn.length !== 1 || printedOn[0] !== fill) {
      throw new Error(`the failed diagram's words are measured against ${printedOn.join(', ') || 'nothing'}, and printed on ${fill}`);
    }
  });

  // Scrolling a page of diagrams jolted the words on every drawing that landed: a block grows above the reader, everything on screen shoves down by what it gained, and the app's own re-pin ran a painted frame later. The fix is arithmetic inside the batch loop, and the whole of it is which blocks count.
  const readerStand = () => {
    const appEl = booted.document.getElementById('app');
    const wasRect = appEl.getBoundingClientRect;
    // The reader's top edge at 100: the app bar's own strip is above it and everything the reader sees is below.
    appEl.getBoundingClientRect = () => ({ left: 0, top: 100, right: 1080, bottom: 920, width: 1080, height: 820 });
    appEl.scrollTop = 4000;
    return {
      appEl,
      done: () => {
        appEl.getBoundingClientRect = wasRect;
        appEl.scrollTop = 0;
      },
    };
  };
  // A block whose bottom is at or above the top edge; `height` is read fresh, so raising it is the block growing.
  const growingBlock = (bottom, start) => {
    const block = {
      isConnected: true,
      height: start,
      getBoundingClientRect: () => ({ top: bottom - block.height, bottom, height: block.height }),
    };
    return block;
  };

  check('a diagram drawn above the reader does not shove the page', () => {
    const { mermaidBlocksAboveReader, mermaidRepayGrowthAbove } = booted;
    const stand = readerStand();
    try {
      // The measured median and the measured worst: 114px to 306px, and 261px to 1051px.
      const median = growingBlock(60, 114);
      const worst = growingBlock(40, 261);
      const above = mermaidBlocksAboveReader([median, worst]);
      if (above.length !== 2) throw new Error(`${above.length} of the two blocks above the reader were counted`);
      median.height = 306;
      worst.height = 1051;
      mermaidRepayGrowthAbove(above);
      // 4000 + (306-114) + (1051-261).
      if (Math.round(stand.appEl.scrollTop) !== 4982) {
        throw new Error(`the reader was left at ${stand.appEl.scrollTop} rather than 4982`);
      }

      // 19 of the 60 drew shorter than the box that held them, which moves the page the other way and is owed just the same.
      stand.appEl.scrollTop = 4000;
      const shrinking = growingBlock(60, 192);
      const shrank = mermaidBlocksAboveReader([shrinking]);
      shrinking.height = 105;
      mermaidRepayGrowthAbove(shrank);
      if (Math.round(stand.appEl.scrollTop) !== 3913) {
        throw new Error(`a drawing shorter than its box left the reader at ${stand.appEl.scrollTop} rather than 3913`);
      }
    } finally {
      stand.done();
    }
  });

  // A block grows downward, so one straddling the top edge grows into the room under the reader's eyes and nothing they can see moves. Paying for that would drag the diagram they are looking at up and off the window — the one case a reader would notice most.
  check('a diagram drawn below the reader’s top edge, or straddling it, moves the reader not at all', () => {
    const { mermaidBlocksAboveReader, mermaidRepayGrowthAbove } = booted;
    const stand = readerStand();
    try {
      const below = { isConnected: true, getBoundingClientRect: () => ({ top: 300, bottom: 500, height: 200 }) };
      const straddling = { isConnected: true, getBoundingClientRect: () => ({ top: 20, bottom: 300, height: 280 }) };
      const above = mermaidBlocksAboveReader([below, straddling]);
      if (above.length) throw new Error(`${above.length} block(s) were counted as above the reader`);
      mermaidRepayGrowthAbove(above);
      if (stand.appEl.scrollTop !== 4000) throw new Error(`the reader moved to ${stand.appEl.scrollTop}`);

      // The edge itself belongs to the block above it: a bottom exactly on the top edge shoves the page.
      const touching = growingBlock(100, 114);
      if (mermaidBlocksAboveReader([touching]).length !== 1) throw new Error('a block ending exactly on the top edge was not counted');
    } finally {
      stand.done();
    }
  });

  // `min-height` cannot make a block shorter than its own contents, and a waiting box's contents are the diagram's source text with the ink turned off. 19 of the 60 diagrams in the test document draw shorter than that text — worst 192px of source against a 105px drawing — so a remembered height held as a floor left those boxes 87px too tall and shoved the page anyway when the drawing landed.
  check('a remembered height shorter than the box’s own source text is taken exactly, not as a floor', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[name === 'min-height' ? 'minHeight' : name];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    // Drawn at 105px: that is what the memo learns.
    finishMermaidDiagram(block('flowchart TD\n  A --> B', 105));
    const waiting = block('flowchart TD\n  A --> B', 192);
    markMermaidWait(waiting, false);
    if (waiting.style.height !== '105px') throw new Error(`the box was given a height of ${waiting.style.height || 'nothing'}`);
    if (waiting.style.minHeight !== '0px') throw new Error('the stylesheet’s 88px floor was left on a box shorter than it');

    // Nothing measured at this column width: the box keeps the stylesheet's floor and its source text's height rather than another drawing's.
    const unknown = block('flowchart TD\n  C --> D', 192);
    markMermaidWait(unknown, false);
    if ('height' in unknown.style || 'minHeight' in unknown.style) {
      throw new Error('a box with no remembered height was pinned to one anyway');
    }

    // And the drawing itself is never clamped to what it measured last time.
    const drawn = block('flowchart TD\n  A --> B', 105);
    drawn.style.height = '105px';
    drawn.style.minHeight = '0px';
    finishMermaidDiagram(drawn);
    if ('height' in drawn.style || 'minHeight' in drawn.style) {
      throw new Error('a drawn diagram was left holding the height its box was given');
    }
  });

  // Every box in a document is drawn once while the window is quiet, so nothing in it resizes afterwards and a scroll to the bottom moves nothing. What decides that is one list: everything whose height has never been measured at this column width. A drawing already measured is skipped, which is what makes the pass idempotent, and a theme change or a change in the column's width re-keys the memo and so makes every diagram a candidate again without anything having to notice why.
  check('the warm pass draws only what has never been measured at this column width', () => {
    const { mermaidWarmCandidates, finishMermaidDiagram } = booted;
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[name === 'min-height' ? 'minHeight' : name];
      },
    });
    const diagram = (source) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 220, width: 400, height: 220 }),
    });
    // The reading column at 640px, which is where these heights are measured.
    const bodyOf = (held) => ({
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 900, width: 640, height: 900 }),
      querySelectorAll: (selector) => (String(selector).includes(':not(') ? held.filter((d) => d.dataset.processed !== 'true') : held),
    });
    const stand = (held) => {
      const body = bodyOf(held);
      appEl.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery.call(appEl, selector));
    };

    try {
      const measured = diagram('flowchart TD\n  W1 --> W2');
      const never = diagram('flowchart TD\n  W3 --> W4');
      stand([measured, never]);
      // One of the two has been drawn and measured at this width.
      finishMermaidDiagram(measured);
      const queue = mermaidWarmCandidates();
      if (queue.length !== 1 || queue[0] !== never) {
        throw new Error(`the warm pass queued ${queue.length} of the two, and not the unmeasured one`);
      }

      // Nothing left to learn: the pass has an empty queue and draws nothing, which is why it can be scheduled after every other pass without costing anything.
      finishMermaidDiagram(never);
      if (mermaidWarmCandidates().length) throw new Error('a document whose every height is known was warmed again');

      // Past the memo's cap it empties wholesale rather than dropping the oldest, so warming a document this size is a redraw of it on every scroll. It is left exactly as it ships.
      const crowd = Array.from({ length: 201 }, (unused, at) => diagram(`flowchart TD\n  C${at} --> D`));
      stand(crowd);
      if (mermaidWarmCandidates().length) throw new Error('a document with more diagrams than the memo holds was warmed anyway');
      // One under the cap still is.
      stand(crowd.slice(0, 200));
      if (mermaidWarmCandidates().length !== 200) throw new Error('a document inside the cap was refused');
    } finally {
      appEl.querySelector = wasQuery;
    }
  });

  // Mermaid writes a whole stylesheet into every drawing it makes, scoped by that drawing's own svg id — so a document of 67 diagrams carries 67 sheets, 44 of them byte-identical, and that is what makes a settled page of drawings scroll badly. One copy per distinct sheet in the page's head, scoped by a class the drawing wears instead.
  const sheetHolder = () => (booted.document.head.children || []).find((child) => child.id === 'leaf-mermaid-sheets');
  const standInDrawing = (id, css) => {
    const worn = new Set();
    const style = {
      textContent: css,
      taken: false,
      remove() {
        this.taken = true;
      },
    };
    const svg = {
      id,
      classList: { add: (name) => worn.add(name) },
      getAttribute: (name) => (name === 'class' ? Array.from(worn).join(' ') : null),
      querySelector: (selector) => (String(selector) === 'style' && !style.taken ? style : null),
    };
    return {
      style,
      svg,
      worn: () => Array.from(worn),
      querySelector: (selector) => (String(selector) === 'svg' ? svg : null),
    };
  };
  const flowchartSheet = (id) => `#${id}{font-size:16px;}@keyframes dash{to{stroke-dashoffset:0;}}#${id} .node rect{fill:#eef;}`;

  check('two drawings of the same kind share one sheet', () => {
    const { shareMermaidSheet, forgetMermaidSheets } = booted;
    forgetMermaidSheets();
    const first = standInDrawing('mermaid-1', flowchartSheet('mermaid-1'));
    const second = standInDrawing('mermaid-2', flowchartSheet('mermaid-2'));
    shareMermaidSheet(first);
    shareMermaidSheet(second);
    const cls = first.worn().find((name) => name.startsWith('lt-mmd-'));
    if (!cls) throw new Error('the drawing wears no class naming its sheet');
    if (!second.worn().includes(cls)) throw new Error('two byte-identical sheets were given two classes');
    if (!first.style.taken || !second.style.taken) throw new Error('a drawing kept its own style element after its rules were hoisted');
    const sheet = sheetHolder();
    if (!sheet) throw new Error('nothing was written into the page');
    const scoped = sheet.textContent.split(`.${cls} .node rect`).length - 1;
    if (scoped !== 1) throw new Error(`the shared rule was written ${scoped} times`);
    if (sheet.textContent.includes('#mermaid-1')) throw new Error('the drawing’s own id was left in the shared sheet');
  });

  // A rule that names no id — an animation, and anything mermaid's themeCSS appends — has nothing to normalize out, so it would otherwise be written once per distinct sheet rather than once for the page. Kept when the theme changes, too: it carries no color.
  check('an animation a drawing shares is written once, not once per drawing', () => {
    const { shareMermaidSheet, forgetMermaidSheets } = booted;
    forgetMermaidSheets();
    shareMermaidSheet(standInDrawing('mermaid-3', flowchartSheet('mermaid-3')));
    // A different kind of diagram: its own sheet, the same animation inside it.
    shareMermaidSheet(standInDrawing('mermaid-4', `#mermaid-4 .pieCircle{stroke:#333;}@keyframes dash{to{stroke-dashoffset:0;}}`));
    const sheet = sheetHolder();
    const written = sheet.textContent.split('@keyframes dash').length - 1;
    if (written !== 1) throw new Error(`the animation was written ${written} times`);
    if (sheet.textContent.includes('@keyframes dash{to{stroke-dashoffset:0;}}#')) {
      throw new Error('the animation was left inside a sheet rather than lifted out of it');
    }
  });

  // Every rule in there paints the theme it was drawn in, so a reader trying six themes would otherwise end with six sets of rules in the page and five of them dead. The animations stay — they carry no color — and a drawing restored out of the picture memo can still put its own sheet back, which is what a theme left and come back to needs.
  check('the page-level sheet is emptied when the theme changes', () => {
    const { shareMermaidSheet, forgetMermaidSheets, ensureMermaidSheets } = booted;
    forgetMermaidSheets();
    const drawing = standInDrawing('mermaid-5', flowchartSheet('mermaid-5'));
    shareMermaidSheet(drawing);
    const cls = drawing.worn().find((name) => name.startsWith('lt-mmd-'));
    const sheet = sheetHolder();
    forgetMermaidSheets();
    if (sheet.textContent.includes(`.${cls} .node rect`)) throw new Error('the sheets written for the theme being left were kept');
    if (!sheet.textContent.includes('@keyframes dash')) throw new Error('the animations went with them');
    // Restored from the picture memo: the drawing carries the class and no sheet of its own, so the page has to be handed its rules back.
    ensureMermaidSheets({ querySelector: (selector) => (String(selector) === 'svg' ? drawing.svg : null) });
    if (!sheet.textContent.includes(`.${cls} .node rect`)) throw new Error('a restored drawing was left with nothing painting it');
    const twice = sheet.textContent.split(`.${cls} .node rect`).length - 1;
    if (twice !== 1) throw new Error(`putting the sheet back wrote it ${twice} times`);
  });

  // A drawing off screen stops painting, and the browser is handed the exact height it drew to so the block holds its place while it is away. That exact height is the whole reason this can be done at all: it was tried once across the document, when nothing knew how tall a block was, and it flashed blanks and jumped the rail's position box.
  check('a drawn diagram carries its own measured height as its intrinsic size', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[String(name).replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    const drawn = block('flowchart TD\n  S1 --> S2', 214);
    finishMermaidDiagram(drawn);
    if (drawn.style.contentVisibility !== 'auto') throw new Error('a drawn diagram goes on painting off screen');
    if (drawn.style.containIntrinsicSize !== 'auto 214px') {
      throw new Error(`the block stands in at ${drawn.style.containIntrinsicSize || 'nothing'} rather than the height it drew to`);
    }

    // A box has no drawing to skip, and its own remembered height is what holds the page still.
    markMermaidWait(drawn, false);
    if ('contentVisibility' in drawn.style || 'containIntrinsicSize' in drawn.style) {
      throw new Error('a box handed back was left skipping its own paint');
    }

    // Measured at nothing: there is no height to stand in with, so nothing is skipped either.
    const unmeasured = block('flowchart TD\n  S3 --> S4', 0);
    finishMermaidDiagram(unmeasured);
    if ('contentVisibility' in unmeasured.style) throw new Error('a drawing nothing could measure was skipped anyway');

    // The stand-in size is the box's contents and the height measured is the whole block, so the padding around a diagram comes off it. Left on, every skipped block stands 25px taller than the drawing it is holding a place for, and a document of 67 grows by 1,655px as the reader scrolls away from them.
    const wasStyle = booted.getComputedStyle;
    try {
      booted.getComputedStyle = () => ({
        getPropertyValue: (name) => (String(name).startsWith('padding') ? '12.5px' : '0px'),
      });
      const padded = block('flowchart TD\n  S5 --> S6', 231);
      finishMermaidDiagram(padded);
      if (padded.style.containIntrinsicSize !== 'auto 206px') {
        throw new Error(`the padding was left in the stand-in size: ${padded.style.containIntrinsicSize}`);
      }
    } finally {
      booted.getComputedStyle = wasStyle;
    }
  });

  // Named after the fault this reopens: skipping off-screen blocks across the whole document jumped the page, because nothing knew how tall a block was and the browser re-estimated as it went. Two things keep it still now — the stand-in size is the drawing's own measured height rather than an estimate, and the rail's clone cancels the skip so the thumbnail is not a column of blanks.
  check('a diagram off screen keeps its place in the document', () => {
    const { finishMermaidDiagram, markMermaidWait } = booted;
    const styleStand = () => ({
      removeProperty(name) {
        delete this[String(name).replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())];
      },
    });
    const block = (source, height) => ({
      dataset: {},
      style: styleStand(),
      isConnected: true,
      __mermaidSource: source,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: height, width: 400, height }),
    });

    // What the block holds open while it is skipped, and what a box put back in its place is given, are the same number.
    const drawn = block('flowchart TD\n  P1 --> P2', 137);
    finishMermaidDiagram(drawn);
    const standIn = drawn.style.containIntrinsicSize;
    const waiting = block('flowchart TD\n  P1 --> P2', 402);
    markMermaidWait(waiting, false);
    if (standIn !== `auto ${waiting.style.height}`) {
      throw new Error(`the skipped block stands in at ${standIn} and a box put back at ${waiting.style.height}`);
    }

    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const clone = css.slice(css.indexOf('.document-minimap-preview pre.mermaid {'));
    if (!clone.startsWith('.document-minimap-preview pre.mermaid {')) throw new Error('nothing cancels the skip inside the rail’s clone');
    if (!clone.slice(0, 120).includes('content-visibility: visible !important;')) {
      throw new Error('the rail’s clone inherits the skip, which blanks every drawing in the thumbnail');
    }
  });

  // The complaint this whole subject exists to answer: a diagram scrolled three screens past used to go back to an empty box, so a document of diagrams read twice was a document of blanks. It stays drawn now — everywhere the memos can remember it, which is at or under their cap. Past that they empty wholesale, a box put back would be redrawn from scratch, and a page holding every drawing gives up a whole second in one frame; there, and only there, the old behavior stands.
  check('a diagram scrolled well past is still drawn when you come back', () => {
    const { mermaidMayRecycle } = booted;
    const appEl = booted.document.getElementById('app');
    const wasQuery = appEl.querySelector;
    const drawing = {
      dataset: { processed: 'true' },
      isConnected: true,
      __mermaidSource: 'flowchart TD\n  R1 --> R2',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 180, width: 400, height: 180 }),
    };
    // The page holds `held` diagrams, and this one has been drawn and measured, so both memos know it.
    const stand = (held) => {
      const body = {
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 900, width: 640, height: 900 }),
        querySelectorAll: () => Array.from({ length: held }, () => drawing),
      };
      appEl.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery.call(appEl, selector));
    };

    try {
      stand(60);
      booted.finishMermaidDiagram(drawing);
      drawing.dataset.processed = 'true';
      if (mermaidMayRecycle(drawing)) throw new Error('a diagram on a document the memos can hold was handed back as a box');
      // And nothing is even watching for it to go: a document that keeps every drawing has nothing to watch for.
      if (booted.mermaidDocumentPastMemory()) throw new Error('a 60-diagram document was called too big to remember');

      // Past the cap both memos empty wholesale, so the page behaves as it always did. What the guard then asks is whether this drawing is still in the picture memo, which is the check that was there before this and is unchanged.
      stand(201);
      if (!booted.mermaidDocumentPastMemory()) throw new Error('a 201-diagram document was called small enough to remember');
    } finally {
      appEl.querySelector = wasQuery;
    }
  });

  // A warm pass a nearer one interrupted has to pick itself up, or it stalls until the reader happens to scroll. Two things start it: the settle after a gesture, and the end of every other pass. One at a time, because a document being warmed schedules one on every batch it finishes.
  check('a settled scroll starts the warm pass again, one at a time', () => {
    const { readerScrollSettled } = booted;
    const wasTimeout = booted.setTimeout;
    const queued = [];
    booted.setTimeout = (fn, delay) => {
      queued.push({ fn, delay });
      return queued.length;
    };
    let first = 0;
    try {
      readerScrollSettled();
      first = queued.length;
      if (!first) throw new Error('a settled scroll queued no warm pass');
      readerScrollSettled();
      if (queued.length !== first) throw new Error('a second settle queued a second warm pass on top of the first');
      // Let it run, so the page is not left holding a timer that never fires — the stand-in page has no diagrams, so it finds nothing to draw.
      queued[0].fn();
      readerScrollSettled();
      if (queued.length !== first + 1) throw new Error('the pass that ran did not free the next one');
    } finally {
      queued.slice(first).forEach((held) => held.fn());
      booted.setTimeout = wasTimeout;
    }
  });

  // v0.1.468: one line in a document took the whole interface away. Mermaid draws `click A "…"` as a real anchor even at its strict level, and writes only `xlink:href` — which `documentLinkFor` does not match, so the click belonged to the web view and the app page navigated to the site with no tabs, no bar and no way back.
  check('a box wired to a link is the app’s click, not the web view’s', () => {
    const { claimMermaidLinks } = booted;
    const anchor = (attributes) => ({
      attributes,
      hasAttribute: (name) => name in attributes,
      getAttribute: (name) => (name in attributes ? attributes[name] : null),
      getAttributeNS: (ns, name) => attributes[ns + '|' + name] || null,
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
    });
    const xlink = 'http://www.w3.org/1999/xlink';
    const linked = anchor({ [xlink + '|href']: 'https://example.com/x' });
    const already = anchor({ href: '/its/own' });
    const plain = anchor({});
    claimMermaidLinks({ querySelectorAll: () => [linked, already, plain] });
    if (linked.attributes.href !== 'https://example.com/x') throw new Error(`the anchor was not claimed: ${linked.attributes.href}`);
    if (already.attributes.href !== '/its/own') throw new Error('an anchor that had its own href was overwritten');
    if ('href' in plain.attributes) throw new Error('an anchor with nowhere to go was given an href');
  });

  // The half of a link click that lives in the page: what it chooses to put in the command. A site is one page, so a resolved href names a document at the top of it, and a link written one folder down points at nothing.
  check('a click on a link sends the href its author wrote, not the one the browser resolved', () => {
    const { bindDocumentLinks } = booted;
    const app = booted.document.getElementById('app');
    const wasContains = app.contains;
    const wasIpc = booted.ipc;
    const posted = [];
    // The binding is once-per-page, so a run where a render already did it would leave nothing to raise. Reset the latch and take the handler this call adds, rather than the neighbors already watching the same element.
    const wasBound = vm.runInContext('documentLinksBound', booted);
    vm.runInContext('documentLinksBound = false;', booted);
    const WATCHED = ['click', 'auxclick', 'mousedown'];
    const before = new Map(WATCHED.map((type) => [type, (app.listeners.get(type) || []).length]));
    // A stand-in link inside a document body, carrying both forms: the attribute as written, and the address the browser resolved it to.
    const anchor = (written, resolved) => {
      const link = {
        getAttribute: (name) => (name === 'href' ? written : null),
        href: resolved,
        closest: (selector) => (selector === '.document-body' ? { id: 'body' } : link),
      };
      return link;
    };
    const clickOn = (link) => {
      posted.length = 0;
      for (const handler of (app.listeners.get('click') || []).slice(before.get('click'))) {
        handler({ target: link, button: 0, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} });
      }
      return posted.find((one) => one.command === 'openLink');
    };
    try {
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      app.contains = () => true;
      bindDocumentLinks();
      if ((app.listeners.get('click') || []).length === before.get('click')) throw new Error('no click listener was bound to the document');

      const relative = clickOn(anchor('volume-3/README.md', 'https://leaf.test/volume-3/README.md'));
      if (!relative) throw new Error('a click on a document link sent no command');
      if (relative.href !== 'volume-3/README.md') throw new Error(`the click sent ${JSON.stringify(relative.href)} rather than the href as written`);

      // A heading in another document rides along on the written href, so the host still has it to cut off.
      const heading = clickOn(anchor('../two.md#how-it-ranks', 'https://leaf.test/two.md'));
      if (!heading || heading.href !== '../two.md#how-it-ranks') throw new Error(`a link naming a heading sent ${JSON.stringify(heading && heading.href)}`);

      // A diagram's box is an SVG anchor, whose `href` property is an SVGAnimatedString rather than a string, so the attribute is the only readable form.
      const drawn = clickOn(anchor('notes/one.md', { baseVal: 'notes/one.md' }));
      if (!drawn || drawn.href !== 'notes/one.md') throw new Error(`a link drawn in a diagram sent ${JSON.stringify(drawn && drawn.href)}`);

      // A link out of the site is written with its own scheme, so it still reaches the host whole.
      const away = clickOn(anchor('https://example.com/x', 'https://example.com/x'));
      if (!away || away.href !== 'https://example.com/x') throw new Error(`a link off the site sent ${JSON.stringify(away && away.href)}`);

      // A link inside a glossary entry is its own listener, and takes the same word for the same reason.
      const sheet = booted.document.getElementById('glossarySheetBody');
      const inSheet = anchor('volume-3/README.md', 'https://leaf.test/volume-3/README.md');
      posted.length = 0;
      for (const handler of sheet.listeners.get('click') || []) handler({ target: inSheet, preventDefault() {} });
      const raised = posted.find((one) => one.command === 'openLink');
      if (!raised || raised.href !== 'volume-3/README.md') throw new Error(`a link in a glossary entry sent ${JSON.stringify(raised && raised.href)}`);
    } finally {
      booted.ipc = wasIpc;
      app.contains = wasContains;
      // Put the page back where it was, so nothing after this is watched twice.
      for (const type of WATCHED) {
        const held = app.listeners.get(type);
        if (held) held.length = before.get(type);
      }
      vm.runInContext(`documentLinksBound = ${wasBound ? 'true' : 'false'};`, booted);
    }
  });

  // Mermaid substitutes its own glyph for an icon it cannot find — an 80x80 rect in a hardcoded #087ebf, the one color a diagram could show that no theme chose. And a picture whose URL will not decode throws from inside mermaid's renderer, where all the catch upstream can do is leave the block wearing mermaid's error. So both are settled before mermaid reads the block.
  check('a box mermaid cannot draw becomes our own mark before it sees it', () => {
    const { mermaidHasIcon, mermaidRewriteTyped } = booted;
    if (!mermaidHasIcon('leaf:back')) throw new Error('the generated set does not carry leaf:back');
    if (mermaidHasIcon('fa:bell')) throw new Error('a set we do not have was taken as ours');
    if (mermaidHasIcon('leaf:nosuchicon')) throw new Error('a name we do not have was taken as ours');
    if (mermaidHasIcon('back')) throw new Error('a name with no prefix was taken as ours');
    if (!mermaidHasIcon('leaf:missing-image')) throw new Error('the mark both failures fall back to is not in the set');

    // The rewrite reaches only inside `@{ … }`: the same word in a label is the reader's own text.
    const swapped = mermaidRewriteTyped('flowchart TD\n  A@{ icon: "fa:bell" }\n  B["icon: fa:bell"]', (key, value) =>
      key === 'icon' && value !== 'leaf:back' ? 'icon: "leaf:missing-image"' : null,
    );
    if (!swapped.includes('A@{ icon: "leaf:missing-image" }')) throw new Error(`the icon was not swapped: ${swapped}`);
    if (!swapped.includes('B["icon: fa:bell"]')) throw new Error(`the label was rewritten: ${swapped}`);
  });

  // Diagrams are drawn three at a time, and mermaid keeps drawing after one of them throws — so the batch comes back with its error picture in the block it failed on and finished drawings in the rest. Marking all three cost two working diagrams their toolbar and their memo entry every time one broken diagram sat beside them.
  checkSettled('a broken diagram is marked on its own, and the batch beside it finishes', async () => {
    const block = (name, drawn) => {
      const element = fakeElement(name);
      element.__mermaidSource = `flowchart TD\n  ${name} --> B`;
      element.innerHTML = drawn.includes('svg') ? `<svg id="${name}"></svg>` : '';
      element.dataset = { diagramWait: 'true' };
      element.children = [];
      element.appendChild = (child) => {
        element.children.push(child);
        return child;
      };
      // Only what mermaid really left behind answers: the error picture it draws into the block it failed on, and the drawing it leaves in every block it drew.
      element.querySelector = (selector) => (drawn.includes(String(selector)) ? fakeElement(String(selector)) : null);
      return element;
    };
    const bad = block('bad', ['svg', '.error-icon']);
    const good = block('good', ['svg']);
    const unreached = block('unreached', []);

    booted.mermaid = {
      registerIconPacks() {},
      initialize() {},
      run() {
        throw new Error('one block in this batch will not draw');
      },
    };
    booted.drawMermaidDiagrams([bad, good, unreached]);
    // The batch's own promises are all microtasks up to the yield it ends on, which the fake page's timer never fires.
    await new Promise((resolve) => setImmediate(resolve));
    delete booted.mermaid;

    if (bad.dataset.mermaidRender !== 'failed') throw new Error('the diagram carrying mermaid’s error was not marked');
    if (unreached.dataset.mermaidRender !== 'failed') throw new Error('a block with neither an error nor a drawing was left spinning');
    if (good.dataset.mermaidRender) throw new Error('a diagram that drew fine was marked failed beside its neighbor');
    if (good.dataset.diagramWait) throw new Error('a diagram that drew fine never reached finish');
    if (!good.children.some((child) => child.className === 'mermaid-zoom')) throw new Error('a diagram that drew fine got no toolbar');
    if (bad.children.length) throw new Error('the broken diagram was given a toolbar');

    // The memo is the other half of finishing: the drawing comes straight back on the next pass, where a block that was wrongly marked has nothing to come back to.
    const again = block('good', ['svg']);
    again.innerHTML = '';
    booted.drawMermaidDiagrams([again]);
    if (again.innerHTML !== good.innerHTML) throw new Error('a diagram that drew fine left no memo entry');
  });

  // The diagram's labels are set in the theme's body font, which theme.rs emits per family rather than reading.css.
  check('the theme compiler emits the font the diagrams ask for', () => {
    const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
    if (!theme.includes('--reading-font')) {
      throw new Error('theme.rs no longer emits --reading-font');
    }
  });

  // An icon is a name on a masked span, never a drawing (see the icon rule in AGENTS.md). Code that swaps one and looks for an `svg` finds nothing and fails in silence: a vault on GitHub kept its box for a release because of exactly this. Mermaid's own drawing is the exception, and it is named line by line rather than by file, so a fourth query cannot ride in behind the three.
  check('nothing looks for an svg where the page draws a masked span', () => {
    // The flowchart editor's stage, and the block a batch threw on being asked whether mermaid drew anything into it at all.
    const mermaidsOwn = new Set([
      "const svg = stage && stage.querySelector('svg');",
      "if (diagram.querySelector('.error-icon') || !diagram.querySelector('svg')) diagram.dataset.mermaidRender = 'failed';",
      // The drawing whose sheet is being hoisted into the page, and the one being handed back its sheet after a restore. Both are mermaid's own SVG and neither can be anything else.
      "const svg = diagram.querySelector('svg');",
      "const svg = node && typeof node.querySelector === 'function' ? node.querySelector('svg') : null;",
    ]);
    const offenders = [];
    for (const name of names) {
      const text = readFileSync(join(root, 'src/assets', name), 'utf8');
      for (const line of text.split('\n')) {
        if (!/querySelector(All)?\(\s*['"]svg['"]\s*\)/.test(line)) continue;
        if (!mermaidsOwn.has(line.trim())) offenders.push(`${name}: ${line.trim()}`);
      }
    }
    if (offenders.length) throw new Error(`looks for an svg: ${offenders.join(', ')}`);
  });

  // Mermaid sizes a box from its own measurement of the label, so measuring in the fallback face and painting in the theme's takes the last letter off every box in the diagram. v0.1.441 shipped that.
  check('diagrams are measured only once the fonts have landed', () => {
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const draw = decorate.slice(decorate.indexOf('function drawMermaidBatches'));
    const wait = draw.indexOf('document.fonts.ready');
    const init = draw.indexOf('mermaid.initialize');
    if (wait < 0) throw new Error('the draw path no longer waits for the fonts');
    if (init < 0 || wait > init) throw new Error('the fonts are waited for after the diagrams are measured');
  });

  // The full-window diagram is built per open and torn down by a render, and both halves fail silently: mermaid replaces the stage's contents with the SVG it made, so a control put in before the draw is simply gone, and a variable of this fragment's own is still in its dead zone while theme.js runs the first render — which is one of the things that closes the overlay.
  check('the full-window diagram survives its own draw and the first render', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/diagram-view.js'), 'utf8');
    const draw = fragment.slice(fragment.indexOf('function drawDiagramStage'));
    const run = draw.indexOf('mermaid.run({ nodes: [stage] })');
    const controls = draw.indexOf('addDiagramStageControls(stage)');
    if (run < 0 || controls < 0) throw new Error('the stage is no longer drawn, or gains no controls');
    if (controls < run) throw new Error('the controls go in before mermaid draws, so the draw wipes them');
    const declarations = [...fragment.matchAll(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    if (declarations.length) {
      throw new Error(`this fragment holds state a first render would read too early: ${declarations.join(', ')}`);
    }
    // Which is why the overlay is found by query, and what it has to put back is held on the element.
    if (!fragment.includes("app.querySelector('.diagram-overlay')")) {
      throw new Error('nothing finds the overlay in the page');
    }
  });

  // This sheet is a reader before it becomes an editor: it copies only a safe rendered table, and no route from opening or closing it reaches the document buffer.
  check('a full-window table is safe to open and cannot write in its first phase', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/table-sheet.js'), 'utf8');
    for (const part of ['function bindTableSheet()', 'tableWysiwygSafe(table)', 'function openTableSheet(table, opener)', 'function closeTableSheet()', 'table.cloneNode(true)', 'function scrollTableSheetHorizontally(event)', 'event.metaKey', 'dragWindowFrom(head)', "event.key !== 'Escape'"]) {
      if (!fragment.includes(part)) throw new Error(`the table sheet lost: ${part}`);
    }
    if (/\b(?:send|sendEditCommand|ipc\.postMessage)\b/.test(fragment)) {
      throw new Error('opening or closing the table sheet can still reach the document buffer');
    }
    const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
    const decorate = lib.indexOf('assets/shell/decorate.js');
    const tableSheet = lib.indexOf('assets/shell/table-sheet.js');
    const minimap = lib.indexOf('assets/shell/minimap.js');
    if (tableSheet < decorate || tableSheet > minimap) throw new Error('the table sheet is outside the fragment range its table needs');
    const dom = readFileSync(join(root, 'src/assets/shell/dom.js'), 'utf8');
    if (!dom.includes('function dragWindowFrom(bar) {')) {
      throw new Error('the full-window table header no longer borrows the app bar drag rule');
    }
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    for (const rule of ['.table-sheet-grid th,', 'border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);', 'background: var(--lt-markdown-table-header-background);', '.table-sheet-grid tr:nth-child(2n) td']) {
      if (!css.includes(rule)) throw new Error(`the table sheet no longer carries the page table treatment: ${rule}`);
    }
  });

  // The widened table's rules, read as text: none of it is reachable without a laid-out page, and every way it breaks is silent — a table back at the text measure, one grown wider than the lane it sits in, a frontmatter table dragged into the margin, or a fade that veils a column instead of pointing past it.
  const tableLaneRule = () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const opened = css.indexOf('.document-body > .table-lane {');
    if (opened < 0) throw new Error('no rule widens a table lane to the reader lane');
    return { css, rule: css.slice(opened, css.indexOf('}', opened)) };
  };

  check('Control or Command wheel scrolls only an overflowing table lane sideways', () => {
    const handlers = booted.document.getElementById('app').listeners.get('wheel') || [];
    const handler = handlers.at(-1);
    if (!handler || handlers.length < 2) throw new Error('the table or Mermaid wheel listener was not bound');
    const table = { scrollLeft: 20, scrollWidth: 400, clientWidth: 100 };
    const lane = { querySelector: (selector) => (selector === ':scope > table' ? table : null) };
    const target = {
      closest: (selector) => (selector === '.table-lane' ? lane : null),
    };
    const wheel = (changes = {}) => {
      let prevented = false;
      return {
        target,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        deltaX: 0,
        deltaY: 45,
        preventDefault() {
          prevented = true;
        },
        prevented: () => prevented,
        ...changes,
      };
    };

    const claimed = wheel();
    handler(claimed);
    if (table.scrollLeft !== 65 || !claimed.prevented()) throw new Error('a Control wheel did not move the table and claim the notch');

    for (const changes of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { deltaY: 0, deltaX: 45 }]) {
      table.scrollLeft = 20;
      const ignored = wheel(changes);
      handler(ignored);
      if (table.scrollLeft !== 20 || ignored.prevented()) throw new Error('an unclaimed wheel moved the table or stopped the browser');
    }

    table.scrollLeft = 300;
    const atEnd = wheel();
    handler(atEnd);
    if (table.scrollLeft !== 300 || !atEnd.prevented()) throw new Error('a table end let a claimed wheel escape');

    table.scrollWidth = 100;
    table.scrollLeft = 20;
    const narrow = wheel();
    handler(narrow);
    if (table.scrollLeft !== 20 || narrow.prevented()) throw new Error('a table without sideways overflow claimed the wheel');

    table.scrollWidth = 400;
    table.scrollLeft = 20;
    const diagram = fakeElement('diagram');
    diagram.dataset = {};
    diagram.querySelector = () => fakeElement('svg');
    const diagramTarget = {
      closest: (selector) => {
        if (selector === 'pre.mermaid[data-processed="true"]') return diagram;
        return selector === '.table-lane' ? lane : null;
      },
    };
    const mermaid = wheel({ target: diagramTarget, deltaY: -45 });
    handlers.forEach((bound) => bound(mermaid));
    if (table.scrollLeft !== 20 || !mermaid.prevented() || diagram.__mermaidView?.zoom <= 1) {
      throw new Error('a Mermaid wheel did not stay with Mermaid');
    }
  });

  // The inset is the room the drag handle and plus occupy, written once in the stylesheet and once in the script that places them.
  check('the table lane leaves exactly the block controls their margin', () => {
    const { css, rule } = tableLaneRule();
    if (!rule.includes('var(--reader-table-lane-inset)')) {
      throw new Error('the lane no longer keeps the block controls their strip');
    }
    const declared = css.match(/--reader-table-lane-inset:\s*(\d+)px/);
    if (!declared) throw new Error('--reader-table-lane-inset is not declared');
    const script = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    const tools = script.match(/BLOCK_TOOLS_WIDTH = (\d+)/);
    if (!tools) throw new Error('BLOCK_TOOLS_WIDTH is gone from block-controls.js');
    if (declared[1] !== tools[1]) {
      throw new Error(`the stylesheet says ${declared[1]}px and the script says ${tools[1]}px`);
    }
  });

  // A table's sliced column dissolves into the page, and what makes it safe is that a table with nothing to scroll has no timeline at all — so the bands stay at the opacity 0 they start at. A clock-driven animation would veil every table on the page, once, and never come back.
  check('a table fades its ends from its own scroll, never from a clock', () => {
    const { css, rule } = tableLaneRule();
    // The bands are on the lane and the scroll is the table's, one box down, so the timeline has to be published up for them to name it.
    if (!rule.includes('timeline-scope: --lt-table-scroll')) {
      throw new Error("the lane no longer publishes the table's scroll timeline");
    }
    for (const declaration of [
      'scroll-timeline: --lt-table-scroll inline;',
      'animation-timeline: --lt-table-scroll;',
      'opacity: 0;',
    ]) {
      if (!css.includes(declaration)) throw new Error(`the edge fade lost: ${declaration}`);
    }
    const bands = css.slice(css.indexOf('.table-lane::before,'), css.indexOf('.table-lane::before {'));
    if (/animation-duration|animation-delay/.test(bands)) {
      throw new Error('the fade has been given a clock, so it runs on a table that cannot scroll');
    }
    // The dot screen and the wash the page's own edges use, in the page's color, ramped by one mask.
    if (!bands.includes('background-attachment: fixed, scroll;')) {
      throw new Error("the band is no longer the chrome's own window-anchored lattice");
    }
    if (!css.includes('--lt-grain-dot: var(--lt-markdown-background);')) {
      throw new Error('the band draws its dots in something other than the page color');
    }
  });

  // `100cqi` with no container falls back to the viewport, which is the whole window — so a lane would grow past the reading column and under the minimap.
  check('the reader lane is still the container the table measures against', () => {
    const { css } = tableLaneRule();
    const layout = css.slice(css.indexOf('.reader-layout {'), css.indexOf('.reader-layout-no-minimap'));
    if (!/container-type:\s*inline-size/.test(layout)) {
      throw new Error('.reader-layout no longer declares container-type: inline-size');
    }
  });

  // Frontmatter scrolls on its own wrapper and a data file's table wraps its cells on purpose; neither may be pulled into a lane. The gutter reads the body's own children, so a lane with no source range is furniture it steps over and the table loses its handle.
  check('only a body table is laned, and the lane carries its source range', () => {
    const { rule } = tableLaneRule();
    if (!/transform:\s*translateX\(-50%\)/.test(rule) || !/left:\s*50%/.test(rule)) {
      throw new Error('the lane is no longer centered on its own width');
    }
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const wrap = decorate.slice(decorate.indexOf('function laneWideTables'), decorate.indexOf('function decorateBlockquoteLines'));
    if (!wrap) throw new Error('nothing wraps a table in a lane');
    for (const guard of ["tagName !== 'TABLE'", "classList.contains('data-table')", 'body.children']) {
      if (!wrap.includes(guard)) throw new Error(`the wrap no longer checks: ${guard}`);
    }
    // The lane is the reader's box, not the document's: everything that walks the body's blocks has to see through it, or an edit serializes the wrapper and finds no rows in it.
    const blocks = readFileSync(join(root, 'src/assets/shell/reading-blocks.js'), 'utf8');
    if (!blocks.includes("el.classList.contains('table-lane')")) {
      throw new Error('the range walk stamps the lane instead of the table inside it');
    }
    const controls = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if ((controls.match(/unwrapTableLane/g) || []).length < 3) {
      throw new Error('the block gutter no longer sees through the lane to the table');
    }
    // The 62px strip is measured from the reader's edge, and the gutter from the text measure — so a widened table's handle lands on its first column unless it rides the lane.
    const place = controls.slice(controls.indexOf('function positionBlockGutter'), controls.indexOf('function blockGutterAnchorY'));
    if (!place.includes(".closest('.table-lane')")) {
      throw new Error('the drag handle is anchored to the text measure, so it sits on a widened table');
    }
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWideTables();')) throw new Error('nothing calls laneWideTables on a render');
  });

  // The two halves of a node press, sliced out of the fragment the way the flowchart canvas handler is above: what each one sends is one line, and neither is reachable without a real Pixi stage.
  const nodePressBranches = () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/graph-scene.js'), 'utf8');
    const opened = fragment.indexOf('const endPress = (event) => {');
    const closed = fragment.indexOf("stage.on('pointerup', endPress)");
    if (opened < 0 || closed < opened) throw new Error('could not find the node press handler');
    const handler = fragment.slice(opened, closed);
    const external = handler.indexOf('if (!moved && node.external)');
    const document_ = handler.indexOf('} else if (!moved) {');
    if (external < 0 || document_ < external) throw new Error('the press no longer splits a web address from a document');
    return { external: handler.slice(external, document_), document: handler.slice(document_) };
  };

  // Reading a map is a loop — read a name, go there, see what that one links to — and arming the exit ended the loop on every hop, while opening the same file from the pane (`library.js`) always kept the map up. Two controls for one act, disagreeing.
  check('clicking a node opens the document and stays on the map', () => {
    const { document: forDocument } = nodePressBranches();
    if (!/send\(\{ command: 'openRecent', path: node\.path \}\)/.test(forDocument)) {
      throw new Error('the document branch no longer opens the document');
    }
    if (/graphExitPending/.test(forDocument)) throw new Error('the document branch arms the exit, so the map closes on every hop');
  });

  // The branch beside it was already the behavior the one above just gained: nothing replaced the page, so there is nothing to leave the map for.
  check('a web address opens in the browser and never moves the map', () => {
    const { external } = nodePressBranches();
    if (!/send\(\{ command: 'openExternal', url: node\.path \}\)/.test(external)) {
      throw new Error('a web address no longer opens in the browser');
    }
    if (/graphExitPending/.test(external)) throw new Error('a web address arms the exit');
  });

  // What the click now rides on: `leafSetState` hands the opened file to `followFileInLibrary`, which calls this. Its two branches are the whole behavior — a picture that is now about the wrong file is refetched, and one that already holds the node is kept and flown to. Neither is reachable through a real scene here, so the three functions it ends in are swapped for spies; they are declarations, so the booted page carries them as properties, while `graphViewOpen` and the rest are top-level `let`s and are written into the same global lexical scope a later script shares.
  check('with the map up, a new document refetches the slice or keeps the scene', () => {
    const calls = [];
    const spy = (name) => () => { calls.push(name); };
    const original = {
      requestGraphData: booted.requestGraphData,
      applyGraphStyles: booted.applyGraphStyles,
      focusGraphNode: booted.focusGraphNode,
    };
    booted.requestGraphData = spy('refetch');
    booted.applyGraphStyles = spy('recolor');
    booted.focusGraphNode = spy('fly');
    try {
      const setUp = (path, held) => {
        calls.length = 0;
        vm.runInContext(
          `currentState = { recent: [], tabs: [{ path: ${JSON.stringify(path)} }], active: 0, document: {} };` +
            'graphViewOpen = true; graphScope = \'small\'; activeVaultId = 0;' +
            `graphScene = { nodeByPath: new Map(${JSON.stringify(held.map((p) => [p, { path: p }]))}) };` +
            `graphSeedKey = ${JSON.stringify(held.length ? 'small|' + path : 'small|somewhere/else.md')};`,
          booted,
        );
      };

      // A document the scene never drew: the seeds changed, so the map in memory is of the file you left.
      setUp('notes/new.md', []);
      booted.graphSetActive('notes/new.md', true);
      if (calls.join(',') !== 'refetch') throw new Error(`a document off the map gave ${calls.join(',') || 'nothing'}`);

      // A document already on it: keep the picture, move the highlight, fly the camera.
      setUp('notes/held.md', ['notes/held.md']);
      booted.graphSetActive('notes/held.md', true);
      if (calls.join(',') !== 'recolor,fly') throw new Error(`a document on the map gave ${calls.join(',') || 'nothing'}`);
    } finally {
      Object.assign(booted, original);
    }
  });

  // The rail's thumbnail is a clone of one slice of the document, and this comparison decides whether the slice on the page still holds what the rail shows. A no asks for another rebuild, on the next animation frame, and a rebuild deep-clones the slice — so a no that can never become a yes is about a gigabyte a minute until the page dies. Numbers here are a real document's: 13,142px tall, scaled to a tenth.
  check('the thumbnail counts as covering the view at the top and the foot', () => {
    const { minimapWindowCoversView } = booted;
    const metrics = { scrollable: 12322, scaledDocumentHeight: 1314.2, trackHeight: 700, previewScale: 0.1 };
    const covers = (range, scrollTop) => {
      vm.runInContext(`minimapBuiltRange = ${range === null ? 'null' : JSON.stringify(range)};`, booted);
      return minimapWindowCoversView(metrics, scrollTop);
    };
    try {
      const ends = { top: 0, bottom: 13142 };
      if (!covers(ends, 0)) throw new Error('a thumbnail holding the whole document still rebuilt at the top');
      if (!covers(ends, 12322)) throw new Error('a thumbnail holding the whole document still rebuilt at the foot');
      // Measured off the rows alone, which is what shipped: the first block starts below the layout's padding and the last ends above it, so the view reaches past both ends of the clone and neither end can ever agree.
      const rowsOnly = { top: 87.85, bottom: 13058 };
      if (covers(rowsOnly, 0) || covers(rowsOnly, 12322)) throw new Error('the rows-only range passes now, so this proves nothing');
      // A slice out of the middle still rebuilds when the reader leaves it, and still does not when they have not.
      const middle = { top: 3000, bottom: 10100 };
      if (covers(middle, 0)) throw new Error('a scroll above the built slice stopped rebuilding');
      if (covers(middle, 12322)) throw new Error('a scroll below the built slice stopped rebuilding');
      if (!covers(middle, 6161)) throw new Error('a view inside the built slice rebuilt anyway');
      // A short document is not windowed, so there is no slice to leave.
      if (!covers(null, 0)) throw new Error('a document with no window asked for a rebuild');
    } finally {
      vm.runInContext('minimapBuiltRange = null;', booted);
    }
  });

  // The keep-it half. This answers without asking the guard at all, which is the whole point: a guard that starts failing again for some later reason costs one comparison rather than a rebuild every frame for as long as the window is open.
  check('a rebuild that would clone the same rows keeps the thumbnail', () => {
    const { minimapRebuildWouldChangeNothing } = booted;
    const metrics = { sourceWidth: 800 };
    const built = (extra = '') => vm.runInContext(
      'minimapContentVersion = 7; minimapBuiltVersion = 7; minimapBuiltSourceWidth = 800;'
        + 'minimapBuiltPreviewWidth = 90; minimapBuiltFrameWidth = 760;'
        + `minimapBuiltFirstRow = 12; minimapBuiltLastRow = 40;${extra}`,
      booted,
    );
    try {
      built();
      if (!minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40)) throw new Error('an untouched document rebuilt its thumbnail anyway');
      // Everything that shapes a clone still forces one.
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 13, 40)) throw new Error('a scroll into a new slice kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 41)) throw new Error('a slice ending on a new row kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 91, 760, 12, 40)) throw new Error('a wider rail kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 800, 12, 40)) throw new Error('more room for the layout kept the old thumbnail');
      if (minimapRebuildWouldChangeNothing({ sourceWidth: 900 }, 90, 760, 12, 40)) throw new Error('a rewrapped document kept the old thumbnail');
      built('minimapContentVersion = 8;');
      if (minimapRebuildWouldChangeNothing(metrics, 90, 760, 12, 40)) throw new Error('an edited document kept the old thumbnail');
    } finally {
      vm.runInContext(
        'minimapContentVersion = 0; minimapBuiltVersion = -1; minimapBuiltSourceWidth = -1;'
          + 'minimapBuiltPreviewWidth = -1; minimapBuiltFrameWidth = -1;'
          + 'minimapBuiltFirstRow = -1; minimapBuiltLastRow = -1;',
        booted,
      );
    }
  });

  // The rail's thumbnail is a clone of the page, and inserting a clone that holds an open <details> makes the browser fire `toggle` on it. The listener is on the document, so the rail heard its own thumbnail land, called that a change to the document and rebuilt — 29 rebuilds in 30 frames with nothing scrolling, and the wheel had no free frame to answer in.
  check('a section opening inside the rail is not the document changing', () => {
    const version = () => vm.runInContext('minimapContentVersion', booted);
    const raise = (target) => {
      const before = version();
      for (const handler of booted.document.listeners.get('toggle') || []) handler({ target });
      return version() - before;
    };
    // The cloned outline is inside the rail and inside a cloned .document-body, which is the whole difficulty: only the first of those tells it apart from the page.
    const inRail = { closest: (selector) => (selector === '.document-minimap' || selector === '.document-body' ? {} : null) };
    const inPage = { closest: (selector) => (selector === '.document-body' ? {} : null) };
    try {
      if (raise(inRail) !== 0) throw new Error('the rail rebuilt its thumbnail because its own clone landed');
      if (raise(inPage) === 0) throw new Error('a reader opening a section in the page no longer restates the thumbnail');
    } finally {
      // The page-side toggle asked for a rebuild, which is the point of it; drop that request rather than running it against a stand-in page with no document in it.
      vm.runInContext('minimapContentVersion = 0; if (minimapPreviewFrame) { window.cancelAnimationFrame(minimapPreviewFrame); minimapPreviewFrame = 0; }', booted);
    }
  });

  // Why that guard cannot be keyed on the reading body: the clone is made with cloneNode, so it carries the class it was cloned from, and stripping takes ids, textareas and links off it and never a class.
  check('the thumbnail carries the reading body class, so that class cannot tell it from the page', () => {
    const body = node('div', { className: 'document-body', children: [node('details', { className: 'document-outline' })] });
    const clone = body.cloneNode();
    booted.stripMinimapClone(clone);
    if (!clone.classList.contains('document-body')) throw new Error('the clone lost the reading body class, so this proves nothing');
    if (!clone.classList.contains('document-minimap-preview')) throw new Error('the clone is not marked as the rail’s own');
  });

  // The other listener that hears the document change watches the reading view's own body, and the clone lands in the rail beside it — so a landing clone was never something that watcher could see, and the toggle guard above is the only thing standing between the rail and its own thumbnail. Both halves are where the markup puts them, which is what this holds.
  check('the rail sits outside the body the thumbnail watches', () => {
    const page = pageMarkup();
    const opened = page.indexOf('<main id="app"');
    const closed = page.indexOf('</main>', opened);
    if (opened < 0 || closed < 0) throw new Error('the reading view is not a <main id="app"> any more');
    if (page.slice(opened, closed).includes('readerMinimap')) throw new Error('the rail moved inside the reading view, so its clone lands where the watcher can see it');
    const fragment = readFileSync(join(root, 'src/assets/shell/minimap.js'), 'utf8');
    if (!/function minimapSourceElement\(\) \{\s*return app\.querySelector\('\.document-body'\);/.test(fragment)) throw new Error('the thumbnail no longer clones the reading view’s own body');
    if (!/minimapBodyObserver = new MutationObserver\(invalidateMinimapPreview\);\s*minimapBodyObserver\.observe\(source, \{/.test(fragment)) throw new Error('the watcher is no longer bound to the element the thumbnail is cloned from');
  });

  // Placing the box runs every frame of every scroll, and a custom property inherits — so writing one on the rail re-resolves style across the whole clone hanging under it, which measured 78ms a write against 0.13ms for writing onto the element that draws. Neither `transform` nor `top` inherits, so neither reaches the clone at all.
  check('the box and the thumbnail are placed by writing to themselves', () => {
    const styled = () => ({ style: { setProperty() { throw new Error('a custom property was written on the rail'); } } });
    const content = styled();
    const viewport = styled();
    const rail = Object.assign(styled(), {
      querySelector: (selector) => (selector === '.document-minimap-content' ? content : selector === '.document-minimap-viewport' ? viewport : null),
    });
    const metrics = { scaledDocumentHeight: 2000, trackHeight: 700, scrollable: 12322, scrollTop: 0, viewportHeight: 800, previewScale: 0.05 };
    booted.placeMinimapViewport(rail, metrics, 6161);
    if (!/^translateY\(-?\d/.test(content.style.transform || '')) throw new Error(`the thumbnail lane was not slid by its own transform: ${content.style.transform}`);
    if (!/px$/.test(viewport.style.top || '') || !/px$/.test(viewport.style.height || '')) throw new Error('the box was not placed and sized on itself');
  });

  // Nothing in the page may put itself straight back on the frame queue: a job that does keeps the window drawing for as long as its condition holds, and the condition here is a 600ms pane motion. Draining has to reach a fixed point, and the pane finishing is what asks again.
  check('the rail waits for the library pane instead of asking every frame', () => {
    const frames = booted.__frames;
    const body = booted.document.body;
    const wasClass = body.className;
    try {
      frames.drain();
      body.className = 'is-library-opening';
      booted.scheduleMinimapWidthSync();
      const ran = frames.drain();
      if (ran !== 1) throw new Error(`one request for the rail's width ran ${ran} frames`);
      body.className = '';
      booted.endLibraryMotion();
      if (frames.drain() !== 1) throw new Error('the pane finishing its motion never asked for the width it held back');
    } finally {
      body.className = wasClass;
      frames.drain();
    }
  });
}

// ---- 4. the first-run bubble ------------------------------------------------

// Two things nothing else can catch: a hint that keeps coming back after it was met (the fatigue the whole thing exists to avoid), and a bubble placed off the window. Both are arithmetic and flags, so both are reachable here.

if (booted) {
  /** A recording page: every element the bubble builds keeps its classes, styles and listeners, and every command it sends is captured. */
  function hintHarness() {
    const sent = [];
    const built = [];
    const original = {
      createElement: booted.document.createElement,
      appendChild: booted.document.body.appendChild,
      postMessage: booted.ipc.postMessage,
    };
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.document.createElement = (tag) => {
      const element = fakeElement(tag);
      const classes = new Set();
      const listeners = new Map();
      Object.assign(element, {
        classes,
        listeners,
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          toggle() {},
          contains: (name) => classes.has(name),
        },
        style: { left: '', top: '', properties: {}, setProperty(name, value) { this.properties[name] = value; }, removeProperty() {}, getPropertyValue: () => '' },
        addEventListener: (name, handler) => listeners.set(name, handler),
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      });
      // One set behind both ways of naming a class, because the page uses both: the bubble is built with `className` and then placed with `classList`.
      Object.defineProperty(element, 'className', {
        get: () => [...classes].join(' '),
        set: (value) => {
          classes.clear();
          String(value).split(/\s+/).forEach((name) => name && classes.add(name));
        },
      });
      built.push(element);
      return element;
    };
    booted.document.body.appendChild = (child) => child;
    return { sent, built, restore: () => {
      booted.document.createElement = original.createElement;
      booted.document.body.appendChild = original.appendChild;
      booted.ipc.postMessage = original.postMessage;
    } };
  }

  /** The bubbles among what was built, newest last. The text span and the chevron are built too. */
  const bubbles = (built) => built.filter((element) => element.classes && element.classes.has('hint-bubble'));
  const hintStates = (sent) => sent.filter((message) => message.command === 'setHintState');

  check('the vault hint shows once, and being met is permanent', () => {
    const { sent, built, restore } = hintHarness();
    try {
      booted.leafResetHints();
      // library.js registers it as it loads, so this is the real hint against the real button — with a rectangle, which the fake page's elements otherwise lack.
      const button = booted.document.getElementById('libraryVaultSwitch');
      if (!button) throw new Error('the page has no vault switch to point at');
      button.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
      // The real page's element takes no listeners, so record the pointer watch the bubble puts on it.
      const watches = new Map();
      button.addEventListener = (name, handler) => watches.set(name, handler);
      button.removeEventListener = (name) => watches.delete(name);

      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error(`the first launch drew ${bubbles(built).length} bubbles`);
      const bubble = bubbles(built)[0];
      const words = bubble.children.map((child) => child.textContent).join('');
      if (!words.includes('folder the list below shows')) throw new Error(`the bubble said "${words}"`);
      // The button sits low on the left, so the only side with room is to its right.
      if (!bubble.classes.has('is-right')) throw new Error(`placed ${[...bubble.classes].join(' ')}`);
      let state = hintStates(sent).pop();
      if (!state) throw new Error('the launch was not reported to the host');
      if (state.launches !== 1 || state.lastLaunch !== 1) throw new Error(`counted ${state.launches}/${state.lastLaunch}`);
      if (state.seen.length !== 0) throw new Error('showing a hint is not meeting it');

      // Crossing the bubble is not noticing the control, and the words must not be taken away mid-sentence — so the box itself watches nothing.
      if (bubble.listeners.size !== 0) throw new Error(`the bubble listens for ${[...bubble.listeners.keys()].join(',')}`);

      // The pointer reaching the control is the reader noticing, and it is met right then rather than when the pointer leaves — a launch that ends with the pointer on the button has still spent the hint.
      const enter = watches.get('pointerenter');
      if (typeof enter !== 'function') throw new Error('nothing watches the pointer reaching the control');
      enter();
      state = hintStates(sent).pop();
      if (!state.seen.includes('libraryVault')) throw new Error(`met hints were ${JSON.stringify(state.seen)}`);
      if (watches.has('pointerenter')) throw new Error('the pointer watch outlived the bubble');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('a met hint came back on the next launch');

      // The other way of meeting it: the button was pressed, which is what library.js calls.
      booted.leafResetHints();
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the reset did not put the hint back');
      booted.retireHint('libraryVault');
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('using the control did not retire the hint');

      // Nothing to point at draws nothing, and does not spend the launch: the next launch with the pane open gets it instead.
      booted.leafResetHints();
      button.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('a bubble pointed at something off screen');
      if (hintStates(sent).length !== 0) throw new Error('a launch with nothing to point at was spent');
    } finally {
      booted.leafResetHints();
      restore();
    }
  });

  // Only one hint ships, so a pacing check with nothing to pace against passes by having no second hint to hold back — green, and proving nothing. This registers its own.
  check('a launch rests between bubbles, and meeting one early frees nothing sooner', () => {
    const { sent, built, restore } = hintHarness();
    try {
      booted.leafResetHints();
      const button = booted.document.getElementById('libraryVaultSwitch');
      button.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
      const second = fakeElement('secondTarget');
      second.getBoundingClientRect = () => ({ left: 400, top: 40, right: 440, bottom: 66, width: 40, height: 26 });
      booted.registerHint('checkPacing', () => second, 'A second hint, registered by the check.');
      const words = (element) => element.children.map((child) => child.textContent).join('');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the first launch drew no bubble');
      if (!words(bubbles(built)[0]).includes('folder the list below shows')) throw new Error('the first launch drew the wrong hint');

      // Met at once, while its own bubble is still up. The second hint is now unseen and available, and it must still wait.
      booted.retireHint('libraryVault');

      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('two bubbles arrived back to back');
      const rest = hintStates(sent).pop();
      if (!rest || rest.launches !== 2) throw new Error(`the rest launch was not counted: ${JSON.stringify(rest)}`);
      if (rest.lastLaunch !== 1) throw new Error('a launch that showed nothing moved the pacing mark');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the launch after the rest drew nothing');
      if (!words(bubbles(built)[0]).includes('registered by the check')) throw new Error('the second hint did not follow');
    } finally {
      booted.leafResetHints();
      restore();
    }
  });

  check('the bubble takes the first side that fits the window whole', () => {
    const view = { width: 1080, height: 820 };
    const size = { width: 260, height: 60 };
    const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
    const side = (target, at = view) => booted.hintPlacement(target, size, at).side;

    // Room on the right is the first choice, wherever else there is room too.
    if (side(box(20, 400, 32, 26)) !== 'right') throw new Error('a target with room to its right went elsewhere');
    // Against the right edge it flips rather than being clipped or squeezed.
    if (side(box(1040, 400, 32, 26)) !== 'left') throw new Error('a target at the right edge did not flip left');
    // No room either side — a full-width target — so it goes above, then below.
    if (side(box(14, 400, 1052, 26)) !== 'above') throw new Error('a wide target did not go above');
    if (side(box(14, 20, 1052, 26)) !== 'below') throw new Error('a wide target near the top did not go below');

    // The cross axis is clamped inside the margin, and the chevron then follows the target rather than the box: 19px down a 60px-tall bubble whose own center is 30.
    const high = booted.hintPlacement(box(20, 20, 32, 26), size, view);
    if (high.top !== 14) throw new Error(`the bubble was not held off the top edge: ${high.top}`);
    if (high.tail !== 19) throw new Error(`the chevron lost the target: ${high.tail}`);

    // A window too small for any side still puts the box on screen rather than off it.
    const tiny = booted.hintPlacement(box(10, 10, 40, 40), size, { width: 200, height: 120 });
    if (tiny.left < 14 || tiny.top < 14) throw new Error(`the bubble went off a small window: ${tiny.left},${tiny.top}`);
  });

  check('a folded button goes back to the container it was actually standing in', () => {
    // Every candidate's home is read off the page, never named a second time in the list. Naming it left the Mac's three dots in the menu for good: dom.js had already moved them to the bar's left end, the list still said the trailing group, and widening the window put back only what that group remembered holding. Quitting was the only way out.
    const source = readFileSync(join(root, 'src/assets/shell/overflow.js'), 'utf8');
    const list = source.slice(source.indexOf('const overflowCandidates = ['), source.indexOf('].filter('));
    if (!list.includes('home: windowControls && windowControls.parentElement')) {
      throw new Error('the window buttons must take their home from where they are standing');
    }
    // Their home decides the other half too: folding out of the bar's left zone frees nothing while an open pane pins it to the rail's width, and that is true of the dots exactly when they are in it.
    if (!list.includes('inLead: !!windowControls && windowControls.parentElement === appBarLead')) {
      throw new Error('whether the window buttons sit in the pinned zone must be read, not assumed');
    }
  });

  check('the chevron menu is laid out in its own order, with the window buttons at the foot', () => {
    const panel = booted.document.getElementById('appOverflowPanel');
    const tabBar = booted.document.getElementById('tabBar');
    const original = { prepend: panel.prepend, appendChild: panel.appendChild, children: panel.children };
    // Real list semantics for the panel: the fold moves elements into it, and the order they come to rest in is the whole claim — a string in the stylesheet cannot say it.
    const inside = [];
    const move = (child) => {
      const at = inside.indexOf(child);
      if (at >= 0) inside.splice(at, 1);
      child.parentElement = panel;
      return child;
    };
    Object.assign(panel, {
      children: inside,
      prepend: (child) => inside.unshift(move(child)),
      appendChild: (child) => inside.push(move(child)) && child,
    });
    Object.defineProperty(panel, 'childElementCount', { get: () => inside.length, configurable: true });
    // A strip that can never fit, so every candidate folds.
    tabBar.scrollWidth = 900;
    tabBar.clientWidth = 100;
    // The window's own three, revealed the way a native frame reveals them: the markup ships them hidden, so the order they take in the menu is only ever a question once something has drawn them.
    const shipped = booted.document.getElementById('windowControls');
    shipped.hidden = false;
    try {
      booted.refitAppBar();
      const order = inside.map((el) => el.id);
      // Back leads because a reader opens this menu to go back a page; the window buttons are last, so close is not the first thing under the pointer. They fold last of all, which is exactly why inserting as they left put them on top.
      const expected = ['backButton', 'forwardButton', 'themeSheetOpen', 'openButton', 'newButton', 'windowControls'];
      if (order.join(',') !== expected.join(',')) {
        throw new Error(`the menu came out as ${order.join(',')}, not ${expected.join(',')}`);
      }

      // A hidden item is skipped by the fold, so the menu is the rest in the same order with nothing empty left at its foot. Both platforms draw these three now, so this is the update bell's case rather than the Mac's — it is only ever there when there is something to install.
      const controls = booted.document.getElementById('windowControls');
      controls.hidden = true;
      // Stand in for the unfold: the fake page's containers were empty when the fragment recorded them, so the real refit's first step has nothing to move back out.
      inside.length = 0;
      for (const el of [controls, booted.document.getElementById('backButton'), booted.document.getElementById('forwardButton')]) el.parentElement = null;
      booted.refitAppBar();
      const withoutControls = inside.map((el) => el.id);
      controls.hidden = false;
      if (withoutControls.join(',') !== expected.slice(0, -1).join(',')) {
        throw new Error(`with the buttons hidden the menu came out as ${withoutControls.join(',')}`);
      }

      // Widening the window puts every one of them back where it was standing. The Mac's dots stayed in the menu until the app was quit, because the fold was told their container rather than reading it, and the one it was told no longer held them.
      inside.length = 0;
      tabBar.scrollWidth = 0;
      tabBar.clientWidth = 900;
      booted.refitAppBar();
      if (inside.length) {
        throw new Error(`a wide bar left ${inside.map((el) => el.id).join(',')} in the menu`);
      }
      for (const el of [controls, booted.document.getElementById('backButton')]) {
        if (!el.parentElement || el.parentElement === panel) {
          throw new Error(`${el.id} did not go back to the bar`);
        }
      }
    } finally {
      delete panel.childElementCount;
      Object.assign(panel, original);
      shipped.hidden = true;
      tabBar.scrollWidth = 0;
      tabBar.clientWidth = 0;
    }
  });

  /** A button, at the owner's window at its narrowest: every control on the bar is this wide, and the window buttons are three of them. */
  const BAR_BUTTON = 32;
  /** The page across, at the smallest window the app allows. */
  const BAR_WIDTH = 366;

  /** The bar measured the way a window measures it: scrollWidth is what is still standing on it, so a fold frees real width and the chevron costs its own — which is the whole reason a pass can measure wrong. */
  function measuredAppBar() {
    const bar = booted.document.getElementById('appBar');
    const panel = booted.document.getElementById('appOverflowPanel');
    const tabBar = booted.document.getElementById('tabBar');
    const foldable = ['windowControls', 'backButton', 'forwardButton', 'themeSheetOpen', 'openButton', 'newButton'].map((id) => booted.document.getElementById(id));
    // What the bar keeps whatever folds — the leaf, the library button, the empty strip and its own padding. Chosen so folding two lands the bar exactly on its width, which is where a single pass stopped in the live window with close still off the edge.
    const FURNITURE = 174;
    const chevronUp = () => vm.runInContext('overflowChevronUp', booted);
    const width = (el) => (el.id === 'windowControls' ? BAR_BUTTON * 3 : BAR_BUTTON);
    const standing = () => foldable.filter((el) => el.parentElement !== panel);
    Object.defineProperty(panel, 'childElementCount', { get: () => panel.children.length, configurable: true });
    Object.defineProperty(bar, 'scrollWidth', {
      get: () => FURNITURE + standing().reduce((sum, el) => sum + width(el), 0) + (chevronUp() ? BAR_BUTTON : 0),
      configurable: true,
    });
    bar.clientWidth = BAR_WIDTH;
    // The case this is all about: nothing open, so the strip is empty — and an empty strip reports no overflow, which is why it cannot be the only thing asked.
    tabBar.scrollWidth = 24;
    tabBar.clientWidth = 24;
    // Every run starts with the chevron down, whatever an earlier check left behind.
    vm.runInContext('overflowChevronUp = false;', booted);
    const folded = () => panel.children.map((el) => el.id);
    return {
      bar,
      panel,
      folded,
      standing: () => standing().map((el) => el.id),
      done() {
        bar.clientWidth = 0;
        tabBar.scrollWidth = 0;
        tabBar.clientWidth = 0;
        delete bar.scrollWidth;
        bar.scrollWidth = 0;
        // Puts every button back on the bar before the next check reads the page.
        booted.refitAppBar();
        delete panel.childElementCount;
      },
    };
  }

  check('a bar wider than its own window folds, even with a tab strip that cannot overflow', () => {
    const bar = measuredAppBar();
    try {
      booted.refitAppBar();
      if (!bar.folded().length) {
        throw new Error('a bar 430 across a 366-wide window folded nothing');
      }
      if (bar.bar.scrollWidth > BAR_WIDTH) {
        throw new Error(`the bar was left at ${bar.bar.scrollWidth} in a ${BAR_WIDTH}-wide window`);
      }
    } finally {
      bar.done();
    }
  });

  check('a bar that fits folds nothing, so the fold cannot pass by folding always', () => {
    const bar = measuredAppBar();
    try {
      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      if (bar.folded().length) {
        throw new Error(`a bar with room to spare folded ${bar.folded().join(',')}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the refit measures again when it was the pass that raised the chevron', () => {
    const bar = measuredAppBar();
    try {
      // One pass alone stops the moment the bar fits, and it fits before the chevron it is about to raise is standing on it.
      booted.foldAppBar();
      const onePass = bar.folded();
      if (onePass.length !== 2) {
        throw new Error(`a single pass folded ${onePass.join(',') || 'nothing'}, expected two`);
      }
      if (bar.bar.scrollWidth <= BAR_WIDTH) {
        throw new Error('the chevron cost the bar nothing, so this proves nothing about a second pass');
      }

      // The refit, from the chevron down: the second pass measures a bar the chevron is on and folds the one more that takes.
      vm.runInContext('overflowChevronUp = false;', booted);
      booted.refitAppBar();
      const settled = bar.folded();
      if (settled.length !== 3) {
        throw new Error(`the refit folded ${settled.join(',')}, expected one more than a single pass`);
      }
      if (bar.bar.scrollWidth > BAR_WIDTH) {
        throw new Error(`two passes left the bar at ${bar.bar.scrollWidth}`);
      }

      // And it is two, not the start of a run: the chevron is up now, so a further refit folds exactly the same three.
      booted.refitAppBar();
      if (bar.folded().join(',') !== settled.join(',')) {
        throw new Error(`a third pass changed the fold to ${bar.folded().join(',')}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the fold runs out of work with the window buttons still on the bar', () => {
    const bar = measuredAppBar();
    try {
      booted.refitAppBar();
      // They are first in the list and the loop walks it backwards, so they are the last thing it would reach — closing the window stays one press.
      if (!bar.standing().includes('windowControls')) {
        throw new Error('the window buttons folded into the menu');
      }
    } finally {
      bar.done();
    }
  });
}

// ---- 4b. a published site is not an install ---------------------------------
//
// The browser draws its own Back one row above the app's and hands the reader its own history, so a site draws neither of the app's; and a first-run bubble is a once-per-install promise, which a reader landing on one page of a site has not made. Both come out of the page rather than being hidden in it.

/** A boot with every command it sends captured, and the vault switch given a real rectangle — the fake page's elements have none, and a hint never points at something with no box. */
function siteBoot(site) {
  const sent = [];
  const context = runShell(source, {
    __leafSite: site,
    ipc: { postMessage: (text) => sent.push(JSON.parse(text)) },
  });
  const switcher = context.document.getElementById('libraryVaultSwitch');
  if (switcher) {
    switcher.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
  }
  context.runHintPass();
  const surface = context.document.getElementById('appSurface');
  const bubbles = surface.children.filter((child) => String(child.className || '').includes('hint-bubble'));
  return { context, sent, bubbles };
}

check('a published site draws no Back, no Forward, no window buttons and no first-run bubble', () => {
  const site = siteBoot(true);
  for (const id of ['backButton', 'forwardButton']) {
    if (site.context.document.getElementById(id)) throw new Error(`a site still has ${id} standing in the bar`);
  }
  if (site.context.document.querySelector('.history-actions')) throw new Error('a site still has the history strip in the bar');
  // Never drawn in a browser: the page ships them hidden and only a native window frame reveals them.
  if (site.context.document.getElementById('windowControls').hidden !== true) {
    throw new Error("a site revealed the window's own minimize, maximize and close");
  }
  if (site.context.nextHint()) throw new Error('a site registered a first-run bubble');
  if (site.bubbles.length) throw new Error(`a site drew ${site.bubbles.length} first-run bubbles`);
  if (site.sent.some((message) => message.command === 'setHintState')) {
    throw new Error('a site counted a launch of an app nobody installed');
  }

  // The desktop is untouched: both buttons, and the bubble it has always shown on a first launch.
  const desktop = siteBoot(false);
  for (const id of ['backButton', 'forwardButton']) {
    if (!desktop.context.document.getElementById(id)) throw new Error(`the desktop lost ${id}`);
  }
  if (desktop.bubbles.length !== 1) throw new Error(`a desktop first launch drew ${desktop.bubbles.length} first-run bubbles`);

  // The same three window buttons, revealed the moment there is a native frame to draw them for — the mechanism the site flag copies.
  const framed = runShell(source, { __leafFrameless: true });
  if (framed.document.getElementById('windowControls').hidden !== false) {
    throw new Error('a frameless window did not reveal its own three buttons');
  }
});

// A folder on a disk is not a browser's to pick, which is why both hosts refuse the command that makes a vault. Drawing the button anyway would be a control whose only possible answer is no.
check('neither browser host invites a reader to add a folder it cannot reach', () => {
  const hosts = [
    ['a published site', siteBoot(true).context],
    ['an embed', runShell(source, { __leafEmbedded: true })],
  ];
  for (const [name, context] of hosts) {
    context.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
    context.__frames.drain();
    const markup = context.document.getElementById('app').innerHTML;
    if (markup.includes('primary-vault') || markup.includes('empty-vault-help')) {
      throw new Error(`${name} drew a button its host refuses: ${markup.slice(0, 400)}`);
    }
    // The third one gone, not the row: what a browser can answer is still standing.
    if (!markup.includes('primary-open') || !markup.includes('primary-new')) {
      throw new Error(`${name} lost the two actions the screen has always had: ${markup.slice(0, 400)}`);
    }
  }
});

check("a site cancels no mouse back gesture, and the fold and the disabled pass cope with the strip gone", () => {
  const site = siteBoot(true);
  const press = (context, button) => {
    let prevented = false;
    for (const handler of [...(context.__windowListeners.get('mousedown') || [])]) {
      handler({ button, target: context.document.body, preventDefault: () => (prevented = true) });
    }
    return prevented;
  };
  // The mouse's own back and forward buttons. On a site the browser handles them itself, which it cannot do if the page cancels the event first — which is why the strip is removed rather than hidden.
  if (press(site.context, 3) || press(site.context, 4)) {
    throw new Error("a site canceled the mouse's own back gesture, which the browser would have handled itself");
  }
  if (site.sent.some((message) => message.command === 'goBack' || message.command === 'goForward')) {
    throw new Error('a site sent a history command no site host answers');
  }
  // Both of these reach for the strip. With it gone they have to run rather than throw: the fold would otherwise move two missing buttons into the chevron menu, and the disabled pass runs on every render.
  site.context.refitAppBar();
  site.context.leafSetNavigation({ canGoBack: true, canGoForward: true });

  // The desktop still answers it, because there the strip is the app's own.
  const desktop = siteBoot(false);
  if (!press(desktop.context, 3)) throw new Error("the desktop stopped taking the mouse's own back button");
  if (!desktop.sent.some((message) => message.command === 'goBack')) {
    throw new Error("the desktop's mouse back button sent nothing");
  }
});

/** A site or desktop boot standing on one document, so the trail and the strip can both be read. `document: null` keeps the home screen's cheap render — what is being proved is the bar, and the trail's chain comes off the active tab either way. */
function bootedWithDocument(site, path) {
  const booted = siteBoot(site);
  booted.context.leafSetLibraryFolder({ path: 'docs/guide', chain: [{ name: 'docs', path: 'docs' }, { name: 'guide', path: 'docs/guide' }], rootName: 'Emptyguru', entries: [] });
  booted.context.leafSetState({ recent: [], favorites: [], tabs: [{ path, title: path }], active: 0, document: null });
  return booted;
}

check('a published site draws the folder trail in the bar and no tab', () => {
  const site = bootedWithDocument(true, 'docs/guide/README.md');
  const strip = site.context.document.getElementById('tabBar');
  const trail = site.context.document.getElementById('libraryCrumbTrail');
  if (!strip.children.includes(trail)) throw new Error("a site's trail is not standing in the room the tab strip holds");
  if (strip.innerHTML.includes('class="tab')) throw new Error(`a site wrote a tab into the bar: ${strip.innerHTML}`);

  // The chain is the open document's own path, not the folder the pane is showing: they part company the moment a link is followed, and the trail at the top must say where the page is.
  const chain = site.context.siteCrumbChain();
  if (chain.map((one) => one.name).join('/') !== 'docs/guide/README') {
    throw new Error(`the trail names ${chain.map((one) => one.name).join('/')} rather than the document's own path`);
  }
  if (chain[1].path !== 'docs/guide') throw new Error(`a folder crumb carries ${chain[1].path}, which is not the folder it opens`);
  // Every folder is a link back to that folder; the document itself is not one.
  const drawn = trail.innerHTML;
  for (const folder of ['docs', 'guide']) {
    if (!drawn.includes(`data-crumb-path="${folder === 'docs' ? 'docs' : 'docs/guide'}"`)) {
      throw new Error(`${folder} is not a crumb that opens its own folder: ${drawn}`);
    }
  }
  if (!/<span class="library-crumb is-current"[^>]*>README<\/span>/.test(drawn)) {
    throw new Error(`the last crumb is not the document, drawn as a place rather than a link: ${drawn}`);
  }
  if (drawn.includes('>README.md<')) throw new Error('the document crumb kept its extension, which no tab label ever showed');

  // Following a link is the case the pane's own chain would get wrong: nothing on a site reveals an opened file in the pane, so the pane stays on docs/guide while the page moves. The trail has to follow the page.
  site.context.leafSetState({ recent: [], favorites: [], tabs: [{ path: 'notes/deep/two.md' }], active: 0, document: null });
  const moved = trail.innerHTML;
  if (!/is-current"[^>]*>two</.test(moved) || !moved.includes('data-crumb-path="notes/deep"')) {
    throw new Error(`the trail did not follow the document into another folder: ${moved}`);
  }

  // The desktop is untouched: a tab in the strip, and the trail still in the pane's own band on the pane's own folder.
  const desktop = bootedWithDocument(false, 'docs/guide/README.md');
  const desktopStrip = desktop.context.document.getElementById('tabBar');
  const desktopTrail = desktop.context.document.getElementById('libraryCrumbTrail');
  if (!desktopStrip.innerHTML.includes('class="tab')) throw new Error('the desktop stopped drawing its tab');
  if (desktopStrip.children.includes(desktopTrail)) throw new Error("the desktop's trail moved into the tab strip");
  if (desktopTrail.parentElement.id !== 'libraryCrumbs') throw new Error(`the desktop's trail left the pane's band for ${desktopTrail.parentElement.id}`);
  if (!/is-current"[^>]*>guide</.test(desktopTrail.innerHTML)) {
    throw new Error(`the desktop's trail stopped ending at the folder the pane is showing: ${desktopTrail.innerHTML}`);
  }
});

check('a published site draws no vault switcher, no pane trail row and no Sync button', () => {
  const site = bootedWithDocument(true, 'README.md');
  for (const id of ['libraryCrumbs', 'libraryVaultSwitch', 'librarySyncButton']) {
    if (site.context.document.getElementById(id)) throw new Error(`a site still has ${id} standing in the pane`);
  }
  // The band leaves no gap: everything under it is placed off its height, so the search row and the list come up by that one value going to zero.
  if (site.context.document.getElementById('libraryPane').style.getPropertyValue('--library-crumbs-height') !== '0px') {
    throw new Error("the pane still holds a band's worth of room open with no band in it");
  }
  // And the desktop keeps all three.
  const desktop = bootedWithDocument(false, 'README.md');
  for (const id of ['libraryCrumbs', 'libraryVaultSwitch', 'librarySyncButton']) {
    if (!desktop.context.document.getElementById(id)) throw new Error(`the desktop lost ${id}`);
  }
});

// ---- 5. the rows on the start screen ----------------------------------------

// A row on the start screen is one button carrying the path twice: `data-path` opens it, and `data-reveal-path` is the only thing the right-click menu finds a start-screen row by — so a rewritten row that dropped it would take Favorite and Reveal off the screen with nothing failing.

if (booted) {
  const { documentNameMarkup, documentNameParts, fileRowHtml, homeListsMarkup, homeRowMarkup, renderProject, searchHitHtml } = booted;

  check('document filename markup keeps a readable type badge in every row', () => {
    for (const [name, stem, extension] of [
      ['chapter.md', 'chapter', 'MD'],
      ['chapter.markdown', 'chapter', 'MARKDOWN'],
      ['data.json', 'data', 'JSON'],
      ['settings.yml', 'settings', 'YML'],
      ['message.mhtml', 'message', 'MHTML'],
      ['UPPER.MD', 'UPPER', 'MD'],
    ]) {
      const parts = documentNameParts(name);
      if (parts.stem !== stem || parts.extension !== extension) {
        throw new Error(`${name} became ${JSON.stringify(parts)} instead of ${stem} [${extension}]`);
      }
      const markup = documentNameMarkup(name);
      if (!markup.includes(`<span class="file-name-stem">${stem}</span><span class="file-type-badge">${extension}</span>`)) {
        throw new Error(`${name} did not draw its name and type together: ${markup}`);
      }
    }
    const unknown = documentNameMarkup('archive.tar.gz');
    if (unknown !== '<span class="file-name-stem">archive.tar.gz</span>') {
      throw new Error(`an unreadable extension gained a badge or lost its name: ${unknown}`);
    }
  });

  check('tabs, library, search and both Recent lists share filename markup', () => {
    booted.leafSetState({ tabs: [{ path: 'C:\\Notes\\tab.md' }], active: 0, recent: [], favorites: [], document: null });
    const tab = booted.document.getElementById('tabBar').innerHTML;
    if (!/class="tab-label"[^>]*>tab\.md<\/button>/.test(tab) || tab.includes('file-type-badge')) {
      throw new Error(`the tab did not keep its full filename without a type badge: ${tab}`);
    }
    const file = fileRowHtml({ name: 'library.yaml', path: 'C:\\Notes\\library.yaml' });
    if (!file.includes('<span class="file-name-stem">library</span><span class="file-type-badge">YAML</span>')) {
      throw new Error(`the library file did not use the filename markup: ${file}`);
    }
    const hit = searchHitHtml({ absPath: 'C:\\Notes\\search.json', title: 'search', alias: 'Other name' });
    if (!hit.includes('<span class="file-name-stem">search<span class="library-hit-alias">Other name</span></span><span class="file-type-badge">JSON</span>')) {
      throw new Error(`the search hit did not take its name and type from its path: ${hit}`);
    }
    const plain = homeListsMarkup({ recent: ['C:\\Notes\\plain.mdown'], favorites: [] });
    const paired = homeListsMarkup({ recent: ['C:\\Notes\\paired.xml'], favorites: [{ path: 'C:\\Notes\\kept.md', kind: 'document' }] });
    for (const [markup, extension] of [[plain, 'MDOWN'], [paired, 'XML']]) {
      if (!markup.includes(`<span class="file-type-badge">${extension}</span>`)) {
        throw new Error(`a Recent path did not use the filename markup: ${markup}`);
      }
      if (!markup.includes('data-reveal-path=')) throw new Error(`a Recent row dropped its full path: ${markup}`);
    }
    const folder = renderProject([{ kind: 'folder', name: 'Notes', path: 'C:\\Notes' }]);
    if (folder.includes('file-type-badge')) throw new Error(`a folder gained a file type badge: ${folder}`);
  });

  check('a home row reads as a name over its folder', () => {
    const path = 'C:\\Users\\me\\Vault\\Journal\\A note.md';
    const row = homeRowMarkup(path);
    if (!/<span class="home-row-name"><span class="file-name-stem">A note<\/span><span class="file-type-badge">MD<\/span><\/span>/.test(row)) {
      throw new Error(`the first line is not the name and type: ${row}`);
    }
    if (!/<span class="home-row-folder">C:\\Users\\me\\Vault\\Journal<\/span>/.test(row)) {
      throw new Error(`the second line is not the folder holding it: ${row}`);
    }
    // The name comes first, or the folder is what the eye lands on.
    if (row.indexOf('home-row-name') > row.indexOf('home-row-folder')) {
      throw new Error('the folder is drawn above the name');
    }
    for (const attribute of ['data-path', 'data-reveal-path']) {
      if (!row.includes(`${attribute}="C:\\Users\\me\\Vault\\Journal\\A note.md"`)) {
        throw new Error(`the row dropped ${attribute}, so nothing can find it by path`);
      }
    }
    if (!row.includes('title="Open C:\\Users\\me\\Vault\\Journal\\A note.md"')) {
      throw new Error(`the whole path is no longer the row's tooltip: ${row}`);
    }
    // A recent has nothing to unmark, so it carries one button and no heart.
    if ((row.match(/<button/g) || []).length !== 1) {
      throw new Error(`a recent row should be one button: ${row}`);
    }
  });

  check('a home row with nothing above it draws one line', () => {
    const bare = homeRowMarkup('notes.md');
    if (bare.includes('home-row-folder')) {
      throw new Error(`a path with no folder above it drew a second line: ${bare}`);
    }
    if (!/<span class="home-row-name"><span class="file-name-stem">notes<\/span><span class="file-type-badge">MD<\/span><\/span>/.test(bare)) {
      throw new Error(`a bare name lost its name: ${bare}`);
    }
    // Only a document extension comes off. A name the app cannot open keeps every character it has, or the row says a file is called something it is not.
    const kept = homeRowMarkup('/home/me/archive.tar.gz');
    if (!/<span class="home-row-name"><span class="file-name-stem">archive\.tar\.gz<\/span><\/span>/.test(kept)) {
      throw new Error(`a name with no document extension was trimmed anyway: ${kept}`);
    }
    if (!/<span class="home-row-folder">\/home\/me<\/span>/.test(kept)) {
      throw new Error(`the folder line lost its path: ${kept}`);
    }
    // A file at a root: the separator is the whole folder, so it stays rather than emptying the line.
    const root = homeRowMarkup('/notes.md');
    if (!/<span class="home-row-folder">\/<\/span>/.test(root)) {
      throw new Error(`a file at a root lost its folder line: ${root}`);
    }
  });
}

if (booted) {
  const { homeListsMarkup } = booted;

  /** Draw both lists against a made-up vault registry, then put the page's own back. Pushed through the call the host itself uses, because the registry is a `let` inside the script's own scope — nothing outside it can reach the binding, which is the same reason a test may not reach past a page's own entry points. */
  function withVaults(vaults, active, run) {
    booted.leafSetVaults({ vaults, active });
    try {
      return run();
    } finally {
      booted.leafSetVaults({ vaults: [], active: 0 });
    }
  }

  // The folder is part of a vault row wherever the host sends one, and the page needs it: a recent carries no vault of its own, so the only thing that says which vault it is in is the folder holding it.
  const VAULTS = [
    { id: 1, name: 'Dharma', rootPath: 'C:\\Vaults\\Dharma' },
    { id: 2, name: 'Work', rootPath: 'C:\\Vaults\\Work' },
  ];
  const KEPT = [
    { vaultId: 1, path: 'C:\\Vaults\\Dharma\\A sutta.md', kind: 'document' },
    { vaultId: 2, path: 'C:\\Vaults\\Work\\Standup.md', kind: 'document' },
    { vaultId: 1, path: 'C:\\Vaults\\Dharma\\Journal', kind: 'folder' },
    { vaultId: null, path: 'C:\\Users\\me\\Desktop\\Loose.md', kind: 'document' },
  ];

  check('outside a vault every vault shows at once, labeled', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
    // One per vault the kept paths name, plus one for the paths inside none — a file on the desktop is still a file you kept.
    if (groups.join('|') !== 'Dharma|Work|Outside a vault') {
      throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
    }
    if (!markup.includes('Favorites (4)')) {
      throw new Error(`the heading lost its count: ${markup}`);
    }
    // Every favorite row wears the heart, whatever it points at: the column says it is kept, and that is the fact the mark owes. It is a button, because pressing it is how a row leaves without opening the file you were trying not to open.
    const folderRow = markup.slice(markup.indexOf('data-folder-path'));
    if ((markup.match(/lt-icon-favorite-on/g) || []).length !== 4) {
      throw new Error(`a favorite row drew no heart: ${markup}`);
    }
    if (markup.includes('lt-icon-leaf') || markup.includes('lt-icon-folder')) {
      throw new Error('a favorite row is back to saying what kind of thing it points at');
    }
    if ((markup.match(/data-home-unfavorite=/g) || []).length !== 4) {
      throw new Error('a favorite row drew its heart as a mark rather than a control');
    }
    if (!markup.includes('data-home-unfavorite="C:\\Vaults\\Dharma\\Journal" data-home-kind="folder"')) {
      throw new Error(`the heart does not carry its own path and kind: ${markup}`);
    }
    if (!folderRow.startsWith('data-folder-path="C:\\Vaults\\Dharma\\Journal"')) {
      throw new Error(`the folder row does not carry its own path: ${folderRow.slice(0, 120)}`);
    }
  });

  check('inside a vault only that vault shows, with no label', () => {
    const markup = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    if (markup.includes('home-list-group')) {
      throw new Error('one group was labeled anyway — there is nothing to tell it from');
    }
    if (!markup.includes('Standup')) throw new Error("the vault you are in lost its own kept file");
    if (markup.includes('A sutta') || markup.includes('Loose')) {
      throw new Error('another vault leaked into the column');
    }
    if (!markup.includes('Favorites (1)')) throw new Error(`the count is not this vault's: ${markup}`);
  });

  const RECENT = [
    'C:\\Vaults\\Work\\Standup.md',
    'C:\\Vaults\\Dharma\\Journal\\Today.md',
    'C:\\Users\\me\\Desktop\\Loose.md',
    'C:\\Vaults\\Work\\Notes\\Roadmap.md',
  ];

  // The page's rule, held to the host's: the same four cases `a_file_is_owned_by_the_innermost_vault_that_holds_it` pins for `vault_containing` in `src/store/tests.rs`. A recent carries no vault, so this is the whole of how its column knows which one it is in.
  check('a recent belongs to the innermost vault whose folder holds it', () => {
    const nested = [
      { id: 1, name: 'Dharma', rootPath: 'C:\\Vaults\\Dharma' },
      { id: 2, name: 'Empty Guru', rootPath: 'C:\\Vaults\\Dharma\\Emptyguru' },
      { id: 3, name: 'Elsewhere', rootPath: 'C:\\Vaults\\Elsewhere' },
    ];
    const owner = (path) =>
      withVaults(nested, 0, () => {
        const vault = booted.vaultForPath(path);
        return vault ? vault.id : null;
      });
    // Nested: the innermost wins, which is the vault the file actually lives in.
    if (owner('C:\\Vaults\\Dharma\\Emptyguru\\site\\index.md') !== 2) {
      throw new Error('a file in a nested vault went to the vault around it');
    }
    // Above the inner one, still inside the outer.
    if (owner('C:\\Vaults\\Dharma\\notes.md') !== 1) throw new Error('a file above the nested vault lost its own');
    // A prefix is not a parent.
    if (owner('C:\\Vaults\\Dharma-old\\stale.md') !== null) throw new Error('a lookalike sibling folder was claimed');
    // Nothing owns a file outside every vault: that is the whole library.
    if (owner('C:\\Vaults\\loose.md') !== null) throw new Error('a file outside every vault was claimed');
    // And the same file under either spelling is the same file, off a Mac.
    if (owner('c:/vaults/dharma/notes.md') !== 1) throw new Error('another spelling of the same folder missed');
  });

  check('inside a vault Recent is that vault too, so both boxes are about one vault', () => {
    const markup = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    if (!markup.includes('Recent (2)')) throw new Error(`the count is not this vault's: ${markup}`);
    if (markup.includes('Today') || markup.includes('Loose')) {
      throw new Error(`another vault leaked into Recent: ${markup}`);
    }
    if (!markup.includes('Roadmap')) throw new Error("this vault lost a file it holds deeper down");
    // One group each, and a single group draws no label — which is what phase 2's heading answers.
    if (markup.includes('home-list-group')) throw new Error('one group was labeled anyway');
    if (!markup.includes('Favorites (1)')) throw new Error('the box beside it stopped agreeing');
  });

  check('outside a vault Recent groups by vault, with the files in none last', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    const column = markup.slice(0, markup.indexOf('Favorites ('));
    const groups = [...column.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((one) => one[1]);
    // In the order the list already had, since a recent list is a record of what happened — and the leftovers after the vaults, because they are not one.
    if (groups.join('|') !== 'Work|Dharma|Outside a vault') {
      throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
    }
    if (!markup.includes('Recent (4)')) throw new Error(`nothing is hidden outside a vault: ${markup}`);
    // The heading carries its vault, which is what the missing-folder answer is applied to.
    if (!column.includes('data-home-vault="2"')) throw new Error(`a Recent heading lost its vault: ${column}`);
  });

  check('a vault whose folder has gone marks its Recent heading as well as its Favorites one', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    const split = markup.indexOf('Favorites (');
    const recent = drawnColumn(markup.slice(0, split));
    const favorites = drawnColumn(markup.slice(split));
    answerMissing(recent, [], [1]);
    answerMissing(favorites, [], [1]);
    if (!recent.group(1).classList.contains('is-missing')) {
      throw new Error("the Recent heading said nothing while the box beside it said the folder had gone");
    }
    if (!favorites.group(1).classList.contains('is-missing')) throw new Error("the Favorites heading lost its mark");
    if (recent.group(2).classList.contains('is-missing')) throw new Error('a vault that is there was marked too');
  });

  check('with no favorites in this vault the plain list is scoped too', () => {
    const plain = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: RECENT, favorites: [] }));
    if (!plain.startsWith('<div class="recent"><h2>Recent (2)</h2><ol>')) {
      throw new Error(`the lone list is not this vault's: ${plain}`);
    }
    if (plain.includes('Today') || plain.includes('Loose')) {
      throw new Error(`the lone list showed another vault's files: ${plain}`);
    }
  });

  check('the home vault switcher opens the pane list and closes before a vault redraw', () => {
    const button = fakeElement('homeVaultSwitch');
    button.classList.add('library-vault-switch', 'home-vault-switch');
    booted.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    const event = { button: 0, stopPropagation() {}, preventDefault() {} };
    booted.leafSetVaults({ vaults: VAULTS, active: 1 });
    press(event);
    if (vm.runInContext('crumbMenu.hidden', booted) || vm.runInContext('crumbMenuOwner', booted) !== button) {
      throw new Error('the home word did not open the vault list under itself');
    }
    press(event);
    if (!vm.runInContext('crumbMenu.hidden', booted)) throw new Error('the home word did not close its open list');
    press(event);
    booted.leafSetVaults({ vaults: VAULTS, active: 2 });
    if (!vm.runInContext('crumbMenu.hidden', booted) || vm.runInContext('crumbMenuOwner', booted) !== null) {
      throw new Error('a vault redraw left a list anchored on the home word that is gone');
    }
    booted.leafSetVaults({ vaults: [], active: 0 });
  });

  check('the home vault switcher keeps the regular marks and leaves room before its name', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const home = css.split('.home-vault-switch {')[1];
    if (!home || !home.startsWith('\n  margin-left: calc(-1 * var(--lt-space-8));\n  gap: var(--lt-space-4);')) {
      throw new Error('the home switcher does not leave room between its icon and name');
    }
    if (css.includes('.home-vault-switch .lt-icon-')) {
      throw new Error('the home switcher still replaces its regular vault marks with heavier ones');
    }
  });

  check('the start screen switcher names a vault or Library, and no vaults leave the app name plain', () => {
    const screen = (active) =>
      withVaults(VAULTS, active, () => {
        booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        const drawn = booted.document.getElementById('app').innerHTML;
        booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
        booted.__frames.drain();
        return drawn;
      });
    const inside = screen(1);
    // The whole screen is that vault's, both lists included, so it is said once over everything — in the word that was already there.
    if (!inside.includes('<button type="button" class="kicker library-vault-switch home-vault-switch"') || !inside.includes('lt-icon-package-open') || !inside.includes('>Dharma</button>')) {
      throw new Error(`the word over the headline is not the vault switcher: ${inside.slice(0, 400)}`);
    }
    // And nowhere else: the lists are headed what they have always been headed.
    if (!inside.includes('<h2>Recent (1)</h2>') || !inside.includes('<h2>Favorites (2)</h2>')) {
      throw new Error(`a list heading is not the plain one it was: ${inside}`);
    }
    if (inside.includes('home-list-vault')) throw new Error('the vault is named twice on one screen');
    const library = screen(0);
    if (!library.includes('<button type="button" class="kicker library-vault-switch home-vault-switch"') || !library.includes('lt-icon-computer') || !library.includes('>Library</button>')) {
      throw new Error(`the Library start screen cannot open the vault switcher: ${library.slice(0, 400)}`);
    }
    const plain = withVaults([], 0, () => {
      booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
      booted.__frames.drain();
      return booted.document.getElementById('app').innerHTML;
    });
    if (!plain.includes('<p class="kicker">Leaftext</p>')) {
      throw new Error(`a start screen with no vaults is not the app's plain word: ${plain.slice(0, 400)}`);
    }
  });

  // The screen a new reader meets says vaults exist, and stops saying it the moment there is one — from then on the word over the headline is the switcher, and New vault… is one press inside it.
  check('with no vault the start screen offers a third way in, and it goes when a vault arrives', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    // A query on a stand-in element hands back a fresh stand-in every time, so the only way to reach the button the page really bound is to keep the one the page was handed.
    const appElement = booted.document.getElementById('app');
    const wasQuery = appElement.querySelector;
    let vaultButton = null;
    appElement.querySelector = (selector) => {
      const found = wasQuery.call(appElement, selector);
      if (String(selector) === '.primary-vault') vaultButton = found;
      return found;
    };
    const draw = () => {
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      return appElement.innerHTML;
    };
    try {
      booted.leafSetVaults({ vaults: [], active: 0 });
      const fresh = draw();
      if (!fresh.includes('<button type="button" class="primary-vault">Add your notes folder</button>')) {
        throw new Error(`a reader with no vault is never told one is possible: ${fresh.slice(0, 600)}`);
      }
      if (!fresh.includes('class="empty-vault-help"')) {
        throw new Error(`the invitation never says what a folder buys: ${fresh.slice(0, 600)}`);
      }
      // Under the row of buttons, not inside it: the row is the two ways in plus this one, and the line is about the button rather than about the columns below.
      const between = fresh.slice(fresh.indexOf('primary-vault'), fresh.indexOf('empty-vault-help'));
      if (!between.includes('</div>')) throw new Error('the line about a vault is standing inside the actions row');
      // And it is the command the pane's own menu sends, so there is no second way to make a vault.
      if (!vaultButton) throw new Error('the page never went looking for the button it drew');
      for (const handler of vaultButton.listeners.get('click') || []) handler({});
      if (!sent.some((one) => one.command === 'createVault')) {
        throw new Error(`pressing it sent ${JSON.stringify(sent.map((one) => one.command))}`);
      }

      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      const owned = draw();
      if (owned.includes('primary-vault') || owned.includes('empty-vault-help')) {
        throw new Error(`the invitation outlived the first vault: ${owned.slice(0, 600)}`);
      }
      // Because this is where it went: the name over the headline opens the list New vault… is in.
      if (!owned.includes('home-vault-switch')) {
        throw new Error('the screen has neither the invitation nor the switcher that replaces it');
      }
    } finally {
      appElement.querySelector = wasQuery;
      booted.ipc.postMessage = wasSend;
      booted.leafSetVaults({ vaults: [], active: 0 });
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('the sheet is headed the list it is, counted as the screen counted it', () => {
    const title = (active) =>
      withVaults(VAULTS, active, () => {
        booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        booted.openHomeSheet('recent');
        const said = booted.document.getElementById('homeSheetTitle').textContent;
        booted.closeHomeSheet();
        booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
        booted.__frames.drain();
        return said;
      });
    // The list it opened over, counted the way the column behind it counted: this vault's own inside one, every vault's outside them all.
    if (title(2) !== 'Recent (2)') throw new Error(`the sheet is not this vault's list: ${title(2)}`);
    if (title(0) !== 'Recent (4)') throw new Error(`the sheet hid something outside every vault: ${title(0)}`);
  });

  // The start screen really drawn, read back off the element the page writes it into — not the markup helper, because what this is about is whether anything redraws at all.
  const homeElement = booted.document.getElementById('app');
  function onTheStartScreen(favorites, run) {
    try {
      booted.window.leafSetState({ recent: [], favorites, tabs: [], active: null, document: null });
      booted.__frames.drain();
      return run(() => homeElement.innerHTML);
    } finally {
      booted.leafSetVaults({ vaults: [], active: 0 });
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  }

  check('switching vaults changes the favorites on screen', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 1 });
      if (!screen().includes('A sutta')) throw new Error(`the vault switched to lost its own kept file: ${screen()}`);
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      const markup = screen();
      if (!markup.includes('Standup')) throw new Error(`the second vault's kept file never arrived: ${markup}`);
      if (markup.includes('A sutta') || markup.includes('Loose')) {
        throw new Error(`the vault that was left is still on the screen: ${markup}`);
      }
      if (!markup.includes('Favorites (1)')) throw new Error(`the count is not this vault's: ${markup}`);
    });
  });

  check('leaving every vault brings every favorite back, grouped and labeled', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      const markup = screen();
      const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
      if (groups.join('|') !== 'Dharma|Work|Outside a vault') {
        throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
      }
      if (!markup.includes('Favorites (4)')) throw new Error(`not every favorite came back: ${markup}`);
    });
  });

  check('a vault switch never throws away what is being read', () => {
    // A tab opened straight into source: the page's copy of the state carries no document, so "is there a document" is the wrong question and only the flag answers it.
    const wasMarkup = homeElement.innerHTML;
    try {
      homeElement.innerHTML = '<div class="code-view">the source somebody is reading</div>';
      vm.runInContext('codeViewActive = true;', booted);
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      if (!homeElement.innerHTML.includes('the source somebody is reading')) {
        throw new Error(`a vault switch drew the start screen over the source view: ${homeElement.innerHTML}`);
      }
      if (!vm.runInContext('codeViewActive', booted)) {
        throw new Error('a vault switch left the page thinking the source view had closed');
      }
    } finally {
      vm.runInContext('codeViewActive = false;', booted);
      booted.leafSetVaults({ vaults: [], active: 0 });
      homeElement.innerHTML = wasMarkup;
    }
  });

  check('a vault switch keeps the sentence under the headline', () => {
    const line = (markup) => (markup.match(/<p class="empty-description">([^<]*)</) || [])[1];
    onTheStartScreen(KEPT, (screen) => {
      const before = line(screen());
      if (!before) throw new Error(`the start screen drew no sentence at all: ${screen()}`);
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      if (line(screen()) !== before) {
        throw new Error(`the sentence was reshuffled by a vault switch: ${before} became ${line(screen())}`);
      }
    });
  });

  check('a removed vault takes its favorites off the start screen with it', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      // The order the host sends them in: the shorter list first, then the registry without that vault. Backwards, the screen is drawn from rows naming a vault the registry no longer has, and every one of them lands in a second group with the same name as the real one.
      booted.window.leafSetWorkspace({
        recent: [],
        favorites: KEPT.filter((one) => one.vaultId !== 2),
        tabs: [],
        active: null,
      });
      booted.leafSetVaults({ vaults: VAULTS.filter((one) => one.id !== 2), active: 0 });
      const markup = screen();
      if (markup.includes('Standup')) throw new Error(`the removed vault left its favorite on screen: ${markup}`);
      const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
      if (groups.join('|') !== 'Dharma|Outside a vault') {
        throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
      }
    });
  });

  check('Show all appears only past what the folded layout holds, and names the count', () => {
    // With favorites, because a list on its own is the plain one this screen had before there was a pair — no box to fold and nothing to show all of.
    const short = homeListsMarkup({ recent: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], favorites: KEPT });
    // Five fit, so there is nothing the folded layout cannot already show.
    if (short.includes('data-home-list="recent"')) {
      throw new Error('a list the folded layout can hold whole grew a way out of itself');
    }
    const long = homeListsMarkup({
      recent: Array.from({ length: 24 }, (unused, index) => `C:\\Notes\\file-${index}.md`),
      favorites: KEPT,
    });
    if (!long.includes('data-home-list="recent"')) {
      throw new Error(`the button does not say which list it opens: ${long}`);
    }
    if (!long.includes('>Show all 24</button>')) {
      throw new Error(`the button does not name the count: ${long}`);
    }
  });

  check('the sheet opens on one list, reports itself, and closes on Escape', () => {
    const sheet = booted.document.getElementById('homeSheet');
    const scrim = booted.document.getElementById('homeSheetBackdrop');
    const body = booted.document.getElementById('homeSheetBody');
    // The sheet's hide runs off a transition end or the timer behind it, and neither happens on its own here — so the timer is what the check drives.
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      booted.window.leafSetState({ recent: [], favorites: KEPT, tabs: [], active: null, document: null });
      booted.__frames.drain();
      withVaults(VAULTS, 0, () => booted.openHomeSheet('favorites'));
      booted.__frames.drain();
      if (sheet.hidden) throw new Error('the sheet was opened and stayed shut');
      if (scrim.hidden) throw new Error('the sheet came up with no scrim behind it');
      if (booted.homeSheetShowing !== 'favorites') {
        throw new Error(`the sheet does not know which list it is showing: ${booted.homeSheetShowing}`);
      }
      // The same box as the column, so a list read here is the list read there — same bar, same fades.
      if (!body.innerHTML.includes('home-list-box') || !body.innerHTML.includes('A sutta')) {
        throw new Error(`the sheet was filled with something other than that list: ${body.innerHTML}`);
      }
      // The page's own answer about what is open. The ask pipe reads this, so a panel missing from it is one nothing outside the window can see.
      if (!booted.window.leafReaderState().panels.homeList) {
        throw new Error('the sheet does not report itself as an open panel');
      }

      // Escape, through the handler the sheet put on the document.
      booted.onHomeSheetKey({ key: 'Escape' });
      if (!sheet.hidden || !scrim.hidden) throw new Error('Escape left the sheet up');
      if (booted.window.leafReaderState().panels.homeList) {
        throw new Error('a shut sheet still reports itself open');
      }
    } finally {
      booted.setTimeout = wasTimeout;
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('a home list draws an edge only where there is more list past it', () => {
    /** A scroll box that really has a position and a size, and the box holding it, with the classes recorded. */
    function boxAt(scrollTop, clientHeight, scrollHeight) {
      const classes = new Set();
      const scroll = Object.assign(fakeElement('scroll'), { scrollTop, clientHeight, scrollHeight });
      let onScroll = null;
      scroll.addEventListener = (name, handler) => {
        if (name === 'scroll') onScroll = handler;
      };
      const box = Object.assign(fakeElement('box'), {
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
        querySelector: () => scroll,
      });
      booted.watchHomeList(box);
      return { classes, scroll, scrolled: () => onScroll && onScroll() };
    }

    const top = boxAt(0, 400, 900);
    if (top.classes.has('has-above')) throw new Error('a list at its first row drew a soft top edge');
    if (!top.classes.has('has-below')) throw new Error('a list with more below drew no bottom edge');

    const bottom = boxAt(500, 400, 900);
    if (!bottom.classes.has('has-above')) throw new Error('a scrolled list drew no top edge');
    if (bottom.classes.has('has-below')) throw new Error('a list at its last row drew a soft bottom edge');

    const short = boxAt(0, 400, 400);
    if (short.classes.has('has-above') || short.classes.has('has-below')) {
      throw new Error('a list that fits whole drew an edge');
    }

    // The bar over these edges is not this watcher's: it belongs to the shared one below, which serves the pane, the reader and a wide table by the same route.
    top.scrolled();
    if (top.classes.has('is-scrolling')) throw new Error('a home list still raises its own bar');
  });

  // Every bar in the app answers the scroll rather than the pointer, off one watcher: the pane, the reader with no rail, a widened table and any box marked .leaf-scroll, plus the start screen's two lists.
  check('the shared watcher raises a bar on the box that moved and takes it away when that box rests', () => {
    const classes = new Set();
    const box = Object.assign(fakeElement('scroll'), {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    });
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    let armed = null;
    let cleared = [];
    booted.setTimeout = (fn) => {
      armed = fn;
      return 42;
    };
    booted.clearTimeout = (id) => cleared.push(id);
    try {
      booted.leafMarkScrolling(box);
      if (!classes.has('is-scrolling')) throw new Error('the box moved and the bar stayed away');
      if (!armed) throw new Error('nothing was set to take the bar away again');
      // A second notch restarts that box's own timer rather than stacking another one, or a bar goes while the box is still moving.
      const first = armed;
      booted.leafMarkScrolling(box);
      if (!cleared.includes(42)) throw new Error('a second notch left the first timer running');
      if (armed === first) throw new Error('a second notch never rearmed the timer');
      armed();
      if (classes.has('is-scrolling')) throw new Error('the bar never goes once the box stops');
      // Scrolling the page itself targets the document, which has no classes to stamp.
      booted.leafMarkScrolling(booted.document);
      booted.leafMarkScrolling(null);
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
    }
  });

  // The two wearers with nothing to bind to: the reader shell, replaced by every render, and a wide table, which comes out of Markdown with nowhere to carry a class. Delegation is what covers them, so a box that did not exist at boot has to be stamped like any other, and each has to rest on its own clock.
  check('a scroller made after boot is stamped, and one box resting does not take another box’s bar', () => {
    const made = () => {
      const classes = new Set();
      return {
        classes,
        el: Object.assign(fakeElement('made-later'), {
          classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
          },
        }),
      };
    };
    const reader = made();
    const table = made();
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    const armed = [];
    const cleared = [];
    booted.setTimeout = (fn) => armed.push(fn);
    booted.clearTimeout = (id) => {
      if (id !== undefined) cleared.push(id);
    };
    try {
      booted.leafMarkScrolling(reader.el);
      booted.leafMarkScrolling(table.el);
      if (!reader.classes.has('is-scrolling') || !table.classes.has('is-scrolling')) {
        throw new Error('a box created after boot was left unwatched');
      }
      if (armed.length !== 2) throw new Error('the two boxes share one clock');
      // The second box must not have reset the first one's clock, or a page with two scrollers leaves a bar up for ever.
      if (cleared.length) throw new Error('a second box moving reset the first box’s clock');
      armed[0]();
      if (reader.classes.has('is-scrolling')) throw new Error('the first box kept its bar past its rest');
      if (!table.classes.has('is-scrolling')) throw new Error('one box resting took the bar off another still moving');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
    }
  });

  // The gutter sits outside the box's own width, so the pointer being on the bar is an offset past `clientWidth` — or past `clientHeight`, on a sideways bar. Both directions here, because the wide table wears the same rule with its bar along the bottom.
  check('the pointer in a box’s own gutter raises that box’s bar, and neither reason cancels the other', () => {
    const classes = new Set();
    const box = Object.assign(fakeElement('gutter'), {
      clientWidth: 286,
      clientHeight: 400,
      matches: () => true,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    });
    const at = (offsetX, offsetY) => booted.leafMarkPointing({ target: box, offsetX, offsetY });
    at(290, 120);
    if (!classes.has('is-pointing')) throw new Error('the pointer on the bar’s own gutter raises nothing');
    at(120, 120);
    if (classes.has('is-pointing')) throw new Error('the bar stays raised once the pointer is back over the content');
    at(120, 404);
    if (!classes.has('is-pointing')) throw new Error('a sideways bar’s gutter along the bottom is never seen');
    // A box made after boot is covered the same way, and one it is not a wearer at all is never stamped.
    const other = Object.assign(fakeElement('plain'), { matches: () => false, clientWidth: 0, clientHeight: 0 });
    booted.leafMarkPointing({ target: other, offsetX: 40, offsetY: 40 });
    if (classes.has('is-pointing')) throw new Error('moving off onto something else left the bar up');
    // The two reasons are independent: a wheel while the pointer is already there, then the pointer leaving, must leave the bar up until the box has been still.
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = () => 1;
    try {
      at(290, 120);
      booted.leafMarkScrolling(box);
      if (!classes.has('is-pointing') || !classes.has('is-scrolling')) {
        throw new Error('one reason for the bar took the other one off');
      }
      at(120, 120);
      if (classes.has('is-pointing')) throw new Error('the pointer leaving mid-scroll left the thickening behind');
      if (!classes.has('is-scrolling')) throw new Error('the pointer leaving mid-scroll took the whole bar with it');
    } finally {
      booted.setTimeout = wasTimeout;
      classes.clear();
      booted.leafMarkPointing(null);
    }
  });

  // The stand-in page takes document listeners and drops them, so the registration cannot be reached through it. Read off the fragment instead, the way the canvas's own listeners are.
  check('one passive listener in the capture phase is what sees every scroller', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/dom.js'), 'utf8');
    const registered = /document\.addEventListener\(\s*'scroll',[^;]*\{[^}]*capture:\s*true[^}]*passive:\s*true[^}]*\}\s*\)/.test(fragment);
    if (!registered) {
      throw new Error('dom.js does not register the scroll listener on document in the capture phase, passively');
    }
    const pointing = /document\.addEventListener\(\s*'pointermove',\s*leafMarkPointing,\s*\{[^}]*capture:\s*true[^}]*passive:\s*true[^}]*\}\s*\)/.test(fragment);
    if (!pointing) {
      throw new Error('dom.js does not register the pointer watcher on document in the capture phase, passively');
    }
    // A rectangle read per mouse move is a forced layout on every move across the whole window.
    if (/getBoundingClientRect/.test(fragment.slice(fragment.indexOf('function leafMarkPointing')))) {
      throw new Error('the pointer watcher reads a rectangle on every move');
    }
    if (!/leafMarkScrolling\(event\.target\)/.test(fragment)) {
      throw new Error('the listener stamps something other than the box that scrolled');
    }
    // A per-box binding is the one way this quietly breaks: the reader is rebuilt on every render and a table has nothing to bind to.
    const others = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (/is-scrolling/.test(others)) throw new Error('the start screen still stamps a bar of its own');
  });

  check('an unfavorited row stays on screen long enough to be taken back', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    const wasTimeout = booted.setTimeout;
    let waiting = null;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.setTimeout = (fn) => {
      waiting = fn;
      return 7;
    };
    const path = 'C:\\Vaults\\Work\\Standup.md';
    // What the page's own copy holds once that path has gone, which is what the column is drawn from.
    const without = { recent: [], favorites: KEPT.filter((one) => one.path !== path) };
    try {
      withVaults(VAULTS, 0, () => {
        booted.window.leafSetState({ recent: [], favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        booted.pressHomeHeart(path, 'document');
        // The host is told at once: a crash between here and the wait ending must not put back a file that was deliberately dropped.
        if (!sent.some((one) => one.command === 'toggleFavorite' && one.path === path)) {
          throw new Error(`the host was not told: ${JSON.stringify(sent)}`);
        }
        if (!waiting) throw new Error('nothing was set to end the wait');
        let markup = booted.homeListsMarkup(without);
        // Still drawn, marked as going, with a hollow heart and a sentence saying what happens next.
        if (!markup.includes('home-row is-going')) throw new Error(`the unfavorited row left at once: ${markup}`);
        if (!markup.includes('Standup')) throw new Error('the unfavorited row is not on screen');
        if (!markup.includes('lt-icon-favorite-off')) throw new Error('the row still says it is a favorite');
        if (!markup.includes('press the heart to put it back')) {
          throw new Error(`the row does not say what is about to happen: ${markup}`);
        }
        // The count is what the list will be, not what is drawn.
        if (!markup.includes('Favorites (3)')) throw new Error(`the count still holds the unfavorited row: ${markup}`);

        // Pressing it again inside the wait takes it off the way out.
        booted.pressHomeHeart(path, 'document');
        markup = booted.homeListsMarkup({ recent: [], favorites: KEPT });
        if (markup.includes('is-going')) throw new Error('the row is still on its way out');
        if (!markup.includes('Favorites (4)')) throw new Error(`taking it back did not restore the count: ${markup}`);
        if (!markup.includes('Standup')) throw new Error('taking it back lost the row');

        // And once the wait really ends, the row is gone.
        waiting = null;
        booted.pressHomeHeart(path, 'document');
        if (!waiting) throw new Error('the second drop set no wait');
        waiting();
        markup = booted.homeListsMarkup(without);
        if (markup.includes('Standup')) throw new Error(`the row outlived its wait: ${markup}`);
      });
    } finally {
      booted.homeDropping.clear();
      booted.ipc.postMessage = wasSend;
      booted.setTimeout = wasTimeout;
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  /** The rows and headings a drawn column really has, as nodes the marking can toggle classes on. Parsed out of the markup the page just produced, so the half that draws a row and the half that marks it are held to each other rather than to a fixture written by hand. */
  function drawnColumn(markup) {
    const node = (className, attrs) => {
      const classes = new Set(String(className).split(/\s+/).filter(Boolean));
      return {
        classes,
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        classList: {
          add: (one) => classes.add(one),
          remove: (one) => classes.delete(one),
          contains: (one) => classes.has(one),
          toggle: (one, on) => (on ? classes.add(one) : classes.delete(one)),
        },
      };
    };
    const attributesOf = (raw) => {
      const attrs = {};
      for (const one of raw.matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[one[1]] = one[2];
      return attrs;
    };
    const rows = [];
    const groups = [];
    for (const tag of markup.matchAll(/<(span|li) class="([^"]*)"([^>]*)>/g)) {
      const [, , className, raw] = tag;
      const attrs = attributesOf(raw);
      if (attrs['data-home-favorite']) rows.push(node(className, attrs));
      else if (className.includes('home-list-group') && attrs['data-home-vault']) groups.push(node(className, attrs));
    }
    return {
      rows,
      groups,
      row: (path) => rows.find((one) => one.getAttribute('data-home-favorite') === path),
      group: (vault) => groups.find((one) => one.getAttribute('data-home-vault') === String(vault)),
      querySelectorAll: (selector) =>
        selector === '[data-home-favorite]' ? rows : selector === '.home-list-group[data-home-vault]' ? groups : [],
    };
  }

  /** Answer the host's check with what is missing, then mark one drawn column with it. */
  function answerMissing(column, paths, vaults) {
    booted.window.leafSetFavoritesMissing({ paths, vaults: vaults || [] });
    booted.markHomeFavorites(column);
  }

  check('a favorite whose file is not there is struck where it stands, with a way out', () => {
    const gone = 'C:\\Vaults\\Dharma\\A sutta.md';
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    // Every kept document carries the way out already, so saying a file has gone is a class on a row that is already on screen — never a redraw, which would throw a dropped row's half-finished dissolve away.
    if ((markup.match(/data-home-repair=/g) || []).length !== 3) {
      throw new Error(`the repair is not drawn on every favorite document: ${markup}`);
    }
    // Except on a folder: this opens the picker Open opens, which picks a file.
    const folderRow = markup.slice(markup.indexOf('data-folder-path'), markup.indexOf('data-folder-path') + 400);
    if (folderRow.includes('data-home-repair')) {
      throw new Error(`a favorite folder was offered a file picker: ${folderRow}`);
    }
    const column = drawnColumn(markup);
    if (column.rows.length !== 4) throw new Error(`the column drew ${column.rows.length} favorite rows`);
    // Nothing is marked before an answer arrives — the resting state, and the true one in a browser, where nobody reads a disk.
    if (column.rows.some((row) => row.classList.contains('is-missing'))) {
      throw new Error('a row was marked before the host had answered');
    }
    answerMissing(column, [gone]);
    const struck = column.row(gone);
    if (!struck.classList.contains('is-missing')) throw new Error('the file that has gone was not marked');
    if (struck.classList.contains('is-vault-gone')) {
      throw new Error('one missing file was read as its whole vault going');
    }
    // Every other row is what it was.
    for (const row of column.rows) {
      if (row === struck) continue;
      if (row.classList.contains('is-missing')) {
        throw new Error(`a row nobody named was marked: ${row.getAttribute('data-home-favorite')}`);
      }
    }
    // And the same path in Recent is not this list's row: a file can be in both.
    const both = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [gone], favorites: KEPT }));
    if ((both.match(/data-home-favorite=/g) || []).length !== 4) {
      throw new Error('a recent row was drawn as a favorite');
    }
  });

  check('a vault whose folder has gone says so once, on its heading', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    const column = drawnColumn(markup);
    answerMissing(column, [], [1]);
    const heading = column.group(1);
    if (!heading || !heading.classList.contains('is-missing')) {
      throw new Error("the gone vault's heading was not marked");
    }
    if (column.group(2).classList.contains('is-missing')) {
      throw new Error('a vault that is there was marked too');
    }
    // Its rows are struck and carry no way out: repointing one file inside a folder that is not there is not the fix.
    for (const row of column.rows) {
      const inside = row.getAttribute('data-home-vault') === '1';
      if (row.classList.contains('is-missing') !== inside) {
        throw new Error(`a row inside the gone vault was marked wrong: ${row.getAttribute('data-home-favorite')}`);
      }
      if (row.classList.contains('is-vault-gone') !== inside) {
        throw new Error(`a row still offers to repoint inside a folder that is not there: ${row.getAttribute('data-home-favorite')}`);
      }
    }
    // Said once, where the vault is already named, rather than on every row under it.
    if ((markup.match(/home-list-group-gone/g) || []).length !== 3) {
      throw new Error(`the line saying a folder has gone is not one per heading: ${markup}`);
    }
  });

  check('a file that is back is unmarked by the next answer, with nothing pressed', () => {
    const gone = 'C:\\Vaults\\Work\\Standup.md';
    const column = drawnColumn(withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT })));
    answerMissing(column, [gone], [2]);
    if (!column.row(gone).classList.contains('is-missing')) throw new Error('the first answer did not mark it');
    // The disk is the answer, every time it is asked. A file put back outside the app is a row that stops being struck on the next answer, with nobody pressing anything.
    answerMissing(column, [], []);
    if (column.row(gone).classList.contains('is-missing')) throw new Error('the row stayed struck after the file came back');
    if (column.row(gone).classList.contains('is-vault-gone')) throw new Error('the row still says its vault has gone');
    if (column.group(2).classList.contains('is-missing')) throw new Error("the heading still says the vault's folder has gone");
  });

  check('a row on its way out is never named missing, and still goes on its own timer', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    const wasTimeout = booted.setTimeout;
    let waiting = null;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.setTimeout = (fn) => {
      waiting = fn;
      return 7;
    };
    const path = 'C:\\Vaults\\Work\\Standup.md';
    const without = { recent: [], favorites: KEPT.filter((one) => one.path !== path) };
    try {
      withVaults(VAULTS, 0, () => {
        booted.window.leafSetState({ recent: [], favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        booted.pressHomeHeart(path, 'document');
        // Off the store and held on screen by its own timer, so it is not a favorite whose file has gone — what the reader is watching is it leaving.
        const column = drawnColumn(booted.homeListsMarkup(without));
        answerMissing(column, [path]);
        const going = column.row(path);
        if (!going) throw new Error('the unfavorited row left the column at once');
        if (going.classList.contains('is-missing')) throw new Error('a row on its way out was struck as missing');

        // Pressing the heart again inside the wait still brings it back, marked or not.
        booted.pressHomeHeart(path, 'document');
        if (booted.homeListsMarkup({ recent: [], favorites: KEPT }).includes('is-going')) {
          throw new Error('taking it back left it on its way out');
        }
        // And the timer still ends it.
        waiting = null;
        booted.pressHomeHeart(path, 'document');
        if (!waiting) throw new Error('the second drop set no wait');
        waiting();
        if (booted.homeListsMarkup(without).includes('Standup')) throw new Error('the row outlived its wait');
      });
    } finally {
      booted.homeDropping.clear();
      booted.window.leafSetFavoritesMissing({ paths: [], vaults: [] });
      booted.ipc.postMessage = wasSend;
      booted.setTimeout = wasTimeout;
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('a row dropped inside its group names the row it lands before, and one dropped outside it moves nothing', () => {
    // The middles of the rows it is being dragged past, measured before any of them moved — so the rows stepping aside cannot change the answer that decided to move them.
    const baselines = [10, 30, 50];
    if (booted.homeDropIndex(baselines, 5) !== 0) throw new Error('a drop at the top did not land first');
    if (booted.homeDropIndex(baselines, 25) !== 1) throw new Error('a drop landed in the wrong slot');
    if (booted.homeDropIndex(baselines, 55) !== 3) throw new Error('a drop past the last row is not the end of the group');
    if (booted.homeDropIndex([], 10) !== 0) throw new Error('a group of one is not its own only slot');

    /** The items a slot lands in front of, as the landing arithmetic sees them. */
    const item = (path, going) => ({
      querySelector: () => ({
        getAttribute: (name) => (name === 'data-home-favorite' ? path : null),
        classList: { contains: (one) => going && one === 'is-going' },
      }),
    });
    const others = [item('first.md'), item('second.md', true), item('third.md')];
    if (booted.homeLandingPath(others, 0) !== 'first.md') throw new Error('the first slot named the wrong row');
    // A row on its way out is off the store, so the host could not find it: the drop lands in front of the next real one.
    if (booted.homeLandingPath(others, 1) !== 'third.md') throw new Error('a drop named a row that has left the store');
    if (booted.homeLandingPath(others, 3) !== null) throw new Error('the end of the group is not the end of the list');

    const sent = [];
    const was = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      booted.dropHomeRow('third.md', 'first.md');
      // The end of a group carries no landing row, and the host reads that as last.
      booted.dropHomeRow('first.md', null);
      // A row dropped where it already is asks for nothing.
      booted.dropHomeRow('first.md', 'first.md');
    } finally {
      booted.ipc.postMessage = was;
    }
    const moves = sent.filter((one) => one.command === 'moveFavorite');
    if (moves.length !== 2) throw new Error(`the drops sent ${moves.length} moves: ${JSON.stringify(sent)}`);
    if (moves[0].path !== 'third.md' || moves[0].before !== 'first.md') {
      throw new Error(`the drop did not name both rows: ${JSON.stringify(moves[0])}`);
    }
    if (moves[1].path !== 'first.md' || moves[1].before !== null) {
      throw new Error(`the drop at the end of a group did not say so: ${JSON.stringify(moves[1])}`);
    }
    // Never an index: the drawn list is grouped and can still be showing a row that has left the store.
    if (moves.some((one) => 'index' in one || 'from' in one || 'to' in one)) {
      throw new Error('a drop sent a position rather than the paths');
    }
  });

  check('a drag lifts a copy, holds the space it left, and steps the rows around it aside', () => {
    /** An item in a list, with the classes it is wearing and any transform written on it. */
    function listItem(path) {
      const classes = new Set();
      const row = {
        outerHTML: `<span class="home-row" data-home-favorite="${path}"></span>`,
        classes: new Set(),
        getAttribute: (name) => (name === 'data-home-favorite' ? path : null),
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 20, bottom: 20 }),
      };
      const item = {
        style: {},
        classList: {
          add: (one) => classes.add(one),
          remove: (one) => classes.delete(one),
          contains: (one) => classes.has(one),
          toggle: (one, on) => (on ? classes.add(one) : classes.delete(one)),
        },
        classes,
        querySelector: () => row,
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 200, height: 20, bottom: 20 }),
      };
      row.classList = {
        add: (one) => row.classes.add(one),
        remove: (one) => row.classes.delete(one),
        contains: (one) => row.classes.has(one),
      };
      row.parentElement = item;
      return { item, row };
    }

    const rows = ['first.md', 'second.md', 'third.md'].map(listItem);
    const list = { children: rows.map((one) => one.item) };
    rows.forEach((one) => {
      one.item.parentElement = list;
    });
    const dragged = rows[0];
    const drag = { path: 'first.md', row: dragged.row, pointerId: 1, startY: 0, moved: false };
    const body = booted.document.body;
    const bodyClasses = new Set();
    body.classList = {
      add: (one) => bodyClasses.add(one),
      remove: (one) => bodyClasses.delete(one),
      contains: (one) => bodyClasses.has(one),
    };
    // The carried copy goes to the app surface, not to the window: it is an overlay, and every overlay in the page belongs to the box that means the app.
    const surface = booted.document.getElementById('appSurface');
    const carried = [];
    const wasAppend = surface.appendChild;
    surface.appendChild = (child) => carried.push(child);
    try {
      if (!booted.beginHomeRowDrag(drag, { clientY: 4 })) throw new Error('the drag never started');
    } finally {
      surface.appendChild = wasAppend;
    }
    // A copy is carried, the original holds its space rather than being drawn twice, and the space it holds is the one that wears the grain.
    if (carried.length !== 1 || !String(carried[0].className).includes('home-row-ghost')) {
      throw new Error('nothing was lifted off the list under the pointer');
    }
    if (!String(carried[0].innerHTML).includes('data-home-favorite="first.md"')) {
      throw new Error('the carried copy is not the row that was grabbed');
    }
    if (!dragged.row.classes.has('is-dragging')) throw new Error('the row is drawn twice, in place and carried');
    if (!dragged.item.classes.has('is-dropzone')) throw new Error('the space it left is not marked as where it lands');
    if (!bodyClasses.has('is-home-row-dragging')) throw new Error('the pointer is not a grabbed hand while dragging');

    // Dragged one slot down: the row it passes steps up into the space, the one past the landing slot stays where it is, and the room travels with the pointer.
    drag.to = 1;
    drag.span = 20;
    booted.slideHomeRowsAside(drag);
    if (drag.others[0].style.transform !== 'translateY(-20px)') throw new Error('a row it passed did not step aside');
    if (drag.others[1].style.transform) throw new Error('a row past the landing slot moved anyway');
    if (drag.item.style.transform !== 'translateY(20px)') throw new Error('the room it lands in did not travel with it');
    // And two slots down moves both of them, so the room is always one slot deep wherever it goes.
    drag.to = 2;
    booted.slideHomeRowsAside(drag);
    if (drag.others[1].style.transform !== 'translateY(-20px)') throw new Error('the second row it passed stayed put');
    if (drag.item.style.transform !== 'translateY(40px)') throw new Error('the room stopped short of the landing slot');
  });

  check('a press on a favorite row takes no pointer, so the row still opens its file', () => {
    // A captured pointer sends the click that follows to whatever holds the capture, so taking the pointer on every press took every click off the button inside the row and no favorite would open. The hold belongs past the drag threshold, where there is no click left to lose.
    const row = Object.assign(fakeElement('row'), {
      getAttribute: (name) => (name === 'data-home-favorite' ? 'C:\\Vaults\\Work\\Standup.md' : null),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    });
    let pressed = null;
    row.addEventListener = (name, handler) => {
      if (name === 'pointerdown') pressed = handler;
    };
    booted.bindHomeRows({ querySelectorAll: (selector) => (selector === '[data-home-favorite]' ? [row] : []) });
    if (!pressed) throw new Error('a favorite row is no longer listening for a press');
    const held = [];
    row.setPointerCapture = (id) => held.push(id);
    pressed({ button: 0, pointerId: 3, clientY: 100, target: { closest: () => null } });
    if (held.length) throw new Error('the press took the pointer, which takes the click off the row');
  });

  check('a favorite folder goes to the pane, not the reader', () => {
    const sent = [];
    const was = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      booted.openHomeFolder('C:\\Vaults\\Dharma\\Journal');
    } finally {
      booted.ipc.postMessage = was;
    }
    const commands = sent.map((one) => one.command);
    // A folder is not a document. Opening one as if it were is the reader trying to render a directory.
    if (commands.includes('openRecent')) {
      throw new Error(`a kept folder was opened as a document: ${JSON.stringify(commands)}`);
    }
    const asked = sent.find((one) => one.command === 'getFolder');
    if (!asked || asked.path !== 'C:\\Vaults\\Dharma\\Journal') {
      throw new Error(`the pane was not sent to that folder: ${JSON.stringify(sent)}`);
    }
  });

  check('with no favorites the screen is the one this ticket found', () => {
    // A box saying how to favorite a file is an advertisement on the screen somebody sees most, and the heart is on every tab under the pointer. So with no favorites there is no pair at all — the screen is the plain recent list it already had, whole paths one to a line, and none of this ticket's markup is on it.
    const empty = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: [] }));
    if (empty !== '<p class="empty-help">Files you open show up here.</p>') {
      throw new Error(`nothing open and nothing kept is not the line it was: ${empty}`);
    }

    const plain = withVaults(VAULTS, 0, () =>
      homeListsMarkup({ recent: ['C:\\Notes\\Journal\\A note.md'], favorites: [] }),
    );
    if (!plain.startsWith('<div class="recent"><h2>Recent (1)</h2><ol>')) {
      throw new Error(`a lone list is not the block it was: ${plain}`);
    }
    if (!plain.includes('<span class="home-row-name"><span class="file-name-stem">A note</span><span class="file-type-badge">MD</span></span>')) {
      throw new Error(`a lone list did not draw the shared file name row: ${plain}`);
    }
    for (const paired of ['home-list-grid', 'home-list-box', 'Favorites']) {
      if (plain.includes(paired)) throw new Error(`a lone list is still drawn as half a pair: ${paired}`);
    }

    // With favorites, both are there and Recent is first — on the screen, and first again when the columns fold.
    const both = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: ['a.md'], favorites: KEPT }));
    if (!both.includes('home-list-grid')) throw new Error('a pair was drawn as a lone list');
    if (both.indexOf('Recent') > both.indexOf('Favorites')) {
      throw new Error('Favorites was drawn above Recent');
    }
  });

  /** The empty Recent column of a pair, which is the box a first launch into a vault draws. */
  function emptyRecentColumn() {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    if (!markup.includes('home-list-grid')) throw new Error(`nothing open beside a kept file is not a pair: ${markup}`);
    return markup.slice(markup.indexOf('<section'), markup.indexOf('</section>') + '</section>'.length);
  }

  check('an empty Recent beside a kept file is a box with a short line in it', () => {
    const column = emptyRecentColumn();
    if (column !== '<section class="home-list"><h2>Recent</h2><p class="empty-help">Files you open show up here.</p></section>') {
      throw new Error(`the empty Recent column is not the box it was: ${column}`);
    }
  });

  check('the empty Recent line stays short enough to keep off the border', () => {
    // The box has no inset on its right, and the pair is as wide as its widest thing. At the narrowest window that still draws two boxes the line has 263px, and 30 characters is 221px — so a longer wording is one that jams against the border again and drags both boxes out past the writing.
    const line = /<p class="empty-help">([^<]*)<\/p>/.exec(emptyRecentColumn());
    if (!line) throw new Error('the empty Recent column drew no line at all');
    if (line[1].length > 30) {
      throw new Error(`the empty Recent line is ${line[1].length} characters: ${line[1]}`);
    }
  });

}

// A row strips the document extension off its name, and theme.js runs renderState() as it loads — which reaches the branch that draws these rows. The regex behind that strip is a `const`, so a fragment declaring it after theme.js leaves it in its dead zone and the very first paint throws. Order, not behavior, so it is read off the list the binary joins.
check('the document extensions are in scope before the first render', () => {
  const declares = names.filter((name) =>
    /^\s*const DOCUMENT_NAME_RE\b/m.test(readFileSync(join(root, 'src/assets', name), 'utf8')),
  );
  if (declares.length !== 1) {
    throw new Error(`one fragment should declare DOCUMENT_NAME_RE, found ${declares.length}`);
  }
  // Code only: half the fragments mention the load-time render in a comment, and a comment renders nothing.
  const code = (name) =>
    readFileSync(join(root, 'src/assets', name), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  // render-document.js declares it rather than calling it.
  const renders = names.filter((name) => name !== 'shell/render-document.js' && /\brenderState\(\)/.test(code(name)));
  const first = Math.min(...renders.map((name) => names.indexOf(name)));
  if (names.indexOf(declares[0]) > first) {
    throw new Error(`${declares[0]} declares DOCUMENT_NAME_RE after ${names[first]} has already rendered`);
  }
});

// ---- 5b. the library's rows outlive the pane being redrawn ------------------
//
// The pane is rewritten whole through innerHTML whenever the host re-reads the folder, and the watcher re-reads it for any change under a recursively watched vault. A row destroyed between a press and its release has nowhere to send the click, so opening a file by clicking its name failed about half the time. Two answers, both wanted: a read that draws the same rows leaves the elements standing, and a row acts on the press.

if (booted) {
  const librarySearchField = booted.document.getElementById('librarySearch');
  const librarySearchClear = booted.document.getElementById('librarySearchClear');
  const inputHandlers = () => librarySearchField.listeners.get('input') || [];

  check('the library search cross follows the field and leaves with its vault', () => {
    librarySearchField.value = 'draft';
    for (const handler of inputHandlers()) handler({});
    if (librarySearchClear.hidden) throw new Error('the first search character left the clear cross hidden');

    librarySearchField.value = '';
    for (const handler of inputHandlers()) handler({});
    if (!librarySearchClear.hidden) throw new Error('the last search character left the clear cross showing');

    librarySearchField.value = 'draft';
    for (const handler of inputHandlers()) handler({});
    vm.runInContext("runLibrarySearch('draft')", booted);
    booted.leafSetVaults({ vaults: [], active: 0 });
    if (!librarySearchClear.hidden) throw new Error('leaving a vault left the clear cross behind');
  });

  check('the library search cross clears a pending filter and leaves the field ready', () => {
    const wasClearTimeout = booted.clearTimeout;
    const wasSetTimeout = booted.setTimeout;
    const wasFocus = librarySearchField.focus;
    const cleared = [];
    booted.clearTimeout = (timer) => cleared.push(timer);
    booted.setTimeout = () => 41;
    librarySearchField.focus = () => {
      booted.document.activeElement = librarySearchField;
    };
    try {
      librarySearchField.value = 'draft';
      for (const handler of inputHandlers()) handler({});
      const pending = vm.runInContext('librarySearchTimer', booted);
      const click = (librarySearchClear.listeners.get('click') || [])[0];
      if (!click) throw new Error('the clear cross has no click action');
      click({});
      if (librarySearchField.value) throw new Error('the clear cross left its query in the field');
      if (!librarySearchClear.hidden) throw new Error('the clear cross stayed visible after clearing');
      if (cleared[0] !== pending) throw new Error('the clear cross did not cancel the pending search');
      if (!booted.document.getElementById('librarySearchResults').hidden) throw new Error('the clear cross did not restore the file tree');
      if (booted.document.activeElement !== librarySearchField) throw new Error('the clear cross did not return typing to the field');
    } finally {
      booted.clearTimeout = wasClearTimeout;
      booted.setTimeout = wasSetTimeout;
      librarySearchField.focus = wasFocus;
    }
  });

  const libraryEscape = () => {
    const handler = (booted.__windowListeners.get('keydown') || []).find((one) => one.toString().includes('librarySearchQuery'));
    if (!handler) throw new Error('the library has no window Escape listener');
    return handler;
  };
  const showingLibrarySearch = () => {
    librarySearchField.value = 'draft';
    vm.runInContext("runLibrarySearch('draft')", booted);
  };
  const escapeEvent = () => {
    let prevented = false;
    let stopped = false;
    return {
      event: { key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } },
      prevented: () => prevented,
      stopped: () => stopped,
    };
  };

  check('Escape outside the search clears a showing library filter', () => {
    showingLibrarySearch();
    const key = escapeEvent();
    libraryEscape()(key.event);
    if (!key.prevented()) throw new Error('Escape left the library filter to the browser');
    if (vm.runInContext('librarySearchQuery', booted)) throw new Error('Escape outside the search left the filter showing');
    if (!booted.document.getElementById('librarySearchResults').hidden) throw new Error('Escape outside the search did not restore the file tree');
  });

  check('Escape closes the find bar before the library filter', () => {
    showingLibrarySearch();
    vm.runInContext('findOpen = true; findBar.hidden = false;', booted);
    const first = escapeEvent();
    libraryEscape()(first.event);
    if (first.prevented()) throw new Error('the library took Escape from the find bar');
    if (!vm.runInContext('librarySearchQuery', booted)) throw new Error('the library filter cleared before the find bar could close');

    const findEscape = (booted.__windowListeners.get('keydown') || []).find((one) => one.toString().includes('closeFindBar()'));
    if (!findEscape) throw new Error('the find bar has no window Escape listener');
    findEscape(first.event);
    if (vm.runInContext('findOpen', booted)) throw new Error('the find bar did not close on its Escape');

    const second = escapeEvent();
    libraryEscape()(second.event);
    if (!second.prevented() || vm.runInContext('librarySearchQuery', booted)) throw new Error('the next Escape did not clear the library filter');
  });

  check('the library completion menu gets Escape before the library filter', () => {
    showingLibrarySearch();
    vm.runInContext("filterMenuItems = [{ label: 'draft' }]", booted);
    const handler = (librarySearchField.listeners.get('keydown') || [])[0];
    if (!handler) throw new Error('the library field has no key handler');
    const key = escapeEvent();
    handler(key.event);
    if (!key.stopped()) throw new Error('the completion menu did not hold Escape in the field');
    if (!vm.runInContext('librarySearchQuery', booted)) throw new Error('the completion menu Escape cleared the library filter');
  });

  check('Escape without a library filter stays available', () => {
    vm.runInContext("runLibrarySearch('')", booted);
    const key = escapeEvent();
    libraryEscape()(key.event);
    if (key.prevented() || key.stopped()) throw new Error('an empty library search took Escape from another control');
  });

  // ---- the pane says a search is running, exactly once ----------------------
  //
  // A first search over a vault nobody has read this session waits on the disk. The waiting mark lives in the line that counts the rows, which is drawn whether or not there are any: a mark that only appeared when the pane was empty left an older query's rows sitting there unmarked, so the pane showed the answer to a question the field had moved on from.
  const searchPane = () => booted.document.getElementById('librarySearchResults');
  const waitingMarks = () => (searchPane().innerHTML.match(/library-results-spinner/g) || []).length;
  const searchHit = (title) => ({
    absPath: `/vault/${title}.md`,
    title,
    snippet: 'the matched words',
    startLine: 1,
    anchor: '',
  });

  check('a search waiting on the vault says so once, and stops saying it once', () => {
    showingLibrarySearch();
    if (waitingMarks() !== 1) throw new Error(`a search with nothing drawn showed ${waitingMarks()} waiting marks`);
    if (!searchPane().innerHTML.includes('Searching…')) throw new Error('a search with nothing drawn did not say it was searching');

    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });
    if (waitingMarks() !== 0) throw new Error('the answer left the waiting mark turning');
    if (!searchPane().innerHTML.includes('1 results')) throw new Error('the answer did not count its rows');
  });

  check('a search run over an older query’s rows marks them instead of leaving them silent', () => {
    showingLibrarySearch();
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });

    librarySearchField.value = 'drafts';
    vm.runInContext("runLibrarySearch('drafts')", booted);
    if (waitingMarks() !== 1) throw new Error(`a re-search over drawn rows showed ${waitingMarks()} waiting marks`);
    if (!searchPane().innerHTML.includes('library-hit')) throw new Error('a re-search threw away the rows it had');
    if (searchPane().innerHTML.includes('1 results')) throw new Error('a re-search counted the last query’s rows as this one’s answer');

    booted.leafSetSearchResults({ query: 'drafts', hits: [], truncated: false });
    if (waitingMarks() !== 0) throw new Error('an empty answer left the waiting mark turning');
    if (!searchPane().innerHTML.includes('No matches.')) throw new Error('an empty answer did not say so');
  });

  check('rows that arrive while the vault is being read keep their place under the ones before them', () => {
    showingLibrarySearch();
    // A vault read in slices answers the same query several times, each ranking everything it has read so far — so the second answer can put a better match above a row somebody is already reaching for.
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('First')], truncated: false, partial: true });
    if (waitingMarks() !== 1) throw new Error('rows still arriving cleared the waiting mark');
    if (!searchPane().innerHTML.includes('1 results so far')) throw new Error('a part-read vault counted its rows as the whole answer');

    booted.leafSetSearchResults({
      query: 'draft',
      hits: [searchHit('Better'), searchHit('First')],
      truncated: false,
      partial: true,
    });
    const order = vm.runInContext('librarySearchHits.map((hit) => hit.title)', booted);
    if (order.join() !== 'First,Better') throw new Error(`a later slice re-sorted the rows above it: ${order.join()}`);
    if (waitingMarks() !== 1) throw new Error(`a second slice showed ${waitingMarks()} waiting marks`);

    // The last answer is the whole vault's, ranked over all of it, and it is the one re-sort.
    booted.leafSetSearchResults({
      query: 'draft',
      hits: [searchHit('Better'), searchHit('First')],
      truncated: false,
    });
    const finished = vm.runInContext('librarySearchHits.map((hit) => hit.title)', booted);
    if (finished.join() !== 'Better,First') throw new Error(`the final answer did not rank the vault: ${finished.join()}`);
    if (waitingMarks() !== 0) throw new Error('the final answer left the waiting mark turning');
    if (searchPane().innerHTML.includes('so far')) throw new Error('a finished search still said its count was partial');
  });

  check('a payload that says nothing about a part-read vault is taken as finished', () => {
    showingLibrarySearch();
    // A published site and an embedded document answer this command without ever streaming, so silence has to mean the answer is whole — a waiting state is a promise.
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });
    if (waitingMarks() !== 0) throw new Error('a host that never streams left the ring turning for ever');
    if (vm.runInContext('librarySearchPartial', booted)) throw new Error('an answer with no word on it was taken as part of one');
  });

  check('a search that fails clears the waiting mark with its message', () => {
    showingLibrarySearch();
    booted.leafSetSearchResults({ query: 'draft', error: { message: 'Search failed.' } });
    if (waitingMarks() !== 0) throw new Error('a failed search left the waiting mark turning');
    if (!searchPane().innerHTML.includes('Search failed.')) throw new Error('a failed search did not say what went wrong');
    vm.runInContext("runLibrarySearch('')", booted);
  });

  /** A row as the pane draws one, with its listeners kept where a check can fire them. */
  const rowStandingIn = (dataset) => {
    const listeners = {};
    const button = Object.assign(fakeElement('row'), {
      dataset,
      addEventListener: (name, handler) => {
        listeners[name] = handler;
      },
    });
    return { button, listeners };
  };
  /** Everything the page sent while `run` was going. */
  const sentDuring = (run) => {
    const sent = [];
    const was = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      run();
    } finally {
      booted.ipc.postMessage = was;
    }
    return sent;
  };

  check('a file row opens on the press, so rebuilding the pane cannot swallow the click', () => {
    const { button, listeners } = rowStandingIn({ openPath: 'C:\\Vaults\\Work\\GLOSSARY.md' });
    booted.bindLibraryFileRow(button);
    if (!listeners.pointerdown) throw new Error('a file row does not listen for a press at all');

    // The press alone opens it: a rebuild landing before the mouse comes up leaves no button for the click to reach.
    const sent = sentDuring(() => listeners.pointerdown({ pointerType: 'mouse', button: 0 }));
    const opened = sent.filter((message) => message.command === 'openRecent');
    if (opened.length !== 1) throw new Error(`the press sent ${opened.length} opens rather than one`);
    if (opened[0].path !== 'C:\\Vaults\\Work\\GLOSSARY.md') throw new Error(`the press opened ${opened[0].path}`);

    // Touch and pen keep the click: a press that starts a scroll must not open the file under the finger.
    const rolling = rowStandingIn({ openPath: 'C:\\Vaults\\Work\\README.md' });
    booted.bindLibraryFileRow(rolling.button);
    const touched = sentDuring(() => rolling.listeners.pointerdown({ pointerType: 'touch', button: 0 }));
    if (touched.some((message) => message.command === 'openRecent')) throw new Error('a touch press opened the file under the finger');
  });

  check('press then click on one row opens the file once, not twice', () => {
    const { button, listeners } = rowStandingIn({ openPath: 'C:\\Vaults\\Work\\GLOSSARY.md' });
    booted.bindLibraryFileRow(button);
    // A row the host answered slowly is still standing when the mouse comes up, so its click fires too.
    const sent = sentDuring(() => {
      listeners.pointerdown({ pointerType: 'mouse', button: 0 });
      listeners.click({});
    });
    const opened = sent.filter((message) => message.command === 'openRecent');
    if (opened.length !== 1) throw new Error(`press and click together sent ${opened.length} opens`);

    // And a click with no press before it — the keyboard's — still opens it.
    const typed = sentDuring(() => listeners.click({}));
    if (!typed.some((message) => message.command === 'openRecent')) throw new Error('a keyboard click no longer opens the file');
  });

  check('a search row opens on the press too, because a vault being read rewrites them as fast as the tree', () => {
    const pane = booted.document.getElementById('librarySearchResults');
    const { button, listeners } = rowStandingIn({ openPath: 'C:\\Vaults\\Work\\GLOSSARY.md', anchor: '', line: '3' });
    const wasQuery = pane.querySelectorAll;
    pane.querySelectorAll = () => [button];
    try {
      vm.runInContext('bindSearchHits()', booted);
    } finally {
      pane.querySelectorAll = wasQuery;
    }
    if (!listeners.pointerdown) throw new Error('a search row does not listen for a press at all');
    const sent = sentDuring(() => {
      listeners.pointerdown({ pointerType: 'mouse', button: 0 });
      listeners.click({});
    });
    const opened = sent.filter((message) => message.command === 'openRecent');
    if (opened.length !== 1) throw new Error(`a pressed search row sent ${opened.length} opens rather than one`);
    if (opened[0].path !== 'C:\\Vaults\\Work\\GLOSSARY.md') throw new Error(`a search row opened ${opened[0].path}`);
  });

  check('an unchanged folder read does not replace the rows', () => {
    const tree = booted.document.getElementById('libraryTree');
    let writes = 0;
    let held = tree.innerHTML;
    Object.defineProperty(tree, 'innerHTML', {
      configurable: true,
      get: () => held,
      set: (value) => {
        writes += 1;
        held = value;
      },
    });
    try {
      const folder = (entries) => ({ path: 'C:\\Vaults\\Work', chain: [{ name: 'Work', path: 'C:\\Vaults\\Work' }], rootName: 'Work', entries });
      const two = [
        { kind: 'file', name: 'GLOSSARY.md', path: 'C:\\Vaults\\Work\\GLOSSARY.md' },
        { kind: 'file', name: 'README.md', path: 'C:\\Vaults\\Work\\README.md' },
      ];
      booted.leafSetLibraryFolder(folder(two));
      const drawn = writes;
      if (!drawn) throw new Error('the first read of a folder drew no rows');

      // What `git status` writing inside `.git` used to arrive as, 6.4 times a second: the same folder, the same files.
      booted.leafSetLibraryFolder(folder(two.map((entry) => ({ ...entry }))));
      if (writes !== drawn) throw new Error('a read describing what is already drawn rewrote the rows anyway');

      // A real change still redraws, or the pane would go deaf to the thing it exists for.
      booted.leafSetLibraryFolder(folder(two.concat([{ kind: 'file', name: 'PLAN.md', path: 'C:\\Vaults\\Work\\PLAN.md' }])));
      if (writes === drawn) throw new Error('a file appearing in the folder on screen never reached the pane');
    } finally {
      delete tree.innerHTML;
      tree.innerHTML = held;
    }
  });

  check('the empty folder line says how many files it skipped', () => {
    const tree = booted.document.getElementById('libraryTree');
    const drawn = (payload) => {
      booted.leafSetLibraryFolder({
        path: 'C:\\Vaults\\Work\\shots',
        chain: [{ name: 'shots', path: 'C:\\Vaults\\Work\\shots' }],
        rootName: 'Work',
        entries: [],
        ...payload,
      });
      return tree.innerHTML;
    };

    // The folder the owner opened: 80 files, none of them a kind the app reads.
    const many = drawn({ skippedFiles: 80 });
    if (!many.includes('80 files live here, but none is a kind Leaftext opens.')) {
      throw new Error(`a folder of 80 unreadable files drew ${many}`);
    }
    // One file gets its own wording, or the pane says "1 files".
    const one = drawn({ skippedFiles: 1 });
    if (!one.includes('1 file lives here, but it is not a kind Leaftext opens.')) {
      throw new Error(`a folder holding one unreadable file drew ${one}`);
    }
    // A host that never learned to count leaves the line as it has always read, and does not keep the last folder's number.
    const older = drawn({});
    if (!older.includes('Nothing to read in this folder.') || /lives? here/.test(older)) {
      throw new Error(`a payload carrying no count drew ${older}`);
    }
    // A folder with nothing in it at all says only what it always said.
    const bare = drawn({ skippedFiles: 0 });
    if (!bare.includes('Nothing to read in this folder.') || /lives? here/.test(bare)) {
      throw new Error(`an empty folder drew ${bare}`);
    }
  });
}

// ---- 5c. the pane says what a vault is, once --------------------------------
//
// A box at the top of the file list, for a reader who has never made a vault. Four flags decide it and every one of them can be wrong in a way nothing else would catch: the store keeps no record of who made a vault, so "never made one" is answered by whether every vault sits inside a sync client's folder — and that answer arrives after boot, which is why an unanswered list must draw nothing rather than guess.

if (booted) {
  const libraryTreeElement = booted.document.getElementById('libraryTree');
  const CLOUD_FOLDERS = [{ path: 'C:\\Users\\me\\Dropbox' }];
  // Registered by the app itself because a sync client put the folder there — see remote-sources. Nobody chose it, so it is not evidence the reader knows what a vault is.
  const CLOUD_VAULT = { id: 1, name: 'Dropbox', rootPath: 'C:\\Users\\me\\Dropbox\\Notes' };
  const OWN_VAULT = { id: 2, name: 'Notes', rootPath: 'C:\\Vaults\\Notes' };

  /** The pane drawn against one arrangement of the four flags. `folders` of null is the answer that has not landed yet. */
  function paneWith({ met = true, folders = CLOUD_FOLDERS, vaults = [] } = {}) {
    booted.leafResetHints();
    if (met) booted.retireHint('libraryVault');
    vm.runInContext('cloudFolders = null;', booted);
    booted.leafSetVaults({ vaults, active: 0 });
    if (folders) booted.leafSetCloudFolders(folders);
    booted.renderLibrary();
    return libraryTreeElement.innerHTML;
  }
  const introducing = (arrangement) => paneWith(arrangement).includes('library-intro');

  check('the pane introduces vaults to the reader who never made one, and to nobody else', () => {
    try {
      if (!introducing({})) throw new Error('a reader with no vault at all was told nothing');
      if (!introducing({ vaults: [CLOUD_VAULT] })) {
        throw new Error('a vault that registered itself out of a sync folder counted as one the reader made');
      }
      if (introducing({ vaults: [OWN_VAULT] })) throw new Error('a reader who already made a vault was introduced to them');
      if (introducing({ vaults: [CLOUD_VAULT, OWN_VAULT] })) {
        throw new Error('one folder the reader chose was lost behind an auto-registered one');
      }
      // The answer has not arrived: every vault looks unchosen, and drawing on that is a guess.
      if (introducing({ folders: null, vaults: [OWN_VAULT] })) {
        throw new Error('the pane guessed before the cloud folders came back');
      }
      if (introducing({ folders: null })) throw new Error('the pane drew the box before it could know');
      // One thing at a time: the bubble pointing at the vault button has to have been met first.
      if (introducing({ met: false })) throw new Error('the box was drawn beside a bubble the reader had not met yet');
      // And it is the words the ticket settled, with the same button the start screen offers.
      const drawn = paneWith({});
      for (const wanted of ['A vault is one folder of notes.', 'library-intro-text', '>Add your notes folder<']) {
        if (!drawn.includes(wanted)) throw new Error(`the introduction is missing ${wanted}: ${drawn.slice(0, 400)}`);
      }
      // First in the list, above whatever the pane is browsing — which, with no vault, is the machine's drives.
      const rows = drawn.indexOf('library-project');
      if (rows >= 0 && drawn.indexOf('library-intro') > rows) throw new Error('the introduction landed under the list rather than above it');
    } finally {
      booted.leafResetHints();
      booted.leafSetVaults({ vaults: [], active: 0 });
      vm.runInContext('cloudFolders = null;', booted);
      booted.renderLibrary();
    }
  });

  check('the introduction is retired for good by picking a folder or by opening the list that offers one', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    // A query on a stand-in hands back a fresh stand-in, so the button the page really bound has to be kept as it is handed over.
    const wasQuery = libraryTreeElement.querySelector;
    let introButton = null;
    libraryTreeElement.querySelector = (selector) => {
      const found = wasQuery.call(libraryTreeElement, selector);
      if (String(selector) === '.library-intro-action') introButton = found;
      return found;
    };
    const metNames = () => {
      const saves = sent.filter((one) => one.command === 'setHintState');
      return saves.length ? saves[saves.length - 1].seen : [];
    };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));

      // Its own button: the command the pane's menu already sends, and the box gone for good.
      paneWith({});
      if (!introButton) throw new Error('the page never went looking for the button it drew');
      sent.length = 0;
      for (const handler of introButton.listeners.get('click') || []) handler({});
      if (!sent.some((one) => one.command === 'createVault')) {
        throw new Error(`pressing it sent ${JSON.stringify(sent.map((one) => one.command))}`);
      }
      if (!metNames().includes('vaultIntro')) throw new Error(`the name was never saved: ${JSON.stringify(metNames())}`);
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box outlived the press');
      // And it does not come back on the next read of the same folder.
      booted.renderLibrary();
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box came back on the next read');

      // Opening the vault list is meeting New vault…, so the box has said its piece either way.
      paneWith({});
      if (!libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box did not come back for a fresh reader');
      sent.length = 0;
      const switcher = booted.document.getElementById('libraryVaultSwitch');
      for (const handler of switcher.listeners.get('pointerdown') || []) {
        handler({ button: 0, stopPropagation() {}, preventDefault() {} });
      }
      if (!metNames().includes('vaultIntro')) throw new Error(`opening the list saved ${JSON.stringify(metNames())}`);
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box outlived the menu opening');
    } finally {
      libraryTreeElement.querySelector = wasQuery;
      booted.ipc.postMessage = wasSend;
      booted.hideCrumbMenu();
      booted.leafResetHints();
      booted.leafSetVaults({ vaults: [], active: 0 });
      vm.runInContext('cloudFolders = null;', booted);
      booted.renderLibrary();
    }
  });
}

// A site cannot pick a folder on a disk it is not on, and an embed draws no pane at all — so neither may draw a box whose one button its host refuses.
check('neither browser host introduces a vault it could not make', () => {
  const hosts = [
    ['a published site', siteBoot(true).context],
    ['an embed', runShell(source, { __leafEmbedded: true })],
  ];
  for (const [name, context] of hosts) {
    // Every flag set the way the window's would be, so what is being read is the browser guard and not an accident of the hints being off.
    context.retireHint('libraryVault');
    context.leafSetCloudFolders([{ path: 'C:\\Users\\me\\Dropbox' }]);
    context.renderLibrary();
    const drawn = context.document.getElementById('libraryTree').innerHTML;
    if (drawn.includes('library-intro')) throw new Error(`${name} introduced a vault its host refuses to make: ${drawn.slice(0, 300)}`);
    if (drawn.includes('Add your notes folder')) throw new Error(`${name} drew the button on its own`);
  }
});

// ---- 6. the page reports its own errors -------------------------------------

// journal.js leads the list so that a fragment throwing as it loads is reported instead of vanishing. That claim is about load order, so it is checked by loading things in order — journal.js, then a fragment that throws — rather than by reading the list and trusting it.

/** journal.js alone, plus whatever tail the test wants, against a recording ipc. */
function runJournal(tail = '') {
  const sent = [];
  const errors = [];
  const sandbox = {
    console: { log() {}, warn() {}, debug() {}, error: (...args) => errors.push(args) },
    ipc: { postMessage: (text) => sent.push(JSON.parse(text)) },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    listeners: {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const source = readFileSync(join(root, 'src/assets/shell/journal.js'), 'utf8') + tail;
  let threw = null;
  try {
    new vm.Script(source, { filename: 'journal-check.js' }).runInContext(context);
  } catch (error) {
    threw = error;
  }
  return { sandbox, sent, errors, threw };
}

check('journal.js leads the list, so a later fragment can throw into it', () => {
  const first = names[0];
  if (first !== 'shell/journal.js') {
    throw new Error(`journal.js must be first in APP_SHELL_SCRIPT_PARTS, found ${first}`);
  }

  // A fragment appended after it throws as it loads. Node has no window.onerror dispatch, so the throw comes back here — what matters is that the handler was already installed when it happened, and that it turns the throw into a report.
  const { sandbox, sent, threw } = runJournal('\nthrow new Error("a fragment broke");\n');
  if (!threw) throw new Error('the appended fragment was supposed to throw');
  if (typeof sandbox.onerror !== 'function') {
    throw new Error('window.onerror was not installed before the fragment ran');
  }

  sandbox.onerror(threw.message, 'app.js', 12, 3, threw);
  if (sent.length !== 1) throw new Error(`expected one message, got ${sent.length}`);
  const [message] = sent;
  if (message.command !== 'logError') throw new Error(`sent ${message.command}, not logError`);
  if (!message.message.includes('a fragment broke')) {
    throw new Error(`the report lost the message: ${message.message}`);
  }
  if (!message.message.includes('app.js:12:3')) {
    throw new Error(`the report lost the place: ${message.message}`);
  }
});

check('a repeated error is counted, not repeated', () => {
  // Two of the eight console.error calls in the shell sit inside per-diagram loops. Sending every one would fill the log file in seconds.
  const { sandbox, sent, errors } = runJournal();
  for (let i = 0; i < 100; i += 1) sandbox.console.error('the same thing went wrong');

  // Every call still reaches the real console — the web view's own log is not quietened, only the file.
  if (errors.length !== 100) throw new Error(`the console lost calls: ${errors.length} of 100`);
  // 1, 2, 4, 8, 16, 32, 64 — seven, and the last one says how far it got.
  if (sent.length !== 7) throw new Error(`expected 7 messages for 100 errors, got ${sent.length}`);
  if (sent[sent.length - 1].count !== 64) {
    throw new Error(`the count did not ride along: ${sent[sent.length - 1].count}`);
  }

  // A different message is its own count, not folded into the first.
  sandbox.console.error('something else');
  if (sent[sent.length - 1].count !== 1) throw new Error('two messages shared one count');
});

check('an unhandled rejection reaches the same place', () => {
  const { sandbox, sent } = runJournal();
  const onRejection = sandbox.listeners.unhandledrejection;
  if (typeof onRejection !== 'function') throw new Error('nothing listens for a rejection');
  onRejection({ reason: new Error('a promise gave up') });
  if (sent.length !== 1 || !sent[0].message.includes('a promise gave up')) {
    throw new Error(`the rejection did not arrive: ${JSON.stringify(sent)}`);
  }
});

// ---- the browser's own host -------------------------------------------------
//
// The app and a published site are one front end with two hosts under it, and `web/preview/host.js` is the browser's half — shipped to every site the export writes, and reachable nowhere else outside a browser.
//
// It runs here in the same fake page the fragments do, over a stand-in module rather than the real one: no wasm, no network, no browser. That stand-in carries a real linear memory and speaks the length-prefixed byte protocol, so the host's own copy of that protocol is proved as well as its arms — the copy `scripts/web-module.mjs` exists to stop drifting from.

/** The workspace payload the module answers a document with: the shape `workspace_state_script` builds, so the page reads it the way it reads the desktop's. */
const standInState = (path) => ({
  recent: [],
  favorites: [],
  tabs: [{ title: path.split('/').pop().replace(/\.[^.]+$/, ''), path }],
  active: 0,
  document: {
    title: path.split('/').pop().replace(/\.[^.]+$/, ''),
    path,
    html: `<p>${path}</p>`,
    minimap: { lines: [], headings: [] },
    format: 'Markdown',
    blocks: [],
    tasks: [],
    source: '',
  },
});

/** A stand-in for the browser module: a real `WebAssembly.Memory`, a bump allocator over it, and the length-prefixed answers the host reads. */
function standInModule() {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const asked = [];
  let glossary = '';
  // Zero is the host's "nothing came back", so nothing is ever handed out at it.
  let next = 8;

  const alloc = (length) => {
    const at = next;
    next += length + ((8 - (length % 8)) % 8);
    if (next > memory.buffer.byteLength) throw new Error('the stand-in module ran out of memory');
    return at;
  };
  const take = (pointer, length) => decoder.decode(new Uint8Array(memory.buffer, pointer, length));
  const give = (text) => {
    const bytes = encoder.encode(text);
    const at = alloc(4 + bytes.length);
    new DataView(memory.buffer).setUint32(at, bytes.length, true);
    new Uint8Array(memory.buffer).set(bytes, at + 4);
    return at;
  };

  return {
    asked,
    exports: {
      memory,
      leaf_alloc: (length) => alloc(length),
      leaf_free: () => {},
      leaf_set_glossary: (pointer, length) => {
        glossary = take(pointer, length);
      },
      leaf_document_script: (sourcePointer, sourceLength, pathPointer, pathLength) => {
        const path = take(pathPointer, pathLength);
        asked.push({ call: 'documentScript', path, source: take(sourcePointer, sourceLength) });
        return give(`window.leafSetState(${JSON.stringify(standInState(path))});`);
      },
      leaf_glossary_script: (pointer, length) => {
        const href = take(pointer, length);
        asked.push({ call: 'glossaryScript', href, glossary });
        return give(`window.__leafGlossary = ${JSON.stringify({ href, glossary })};`);
      },
    },
  };
}

/** The served listing a boot reads unless a check hands over its own: shallowest first, the way the export writes it. `notes` has no page of its own, which is the fallback case. */
const SERVED_DOCUMENTS = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];

/** The host, in a page that has what the published one has. The export writes the pending-command stub, not the host, so it is installed here exactly as the export writes it — a check without it is not testing the page a reader is served. */
async function bootWebHost({ pending = [], documents = SERVED_DOCUMENTS, name = '' } = {}) {
  const module_ = standInModule();
  const extras = {
    // The published page's own queue: the front end sends its first commands before any module script can have run, and the host drains them.
    __leafPending: [...pending],
    fetch: async (url) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), url }),
    WebAssembly: {
      Memory: WebAssembly.Memory,
      instantiate: async () => ({ instance: { exports: module_.exports } }),
    },
  };
  const context = runShell(source, extras);
  context.window.ipc = { postMessage: noopPost };

  // Everything the host hands the page, recorded on the way through. The pane and the strip still run the page's own call, so a payload the front end cannot take fails here. The state call is recorded and not run: it renders a whole document, and nothing is rendered on this page for it to render into — what is being proved is that the host reached the page by the call it reads a document in by.
  const seen = { state: [], folder: [], pager: [], fragment: [], place: [] };
  const watch = (name, into, through) => {
    const was = context.window[name];
    context.window[name] = (payload) => {
      into.push(payload);
      if (through && typeof was === 'function') was(payload);
    };
  };
  watch('leafSetState', seen.state, false);
  watch('leafSetLibraryFolder', seen.folder, true);
  watch('leafSetPager', seen.pager, true);
  // The two the history work rides on. Recorded and not run, for the same reason the state call is: nothing is rendered on this page to scroll.
  watch('leafScrollToFragment', seen.fragment, false);
  watch('leafRestoreScrollAnchor', seen.place, false);

  const host = readFileSync(join(root, 'web/preview/host.js'), 'utf8');
  // The host is an ES module with three exports and no imports, so it evaluates as a script once the export keyword is off. Nothing else about it is touched.
  new vm.Script(host.replace(/^export /gm, '') + '\nglobalThis.__startLeaftext = startLeaftext;\nglobalThis.__COMMANDS = COMMANDS;\nglobalThis.__answers = answers;\nglobalThis.__LATER = LATER;', {
    filename: 'host.js',
  }).runInContext(context);

  const leaf = await context.__startLeaftext({
    documents,
    name,
    read: async (path) => `# ${path}\n\nWords.\n`,
  });
  return {
    context,
    leaf,
    seen,
    asked: module_.asked,
    address: context.__address,
    send: (message) => context.window.ipc.postMessage(JSON.stringify(message)),
  };
}

const noopPost = () => {};

// How many commands the browser's own host answers, counted off its own table by the check below rather than written down twice.
let webAnswered = 0;

// The same, for the embed's own host one file over.
let embedAnswered = 0;

/** Let every promise the host started settle. A command is handed over and answered later, the way the page hands one over. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

checkSettled('the browser host opens a document, fills the pane and fills the strip', async () => {
  const { leaf, seen, asked } = await bootWebHost();
  await leaf.openDocument('notes/one.md');

  const opened = asked.find((one) => one.call === 'documentScript' && one.path === 'notes/one.md');
  if (!opened) throw new Error('opening a document never reached the module');
  if (!opened.source.includes('notes/one.md')) throw new Error('the module was handed the wrong source');
  if (!seen.state.some((one) => one.document && one.document.path === 'notes/one.md')) {
    throw new Error(`the document never reached the page as a state call: ${JSON.stringify(seen.state.map((one) => one.document && one.document.path))}`);
  }
  // The pane follows the document, the way it does in the app.
  const folder = seen.folder[seen.folder.length - 1];
  if (!folder || folder.path !== 'notes') throw new Error(`the pane was pointed at ${JSON.stringify(folder && folder.path)} instead of the document's own folder`);
  if (!folder.entries.some((entry) => entry.path === 'notes/two.md')) throw new Error('the pane listing left out a document in that folder');
  // A waiting state is a promise: the strip is drawn empty and this is what fills it.
  const pager = seen.pager[seen.pager.length - 1];
  if (!pager || !pager.html.includes('docs-pager-next')) throw new Error(`the Previous/Next strip came back empty: ${JSON.stringify(pager)}`);
  // A site serves only documents the app reads, so its count is always none — sent all the same, so the pane never has to ask who is talking.
  if (folder.skippedFiles !== 0) throw new Error(`a site handed the pane ${JSON.stringify(folder.skippedFiles)} as the files it skipped`);
});

checkSettled('the browser host follows a link inside the site and refuses one outside it', async () => {
  const { leaf, send, asked } = await bootWebHost();
  await leaf.openDocument('notes/one.md');
  const opened = () => asked.filter((one) => one.call === 'documentScript').map((one) => one.path);

  send({ command: 'openLink', href: 'two.md' });
  await settle();
  if (!opened().includes('notes/two.md')) throw new Error(`a link beside the document opened ${JSON.stringify(opened())}`);

  const before = opened().length;
  send({ command: 'openLink', href: 'https://example.com/notes/two.md' });
  await settle();
  if (opened().length !== before) throw new Error('a link off the site was followed as if it were a document here');

  // A folder link is that folder's own page, which is how the app reads one too. The resolver answers with the document and the heading the link named, so the document is read off the pair.
  const up = leaf.resolveFrom('notes/one.md', '../README.md');
  if (!up || up.path !== 'README.md') throw new Error(`a link up to the top of the site resolved to ${JSON.stringify(up)}`);
  if (up.anchor !== '') throw new Error(`a link naming no heading came back carrying ${JSON.stringify(up.anchor)}`);
});

// The site published today is folders of folders, and its contents pages link down through them — so this is the shape of link a reader meets most, and the one an href resolved against the front door sends nowhere.
checkSettled('a link written inside a folder opens the document beside it, not the one at the top of the site', async () => {
  const { leaf, send, asked } = await bootWebHost({
    documents: [
      { path: 'README.md' },
      // The same name at the top of the site: the wrong-but-listed match a resolved href opens instead.
      { path: 'volume-3/README.md' },
      { path: 'docs/collection-1/README.md' },
      { path: 'docs/collection-1/volume-3/README.md' },
      { path: 'docs/other/note.md' },
    ],
  });
  await leaf.openAddress('README.md');
  const at = () => {
    const opened = asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };

  send({ command: 'openLink', href: 'docs/collection-1/README.md' });
  await settle();
  if (at() !== 'docs/collection-1/README.md') throw new Error(`a link off the front page opened ${at()}`);

  send({ command: 'openLink', href: 'volume-3/README.md' });
  await settle();
  if (at() !== 'docs/collection-1/volume-3/README.md') throw new Error(`a link written two folders down opened ${at()}`);

  // Up two folders and across, from the document that is two folders down.
  send({ command: 'openLink', href: '../../other/note.md' });
  await settle();
  if (at() !== 'docs/other/note.md') throw new Error(`a link written up and across opened ${at()}`);
});

// What a written href carries that the address's path had already dropped, and what it does not carry that the path already had.
checkSettled('a written href keeps its heading off the file name, comes back from its encoding, and leaves a whole path alone', async () => {
  const { leaf, send, asked } = await bootWebHost({
    documents: [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }, { path: 'notes/My File.md' }],
  });
  await leaf.openDocument('notes/one.md');
  const at = () => {
    const opened = asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };

  // The cut is at the first `#`, so the heading is not read as part of the file name.
  send({ command: 'openLink', href: 'two.md#how-it-ranks' });
  await settle();
  if (at() !== 'notes/two.md') throw new Error(`a link naming a heading opened ${at()}`);

  send({ command: 'openLink', href: 'one.md?v=2' });
  await settle();
  if (at() !== 'notes/one.md') throw new Error(`a link carrying a query opened ${at()}`);

  // Nothing decodes a relative href on the way here, and the served listing holds names as they are.
  send({ command: 'openLink', href: 'My%20File.md' });
  await settle();
  if (at() !== 'notes/My File.md') throw new Error(`a hand-encoded name opened ${at()}`);

  // The Previous/Next strip writes whole paths from the top of the site rather than relative ones, and this is the fallback that carries them.
  send({ command: 'openLink', href: 'notes/two.md' });
  await settle();
  if (at() !== 'notes/two.md') throw new Error(`a Previous/Next link read from inside a folder opened ${at()}`);

  // Still refused, because a link out of the site is written with its own scheme.
  const before = at();
  send({ command: 'openLink', href: 'https://example.com/notes/two.md#top' });
  await settle();
  if (at() !== before) throw new Error(`a link off the site opened ${at()}`);
});

// A great many of a site's cross-references name a heading, and the heading used to be thrown away one line before the document opened — so the reader arrived at the top of a document long enough to have headings worth linking. Both shapes a click arrives in are here: the address the browser worked out, where the heading would otherwise go the way of the path, and the href as written, which is what a diagram's box sends.
checkSettled('a link naming a heading in another document lands on that heading rather than the top of the page', async () => {
  const { leaf, send, seen, asked, address } = await bootWebHost();
  await leaf.openAddress('notes/one.md');
  const at = () => {
    const opened = asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };
  const scrolledTo = () => seen.fragment[seen.fragment.length - 1];

  // An href written with the site's own origin: the address's path never carries a fragment, so this is where the heading was lost.
  send({ command: 'openLink', href: 'https://leaf.test/notes/two.md#how-it-ranks' });
  await settle();
  if (at() !== 'notes/two.md') throw new Error(`a link naming a heading opened ${at()}`);
  if (scrolledTo() !== 'how-it-ranks') throw new Error(`the heading never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
  if (address.location.hash !== '#notes/two.md#how-it-ranks') throw new Error(`landing on a heading wrote the address as ${address.location.hash}`);

  // The href as written, which is the shape a link inside a diagram sends.
  send({ command: 'openLink', href: '../README.md#the-top' });
  await settle();
  if (at() !== 'README.md') throw new Error(`a written href naming a heading opened ${at()}`);
  if (scrolledTo() !== 'the-top') throw new Error(`a written href's heading never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
  if (address.location.hash !== '#README.md#the-top') throw new Error(`a written href's heading wrote the address as ${address.location.hash}`);

  // The browser's own Back walks out of the landing, because it is an entry of its own.
  if (!address.history.back()) throw new Error('Back out of a heading landing went nowhere');
  await settle();
  if (address.location.hash !== '#notes/two.md#how-it-ranks') throw new Error(`Back landed on ${address.location.hash}`);
});

checkSettled('a link naming no heading opens the same document, and a folder link carrying one still finds the folder’s page', async () => {
  const { leaf, send, seen, asked, address } = await bootWebHost({
    documents: [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }, { path: 'guide/README.md' }],
  });
  await leaf.openAddress('notes/one.md');
  const at = () => {
    const opened = asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };

  send({ command: 'openLink', href: 'two.md' });
  await settle();
  if (at() !== 'notes/two.md') throw new Error(`a link naming no heading opened ${at()}`);
  if (address.location.hash !== '#notes/two.md') throw new Error(`a link naming no heading wrote the address as ${address.location.hash}`);
  const scrolls = seen.fragment.length;

  send({ command: 'openLink', href: 'https://leaf.test/README.md' });
  await settle();
  if (at() !== 'README.md') throw new Error(`an address naming no heading opened ${at()}`);
  if (seen.fragment.length !== scrolls) throw new Error('a link naming no heading was still scrolled somewhere');

  // The cut is above every fallback below it, so a folder link carrying a heading finds the folder's own page and lands on the heading.
  send({ command: 'openLink', href: '../guide#what-it-is' });
  await settle();
  if (at() !== 'guide/README.md') throw new Error(`a folder link carrying a heading opened ${at()}`);
  if (address.location.hash !== '#guide/README.md#what-it-is') throw new Error(`a folder link carrying a heading wrote the address as ${address.location.hash}`);
});

// The encoding decision, held where it would otherwise come apart. A browser writes a hash percent-encoded whatever it was handed, and the host compares the address it wrote against the one the page is at as strings — so a heading decoded on the way in disagrees with itself and the same landing is added twice, which the browser's own Back looks dead on.
checkSettled('a heading with a space in it leaves one address entry rather than two', async () => {
  const { leaf, send, seen, address } = await bootWebHost();
  await leaf.openAddress('notes/one.md');

  send({ command: 'openLink', href: 'two.md#how%20it%20ranks' });
  await settle();
  const entries = address.urls().length;
  if (address.location.hash !== '#notes/two.md#how%20it%20ranks') throw new Error(`a heading with a space wrote the address as ${address.location.hash}`);
  // Handed to the page exactly as the link had it; the page's own scroll tries it both ways.
  if (seen.fragment[seen.fragment.length - 1] !== 'how%20it%20ranks') throw new Error(`the heading was decoded on the way to the page: ${JSON.stringify(seen.fragment)}`);

  send({ command: 'openLink', href: 'two.md#how%20it%20ranks' });
  await settle();
  if (address.urls().length !== entries) throw new Error(`the same landing was added twice, leaving ${address.urls().length} entries rather than ${entries}`);
});

checkSettled('the commands sent while the host was still loading are drained, not dropped', async () => {
  // What the export's stub keeps: the front end's first commands, sent before any module script can have run. Losing them loses the first paint.
  const { seen } = await bootWebHost({
    pending: [JSON.stringify({ command: 'getFolder', path: 'notes' })],
  });
  if (!seen.folder.some((one) => one.path === 'notes')) {
    throw new Error(`a command sent while the host was loading was dropped: ${JSON.stringify(seen.folder.map((one) => one.path))}`);
  }
});

checkSettled('a command the browser host has no arm for is refused where something can see it', async () => {
  const { leaf, send, context } = await bootWebHost();
  send({ command: 'search', query: 'anything' });
  const [refusal] = leaf.refused;
  if (!refusal) throw new Error('an unanswered command was swallowed — nothing but a console line said so');
  if (refusal.command !== 'search' || refusal.kind !== context.__LATER) throw new Error(`the refusal does not say what kind it is: ${JSON.stringify(refusal)}`);
  if (!refusal.reason.includes('web-app-commands')) throw new Error(`the refusal does not name the ticket that owns it: ${refusal.reason}`);

  // The arms and the table agree about which commands are answered, which is what a page hiding its dead controls will ask.
  const answered = Object.keys(context.__COMMANDS).filter((name) => context.__answers(name));
  webAnswered = answered.length;
  const expected = [
    'openRecent',
    'openLink',
    'openGlossary',
    // The choices a site keeps, each written by the one command that owns it.
    'setSpeedReaderEnabled',
    'setCodeIntelEnabled',
    'setReadingUnlocked',
    'setCodeUnlocked',
    'setThemeFamily',
    'setThemeMode',
    'setThemeRandomBag',
    'setLibraryState',
    'setLibraryLayout',
    'getFolder',
    'loadPager',
  ];
  if (answered.join(',') !== expected.join(',')) {
    throw new Error(`the table says these are answered: ${answered.join(',')}`);
  }
  for (const name of answered) {
    send({ command: name, path: 'README.md', href: 'README.md' });
  }
  await settle();
  if (leaf.refused.length !== 1) throw new Error(`an arm the table calls answered was refused: ${JSON.stringify(leaf.refused)}`);
});

checkSettled("the browser's own Back walks the site and lands on the paragraph the reader left", async () => {
  const { leaf, send, seen, address } = await bootWebHost();
  const opened = () => seen.state.map((one) => one.document && one.document.path);
  const at = () => opened()[opened().length - 1];

  // Arriving is not a step the reader took, so the entry they arrived on is replaced rather than added to.
  await leaf.openAddress('README.md');
  if (address.urls().length !== 1) throw new Error(`landing on the site left ${address.urls().length} entries instead of the one the reader arrived on`);

  const walk = [
    { href: 'notes/one.md', place: { section: 'readme-top', block: 3, offsetY: 12 } },
    { href: 'two.md', place: { section: 'one-middle', block: 1, offsetY: 4 } },
    { href: '#deep-heading', place: { section: 'two-middle', block: 2, offsetY: 8 } },
  ];
  for (const step of walk) {
    send({ command: 'openLink', href: step.href, scroll_anchor: step.place });
    await settle();
  }
  if (address.urls().length !== 4) throw new Error(`three steps through the site left ${address.urls().length} entries, so the browser's own Back has nowhere to go`);
  if (address.location.hash !== '#notes/two.md#deep-heading') throw new Error(`a heading jump wrote the address as ${address.location.hash}`);

  // Walking back: each entry says which document, and where the reader was when they left it.
  const back = () => {
    const moved = address.history.back();
    return moved;
  };
  if (!back()) throw new Error('the first Back went nowhere');
  await settle();
  if (address.location.hash !== '#notes/two.md') throw new Error(`Back out of a heading jump landed on ${address.location.hash}`);
  if ((seen.place[seen.place.length - 1] || {}).section !== 'two-middle') throw new Error(`Back landed at the top rather than the paragraph: ${JSON.stringify(seen.place[seen.place.length - 1])}`);

  if (!back()) throw new Error('the second Back went nowhere');
  await settle();
  if (at() !== 'notes/one.md') throw new Error(`the second Back opened ${at()}`);
  if ((seen.place[seen.place.length - 1] || {}).section !== 'one-middle') throw new Error('the second Back lost the place the reader left');

  if (!back()) throw new Error('the third Back went nowhere');
  await settle();
  if (at() !== 'README.md') throw new Error(`the third Back opened ${at()} rather than the document the reader landed on`);
  if ((seen.place[seen.place.length - 1] || {}).section !== 'readme-top') throw new Error('the third Back lost the place the reader left');

  // The fourth is the arrival itself: nothing behind it, and nothing that walks off the site.
  const documents = opened().length;
  if (back()) throw new Error('a fourth Back walked off the site instead of stopping at the arrival');
  await settle();
  if (opened().length !== documents) throw new Error('a Back with nothing behind it still opened a document');
});

checkSettled('a link to a heading inside the document reaches the page rather than the document resolver', async () => {
  const { leaf, send, seen, asked, address } = await bootWebHost();
  await leaf.openAddress('notes/one.md');
  const renders = () => asked.filter((one) => one.call === 'documentScript').length;
  const before = renders();

  send({ command: 'openLink', href: '#a-heading', scroll_anchor: { section: 'one-top', block: 0, offsetY: 0 } });
  await settle();
  if (!seen.fragment.includes('a-heading')) throw new Error(`a heading link never reached the page's own scroll: ${JSON.stringify(seen.fragment)}`);
  // A bare fragment put through the document resolver matches nothing and becomes a console line, so it must never reach it.
  if (renders() !== before) throw new Error('a heading link was put through the document resolver and opened something');
  if (address.location.hash !== '#notes/one.md#a-heading') throw new Error(`a heading jump wrote the address as ${address.location.hash}`);
});

/** The choices a published site keeps, and the command that owns each. Ten keys across nine commands: the pane's two travel together. */
const KEPT_CHOICES = [
  [{ command: 'setSpeedReaderEnabled', enabled: true }, { speedReaderEnabled: true }],
  [{ command: 'setCodeIntelEnabled', enabled: true }, { codeIntelEnabled: true }],
  [{ command: 'setReadingUnlocked', enabled: true }, { readingUnlocked: true }],
  [{ command: 'setCodeUnlocked', enabled: true }, { codeUnlocked: true }],
  [{ command: 'setThemeFamily', family: 'amaranth' }, { themeFamily: 'amaranth' }],
  [{ command: 'setThemeMode', mode: 'dark' }, { themeMode: 'dark' }],
  [{ command: 'setThemeRandomBag', used: ['fern', 'github'] }, { themeRandomUsed: ['fern', 'github'] }],
  [{ command: 'setLibraryState', projectPath: 'notes' }, { libraryProjectPath: 'notes' }],
  [{ command: 'setLibraryLayout', closed: true, width: 320 }, { libraryClosed: true, libraryWidth: 320 }],
];

check('a site puts every choice a reader kept back on the page, and a storage that refuses leaves the defaults', () => {
  const defaults = {
    speedReaderEnabled: false,
    codeIntelEnabled: false,
    readingUnlocked: false,
    codeUnlocked: false,
    themeFamily: 'fern',
    themeMode: 'system',
    themeRandomUsed: [],
    libraryProjectPath: '',
    libraryClosed: false,
    libraryWidth: 280,
    // Nothing a site sends, so nothing the store carries: it has to come through untouched.
    updateLastChecked: 0,
  };
  /** The store the site reads back, run the way the page runs it: a classic script, above everything, over the defaults the page was handed. */
  const restore = (localStorage) => {
    const sandbox = { __leafSettings: Object.assign({}, defaults), localStorage, JSON, Object, Array };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    new vm.Script(readFileSync(join(root, 'web/preview/settings.js'), 'utf8'), { filename: 'settings.js' }).runInContext(context);
    return sandbox;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const kept = Object.assign({}, ...KEPT_CHOICES.map(([, keys]) => keys));
  const back = restore({ getItem: () => JSON.stringify(kept), setItem() {} });
  for (const [key, value] of Object.entries(kept)) {
    if (!same(back.__leafSettings[key], value)) {
      throw new Error(`${key} came back as ${JSON.stringify(back.__leafSettings[key])} rather than ${JSON.stringify(value)}`);
    }
  }
  if (back.__leafSettings.updateLastChecked !== 0) throw new Error('a default the store says nothing about was lost');

  // A store that refuses every touch — a browser with it turned off, or a page inside a frame that cannot reach it. The site reads on defaults rather than failing to boot, and a save is swallowed rather than thrown.
  const refused = restore({
    getItem() {
      throw new Error('storage is not available');
    },
    setItem() {
      throw new Error('storage is not available');
    },
  });
  for (const [key, value] of Object.entries(defaults)) {
    if (!same(refused.__leafSettings[key], value)) throw new Error(`a refused store lost the default for ${key}`);
  }
  refused.__leafSaveSettings({ themeMode: 'dark' });
  if (refused.__leafSettings.themeMode !== 'dark') throw new Error('a choice made against a refused store did not even hold for this reading');

  // A store holding something this version cannot read is the same case as no store at all.
  const junk = restore({ getItem: () => '["not an object"]', setItem() {} });
  if (junk.__leafSettings.themeFamily !== 'fern') throw new Error('a store holding the wrong shape overwrote the defaults');
});

checkSettled('each choice a site keeps is written by the one command that owns it', async () => {
  const { context, send } = await bootWebHost();
  const writes = [];
  context.window.__leafSaveSettings = (changed) => writes.push(changed);
  for (const [message, expected] of KEPT_CHOICES) {
    writes.length = 0;
    send(message);
    await settle();
    if (writes.length !== 1) throw new Error(`${message.command} wrote the store ${writes.length} times`);
    if (JSON.stringify(writes[0]) !== JSON.stringify(expected)) {
      throw new Error(`${message.command} wrote ${JSON.stringify(writes[0])} rather than ${JSON.stringify(expected)}`);
    }
  }
});

check("a published page fills its settings global above the page's own theme bootstrap, so a restored theme reaches the first paint", () => {
  // The bootstrap's own source stands in, so what is being read is where the tag sits rather than what is inside it.
  const page = sitePage(pageMarkup().replace('{{THEME_BOOTSTRAP_SCRIPT}}', 'window.__leafThemeResolved=1;'), 'window.__leafSettings={};');
  const order = [
    // The queue first: the theme bootstrap posts its random-theme draw, and without the stub already standing that message is lost.
    'window.__leafPending',
    'window.__leafSettings={}',
    'window.__leafSite',
    'assets/settings.js',
    // Only then the paint.
    'window.__leafThemeResolved',
    // The app's own script, and the host's loader under it.
    '{{APP_SCRIPT_URL}}',
    'assets/boot.js',
  ];
  let at = -1;
  for (const mark of order) {
    const found = page.indexOf(mark);
    if (found === -1) throw new Error(`the published page is missing ${mark}`);
    if (found < at) throw new Error(`${mark} landed above something that has to come before it`);
    at = found;
  }
  if (!page.includes(`content="${POLICY}"`)) throw new Error("the published page kept the desktop's own content policy");
  // A page that stopped leading with its own bootstrap is refused rather than injected into the wrong place.
  let refused = null;
  try {
    sitePage('<head><script src="elsewhere.js"></script></head><body></body>', 'x');
  } catch (error) {
    refused = error;
  }
  if (!refused) throw new Error('a page with no theme bootstrap to inject above was shaped anyway');
});

checkSettled("the trail's first word is the site's own name, and the desktop's word is untouched", async () => {
  const site = await bootWebHost({ name: 'Emptyguru' });
  await site.leaf.openAddress('README.md');
  const payload = site.seen.folder[site.seen.folder.length - 1];
  if (!payload || payload.rootName !== 'Emptyguru') {
    throw new Error(`the pane was handed ${JSON.stringify(payload && payload.rootName)} as the name of its root`);
  }
  if (site.context.libraryRootLabel() !== 'Emptyguru') throw new Error(`a site's trail starts with ${site.context.libraryRootLabel()}`);
  // And it reaches the trail itself, not only the label the trail asks.
  if (site.context.crumbSegments([]).map((one) => one.name).join(',') !== 'Emptyguru') {
    throw new Error('the name never reached the crumbs the trail is drawn from');
  }

  // A host that sends none — every desktop launch — keeps the word the app has always used.
  const plain = await bootWebHost();
  await plain.leaf.openAddress('README.md');
  if (plain.context.libraryRootLabel() !== 'Library') throw new Error(`the desktop's trail now starts with ${plain.context.libraryRootLabel()}`);

  // A vault still wins: on the desktop the root is the vault you are standing in.
  plain.context.leafSetVaults({ vaults: [{ id: 4, name: 'Notes' }], active: 4 });
  if (plain.context.libraryRootLabel() !== 'Notes') throw new Error('a vault stopped naming the root it is standing in');
});

checkSettled('a link to a folder opens its own page, or its first document when it has none', async () => {
  // `notes` is listed with two before one, so the fallback proves it follows the listing's own order rather than sorting a fresh one — that order is the Previous/Next strip's, and the two must not disagree.
  const { leaf, send, asked } = await bootWebHost({
    documents: [
      { path: 'README.md' },
      { path: 'guide/README.md' },
      { path: 'guide/deep.md' },
      { path: 'notes/two.md' },
      { path: 'notes/one.md' },
    ],
  });
  await leaf.openAddress('README.md');
  const at = () => {
    const opened = asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };

  send({ command: 'openLink', href: 'guide' });
  await settle();
  if (at() !== 'guide/README.md') throw new Error(`a folder with a page of its own opened ${at()}`);

  send({ command: 'openLink', href: '../notes' });
  await settle();
  if (at() !== 'notes/two.md') throw new Error(`a folder with no page of its own opened ${at()} rather than the first document listed under it`);

  // A folder that is not one still reports nothing rather than opening a neighbor whose name it is the start of.
  const before = at();
  send({ command: 'openLink', href: '../note' });
  await settle();
  if (at() !== before) throw new Error(`a link to nothing opened ${at()}`);
});

checkSettled('the browser host raises the glossary out of the text it was handed', async () => {
  const { leaf, send, asked } = await bootWebHost();
  leaf.core.setGlossary('## Vault\n\nA folder you named.\n');
  send({ command: 'openGlossary', href: 'glossary:vault' });
  await settle();
  const raised = asked.find((one) => one.call === 'glossaryScript');
  if (!raised) throw new Error('the glossary command never reached the module');
  if (raised.href !== 'glossary:vault') throw new Error(`the term was lost on the way: ${raised.href}`);
  if (!raised.glossary.includes('A folder you named.')) throw new Error('the glossary text never crossed into the module');
});

// ---- the embed's own host ---------------------------------------------------
//
// `web/embed/host.js` is the third half of the same bargain: the app's own front end in a frame somebody else's product owns, over a document buffer in the module, with the save handed back to whoever mounted it.
//
// It is handed a loaded module rather than loading one, so the stand-in here is a plain object rather than a linear memory — what is under test is the host's dispatch and the page calls that follow it. The arithmetic under each of those edits is held to the desktop's own bytes in `web/buffer.json`, walked by a test beside the fixtures and by `scripts/build-web.mjs` against the built module, so nothing about it needs proving twice.

const EMBED_SOURCE = '# Notes\n\n- [ ] one task\n\nThe last paragraph.\n';

/** A stand-in for the browser module's buffer. It applies the edits whose *text* a check below reads back, records every edit it is handed for the checks that read the dispatch, and reports any known edit as one that moved the buffer so the redraw path runs either way. */
function standInEmbedModule({ source = EMBED_SOURCE, path = 'notes.md', mark = false } = {}) {
  const asked = [];
  const KNOWN = new Set(['splice', 'block', 'text', 'task', 'field', 'move', 'undo']);
  let text = source;
  let saved = source;
  let open = false;
  // Every undoable edit's buffer, newest last — the same shape the library's own stack has.
  const history = [];

  const state = () => ({
    path,
    dirty: text !== saved,
    canUndo: history.length > 0,
    tasks: [],
    utf16Len: text.length,
    spelling: { encoding: 'utf8', mark },
  });

  /** The edits whose text a check reads back. This document is ASCII, so a block's byte range and a JavaScript string index are the same number; the real module is held to a fixture with an emoji in it for exactly the case where they are not. */
  const apply = (edit) => {
    switch (edit.edit) {
      case 'block':
        history.push(text);
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
        return;
      case 'splice':
        text = text.slice(0, edit.start) + edit.inserted + text.slice(edit.start + edit.removed);
        return;
      case 'text':
        text = edit.text;
        return;
      case 'task':
        text = text.replace('- [ ]', '- [x]');
        return;
      case 'undo':
        if (history.length) text = history.pop();
        return;
      default:
        return;
    }
  };

  return {
    asked,
    text: () => text,
    setGlossary: (glossary) => asked.push({ call: 'setGlossary', glossary }),
    glossaryScript: (href) => {
      asked.push({ call: 'glossaryScript', href });
      return `window.__leafGlossary = ${JSON.stringify({ href })};`;
    },
    buffer: {
      open: (given, name) => {
        asked.push({ call: 'open', path: name });
        open = true;
        return 1;
      },
      close: () => {
        open = false;
      },
      source: () => (open ? text : null),
      encoded: () => (open ? new TextEncoder().encode((mark ? '﻿' : '') + text) : null),
      state: () => (open ? state() : null),
      render: () => ({ title: 'Notes', path, html: `<p>${text}</p>`, blocks: [], tasks: [] }),
      edit: (handle, edit) => {
        asked.push({ call: 'edit', edit });
        const before = text;
        apply(edit);
        return { ...state(), changed: text !== before || KNOWN.has(edit.edit) };
      },
      // The two lines the real module builds in Rust, in the shape the page reads them.
      documentScript: () =>
        `window.leafSetState(${JSON.stringify(standInState(path))});\nwindow.leafBlocksResynced(${JSON.stringify({ tasks: [], dirty: text !== saved, canUndo: history.length > 0, source: null })});`,
      saveScript: (handle, ok, error) => {
        if (ok) {
          saved = text;
          history.length = 0;
        }
        // The reply and the editing state, both, exactly as the real module answers: a page told the save came back and left with a lit Save button is a page that reads as unsaved.
        return `window.leafSaved(${JSON.stringify(path)}, ${!!ok}, ${error ? JSON.stringify(error) : 'null'});\nwindow.leafBlocksResynced(${JSON.stringify({ tasks: [], dirty: text !== saved, canUndo: history.length > 0, source: null })});`;
      },
    },
  };
}

/** The embed host, in a page that has what a mounted frame has. `save` is whatever the product does with the document; leaving it out is a reader that never persists. */
async function bootEmbedHost({ save = null, glossary = '', pending = [], module = null, path = 'notes.md', mark = false } = {}) {
  const stand = module || standInEmbedModule({ path, mark });
  const context = runShell(source, { __leafEmbedded: true, __leafPending: [...pending] });
  context.window.ipc = { postMessage: noopPost };

  // Everything the host hands the page, recorded on the way through. The state call is recorded and not run, for the reason the site host's is: it renders a whole document, and nothing is rendered on this page for it to render into.
  const seen = { state: [], resynced: [], saved: [], pager: [] };
  const watch = (name, into) => {
    context.window[name] = (...payload) => into.push(payload.length > 1 ? payload : payload[0]);
  };
  watch('leafSetState', seen.state);
  watch('leafBlocksResynced', seen.resynced);
  watch('leafSaved', seen.saved);
  watch('leafSetPager', seen.pager);

  const host = readFileSync(join(root, 'web/embed/host.js'), 'utf8');
  // The host is an ES module with four exports and no imports, so it evaluates as a script once the export keyword is off. That it has no imports is the point — see the file's own note.
  new vm.Script(host.replace(/^export /gm, '') + '\nglobalThis.__startLeaftextEmbed = startLeaftextEmbed;\nglobalThis.__embedCOMMANDS = COMMANDS;\nglobalThis.__embedAnswers = answers;', {
    filename: 'embed-host.js',
  }).runInContext(context);

  const events = [];
  const leaf = context.__startLeaftextEmbed({
    module: stand,
    source: EMBED_SOURCE,
    path,
    glossary,
    save,
    onEvent: (event) => events.push(event),
  });
  return {
    context,
    leaf,
    stand,
    seen,
    events,
    asked: stand.asked,
    send: (message) => context.window.ipc.postMessage(JSON.stringify(message)),
  };
}

check('an embedded page draws the document and nothing around it', () => {
  const embedded = runShell(source, { __leafEmbedded: true });
  if (!embedded.document.body.classList.contains('is-embedded')) {
    throw new Error('an embedded page never marked its body, so the stylesheet has nothing to read');
  }
  // The stylesheet is what takes the bar, the pane, the handle and the floating toolbar down, so what it aims at has to exist.
  const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
  for (const wanted of ['body.is-embedded .app-bar', 'body.is-embedded .library-pane', 'body.is-embedded .library-divider', 'body.is-embedded .reader-toolbar', 'body.is-embedded .library-shell']) {
    if (!css.includes(wanted)) throw new Error(`the stylesheet no longer has a rule for ${wanted}, so an embed would draw it`);
  }
  // A window is not an embed, and the mark must not appear in one.
  if (booted.document.body.classList.contains('is-embedded')) throw new Error('the app in a window marked itself embedded');
});

checkSettled('the embed host hands the caller the whole document with its spelling, not the splice', async () => {
  const written = [];
  const { send, seen, stand } = await bootEmbedHost({ mark: true, save: async (document) => written.push(document) });

  // Typing into a block: the page sends the range it replaced, and what the caller is handed is the document.
  send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
  await settle();
  send({ command: 'saveDocument' });
  await settle();

  if (written.length !== 1) throw new Error(`the caller was handed ${written.length} saves for one Save`);
  const handed = written[0];
  if (handed.text !== stand.text()) throw new Error(`the caller was handed ${JSON.stringify(handed.text)} rather than the document`);
  if (!handed.text.includes('The last line.')) throw new Error('the caller was handed a document without the edit in it');
  if (!handed.text.includes('# Notes')) throw new Error('the caller was handed the splice rather than the whole document');
  // The spelling travels with it, so a product holding a file cannot re-spell somebody's document by saving it.
  if (handed.spelling.encoding !== 'utf8' || handed.spelling.mark !== true) throw new Error(`the spelling was lost: ${JSON.stringify(handed.spelling)}`);
  if (handed.bytes[0] !== 0xef || handed.bytes[1] !== 0xbb || handed.bytes[2] !== 0xbf) throw new Error('the bytes came back without the mark the document arrived with');

  // And the page is told, so the Save button goes out.
  const reply = seen.saved[seen.saved.length - 1];
  if (!reply || reply[1] !== true) throw new Error(`the page was told the save came back as ${JSON.stringify(reply)}`);
  const resynced = seen.resynced[seen.resynced.length - 1];
  if (!resynced || resynced.dirty !== false) throw new Error(`a saved document still reports dirty: ${JSON.stringify(resynced)}`);
});

checkSettled('a save the product refuses leaves the document as it was typed and says why', async () => {
  const { send, seen } = await bootEmbedHost({
    save: async () => {
      throw new Error('the server said no');
    },
  });
  send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
  await settle();
  send({ command: 'saveDocument' });
  await settle();

  const reply = seen.saved[seen.saved.length - 1];
  if (!reply) throw new Error('a refused save told the page nothing at all');
  if (reply[1] !== false) throw new Error(`a refused save was reported to the page as ${JSON.stringify(reply)}`);
  if (!String(reply[2]).includes('the server said no')) throw new Error(`the reason never reached the page: ${JSON.stringify(reply)}`);
  const resynced = seen.resynced[seen.resynced.length - 1];
  if (!resynced || resynced.dirty !== true) throw new Error('a refused save cleared the Save button, so the reader would think it was written');
});

/** Every editing command the page can send, and the edit the buffer has to be handed for it. The desktop's own arms are the other side of each of these. */
const EMBED_EDITS = [
  [{ command: 'editBlock', start: 0, end: 7, text: '# Retitled' }, { edit: 'block', start: 0, end: 7, text: '# Retitled', undo: true }],
  [{ command: 'toggleTask', index: 0 }, { edit: 'task', index: 0 }],
  [{ command: 'setField', key: 'title', value: 'Notes' }, { edit: 'field', key: 'title', set: 'Notes' }],
  [{ command: 'setField', key: 'title' }, { edit: 'field', key: 'title', remove: true }],
  [{ command: 'setListField', key: 'tags', items: ['one'] }, { edit: 'field', key: 'tags', items: ['one'] }],
  [{ command: 'renameField', key: 'title', to: 'heading' }, { edit: 'field', key: 'title', rename: 'heading' }],
  [{ command: 'moveBlock', ranges: [[0, 7], [9, 20]], from: 1, to: 0 }, { edit: 'move', ranges: [[0, 7], [9, 20]], from: 1, to: 0 }],
  [{ command: 'undoEdit' }, { edit: 'undo' }],
  [{ command: 'updateSource', text: '# Whole\n' }, { edit: 'text', text: '# Whole\n' }],
];

checkSettled('every editing command reaches the buffer as the edit the desktop makes for it', async () => {
  for (const [command, wanted] of EMBED_EDITS) {
    const { send, asked } = await bootEmbedHost({ save: async () => {} });
    send(command);
    await settle();
    const made = asked.filter((one) => one.call === 'edit').map((one) => one.edit);
    const found = made.find((edit) => edit.edit === wanted.edit);
    if (!found) throw new Error(`${command.command} reached the buffer as ${JSON.stringify(made)} rather than a ${wanted.edit} edit`);
    for (const [key, value] of Object.entries(wanted)) {
      if (JSON.stringify(found[key]) !== JSON.stringify(value)) {
        throw new Error(`${command.command} sent ${key} as ${JSON.stringify(found[key])} rather than ${JSON.stringify(value)}`);
      }
    }
  }
});

checkSettled('an edit that writes itself reaches the caller without a Save press, and an undoable one does not', async () => {
  const writes = [];
  const { send } = await bootEmbedHost({ save: async () => writes.push('save') });
  // A checkbox writes itself on the desktop, and an embed draws no Save button for a reader to press instead.
  send({ command: 'toggleTask', index: 0 });
  await settle();
  if (writes.length !== 1) throw new Error(`a task toggle handed the caller ${writes.length} saves rather than one`);
  send({ command: 'editBlock', start: 0, end: 7, text: '# Retitled' });
  await settle();
  if (writes.length !== 1) throw new Error('an ordinary block edit wrote itself, so nothing would be left for Save to do');
});

checkSettled('a waiting state is a promise: an embed answers the strip rather than leaving it spinning', async () => {
  const { send, seen } = await bootEmbedHost();
  send({ command: 'loadPager', path: 'notes.md' });
  await settle();
  const strip = seen.pager[seen.pager.length - 1];
  if (!strip) throw new Error('the strip was never answered, so an embedded document keeps a skeleton for ever');
  if (strip.html !== '') throw new Error(`an embed has no neighbors and answered with ${JSON.stringify(strip.html)}`);
});

checkSettled('a link inside an embedded document goes to the product, and the glossary is raised out of the text it was handed', async () => {
  const { send, events, asked } = await bootEmbedHost({ glossary: '## Vault\n\nA folder you named.\n' });
  send({ command: 'openLink', href: 'other.md', scroll_anchor: { section: '', block: 0, offsetY: 0 } });
  await settle();
  const followed = events.find((event) => event.kind === 'link');
  if (!followed) throw new Error('a link a reader clicked reached nobody');
  if (followed.href !== 'other.md') throw new Error(`the link arrived as ${JSON.stringify(followed.href)}`);

  if (!asked.some((one) => one.call === 'setGlossary' && one.glossary.includes('A folder you named.'))) {
    throw new Error('the glossary text never crossed into the module');
  }
  send({ command: 'openGlossary', href: 'glossary:vault' });
  await settle();
  if (!asked.some((one) => one.call === 'glossaryScript' && one.href === 'glossary:vault')) {
    throw new Error('the glossary command never reached the module with its term');
  }
});

checkSettled('the embed host refuses what an embed has no business doing, with the reason off its own table', async () => {
  const { send, leaf, context } = await bootEmbedHost();
  for (const command of ['search', 'createVault', 'getFolder', 'closeTab', 'applyUpdate']) {
    send({ command });
  }
  await settle();
  if (leaf.refused.length !== 5) throw new Error(`five commands an embed cannot answer produced ${leaf.refused.length} refusals`);
  for (const one of leaf.refused) {
    if (!one.reason || one.reason === 'no line in the command table') {
      throw new Error(`${one.command} was refused with no reason: ${JSON.stringify(one)}`);
    }
    if (one.kind !== 'refused') throw new Error(`${one.command} came back as ${one.kind} rather than a refusal`);
  }
  // Every command the table says is answered has an arm, which is the one thing the parity gate cannot see.
  embedAnswered = Object.keys(context.__embedCOMMANDS).filter((name) => context.__embedAnswers(name)).length;
  const armless = Object.entries(context.__embedCOMMANDS)
    .filter(([name, [kind]]) => kind === 'answered' && !context.__embedAnswers(name))
    .map(([name]) => name);
  if (armless.length) throw new Error(`the table says these are answered: ${armless.join(', ')}`);
  const sent = [];
  for (const [name, [kind]] of Object.entries(context.__embedCOMMANDS)) {
    if (kind !== 'answered') continue;
    sent.push(name);
  }
  const before = leaf.refused.length;
  for (const name of sent) send({ command: name, index: 0, key: 'k', ranges: [], href: '', path: 'notes.md', text: '', start: 0, end: 0, removed: 0, inserted: '', length: 0, items: [], to: 'x', enabled: true, family: 'fern', mode: 'dark', used: [] });
  await settle();
  if (leaf.refused.length !== before) {
    throw new Error(`a command the table says is answered had no arm: ${leaf.refused.slice(before).map((one) => one.command).join(', ')}`);
  }
});

checkSettled('an embed with no save callback says so rather than reporting a document written', async () => {
  const { send, seen } = await bootEmbedHost();
  send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
  await settle();
  send({ command: 'saveDocument' });
  await settle();
  if (seen.saved.length) throw new Error(`a reader with nowhere to save told the page it saved: ${JSON.stringify(seen.saved)}`);
});

checkSettled('the front end sends its first commands before the host is standing, and the embed host drains them', async () => {
  const { seen } = await bootEmbedHost({ pending: [JSON.stringify({ command: 'loadPager', path: 'notes.md' })] });
  await settle();
  if (!seen.pager.length) throw new Error('a command sent while the host was loading was thrown away');
});

// ---- the app's own box, not the window's ------------------------------------

check('a menu opened hard against the edge lands inside the app, not inside the window', () => {
  const win = booted.window;
  const surface = win.document.getElementById('appSurface');
  if (!surface) throw new Error('the page has no app surface to place anything inside');
  // The app, inset from a 1080x820 window the way the shadow band insets it: 20px at the sides, 13px above, 10px below.
  const room = { left: 20, top: 13, right: 1060, bottom: 810, width: 1040, height: 797 };
  const was = surface.getBoundingClientRect;
  surface.getBoundingClientRect = () => room;
  const place = (x, y) => {
    const box = { hidden: true, offsetWidth: 200, offsetHeight: 120, style: {} };
    win.leafPlaceFloating(box, x, y);
    return box.style;
  };
  try {
    // Asked for past the app's own right and bottom edges: held inside it, with the 8px margin, in the app's own coordinates.
    const corner = place(1075, 805);
    if (corner.left !== '832px' || corner.top !== '669px') {
      throw new Error(`a menu at the edge landed at ${corner.left},${corner.top} instead of inside the app at 832px,669px`);
    }
    // Asked for at a point well inside: the window's number crosses into the app's, so the menu opens where the pointer is rather than 20px off it.
    const inside = place(120, 213);
    if (inside.left !== '100px' || inside.top !== '200px') {
      throw new Error(`a menu inside the app opened at ${inside.left},${inside.top} rather than under the pointer at 100px,200px`);
    }
    // Asked for above and left of the app entirely: the margin, never a negative offset that would put it under the shadow.
    const before = place(0, 0);
    if (before.left !== '8px' || before.top !== '8px') {
      throw new Error(`a menu asked for outside the app opened at ${before.left},${before.top} rather than at the margin`);
    }
  } finally {
    surface.getBoundingClientRect = was;
  }
});

// ---- the shadow band is the window's edge -----------------------------------

/** A Windows shell whose app box is inset from the window the way the band insets it, with every command it sends recorded. */
function bandPress({ frameless = true, macFrame = false, maximized = false } = {}) {
  const sent = [];
  const context = runShell(source, {
    __leafFrameless: frameless,
    __leafMacFrame: macFrame,
    ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
  });
  const surface = context.document.getElementById('appSurface');
  // 20px at the sides, 13px above and 10px below a 1080x820 window — the band's own sizes. The rectangle takes in the app's own drawn line, which is the hairline the page reads back off the element.
  surface.getBoundingClientRect = () => ({ left: 20, top: 13, right: 1060, bottom: 810, width: 1040, height: 797 });
  surface.clientTop = 1;
  surface.clientLeft = 1;
  if (maximized) context.document.body.classList.contains = (name) => name === 'is-maximized';
  // Everything the page has is inside one fixed box, so the body has no height of its own and a press in the band lands on the page root above it. Raised on the document, which is where the page has to be listening for one at all.
  const raise = (type, event) => {
    const held = context.document.listeners.get(type) || [];
    if (!held.length) throw new Error(`nothing on the page is watching the document for a ${type}`);
    for (const handler of held) handler(event);
  };
  const press = (x, y) => {
    sent.length = 0;
    let prevented = false;
    raise('mousedown', { button: 0, clientX: x, clientY: y, target: context.document.documentElement, preventDefault: () => (prevented = true) });
    return { sent: [...sent], prevented };
  };
  const move = (x, y) => {
    raise('mousemove', { clientX: x, clientY: y, target: context.document.documentElement });
    return context.document.documentElement.style.cursor;
  };
  const watching = (type) => (context.document.listeners.get(type) || []).length;
  // A whole drag, the way a Mac page follows one: a press, moves, and the release. The screen point rides on every part of it, and the pointer is captured so a drag outward keeps reporting once it has left the window.
  const captured = [];
  context.document.documentElement.setPointerCapture = (id) => captured.push(id);
  const pointer = (type, x, y, screen) =>
    raise(type, {
      button: 0,
      isPrimary: true,
      pointerId: 7,
      clientX: x,
      clientY: y,
      screenX: screen ? screen[0] : x,
      screenY: screen ? screen[1] : y,
      preventDefault: () => {},
    });
  const drag = (from, steps) => {
    sent.length = 0;
    pointer('pointerdown', from[0], from[1], from);
    for (const step of steps) pointer('pointermove', step[0], step[1], step);
    pointer('pointerup', from[0], from[1], from);
    return { sent: [...sent], captured: [...captured] };
  };
  return { context, press, move, watching, drag };
}

/** Only the resize asks: other fragments watch the document for a press too, and a click anywhere is allowed to close a menu. */
const resizeAsks = (sent) => sent.filter((message) => message.command === 'windowResizeDrag');

check('a press in the shadow band asks for the resize its own edge means', () => {
  const band = bandPress();
  const direction = (x, y) => {
    const { sent, prevented } = band.press(x, y);
    const asks = resizeAsks(sent);
    if (asks.length !== 1) throw new Error(`a press at ${x},${y} asked for ${asks.length} resizes`);
    // Without this the drag sweeps a selection across the page under the band instead of resizing.
    if (!prevented) throw new Error(`a press at ${x},${y} left the page free to start a selection`);
    return asks[0].direction;
  };
  const cases = [
    [540, 4, 'n'],
    [1070, 4, 'ne'],
    [1070, 400, 'e'],
    [1070, 815, 'se'],
    [540, 815, 's'],
    [4, 815, 'sw'],
    [4, 400, 'w'],
    [4, 4, 'nw'],
  ];
  for (const [x, y, want] of cases) {
    const got = direction(x, y);
    if (got !== want) throw new Error(`a press at ${x},${y} asked for ${got} rather than ${want}`);
  }
  // Inside the app is the document, a control or a menu — never a resize.
  const inside = band.press(540, 400);
  if (resizeAsks(inside.sent).length !== 0) throw new Error('a press inside the app asked for a resize');
  if (inside.prevented) throw new Error('a press inside the app was swallowed');
});

check('the pointer says the band can be grabbed before anyone presses it', () => {
  const band = bandPress();
  const shape = (x, y) => band.move(x, y) || '';
  const cases = [
    [540, 4, 'n-resize'],
    [1070, 4, 'ne-resize'],
    [1070, 400, 'e-resize'],
    [1070, 815, 'se-resize'],
    [540, 815, 's-resize'],
    [4, 815, 'sw-resize'],
    [4, 400, 'w-resize'],
    [4, 4, 'nw-resize'],
  ];
  for (const [x, y, want] of cases) {
    const got = shape(x, y);
    if (got !== want) throw new Error(`the pointer at ${x},${y} read ${got || 'the arrow'} rather than ${want}`);
  }
  // Back inside the app it is the arrow again, or the band leaves a resize pointer over the whole document.
  if (shape(540, 400) !== '') throw new Error('the resize pointer followed the pointer into the app');
});

check('the line the app draws round itself resizes rather than being the first dead pixel', () => {
  const band = bandPress();
  // The app box runs 20,13 to 1060,810 and its own hairline is the outermost pixel of that.
  const onTheLine = [
    [540, 13, 'n'],
    [1059, 400, 'e'],
    [540, 809, 's'],
    [20, 400, 'w'],
    [20, 13, 'nw'],
    [1059, 809, 'se'],
  ];
  for (const [x, y, want] of onTheLine) {
    const asks = resizeAsks(band.press(x, y).sent);
    if (asks.length !== 1) throw new Error(`the drawn line at ${x},${y} is still dead`);
    if (asks[0].direction !== want) throw new Error(`the drawn line at ${x},${y} asked for ${asks[0].direction} rather than ${want}`);
  }
  // Just inside it is the app: a press there is the document, a control or a menu.
  for (const [x, y] of [[540, 14], [1058, 400], [540, 808], [21, 400]]) {
    if (resizeAsks(band.press(x, y).sent).length !== 0) throw new Error(`a press inside the app at ${x},${y} asked for a resize`);
  }
});

check('a window filling the screen asks for no resize', () => {
  // No band to grab, and the platform refuses the resize anyway.
  const full = bandPress({ maximized: true });
  if (resizeAsks(full.press(4, 4).sent).length !== 0) throw new Error('a maximized window still asked for a resize');
});

check('a Mac follows the whole drag, and Windows hands the press over and hears no more', () => {
  const mac = bandPress({ frameless: false, macFrame: true });
  const { sent, captured } = mac.drag([4, 400], [[0, 400], [-30, 400]]);
  const asks = resizeAsks(sent);
  const phases = asks.map((one) => one.phase).join(' ');
  if (phases !== 'start move move end') throw new Error(`a Mac drag sent ${phases || 'nothing'}`);
  if (asks.some((one) => one.direction !== 'w')) throw new Error('a phase of the drag forgot which edge it was grabbed by');
  // The screen point is what the host works the new window rectangle out from.
  if (asks[2].x !== -30 || asks[2].y !== 400) throw new Error(`the move carried ${asks[2].x},${asks[2].y} rather than the pointer on the screen`);
  // Without the capture the moves stop at the edge the drag started from, so a window can never be dragged bigger.
  if (!captured.length) throw new Error('the pointer was never captured, so a drag outward stops at the window edge');

  // Windows hands the window to the platform's own loop on the press, which swallows everything after it.
  const windows = bandPress();
  const only = resizeAsks(windows.press(4, 400).sent);
  if (only.length !== 1 || only[0].phase !== 'start') throw new Error('a Windows press is no longer the whole of what it sends');
  // Other fragments watch the document for a moving pointer too, so it is the extra watch a Mac page takes that says which of the two is following the drag.
  if (mac.watching('pointermove') <= windows.watching('pointermove')) {
    throw new Error('a Windows page is following a drag the platform already owns, or a Mac page is not following one at all');
  }
});

// ---- report -----------------------------------------------------------------

await Promise.all(settled);

if (failures.length) {
  console.error('front-end check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`front-end: ${names.length} fragments parse, boot, and agree on edit offsets — and the two browser hosts answer ${webAnswered} commands for a published site and ${embedAnswered} for an embedded document, each over a stand-in module`);
