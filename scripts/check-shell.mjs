// Run the WebView front-end: does it parse, does it boot, and is the code view's edit arithmetic right (it decides what gets written to a file).
//
// Nothing else runs this script before a user does, and a fragment that throws as it loads opens a blank window. Order is load-bearing, so both the fragment list and the fake page's elements are read from the app itself — APP_SHELL_SCRIPT_PARTS in lib.rs and the ids and classes in app-shell.html.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    parentElement: null,
    addEventListener() {},
    removeEventListener() {},
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
    remove() {},
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
  // Only what the page really declares gets an answer. A selector for a class or id the markup does not have returns null, the way it would in the app.
  const find = (selector) => {
    const one = String(selector).trim();
    if (one.startsWith('#')) return byId.get(one.slice(1)) || null;
    // The page's own element, not a fresh one each call: two fragments asking for the same container have to get the same container, or one of them writes into a copy nobody reads.
    if (/^\.[A-Za-z0-9_-]+$/.test(one)) return byClass.get(one.slice(1)) || null;
    return null;
  };
  const document = {
    documentElement: fakeElement('documentElement'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    // Unknown ids answer null, exactly as the real page does — so code that guards on a missing element is exercised, not papered over.
    getElementById: (id) => byId.get(id) || null,
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
    addEventListener() {},
    removeEventListener() {},
    fonts: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
    visibilityState: 'visible',
    activeElement: null,
  };
  return { document, byId };
}

function runShell(source) {
  const { document } = fakePage();
  const noop = () => {};
  const frames = new Map();
  let frameId = 0;
  const sandbox = {
    console: { log: noop, warn: noop, error: noop, debug: noop },
    document,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    innerWidth: 1080,
    innerHeight: 820,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    location: { href: 'about:blank', hash: '' },
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
    getComputedStyle: () => ({ getPropertyValue: () => '', color: 'rgb(0, 0, 0)' }),
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
    __leafDocumentExts: ['md', 'markdown', 'mdown', 'xml', 'json', 'yaml', 'yml'],
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

  // The card over a pager button has to name the page it opens rather than call the document behind it an app command. Its target is a `file://` URL, so the scheme branch answers first unless the page the pager stamped on the button is read ahead of everything.
  check('a pager button’s hint names its page and keeps the address under it', () => {
    const { linkHoverInfo, linkHoverKind } = booted;
    const anchor = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null) });
    const href = 'file:///docs/002-rains.md';
    const pager = linkHoverInfo(href, anchor({ href, 'data-pager-title': 'The Rains Retreat' }));
    if (pager.kind !== 'The Rains Retreat') throw new Error(`the card calls it ${pager.kind}`);
    if (pager.detail !== href) throw new Error(`the address moved: ${pager.detail}`);

    // An ordinary document link keeps the answer it has, its line count included.
    const plain = linkHoverInfo('notes/other.md', anchor({ href: 'notes/other.md' }));
    if (plain.kind !== 'Another page') throw new Error(`a plain link became ${plain.kind}`);

    // The right-click menu asks with the href alone, so a pager button there is unmoved.
    if (linkHoverKind(href) !== 'App link') throw new Error('the menu’s reading of a pager link moved');
  });

  // The card follows the pointer at a fixed offset, which lands inside a target this size — so it covered the very page name it had just been given. Pure arithmetic over two rectangles, and the one part of this nothing else can see.
  check('the card over a pager button stands clear of it', () => {
    const { positionLinkHoverTip } = booted;
    const tip = vm.runInContext('linkHoverTip', booted);
    const wasRect = tip.getBoundingClientRect;
    tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 300, bottom: 70, width: 300, height: 70 });
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
      if (place(target('The Rains Retreat', 600), 620) !== '520px') throw new Error(`the card landed at ${tip.style.top} instead of above the button`);
      // A button at the top of the window has no room above it, so the card goes under it rather than off screen.
      if (place(target('The Rains Retreat', 20), 40) !== '100px') throw new Error(`with no room above, the card landed at ${tip.style.top}`);
      // An ordinary link is not a big target, and its card still follows the pointer.
      if (place(target(null, 600), 620) !== '638px') throw new Error(`an ordinary link's card moved to ${tip.style.top}`);
    } finally {
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('activeHoverLink = null;', booted);
      delete booted.__hovered;
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

  // v0.1.468: one line in a document took the whole interface away. Mermaid draws `click A "…"` as a real anchor even at its strict level, and writes only `xlink:href` — which `documentLinkFor` does not match, so the click belonged to the web view and the app page navigated to the site with no tabs, no bar and no way back.
  check('a box wired to a link is the app’s click, not the web view’s', () => {
    const { claimMermaidLinks, documentLinkHref } = booted;
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

    // An SVG anchor's `href` property is an SVGAnimatedString, so reading it as a string sends the host "[object SVGAnimatedString]".
    if (documentLinkHref({ ...linked, href: { baseVal: 'x' } }) !== 'https://example.com/x') {
      throw new Error('the SVG anchor’s href was read off the property rather than the attribute');
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

  // The widened table's rules, read as text: none of it is reachable without a laid-out page, and every way it breaks is silent — a table back at the text measure, one grown wider than the lane it sits in, a frontmatter table dragged into the margin, or a fade that veils a column instead of pointing past it.
  const tableLaneRule = () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const opened = css.indexOf('.document-body > .table-lane {');
    if (opened < 0) throw new Error('no rule widens a table lane to the reader lane');
    return { css, rule: css.slice(opened, css.indexOf('}', opened)) };
  };

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

// ---- 5. the rows on the start screen ----------------------------------------

// A row on the start screen is one button carrying the path twice: `data-path` opens it, and `data-reveal-path` is the only thing the right-click menu finds a start-screen row by — so a rewritten row that dropped it would take Favorite and Reveal off the screen with nothing failing.

if (booted) {
  const { homeRowMarkup } = booted;

  check('a home row reads as a name over its folder', () => {
    const path = 'C:\\Users\\me\\Vault\\Journal\\A note.md';
    const row = homeRowMarkup(path);
    if (!/<span class="home-row-name">A note<\/span>/.test(row)) {
      throw new Error(`the first line is not the name without its extension: ${row}`);
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
    if (!/<span class="home-row-name">notes<\/span>/.test(bare)) {
      throw new Error(`a bare name lost its name: ${bare}`);
    }
    // Only a document extension comes off. A name the app cannot open keeps every character it has, or the row says a file is called something it is not.
    const kept = homeRowMarkup('/home/me/archive.tar.gz');
    if (!/<span class="home-row-name">archive\.tar\.gz<\/span>/.test(kept)) {
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

  const VAULTS = [
    { id: 1, name: 'Dharma' },
    { id: 2, name: 'Work' },
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

    // The bar is the scroll's own: it goes up when the list moves, and the timer that takes it away is armed in the same breath.
    if (top.classes.has('is-scrolling')) throw new Error('the bar was up before anything moved');
    const wasTimeout = booted.setTimeout;
    let armed = null;
    booted.setTimeout = (fn) => {
      armed = fn;
      return 1;
    };
    try {
      top.scrolled();
      if (!top.classes.has('is-scrolling')) throw new Error('the list moved and the bar stayed away');
      if (!armed) throw new Error('nothing was set to take the bar away again');
      armed();
      if (top.classes.has('is-scrolling')) throw new Error('the bar never goes once the list stops');
    } finally {
      booted.setTimeout = wasTimeout;
    }
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
    const carried = [];
    const wasAppend = body.appendChild;
    body.appendChild = (child) => carried.push(child);
    try {
      if (!booted.beginHomeRowDrag(drag, { clientY: 4 })) throw new Error('the drag never started');
    } finally {
      body.appendChild = wasAppend;
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
    if (empty !== '<p class="empty-help">Files you open show up here, so you can pick up where you left off.</p>') {
      throw new Error(`nothing open and nothing kept is not the line it was: ${empty}`);
    }

    const plain = withVaults(VAULTS, 0, () =>
      homeListsMarkup({ recent: ['C:\Notes\Journal\A note.md'], favorites: [] }),
    );
    if (!plain.startsWith('<div class="recent"><h2>Recent (1)</h2><ol>')) {
      throw new Error(`a lone list is not the block it was: ${plain}`);
    }
    // The whole path on one line, in one button.
    if (!plain.includes('>C:\Notes\Journal\A note.md</button>')) {
      throw new Error(`a lone list drew the two-line row: ${plain}`);
    }
    for (const paired of ['home-list-grid', 'home-list-box', 'home-row', 'Favorites']) {
      if (plain.includes(paired)) throw new Error(`a lone list is still drawn as half a pair: ${paired}`);
    }

    // With favorites, both are there and Recent is first — on the screen, and first again when the columns fold.
    const both = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: ['a.md'], favorites: KEPT }));
    if (!both.includes('home-list-grid')) throw new Error('a pair was drawn as a lone list');
    if (both.indexOf('Recent') > both.indexOf('Favorites')) {
      throw new Error('Favorites was drawn above Recent');
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

// ---- report -----------------------------------------------------------------

await Promise.all(settled);

if (failures.length) {
  console.error('front-end check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`front-end: ${names.length} fragments parse, boot, and agree on edit offsets`);
