// Run the WebView front-end: does it parse, does it boot, and is the code
// view's edit arithmetic right (it decides what gets written to a file).
//
// Nothing else runs this script before a user does, and a fragment that throws
// as it loads opens a blank window. Order is load-bearing, so both the fragment
// list and the fake page's elements are read from the app itself —
// APP_SHELL_SCRIPT_PARTS in lib.rs and the ids and classes in app-shell.html.

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

// ---- the script, assembled the way the binary assembles it ------------------

function shellSource() {
  const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
  const list = lib.match(/APP_SHELL_SCRIPT_PARTS: &\[&str\] = &\[([\s\S]*?)\];/);
  if (!list) throw new Error('could not find APP_SHELL_SCRIPT_PARTS in src/lib.rs');
  const names = [...list[1].matchAll(/include_str!\("assets\/(.*?)"\)/g)].map((m) => m[1]);
  if (names.length < 10) throw new Error(`expected the whole fragment list, got ${names.length}`);
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

/** Every class the real page carries, so a selector for one is answered. */
function elementClasses() {
  const classes = new Set();
  for (const match of pageMarkup().matchAll(/\bclass="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) classes.add(name);
  }
  return classes;
}

/** A stand-in element: enough surface to be wired up, and inert when used. */
function fakeElement(id = '') {
  const element = {
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
    appendChild: (child) => child,
    removeChild: (child) => child,
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
    // The page writes its own markup into these and then reaches back into it,
    // so a query finds something — as it would once that markup is really there.
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
  };
  return element;
}

function fakePage() {
  const byId = new Map(elementIds().map((id) => [id, fakeElement(id)]));
  const classes = elementClasses();
  // Only what the page really declares gets an answer. A selector for a class
  // or id the markup does not have returns null, the way it would in the app.
  const find = (selector) => {
    const one = String(selector).trim();
    if (one.startsWith('#')) return byId.get(one.slice(1)) || null;
    if (/^\.[A-Za-z0-9_-]+$/.test(one)) {
      return classes.has(one.slice(1)) ? fakeElement(one) : null;
    }
    return null;
  };
  const document = {
    documentElement: fakeElement('documentElement'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    // Unknown ids answer null, exactly as the real page does — so code that
    // guards on a missing element is exercised, not papered over.
    getElementById: (id) => byId.get(id) || null,
    querySelector: find,
    // Nothing is loaded at boot, so a list query is legitimately empty.
    querySelectorAll: () => [],
    createElement: (tag) => fakeElement(tag),
    createTextNode: (text) => ({ textContent: text }),
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
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
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
    // Real implementations, not stubs: the web view has these and so does Node,
    // and the offset arithmetic below depends on them being genuine.
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
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
    __leafMaximized: false,
    __leafSettings: {},
    __leafInitialState: { recent: [], document: null },
    __leafVaults: { vaults: [], active: 0 },
    __leafVersion: '0.0.0',
    __leafUpdateAsset: '',
    __leafUpdateApply: null,
    __leafDocumentExts: ['md', 'markdown', 'mdown', 'xml', 'json', 'yaml', 'yml'],
    __leafSettingsUnreadable: false,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // The theme bootstrap normally runs first and publishes these; it lives in a
  // separate <script>, so stand them in.
  sandbox.leafTheme = {
    getMode: () => 'system',
    getFamily: () => 'fern',
    setMode() {},
    setFamily() {},
    subscribe() {},
    appearance: () => 'light',
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

// The code view does not send the buffer, it sends what changed — and the host
// splices that straight into the text it will write to disk. These are the
// functions that work it out.
if (booted) {
  const { sourceSpliceSince, lineIndexAtByteOffset, byteOffsetAtLineIndex, rangesAfterCommit, fencedCodeInnerSpan } =
    booted;

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

    // The marker each press writes. Null means write nothing at all — a freshly typed
    // line commits through this, so a bad marker there writes the words twice.
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
    // The reader edits the inside only, so the fences cannot be typed away. The
    // span is spliced verbatim: a wrong end writes code over a fence.
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

  check('a save before a block move shifts the ranges it moved', () => {
    // Dragging a block after typing in one sends two edits: the save, then the
    // move against the buffer the save wrote. Ranges that drift here reorder the
    // wrong text, so the host refuses a list that is not sorted and disjoint.
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
    // A block edited outside the run counts too: one below it leaves the run
    // alone, one above it slides the whole run.
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

  check('byte offsets and line numbers agree in both directions', () => {
    // The reader's place is a byte offset on the Rust side and a line number in
    // the editor; multi-byte characters are where the two disagree.
    const text = 'ascii\ncafé and ünicode\n😀 wide\nlast';
    for (let line = 0; line < 4; line += 1) {
      const bytes = byteOffsetAtLineIndex(text, line);
      const back = lineIndexAtByteOffset(text, bytes);
      if (back !== line) {
        throw new Error(`line ${line} -> byte ${bytes} -> line ${back}`);
      }
    }
    if (byteOffsetAtLineIndex(text, 0) !== 0) throw new Error('line 0 is not byte 0');
    // "café" is five characters but six bytes, so the second line's start must
    // account for the accent.
    if (byteOffsetAtLineIndex(text, 1) !== 'ascii\n'.length) {
      throw new Error('the second line does not start after the first');
    }
    if (byteOffsetAtLineIndex(text, 2) !== Buffer.byteLength('ascii\ncafé and ünicode\n')) {
      throw new Error('the third line does not account for multi-byte characters');
    }
  });

  // Diagrams are drawn in the theme's own colors, read off :root at render time.
  // A token that does not exist reads as an empty string, mermaid falls back to
  // its own palette, and the diagram quietly stops matching the page — so every
  // name in the maps is held to the ones the stylesheet actually defines.
  check('the mermaid theme map only names tokens the stylesheet defines', () => {
    // Read from the fragment rather than the booted page: a `const` in the shell
    // script is not a property of the context, and the map should not have to
    // become one to be checked.
    const fragment = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const maps = fragment.slice(
      fragment.indexOf('const MERMAID_COLOR_MAP'),
      fragment.indexOf('function themeTokenValue'),
    );
    if (!maps) throw new Error('could not find the mermaid theme maps in decorate.js');
    const used = [...new Set([...maps.matchAll(/'(--[a-z0-9-]+)'/g)].map((m) => m[1]))];
    if (used.length < 15) throw new Error(`expected the whole map, got ${used.length} tokens`);
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const defined = new Set([...css.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    if (defined.size < 50) throw new Error(`only found ${defined.size} tokens in reading.css`);
    const missing = used.filter((token) => !defined.has(token));
    if (missing.length) throw new Error(`not defined in reading.css: ${missing.join(', ')}`);
  });

  // The diagram's labels are set in the theme's body font, which theme.rs emits
  // per family rather than reading.css.
  check('the theme compiler emits the font the diagrams ask for', () => {
    const theme = readFileSync(join(root, 'src/theme.rs'), 'utf8');
    if (!theme.includes('--reading-font')) {
      throw new Error('theme.rs no longer emits --reading-font');
    }
  });
}

// ---- report -----------------------------------------------------------------

if (failures.length) {
  console.error('front-end check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`front-end: ${names.length} fragments parse, boot, and agree on edit offsets`);
