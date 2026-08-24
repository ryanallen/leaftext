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
// Set once the page has booted. The page is shared by every check after that, so a check that drives the app — opens the pane, folds the bar, switches a view — would otherwise leave the next check standing in whatever it left behind, failing on something it never names.
let restoreSharedPage = null;
const check = (name, run) => {
  try {
    run();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
  } finally {
    if (restoreSharedPage) restoreSharedPage();
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

// What layer a rule is painted on, read as the named token rather than the number in the rule: a layer written by hand is what `check-literals` refuses, so a rule that stopped naming one fails here rather than being read. Shared by every check that compares two layers, because a second copy is a second answer.
let layerSources = null;
const layerOf = (selector) => {
  if (!layerSources) {
    layerSources = {
      css: readFileSync(join(root, 'src/assets/reading.css'), 'utf8'),
      tokens: readFileSync(join(root, 'src/assets/tokens.css'), 'utf8'),
    };
  }
  const { css, tokens } = layerSources;
  const opened = css.indexOf(`${selector} {`);
  if (opened < 0) throw new Error(`no rule for ${selector}`);
  const named = /z-index:\s*var\((--lt-z-[\w-]+)\)/.exec(css.slice(opened, css.indexOf('}', opened)));
  if (!named) throw new Error(`${selector} takes no named layer`);
  return valueOfLayer(named[1], tokens);
};
const valueOfLayer = (token, tokens) => {
  const value = new RegExp(`${token}:\\s*(-?\\d+);`).exec(tokens);
  if (!value) throw new Error(`${token} is not a layer the token file names`);
  return Number(value[1]);
};

// Every layer the stylesheet paints on, found by walking it rather than by naming the rules: what the selector is, and what its token is worth. A check that says one thing is above everything below it has to be written this way, or a sheet added later climbs over it and nothing says so.
const layersPainted = () => {
  layerOf('.app-toast');
  const { css, tokens } = layerSources;
  return [...css.matchAll(/z-index:\s*var\((--lt-z-[\w-]+)\)/g)].map((hit) => {
    const before = css.slice(0, css.lastIndexOf('{', hit.index));
    // The rule's own selector list is whatever stands between it and the thing before it — a closed rule, the brace of a media block, or a comment.
    const begins = Math.max(before.lastIndexOf('}') + 1, before.lastIndexOf('{') + 1, before.lastIndexOf('*/') + 2);
    return { selector: before.slice(begins).trim().replace(/\s+/g, ' '), layer: valueOfLayer(hit[1], tokens) };
  });
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
  const parent = child && child.parentElement;
  const held = parent && parent.children;
  if (!held) return;
  const at = held.indexOf(child);
  if (at >= 0) held.splice(at, 1);
  // The written order is a second list holding the same children, so a child dropped from one and left on the other would go on being said by the parent after it was taken out. Six checks hand an element its children outright, which is why the list is asked for rather than assumed.
  const written = parent.contents;
  if (written) {
    const spot = written.indexOf(child);
    if (spot >= 0) written.splice(spot, 1);
  }
  // The holder is let go as well as dropped from its list, because "has it a parent" is how the page asks whether the thing it is closing is still standing: the diagram menu and the box its label is typed into both close that way, and a parent kept after the drop leaves each of those guards on one branch for ever. Every move assigns its new holder straight after this call, so a move is unharmed.
  child.parentElement = null;
}

/** The selectors in a comma list, each trimmed and its spacing squeezed. Split only where the comma is the list's own: a comma inside `:is(...)` or a bracket separates selectors within one entry, and cutting there hands the matcher fragments that are not selectors at all. The same rule as `wearer_list` in `src/tests/app_shell_chrome.rs`, which splits the page's scrollbar-wearer list on the Rust side. */
function selectorParts(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(selector)) {
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    current += ch;
  }
  parts.push(current);
  return parts.map((one) => one.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** One compound selector's own parts — a tag, a class, an attribute, a pseudo-class — each kept whole, so a bracket or the brackets of an `:is(...)` are never cut in half. */
function compoundPieces(one) {
  const pieces = [];
  let depth = 0;
  let current = '';
  for (const ch of one) {
    if (depth === 0 && current && (ch === '.' || ch === '[' || ch === ':')) {
      pieces.push(current);
      current = '';
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    current += ch;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Whether one node answers one piece of a compound. An attribute is asked for by name alone — a `data-` name of `dataset`, where both the markup walker and a check setting one by hand write it, and anything else of the element's own attributes. A tag is the whole piece, since everything that is not one has already been split off: comparing a tag to everything before the first space called a `pre` a `pre > code`. */
function matchesPiece(node, piece) {
  if (piece.startsWith('.')) return !!(node.classList && node.classList.contains(piece.slice(1)));
  if (piece.startsWith('[')) {
    const name = piece.slice(1, piece.endsWith(']') ? -1 : undefined).trim();
    if (!name.startsWith('data-')) return !!(node.hasAttribute && node.hasAttribute(name));
    const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return !!node.dataset && node.dataset[key] !== undefined;
  }
  if (piece.startsWith(':')) {
    const open = piece.indexOf('(');
    // A pseudo-class with no brackets is a state nothing here models, and answering yes to one is the single answer this matcher exists to stop.
    if (open === -1) return false;
    const inside = selectorParts(piece.slice(open + 1, piece.endsWith(')') ? -1 : undefined));
    const name = piece.slice(1, open);
    if (name === 'not') return inside.every((want) => !matchesSelector(node, want));
    if (name === 'is' || name === 'where') return inside.some((want) => matchesSelector(node, want));
    return false;
  }
  if (piece === '*') return true;
  return String(node.tagName || '').toLowerCase() === piece.toLowerCase();
}

/** Whether one node answers one whole compound: every piece of it, on the same node. */
function matchesCompound(node, one) {
  const pieces = compoundPieces(one);
  return pieces.length > 0 && pieces.every((piece) => matchesPiece(node, piece));
}

/** One selector's steps, each with the combinator leading into it — a space for a descendant, `>` for a child, and nothing on the first. Split at the selector's own level, so a space inside `:is(...)` or a bracket names no step. */
function selectorSteps(one) {
  const steps = [];
  let depth = 0;
  let current = '';
  let combinator = null;
  for (const ch of one) {
    if (depth === 0 && (ch === ' ' || ch === '>')) {
      if (current) {
        steps.push({ combinator, compound: current });
        current = '';
        combinator = ' ';
      }
      if (ch === '>') combinator = '>';
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    current += ch;
  }
  if (current) steps.push({ combinator, compound: current });
  return steps;
}

/** Whether the holders above a node answer the steps before it: a child step asks the one holder, a descendant step asks every holder up to the top. */
function matchesAbove(node, steps, combinator) {
  if (!steps.length) return true;
  const step = steps[steps.length - 1];
  const rest = steps.slice(0, -1);
  if (combinator === '>') {
    const holder = node.parentElement;
    return !!holder && matchesCompound(holder, step.compound) && matchesAbove(holder, rest, step.combinator);
  }
  for (let holder = node.parentElement; holder; holder = holder.parentElement) {
    if (matchesCompound(holder, step.compound) && matchesAbove(holder, rest, step.combinator)) return true;
  }
  return false;
}

/** Whether one node answers one selector, the holders above it included. Asked walking down a subtree, walking up from a node, and by an element about itself, so a query, a `closest` and a `matches` cannot disagree about what a selector means. */
function matchesSelector(node, one) {
  const selector = String(one).trim().replace(/\s+/g, ' ');
  if (!selector) return false;
  const steps = selectorSteps(selector);
  const last = steps[steps.length - 1];
  if (!last || !matchesCompound(node, last.compound)) return false;
  return matchesAbove(node, steps.slice(0, -1), last.combinator);
}

/** What an element's own subtree answers a query with, in document order: a comma list of tags, classes and attributes. One matcher behind every stand-in element, so nothing is ever told it is holding something it has not got — a guard asking a line whether it carries a picture reads an answer of "yes, always" as itself having fired. */
function matchingDescendants(el, selector) {
  const wants = selectorParts(selector);
  const walk = (from) => (from.children || []).flatMap((child) => [child, ...walk(child)]);
  return walk(el).filter((child) => wants.some((one) => matchesSelector(child, one)));
}

/** What an element says: everything written inside it joined in the order it was written, each child asked the same question in turn. A guard asking a line whether it says anything reads an answer of "no, always" as itself having fired, so a panel the page really drew with a sentence in it has to come back with that sentence. */
function composedText(node) {
  return (node.contents || []).map((piece) => (typeof piece === 'string' ? piece : String(piece.textContent ?? ''))).join('');
}

/** A stand-in element: enough surface to be wired up, and inert when used. */
function fakeElement(id = '') {
  // The one place a class lives, reached by both names below. A browser has one, and two stores that never meet leave every guard asking whether an element wears a class the markup or a name write gave it answering no for ever.
  const classes = new Set();
  // Declared out here so the snapshot below can copy it whole. Reading the names out of the fragment sources instead would miss a property whose name the source never spells.
  const styleProperties = new Map();
  const element = Object.assign(new FakeElement(), {
    id,
    tagName: 'DIV',
    hidden: false,
    checked: false,
    disabled: false,
    value: '',
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
    style: {
      setProperty(name, value) {
        styleProperties.set(name, value);
      },
      removeProperty(name) {
        styleProperties.delete(name);
      },
      getPropertyValue: (name) => styleProperties.get(name) ?? '',
    },
    // A real set, because a class is how the page changes a whole layout without touching a single element: an embed takes the bar, the pane and the floating toolbar down with one on the body. A stub that always answered false would let a check watching for one pass with nothing added.
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on) => (on === undefined ? (classes.has(name) ? classes.delete(name) : classes.add(name)) : on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    children: [],
    // What was written inside this element, in the order it was written: runs of words and child elements in one list. Two buckets joined one after the other would turn `<p>A <b>bold</b> word</p>` into `A wordbold`. Its own property, because neither name beside it would do — `children` is elements and nothing else in a browser, and `childNodes` is what eight checks rebind to hand-made text for a line being typed on.
    contents: [],
    // Every element has one, so a stand-in without it turns "this block is empty" into a crash in whatever walks it.
    childNodes: [],
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
      this.contents.push(child);
      child.parentElement = this;
      return child;
    },
    prepend(child) {
      detachChild(child);
      this.children.unshift(child);
      this.contents.unshift(child);
      child.parentElement = this;
      return child;
    },
    // Any number of children in one call, each through the move above, and nothing answered — the platform's own append. A string arrives as the same text node createTextNode answers, so a builder mixing the two forms reads back as one list of children.
    append(...children) {
      for (const child of children) this.appendChild(typeof child === 'string' ? { textContent: child } : child);
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
    // The rename box preselects the stem and leaves the extension standing, so the range is kept rather than dropped: a stand-in that swallowed it would let a box that selected the whole name pass.
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    focus() {},
    blur() {},
    click() {},
    select() {},
    scrollIntoView() {},
    // A real walk up, from this element outwards, because that is how the page asks which block a place in the document belongs to. An answer of null for ever leaves the source button with no offset to land on.
    closest: (selector) => {
      const wants = selectorParts(selector);
      for (let node = element; node; node = node.parentElement) {
        if (wants.some((one) => matchesSelector(node, one))) return node;
      }
      return null;
    },
    // The one guard in the front end that asks a box what it is rather than being told: whether the pointer near an edge is on that box's own scrollbar gutter. An answer of no for ever leaves that branch unreachable.
    matches: (selector) => selectorParts(selector).some((one) => matchesSelector(element, one)),
    contains: () => false,
    // Its own children and nothing else, so an element holding nothing says so.
    querySelector: (selector) => matchingDescendants(element, selector)[0] || null,
    querySelectorAll: (selector) => matchingDescendants(element, selector),
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
  // The other name for the same holder, defined rather than assigned because Object.assign copies a getter's value once. A menu takes itself out of the page through this one, and a stand-in without it leaves every menu it opens standing.
  Object.defineProperty(element, 'parentNode', {
    get: () => element.parentElement,
    configurable: true,
    enumerable: true,
  });
  // The first element this one is holding, and nothing when it holds none. The reading render takes a document's layout out of the surface through this name and hands it on, so a stand-in without it throws before the first decoration pass.
  Object.defineProperty(element, 'firstElementChild', {
    get: () => element.children[0] || null,
    configurable: true,
    enumerable: true,
  });
  // The set's other name, and the one the markup walker and 105 lines of the front end write. Reading joins it, writing replaces it — so a class arriving either way is found either way, and the spelling that comes back is the set's rather than the string's.
  Object.defineProperty(element, 'className', {
    get: () => [...classes].join(' '),
    set: (value) => {
      classes.clear();
      for (const name of String(value ?? '').split(/\s+/)) if (name) classes.add(name);
    },
    configurable: true,
    enumerable: true,
  });
  // Writing either name empties the element, which is how the app clears a container before drawing it again — a write of '' in 22 places. Each name keeps its own string, so a container written by one name still reads back by the other. Only the markup becomes children: the page draws whole panels as one string and reaches straight back into what it drew, and the text is what eight checks rebind to hand-made words for a line being typed on.
  const held = { textContent: '', innerHTML: '' };
  // The harness's own way in to what this element closes over, so the page can be handed back the way it was found after a check drove it. Not enumerable: nothing the page runs may see it.
  Object.defineProperty(element, '__stores', {
    value: { classes, style: styleProperties, text: held },
    enumerable: false,
    configurable: true,
  });
  for (const name of ['textContent', 'innerHTML']) {
    Object.defineProperty(element, name, {
      // The text an element says is what was written inside it, in that order, each child asked the same question in turn. The held string is the answer only while nothing was written inside, which is where an element a check builds by assigning `children` outright lands.
      get: () => (name === 'textContent' && element.contents.length ? composedText(element) : held[name]),
      set: (value) => {
        held[name] = String(value ?? '');
        // By this name and never childNodes: no move here writes that one, so it is not a child list — it is what eight checks rebind to hand-made text for a line being typed on. Each child leaves through the same detach a removal uses, so a whole redraw's worth of dropped children are not left naming the container that dropped them.
        for (const child of [...element.children]) detachChild(child);
        element.contents.length = 0;
        if (name === 'innerHTML') {
          // A redraw clears what the container said before, the way a browser's does: a container written with nothing in it answers with nothing rather than with its last text.
          held.textContent = '';
          // Runs of words with no tag around them are text in a browser too, so `innerHTML = 'a line'` leaves the container saying `a line`.
          for (const piece of elementsFromMarkup(held[name])) {
            if (typeof piece === 'string') element.contents.push(piece);
            else element.appendChild(piece);
          }
        }
      },
      configurable: true,
      enumerable: true,
    });
  }
  // A raw-source block is read back through innerText and written through textContent, so a stand-in keeping the two apart would say the block is empty while showing a file's own bytes.
  Object.defineProperty(element, 'innerText', {
    get: () => element.textContent,
    set: (value) => {
      element.textContent = value;
    },
    configurable: true,
    enumerable: true,
  });
  return element;
}

// Every tag in a piece of markup, opening or closing, with its attributes — the one pattern both walkers below read markup with.
const MARKUP_TAGS = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
// A tag that closes itself, so nothing written after it is written inside it.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Everything a piece of markup declares, in the order it declares it: an element per tag, nested the way it nests them and wearing its tag, its id, its classes and its other attributes, and the runs of words between them. The page draws whole panels as one string and then reaches straight back into what it drew — the home screen wires its two buttons out of the markup two lines above them — so a container keeping only the string could answer none of it, and one keeping only the elements says nothing for every panel it holds. */
function elementsFromMarkup(markup) {
  const text = String(markup);
  const root = fakeElement('');
  const open = [{ name: '', node: root }];
  let after = 0;
  // The words between two tags belong to whatever tag is open around them, and the run is kept before the stack moves — so what was written before a closing tag is still inside the element it closes.
  const keepRun = (upto) => {
    const run = text.slice(after, upto);
    if (run) open[open.length - 1].node.contents.push(run);
  };
  for (const tag of text.matchAll(MARKUP_TAGS)) {
    keepRun(tag.index);
    after = tag.index + tag[0].length;
    const [, closing, rawName, attrs] = tag;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = open.map((one) => one.name).lastIndexOf(name);
      // Never past the root: markup closing a tag nobody opened is a fragment of a bigger page, not an empty one.
      if (at > 0) open.length = at;
      continue;
    }
    const node = fakeElement('');
    node.tagName = name.toUpperCase();
    const held = new Map();
    for (const [, key, value] of attrs.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g)) {
      held.set(key, value);
      if (key === 'id') node.id = value;
      else if (key === 'class') node.className = value;
      else if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    node.getAttribute = (key) => (held.has(key) ? held.get(key) : null);
    node.hasAttribute = (key) => held.has(key);
    node.setAttribute = (key, value) => held.set(key, String(value));
    node.removeAttribute = (key) => held.delete(key);
    if (/(^|\s)hidden(\s|=|$)/.test(attrs)) node.hidden = true;
    open[open.length - 1].node.appendChild(node);
    if (!VOID_TAGS.has(name) && !/\/\s*$/.test(attrs)) open.push({ name, node });
  }
  keepRun(text.length);
  // The whole of what was parsed, runs included, so the container this is written into says the words as well as holding the elements. One line in the file parses markup, so nothing else has to read this shape.
  const built = [...root.contents];
  for (const child of root.children) child.parentElement = null;
  root.children.length = 0;
  root.contents.length = 0;
  return built;
}

/** One stand-in per element the markup names, nested the way the page nests them. The app-bar fold takes buttons out of their containers and later puts each back where it was standing, so a flat bag of elements cannot say whether it worked — a wide window left the Mac's dots in the menu until the app was quit, and nothing here could see it. */
function pageElements() {
  const markup = pageMarkup();
  const byId = new Map();
  const open = [];
  for (const tag of markup.matchAll(MARKUP_TAGS)) {
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
      const holder = [...open].reverse().find((one) => one.node);
      if (holder) holder.node.appendChild(node);
    }
    if (!VOID_TAGS.has(name) && !/\/\s*$/.test(attrs)) open.push({ name, node });
  }
  return { byId };
}

function fakePage() {
  const { byId } = pageElements();
  // Every id the markup declares has a stand-in, including any the walker's nesting missed.
  for (const id of elementIds()) if (!byId.has(id)) byId.set(id, fakeElement(id));
  // Only what the page really has gets an answer. An id the markup does not declare returns null, the way it would in the app. An element taken out of the page stops answering, the way it does in a browser: a query only finds what is still in the document.
  const standing = (node) => (node && node.isConnected !== false ? node : null);
  // The page as it stands, not an index filled at boot: most of what carries a class is drawn while the app runs — the growl, the menus, the sheets, the rename box — and an index cannot hold what the markup never named. Everything hangs off the app surface, which carries `app-surface` itself, so the walk starts at the surface rather than at its children. First match in document order, which is what querySelector means.
  const wearing = (node, name) => {
    if (!standing(node)) return null;
    if (String(node.className || '').split(/\s+/).includes(name)) return node;
    for (const child of node.children || []) {
      const found = wearing(child, name);
      if (found) return found;
    }
    return null;
  };
  const find = (selector) => {
    const one = String(selector).trim();
    if (one.startsWith('#')) return standing(byId.get(one.slice(1)));
    if (/^\.[A-Za-z0-9_-]+$/.test(one)) return wearing(byId.get('appSurface'), one.slice(1));
    return null;
  };
  const document = {
    documentElement: fakeElement('documentElement'),
    // The harness's own index of every element the markup declared, so a snapshot reaches one a check has taken out of the tree. Not enumerable: nothing the page runs may see it.
    get __elements() {
      return byId;
    },
    body: fakeElement('body'),
    head: fakeElement('head'),
    // Unknown ids answer null, exactly as the real page does — so code that guards on a missing element is exercised, not papered over. An id taken out of the page is one of them.
    getElementById: (id) => standing(byId.get(id)),
    querySelector: find,
    // Nothing is loaded at boot, so a list query is legitimately empty.
    querySelectorAll: () => [],
    // The tag it was asked for, and no id: a query over an element's children matches on the tag, so a picture built here has to be found by a guard asking what the line is holding.
    createElement: (tag) => {
      const made = fakeElement('');
      made.tagName = String(tag).toUpperCase();
      return made;
    },
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
  // The bar's left zone measures its own buttons, and the pane opens no narrower than that — so a zone reporting an empty box would let the rule pass with nothing measured. `__leafLeadWidth` is what a platform's zone comes to: 187.33 on Windows, 247.33 on a Mac, whose window dots stand in it.
  const lead = document.querySelector('.app-bar-lead');
  if (lead) {
    const leadWidth = typeof extras.__leafLeadWidth === 'number' ? extras.__leafLeadWidth : 0;
    // What is standing in the zone decides its width, because the zone's floor is written from this and a fixed answer would let a floor written once pass as one that follows the buttons. One share each: what the zone comes to is the platform's own number, and nothing here turns on which of them went.
    const leadButtons = [];
    (function collectLeadButtons(node) {
      for (const child of node.children) {
        if (String(child.className || '').includes('button') || child.id === 'windowControls') leadButtons.push(child);
        else collectLeadButtons(child);
      }
    })(lead);
    const standsInLead = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) if (node === lead) return true;
      return false;
    };
    lead.getBoundingClientRect = () => {
      const standing = leadButtons.filter(standsInLead).length;
      const width = leadButtons.length ? (leadWidth * standing) / leadButtons.length : leadWidth;
      return { left: 0, top: 0, right: width, bottom: 0, width, height: 0 };
    };
  }
  const noop = () => {};
  const frames = new Map();
  let frameId = 0;
  // Kept rather than swallowed, the way the document's are: a check raises a made-up event on the window and gets the page's own handlers. The mouse's own back button and the browser's own history both arrive this way.
  const windowListeners = new Map();
  // Every watcher the page registered, with the element and the options it was handed, so a check can find the one guarding an attribute and run it.
  const watchers = [];
  // One stand-in per kind of watcher the page constructs, each keeping what it was handed on the shared list: the kind, the callback, the element and the options. Nothing is dropped when the page lets a watcher go, so the list answers what was ever registered — which is what a count of every registration and a later firing of one both need.
  const watcherStandIn = (kind) =>
    class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target, options) {
        watchers.push({ kind, callback: this.callback, target, options: options || {} });
      }
      unobserve() {}
      disconnect() {}
    };
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
    __watchers: watchers,
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
    // Kept rather than swallowed, the way a listener is: a callback registered on every boot and called on none of them is a sweep no check has ever run, which is how a retired function sat in the theme sweep throwing into the record on every theme change. A check flips the attribute and fires what was watching it.
    MutationObserver: watcherStandIn('MutationObserver'),
    ResizeObserver: watcherStandIn('ResizeObserver'),
    IntersectionObserver: watcherStandIn('IntersectionObserver'),
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
    // The one call both browser hosts answer Export PDF with. Counted rather than swallowed: the whole of that command is "did the page's own print reach the browser", so a stub that returned nothing would leave the arm proved only by not throwing.
    print: () => {
      sandbox.__printed += 1;
    },
    __printed: 0,
    // A page always has one, even with nothing in it — a check that draws a caret replaces this, and everything else reads "no selection" rather than finding no such call.
    getSelection: () => null,
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
    __leafUpdateFailed: null,
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
    // The queue itself, so the walk that hands the page back can take off a callback one check left waiting rather than letting it run inside the next.
    queue: frames,
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

/** Every top-level `let` and `var` the fragments declare. Scanned rather than written down, so a value added next week is put back the day it is written — a declaration at the start of a line is top level, since everything inside a function is indented. */
function topLevelNames(script) {
  const found = new Set();
  for (const line of script.split('\n')) {
    const declared = line.match(/^(?:let|var)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*(?:=|;|$)/);
    if (declared) for (const name of declared[1].split(',')) found.add(name.trim());
  }
  return [...found];
}

/** Every one of those the page assigns after declaring and never reads. Only a bare `name =` is a write: `name += 1` and `name = name + 1` both read the value first, and so does every other mention. The declaration itself is neither, since the question is what happens to the value once it exists. */
function writeOnlyNames(script) {
  const lines = script.split('\n');
  const dead = [];
  for (const name of topLevelNames(script)) {
    // A mention of the binding rather than of a property with the same name, with whatever follows it, which is what says write or read.
    const mention = new RegExp(`(?<![\\w$.])${name}(?![\\w$])\\s*(\\S{0,2})`, 'g');
    let writes = 0;
    let reads = 0;
    for (const line of lines) {
      const declaration = line.match(/^(?:let|var)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*(?:=|;|$)/);
      const declaresThis = declaration && declaration[1].split(',').some((one) => one.trim() === name);
      for (const found of line.matchAll(mention)) {
        if (declaresThis && found.index < declaration[0].length) continue;
        // `=>` is a parameter and `==` a comparison; a compound assignment carries its operator in front of the `=`, so neither reaches here as a write.
        if (found[1].startsWith('=') && found[1][1] !== '=' && found[1][1] !== '>') writes += 1;
        else reads += 1;
      }
    }
    if (writes && !reads) dead.push(name);
  }
  return dead;
}

/** Every element the page holds: the ones the markup declared, the three roots, and everything standing under them. */
function everyElement(context) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of [context.document.documentElement, context.document.body, context.document.head]) walk(node);
  for (const node of context.document.__elements.values()) walk(node);
  return [...seen];
}

/** One value, taken so it can be put back. A list, a map, a set or a plain object is kept by identity as well as by contents, because a check that empties one is not the same as a check that swaps a new one in — and both happen. What is inside one is taken the same way, so the list of handlers a listener map holds against an event name is refilled rather than replaced: a handler armed after a restore would otherwise be pushed into the very list the snapshot is holding. */
function takeValue(value, depth = 0) {
  if (depth < 4) {
    if (Array.isArray(value)) return { kind: 'list', ref: value, items: value.map((one) => takeValue(one, depth + 1)) };
    if (value instanceof Map) return { kind: 'map', ref: value, items: [...value].map(([k, v]) => [k, takeValue(v, depth + 1)]) };
    if (value instanceof Set) return { kind: 'set', ref: value, items: [...value] };
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return { kind: 'plain', ref: value, items: Object.entries(value).map(([k, v]) => [k, takeValue(v, depth + 1)]) };
    }
  }
  return { kind: 'value', ref: value };
}

/** Put one taken value back, contents and all. */
function putValue(taken) {
  const { ref } = taken;
  if (taken.kind === 'list') {
    ref.length = 0;
    for (const one of taken.items) ref.push(putValue(one));
  } else if (taken.kind === 'map') {
    ref.clear();
    for (const [key, one] of taken.items) ref.set(key, putValue(one));
  } else if (taken.kind === 'set') {
    ref.clear();
    for (const one of taken.items) ref.add(one);
  } else if (taken.kind === 'plain') {
    for (const key of Object.keys(ref)) delete ref[key];
    for (const [key, one] of taken.items) ref[key] = putValue(one);
  }
  return ref;
}

/** One element's own properties, taken whole. Every own name is read rather than a list of fields anybody keeps, so a class, a layout number, a child list, a style property, a method a check swapped out and a property a check defined are all covered — including ones nobody has written yet. */
function takeElement(el) {
  const own = new Map();
  for (const name of Object.getOwnPropertyNames(el)) {
    const at = Object.getOwnPropertyDescriptor(el, name);
    own.set(name, at.get || at.set ? { accessor: at } : { data: takeValue(at.value), writable: at.writable, enumerable: at.enumerable, configurable: at.configurable });
  }
  return {
    el,
    own,
    // The three stores an element closes over, which no own name reaches.
    stores: el.__stores ? { classes: [...el.__stores.classes], style: [...el.__stores.style], text: { ...el.__stores.text } } : null,
  };
}

/** Hand one element back the way it was found. */
function putElement(taken) {
  const { el, own } = taken;
  for (const name of Object.getOwnPropertyNames(el)) {
    if (own.has(name)) continue;
    // Defined by a check and never taken away — `childElementCount` is the one the file already deletes by hand.
    try {
      delete el[name];
    } catch {
      // A property nothing can remove is one nothing can have added.
    }
  }
  for (const [name, was] of own) {
    const now = Object.getOwnPropertyDescriptor(el, name);
    if (was.accessor) {
      if (!now || now.get !== was.accessor.get || now.set !== was.accessor.set) Object.defineProperty(el, name, was.accessor);
      continue;
    }
    const value = putValue(was.data);
    if (!now || now.get || now.set) Object.defineProperty(el, name, { value, writable: was.writable, enumerable: was.enumerable, configurable: was.configurable });
    else if (now.value !== value) el[name] = value;
  }
  if (taken.stores) {
    const { classes, style, text } = el.__stores;
    classes.clear();
    for (const name of taken.stores.classes) classes.add(name);
    style.clear();
    for (const [name, value] of taken.stores.style) style.set(name, value);
    for (const key of Object.keys(text)) delete text[key];
    Object.assign(text, taken.stores.text);
  }
}

/** Everything the page is surrounded by that no element holds: the window's own listeners, every watcher it registered, the frames it has queued, and whatever a check swapped out on the window itself. Taken the same way an element is — every own property, by identity as well as by contents — so a handler armed by one check does not fire inside the next. */
function takeSurroundings(context) {
  const own = new Map();
  for (const name of Object.getOwnPropertyNames(context)) {
    if (name === '__leafTakenValues') continue;
    const at = Object.getOwnPropertyDescriptor(context, name);
    if (at.get || at.set || !at.writable) continue;
    // `window`, `self` and `globalThis` are the page itself, and taking one by contents would empty the page rather than copy it.
    own.set(name, { data: at.value === context ? { kind: 'value', ref: at.value } : takeValue(at.value), enumerable: at.enumerable, configurable: at.configurable });
  }
  return () => {
    for (const [name, was] of own) {
      const value = putValue(was.data);
      if (context[name] !== value) context[name] = value;
    }
  };
}

/** The shared page as the boot left it, and a way to hand it back. Nothing here is a list of fields somebody keeps: the tree is walked, every own property of every element is taken with it, and the page's own values are scanned out of the script — so a class, a layout number, a custom property, a swapped-out method or a value nobody thought of is covered the day it arrives.
 *
 * The page's own values are read and written through scripts run in its context rather than off the context object, because a top-level `let` lives in the script's own scope and never reaches the global object — reading `context.name` for one answers undefined and writing it makes a second name the page cannot see. */
function pageSnapshot(context, script) {
  const elements = everyElement(context).map(takeElement);
  const putSurroundings = takeSurroundings(context);
  const taken = Object.create(null);
  const names = topLevelNames(script).filter((name) => {
    try {
      taken[name] = vm.runInContext(name, context);
      return true;
    } catch {
      // A name at the start of a line that is not a declaration the page can see — inside a template literal, say.
      return false;
    }
  });
  context.__leafTakenValues = taken;
  const putValues = new vm.Script(
    names.map((name) => `try { if (${name} !== __leafTakenValues.${name}) ${name} = __leafTakenValues.${name}; } catch {}`).join('\n'),
    { filename: 'put-page-values.js' },
  );
  return () => {
    for (const one of elements) putElement(one);
    putSurroundings();
    putValues.runInContext(context);
  };
}

// ---- 1. it parses -----------------------------------------------------------

const { names, source } = shellSource();
check('the page parses', () => {
  new vm.Script(source, { filename: 'app-shell.js' });
});

// ---- 1a. nothing is written and never read ----------------------------------
//
// A top-level value the page writes and nobody reads is worse than no value at all: whoever opens the fragment has to prove the thing does not matter before they may touch the line, and whoever moves the code has to keep it right for a reader that does not exist. Two shipped at once — the point a flowchart menu was opened at, and a cached handle to the link row on the selection bar — which is what makes it a class rather than a slip. There is no allow-list: a binding named here is read by name, or it comes out.
//
// The planted source comes first because a scanner that finds nothing because it is broken passes exactly like one that finds nothing because the tree is clean.

check('no value the page declares is written and never read', () => {
  const planted = [
    'let readAndWritten = 0;',
    'let onlyWritten = null;',
    'let countedUp = 0;',
    'let itself = 1;',
    'function drive() {',
    '  readAndWritten = 1;',
    '  onlyWritten = { x: 0 };',
    '  countedUp = 0;',
    '  countedUp += 1;',
    '  itself = itself + 1;',
    '  return readAndWritten;',
    '}',
  ].join('\n');
  const plantedFound = writeOnlyNames(planted);
  if (!plantedFound.includes('onlyWritten')) throw new Error('this scan missed a value written and never read');
  if (plantedFound.length !== 1) throw new Error(`this scan named ${plantedFound.join(', ')} — a compound assignment and a self-referring one both read the value`);

  const dead = writeOnlyNames(source);
  if (dead.length) throw new Error(`${dead.join(', ')} is written and never read — read it by name, or take it out`);
});

// ---- 2. it boots ------------------------------------------------------------

let booted = null;
check('the page boots', () => {
  booted = runShell(source);
});
// From here every check is handed the page the boot made, whatever the check before it did to it.
if (booted) restoreSharedPage = pageSnapshot(booted, source);

// ---- 2a. the page is handed back the way it was found -----------------------
//
// The page boots once and every check after it reads the same one, so without the hand-back a check that drives the app — opens the pane, folds the bar, switches a view — leaves the next check standing in whatever it left behind, failing on something it never names: the rail check opened the library pane and took two app-bar checks two hundred lines below it with it. These two are the proof the hand-back happens, and they are a pair because the page holds what it is in two places, its tree and its own values, and a walk over one reaches nothing of the other.

check('a check that drives the shared page leaves the next one reading the page the boot made', () => {
  const shell = booted.document.getElementById('libraryShell');
  const surface = booted.document.getElementById('appSurface');
  const closed = shell.classList.contains('library-closed');
  const wasChildren = surface.children.length;
  const wasRail = booted.document.documentElement.style.getPropertyValue('--library-rail-width');

  // The gesture that found this: opening the pane refits the bar around it and leaves a rail width on the page.
  shell.clientWidth = 1280;
  booted.toggleLibrary();
  const drawn = booted.document.createElement('div');
  drawn.className = 'left-behind';
  surface.appendChild(drawn);
  booted.document.documentElement.style.setProperty('--library-rail-width', '999px');

  // Put back by the harness, not by this check: what is read here is the state the *next* check would meet, so the restore is run rather than waited for.
  restoreSharedPage();

  if (shell.classList.contains('library-closed') !== closed) throw new Error('the pane was left standing in the state a check put it in');
  if (surface.children.length !== wasChildren) throw new Error('an element a check drew was left on the page');
  if (booted.document.documentElement.style.getPropertyValue('--library-rail-width') !== wasRail) throw new Error('a custom property a check wrote was left on the page');
});

check('a check that writes one of the page own values leaves the next one reading the value the boot left', () => {
  const read = (name) => vm.runInContext(name, booted);
  // Two of the page's own top-level values, neither of which any element holds: one the app bar reads on every refit, and one the reader's own state.
  const wasChevron = read('overflowChevronUp');
  const wasCode = read('codeViewActive');
  vm.runInContext('overflowChevronUp = true; codeViewActive = true;', booted);

  restoreSharedPage();

  if (read('overflowChevronUp') !== wasChevron) throw new Error('a value a check wrote was left standing');
  if (read('codeViewActive') !== wasCode) throw new Error('a second value a check wrote was left standing');
  // And the list is scanned rather than written down, so a value added to a fragment next week is covered without anybody being told.
  const scanned = topLevelNames(source);
  if (!scanned.includes('overflowChevronUp') || !scanned.includes('codeViewActive')) throw new Error('the scan of the page own values missed one the fragments declare');
  if (scanned.length < 200) throw new Error(`the scan found only ${scanned.length} of the page own values`);
});

check('a check that arms a handler or queues a frame leaves neither standing for the next one', () => {
  const button = booted.document.getElementById('openButton');
  const wasOnButton = (button.listeners.get('click') || []).length;
  const wasOnWindow = (booted.__windowListeners.get('resize') || []).length;
  const wasWatchers = booted.__watchers.length;
  const wasWaiting = booted.__frames.waiting();

  let fired = 0;
  button.addEventListener('click', () => (fired += 1));
  booted.window.addEventListener('resize', () => (fired += 1));
  new booted.ResizeObserver(() => (fired += 1)).observe(button, {});
  booted.requestAnimationFrame(() => (fired += 1));

  restoreSharedPage();

  if ((button.listeners.get('click') || []).length !== wasOnButton) throw new Error('a handler armed on an element was left standing');
  if ((booted.__windowListeners.get('resize') || []).length !== wasOnWindow) throw new Error('a handler armed on the window was left standing');
  if (booted.__watchers.length !== wasWatchers) throw new Error('a watcher a check registered was left standing');
  if (booted.__frames.waiting() !== wasWaiting) throw new Error('a frame a check queued was left waiting for the next one');

  // And nothing the check armed runs afterwards, which is the whole of what a left-behind handler costs.
  (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
  booted.__frames.drain();
  if (fired) throw new Error(`${fired} of the handlers a check armed ran after the page was handed back`);
});

// ---- 2b. an update that did not install says so at boot ---------------------
//
// The host reads the applier's verdict before the event loop starts, so it arrives as a seeded flag rather than a message. Read off the drawn toast rather than off the flag: what makes a failed install invisible is that the old build comes back looking like a new one, and only the sentence carries the version still running.

/** Every growl standing on the app surface after a boot seeded with `extras`. */
function bootGrowls(extras) {
  const context = runShell(source, extras);
  const surface = context.document.getElementById('appSurface');
  return surface.children.filter((child) => String(child.className || '').includes('app-toast'));
}

check('a failed install growls once at boot, carrying all three parts', () => {
  const growls = bootGrowls({
    __leafUpdateFailed: { version: '1.14.13', message: 'Leaftext was still open, so nothing was changed' },
    __leafVersion: '1.14.12',
  });
  if (growls.length !== 1) throw new Error(`expected one growl, got ${growls.length}`);
  const said = String(growls[0].textContent);
  for (const part of ['v1.14.13', 'Leaftext was still open', 'still on v1.14.12']) {
    if (!said.includes(part)) throw new Error(`the growl lost "${part}": ${said}`);
  }
  if (!growls[0].className.includes('is-error')) throw new Error(`a failure drew the quiet growl: ${growls[0].className}`);
});

check('a malformed staging path never draws a bare v', () => {
  const [growl] = bootGrowls({ __leafUpdateFailed: { version: '', message: 'no staged update to apply' }, __leafVersion: '1.14.12' });
  if (!growl) throw new Error('a failure with no version said nothing at all');
  if (/\bv\b|v:/.test(String(growl.textContent).replace(/v1\.14\.12/g, ''))) {
    throw new Error(`a bare v reached the page: ${growl.textContent}`);
  }
});

check('a launch after an install that worked growls nothing', () => {
  if (bootGrowls({ __leafUpdateFailed: null }).length !== 0) throw new Error('a null flag still growled');
});

// ---- 2c. a theme change runs the sweep it registered ------------------------
//
// The picker, the system's own light/dark switch and the resolution at startup all reach the page as the theme attribute changing on the root element, so one sweep answers all three — and a name retired out of it throws on every one of them. Fired here rather than read as text: running it catches any retired name in the sweep, including the ones nobody has thought of. Its own page, because the sweep empties the page-level mermaid sheet the checks below set up.

check('a theme change runs the sweep to its end', () => {
  const context = runShell(source);
  const root = context.document.documentElement;
  const sweeps = context.__watchers.filter(
    (one) => one.target === root && (one.options.attributeFilter || []).includes('data-theme'),
  );
  if (sweeps.length === 0) throw new Error('nothing watches the theme attribute on the root element');
  root.dataset.theme = 'forest';
  root.dataset.leafTheme = 'forest';
  for (const sweep of sweeps) sweep.callback([{ type: 'attributes', attributeName: 'data-theme', target: root }]);
});

// ---- 2d. every watcher the page registers is held -------------------------
//
// A registration nothing keeps is a callback no check can ever run, and a callback no check runs is where a name retired out of the page sits throwing at a reader. So the record is what a boot registered, by element, and a watcher that stops being registered fails here rather than in somebody's window.

/** What `kind` watchers the record holds against `target`. */
function registrationsOn(watchers, kind, target) {
  return watchers.filter((one) => one.kind === kind && one.target === target);
}

/** Throws unless the record holds exactly the registrations `wanted` names, one each. */
function holdsRegistrations(watchers, wanted) {
  for (const [name, kind, target] of wanted) {
    const held = registrationsOn(watchers, kind, target);
    if (held.length !== 1) throw new Error(`${name}: expected one registration, the record holds ${held.length}`);
  }
  if (watchers.length !== wanted.length) throw new Error(`the record holds ${watchers.length} registrations, not the ${wanted.length} named here`);
}

/** The four a bare boot makes, each top-level in its own fragment. */
function bootRegistrations(context) {
  const { document } = context;
  return [
    ['the theme sweep', 'MutationObserver', document.documentElement],
    ['the minimap width fit', 'ResizeObserver', document.getElementById('app')],
    ['the crumb trail fit', 'ResizeObserver', document.getElementById('libraryCrumbs')],
    ['the app bar refit', 'ResizeObserver', document.getElementById('appBar')],
  ];
}

check('a bare boot holds every watcher it registered, against the element it watches', () => {
  const context = runShell(source);
  const wanted = bootRegistrations(context);
  holdsRegistrations(context.__watchers, wanted);
  // The theme sweep is the one that has already shipped a fault, so its filter is read as well as its element.
  const [sweep] = registrationsOn(context.__watchers, 'MutationObserver', context.document.documentElement);
  if (!(sweep.options.attributeFilter || []).includes('data-theme')) throw new Error('the theme sweep is watching the root element without asking for the theme attribute');
  // A dropped registration has to fail rather than pass quietly, which is the whole reason the record exists.
  let dropped = false;
  try {
    holdsRegistrations(context.__watchers.filter((one) => one.target !== context.document.getElementById('appBar')), wanted);
  } catch (_) {
    dropped = true;
  }
  if (!dropped) throw new Error('the record still read as complete with a registration taken out of it');
});

// The other eight sit inside installers a bare boot never calls — a diagram drawn, the find bar opened, the code view under Monaco, a minimap bound, a graph scene wired. Called by name off the booted page, so a watcher moved out of one of them, or an installer that stops registering at all, fails here.

/** Calls those installers off a booted page and answers the eight registrations they make, so the check below and the firing check share one drive. */
function installerRegistrations(context) {
  const { document } = context;
  const appEl = document.getElementById('app');
  const body = fakeElement('documentBody');
  // One more drawing than the two picture memos hold: under that the document keeps every drawing it makes and the recycler returns before it ever makes a watcher.
  const drawn = Array.from({ length: 201 }, () => fakeElement('drawnDiagram'));
  body.querySelectorAll = (selector) => (String(selector) === 'pre.mermaid' ? drawn : []);
  const rail = fakeElement('monacoMinimapRail');
  const track = fakeElement('minimapTrack');
  const nearDiagram = fakeElement('nearDiagram');
  const farDiagram = fakeElement('farDiagram');
  const canvas = document.getElementById('readerGraphCanvas');
  const wasQuery = appEl.querySelector;
  // The fake page answers an id and one bare class; these are the two the installers reach for that it cannot, and both have to answer with the same element twice — the installers read them again on the way through.
  appEl.querySelector = (selector) => {
    const one = String(selector);
    if (one === '.document-body') return body;
    if (one === '.code-view-monaco .monaco-editor .minimap') return rail;
    return wasQuery.call(appEl, one);
  };
  try {
    context.watchMermaidDiagrams([nearDiagram]);
    context.watchMermaidForRecycling(farDiagram);
    context.watchFindRender();
    context.watchMinimapSlider();
    context.bindDocumentMinimapPreview(track);
    context.observeReaderReflow();
    context.wireGraphResize({});
  } finally {
    appEl.querySelector = wasQuery;
  }
  return [
    ['the diagram draw watch', 'IntersectionObserver', nearDiagram],
    ['the diagram recycler', 'IntersectionObserver', farDiagram],
    ['the find bar re-render watch', 'MutationObserver', appEl],
    ['the code view slider clamp', 'MutationObserver', rail],
    ['the minimap clone watch', 'MutationObserver', body],
    ['the minimap rail fit', 'ResizeObserver', track],
    ['the reader reflow watch', 'ResizeObserver', body],
    ['the graph canvas fit', 'ResizeObserver', canvas],
  ];
}

check('the eight installers a bare boot never calls each register their watcher', () => {
  const context = runShell(source);
  const wanted = [...bootRegistrations(context), ...installerRegistrations(context)];
  holdsRegistrations(context.__watchers, wanted);
  const [, , rail] = wanted.find(([name]) => name === 'the code view slider clamp');
  let dropped = false;
  try {
    holdsRegistrations(context.__watchers.filter((one) => one.target !== rail), wanted);
  } catch (_) {
    dropped = true;
  }
  if (!dropped) throw new Error('the record still read as complete with a registration taken out of it');
});

// ---- 2e. every kept callback is fired once ---------------------------------
//
// A kept registration is still a callback nobody has ever run, which is where a name retired out of the page sits: the theme sweep called a function deleted from the shell and passed every check while it threw at a reader on every theme change. So each one is fired once with a stand-in entry shaped for its kind, and a throw fails here naming the watcher and what it watches. A fire proves the body runs and its bare calls resolve, not every branch — the zero-size stand-ins take the early returns, and that is the shape the shipped fault had.

/** The one entry a `kind` watcher's callback is handed, shaped the way the browser shapes it. An empty list would walk past the two diagram recyclers' whole bodies, which are loops over what they are given. */
function standInEntry(kind, target, options) {
  if (kind === 'IntersectionObserver') return { target, isIntersecting: false, intersectionRatio: 0 };
  if (kind === 'ResizeObserver') {
    return { target, contentRect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }, contentBoxSize: [{ inlineSize: 0, blockSize: 0 }] };
  }
  return { type: 'attributes', attributeName: (options.attributeFilter || [])[0] || 'class', target, addedNodes: [], removedNodes: [] };
}

/** What to call a watched element in a failure, so the throw names something a reader can find. */
function describeWatchTarget(target) {
  if (!target) return 'nothing';
  return target.id || String(target.className || '').trim() || String(target.tagName || 'element').toLowerCase();
}

/** Fires every kept callback once, rethrowing with the watcher's kind and target. */
function fireEveryCallback(watchers) {
  for (const one of watchers) {
    try {
      one.callback([standInEntry(one.kind, one.target, one.options)], one);
    } catch (error) {
      throw new Error(`the ${one.kind} on ${describeWatchTarget(one.target)} threw when it was fired: ${(error && error.message) || error}`);
    }
  }
}

check('every watcher callback the page registers runs to its end when it is fired', () => {
  const context = runShell(source);
  installerRegistrations(context);
  fireEveryCallback(context.__watchers);
});

check('a callback naming something the page no longer defines fails, and the failure names its watcher', () => {
  const context = runShell(source);
  const target = fakeElement('retiredNameHolder');
  // Its own record rather than the page's, so this proves the wrapper and never doubles as a second reading of the check above.
  const retired = [{ kind: 'ResizeObserver', callback: () => context.thisNameWasRetiredOutOfThePage(), target, options: {} }];
  let said = '';
  try {
    fireEveryCallback(retired);
  } catch (error) {
    said = String(error.message);
  }
  if (!said) throw new Error('a callback calling a name the page does not define was fired and passed');
  for (const part of ['ResizeObserver', 'retiredNameHolder']) {
    if (!said.includes(part)) throw new Error(`the failure never named ${part}: ${said}`);
  }
});

// ---- 2f. one call, several children ----------------------------------------
//
// Three fragments build their own markup with `append` rather than a child at a time, so a stand-in page without it throws before the first line of a build — and the checks standing in its place had to read the fragment as text, which passes on a binding that is written correctly and never reached.

check('the stand-in page takes several children in one call, and a string among them as text', () => {
  const { document } = fakePage();
  const parent = fakeElement('appendHolder');
  const first = document.createElement('div');
  const last = document.createElement('div');
  if (parent.append(first, 'between', last) !== undefined) throw new Error('append answered something; the platform answers nothing');
  if (parent.children.length !== 3) throw new Error(`one call put ${parent.children.length} children in the parent`);
  if (parent.children[0] !== first || parent.children[2] !== last) throw new Error('the children did not land in the order they were handed over');
  // The same node createTextNode answers, so a builder mixing a string with a created node reads back as one list of children.
  const made = document.createTextNode('between');
  const written = parent.children[1];
  if (written.textContent !== made.textContent || written.tagName !== undefined) {
    throw new Error('a string among the children is not the text node createTextNode answers');
  }
  // A real move, the way appendChild is one: the app-bar fold takes a button out of one container and puts it in another.
  const elsewhere = fakeElement('appendMovedTo');
  elsewhere.append(first);
  if (parent.children.includes(first)) throw new Error('a child moved by append is still listed in the parent that was holding it');
  if (first.parentElement !== elsewhere) throw new Error('a child moved by append never reached the parent it was moved to');
  // The fragment the speed reader builds its words in is the same stand-in, so it takes them the same way.
  const fragment = document.createDocumentFragment();
  fragment.append(document.createElement('span'), ' ', document.createElement('span'));
  if (fragment.children.length !== 3) throw new Error('the fragment the page builds in cannot take children in one call');
});

// ---- 2g. an emptied container is empty --------------------------------------
//
// A stand-in that keeps what a container was told to drop cannot tell a redraw from a doubling — and a check pressing a control the app has already taken off the screen finds it and passes.

check('the stand-in page empties a container when its text or its markup is written', () => {
  const { document } = fakePage();
  for (const name of ['textContent', 'innerHTML']) {
    const parent = fakeElement(`emptied-${name}`);
    parent.appendChild(document.createElement('div'));
    parent.appendChild(document.createElement('div'));
    parent[name] = '';
    if (parent.children.length) throw new Error(`writing ${name} left ${parent.children.length} children standing`);
    if (parent[name] !== '') throw new Error(`${name} read back as ${JSON.stringify(parent[name])}`);
    // A nonempty write is the same write: the string is held and read back, and the children still go.
    parent.appendChild(document.createElement('div'));
    parent[name] = 'a line';
    if (parent.children.length) throw new Error(`a nonempty ${name} left the children standing`);
    if (parent[name] !== 'a line') throw new Error(`${name} read back as ${JSON.stringify(parent[name])} rather than what was written`);
  }
  // The other name is left standing on purpose: eight checks rebind it to hand-made text for a line being typed on.
  const typed = fakeElement('emptied-typed-on');
  typed.childNodes = [document.createTextNode('what was typed')];
  typed.textContent = '';
  if (typed.childNodes.length !== 1) throw new Error('emptying the text took down a childNodes a check had rebound');
  // Still one holder behind the two names, so a raw-source block reads back the bytes it was given.
  const block = fakeElement('emptied-source');
  block.innerText = '# Title\n';
  if (block.textContent !== '# Title\n' || block.innerText !== '# Title\n') throw new Error('innerText stopped mirroring the text');
  // The markup becomes children, because a panel the page drew is a panel the next line reaches back into. The text parses nothing: it is words, and eight checks rebind it to hand-made ones.
  const drawn = fakeElement('emptied-markup');
  drawn.innerHTML = '<section class="empty-state"><button type="button" class="primary-open">Choose file</button><img src="leaf.png"><p class="empty-vault-help">One folder of notes</p></section>';
  if (drawn.children.length !== 1) throw new Error(`a written panel hung ${drawn.children.length} elements off the container rather than its one section`);
  const section = drawn.children[0];
  if (section.tagName !== 'SECTION' || !section.classList.contains('empty-state')) {
    throw new Error(`the panel came back as a ${section.tagName} wearing ${JSON.stringify(section.className)}`);
  }
  // Both of the two ways the page asks for what it drew: by class and by tag, at whatever depth it landed.
  const button = section.children[0];
  if (!button || button.tagName !== 'BUTTON' || !button.classList.contains('primary-open')) throw new Error('the button the panel names was not built');
  if (button.getAttribute('type') !== 'button') throw new Error(`the button lost the attributes its markup gave it: ${JSON.stringify(button.getAttribute('type'))}`);
  // A tag that closes itself takes nothing inside it, or everything after a picture is drawn as its child.
  const picture = section.children[1];
  if (!picture || picture.tagName !== 'IMG' || picture.children.length) throw new Error('a self-closing tag was left holding what came after it');
  const help = section.children[2];
  if (!help || help.tagName !== 'P' || !help.classList.contains('empty-vault-help')) throw new Error('the line after the picture is not standing beside it');
  // A redraw replaces what was there rather than stacking a second drawing on it.
  drawn.innerHTML = '<p class="empty-subtitle"></p>';
  if (drawn.children.length !== 1 || drawn.children[0].tagName !== 'P') throw new Error('a second write left the first drawing standing');
  const words = fakeElement('emptied-words');
  words.textContent = '<div></div>';
  if (words.children.length) throw new Error('the text was parsed as markup');
});

// ---- 2h. a node taken out has no holder -------------------------------------
//
// Taking a node out of the page sets its parent to nothing, and that is how the page asks whether the thing it is closing is still standing: the diagram menu and the box its label is typed into both close that way. A stand-in keeping the old holder leaves each of those guards on one branch for ever — a check closing a menu twice proves nothing about the second close, and a guard broken the other way, so that it stops taking a live node out, passes exactly the same.

check('the stand-in page lets the old holder go on every way of taking a child out', () => {
  const { document } = fakePage();
  const ways = {
    removeChild: (parent, child) => parent.removeChild(child),
    remove: (parent, child) => child.remove(),
    textContent: (parent) => {
      parent.textContent = '';
    },
    innerHTML: (parent) => {
      parent.innerHTML = '';
    },
  };
  for (const [name, take] of Object.entries(ways)) {
    const parent = fakeElement(`released-${name}`);
    const child = document.createElement('div');
    parent.appendChild(child);
    if (child.parentElement !== parent || child.parentNode !== parent) throw new Error(`a child appended before ${name} never named the parent holding it`);
    take(parent, child);
    if (parent.children.includes(child)) throw new Error(`${name} left the child listed in the parent`);
    if (child.parentElement !== null) throw new Error(`${name} left parentElement naming ${child.parentElement.id}`);
    if (child.parentNode !== null) throw new Error(`${name} left parentNode naming ${child.parentNode.id}`);
  }
  // A move is not a removal: the same detach runs first and the new holder is assigned straight after it, by either route in.
  const from = fakeElement('releasedMoveFrom');
  const to = fakeElement('releasedMoveTo');
  const moved = document.createElement('div');
  from.appendChild(moved);
  to.appendChild(moved);
  if (from.children.includes(moved)) throw new Error('a moved child is still listed in the parent that was holding it');
  if (moved.parentElement !== to || moved.parentNode !== to) throw new Error('a moved child does not name the parent it was moved to');
  from.prepend(moved);
  if (moved.parentElement !== from) throw new Error('a child put at the front of a parent does not name it');
  // Losing a holder is not leaving the rendered page: only remove says a node and everything under it is disconnected.
  const kept = fakeElement('releasedConnected');
  const staying = document.createElement('div');
  kept.appendChild(staying);
  kept.removeChild(staying);
  if (!staying.isConnected) throw new Error('removeChild marked a node disconnected; only remove does that');
  const emptied = fakeElement('releasedConnectedEmptied');
  const alsoStaying = document.createElement('div');
  emptied.appendChild(alsoStaying);
  emptied.textContent = '';
  if (!alsoStaying.isConnected) throw new Error('emptying the text marked a node disconnected; only remove does that');
  const going = document.createElement('div');
  const under = document.createElement('span');
  going.appendChild(under);
  fakeElement('releasedDisconnected').appendChild(going);
  going.remove();
  if (going.isConnected || under.isConnected) throw new Error('remove left the node or something under it connected');
});

// ---- 2i. a class query finds what the page drew -----------------------------
//
// A page answering only for the classes its markup declares says null for every control the app draws — a growl, a menu, a sheet, the rename box — while the thing is standing on the surface. That is the same answer as nothing being there, so code that finds an element by class cannot be checked at all, and a guard reading it takes the same branch on every run and can never be seen to be wrong.

check('the stand-in page finds a class the page drew, and stops finding it once it goes', () => {
  // Its own boot rather than the shared one: the query reads the page as it stands, so a growl an earlier check left standing on the shared surface would let this pass with nothing drawn.
  const page = runShell(source);
  const surface = page.document.getElementById('appSurface');
  if (page.document.querySelector('.app-toast')) throw new Error('a growl was standing before one was drawn');
  page.leafToast('probe growl');
  const growl = page.document.querySelector('.app-toast');
  if (!growl) throw new Error('a growl standing on the surface is not found by its class');
  if (!surface.children.includes(growl)) throw new Error('the class query answered with something the surface is not holding');
  if (String(growl.textContent) !== 'probe growl') throw new Error(`the class query found some other element: ${growl.textContent}`);
  // The surface carries the class the walk starts at, so a walk over its children alone would answer null for this one.
  if (page.document.querySelector('.app-surface') !== surface) throw new Error('the surface is not found by its own class');
  // A class the markup declares still answers, and with the page's own element every time — two fragments asking for the same container have to get the same container.
  const lead = page.document.querySelector('.app-bar-lead');
  if (!lead || lead !== page.document.querySelector('.app-bar-lead')) throw new Error('a class the markup declares stopped answering, or answered twice with different elements');
  // Deeper than the surface's own children, which is where every drawn control that is not a growl lands.
  const nested = page.document.createElement('div');
  nested.className = 'probe-nested';
  lead.appendChild(nested);
  if (page.document.querySelector('.probe-nested') !== nested) throw new Error('a class drawn below the surface\'s own children is not found');
  // One of several classes on an element answers, the way a real class attribute does.
  nested.className = 'probe-nested probe-second';
  if (page.document.querySelector('.probe-second') !== nested) throw new Error('the second of two classes on an element is not found');
  // Marked gone by hand while still listed in its holder, which is how several checks retire a line: refused, the same as an id taken out of the page is.
  nested.isConnected = false;
  if (page.document.querySelector('.probe-nested')) throw new Error('an element marked gone is still found by its class');
  nested.isConnected = true;
  growl.remove();
  nested.remove();
  if (page.document.querySelector('.app-toast')) throw new Error('a growl taken out of the page is still found by its class');
  if (page.document.querySelector('.probe-nested')) throw new Error('an element taken out of the page is still found by its class');
});

// ---- 2j. an element answers about its own children --------------------------
//
// An element answering any query with a fresh element is never holding nothing, so a guard written as "refuse this if the line is carrying a picture, a table or a rule" can only ever be told it is — and every check wanting the other answer has to switch the query off in the line above the press. That is a guard stuck on one branch and a workaround somebody writes on purpose.

check('a stand-in element answers a query about its own children, and answers nothing when it has none', () => {
  const { document } = fakePage();
  const line = document.createElement('p');
  // Nothing in it: the answer the reflex could never give, and the one the plus's own refusal turns on.
  if (line.querySelector('img, svg, hr, table, video, iframe, input') !== null) throw new Error('a line holding nothing was told it is holding something');
  if (line.querySelectorAll('img').length) throw new Error('a list query over an empty line answered with something');
  const picture = document.createElement('img');
  line.appendChild(picture);
  if (line.querySelector('img, svg, hr, table, video, iframe, input') !== picture) throw new Error('a line holding a picture did not answer with it');
  // The tag it was made with, not the one the query happened to name: a query for something else is still nothing.
  if (line.querySelector('table') !== null) throw new Error('a line holding a picture answered a query for a table');
  // Below the first row of children, which is where a rendered document puts most of what a guard asks about.
  const quote = document.createElement('blockquote');
  const inner = document.createElement('table');
  quote.appendChild(document.createElement('p'));
  quote.children[0].appendChild(inner);
  if (quote.querySelector('table') !== inner) throw new Error('a table one level down was not found');
  // By class as well as by tag, and both ways a class is written on the page.
  const drawn = document.createElement('div');
  const added = document.createElement('span');
  added.classList.add('block-insert-row');
  const written = document.createElement('span');
  written.className = 'block-insert-row';
  drawn.append(added, written);
  if (drawn.querySelector('.block-insert-row') !== added) throw new Error('a class put on with the list is not found, or not the first of two');
  if (drawn.querySelectorAll('.block-insert-row').length !== 2) throw new Error('the list query missed one of the two ways a class is written');
  // Document order, so the first result is the first one drawn.
  if (drawn.querySelectorAll('span')[1] !== written) throw new Error('the list query answered out of the order the children stand in');
});

// ---- 2k. one class, reached by either name ----------------------------------
//
// A browser keeps a class in one place. Two stores that never meet mean a class put on through the list is invisible to the name and a class written by name is invisible to the list — so eight guards asking an element whether it wears a class the markup, a rendered document or a name write gave it are told no for ever, and every check that needs the other answer hand-rolls an element beside the press.

check('a class on the stand-in element is one class, whichever name put it there', () => {
  // Its own boot, so the probes below are the only ones on the surface and the markup's own class is read off a page nothing has edited.
  const page = runShell(source);
  const element = page.document.createElement('div');
  // In through the list, out through the name — and found by the page's class query, which is written over the name.
  element.classList.add('probe-listed');
  if (element.className !== 'probe-listed') throw new Error(`a class added through the list reads back by name as ${JSON.stringify(element.className)}`);
  page.document.getElementById('appSurface').appendChild(element);
  if (page.document.querySelector('.probe-listed') !== element) throw new Error('a class added through the list is not found by the page');
  // In through the name, out through the list — both of them, because one write carries several classes.
  element.className = 'probe-written probe-second';
  if (!element.classList.contains('probe-written') || !element.classList.contains('probe-second')) {
    throw new Error(`a class written by name did not reach the list: ${element.className}`);
  }
  // All of them come back, not the first: an element wears every class it was written with.
  if (element.className !== 'probe-written probe-second') throw new Error(`two classes written by name read back as ${JSON.stringify(element.className)}`);
  // A write replaces what was there rather than adding to it, the way the attribute does.
  if (element.classList.contains('probe-listed')) throw new Error('a write by name left the class it replaced standing on the list');
  // Out through the list, and what is left still reads back by name.
  element.classList.remove('probe-written');
  if (element.className !== 'probe-second') throw new Error(`a removal through the list left ${JSON.stringify(element.className)} behind the name`);
  // The class the app-shell markup declares, which arrives by name and is the one those eight guards ask the list about.
  const surface = page.document.getElementById('appSurface');
  if (!surface.classList.contains('app-surface')) throw new Error(`a class the markup declared does not reach the list: ${surface.className}`);
});

// ---- 2l. the words come with the markup -------------------------------------
//
// The page draws whole panels as one string and reaches straight back into what it drew, so the words between the tags have to come with the elements. A container that held only the elements says nothing for every panel alike, which is an answer that is always the same in the direction that reads as a guard having fired: `blockIsEmpty` calls a line empty on its text alone, so every panel the page really drew with a sentence in it would pass the emptiness test.

check('the words in the markup the page draws come with the elements', () => {
  const drawn = fakeElement('worded-panel');
  drawn.innerHTML = '<section class="empty-state"><h1>Open a file</h1><p>Or drop one here</p></section>';
  const section = drawn.children[0];
  const heading = section.children[0];
  if (heading.textContent !== 'Open a file') throw new Error(`a heading the page drew says ${JSON.stringify(heading.textContent)}`);
  // An element wrapping another answers with what both of them say, at whatever depth the words landed.
  if (section.textContent !== 'Open a fileOr drop one here') throw new Error(`the panel around them says ${JSON.stringify(section.textContent)}`);
  // Words on either side of a child come back in the order they were written, which two buckets joined one after the other could not do.
  const line = fakeElement('worded-line');
  line.innerHTML = '<p>A <b>bold</b> word</p>';
  if (line.textContent !== 'A bold word') throw new Error(`words on either side of a child read back as ${JSON.stringify(line.textContent)}`);
  // Words with no tag around them are text in a browser too.
  const bare = fakeElement('worded-bare');
  bare.innerHTML = 'a line';
  if (bare.textContent !== 'a line') throw new Error(`markup with no tag in it says ${JSON.stringify(bare.textContent)}`);
  // The guard the whole family was found through, taken off the page itself rather than written a second time here.
  if (!booted) throw new Error('the page never booted, so the guard could not be asked');
  const guard = booted.blockIsEmpty;
  if (typeof guard !== 'function') throw new Error('the page no longer carries the guard that reads a line for what is on it');
  if (guard(heading)) throw new Error('the guard calls a drawn heading with a sentence in it empty');
  const blank = fakeElement('worded-blank');
  blank.innerHTML = '<p></p>';
  if (!guard(blank.children[0])) throw new Error('the guard calls a line drawn with nothing in it a line that says something');
  // A write of the text still replaces the lot, so a parsed element says only what was written over it.
  line.textContent = 'plain';
  if (line.children.length) throw new Error('a write over parsed markup left the children standing');
  if (line.textContent !== 'plain') throw new Error(`a write over parsed markup left it saying ${JSON.stringify(line.textContent)}`);
  // And a redraw with nothing in it does not answer with what the container said before.
  drawn.innerHTML = '';
  if (drawn.textContent !== '') throw new Error(`a redrawn container still says ${JSON.stringify(drawn.textContent)}`);
});

// ---- 2m. an element hands over the first thing it is holding ----------------
//
// The reading render draws a document as one string and takes the layout it just drew back out of the surface by this name, then hands it to the pass that asks a document's fields for a growl. A stand-in without the name hands over nothing, and that pass throws on the first line of it — so the whole render is unreachable without this.

check('an element hands over the first element it is holding, and nothing when it holds none', () => {
  const empty = fakeElement('first-empty');
  if (empty.firstElementChild !== null) throw new Error('an element holding nothing handed over something');
  const drawn = fakeElement('first-drawn');
  drawn.innerHTML = '<div class="reader-layout"><div class="document-body"><p>a line</p></div></div>';
  const layout = drawn.children[0];
  if (drawn.firstElementChild !== layout) throw new Error('the first element the markup declared is not the one handed over');
  if (layout.firstElementChild !== layout.children[0]) throw new Error('the name does not follow down into what the layout is holding');
  // Words with no tag around them are contents and not children, so the first *element* is still the element.
  const worded = fakeElement('first-worded');
  worded.innerHTML = 'a run of words<span>and a child</span>';
  if (worded.firstElementChild !== worded.children[0]) throw new Error('a run of words before the first child was handed over as the first element');
  // It follows the children rather than being read once, which is what an assignment beside them would do.
  const moving = fakeElement('first-moving');
  const one = fakeElement('first-one');
  const two = fakeElement('first-two');
  moving.append(one, two);
  if (moving.firstElementChild !== one) throw new Error('the first of two children is not the one handed over');
  one.remove();
  if (moving.firstElementChild !== two) throw new Error('the first child going left the name still answering with it');
  // A redraw empties it, the way it empties everything else the container was holding.
  moving.innerHTML = '';
  if (moving.firstElementChild !== null) throw new Error('a redrawn container still hands over what it used to hold');
});

// ---- 2n. an attribute the markup declared is something a query can find -----
//
// A rendered block carries where it starts in the source as an attribute, and both landings that put a returning reader back where they were ask for it: the render asks the document body for every block carrying one, and the source button asks the element under the reader for its nearest. A matcher that reads a tag and a class and nothing else answers the first with an empty list and the second with null for ever — so the landing falls through to the top of the document and the toggle arms nothing, on every run, with no way to see it.

check('a query and a nearest walk both find the block the markup declared by its source start', () => {
  const body = fakeElement('src-body');
  body.innerHTML = '<div class="document-body"><h1 data-src-start="0">Title</h1><p data-src-start="12">A line <em>with a word in it</em></p><p class="stray">no range</p></div>';
  const found = body.querySelectorAll('[data-src-start]');
  if (found.length !== 2) throw new Error(`the blocks carrying a source range came back as ${found.length}`);
  if (found[0].dataset.srcStart !== '0' || found[1].dataset.srcStart !== '12') throw new Error('the blocks came back out of the order the markup declared them');
  // The single form answers with the first of them, the way the list's first entry does.
  if (body.querySelector('[data-src-start]') !== found[0]) throw new Error('the single query answered with something other than the first block');
  // A name the markup never declared finds nothing, or every block in every document would answer as the one the reader is on.
  if (body.querySelectorAll('[data-line-start]').length) throw new Error('a name the markup did not declare was found on something');
  if (body.querySelector('[data-line-start]') !== null) throw new Error('the single query answered for a name the markup did not declare');
  // The walk up, which is the question the source button asks: from the word the reader is on, out to the block holding it.
  const word = found[1].children[0];
  if (word.closest('[data-src-start]') !== found[1]) throw new Error('the walk up from a word inside a block did not answer with the block');
  // Starting at the element itself, the way the platform's does.
  if (found[1].closest('[data-src-start]') !== found[1]) throw new Error('a block carrying a source range did not answer with itself');
  // Past a block that carries none, to the first one above it that does — nothing here stops at the first parent.
  const stray = body.querySelector('.stray');
  if (stray.closest('[data-src-start]') !== null) throw new Error('a block outside every source range answered with one');
  const deep = fakeElement('src-deep');
  deep.innerHTML = '<section data-src-start="40"><div class="wrap"><span class="leaf">word</span></div></section>';
  const leaf = deep.querySelector('.leaf');
  if (leaf.closest('[data-src-start]') !== deep.children[0]) throw new Error('the walk up stopped at a holder carrying no source range');
  // A class and a tag answer the walk up too, since the page asks it for all three.
  if (leaf.closest('.wrap') !== deep.querySelector('.wrap')) throw new Error('the walk up no longer answers a class');
  if (leaf.closest('section') !== deep.children[0]) throw new Error('the walk up no longer answers a tag');
  if (leaf.closest('.no-such-class') !== null) throw new Error('the walk up answered a class nothing wears');
  // An attribute with no data- in front of it is asked of the element's own attributes.
  const flagged = fakeElement('src-flagged');
  flagged.innerHTML = '<button type="button" disabled>Save</button>';
  if (flagged.querySelectorAll('[type]').length !== 1) throw new Error('an attribute with no data- in front of it was not found');
  if (flagged.querySelectorAll('[name]').length) throw new Error('an attribute the markup did not declare was found');
});

// ---- 2o. one node against one whole selector --------------------------------
//
// The page has one guard that asks a box what it is rather than being told: whether the pointer resting near an edge is on that box's own scrollbar gutter, which is what raises the bar so it can be grabbed. It asks with the list of boxes that wear one, and that list spends a refusal, a child step, a descendant step and an either-of list — none of which a matcher reading a class, a bare attribute or a tag can answer. Worse than a no: comparing a tag to everything before the first space reads `pre > code` as `pre`, so every code block's holder answers yes to a wearer it is not.

check('one selector is read as its own parts rather than as its first word', () => {
  const wearers = '.leaf-scroll, .library-scroll, .reader-shell:not(.has-minimap), .table-lane > table, .document-body :is(pre, pre > code, .math-display, .frontmatter, table)';
  const entries = selectorParts(wearers);
  // Five wearers, not nine pieces: the commas inside `:is(...)` group selectors within one entry, and cutting there hands the matcher `.document-body :is(pre` and `table)`, which are not selectors at all.
  if (entries.length !== 5) throw new Error(`the wearer list came back as ${entries.length} pieces: ${entries.join(' | ')}`);
  if (entries[4] !== '.document-body :is(pre, pre > code, .math-display, .frontmatter, table)') throw new Error(`the either-of list did not arrive whole: ${entries[4]}`);

  const holder = fakeElement('selector-holder');
  holder.innerHTML = '<p class="leaf-editable" data-src-start="4">A line</p><p class="leaf-editable">No range</p><pre class="hljs">code</pre><section class="reader-shell">reading</section><section class="reader-shell has-minimap">reading</section>';
  const [ranged, plain, block, bare, mapped] = holder.children;
  // Asked through the walk up, which starts at the node itself, so the walk and the query below are held to reading one selector the same way.
  const asks = (node, selector) => node.closest(selector) === node;

  // A compound is every part of it answering on the one node, so a part that does not answer refuses the whole.
  if (!asks(ranged, 'p.leaf-editable[data-src-start]')) throw new Error('a node wearing every part of a compound was refused by it');
  if (asks(plain, 'p.leaf-editable[data-src-start]')) throw new Error('a node missing one part of a compound was matched by it');
  if (asks(block, 'p.leaf-editable')) throw new Error('a compound matched a node of another tag');

  // A refusal, each way round.
  if (!asks(bare, '.reader-shell:not(.has-minimap)')) throw new Error('a reading surface with no minimap was refused by the one entry that names it');
  if (asks(mapped, '.reader-shell:not(.has-minimap)')) throw new Error('a reading surface that has a minimap answered the entry that refuses one');

  // An either-of list, each way round.
  if (!asks(block, ':is(pre, .math-display)')) throw new Error('a node named by an either-of list was refused by it');
  if (asks(plain, ':is(pre, .math-display)')) throw new Error('a node named by no part of an either-of list answered it');

  // The false yes this check exists for: a selector is read as its steps and a tag as a whole word, so `pre > code` is not the tag `pre`.
  if (asks(block, 'pre > code')) throw new Error('a code block holder answered a selector naming what is inside it');
  if (!asks(block, 'pre')) throw new Error('a tag on its own stopped answering');

  // And the query down reads the same selector the same way, since both ask the one matcher.
  if (holder.querySelectorAll('.reader-shell:not(.has-minimap)').length !== 1) throw new Error('the query down disagreed with the walk up about a refusal');
  if (holder.querySelectorAll('pre > code').length) throw new Error('the query down answered a code block holder for what is inside it');
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

  // The other side of the same bargain: a comment is stripped before the page sees it, so the host must not report a span for it (`block_source_map_leaves_out_a_comment_between_two_paragraphs`). This proves both halves — the spans it reports stamp every element, and a span for the comment would leave the whole note uneditable.
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

    // What the host must not send: a span for the comment, with no element to pair it with.
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
    // The last block of the file must not inherit the rule above it, since a rule is the one kind the page never opens.
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
    // In the order the file was written.
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
    el.querySelector = (selector) => matchingDescendants(el, selector)[0] || null;
    el.querySelectorAll = (selector) => matchingDescendants(el, selector);
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

  // A footnote reference is a superscript number on screen and `[^name]` in the file, so a paragraph carrying one has to stay in typing-as-it-looks rather than dropping out and opening as raw source. The name is on the element; the number is assigned by first use and cannot be written back.
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

  // A list written with blank lines between its items draws each item's words in a paragraph of their own, and a paragraph in a list must not send the whole list to the raw-source editor, or spacing a list out takes typing-as-it-looks away from it. The blank lines go back on the way out, or the list would close up under the reader.
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

  // ---- a checkbox is armed against the document the reader is looking at ------
  //
  // A checkbox is bound by position: the page counts the boxes in the drawn document, pairs them one for one against the task list the front tab answered, and sends the Nth box's index back. So the binding is only right while exactly one drawn document stands inside the reader — and nothing in the page says so. Four elements wear `.document-body`, three of them outside the reader, and a table opened full-window builds a fourth inside it. That one lands after the drawn document, so the first is still the reader's own; it is right by the order of two appends and by nothing else. Get that order wrong and a tick is written into a file nobody was looking at, silently, because the count guard passes whenever the two documents hold the same number of tasks.
  check('the boxes a press arms are the drawn document inside the reader, not a second one standing beside it', () => {
    const appEl = booted.document.getElementById('app');
    // The boxes answer their own body rather than the page's matcher: the stand-in reads `input[type="checkbox"]` as one long attribute name and finds nothing (`the-stand-in-page-cannot-read-an-attribute-with-a-value`). Which body the binding takes is the page's own query, and that is what is under test here, so it is left alone.
    const drawn = (count) => {
      const body = fakeElement('');
      body.className = 'document-body';
      const boxes = [];
      for (let at = 0; at < count; at += 1) {
        const box = fakeElement('');
        box.tagName = 'INPUT';
        body.appendChild(box);
        boxes.push(box);
      }
      const wasQuery = body.querySelectorAll;
      body.querySelectorAll = (selector) => (String(selector) === 'input[type="checkbox"]' ? boxes : wasQuery.call(body, selector));
      return { body, boxes };
    };
    const armed = (boxes) => boxes.map((box) => box.dataset.taskIndex);
    const press = (box) => (box.listeners.get('change') || []).forEach((handler) => handler({}));

    const reader = drawn(3);
    const table = drawn(3);
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      appEl.appendChild(reader.body);
      booted.bindTaskCheckboxes(['one', 'two', 'three']);
      if (armed(reader.boxes).join(',') !== '0,1,2') throw new Error(`the drawn document's boxes were armed as ${JSON.stringify(armed(reader.boxes))}`);
      // And the index a press sends is the box's own place in that document, which is what the host writes into the front tab.
      press(reader.boxes[1]);
      if (JSON.stringify(sent) !== JSON.stringify([{ command: 'toggleTask', index: 1 }])) throw new Error(`pressing the second box sent ${JSON.stringify(sent)}`);

      // A table opened full-window stands a second element of the same name inside the reader, appended after the document. Binding again must still take the first.
      appEl.appendChild(table.body);
      for (const box of [...reader.boxes, ...table.boxes]) delete box.dataset.taskIndex;
      booted.bindTaskCheckboxes(['one', 'two', 'three']);
      if (armed(reader.boxes).join(',') !== '0,1,2') throw new Error(`with a table standing beside it the drawn document's boxes were armed as ${JSON.stringify(armed(reader.boxes))}`);
      if (armed(table.boxes).some((index) => index !== undefined)) throw new Error(`the full-window table's own boxes were armed as ${JSON.stringify(armed(table.boxes))}`);
      // The second bind wired the same boxes a second time, so a press now sends twice — the index each time is still the reader's own.
      sent.length = 0;
      press(reader.boxes[2]);
      if (sent.some((message) => message.index !== 2)) throw new Error(`a press after the second bind sent ${JSON.stringify(sent)}`);
      // The table's boxes send nothing at all: this path never reached them, so nothing is standing between its clicks and the reader's task list.
      sent.length = 0;
      press(table.boxes[0]);
      if (sent.length) throw new Error(`a box inside the full-window table sent ${JSON.stringify(sent)}`);
    } finally {
      booted.ipc.postMessage = wasSend;
      reader.body.remove();
      table.body.remove();
    }
    if (appEl.querySelector('.document-body')) throw new Error('the check left a drawn document standing in the reader');
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

  checkSettled('a drawing in a linked-note preview is made outside the layer the card scales, dropped for a card the pointer has left, and left a strip when it will not fit', async () => {
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const scale = vm.runInContext('linkHoverTipPreviewScale', booted);
    const wasMermaid = booted.window.mermaid;
    const drew = [];
    const drawnIn = [];
    const holding = (node, holder) => { for (let up = node; up; up = up.parentElement) if (up === holder) return true; return false; };
    // The drawing's own size, which mermaid writes into the markup as a `viewBox`. Set before each rest, because the whole of the fit rule is a question about a drawing's shape. `null` leaves the `viewBox` off, which is markup nobody has measured.
    let natural = { width: 570, height: 450 };
    // The card asks for the runtime the same way the reading page does, so a stand-in on `window.mermaid` is the whole of what `loadMermaid` needs.
    const runtime = {
      initialize: () => {},
      registerIconPacks: () => {},
      run: ({ nodes }) => {
        drew.push(nodes[0].textContent);
        // Where it was asked to draw, read while that block is still standing: it is let go the moment its drawing is moved into the card.
        drawnIn.push({ node: nodes[0], holder: nodes[0].parentElement, off: nodes[0].parentElement && nodes[0].parentElement.style.left, scaled: holding(nodes[0], scale) });
        // Mermaid's own markup: full width under a `max-width`, a `viewBox` and no height at all, which is why capping the height letterboxes the ink and leaves the box exactly where it was. A stand-in writing a bare `<svg>` with its rectangle hand-fed cannot tell the box and the ink apart, so no case here can fail on the difference. Marked with its own last word too, so a drawing that landed in another card's block is read rather than guessed at.
        const view = natural ? ' viewBox="0 0 ' + natural.width + ' ' + natural.height + '"' : '';
        nodes[0].innerHTML = '<svg data-drawn="' + nodes[0].textContent.trim().split(' ').pop() + '" width="100%"' + view + '></svg>';
        nodes[0].dataset.processed = 'true';
        return Promise.resolve();
      },
    };
    // Two turns of the loop: the runtime is answered in one and the drawing lands in the next, so a single turn reads a card that is still waiting.
    const settle = async () => { await new Promise((done) => setImmediate(done)); await new Promise((done) => setImmediate(done)); };
    const block = () => previewDocument.querySelectorAll('pre.mermaid')[0];
    const remembered = (source) => vm.runInContext(`[...mermaidRenderCache.keys()].some((key) => key.endsWith(${JSON.stringify(source)}))`, booted);
    // Restated on every step: the checks that wait all share one page, so another of them restoring its own stub between two awaits here would leave this one asking a runtime that is no longer there.
    const open = (html) => {
      booted.window.mermaid = runtime;
      previewDocument.innerHTML = html;
      vm.runInContext('drawLinkPreviewDiagrams();', booted);
    };
    try {
      vm.runInContext('activeHoverToken = 60; linkHoverTip.hidden = false;', booted);
      preview.classList.add('is-loaded');
      open('<p>Opening.</p><pre class="mermaid" data-language="mermaid">flowchart LR A--&gt;B</pre><p>And it reads on.</p>');
      // Nothing is written for the wait: the block is the stylesheet's own undrawn shape, and the words on either side of it are already drawn.
      if (block().dataset.processed) throw new Error('the block claimed a drawing before one was made');
      if (!previewDocument.innerHTML.includes('And it reads on.')) throw new Error('the words after the drawing waited on it');
      await settle();
      if (drew.length !== 1) throw new Error(`the card asked for ${drew.length} drawings rather than one`);
      if (block().dataset.processed !== 'true') throw new Error('the drawing never reached the block');
      if (!block().querySelector('svg')) throw new Error('the block was marked drawn with no drawing moved into it');
      if (block().dataset.cardDiagram) throw new Error('the block was left marked as still drawing');

      // Mermaid sizes every word's frame from what it reads while drawing, so a block inside the layer the card scales gives each word a frame at the card's shrink and the word, still drawn full size, is clipped — and the shared memo then hands that same picture to the reading page.
      if (drawnIn[0].node === block()) throw new Error("the drawing is still made in the card's own block");
      if (drawnIn[0].scaled) throw new Error('the drawing is made inside the layer the card scales, so every word comes out at the shrink');
      if (!drawnIn[0].holder || !drawnIn[0].holder.classList.contains('document-body')) throw new Error('the drawing is not made in a document body, so it is drawn in different text from the page');
      // Off screen rather than hidden: a hidden box has no layout, and mermaid measures nothing in one.
      if (drawnIn[0].off !== '-10000px' || drawnIn[0].holder.hidden) throw new Error('the holder is not placed off screen, so it stands in the page beside the card');
      if (!vm.runInContext('linkPreviewDiagramHolder === null', booted)) throw new Error('the holder was left standing in the page after the drawing in it was done');

      // A second rest on the same link: the drawing comes out of the page's own memo and nothing is made again.
      open('<p>Opening.</p><pre class="mermaid" data-language="mermaid">flowchart LR A--&gt;B</pre>');
      await settle();
      if (drew.length !== 1) throw new Error('a second rest on the same link made the drawing again');
      if (block().dataset.processed !== 'true') throw new Error('the remembered drawing never reached the second card');

      // The pointer moved on while it drew, so the answer lands on a card nobody is looking at and is dropped rather than kept.
      open('<pre class="mermaid" data-language="mermaid">flowchart LR gone</pre>');
      vm.runInContext('activeHoverToken = 61;', booted);
      await settle();
      if (drew.length !== 2) throw new Error('the abandoned card never started its drawing, so nothing was dropped');
      if (remembered('flowchart LR gone')) throw new Error('a drawing made for a card nobody is looking at was remembered anyway');
      if (!remembered('flowchart LR A--&gt;B')) throw new Error('the two readings prove nothing if a drawing that was kept reads as missing too');

      // A drawing over the room is scaled into it and kept where it is still wide enough to read, and put back as the strip where it is not.
      vm.runInContext('activeHoverToken = 62;', booted);
      const wasStyle = booted.getComputedStyle;
      // Half the picture is 88 of the picture's own pixels, so at this shrink a drawing has 176 to land in; the narrowest a scaled drawing may be is a third of the picture, which is 84 where the reader sees it.
      const stubShrink = () => {
        booted.getComputedStyle = (element) => (element === preview ? { getPropertyValue: () => '0.5' } : wasStyle(element));
      };
      // The drawing is made outside the card and moved in, so the rectangle the fit rule reads is put on the card's own block rather than on the node the runtime drew into. It is the box mermaid's drawing keeps however hard its height is capped — its own natural width, at the room's height — and never the ink inside it, which is what the code has to work out for itself.
      const cardDrawnBox = (width) => {
        const card = block();
        const was = card.querySelector.bind(card);
        card.querySelector = (selector) => {
          const found = was(selector);
          if (found && selector === 'svg') found.getBoundingClientRect = () => ({ width, height: 88 });
          return found;
        };
      };
      const narrowest = vm.runInContext('LINK_PREVIEW_DIAGRAM_NARROWEST', booted);
      try {
        // The plan tree's own tracks page, which is what every link in its README points at: a page-tall flowchart, letterboxed to five pixels of ink inside a box that never narrowed.
        stubShrink();
        natural = { width: 262.9, height: 4105 };
        open('<pre class="mermaid" data-language="mermaid">flowchart LR TRACKS.md</pre>');
        cardDrawnBox(88.3);
        block().offsetHeight = 400;
        await settle();
        if (!(88.3 >= narrowest)) throw new Error('the box this case hands over is under the line on its own, so reading the box again would pass it and the case proves nothing');
        if (drew.length !== 3) throw new Error('the tall drawing was never made');
        if (block().dataset.processed) throw new Error('a drawing too narrow to read at the size it fits was left in the card');
        if (block().dataset.cardDiagram !== 'unshown') throw new Error('the block does not say the card will not draw it, so the strip rule lands on nothing');
        if (!block().textContent.includes('TRACKS.md')) throw new Error('the block that went back to the strip lost its own source text');
        stubShrink();
        open('<pre class="mermaid" data-language="mermaid">flowchart LR TRACKS.md</pre>');
        await settle();
        if (drew.length !== 3) throw new Error('a drawing already known not to fit was made a second time');
        if (block().dataset.cardDiagram !== 'unshown') throw new Error('the second rest lost the mark the strip rule keys on');

        // A pie chart is over the room too, and it is kept: what separates the two is how wide each still is once it fits. Its box is wider than the tall drawing's and so is its ink, so the change cannot pass by turning everything away.
        stubShrink();
        natural = { width: 570, height: 450 };
        open('<pre class="mermaid" data-language="mermaid">pie squarish</pre>');
        cardDrawnBox(195.3);
        block().offsetHeight = 400;
        await settle();
        if (drew.length !== 4) throw new Error('the square drawing was never made');
        if (block().dataset.processed !== 'true') throw new Error('a drawing that fits the room and is still wide enough to read was turned away');
        if (block().dataset.cardDiagram) throw new Error('a drawing that was kept was marked as one the card will not draw');

        // Markup nobody has measured: no `viewBox` to fold the box through, so the box is all there is to read and the drawing is kept on it.
        stubShrink();
        natural = null;
        open('<pre class="mermaid" data-language="mermaid">flowchart LR unmeasured</pre>');
        cardDrawnBox(195.3);
        block().offsetHeight = 400;
        await settle();
        if (drew.length !== 5) throw new Error('the drawing with no viewBox was never made');
        if (block().querySelector('svg').getAttribute('viewBox')) throw new Error('the case handed over a viewBox after all, so it never reached the reading it is here for');
        if (block().dataset.processed !== 'true') throw new Error('a drawing with no viewBox was turned away, so markup nobody has measured loses its picture');
      } finally {
        booted.getComputedStyle = wasStyle;
        natural = { width: 570, height: 450 };
      }

      // Two diagrams in one card are started at once, each on its own promise, so one block reused across them would have two renders in it.
      vm.runInContext('activeHoverToken = 63;', booted);
      open('<pre class="mermaid" data-language="mermaid">flowchart LR first</pre><pre class="mermaid" data-language="mermaid">flowchart LR second</pre>');
      await settle();
      if (drew.length !== 7) throw new Error(`a card with two diagrams asked for ${drew.length - 5} drawings rather than two`);
      const both = drawnIn.slice(-2);
      if (both[0].node === both[1].node) throw new Error('both were drawn in one block, so the second wrote over the first');
      const cards = previewDocument.querySelectorAll('pre.mermaid');
      const mark = (card) => { const svg = card.querySelector('svg'); return svg ? svg.dataset.drawn : null; };
      if (mark(cards[0]) !== 'first') throw new Error(`the first block holds ${mark(cards[0])} rather than its own drawing`);
      if (mark(cards[1]) !== 'second') throw new Error(`the second block holds ${mark(cards[1])} rather than its own drawing`);
      if (!vm.runInContext('linkPreviewDiagramHolder === null', booted)) throw new Error('the holder was left standing once both drawings were done');

      const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
      if (!css.includes('.link-hover-tip-preview-document pre.mermaid:not([data-processed="true"]):not([data-mermaid-render="failed"]):not([data-diagram-wait="far"])[data-card-diagram="unshown"] {')) throw new Error('the card has no strip rule for a drawing it will not show');
    } finally {
      booted.window.mermaid = wasMermaid;
      previewDocument.innerHTML = '';
      preview.classList.remove('is-loaded');
      vm.runInContext('activeHoverToken = 0; linkHoverTip.hidden = true;', booted);
    }
  });

  check('a page the host cannot draw drops the picture box instead of spinning', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const preview = vm.runInContext('linkHoverTipPreview', booted);
    const previewDocument = vm.runInContext('linkHoverTipPreviewDocument', booted);
    const kind = vm.runInContext('linkHoverTipKind', booted);
    const detail = vm.runInContext('linkHoverTipDetail', booted);
    const wasTimeout = booted.setTimeout;
    const wasStyle = booted.getComputedStyle;
    const wasSend = booted.ipc.postMessage;
    const waiting = [];
    const sent = [];
    booted.setTimeout = (fn) => waiting.push(fn);
    booted.getComputedStyle = (element) => (element === booted.document.documentElement ? { getPropertyValue: () => '300ms' } : wasStyle(element));
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    const gone = { href: 'notes/gone.md', getAttribute: (name) => (name === 'href' ? 'notes/gone.md' : null), getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }) };
    gone.closest = () => gone;
    try {
      // The pointer rests, the ask goes out, and the host answers that the page is not there to draw.
      vm.runInContext('activeHoverToken = 41; activeHoverLink = {}; linkHoverPointer = { clientX: 300, clientY: 300 }; linkHoverTip.hidden = false; showLinkHoverPreviewPlaceholder(); requestLinkPreview("notes/gone.md", 41);', booted);
      waiting.shift()();
      if (!sent.some((message) => message.command === 'previewLink')) throw new Error('the rested pointer never asked for the preview');
      booted.window.leafLinkPreview(41, '');
      if (!preview.hidden || tip.classList.contains('has-preview')) throw new Error('a page the host cannot draw left its spinner turning on the card');
      if (previewDocument.innerHTML !== '') throw new Error('the empty answer left a box behind with nothing in it');
      // Hovering it again reads the same answer out of the cache: no box, no second ask, and the card still says what the link is and where it points.
      sent.length = 0;
      vm.runInContext('activeHoverLink = null;', booted);
      booted.__hoverEvent = { target: gone, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('startLinkHover(__hoverEvent);', booted);
      booted.__frames.drain();
      if (!preview.hidden || tip.classList.contains('has-preview')) throw new Error('the second hover raised a box the host had already said it cannot fill');
      if (sent.some((message) => message.command === 'previewLink')) throw new Error('the cached empty answer asked the host all over again');
      if (tip.hidden || kind.textContent !== 'Another page' || detail.textContent !== 'notes/gone.md') throw new Error('the card lost the rows it can still answer');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.getComputedStyle = wasStyle;
      booted.ipc.postMessage = wasSend;
      vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1; linkPreviewCache.delete("notes/gone.md"); lineCountCache.delete("notes/gone.md");', booted);
      delete booted.__hoverEvent;
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

  check('a drawing\'s link asks with its address as text, not the object its href property answers', () => {
    const tip = vm.runInContext('linkHoverTip', booted);
    const written = 'TRACKS.md#links';
    // What a linked box in a diagram answers: an SVG link's `href` is an object holding the address, never the address.
    const link = {
      href: { baseVal: written, animVal: written },
      getAttribute: (name) => (name === 'href' ? written : null),
      getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
    };
    link.closest = () => link;
    const wasSend = booted.ipc.postMessage;
    const wasTimeout = booted.setTimeout;
    const wasRect = tip.getBoundingClientRect;
    const sent = [];
    const waiting = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.setTimeout = (fn) => waiting.push(fn);
      tip.getBoundingClientRect = () => ({ top: 0, left: 0, right: 240, bottom: 120, width: 240, height: 120 });
      booted.__hoverEvent = { target: link, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
      vm.runInContext('activeHoverLink = null; startLinkHover(__hoverEvent);', booted);
      waiting.forEach((fn) => fn());
      const count = sent.find((one) => one.command === 'countLines');
      const preview = sent.find((one) => one.command === 'previewLink');
      if (!count || !preview) throw new Error(`a diagram link asked for ${sent.map((one) => one.command).join(', ') || 'nothing'}`);
      for (const ask of [count, preview]) {
        if (typeof ask.href !== 'string') throw new Error(`${ask.command} carried ${JSON.stringify(ask.href)} where the host requires text`);
        if (ask.href !== written) throw new Error(`${ask.command} carried ${ask.href} instead of the address as written`);
      }
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.setTimeout = wasTimeout;
      tip.getBoundingClientRect = wasRect;
      vm.runInContext('hideLinkHoverTip(); activeHoverLink = null;', booted);
      delete booted.__hoverEvent;
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

  // Clearing the text out of a paragraph or a heading must not write the leftovers into the file — a bare `##`, or the literal text `<br>` that Chromium leaves in an emptied contenteditable. So an empty serialization is a delete of the whole line, and the range it deletes has to swallow one blank line too: a mapped range stops short of the separator (`trim_block_end`), so splicing the range alone stacks the blank lines from both sides.
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

  // ---- typing that has not been clicked out of yet ---------------------------
  // The stand-in window swallows a timer, and Save and Undo hand their own send to the next tick so a field box's settle is on the wire ahead of them. So a check that wants to see the write has to hold the timers and run them.
  const withPageTimers = (run) => {
    const queued = [];
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => queued.push(fn);
    const drain = () => {
      let ran = 0;
      while (queued.length) {
        if (ran > 100) throw new Error('the page kept asking for another timer');
        ran += 1;
        queued.shift()();
      }
    };
    try {
      return run(drain);
    } finally {
      booted.setTimeout = wasTimeout;
    }
  };

  // Raise an event at the window, through the page's own handlers in the order they registered.
  const raiseWindowEvent = (type, event) => {
    for (const handler of [...(booted.window.__windowListeners.get(type) || [])]) handler(event);
  };
  const pressWindowKey = (event) => raiseWindowEvent('keydown', event);
  const saveKeyPress = () => ({
    key: 's',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: Object.assign(new FakeElement(), { nodeType: 1, closest: () => null }),
    preventDefault() {},
    stopPropagation() {},
  });

  // A block of the open document with the caret in it and words typed since it was opened: on screen, and not yet clicked out of.
  const typedBlock = ({ kind = 'paragraph', tag = 'P', start, end, typed, baseline, innerSpan = null }) => {
    // The page's own stand-in element, so the editors can really be wired to it and the keystroke really reaches their listeners.
    const el = Object.assign(fakeElement(), {
      nodeType: 1,
      tagName: tag,
      isConnected: true,
      dataset: { blockKind: kind, srcStart: String(start), srcEnd: String(end) },
      childNodes: [{ nodeType: 3, nodeValue: typed }],
      textContent: typed,
      previousElementSibling: null,
      nextElementSibling: null,
      __editingActive: true,
      __editBaseline: baseline,
      __innerSpan: innerSpan,
    });
    el.getAttribute = (name) => (name === 'contenteditable' ? 'true' : null);
    el.contains = () => true;
    el.closest = () => el;
    return el;
  };

  // Keep a stand-in block's markup and its words in step, the way a real one does: a step put back rewrites the markup, and everything downstream reads the words back off the block.
  const wordsFollowMarkup = (el) => {
    let held = el.textContent;
    Object.defineProperty(el, 'innerHTML', {
      get: () => held,
      set: (value) => {
        held = value;
        el.textContent = value;
        el.childNodes[0].nodeValue = value;
      },
    });
    return el;
  };

  // Type into a block one character at a time, the way the page sees it: the words are already on screen when the keystroke arrives.
  const typeInto = (el, chars) => {
    for (const char of chars) {
      el.innerHTML = el.textContent + char;
      for (const handler of [...(el.listeners.get('input') || [])]) handler({ data: char, inputType: 'insertText' });
    }
  };

  // Ctrl+Z, or Ctrl+Shift+Z, at a block. Answers whether the page took the keystroke off the web view.
  const pressUndoKey = (target, { shift = false, key = 'z' } = {}) => {
    let prevented = 0;
    pressWindowKey({
      key,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: shift,
      isComposing: false,
      target,
      preventDefault() {
        prevented += 1;
      },
      stopPropagation() {},
    });
    return prevented > 0;
  };

  // The open document, the page's own record of it, and a clean slate to send into.
  const openTyping = (source, format = 'markdown') => {
    vm.runInContext(`currentState = { tabs: [{ path: 'notes.md' }], active: 0 };`, booted);
    vm.runInContext('pendingCaret = null; chromeBeforeTyping = null; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();', booted);
    vm.runInContext(`currentDocumentFormat = ${JSON.stringify(format)};`, booted);
    // No caret to carry unless a check draws one: the stand-in page has no selection of its own.
    booted.getSelection = () => null;
    booted.window.leafBlocksResynced({ source });
  };
  const restTyping = () => {
    booted.getSelection = () => null;
    vm.runInContext('currentState = null; pendingCaret = null; chromeBeforeTyping = null; dirtyByPath.clear(); undoableByPath.clear(); redoableByPath.clear();', booted);
    vm.runInContext("currentDocumentFormat = 'markdown';", booted);
    booted.window.leafBlocksResynced({ source: '' });
  };

  // Typing under the caret does not raise the dirty flag, so a save gated on that flag refuses outright when the typing is the only edit, and with an earlier edit behind it writes the file WITHOUT the words on screen. The commit goes first and the write follows it, which is the order held here.
  check('Ctrl+S while typing writes the typed words, and writes them before it saves', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA paragraph.\n';
      openTyping(source);
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const commands = posted.map((message) => message.command);
      if (commands.indexOf('editBlock') !== 0) {
        throw new Error(`the save sent ${JSON.stringify(commands)} rather than committing first`);
      }
      if (commands.indexOf('saveDocument') !== 1) {
        throw new Error(`nothing was saved: ${JSON.stringify(commands)}`);
      }
      const edit = posted[0];
      if (edit.start !== 9 || edit.end !== 21) {
        throw new Error(`the commit covered [${edit.start},${edit.end}) rather than the block`);
      }
      const written = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (written !== '# Title\n\nA paragraph, typed on.\n') {
        throw new Error(`the file would have become ${JSON.stringify(written)}`);
      }
      // And the session is closed behind it, so the click-out that follows does not write the same words a second time.
      if (block.__editingActive) throw new Error('the block was left holding an open session');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Every editor commits through the same path, so this is the same fix in a document spelled another way — and the one that would damage a file if the range were wrong: an element's commit splices BETWEEN its tags, never over them.
  check('Ctrl+S while typing on an element’s words writes them between the tags', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '<doc>\n<p>The words.</p>\n</doc>\n';
      openTyping(source, 'xml');
      // The span bindEditableBlocks stamps on the element: the bytes between `<p>` and `</p>`.
      const start = source.indexOf('The words.');
      const block = typedBlock({
        start: source.indexOf('<p>'),
        end: source.indexOf('</p>') + 4,
        typed: 'The words, typed on.',
        baseline: 'The words.',
        innerSpan: { start, end: start + 'The words.'.length },
      });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const edit = posted.find((message) => message.command === 'editBlock');
      if (!edit) throw new Error('typing on an element was never committed');
      const written = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (written !== '<doc>\n<p>The words, typed on.</p>\n</doc>\n') {
        throw new Error(`the file would have become ${JSON.stringify(written)}`);
      }
      if (posted.map((message) => message.command).indexOf('saveDocument') !== 1) {
        throw new Error('the element’s words were not saved after being committed');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The commit re-renders the whole page, and a caret still inside the committed block is dropped by that render unless the block claims it — which is saving mid-sentence putting the reader out of the words they are typing.
  check('after a mid-typing save the caret is back in the same block at the same place', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const wasRange = booted.document.createRange;
    try {
      openTyping('# Title\n\nA paragraph.\n');
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      // Where the caret sits inside the block, measured the way the page measures it: the text before it.
      const caretAt = 14;
      booted.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: true,
        getRangeAt: () => ({ startContainer: block.childNodes[0], startOffset: caretAt }),
      });
      booted.document.createRange = () => {
        let upTo = 0;
        return {
          selectNodeContents() {},
          setStart() {},
          setEnd: (_container, offset) => {
            upTo = offset;
          },
          collapse() {},
          cloneContents: () => ({ textContent: 'x'.repeat(upTo) }),
        };
      };
      withPageTimers((drain) => {
        pressWindowKey(saveKeyPress());
        drain();
      });
      const caret = vm.runInContext('pendingCaret', booted);
      if (!caret) throw new Error('the caret was dumped out of the block it was typed in');
      if (caret.srcStart !== 9) throw new Error(`the caret landed on the block at ${caret.srcStart}`);
      if (caret.textOffset !== caretAt) {
        throw new Error(`the caret came back at ${caret.textOffset} rather than ${caretAt}`);
      }
      if (caret.path !== 'notes.md') throw new Error('the caret was not stamped with its own document');
    } finally {
      booted.ipc = wasIpc;
      booted.document.createRange = wasRange;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Undo pressed mid-typing has to commit the typing first, or it steps back the edit BEFORE it — leaving the words on screen and taking away something the reader had finished with.
  check('Undo pressed mid-typing puts the block back to before the typing began', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA paragraph.\n');
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph, typed on.', baseline: 'A paragraph.' });
      booted.document.activeElement = block;
      withPageTimers((drain) => {
        booted.undoLastEdit();
        drain();
      });
      const commands = posted.map((message) => message.command);
      if (commands.indexOf('editBlock') !== 0 || commands.indexOf('undoEdit') !== 1) {
        throw new Error(`undo sent ${JSON.stringify(commands)} rather than committing and then stepping back`);
      }
      if (posted[0].text !== 'A paragraph, typed on.') {
        throw new Error(`the commit undo landed on wrote ${JSON.stringify(posted[0].text)}`);
      }

      // And with nothing typed, undo is the plain one it has always been: the baseline commits nothing.
      posted.length = 0;
      const quiet = typedBlock({ start: 9, end: 21, typed: 'A paragraph.', baseline: 'A paragraph.' });
      booted.document.activeElement = quiet;
      withPageTimers((drain) => {
        booted.undoLastEdit();
        drain();
      });
      if (posted.some((message) => message.command === 'editBlock')) {
        throw new Error('a block sitting at its baseline wrote an edit on its way to the undo');
      }
      if (!posted.some((message) => message.command === 'undoEdit')) {
        throw new Error('undo stopped reaching the host once it committed first');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The dot, Save and Undo all waited for the click-out, so a page with words typed on it read as saved and offered nothing to take them back with. They answer the first keystroke now — a promise phase 1's commit-first is what makes good on — and typing taken back to where it started has to put them out again, or a document nobody changed reads as edited for ever.
  check('one keystroke lights the dot, and taking the typing back puts it out', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      // Every kind of document commits through the same two editors, so the dot has to light in each of them the same way.
      for (const [format, source, typed, baseline] of [
        ['markdown', '# Title\n\nA paragraph.\n', 'A paragraph, typed on.', 'A paragraph.'],
        ['xml', '<doc>\n<p>The words.</p>\n</doc>\n', 'The words, typed on.', 'The words.'],
        ['eml', 'From: a@b.c\n\nThe message.\n', 'The message, typed on.', 'The message.'],
      ]) {
        posted.length = 0;
        openTyping(source, format);
        const block = typedBlock({
          start: source.indexOf(baseline),
          end: source.indexOf(baseline) + baseline.length,
          typed,
          baseline,
        });
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        const fire = (type, event) => {
          for (const handler of [...(block.listeners.get(type) || [])]) handler(event);
        };

        // The first keystroke, and nothing on the wire behind it: the promise is local until an action makes good on it.
        fire('input', {});
        if (!booted.isDocumentDirty('notes.md')) throw new Error(`${format}: a keystroke left the dot out`);
        if (vm.runInContext("undoableByPath.get('notes.md')", booted) !== true) {
          throw new Error(`${format}: a keystroke offered nothing to undo`);
        }
        if (posted.length) throw new Error(`${format}: a keystroke reached the host: ${JSON.stringify(posted)}`);

        // Taken back to the words it started with, and clicked out of. Nothing is written, and the three go back to the host's own answer.
        block.childNodes[0].nodeValue = baseline;
        block.textContent = baseline;
        withPageTimers((drain) => {
          fire('focusout', { relatedTarget: null });
          booted.document.activeElement = null;
          raiseWindowEvent('focusout', { relatedTarget: null });
          drain();
        });
        if (posted.length) throw new Error(`${format}: typing taken back still wrote ${JSON.stringify(posted)}`);
        if (booted.isDocumentDirty('notes.md')) {
          throw new Error(`${format}: the file was untouched and the dot stayed lit`);
        }
        if (vm.runInContext("undoableByPath.get('notes.md')", booted) === true) {
          throw new Error(`${format}: Undo was left offered with nothing to undo`);
        }
      }

      // A document that was already dirty keeps its dot when a typing session on top of it writes nothing: what is put back is the host's answer, not "clean".
      posted.length = 0;
      openTyping('# Title\n\nA paragraph.\n');
      booted.window.leafBlocksResynced({ source: '# Title\n\nA paragraph.\n', dirty: true, canUndo: true });
      const block = typedBlock({ start: 9, end: 21, typed: 'A paragraph.', baseline: 'A paragraph.' });
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      for (const handler of [...(block.listeners.get('input') || [])]) handler({});
      withPageTimers((drain) => {
        booted.document.activeElement = null;
        raiseWindowEvent('focusout', { relatedTarget: null });
        drain();
      });
      if (!booted.isDocumentDirty('notes.md')) {
        throw new Error('an edit made before the typing was reported as saved');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Typing reaches the document at every pause, so an edit arriving from anywhere else mid-typing does not redraw the page over words nothing holds. Nothing redraws at a pause either, which leaves the page's own map of where every block's bytes are as the only thing keeping the next splice honest — and a map that lags writes the wrong bytes, so the shift is held here rather than left to be found.
  check('a pause in the typing writes into the document, and moves the map with it', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n\nAfter it.\n';
      openTyping(source);
      const block = typedBlock({ start: 9, end: 10, typed: 'A paragraph.', baseline: 'A' });
      // The block after it, whose stamped range describes the buffer before the splice.
      const after = typedBlock({ start: 12, end: 21, typed: 'After it.', baseline: 'After it.' });
      const app = vm.runInContext('app', booted);
      const wasQuery = app.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [block, after] : []),
      });
      app.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));

      booted.sendLiveBlockEdit(block);
      const live = posted.filter((message) => message.command === 'editBlock');
      if (live.length !== 1) throw new Error(`the pause sent ${live.length} edits`);
      if (live[0].live !== true) throw new Error('the pause asked for a re-render under the caret');
      if (live[0].continuing) throw new Error('the first splice of a run recorded no undo point');
      const written = source.slice(0, live[0].start) + live[0].text + source.slice(live[0].end);
      if (written !== '# Title\n\nA paragraph.\n\nAfter it.\n') {
        throw new Error(`the document became ${JSON.stringify(written)}`);
      }

      // The map moved with it: the typed block grew, the block after it shifted by the same, and the source the page slices from is the spliced one.
      if (block.dataset.srcEnd !== '21') throw new Error(`the typed block ends at ${block.dataset.srcEnd}`);
      if (after.dataset.srcStart !== '23' || after.dataset.srcEnd !== '32') {
        throw new Error(`the block after it is at [${after.dataset.srcStart},${after.dataset.srcEnd})`);
      }
      if (vm.runInContext('currentDocumentSource', booted) !== written) {
        throw new Error('the page kept slicing the document it had before the pause');
      }
      // And what the shifted range names in the shifted source is still that block.
      if (written.slice(Number(after.dataset.srcStart), Number(after.dataset.srcEnd)) !== 'After it.') {
        throw new Error('the shifted range no longer covers the block it belongs to');
      }

      // A second pause continues the run, so the whole run is one undo step — and it splices over what the first pause wrote, not over what it replaced.
      posted.length = 0;
      block.childNodes[0].nodeValue = 'A paragraph, longer.';
      block.textContent = 'A paragraph, longer.';
      booted.sendLiveBlockEdit(block);
      const second = posted.filter((message) => message.command === 'editBlock');
      if (second.length !== 1 || second[0].continuing !== true) {
        throw new Error('a later pause in the same run started a second undo step');
      }
      if (second[0].start !== 9 || second[0].end !== 21) {
        throw new Error(`the second pause spliced [${second[0].start},${second[0].end})`);
      }
      if (written.slice(0, 9) + second[0].text + written.slice(21) !== '# Title\n\nA paragraph, longer.\n\nAfter it.\n') {
        throw new Error('the second pause wrote over the wrong bytes');
      }

      // Nothing new since the last pause is nothing to send.
      posted.length = 0;
      booted.sendLiveBlockEdit(block);
      if (posted.length) throw new Error('a pause with nothing typed in it still wrote to the document');

      // A note's table waits for the click-out: its commit writes one cell rather than a range, so nothing here can say how long the buffer's table became.
      posted.length = 0;
      const table = typedBlock({ kind: 'table', tag: 'TABLE', start: 9, end: 21, typed: 'x', baseline: 'y' });
      booted.sendLiveBlockEdit(table);
      if (posted.length) throw new Error('a table wrote a range splice it cannot measure');
    } finally {
      booted.ipc = wasIpc;
      restTyping();
    }
  });

  // The other reader that holds a range over time rather than reading one: a drag names its blocks as byte ranges, and the move splices exactly those. The grab and the drop are seconds apart, and the gutter holds the focus in between, so a pause in the typing lands right there — a run kept from the grab would carry the blocks around a document whose bytes had moved under it.
  check('a block dropped after a pause in the typing moves the bytes the pause left behind', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n\nAfter it.\n';
      openTyping(source);
      const typing = typedBlock({ start: 9, end: 10, typed: 'A paragraph.', baseline: 'A' });
      const after = typedBlock({ start: 12, end: 21, typed: 'After it.', baseline: 'After it.' });
      const app = vm.runInContext('app', booted);
      const wasQuery = app.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [typing, after] : []),
      });
      app.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));
      // Grabbed while the words were still only on screen, so the run it was grabbed on is the one the buffer no longer has.
      booted.__dragRun = [typing, after];
      vm.runInContext(
        'blockDrag = { target: __dragRun[0], elements: __dragRun, others: [__dragRun[1]], from: 0, to: 1, moved: true };',
        booted,
      );
      // The pause, mid-drag: the typed block grows by eleven bytes and the one under it moves by the same.
      booted.sendLiveBlockEdit(typing);
      posted.length = 0;
      // Nothing has the caret at the drop, so the move is the only thing sent.
      booted.document.activeElement = null;
      booted.endBlockDrag(true);
      const moves = posted.filter((message) => message.command === 'moveBlock');
      if (moves.length !== 1) throw new Error(`the drop sent ${moves.length} moves`);
      if (JSON.stringify(moves[0].ranges) !== JSON.stringify([[9, 21], [23, 32]])) {
        throw new Error(`the drop moved ${JSON.stringify(moves[0].ranges)}, which is where the blocks were before the pause`);
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The block after the typed one is what the shift is for, and the raw-source editor is the reader most easily caught by a stale one: the bytes it opens are worked out on the press, since anything worked out when it was wired is from before any pause could move them.
  check('a raw-source block opens the bytes it is stamped with now, not when it was wired', () => {
    const source = '# Title\n\nA\n\n```\ncode\n```\n';
    openTyping(source);
    const fence = typedBlock({ kind: 'code_block', tag: 'PRE', start: 12, end: 23, typed: '', baseline: '' });
    booted.wireSourceEditable(fence);
    // A pause in the block above wrote eleven more bytes, and the shift moved this block's stamp with them.
    const grown = '# Title\n\nA paragraph.\n\n```\ncode\n```\n';
    vm.runInContext(`currentDocumentSource = ${JSON.stringify(grown)};`, booted);
    fence.dataset.srcStart = String(grown.indexOf('```'));
    fence.dataset.srcEnd = String(grown.length - 1);
    try {
      fence.__startSourceEdit();
      if (fence.textContent !== 'code') {
        throw new Error(`the block opened ${JSON.stringify(fence.textContent)} rather than the code it is showing`);
      }
    } finally {
      restTyping();
    }
  });

  // A field box swallows every key so the page's own shortcuts cannot fire under a caret in a text field — which meant mid-field Ctrl+S reached nothing at all, and a field typed and saved wrote the file without it. The save is the one key let out, and the write it triggers has to have raised the dot by the time the save reads it.
  check('a field box lets the save key out, and a field write raises the dot itself', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('---\ntags: one\n---\n');
      const box = booted.frontmatterInput({ value: 'one', label: 'tags', commit: () => true });
      const keydown = (box.listeners.get('keydown') || [])[0];
      if (!keydown) throw new Error('the field box wired no keys at all');
      const press = (key, ctrl) => {
        let stopped = false;
        keydown({
          key,
          ctrlKey: !!ctrl,
          metaKey: false,
          altKey: false,
          preventDefault() {},
          stopPropagation() {
            stopped = true;
          },
        });
        return stopped;
      };
      if (press('s', true)) throw new Error('the save key was swallowed inside a field box');
      if (press('S', true)) throw new Error('the save key held down with shift was swallowed');
      // Every other key is still the box's own, or the page's shortcuts fire under a caret in a text field.
      for (const key of ['s', 'a', 'Enter', 'Escape', 'z']) {
        if (!press(key, key === 'z')) throw new Error(`${key} escaped the field box`);
      }

      // And the write itself: the dot and the undo are up the moment it is sent, so the save reading them a tick later finds something to write.
      posted.length = 0;
      booted.sendFieldEdit('tags', 'two');
      if (!posted.some((message) => message.command === 'setField')) {
        throw new Error('the field never reached the host');
      }
      if (!booted.isDocumentDirty('notes.md')) throw new Error('a field write left the document reading as saved');
      if (vm.runInContext("undoableByPath.get('notes.md')", booted) !== true) {
        throw new Error('a field write left nothing to undo');
      }
    } finally {
      booted.ipc = wasIpc;
      restTyping();
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

  // Ctrl+Z inside a block is the page's press, never the web view's: the web view's own step is one letter, so a paragraph took hundreds of presses to clear. What still keeps its own undo is everything else editable — the source view and the app's own field boxes.
  check('Ctrl+Z inside a block is the page’s, and every other editable surface keeps its own', () => {
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
      // Mid-typing and untouched alike: the block's own groups answer the key, and the web view never sees it.
      if (nativeUndoOwnsKey(block({ editing: true, baseline: 'something else' }))) {
        throw new Error('a block mid-typing handed the key back to the web view, one letter a press');
      }
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
      // A field box sits inside no editable block, so the walk finds none and it keeps the browser's own.
      const field = Object.assign(new FakeElement(), {
        nodeType: 1,
        tagName: 'INPUT',
        closest: (selector) => (String(selector).includes('data-src-start') ? null : field),
      });
      if (!nativeUndoOwnsKey(field)) throw new Error('a field box lost its own undo');
      // Nothing editable under the key at all: the app's undo, as before.
      if (nativeUndoOwnsKey(Object.assign(new FakeElement(), { nodeType: 1, closest: () => null }))) {
        throw new Error('a press outside every field was treated as typing');
      }
    } finally {
      inApp.contains = wasContains;
      vm.runInContext('codeViewActive = false;', booted);
    }
  });

  // The whole of what was asked for: a paragraph of forty words was two hundred presses to clear, because the web view's undo steps one letter. A press takes back a word now — a group that ends at a word boundary, at a caret moved elsewhere, and (phase 2) at a pause.
  check('a press takes back a word of the typing, not a letter', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n';
      openTyping(source);
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      const fire = (type, event) => {
        for (const handler of [...(block.listeners.get(type) || [])]) handler(event);
      };
      // The session opens on the click in: the block as it stands is the bottom of the list.
      block.__editingActive = false;
      fire('focusin', {});

      typeInto(block, ' one two');
      if (block.textContent !== 'A one two') throw new Error(`the block holds ${JSON.stringify(block.textContent)}`);

      // Three presses for three groups — the last word, the one before it, and the space that opened the typing. Nine keystrokes went in.
      const words = [];
      for (let press = 0; press < 3; press += 1) {
        if (!pressUndoKey(block)) throw new Error(`press ${press + 1} was handed to the web view`);
        words.push(block.textContent);
      }
      if (JSON.stringify(words) !== JSON.stringify(['A one ', 'A ', 'A'])) {
        throw new Error(`the presses walked back through ${JSON.stringify(words)}`);
      }

      // And each press put its words into the document rather than only on the page, continuing the run so the app's own stack still holds the session as one step.
      const written = posted.filter((message) => message.command === 'editBlock');
      if (!written.length) throw new Error('a press took the words off the page and left them in the document');
      // The trailing space is the serializer's to drop, exactly as it does for the pause that writes mid-typing.
      if (written[0].text !== 'A one') throw new Error(`the first press wrote ${JSON.stringify(written[0].text)}`);
      if (written.some((message) => message.live !== true)) {
        throw new Error('a press asked for a re-render under the caret');
      }
      if (written.slice(1).some((message) => message.continuing !== true)) {
        throw new Error('a press started a second undo step in the app’s own stack');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The hand-over: a block's groups are the page's, and once they are spent the same key goes on meaning what it has always meant — one committed edit back. Swallowing it there would leave the reader pressing a key that does nothing.
  check('the last group spent hands Ctrl+Z to the app’s own undo', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA\n');
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      typeInto(block, ' one two');
      // Three groups: the space that opened the typing, and a word each.
      pressUndoKey(block);
      pressUndoKey(block);
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`the presses left ${JSON.stringify(block.textContent)}`);
      posted.length = 0;
      withPageTimers((drain) => {
        pressUndoKey(block);
        drain();
      });
      if (!posted.some((message) => message.command === 'undoEdit')) {
        throw new Error('the press after the last group was swallowed instead of reaching the app’s undo');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Word boundaries end most groups, and a long word typed slowly has none — so without this half a reader who stops to think mid-word gets the whole stop back in one press, or nothing until the next space.
  check('a pause in the typing ends the group too', () => {
    const wasIpc = booted.ipc;
    const wasNow = booted.typingStepNow;
    booted.ipc = { postMessage: () => {} };
    try {
      let clock = 1000;
      booted.typingStepNow = () => clock;
      const typeWithPause = () => {
        openTyping('# Title\n\nA\n');
        const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
        return block;
      };

      // One word, typed straight through: one press takes the whole of it back.
      let block = typeWithPause();
      typeInto(block, 'bcde');
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`typed straight through, a press left ${JSON.stringify(block.textContent)}`);

      // The same word with a stop in the middle of it: two presses, one for each side of the stop.
      block = typeWithPause();
      typeInto(block, 'bc');
      clock += 2000;
      typeInto(block, 'de');
      pressUndoKey(block);
      if (block.textContent !== 'Abc') throw new Error(`after the stop, a press left ${JSON.stringify(block.textContent)}`);
      pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`the second press left ${JSON.stringify(block.textContent)}`);
    } finally {
      booted.ipc = wasIpc;
      booted.typingStepNow = wasNow;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // Taking the key off the web view took its redo with it, and the app has none to fall back on — so without this a press too many is words nobody can get back, which is worse than the letter-at-a-time undo it replaced.
  check('a press too many walks forward again, until something new is typed', () => {
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: () => {} };
    try {
      const open = () => {
        openTyping('# Title\n\nA\n');
        const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
        booted.wireMarkdownEditable(block);
        booted.document.activeElement = block;
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
        return block;
      };
      const pressRedo = (target, how) => pressUndoKey(target, how);

      // Three back and two forward is one press from where the typing stood.
      let block = open();
      typeInto(block, ' one two');
      for (let press = 0; press < 3; press += 1) pressUndoKey(block);
      if (block.textContent !== 'A') throw new Error(`three presses left ${JSON.stringify(block.textContent)}`);
      // Both spellings of the key, so neither is left doing nothing.
      if (!pressRedo(block, { key: 'y' })) throw new Error('Ctrl+Y was handed to the web view');
      if (!pressRedo(block, { shift: true })) throw new Error('Ctrl+Shift+Z was handed to the web view');
      if (block.textContent !== 'A one ') throw new Error(`two forward left ${JSON.stringify(block.textContent)}`);
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one two') throw new Error('the newest words never came back');
      // Nothing ahead of the newest words: the key is quiet rather than walking off the end.
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one two') throw new Error('a press walked past the words that were typed');

      // Typing after a press drops what was ahead of it, the way every editor does.
      block = open();
      typeInto(block, ' one two');
      pressUndoKey(block);
      typeInto(block, ' three');
      pressRedo(block, { key: 'y' });
      if (block.textContent !== 'A one  three') {
        throw new Error(`the words a press had walked back from came back after typing: ${JSON.stringify(block.textContent)}`);
      }
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // The other half of the hand-over: with a block's own forward steps spent, both spellings of the key mean one committed edit forward. Swallowed there, a press too many is words nobody can get back.
  check('the last group spent hands Ctrl+Y and Ctrl+Shift+Z to the app’s own redo', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    const openBlock = () => {
      openTyping('# Title\n\nA\n');
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      return block;
    };
    try {
      for (const how of [{ key: 'y' }, { shift: true }]) {
        const block = openBlock();
        // Nothing typed in it, so the block has no step of its own to walk to — and the host says a version is waiting.
        vm.runInContext("redoableByPath.set('notes.md', true);", booted);
        posted.length = 0;
        withPageTimers((drain) => {
          if (!pressUndoKey(block, how)) throw new Error(`${JSON.stringify(how)} was handed to the web view`);
          drain();
        });
        if (!posted.some((message) => message.command === 'redoEdit')) {
          throw new Error(`${JSON.stringify(how)} was swallowed instead of reaching the app’s redo`);
        }
      }

      // With a group still ahead of it the key stays the block's: the words come forward and the document's own history is left where it is.
      const block = openBlock();
      typeInto(block, ' one');
      pressUndoKey(block);
      const walkedBack = block.textContent;
      vm.runInContext("redoableByPath.set('notes.md', true);", booted);
      posted.length = 0;
      withPageTimers((drain) => {
        pressUndoKey(block, { key: 'y' });
        drain();
      });
      if (posted.some((message) => message.command === 'redoEdit')) {
        throw new Error('a block with a step ahead of it stepped the document instead of walking its own words forward');
      }
      if (block.textContent === walkedBack) throw new Error('the words never came forward');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // A resync that moves Redo alone moves neither the dirty flag nor Undo, which is the case a bar refreshed only on dirty would miss.
  check('the Redo button follows what the host says the history holds', () => {
    try {
      openTyping('# Title\n\nA paragraph.\n');
      booted.window.leafBlocksResynced({ dirty: true, canUndo: true, canRedo: true });
      if (vm.runInContext('redoButton.hidden', booted) !== false) {
        throw new Error('an undone edit left the Redo button hidden');
      }
      booted.window.leafBlocksResynced({ dirty: true, canUndo: true, canRedo: false });
      if (vm.runInContext('redoButton.hidden', booted) !== true) {
        throw new Error('Redo was left offered with nothing to bring back');
      }
    } finally {
      restTyping();
    }
  });

  // The groups live on the block, so two blocks typed in are two lists — and a press answers the one the caret is in. A single list would take a word off a paragraph somebody stopped typing in ten minutes ago.
  check('a press takes back the block it was pressed in, and leaves the other alone', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      openTyping('# Title\n\nA\n\nB\n');
      const first = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      const second = wordsFollowMarkup(typedBlock({ start: 12, end: 13, typed: 'B', baseline: 'B' }));
      for (const block of [first, second]) {
        booted.wireMarkdownEditable(block);
        block.__editingActive = false;
        for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      }
      typeInto(first, ' one');
      typeInto(second, ' two');
      booted.document.activeElement = second;
      if (!pressUndoKey(second)) throw new Error('the press was handed to the web view');
      if (second.textContent !== 'B ') throw new Error(`the pressed block holds ${JSON.stringify(second.textContent)}`);
      if (first.textContent !== 'A one') throw new Error('the press reached into a block nobody was typing in');
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
    }
  });

  // A press that only rewrote the page would leave the buffer holding what the pauses spliced, so a save right after it would write the words the press removed. What a press puts back rides the live splice, which is what makes the save honest.
  check('a save right after a press writes the words the press put back', () => {
    const posted = [];
    const wasIpc = booted.ipc;
    booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    try {
      const source = '# Title\n\nA\n';
      openTyping(source);
      const block = wordsFollowMarkup(typedBlock({ start: 9, end: 10, typed: 'A', baseline: 'A' }));
      booted.wireMarkdownEditable(block);
      booted.document.activeElement = block;
      // The page's own map of where every block's bytes are, so the second splice writes over what the first one left rather than over what it replaced.
      const appElement = vm.runInContext('app', booted);
      const wasQuery = appElement.querySelector;
      const body = Object.assign(fakeElement('document-body'), {
        querySelectorAll: (selector) => (String(selector) === '[data-src-start]' ? [block] : []),
      });
      appElement.querySelector = (selector) => (String(selector) === '.document-body' ? body : wasQuery(selector));
      block.__editingActive = false;
      for (const handler of [...(block.listeners.get('focusin') || [])]) handler({});
      typeInto(block, ' one two');
      // The pause the typing left behind, so the buffer really holds the words the press is about to take off.
      booted.sendLiveBlockEdit(block);
      pressUndoKey(block);
      posted.length = 0;
      withPageTimers((drain) => {
        booted.saveActiveDocument();
        drain();
      });
      const written = posted.filter((message) => message.command === 'editBlock');
      if (written.length && written[written.length - 1].text !== 'A one') {
        throw new Error(`the save wrote ${JSON.stringify(written[written.length - 1].text)}`);
      }
      if (vm.runInContext('currentDocumentSource', booted) !== '# Title\n\nA one\n') {
        throw new Error(`the document became ${JSON.stringify(vm.runInContext('currentDocumentSource', booted))}`);
      }
      if (!posted.some((message) => message.command === 'saveDocument')) {
        throw new Error('the save never reached the host');
      }
      appElement.querySelector = wasQuery;
    } finally {
      booted.ipc = wasIpc;
      booted.document.activeElement = null;
      restTyping();
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
    // A drawn document, because the bind walks away from a page holding none — and then the answer read back is whatever was in the value before it was asked.
    const drawn = booted.document.createElement('div');
    drawn.className = 'document-body';
    booted.document.getElementById('app').appendChild(drawn);
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

  // The message's gate, asked of an element: the words of an XML document are typed on where they are drawn, and the one thing that may never happen is a tag being rewritten by somebody fixing a word. So a block opens only where what is drawn is exactly the bytes between its own tags, and what it commits lands between those tags and nowhere near them.
  check('an XML element opens for typing only where the drawn words are its own bytes', () => {
    const { xmlBlockTypeableInPlace, blockDomToSource, commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source =
      '<TEI>\n<p>The translation starts here.</p>\n<p>A <hi>word</hi> here.</p>\n' +
      '<p>Tea &amp; toast.</p>\n<p>Tea &#38; toast.</p>\n<head>Split\n  over lines.</head>\n' +
      '<lb/>\n<!-- a note -->\n<p>café 😀</p>\n</TEI>\n';
    // The buffer counts bytes, so every range is measured the way the host measures it.
    const bytesTo = (index) => Buffer.byteLength(source.slice(0, index), 'utf8');
    const block = (fragment, drawn) => {
      const at = source.indexOf(fragment);
      if (at < 0) throw new Error(`the fixture has no ${fragment}`);
      return {
        isConnected: true,
        tagName: 'P',
        dataset: {
          blockKind: 'paragraph',
          srcStart: String(bytesTo(at)),
          srcEnd: String(bytesTo(at + fragment.length)),
        },
        childNodes: [],
        textContent: drawn,
        previousElementSibling: null,
        nextElementSibling: null,
      };
    };
    const keeps = (fragment, drawn, why) => {
      if (xmlBlockTypeableInPlace(block(fragment, drawn))) throw new Error(why);
    };
    const posted = [];
    const wasIpc = booted.ipc;
    const wasFormat = read('currentDocumentFormat');
    const wasSource = read('currentDocumentSource');
    try {
      read("currentDocumentFormat = 'xml';");
      booted.window.leafBlocksResynced({ source });
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      // A paragraph of plain text: the span is the words alone, with the tags outside it on both sides.
      const plain = block('<p>The translation starts here.</p>', 'The translation starts here.');
      const span = xmlBlockTypeableInPlace(plain);
      if (!span) throw new Error('a paragraph drawn as the file spells it did not open for typing');
      if (source.slice(span.start, span.end) !== 'The translation starts here.') {
        throw new Error(`the span opened was ${JSON.stringify(source.slice(span.start, span.end))}`);
      }

      // What the page writes for it: the words as a tree holds them, never Markdown.
      const written = blockDomToSource({ ...plain, textContent: 'A word & another <one>.' });
      if (written !== 'A word &amp; another &lt;one>.') {
        throw new Error(`the tree serializer wrote ${JSON.stringify(written)}`);
      }

      // And the commit: only the span between the tags, so both tags survive it.
      plain.__innerSpan = span;
      posted.length = 0;
      commitBlockEdit(plain, 'The translation starts there.');
      const edits = posted.filter((message) => message.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`typing on an element sent ${edits.length} edits`);
      if (edits[0].start !== span.start || edits[0].end !== span.end) {
        throw new Error(`the commit widened the span to [${edits[0].start},${edits[0].end})`);
      }
      const after = source.slice(0, edits[0].start) + edits[0].text + source.slice(edits[0].end);
      if (!after.includes('<p>The translation starts there.</p>')) {
        throw new Error(`the tags did not survive the commit: ${JSON.stringify(after.slice(0, 60))}`);
      }

      // An entity the file spells as a tree does round-trips, so it opens; one spelled another way does not, and keeps the editor it has.
      if (!xmlBlockTypeableInPlace(block('<p>Tea &amp; toast.</p>', 'Tea & toast.'))) {
        throw new Error('an escaped ampersand that round-trips did not open for typing');
      }
      keeps('<p>Tea &#38; toast.</p>', 'Tea & toast.', 'an entity the file spells another way opened for typing');

      // Everything the renderer changed on the way to the page keeps the raw editor.
      keeps('<p>A <hi>word</hi> here.</p>', 'A word here.', 'inline markup the renderer flattened opened for typing');
      keeps('<head>Split\n  over lines.</head>', 'Split over lines.', 'text the renderer collapsed opened for typing');
      keeps('<!-- a note -->', ' a note ', 'a comment opened for typing');
      keeps('<lb/>', '', 'an element with no inside opened for typing');

      // The span is in bytes, not characters: a paragraph after multi-byte text still cuts where its words are.
      const wide = xmlBlockTypeableInPlace(block('<p>café 😀</p>', 'café 😀'));
      if (!wide) throw new Error('a paragraph of multi-byte text did not open for typing');
      const bytes = Buffer.from(source, 'utf8');
      if (bytes.subarray(wide.start, wide.end).toString('utf8') !== 'café 😀') {
        throw new Error('the span was cut on characters rather than on bytes');
      }

      // A block with no usable range is nobody's to type on.
      if (xmlBlockTypeableInPlace({ dataset: {}, textContent: '' })) {
        throw new Error('a block with no range opened for typing');
      }
    } finally {
      booted.ipc = wasIpc;
      booted.window.leafBlocksResynced({ source: wasSource });
      read(`currentDocumentFormat = ${JSON.stringify(wasFormat)};`);
    }
  });

  // The same gate asked of one cell of a table, and the whole point of asking it: a reader correcting one date must not have every other row of the file move under them. So the splice a cell commits is its own element's words and the rest of the file comes back byte for byte.
  check('a cell of an XML table writes its own bytes and leaves every other row alone', () => {
    const { xmlCellTypeableInPlace, commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source =
      '<urlset>\n<url><loc>https://leaftext.com/</loc><lastmod>2026-07-24</lastmod></url>\n' +
      '<url><loc>https://leaftext.com/docs/</loc><lastmod>2026-07-11</lastmod></url>\n</urlset>\n';
    const cellFor = (element, drawn) => {
      const at = source.indexOf(element);
      if (at < 0) throw new Error(`the fixture has no ${element}`);
      const cell = fakeElement('cell');
      cell.tagName = 'TD';
      cell.dataset = { cellStart: String(at), cellEnd: String(at + element.length) };
      cell.textContent = drawn;
      return cell;
    };
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const wasIpc = booted.ipc;
    const posted = [];
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      const date = cellFor('<lastmod>2026-07-24</lastmod>', '2026-07-24');
      const span = xmlCellTypeableInPlace(date);
      if (!span) throw new Error('a cell drawn from one element could not be typed on');
      if (source.slice(span.start, span.end) !== '2026-07-24') {
        throw new Error('the span a cell commits through is not its own words');
      }
      // Two elements drawn as one string with a separator the file has not got: no splice can name it, so no caret goes in it.
      if (xmlCellTypeableInPlace(cellFor('<lastmod>2026-07-24</lastmod>', '2026-07-24, 2026-07-11'))) {
        throw new Error('a cell holding two elements opened for typing');
      }
      // A cell with no range at all — one the record was short of — is nobody's to type on either.
      if (xmlCellTypeableInPlace({ dataset: {}, textContent: '' })) {
        throw new Error('a cell with no range opened for typing');
      }

      date.__innerSpan = span;
      date.__editBaseline = '2026-07-24';
      commitBlockEdit(date, '2026-08-01');
      const edit = posted.find((message) => message.command === 'editBlock');
      if (!edit) throw new Error('typing in a cell wrote nothing');
      const after = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
      if (!after.includes('<lastmod>2026-08-01</lastmod>')) throw new Error('the cell was not written');
      if (after.replace('2026-08-01', '2026-07-24') !== source) {
        throw new Error('writing one cell moved something else in the file');
      }
    } finally {
      booted.ipc = wasIpc;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A table is the one block whose shape is the reading, so nothing a reader presses may take the grid away and leave the markup of every record in its place. The parts of it that can be typed on answer for themselves; every other press says where the file's own text is instead.
  check('an XML table keeps its shape when a press lands where nothing can be typed', () => {
    const { bindEditableBlocks } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const run =
      '<url><loc>https://leaftext.com/</loc><tag>one</tag></url>\n' +
      '<url><loc>https://leaftext.com/docs/</loc><tag>two</tag><tag>three</tag></url>';
    const source = `<urlset>\n${run}\n</urlset>\n`;
    const cell = (id, element, drawn) => {
      const at = source.indexOf(element);
      const el = fakeElement(id);
      el.tagName = 'TD';
      el.dataset = { cellStart: String(at), cellEnd: String(at + element.length) };
      el.textContent = drawn;
      return el;
    };
    const table = fakeElement('table');
    table.dataset = {
      blockKind: 'table',
      srcStart: String(source.indexOf(run)),
      srcEnd: String(source.indexOf(run) + run.length),
    };
    const proved = cell('proved', '<loc>https://leaftext.com/</loc>', 'https://leaftext.com/');
    const folded = cell('folded', '<tag>two</tag>', 'two, three');
    const body = { querySelectorAll: () => [table, proved, folded] };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const wasToast = booted.leafToast;
    const said = [];
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      booted.leafToast = (words) => said.push(words);
      bindEditableBlocks('xml');

      if (!proved.listeners.has('pointerup')) throw new Error('a cell of its own element was not opened for typing');
      if (!proved.__innerSpan) throw new Error('the cell carries no span for its commit to splice');
      if (!proved.classList.contains('leaf-editable')) throw new Error('a proved cell was left out of the editable pass');
      if (folded.listeners.has('pointerup') || folded.__innerSpan || folded.classList.contains('leaf-editable')) {
        throw new Error('a cell holding two elements was wired for typing anyway');
      }
      // The names a block is found by stay a block's, or the gutter would offer a cell a drag handle and a plus.
      if (proved.dataset.srcStart != null || proved.dataset.srcEnd != null) {
        throw new Error('a cell answers to the names a block is found by');
      }

      // Nothing may swap the grid for its own markup, so the table is never handed the raw-source editor.
      if (typeof table.__startSourceEdit === 'function' || table.classList.contains('leaf-editable')) {
        throw new Error('a table was wired to open as its own text');
      }
      // And nothing may answer a press with a message either: a strip growling at somebody who pressed a heading is a locked door with a sign on it, not a page. Opening those is xml-table-heading-and-joined-cells.
      if (table.listeners.size) {
        throw new Error(`a table answers a press with ${[...table.listeners.keys()].join(', ')}`);
      }
      if (said.length) throw new Error(`the page said ${JSON.stringify(said)} while drawing a table`);
    } finally {
      booted.leafToast = wasToast;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // The gutter's drag handle reorders a block and its plus inserts beside one; a cell is neither. That is the whole reason a cell carries names of its own rather than a block's, and the way it stays true is that the gutter never learns the cell's.
  check('the gutter still finds only blocks, so no cell is offered a handle or a plus', () => {
    const gutter = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if (/data-cell-|cellStart|cellEnd/.test(gutter)) {
      throw new Error('the block gutter reaches for a table cell');
    }
    const lookups = (gutter.match(/closest\('\[data-src-start\]/g) || []).length;
    if (lookups < 2) throw new Error(`the gutter no longer finds a block by its own name (${lookups})`);
  });

  // The gate decides, but the wiring is what a reader meets: on one tree page the words that can be typed on have to come out as one kind of block and the markup that cannot as the other, side by side. And the keys that make structure are taken away there — an element is one block, so Enter would have to write its own tags.
  check('an XML page wires the words it can type on apart from the markup it cannot', () => {
    const { bindEditableBlocks, handleWysiwygKeydown } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '<div><p>A line.</p><p>A <hi>word</hi> here.</p></div>';
    const at = (fragment) => {
      const start = source.indexOf(fragment);
      return {
        blockKind: 'paragraph',
        srcStart: String(start),
        srcEnd: String(start + fragment.length),
      };
    };
    const plain = fakeElement('plain');
    plain.dataset = at('<p>A line.</p>');
    plain.textContent = 'A line.';
    const mixed = fakeElement('mixed');
    mixed.dataset = at('<p>A <hi>word</hi> here.</p>');
    mixed.textContent = 'A word here.';
    const body = { querySelectorAll: () => [plain, mixed] };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const posted = [];
    const wasIpc = booted.ipc;
    const wasCaret = booted.caretTextOffsetIn;
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      bindEditableBlocks('xml');
      if (!plain.listeners.has('pointerup')) throw new Error('a paragraph of plain words was not opened for typing');
      if (!plain.__innerSpan) throw new Error('the paragraph carries no span for its commit to splice');
      if (source.slice(plain.__innerSpan.start, plain.__innerSpan.end) !== 'A line.') {
        throw new Error('the span wired onto the paragraph is not its own words');
      }
      if (!mixed.listeners.has('pointerdown') || mixed.listeners.has('pointerup')) {
        throw new Error('a paragraph holding markup lost the raw editor it has today');
      }
      if (mixed.__innerSpan) throw new Error('a block that cannot be typed on carries a span anyway');
      if (!plain.classList.contains('leaf-editable') || !mixed.classList.contains('leaf-editable')) {
        throw new Error('a block was left out of the editable pass');
      }

      // Enter is the page's own from here rather than the browser's, so the new line can be an element; a letter is left alone. With no caret in the block neither writes anything.
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.caretTextOffsetIn = () => null;
      const press = (key, shift) => {
        let stopped = false;
        handleWysiwygKeydown(plain, {
          key,
          shiftKey: !!shift,
          preventDefault: () => {
            stopped = true;
          },
        });
        return stopped;
      };
      if (!press('Enter')) throw new Error('Enter was left to the browser to answer');
      if (!press('Enter', true)) throw new Error('Enter with shift was left to the browser to answer');
      if (press('a')) throw new Error('typing a letter was refused');
      if (posted.length) throw new Error(`a key with no caret in the block wrote ${JSON.stringify(posted)}`);
    } finally {
      booted.ipc = wasIpc;
      booted.caretTextOffsetIn = wasCaret;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A JSON or YAML file naming its own title draws it as the big heading and leaves the pair out of the body, so the heading is the only place that value appears on the page. The wiring above runs for XML alone, so nothing here proved a data block ever reaches the in-place source editor — which is how the one value a reader most wants to correct stayed the one thing on the page answering a press with nothing.
  check('a data document’s own title heading opens the value’s own bytes where it is drawn', () => {
    const { bindEditableBlocks } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '{"title": "Release notes", "version": "1.0"}';
    const value = '"Release notes"';
    const at = source.indexOf(value);
    const heading = fakeElement('title');
    heading.tagName = 'H1';
    heading.dataset = { blockKind: 'data_heading', srcStart: String(at), srcEnd: String(at + value.length) };
    heading.textContent = 'Release notes';
    const body = { querySelectorAll: () => [heading] };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    try {
      read(`currentDocumentFormat = 'json'; currentDocumentSource = ${JSON.stringify(source)};`);
      inApp.querySelector = (selector) => (selector === '.document-body' ? body : wasQuery(selector));
      bindEditableBlocks('json');

      if (!heading.classList.contains('leaf-editable')) {
        throw new Error('the title heading was left out of the editable pass');
      }
      const press = (heading.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('the title heading answers a press with nothing');

      press({ target: null, preventDefault() {} });
      if (heading.dataset.editingSource !== 'true') throw new Error('pressing the title heading opened no editor');
      // The drawn title is whitespace-collapsed and entity-decoded; what opens is the file's own bytes, quotes and all, exactly as a press on a field opens them.
      if (heading.textContent !== value) {
        throw new Error(`the title heading opened ${JSON.stringify(heading.textContent)}`);
      }

      // And a heading standing in for a title the document has not got names no value, so it is stamped with no range and stays what it is: a name to rename the file by.
      const borrowed = fakeElement('borrowed');
      borrowed.tagName = 'H1';
      borrowed.dataset = { blockKind: 'data_heading' };
      borrowed.textContent = 'Notes';
      inApp.querySelector = (selector) =>
        selector === '.document-body' ? { querySelectorAll: () => [borrowed] } : wasQuery(selector);
      bindEditableBlocks('json');
      if (borrowed.listeners.size || borrowed.classList.contains('leaf-editable')) {
        throw new Error('a heading borrowed from the file name was wired to type over bytes it does not name');
      }
    } finally {
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Enter was refused in a tree document at first, and a refused Enter reads as a bug rather than as a rule. A newline written inside the element would draw as a space the moment the page redrew, so the new line is another element of the same name — the words on both sides of the caret survive it, the tags on both halves are the element's own, and the caret lands in the second.
  check('Enter in an element of a tree document carries on in another of the same element', () => {
    const { handleWysiwygKeydown } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const element = '<p rend="lead">One line here.</p>';
    const source = `<div>\n${element}\n</div>`;
    const start = source.indexOf(element);
    const posted = [];
    const asked = [];
    const wasIpc = booted.ipc;
    const wasCaret = booted.caretTextOffsetIn;
    const wasInsert = booted.openInsertBlockAfter;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const paragraph = fakeElement('paragraph');
    paragraph.dataset = {
      blockKind: 'paragraph',
      srcStart: String(start),
      srcEnd: String(start + element.length),
    };
    paragraph.textContent = 'One line here.';
    paragraph.__innerSpan = { start: start + '<p rend="lead">'.length, end: start + element.length - '</p>'.length };
    paragraph.__editBaseline = 'One line here.';
    const enter = () => {
      posted.length = 0;
      handleWysiwygKeydown(paragraph, { key: 'Enter', shiftKey: false, preventDefault() {} });
      return posted.filter((message) => message.command === 'editBlock');
    };
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      booted.openInsertBlockAfter = (el, spec) => asked.push(spec);

      // In the middle of the words: two elements, each with the attribute the one before it carried, and no word lost between them.
      booted.caretTextOffsetIn = () => 'One line'.length;
      const split = enter();
      if (split.length !== 1) throw new Error(`Enter sent ${split.length} edits`);
      const after = source.slice(0, split[0].start) + split[0].text + source.slice(split[0].end);
      if (after !== '<div>\n<p rend="lead">One line</p>\n<p rend="lead">here.</p>\n</div>') {
        throw new Error(`Enter left the file as ${JSON.stringify(after)}`);
      }
      const landed = vm.runInContext('pendingCaret', booted);
      if (!landed || landed.srcStart !== start + '<p rend="lead">One line</p>\n'.length || landed.textOffset !== 0) {
        throw new Error(`the caret landed at ${JSON.stringify(landed)}`);
      }

      // At the end of the words there is nothing to carry down, so a blank line opens inside another of the same element rather than an empty one being written.
      vm.runInContext('pendingCaret = null;', booted);
      booted.caretTextOffsetIn = () => 'One line here.'.length;
      if (enter().length) throw new Error('an element with nothing in it was written into the file');
      if (asked.length !== 1 || asked[0] !== 'element:p') {
        throw new Error(`the blank line opened as ${JSON.stringify(asked)}`);
      }

      // At the very start it would leave an empty element above the words, so it does nothing at all.
      booted.caretTextOffsetIn = () => 0;
      if (enter().length || asked.length !== 1) throw new Error('Enter at the start of the words wrote something');

      // A heading is not a paragraph: a second one in the same part is never drawn, so splitting it would take the words off the page.
      booted.caretTextOffsetIn = () => 'One line'.length;
      paragraph.dataset.blockKind = 'heading';
      if (enter().length) throw new Error('a heading was split into one the page would not draw');
    } finally {
      booted.ipc = wasIpc;
      booted.caretTextOffsetIn = wasCaret;
      booted.openInsertBlockAfter = wasInsert;
      vm.runInContext('pendingCaret = null;', booted);
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A note left in an XML file is the one block that is only ever prose, and it answered a press with its own angle-bracket marks in code type while every sentence beside it took a caret. It types on its words now: the span is the inside of the marks, narrowed by the ends the fold trims, and nothing is escaped on the way in or out — a comment holds no escapes, so an ampersand typed into one is an ampersand in the file.
  check('a comment types on its own words and its marks survive the commit', () => {
    const { xmlCommentTypeableInPlace, blockDomToSource, commitBlockEdit, bindEditableBlocks } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const comment = '<!-- A note & a mark -->';
    const source = `<div>\n${comment}\n</div>`;
    const start = source.indexOf(comment);
    const fold = fakeElement('fold');
    fold.dataset = { blockKind: 'comment', srcStart: String(start), srcEnd: String(start + comment.length) };
    const words = fakeElement('words');
    words.classList.add('xml-comment-body');
    words.textContent = 'A note & a mark';
    fold.querySelector = (selector) => (selector === '.xml-comment-body' ? words : null);
    const posted = [];
    const wasIpc = booted.ipc;
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      // The span is the words alone: the marks and the spaces the fold trimmed are outside it.
      const span = xmlCommentTypeableInPlace(fold, words.textContent);
      if (!span) throw new Error('a note drawn as the file spells it did not open for typing');
      if (source.slice(span.start, span.end) !== 'A note & a mark') {
        throw new Error(`the span opened was ${JSON.stringify(source.slice(span.start, span.end))}`);
      }

      // Words the fold did not draw are nobody's to splice over.
      if (xmlCommentTypeableInPlace(fold, 'Something else')) {
        throw new Error('a note drawn as something other than its own bytes opened for typing');
      }

      // Nothing escapes on the way out, which is the whole difference from an element.
      if (blockDomToSource(words) !== 'A note & a mark') {
        throw new Error(`a note was written as ${JSON.stringify(blockDomToSource(words))}`);
      }

      // The commit lands between the marks, and both marks are still there afterwards.
      words.__innerSpan = span;
      words.__editBaseline = 'A note & a mark';
      posted.length = 0;
      commitBlockEdit(words, 'A note & two marks');
      const edits = posted.filter((message) => message.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`typing in a note sent ${edits.length} edits`);
      const after = source.slice(0, edits[0].start) + edits[0].text + source.slice(edits[0].end);
      if (after !== '<div>\n<!-- A note & two marks -->\n</div>') {
        throw new Error(`the marks did not survive: ${JSON.stringify(after)}`);
      }

      // And the wiring: the words are what opens, while the fold keeps its own row for opening and shutting.
      inApp.querySelector = (selector) => (selector === '.document-body' ? { querySelectorAll: () => [fold] } : wasQuery(selector));
      bindEditableBlocks('xml');
      if (!words.listeners.has('pointerup')) throw new Error('the note’s words were not opened for typing');
      if (fold.listeners.has('pointerdown')) throw new Error('the fold was wired as an editor over its own row');
    } finally {
      booted.ipc = wasIpc;
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Two dashes in a row end a comment early, and a comment has no escape to hide them behind — so the one thing somebody can type into a note that stops the file opening is refused rather than written, and the words go back to what the file has.
  check('a note refuses two dashes in a row rather than writing a file that will not open', () => {
    const { commitBlockEdit } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const source = '<div>\n<!-- A note -->\n</div>';
    const said = [];
    const posted = [];
    const wasToast = booted.leafToast;
    const wasIpc = booted.ipc;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const words = fakeElement('words');
    words.classList.add('xml-comment-body');
    words.textContent = 'A note';
    words.__editBaseline = 'A note';
    words.__innerSpan = { start: source.indexOf('A note'), end: source.indexOf('A note') + 'A note'.length };
    const edits = () => posted.filter((message) => message.command === 'editBlock');
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      booted.leafToast = (message) => said.push(message);
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };

      words.textContent = 'A -- note';
      commitBlockEdit(words, 'A -- note');
      if (edits().length) throw new Error('a note holding two dashes was written into the file');
      if (said.length !== 1) throw new Error(`the refusal said ${JSON.stringify(said)}`);
      if (words.textContent !== 'A note') throw new Error('the words were left as the file cannot hold them');

      // A dash at the end runs into the closing mark, and is refused the same way.
      words.textContent = 'A note-';
      commitBlockEdit(words, 'A note-');
      if (edits().length) throw new Error('a note ending in a dash was written into the file');

      // The same words without it are written as any other note is.
      words.textContent = 'A better note';
      commitBlockEdit(words, 'A better note');
      if (edits().length !== 1) throw new Error('a note with nothing wrong with it was refused');
    } finally {
      booted.leafToast = wasToast;
      booted.ipc = wasIpc;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
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

  /** An XML page with a blank line open on it: the page set to that document, the line the plus opened, and every command it sends. `place` is what the gutter does with the host; the line is the block, since these specs ask for no wrapper. */
  function xmlBlankLine(source, dialect, specId, insertAt) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      dialect: read('currentDocumentDialect'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'xml'; currentDocumentDialect = ${JSON.stringify(dialect)}; ` +
        `currentDocumentSource = ${JSON.stringify(source)};`,
    );
    let line = null;
    booted.openInsertBlock(insertAt, {
      spec: booted.blankBlockSpec(specId) || booted.PLAIN_LINE_SPEC,
      place: (host) => {
        line = host;
      },
    });
    const raise = (type, event) => {
      for (const handler of line.listeners.get(type) || []) handler(event || {});
    };
    return {
      line,
      sent,
      type: (words) => {
        line.textContent = words;
        raise('input', {});
      },
      enter: () => raise('keydown', { key: 'Enter', preventDefault() {} }),
      away: () => raise('blur', { relatedTarget: null }),
      caret: () => read('pendingCaret'),
      restore: () => {
        booted.ipc.postMessage = was.send;
        read(
          `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
            `currentDocumentDialect = ${JSON.stringify(was.dialect)}; ` +
            `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
        );
      },
    };
  }

  // Neither of the plus's options on an XML page may splice source neither renderer draws, or the click closes the row and changes nothing while the document quietly goes unsaved. The element option opens the same blank line a note's plus opens, and what is typed lands inside the tag.
  check('the element the plus offers on an XML page is a line to type on, and the words land inside the tag', () => {
    const { blockInsertOptions, blockSeparator } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const tei = '<div><head>One</head><p>A line.</p></div>';
    const opened = xmlBlankLine(tei, 'tei', 'element:p', 21);
    try {
      // TEI draws a `<p>` anywhere in a section and refuses a second heading, so beside a heading the clone is the one tag that never appears.
      const offered = blockInsertOptions({ dataset: { srcStart: '5', srcEnd: '21' } });
      const element = offered.find((one) => one.id === 'element');
      if (!element || element.text) {
        throw new Error(`the element option still writes source: ${JSON.stringify(offered)}`);
      }
      if (element.blank !== 'element:p') {
        throw new Error(`the option beside a TEI heading was ${JSON.stringify(element)}`);
      }
      if (blockSeparator() !== '\n') throw new Error('a tree document was given a note’s blank line');

      // The line says what it is for and writes nothing until something is typed on it.
      if (!String(opened.line.dataset.placeholder).includes('<p>')) {
        throw new Error(`the line's wording was ${JSON.stringify(opened.line.dataset.placeholder)}`);
      }
      if (opened.sent.length) throw new Error('opening a line wrote to the document');

      opened.type('The words');
      opened.enter();
      const wrote = opened.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<p>The words</p>') {
        throw new Error(`the first keystroke committed ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== 21 || wrote[0].end !== 21) {
        throw new Error(`the element landed at ${wrote[0].start}..${wrote[0].end}`);
      }
    } finally {
      opened.restore();
    }
  });

  // Everywhere but TEI the offered element is the clone of the block beside the gap, since an element with words in it draws as prose or a labeled row. What is typed is the document's own text, and Enter carries on in another of the same element rather than the plain Markdown line the chain otherwise falls to.
  check('a typed & arrives escaped inside the element, and Enter opens another one line apart', () => {
    const { blockInsertOptions } = booted;
    const config = '<config><name>Widget</name></config>';
    const opened = xmlBlankLine(config, null, 'element:name', 27);
    try {
      const offered = blockInsertOptions({ dataset: { srcStart: '8', srcEnd: '27' } });
      const element = offered.find((one) => one.id === 'element');
      if (!element || element.blank !== 'element:name') {
        throw new Error(`a generic document was offered ${JSON.stringify(offered)}`);
      }

      opened.type('Bells & <whistles>');
      opened.enter();
      const wrote = opened.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<name>Bells &amp; &lt;whistles></name>') {
        throw new Error(`what was typed reached the file as ${JSON.stringify(wrote)}`);
      }
      // Enter chains another of the same element, by name, one newline down from where this one landed.
      const caret = opened.caret();
      if (!caret || !caret.insertBelow || caret.blockSpec !== 'element:name') {
        throw new Error(`Enter chained ${JSON.stringify(caret)}`);
      }
      if (caret.srcStart !== 28) throw new Error(`the next line was aimed at ${caret.srcStart}`);
    } finally {
      opened.restore();
    }
  });

  // The menu is the audit's table: each page is offered the kinds the renderer that drew it draws, and no others. A scholarly page has verse and no tables; the heading it writes is a section with its name in it, since that is the only shape drawn as a heading there.
  check('the plus on a scholarly page offers a heading and a verse line, and both are lines to type on', () => {
    const { blockInsertOptions } = booted;
    const tei = '<div><head>One</head><p>A line.</p></div>';
    const heading = xmlBlankLine(tei, 'tei', 'tei:head', tei.length);
    try {
      const offered = blockInsertOptions({ dataset: { srcStart: '5', srcEnd: '21' } });
      const ids = offered.map((one) => one.id).join(',');
      if (ids !== 'element,heading,verse,comment') {
        throw new Error(`a scholarly page was offered ${ids}`);
      }
      // The tag can only ever be `<p>` there, so the entry says what it makes rather than naming markup.
      if (offered[0].label !== 'Text') throw new Error(`the element entry read ${offered[0].label}`);
      if (heading.sent.length) throw new Error('opening a heading wrote to the document');

      heading.type('New part');
      heading.enter();
      const wrote = heading.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<div><head>New part</head></div>') {
        throw new Error(`Heading committed ${JSON.stringify(wrote)}`);
      }
      // Enter under a heading is the paragraph you write there. A tree document has no plain line to fall to, so an entry that named nothing would write bare words between two elements.
      if (heading.caret().blockSpec !== 'element:p') {
        throw new Error(`Enter under a heading chained ${JSON.stringify(heading.caret())}`);
      }
    } finally {
      heading.restore();
    }

    const verse = xmlBlankLine(tei, 'tei', 'tei:l', tei.length);
    try {
      verse.type('A line of verse');
      verse.enter();
      const wrote = verse.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<l>A line of verse</l>') {
        throw new Error(`Verse committed ${JSON.stringify(wrote)}`);
      }
      // Verse is lines, so Enter carries on in another one and they join into one quote as they are drawn.
      if (verse.caret().blockSpec !== 'tei:l') {
        throw new Error(`Enter after a verse line chained ${JSON.stringify(verse.caret())}`);
      }
    } finally {
      verse.restore();
    }
  });

  // Every other XML has tables and no verse. A row is offered only beside one, and the clone is taken away exactly there: another record with words straight inside it reads as prose to the grouping, and one of those stops the whole run being a table and scatters it into a stack of headed lists.
  check('the plus beside a table offers a row instead of the clone that would break it', () => {
    const { blockInsertOptions } = booted;
    const sitemap =
      '<urlset><url><loc>https://leaftext.com/</loc></url>' +
      '<url><loc>https://leaftext.com/docs/</loc></url></urlset>';
    const at = sitemap.lastIndexOf('</url>') + '</url>'.length;
    const table = {
      dataset: { srcStart: String(sitemap.indexOf('<url>')), srcEnd: String(at), blockKind: 'table' },
    };
    const row = xmlBlankLine(sitemap, null, 'row:url:loc', at);
    try {
      const beside = blockInsertOptions(table)
        .map((one) => one.id)
        .join(',');
      if (beside !== 'heading,row,comment') throw new Error(`the gap under a table was offered ${beside}`);

      // Away from the table the clone is right and there is no row to add, since a row belongs to a table.
      const field = {
        dataset: {
          srcStart: String(sitemap.indexOf('<loc>')),
          srcEnd: String(sitemap.indexOf('</loc>') + '</loc>'.length),
          blockKind: 'paragraph',
        },
      };
      const elsewhere = blockInsertOptions(field)
        .map((one) => one.id)
        .join(',');
      if (elsewhere !== 'element,heading,comment') {
        throw new Error(`a gap away from the table was offered ${elsewhere}`);
      }

      // A table whose columns are all attributes has no child element to type into, so it is offered no row rather than one that cannot be filled in.
      const attributes = '<urlset><url loc="https://leaftext.com/"/><url loc="https://leaftext.com/docs/"/></urlset>';
      vm.runInContext(`currentDocumentSource = ${JSON.stringify(attributes)};`, booted);
      const bare = blockInsertOptions({
        dataset: {
          srcStart: String(attributes.indexOf('<url ')),
          srcEnd: String(attributes.lastIndexOf('/>') + 2),
          blockKind: 'table',
        },
      })
        .map((one) => one.id)
        .join(',');
      if (bare !== 'heading,comment') throw new Error(`a table of attributes was offered ${bare}`);
      vm.runInContext(`currentDocumentSource = ${JSON.stringify(sitemap)};`, booted);

      // The record's tag and its first column come out of the table's own source, so what lands is another of what is already there.
      row.type('typed');
      row.enter();
      const wrote = row.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<url><loc>typed</loc></url>') {
        throw new Error(`Row committed ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== at || wrote[0].end !== at) {
        throw new Error(`the row landed at ${wrote[0].start}..${wrote[0].end}`);
      }
      if (row.caret().blockSpec !== 'row:url:loc') {
        throw new Error(`Enter after a row chained ${JSON.stringify(row.caret())}`);
      }
    } finally {
      row.restore();
    }

    const heading = xmlBlankLine(sitemap, null, 'xml:head', at);
    try {
      heading.type('New part');
      heading.enter();
      const wrote = heading.sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<section><head>New part</head></section>') {
        throw new Error(`Heading committed ${JSON.stringify(wrote)}`);
      }
    } finally {
      heading.restore();
    }
  });

  // The other option: a comment is written into the gap as the file's own bytes, one line down from the block above it — and both renderers now draw one, so the click lands something visible instead of changing the document invisibly.
  check('choosing Comment on an XML page writes one line down from the block above', () => {
    const { blockInsertOptions, runGapInsert } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      dialect: read('currentDocumentDialect'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      read(
        "currentDocumentFormat = 'xml'; currentDocumentDialect = 'tei'; " +
          "currentDocumentSource = '<div><head>One</head><p>A line.</p></div>';",
      );
      const after = { dataset: { srcStart: '5', srcEnd: '21' } };
      const comment = blockInsertOptions(after).find((one) => one.id === 'comment');
      if (!comment) throw new Error('an XML page stopped offering a comment');

      runGapInsert({ after, before: null }, comment);
      const wrote = sent.filter((one) => one.command === 'editBlock');
      if (wrote.length !== 1 || wrote[0].text !== '\n<!-- note -->') {
        throw new Error(`choosing Comment wrote ${JSON.stringify(wrote)}`);
      }
      if (wrote[0].start !== 21 || wrote[0].end !== 21) {
        throw new Error(`the comment landed at ${wrote[0].start}..${wrote[0].end}`);
      }
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentDialect = ${JSON.stringify(was.dialect)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // A drawn comment is a block with its own bytes behind it, and every tree block the page cannot type on as it looks opens as source when it is pressed. So this needs no wiring of its own — it needs proving that the comment is inside the rule.
  check('a drawn comment opens its own source when it is pressed', () => {
    const { wireSourceEditable } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const source = '<div><head>One</head><!-- note --><p>A line.</p></div>';
    try {
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      const comment = fakeElement('div');
      comment.dataset = { srcStart: '21', srcEnd: '34', blockKind: 'comment' };
      wireSourceEditable(comment);
      const press = (comment.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('a drawn comment answers a press with nothing');

      // The row the fold opens by is the one press on a block that already means something: it opens the fold, and the editor stays out of it.
      const row = { closest: (selector) => (selector === 'summary' ? {} : null) };
      press({ target: row, preventDefault() {} });
      if (comment.dataset.editingSource === 'true') {
        throw new Error('pressing the fold’s own row opened the editor instead of the fold');
      }

      press({ target: null, preventDefault() {} });
      if (comment.dataset.editingSource !== 'true') throw new Error('pressing a comment opened no editor');
      if (comment.textContent !== '<!-- note -->') {
        throw new Error(`the comment opened on ${JSON.stringify(comment.textContent)}`);
      }
    } finally {
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // Half a tree document types on its words and half of it opens the file's markup, and nothing on the page says which — the same fault half a message had, and it takes the same answer. A note's code block is not in it: opening its source is what a code block is, so being told would be noise.
  check('a block of a tree document that cannot be typed on says why when it is pressed', () => {
    const { wireSourceEditable } = booted;
    const read = (expression) => vm.runInContext(expression, booted);
    const said = [];
    const wasToast = booted.leafToast;
    const was = { format: read('currentDocumentFormat'), source: read('currentDocumentSource') };
    const source = '<div><p>A <hi>word</hi> here.</p></div>';
    const pressOn = (element) => {
      wireSourceEditable(element);
      const press = (element.listeners.get('pointerdown') || [])[0];
      if (!press) throw new Error('a block answers a press with nothing');
      press({ target: null, preventDefault() {} });
    };
    try {
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentFormat = 'xml'; currentDocumentSource = ${JSON.stringify(source)};`);
      const paragraph = fakeElement('div');
      paragraph.dataset = { srcStart: '5', srcEnd: '33', blockKind: 'paragraph' };
      pressOn(paragraph);
      if (said.length !== 1) throw new Error(`a block that opened markup said ${JSON.stringify(said)}`);
      if (paragraph.dataset.editingSource !== 'true') throw new Error('saying why took the editor away');

      // A note's own source blocks stay quiet.
      read(`currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify('```\ncode\n```\n')};`);
      const fence = fakeElement('div');
      fence.dataset = { srcStart: '0', srcEnd: '12', blockKind: 'code_block' };
      pressOn(fence);
      if (said.length !== 1) throw new Error(`a note's code block was told why: ${JSON.stringify(said)}`);
    } finally {
      booted.leafToast = wasToast;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; currentDocumentSource = ${JSON.stringify(was.source)};`,
      );
    }
  });

  // The whole point of opening a line rather than splicing one: changing your mind costs nothing. Nothing typed, nothing in the file, and the line goes away.
  check('a line opened on an XML page and left alone writes nothing', () => {
    const opened = xmlBlankLine('<div><p>A line.</p></div>', 'tei', 'element:p', 21);
    try {
      opened.away();
      if (opened.sent.length) throw new Error(`an untouched line wrote ${JSON.stringify(opened.sent)}`);
      if (opened.line.isConnected !== false) throw new Error('the empty line stayed on the page');
    } finally {
      opened.restore();
    }
  });

  /** A note with a blank line open on it: the page set to that document, the line the plus opened, and every command it sends. `host` is what the gutter placed and `line` is what you type in — a list asks for a wrapper around its item, so the two are not always the same element, and `__becomeBlock` swaps both for another kind. */
  function noteBlankLine(source, specId, insertAt, { previous = null, keepEmpty = false } = {}) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify(source)}; pendingCaret = null;`,
    );
    let host = null;
    const place = (node) => {
      host = node;
    };
    booted.openInsertBlock(insertAt, {
      spec: booted.blankBlockSpec(specId) || booted.PLAIN_LINE_SPEC,
      place,
      previous,
      keepEmpty,
    });
    const lineIn = () => (host.children.length ? host.children[0] : host);
    const raise = (type, event) => {
      for (const handler of lineIn().listeners.get(type) || []) handler(event || {});
    };
    return {
      get host() {
        return host;
      },
      get line() {
        return lineIn();
      },
      sent,
      wrote: () => sent.filter((one) => one.command === 'editBlock'),
      type: (words) => {
        const line = lineIn();
        line.textContent = words;
        // A note's commit reads the words back off the child nodes rather than the text, so a stand-in holding only the text is a line nothing was typed on.
        line.childNodes = words ? [{ nodeType: 3, nodeValue: words }] : [];
        raise('input', {});
      },
      enter: () => raise('keydown', { key: 'Enter', preventDefault() {} }),
      backspace: () => raise('keydown', { key: 'Backspace', preventDefault() {} }),
      away: () => raise('blur', { relatedTarget: null }),
      caret: () => read('pendingCaret'),
      restore: () => {
        booted.ipc.postMessage = was.send;
        read(
          `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
            `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
        );
      },
    };
  }

  // Everything the plus writes into a note goes through this one commit, and it splices straight into somebody's file: a wrong separator writes a heading into the middle of the paragraph above.
  check('each kind of line a note offers commits its own marker at the offset it was opened at', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const kinds = { text: '\n\nTyped', heading: '\n\n## Typed', list: '\n\n- Typed', quote: '\n\n> Typed' };
    for (const [kind, expected] of Object.entries(kinds)) {
      const opened = noteBlankLine(note, kind, at);
      try {
        // A list item has to stand in a list to look like one, so what the gutter placed is the list and the line to type in is inside it.
        if (kind === 'list' && opened.host === opened.line) {
          throw new Error('a list line was opened with no list around it');
        }
        if (kind !== 'list' && opened.host !== opened.line) {
          throw new Error(`a ${kind} line was wrapped in something`);
        }
        if (opened.sent.length) throw new Error(`opening a ${kind} line wrote to the document`);

        opened.type('Typed');
        opened.enter();
        const edits = opened.wrote();
        if (edits.length !== 1 || edits[0].text !== expected) {
          throw new Error(`${kind} committed ${JSON.stringify(edits)}`);
        }
        if (edits[0].start !== at || edits[0].end !== at) {
          throw new Error(`${kind} landed at ${edits[0].start}..${edits[0].end}`);
        }
      } finally {
        opened.restore();
      }
    }
  });

  // The two keys that chain one line to the next, both of them arithmetic over the separator's own length: Enter opens the next line past what this one just wrote, and Backspace on a line with nothing on it dissolves it back into the block above.
  check('Enter opens the next line past the one it wrote, and Backspace on an empty one steps back up', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const opened = noteBlankLine(note, 'heading', at);
    try {
      opened.type('New part');
      opened.enter();
      const caret = opened.caret();
      if (!caret || !caret.insertBelow) throw new Error(`Enter chained ${JSON.stringify(caret)}`);
      if (caret.srcStart !== at + 2) throw new Error(`the next line was aimed at ${caret.srcStart}`);
      // A note carries on in a plain line whatever kind this one was: you have finished the heading and are writing under it.
      if (caret.blockSpec) throw new Error(`Enter under a heading opened another ${caret.blockSpec}`);
    } finally {
      opened.restore();
    }

    const above = fakeElement('p');
    above.textContent = 'A paragraph.';
    let took = 0;
    above.focus = () => {
      took += 1;
    };
    const empty = noteBlankLine(note, 'text', at, { previous: above });
    try {
      const host = empty.host;
      empty.backspace();
      if (empty.sent.length) throw new Error(`Backspace on an empty line wrote ${JSON.stringify(empty.sent)}`);
      if (host.isConnected !== false) throw new Error('the empty line stayed on the page');
      if (took !== 1) throw new Error('the block above was not given the caret back');
    } finally {
      empty.restore();
    }
  });

  // Clicking away is the third way the line commits, and the one a reader makes without meaning to. Words typed have to survive it; a line nobody typed on has to leave nothing behind, since the whole point of opening a line rather than splicing one is that changing your mind costs nothing.
  check('clicking away from a new line keeps what was typed and drops the line when nothing was', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const typed = noteBlankLine(note, 'quote', at);
    try {
      typed.type('Someone else said this');
      typed.away();
      const edits = typed.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n> Someone else said this') {
        throw new Error(`clicking away committed ${JSON.stringify(edits)}`);
      }
      // Not Enter: clicking away is the end of the writing, so nothing opens under it.
      if (typed.caret()) throw new Error(`clicking away chained ${JSON.stringify(typed.caret())}`);
    } finally {
      typed.restore();
    }

    const untouched = noteBlankLine(note, 'text', at);
    try {
      const host = untouched.host;
      untouched.away();
      if (untouched.sent.length) throw new Error(`an untouched line wrote ${JSON.stringify(untouched.sent)}`);
      if (host.isConnected !== false) throw new Error('the empty line stayed on the page');
    } finally {
      untouched.restore();
    }

    // The one exception: an empty document has no other block to click into, so taking its line away would leave nowhere to type.
    const only = noteBlankLine('', 'text', 0, { keepEmpty: true });
    try {
      const host = only.host;
      only.away();
      if (only.sent.length) throw new Error(`the only line on an empty page wrote ${JSON.stringify(only.sent)}`);
      if (host.isConnected === false) throw new Error('the only line on an empty page was taken away');
    } finally {
      only.restore();
    }
  });

  // The format bar over a line that is not in the buffer yet. A splice from out there would land the marker beside the words and the blur behind it would then write them again, so the line's own commit carries the marker — and this is what holds that to one edit.
  check('the format bar on a new line writes the words once, under the marker it picked', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const opened = noteBlankLine(note, 'text', at);
    try {
      opened.type('Made a heading');
      booted.blankLineUnderTest = opened.line;
      read('selectionToolbarBlock = blankLineUnderTest;');
      // The bigger H on a plain line steps in at the ordinary section heading, since there is no level above it to step out of.
      booted.applyBlockFormat(read('BLOCK_FORMATS').find((one) => one.id === 'bigger'));
      const edits = opened.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n## Made a heading') {
        throw new Error(`the format bar committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== at || edits[0].end !== at) {
        throw new Error(`the format bar landed at ${edits[0].start}..${edits[0].end}`);
      }

      // The words are written now, so the blur that follows the press must not write them a second time.
      opened.away();
      if (opened.wrote().length !== 1) {
        throw new Error(`the words reached the file ${opened.wrote().length} times`);
      }
    } finally {
      read('selectionToolbarBlock = null;');
      delete booted.blankLineUnderTest;
      opened.restore();
    }
  });

  // The other two ways the gutter commits this line, both of them one splice because none of it is in the buffer: the plus pressed on the line itself has to carry the half-written sentence along with the block that was picked, and the plus on the gap below saves the line the way Enter does.
  check('the plus on a half-written line writes both in one edit, and the plus below it saves the line', () => {
    const note = '# Title\n\nA paragraph.\n';
    const at = note.length;
    const carried = noteBlankLine(note, 'text', at);
    try {
      const divider = booted.blockInsertOptions(null).find((one) => one.id === 'divider');
      carried.type('Half a sentence');
      booted.runBlockInsert(carried.line, divider);
      const edits = carried.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\nHalf a sentence\n\n---') {
        throw new Error(`the plus on a half-written line wrote ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== at || edits[0].end !== at) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
    } finally {
      carried.restore();
    }

    const below = noteBlankLine(note, 'text', at);
    try {
      const text = booted.blockInsertOptions(null).find((one) => one.id === 'text');
      below.type('A line');
      booted.runGapInsert({ after: below.line, before: null }, text);
      const edits = below.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\nA line') {
        throw new Error(`the plus in the gap below wrote ${JSON.stringify(edits)}`);
      }
      const caret = below.caret();
      if (!caret || !caret.insertBelow || caret.srcStart !== at + 2) {
        throw new Error(`the gap below chained ${JSON.stringify(caret)}`);
      }
    } finally {
      below.restore();
    }
  });

  /** A note on the page with a block of it standing in, holding the source range the gutter reads and recording whatever gets placed beside it. Everything sent while `run` works is handed back. */
  function noteGutter(source, run) {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    read(
      `currentDocumentFormat = 'markdown'; currentDocumentSource = ${JSON.stringify(source)}; pendingCaret = null;`,
    );
    const block = (start, end) => {
      const el = fakeElement('p');
      el.dataset = { blockKind: 'paragraph', srcStart: String(start), srcEnd: String(end) };
      el.insertAdjacentElement = (where, node) => {
        el.placed = { where, node };
        return node;
      };
      return el;
    };
    try {
      run({ block, sent, option: (id) => booted.blockInsertOptions(null).find((one) => one.id === id), caret: () => read('pendingCaret') });
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
      );
    }
  }

  // The two ways into everything above: the space between two blocks, and the plus pressed on a line that is already empty. Each opens a line of the kind the option names and writes nothing, so the reader can still change their mind — and where the line goes decides which side of it the blank line is written on.
  check('the plus in the gap and the plus on an empty line each open the kind it names, and write nothing', () => {
    const note = '# Title\n\nA paragraph.\n';
    noteGutter(note, ({ block, sent, option }) => {
      // Under a block: the line opens after it, at the end of its source.
      const above = block(9, 21);
      booted.runGapInsert({ after: above, before: null }, option('heading'));
      if (!above.placed || above.placed.where !== 'afterend') {
        throw new Error(`the gap under a block opened ${JSON.stringify(above.placed && above.placed.where)}`);
      }
      if (above.placed.node.dataset.srcStart !== '21') {
        throw new Error(`the line opened at ${above.placed.node.dataset.srcStart}`);
      }
      if (above.placed.node.dataset.placeholder !== 'Name this part...') {
        throw new Error(`the gap opened a ${JSON.stringify(above.placed.node.dataset.placeholder)}`);
      }
      if (sent.length) throw new Error(`opening a line in the gap wrote ${JSON.stringify(sent)}`);

      // Above the first block there is nothing to hang a blank line off, so the break goes after the new line instead of before it.
      const first = block(0, 7);
      booted.runGapInsert({ after: null, before: first }, option('quote'));
      if (!first.placed || first.placed.where !== 'beforebegin') {
        throw new Error(`the gap over the first block opened ${JSON.stringify(first.placed && first.placed.where)}`);
      }
      const line = first.placed.node;
      line.textContent = 'Someone else said this';
      line.childNodes = [{ nodeType: 3, nodeValue: 'Someone else said this' }];
      for (const handler of line.listeners.get('keydown') || []) handler({ key: 'Enter', preventDefault() {} });
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '> Someone else said this\n\n') {
        throw new Error(`the line over the first block committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
    });

    // The plus on a line that is already in the file and has nothing on it: the same opener, aimed at that line's own offset.
    noteGutter('# Title\n\n\n\nA paragraph.\n', ({ block, sent, option }) => {
      const empty = block(9, 9);
      booted.runBlockInsert(empty, option('list'));
      if (!empty.placed) throw new Error('the plus on an empty line opened nothing');
      if (empty.placed.node.children[0].dataset.placeholder !== 'First of a list...') {
        throw new Error(`the plus on an empty line opened ${JSON.stringify(empty.placed.node.children[0].dataset.placeholder)}`);
      }
      if (sent.length) throw new Error(`the plus on an empty line wrote ${JSON.stringify(sent)}`);
    });
  });

  // The other five of the plus's nine options have no line to type on: each splices its own source straight into a file nobody has saved, at an offset worked out from the block beside it. A wrong offset writes a table into the middle of the paragraph above it.
  check('each thing the plus writes at once lands in the gap under a block', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const wants = {
      code: { text: '\n\n```\n\n```', caret: null },
      // The one of the five that asks for a caret, and it lands one separator past the offset — inside what it wrote, not on the blank line in front of it.
      table: { text: '\n\n|  |  |\n| --- | --- |\n|  |  |', caret: end + 2 },
      divider: { text: '\n\n---', caret: null },
    };
    for (const [id, want] of Object.entries(wants)) {
      noteGutter(note, ({ block, sent, option, caret }) => {
        const above = block(9, end);
        booted.runGapInsert({ after: above, before: null }, option(id));
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== want.text) {
          throw new Error(`the ${id} wrote ${JSON.stringify(edits)}`);
        }
        // The end of the block above and a blank line down: a byte short of it eats the last letter of the sentence.
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`the ${id} landed at ${edits[0].start}..${edits[0].end}`);
        }
        // The source is the whole of what these options are, so nothing is opened to type in beside it.
        if (above.placed) throw new Error(`the ${id} opened a line as well as writing one`);
        const asked = caret();
        if (want.caret === null ? !!asked : !asked || asked.srcStart !== want.caret) {
          throw new Error(`the ${id} asked for a caret at ${JSON.stringify(asked)}`);
        }
      });
    }
  });

  // The offset for that gap is not the block's own end. A block being typed in is saved first and the new one goes past what was written — splice at the stale end and it lands inside the sentence, or the sentence is thrown away.
  check('the gap under a block being typed in saves it before it writes past it', () => {
    const note = '# Title\n\nA paragraph.\n';
    const start = note.indexOf('A paragraph.');
    const stale = start + 'A paragraph.'.length;
    const typed = 'A much longer paragraph than it was.';
    noteGutter(note, ({ block, sent, option }) => {
      const after = block(start, stale);
      after.textContent = typed;
      after.childNodes = [{ nodeType: 3, nodeValue: typed }];
      after.__editingActive = true;
      after.__editBaseline = 'A paragraph.';
      booted.runGapInsert({ after, before: null }, option('divider'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 2) throw new Error(`the gap under a block being typed in sent ${JSON.stringify(edits)}`);
      if (edits[0].start !== start || edits[0].end !== stale || edits[0].text !== typed) {
        throw new Error(`it saved the block as ${JSON.stringify(edits[0])}`);
      }
      const past = start + typed.length;
      if (edits[1].start !== past || edits[1].end !== past) {
        throw new Error(`the rule landed at ${edits[1].start}, not past what was just written`);
      }
      if (edits[1].text !== '\n\n---') throw new Error(`the rule wrote ${JSON.stringify(edits[1].text)}`);
    });
  });

  // Above the first block there is nothing to hang a blank line off, so the separator changes ends: the source first and the break after it. The only splice in the gutter written back to front.
  check('the gap above the first block puts the break after what it wrote', () => {
    const note = '# Title\n\nA paragraph.\n';
    noteGutter(note, ({ block, sent, option, caret }) => {
      booted.runGapInsert({ after: null, before: block(0, 7) }, option('code'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '```\n\n```\n\n') {
        throw new Error(`the gap above the first block wrote ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
      if (caret()) throw new Error(`a code block up there asked for a caret at ${JSON.stringify(caret())}`);
    });

    // And the caret goes to the block's own start up here rather than a separator past it, since the break is on the far side.
    noteGutter(note, ({ block, option, caret }) => {
      booted.runGapInsert({ after: null, before: block(0, 7) }, option('table'));
      const asked = caret();
      if (!asked || asked.srcStart !== 0) {
        throw new Error(`the table above the first block asked for a caret at ${JSON.stringify(asked)}`);
      }
    });
  });

  // The one splice in the gutter that overwrites rather than adds: the plus pressed on a line already in the file writes over that line's own range. Which is why the refusal is asked again here rather than trusted from the draw — a drifted button is a paragraph deleted.
  check("the plus on an empty line writes over that line's own range", () => {
    const note = '# Title\n\n>\n\nA paragraph.\n';
    const at = note.indexOf('>');
    noteGutter(note, ({ block, sent, option, caret }) => {
      // The ordinary block, holding nothing and saying so: the refusal is read off what the line is really carrying rather than off a query written here.
      const empty = block(at, at + 1);
      empty.dataset.blockKind = 'block_quote';
      booted.runBlockInsert(empty, option('table'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1 || edits[0].text !== '|  |  |\n| --- | --- |\n|  |  |') {
        throw new Error(`the plus on an empty line wrote ${JSON.stringify(edits)}`);
      }
      // Over the line, not beside it: a splice at one point would leave the empty quote standing above the table.
      if (edits[0].start !== at || edits[0].end !== at + 1) {
        throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
      }
      const asked = caret();
      if (!asked || asked.srcStart !== at) {
        throw new Error(`the table on an empty line asked for a caret at ${JSON.stringify(asked)}`);
      }
    });

    // What stands between that splice and somebody's sentence.
    noteGutter(note, ({ block, sent, option }) => {
      const start = note.indexOf('A paragraph.');
      const says = block(start, start + 'A paragraph.'.length);
      says.textContent = 'A paragraph.';
      booted.runBlockInsert(says, option('divider'));
      if (sent.some((one) => one.command === 'editBlock')) {
        throw new Error(`the plus wrote over a line that says something: ${JSON.stringify(sent)}`);
      }
    });

    // The other half of the same refusal, and the one this whole file was raised over: a line with no word on it that is carrying a picture. Nothing said it out loud until the block could be asked what it holds.
    noteGutter(note, ({ block, sent, option }) => {
      const start = note.indexOf('A paragraph.');
      const holding = block(start, start + 'A paragraph.'.length);
      holding.appendChild(booted.document.createElement('img'));
      booted.runBlockInsert(holding, option('divider'));
      if (sent.some((one) => one.command === 'editBlock')) {
        throw new Error(`the plus wrote over a line carrying a picture: ${JSON.stringify(sent)}`);
      }
    });
  });

  // The file dialog is built with no parent window, so the app stays clickable under it: the box the picture was headed for can be folded by hand, or swept away by a render, while somebody is still choosing a file. Dropping that answer is right — the line it was aimed at may be gone — and the word is what was missing, without which a reader picks a file and watches the page do nothing.
  check('a picture answered after its box closed says so, and one a newer box replaced stays silent', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const wasToast = booted.leafToast;
    const wrote = [];
    const said = [];
    const write = (option) => wrote.push(option);
    // A fresh row to draw the box into each time, the way every render leaves one, and the token the picker will answer with.
    const openBox = () => {
      booted.__blockRowUnderTest = fakeElement('blockInsertRowUnderTest');
      read('blockGutterRow = __blockRowUnderTest;');
      booted.openBlockImageBox(write);
      return read('blockImageToken');
    };
    try {
      booted.leafToast = (message) => said.push(message);

      // A box still standing when its answer lands: the picture is written, and nothing is said about it.
      booted.leafImagePicked(openBox(), 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1 || wrote[0].text !== '![A leaf](shots/leaf.png)') {
        throw new Error(`the answer to a standing box wrote ${JSON.stringify(wrote)}`);
      }
      if (said.length) throw new Error(`a picture that landed said ${JSON.stringify(said)}`);

      // Folded by hand under the dialog — the plus, or Escape.
      const folded = openBox();
      booted.collapseBlockInsertRow();
      booted.leafImagePicked(folded, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`the answer to a folded box wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('went nowhere')) {
        throw new Error(`a folded box said ${JSON.stringify(said)}`);
      }

      // Swept away by a render landing in the moment Choose was pressed: the same drop, so the same word.
      said.length = 0;
      const redrawn = openBox();
      booted.bindBlockControls();
      booted.leafImagePicked(redrawn, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`the answer to a redrawn box wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('went nowhere')) {
        throw new Error(`a redrawn box said ${JSON.stringify(said)}`);
      }

      // A newer box has since been opened, so the old answer belongs to somebody who has already moved on: dropped, and no word chases them.
      said.length = 0;
      const old = openBox();
      openBox();
      booted.leafImagePicked(old, 'shots/leaf.png', 'A leaf');
      if (wrote.length !== 1) throw new Error(`a stale answer wrote ${JSON.stringify(wrote)}`);
      if (said.length) throw new Error(`a stale answer said ${JSON.stringify(said)}`);
    } finally {
      booted.collapseBlockInsertRow();
      delete booted.__blockRowUnderTest;
      read('blockGutterRow = null;');
      booted.leafToast = wasToast;
    }
  });

  /** The reading layout a rendered document leaves on the app surface, stood up for real. `bindBlockControls` hangs the gutter off `.reader-layout` and refuses without a `.document-body`, and `openBlockGapLine` lays its clickable line into the same layout — so a check pressing either needs both really standing rather than answered by a query. Handed back so a check can read what was appended into it. */
  function standUpReadingLayout() {
    const app = vm.runInContext('app', booted);
    const found = app.querySelector('.reader-layout');
    if (found) return found;
    const layout = booted.document.createElement('div');
    layout.className = 'reader-layout';
    const body = booted.document.createElement('div');
    body.className = 'document-body';
    layout.appendChild(body);
    app.appendChild(layout);
    return layout;
  }

  /** The insert row as the plus really opens it, over the gap under `after` on a note. Every button comes back carrying the closure the app wired it with rather than one written here, which is what makes the two options that ask before they write readable at all: neither one calls that closure, they hand it away. */
  function openedInsertRow(after) {
    const read = (expression) => vm.runInContext(expression, booted);
    const wasUnlocked = read('readingUnlocked');
    read('readingUnlocked = true;');
    standUpReadingLayout();
    booted.bindBlockControls();
    read('blockGutterTarget = null; blockGutterGap = { after: null, before: null };');
    read('blockGutterGap').after = after;
    booted.expandBlockInsertRow();
    const ids = booted.blockInsertOptions(null).map((one) => one.id);
    const inRow = (className) =>
      read('blockGutterRow').children.find((child) => String(child.className || '').includes(className));
    return {
      press: (id) => {
        const button = read('blockGutterRow').children[ids.indexOf(id)];
        if (!button) throw new Error(`the insert row has no ${id}`);
        for (const handler of button.listeners.get('click') || []) handler({});
      },
      // The other way into the picture: an address typed where the box asks for one.
      address: (typed) => {
        const field = inRow('block-insert-url');
        if (!field) throw new Error('the picture box drew no address field');
        field.value = typed;
        for (const handler of field.listeners.get('keydown') || []) handler({ key: 'Enter', preventDefault() {} });
      },
      done: () => {
        booted.collapseBlockInsertRow();
        read(`readingUnlocked = ${JSON.stringify(wasUnlocked)}; blockGutterTarget = null; blockGutterGap = null;`);
        booted.bindBlockControls();
      },
    };
  }

  // The picture is the first of the two options with nothing to write when it is chosen: it hands the insert row's own write closure to a box and is written whenever the answer comes back. Both ways of answering land as the same splice the five immediate ones make.
  check('the picture the box was answered with is written as one image', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    noteGutter(note, ({ block, sent, caret }) => {
      const row = openedInsertRow(block(9, end));
      try {
        row.press('image');
        // Choosing it writes nothing: the box is the whole of what the press does.
        if (sent.some((one) => one.command === 'editBlock')) {
          throw new Error(`choosing a picture wrote ${JSON.stringify(sent)}`);
        }
        booted.leafImagePicked(read('blockImageToken'), 'shots/leaf.png', 'A leaf');
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n![A leaf](shots/leaf.png)') {
          throw new Error(`the answered box wrote ${JSON.stringify(edits)}`);
        }
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
        }
        // A picture edits as raw source and has no caret to take until it is clicked.
        if (caret()) throw new Error(`a picture asked for a caret at ${JSON.stringify(caret())}`);
      } finally {
        row.done();
      }
    });

    // An address typed into the box rather than a file chosen through the dialog: the same splice, with no alt text to put in the brackets.
    noteGutter(note, ({ block, sent }) => {
      const row = openedInsertRow(block(9, end));
      try {
        row.press('image');
        row.address('https://example.com/leaf.png');
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n![](https://example.com/leaf.png)') {
          throw new Error(`a typed address wrote ${JSON.stringify(edits)}`);
        }
      } finally {
        row.done();
      }
    });
  });

  // The answer can come back long after the row it was headed for has gone — the dialog has no parent window, so the app stays clickable under it. Both guards are read here for what they keep out of the file rather than for what they hand back: an answer that lands anyway is a picture spliced at offsets belonging to a document nobody is looking at.
  check('an answer from a box that has closed is dropped', () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const wasToast = booted.leafToast;
    const said = [];
    try {
      booted.leafToast = (message) => said.push(message);

      // Folded by hand under the dialog, or swept away by the render that rebuilds the gutter: the writer itself is let go.
      for (const [how, close] of [
        ['folded by hand', () => booted.collapseBlockInsertRow()],
        ['swept away by a render', () => booted.bindBlockControls()],
      ]) {
        said.length = 0;
        noteGutter(note, ({ block, sent }) => {
          const row = openedInsertRow(block(9, end));
          try {
            row.press('image');
            close();
            booted.leafImagePicked(read('blockImageToken'), 'shots/leaf.png', 'A leaf');
            if (sent.some((one) => one.command === 'editBlock')) {
              throw new Error(`a box ${how} still wrote ${JSON.stringify(sent)}`);
            }
            if (said.length !== 1 || !said[0].includes('went nowhere')) {
              throw new Error(`a box ${how} said ${JSON.stringify(said)}`);
            }
          } finally {
            row.done();
          }
        });
      }

      // A newer box has since been opened, so the older answer belongs to somebody who has already moved on: dropped, and no word chases them. The second box is opened the way a reader opens one, because the first clears the row as it draws and takes that option off the screen.
      said.length = 0;
      noteGutter(note, ({ block, sent }) => {
        const after = block(9, end);
        const row = openedInsertRow(after);
        let again = row;
        try {
          row.press('image');
          const old = read('blockImageToken');
          row.done();
          again = openedInsertRow(after);
          again.press('image');
          booted.leafImagePicked(old, 'shots/leaf.png', 'A leaf');
          if (sent.some((one) => one.command === 'editBlock')) {
            throw new Error(`a stale token still wrote ${JSON.stringify(sent)}`);
          }
          if (said.length) throw new Error(`a stale token said ${JSON.stringify(said)}`);
        } finally {
          again.done();
        }
      });
    } finally {
      booted.leafToast = wasToast;
    }
  });

  // The other option that asks first, and the one held open longest: the sheet stays up across every render for as long as somebody takes to draw, and Save writes one fenced block through the same splice. Driven through the save the sheet was opened with rather than the sheet's own button, which flushes and re-fits a canvas the stand-in page has no size for.
  check("the diagram sheet's Save writes one fenced mermaid block", () => {
    const note = '# Title\n\nA paragraph.\n';
    const end = note.indexOf('A paragraph.') + 'A paragraph.'.length;
    const wasSheet = booted.openFlowSheet;
    noteGutter(note, ({ block, sent, caret }) => {
      const after = block(9, end);
      const row = openedInsertRow(after);
      let save = null;
      booted.openFlowSheet = (opened) => {
        save = opened.save;
      };
      try {
        row.press('flow');
        if (!save) throw new Error('choosing a flowchart opened no sheet');
        if (sent.some((one) => one.command === 'editBlock')) {
          throw new Error(`opening the sheet wrote ${JSON.stringify(sent)}`);
        }
        // A number, not true: the drawing is the only copy there is, so the sheet is told to wait on the host rather than to close on the dispatch.
        const answer = save('graph TD\n  a-->b');
        if (answer === false) throw new Error('the sheet was told its Save had nowhere to land');
        if (typeof answer !== 'number') throw new Error(`the sheet was told to close on the dispatch: ${JSON.stringify(answer)}`);
        const edits = sent.filter((one) => one.command === 'editBlock');
        if (edits.length !== 1 || edits[0].text !== '\n\n```mermaid\ngraph TD\n  a-->b\n```') {
          throw new Error(`Save wrote ${JSON.stringify(edits)}`);
        }
        if (edits[0].token !== answer) throw new Error(`it sent ${JSON.stringify(edits[0].token)} and answered ${JSON.stringify(answer)}`);
        if (edits[0].start !== end || edits[0].end !== end) {
          throw new Error(`it landed at ${edits[0].start}..${edits[0].end}`);
        }
        if (caret()) throw new Error(`a diagram asked for a caret at ${JSON.stringify(caret())}`);

        // What the plus was standing on is asked again at Save, since the sheet outlives every render: a block that has left the page takes the write with it and the sheet is told to stay open.
        after.isConnected = false;
        if (save('graph TD\n  a-->c') !== false) throw new Error('a Save with nowhere to land said it landed');
        if (sent.filter((one) => one.command === 'editBlock').length !== 1) {
          throw new Error('a Save with nowhere to land wrote anyway');
        }
      } finally {
        booted.openFlowSheet = wasSheet;
        row.done();
      }
    });
  });

  // The space above the first block is built and offered the plus, so nothing after it may call that space gone — it measures off the block below, not off something above it. Called gone, the plus is hidden the moment it is drawn and the field block it starts up there can never be started.
  check('the top space stands, and starts a field block', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const below = fakeElement('first');
    below.getBoundingClientRect = () => ({ top: 100, bottom: 140 });
    if (!booted.blockGapStanding({ above: null, below })) {
      throw new Error('the space above the first block is still called gone');
    }
    // The gutter takes its line from the middle of the space blockGapSpan already measures for it: one line up from the block below.
    const was = { format: read('currentDocumentFormat'), unlocked: read('readingUnlocked') };
    const inApp = read('app');
    const wasQuery = inApp.querySelector;
    try {
      read(`currentDocumentFormat = 'markdown'; readingUnlocked = true; blockGutterGap = null;`);
      inApp.querySelector = (selector) => (selector === '.frontmatter' ? null : wasQuery.call(inApp, selector));
      read('blockGutterGap = { above: null, below: null }');
      const gap = read('blockGutterGap');
      gap.below = below;
      const middle = booted.blockGutterAnchorY();
      if (middle !== 84) throw new Error(`the gutter sat at ${middle}, not on the middle of the space`);
      // The label and the press both key on this one answer: above everything, on a note with no field block, the plus starts one.
      if (!booted.frontmatterCanStart(gap)) {
        throw new Error('the plus above everything does not offer to start a field block');
      }
      // With a field block already at the top there is nothing to start, so the plus is the insert menu it reads as.
      inApp.querySelector = (selector) => (selector === '.frontmatter' ? {} : wasQuery.call(inApp, selector));
      if (booted.frontmatterCanStart(gap)) {
        throw new Error('a note that has a field block was offered a second one');
      }
    } finally {
      inApp.querySelector = wasQuery;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `readingUnlocked = ${JSON.stringify(was.unlocked)}; blockGutterGap = null;`,
      );
    }
  });

  // The top space gets a clickable line like any other, so it may not be refused for having no block to write after, and the line's own placing may not reach for a block above that is not there. It is measured from the span's own top, and its click opens a line above the first block through the same opener the plus uses, writing nothing until something is typed in it.
  check('clicking the space above the first block opens a line above it, and writes nothing until it is typed in', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    noteGutter('# Title\n\nA paragraph.\n', ({ block, sent }) => {
      const first = block(0, 7);
      first.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 0, width: 600, height: 40 });
      standUpReadingLayout();
      booted.openBlockGapLine({ above: null, below: first, after: null, before: first });
      const line = read('blockGapLine');
      if (!line) throw new Error('the space above the first block got no clickable line');
      // One line tall against the top of the block below — the span blockGapSpan measures — not reaching for a block above that is not there.
      if (line.style.top !== '68px' || line.style.height !== '32px') {
        throw new Error(`the line was laid at ${line.style.top} for ${line.style.height}`);
      }
      for (const handler of line.listeners.get('mousedown') || []) handler({ preventDefault() {} });
      if (!first.placed || first.placed.where !== 'beforebegin') {
        throw new Error(`clicking the top space opened ${JSON.stringify(first.placed && first.placed.where)}`);
      }
      if (sent.length) throw new Error(`clicking the top space wrote ${JSON.stringify(sent)}`);
      read('closeBlockGapLine()');
    });
  });

  // The other half of the standing test: a space is gone when the end it really has has left the page, so the plus is never left floating beside nothing after a render replaced the block it was measured off.
  check('a space whose real end has left the page is still called gone', () => {
    const off = fakeElement('replaced');
    off.isConnected = false;
    const on = fakeElement('standing');
    if (booted.blockGapStanding({ above: null, below: off })) {
      throw new Error('the top space stands on a block a render took away');
    }
    if (booted.blockGapStanding({ above: off, below: on })) {
      throw new Error('a space stands on an above a render took away');
    }
    if (booted.blockGapStanding({ above: on, below: off })) {
      throw new Error('a space stands on a below a render took away');
    }
    if (booted.blockGapStanding({ above: null, below: null })) {
      throw new Error('a space with no ends at all is standing');
    }
  });

  // A pause puts what is being typed into the file without redrawing the page, so both plus paths under a block have to save that block even where its words are back at the baseline — skip it and the file keeps a word the page shows as taken back, for the next render to draw in again.
  check('a word typed and taken back inside the pause is still written out by both plus paths', () => {
    const note = '# Title\n\nA paragraph.\n';
    const start = note.indexOf('A paragraph.');
    const end = start + 'A paragraph.'.length;
    const typedOn = (block) => {
      const el = block(start, end);
      el.textContent = 'A paragraph.';
      el.childNodes = [{ nodeType: 3, nodeValue: 'A paragraph.' }];
      el.__editingActive = true;
      el.__editBaseline = 'A paragraph.';
      // The pause has already put this block's typing into the buffer, and the words have since gone back to what they started as.
      el.__liveStarted = true;
      return el;
    };
    const saved = (edit, what) => {
      if (edit.start !== start || edit.end !== end || edit.text !== 'A paragraph.') {
        throw new Error(`${what} saved the block as ${JSON.stringify(edit)}`);
      }
    };

    noteGutter(note, ({ block, sent, option }) => {
      const after = typedOn(block);
      booted.runGapInsert({ after, before: null }, option('divider'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 2) throw new Error(`the gap under it sent ${JSON.stringify(edits)}`);
      saved(edits[0], 'the gap under it');
      if (edits[1].start !== end) throw new Error(`the new block landed at ${edits[1].start}, not after the saved line`);
    });

    noteGutter(note, ({ block, sent, option }) => {
      const after = typedOn(block);
      booted.runGapInsert({ after, before: null }, option('text'));
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`the line opened under it sent ${JSON.stringify(edits)}`);
      saved(edits[0], 'the line opened under it');
    });
  });

  // Picking a kind on a line that is already open is the one option that commits nothing: the line is not in the buffer, so it swaps for an empty one of the kind that was picked and waits for its first word. Writing here would splice a marker with no words behind it.
  check('picking another kind on a line already open swaps it and sends no edit', () => {
    const note = '# Title\n\nA paragraph.\n';
    const opened = noteBlankLine(note, 'text', note.length);
    try {
      const was = opened.host;
      booted.runBlockInsert(opened.line, booted.blockInsertOptions(null).find((one) => one.id === 'quote'));
      if (opened.sent.length) throw new Error(`swapping the kind wrote ${JSON.stringify(opened.sent)}`);
      if (opened.host === was) throw new Error('the line was not swapped at all');
      if (was.isConnected !== false) throw new Error('the line it swapped out stayed on the page');
      if (opened.line.dataset.placeholder !== 'Someone else’s words...') {
        throw new Error(`it swapped to ${JSON.stringify(opened.line.dataset.placeholder)}`);
      }

      // And the swapped line commits as its own kind, at the offset the first one was opened at.
      opened.type('Said elsewhere');
      opened.enter();
      const edits = opened.wrote();
      if (edits.length !== 1 || edits[0].text !== '\n\n> Said elsewhere') {
        throw new Error(`the swapped line committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== note.length) throw new Error(`it landed at ${edits[0].start}`);
    } finally {
      opened.restore();
    }
  });

  // A document with nothing in it opens on a title and a line under it, and neither is in the source yet — so the pair has to commit as ONE splice at offset zero. Two blocks each holding "insert at 0" would overwrite each other, whichever committed second, and the reader would watch half of what they wrote disappear.
  check('an empty note writes its title and its first line as one edit at the top of the file', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = {
      format: read('currentDocumentFormat'),
      source: read('currentDocumentSource'),
      send: booted.ipc.postMessage,
    };
    let sent = [];
    // The page's body. The pair goes in front of whatever is already there, story first and the title in front of it.
    const openStart = () => {
      sent = [];
      const placed = [];
      booted.openMediumStart({
        firstChild: null,
        insertBefore: (node) => {
          placed.unshift(node);
          return node;
        },
      });
      return { title: placed[0], story: placed[1] };
    };
    const write = (block, words) => {
      block.textContent = words;
      block.childNodes = [{ nodeType: 3, nodeValue: words }];
      for (const handler of block.listeners.get('input') || []) handler({});
    };
    const raise = (block, type, event) => {
      for (const handler of block.listeners.get(type) || []) handler(event || {});
    };
    const wrote = () => sent.filter((one) => one.command === 'editBlock');
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; pendingCaret = null;");

      const both = openStart();
      write(both.title, 'A name');
      write(both.story, 'The first words');
      // Enter in the title is not a commit: a title with no story under it is not a document yet, so it walks down to the line below.
      raise(both.title, 'keydown', { key: 'Enter', preventDefault() {} });
      if (wrote().length) throw new Error(`Enter in the title wrote ${JSON.stringify(wrote())}`);
      raise(both.story, 'keydown', { key: 'Enter', preventDefault() {} });
      const edits = wrote();
      if (edits.length !== 1 || edits[0].text !== '# A name\n\nThe first words') {
        throw new Error(`the pair committed ${JSON.stringify(edits)}`);
      }
      if (edits[0].start !== 0 || edits[0].end !== 0) {
        throw new Error(`the pair landed at ${edits[0].start}..${edits[0].end}`);
      }

      // A title on its own is still something to carry on under, so clicking away keeps it and writes nothing else.
      const named = openStart();
      write(named.title, 'A name');
      raise(named.title, 'focusout', { relatedTarget: null });
      if (wrote().length !== 1 || wrote()[0].text !== '# A name') {
        throw new Error(`a title on its own committed ${JSON.stringify(wrote())}`);
      }

      // And words with no title keep their own line, with no heading invented over them.
      const unnamed = openStart();
      write(unnamed.story, 'The first words');
      raise(unnamed.story, 'keydown', { key: 'Enter', preventDefault() {} });
      if (wrote().length !== 1 || wrote()[0].text !== 'The first words') {
        throw new Error(`a story on its own committed ${JSON.stringify(wrote())}`);
      }

      // Neither typed on is not a document: the pair stays standing and nothing is written.
      const untouched = openStart();
      raise(untouched.story, 'focusout', { relatedTarget: null });
      if (sent.length) throw new Error(`an untouched pair wrote ${JSON.stringify(sent)}`);
    } finally {
      booted.ipc.postMessage = was.send;
      read(
        `currentDocumentFormat = ${JSON.stringify(was.format)}; ` +
          `currentDocumentSource = ${JSON.stringify(was.source)}; pendingCaret = null;`,
      );
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

  // The data half of the same fault: a JSON or YAML block with no proven range is drawn exactly like the ones beside it that open, so a press on one must not answer with nothing at all and read as the page being broken. A press on a block that opens still says nothing, because it is about to open.
  check('a data block that cannot open says why when it is pressed', () => {
    const { wireDataClosedParts } = booted;
    const said = [];
    const wasToast = booted.leafToast;
    let press = null;
    const body = {
      addEventListener: (type, handler) => {
        if (type === 'pointerdown') press = handler;
      },
    };
    // `closest` answers for whichever ancestors this element is said to have; a block answers with its own kind.
    const at = (held, kind) => ({
      closest: (selector) => (held.includes(selector) ? (selector === '[data-block-id]' ? { dataset: { blockKind: kind } } : {}) : null),
    });
    try {
      booted.leafToast = (message) => said.push(message);
      wireDataClosedParts(body);
      if (!press) throw new Error('nothing listens for a press on the page');

      press({ target: at(['[data-block-id]'], 'data_field') });
      if (said.length !== 1 || !said[0].includes('source view')) {
        throw new Error(`a value nothing could place did not say where to edit it: ${JSON.stringify(said)}`);
      }
      // A list and a table could not be placed for a different reason — where they end — so they say that instead.
      press({ target: at(['[data-block-id]'], 'data_list') });
      if (said.length !== 2 || !said[1].includes('where this ends')) {
        throw new Error(`a list did not say why it could not open: ${JSON.stringify(said)}`);
      }

      // A heading is a key's name as often as it is a value, so it says where its words came from rather than claiming how a value is spelled.
      press({ target: at(['[data-block-id]'], 'data_heading') });
      if (said.length !== 3 || !said[2].includes('comes from the file')) {
        throw new Error(`a heading was told it was a value: ${JSON.stringify(said)}`);
      }

      // A block that opens answers for itself, the big heading over a file with no title of its own opens the rename box, and a press on nothing at all is not a block.
      press({ target: at(['[data-src-start]', '[data-block-id]'], 'data_field') });
      press({ target: at(['[data-borrowed-title]', '[data-block-id]'], 'data_heading') });
      press({ target: at([], null) });
      if (said.length !== 3) throw new Error(`a block that answers was growled at: ${JSON.stringify(said)}`);
      // And the page wires it: a data document reaching the reading editor gets the same answer, or the lines above are a function nothing ever calls.
      const read = (expression) => vm.runInContext(expression, booted);
      const inApp = read('app');
      const wasQuery = inApp.querySelector;
      const wasUnlocked = read('readingUnlocked');
      let bound = null;
      const page = {
        addEventListener: (type, handler) => {
          if (type === 'pointerdown') bound = handler;
        },
        querySelectorAll: () => [],
        querySelector: () => null,
      };
      try {
        read('readingUnlocked = true;');
        inApp.querySelector = (selector) => (selector === '.document-body' ? page : wasQuery(selector));
        booted.bindReadingEditor({ format: 'yaml', blocks: [], source: 'title: |\n  words\n' }, { deferCaret: true });
        if (!bound) throw new Error('a data document reaching the reading editor listens for no press');
        said.length = 0;
        bound({ target: at(['[data-block-id]'], 'data_heading') });
        if (said.length !== 1) throw new Error(`the page wired no answer for a block that cannot open: ${JSON.stringify(said)}`);
      } finally {
        inApp.querySelector = wasQuery;
        read(`readingUnlocked = ${wasUnlocked};`);
        read("currentDocumentFormat = 'markdown'; currentDocumentSource = ''; currentDocumentBindsAnything = true;");
      }
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

  // Typing one character into a cell must not rebuild every row of the table, or a table lined up by hand loses its columns. What stops that is finding the one cell that moved and sending only that; anything else — a column gained, two cells changed at once — has to fall back to the whole-table rewrite, and reporting a fallback as a one-cell edit would write the wrong bytes.
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

  // The sheet stands open for minutes, so the document moves under it. Where Save writes is read when Save is pressed, and a Save with nothing left to write onto says so rather than splicing into whatever took those bytes.
  check('the diagram sheet writes where the block is when Save is pressed, and refuses once it has gone', () => {
    const note = '# Title\n\n```mermaid\nflowchart TD\n    A["a"]\n```\n';
    const at = note.indexOf('```mermaid');
    const end = note.indexOf('\n```\n', at) + '\n```'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const sent = [];
    const said = [];
    const block = fakeElement('flowBlockUnderTest');
    block.dataset = { srcStart: String(at), srcEnd: String(end) };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);
      booted.openMermaidBlockSheet(block);
      if (read('flowSession && flowSession.text') !== 'flowchart TD\n    A["a"]') {
        throw new Error(`the sheet opened on ${JSON.stringify(read('flowSession && flowSession.text'))}`);
      }

      // A pause in somebody's typing above the diagram: the buffer grows and every block's numbers move, with nothing redrawn — what advanceLiveRanges does as the splice lands.
      const grew = 'A new sentence.\n\n';
      read(`currentDocumentSource = ${JSON.stringify(note.slice(0, at) + grew + note.slice(at))};`);
      block.dataset.srcStart = String(at + grew.length);
      block.dataset.srcEnd = String(end + grew.length);

      read('flowCode').value = 'flowchart TD\n    A["b"]';
      booted.saveFlowSheet();
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`Save sent ${JSON.stringify(sent)}`);
      if (edits[0].start !== at + grew.length + '```mermaid\n'.length) {
        throw new Error(`Save landed at ${edits[0].start}, which is where the block used to be`);
      }
      if (edits[0].text !== 'flowchart TD\n    A["b"]') throw new Error(`Save wrote ${JSON.stringify(edits[0].text)}`);
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);

      // The same sheet over a block a render has taken away: nothing is written, the reader is told why, and the drawing stays on screen to be copied out of.
      sent.length = 0;
      booted.openMermaidBlockSheet(block);
      block.isConnected = false;
      booted.saveFlowSheet();
      if (sent.filter((one) => one.command === 'editBlock').length) {
        throw new Error(`a Save with no block left wrote ${JSON.stringify(sent)}`);
      }
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('the refused Save closed the sheet over the drawing');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The sheet waits for the host's word before it closes. Answering true on the dispatch closes it over a write the host has not made, and a reader whose file has gone loses the drawing.
  check('the diagram sheet waits for the host before it closes, and keeps the drawing when the edit is refused', () => {
    const note = '# Title\n\n\`\`\`mermaid\nflowchart TD\n    A["a"]\n\`\`\`\n';
    const at = note.indexOf('\`\`\`mermaid');
    const end = note.indexOf('\n\`\`\`\n', at) + '\n\`\`\`'.length;
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const sent = [];
    const said = [];
    const block = fakeElement('flowBlockWaitingOnTheHost');
    block.dataset = { srcStart: String(at), srcEnd: String(end) };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);

      // A Save the host refuses: the sheet stays up with the drawing in it, and the reason is said where the reader is looking.
      booted.openMermaidBlockSheet(block);
      booted.saveFlowSheet();
      const refused = sent.filter((one) => one.command === 'editBlock');
      if (refused.length !== 1) throw new Error(`Save sent ${JSON.stringify(sent)}`);
      if (typeof refused[0].token !== 'number') {
        throw new Error(`Save sent no token, so nothing can answer it: ${JSON.stringify(refused[0])}`);
      }
      if (!read('!!flowSession')) throw new Error('the sheet closed on the dispatch, before the host had written anything');
      if (said.length) throw new Error(`a Save still waiting said ${JSON.stringify(said)}`);

      const why = 'watch.md was not changed: the file could not be read.';
      booted.leafEditAnswered(refused[0].token, false, why);
      if (!read('!!flowSession')) throw new Error('a refused Save closed the sheet over the only copy of the drawing');
      if (said.length !== 1 || said[0] !== why) throw new Error(`it said ${JSON.stringify(said)}`);

      // An answer to a Save nobody is holding any more is dropped rather than closing whatever is open now.
      booted.leafEditAnswered(refused[0].token, true, null);
      if (!read('!!flowSession')) throw new Error('an answer already spent closed the sheet');

      // And a Save the host wrote: that one closes it.
      sent.length = 0;
      said.length = 0;
      booted.saveFlowSheet();
      const landed = sent.filter((one) => one.command === 'editBlock');
      if (landed.length !== 1) throw new Error(`the second Save sent ${JSON.stringify(sent)}`);
      if (landed[0].token === refused[0].token) throw new Error('two Saves shared one token');
      if (!read('!!flowSession')) throw new Error('the sheet closed before the answer arrived');
      booted.leafEditAnswered(landed[0].token, true, null);
      if (read('!!flowSession')) throw new Error('a Save the host wrote left the sheet open');
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The other way in: the plus offers a new diagram, and the gutter it was pressed on is rebuilt by every render — so a drawing that comes back after one has no line left to be written onto.
  check('a new diagram writes nothing once the line the plus stood on has gone', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), toast: booted.leafToast };
    const wrote = [];
    const said = [];
    const line = fakeElement('flowPlaceUnderTest');
    line.dataset = { srcStart: '9', srcEnd: '9' };
    try {
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify('# Title\n\n\n')};`);
      const standing = (place) => booted.blockInsertPlaceStanding(place);
      if (!standing({ target: line })) throw new Error('a line still on the page was called gone');
      if (!standing({ gap: { after: line, before: null } })) throw new Error('a gap under a standing block was called gone');
      if (standing(null) || standing({ target: null }) || standing({ gap: { after: null, before: null } })) {
        throw new Error('a place with nothing in it was called standing');
      }

      // The stand-in answers what the insert row answers — the token it sent — because an array push answers its new length, and a sheet reading that would hold itself open on a number nothing will ever come back with.
      const write = (written) => {
        wrote.push(written);
        return booted.nextEditToken();
      };

      booted.openBlockFlowSheet(write, { target: line });
      line.isConnected = false;
      booted.saveFlowSheet();
      if (wrote.length) throw new Error(`it wrote ${JSON.stringify(wrote)}`);
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('the refused Save closed the sheet over the drawing');

      // And back on a line that is still there, the same Save writes the fenced block and asks to be answered.
      line.isConnected = true;
      booted.saveFlowSheet();
      if (wrote.length !== 1 || !wrote[0].text.startsWith('```mermaid\n')) {
        throw new Error(`the Save that should have landed wrote ${JSON.stringify(wrote)}`);
      }
      if (!wrote[0].answered) throw new Error('the new-diagram Save asked the insert row for no answer');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.leafToast = was.toast;
      booted.__frames.drain();
    }
  });

  // The same wait, down the door a new diagram really takes: through the insert row, which sent the command and answered nothing, so the sheet closed over minutes of drawing whether or not the host kept a byte of it. A diagram already in the page survives that — it is still in the file — and a new one exists nowhere else at all.
  check('a new diagram from the plus waits for the host and keeps the drawing when nothing was written', () => {
    const read = (expression) => vm.runInContext(expression, booted);
    const was = { source: read('currentDocumentSource'), send: booted.ipc.postMessage, toast: booted.leafToast };
    const note = '# Title\n\n\n';
    const sent = [];
    const said = [];
    // The empty line the plus stands on: nothing on it, nothing carrying a footnote's line, and its own range in the buffer.
    const emptyLine = () => {
      const line = fakeElement('flowInsertLineUnderTest');
      line.tagName = 'P';
      line.dataset = { srcStart: '9', srcEnd: '9' };
      return line;
    };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (message) => said.push(message);
      read(`currentDocumentSource = ${JSON.stringify(note)};`);

      // Drawn on a line the row will take. The write goes out with a token on it, and the sheet stays up: nothing is in the file yet.
      const line = emptyLine();
      booted.openBlockFlowSheet((chosen) => booted.runBlockInsert(line, chosen), { target: line });
      booted.saveFlowSheet();
      const refused = sent.filter((one) => one.command === 'editBlock');
      if (refused.length !== 1) throw new Error(`the new-diagram Save sent ${JSON.stringify(sent)}`);
      if (typeof refused[0].token !== 'number') {
        throw new Error(`it sent no token, so nothing can answer it: ${JSON.stringify(refused[0])}`);
      }
      if (!refused[0].text.startsWith('```mermaid\n')) throw new Error(`it wrote ${JSON.stringify(refused[0].text)}`);
      if (!read('!!flowSession')) throw new Error('the sheet closed on the dispatch, before the host had written anything');
      if (said.length) throw new Error(`a Save still waiting said ${JSON.stringify(said)}`);

      // The host could not write it. The drawing stays on screen to be copied out of, with the reason beside it.
      const why = 'watch.md was not changed: the file could not be read.';
      booted.leafEditAnswered(refused[0].token, false, why);
      if (!read('!!flowSession')) throw new Error('a refused Save closed the sheet over the only copy of the drawing');
      if (said.length !== 1 || said[0] !== why) throw new Error(`it said ${JSON.stringify(said)}`);

      // And the host wrote it: that one closes the sheet.
      sent.length = 0;
      said.length = 0;
      booted.saveFlowSheet();
      const landed = sent.filter((one) => one.command === 'editBlock');
      if (landed.length !== 1) throw new Error(`the second Save sent ${JSON.stringify(sent)}`);
      if (landed[0].token === refused[0].token) throw new Error('two Saves shared one token');
      if (!read('!!flowSession')) throw new Error('the sheet closed before the answer arrived');
      booted.leafEditAnswered(landed[0].token, true, null);
      if (read('!!flowSession')) throw new Error('a Save the host wrote left the sheet open');
      if (said.length) throw new Error(`a Save that landed said ${JSON.stringify(said)}`);

      // The other way the drawing was lost: a line the row will not write onto. Nothing goes out, and the sheet has to say so rather than close over a drawing the host was never even asked about.
      sent.length = 0;
      said.length = 0;
      const says = emptyLine();
      says.textContent = 'A paragraph.';
      booted.openBlockFlowSheet((chosen) => booted.runBlockInsert(says, chosen), { target: says });
      booted.saveFlowSheet();
      if (sent.filter((one) => one.command === 'editBlock').length) {
        throw new Error(`the plus wrote over a line that says something: ${JSON.stringify(sent)}`);
      }
      if (said.length !== 1 || !said[0].includes('nowhere left to save it')) {
        throw new Error(`it said ${JSON.stringify(said)}`);
      }
      if (!read('!!flowSession')) throw new Error('a Save that wrote nothing closed the sheet over the drawing');
    } finally {
      read('flowSession = null;');
      read(`currentDocumentSource = ${JSON.stringify(was.source)};`);
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.__frames.drain();
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
  const sheetHolder = (page = booted) => (page.document.head.children || []).find((child) => child.id === 'leaf-mermaid-sheets');
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
    // A page of its own, because every animation the page has ever been shown is kept for the life of it — so a run of this on a page another check has drawn into is asking whether the animation arrives at all, not whether it arrives once.
    const page = runShell(source);
    const { shareMermaidSheet, forgetMermaidSheets } = page;
    forgetMermaidSheets();
    shareMermaidSheet(standInDrawing('mermaid-3', flowchartSheet('mermaid-3')));
    // A different kind of diagram: its own sheet, the same animation inside it.
    shareMermaidSheet(standInDrawing('mermaid-4', `#mermaid-4 .pieCircle{stroke:#333;}@keyframes dash{to{stroke-dashoffset:0;}}`));
    const sheet = sheetHolder(page);
    const written = sheet.textContent.split('@keyframes dash').length - 1;
    if (written !== 1) throw new Error(`the animation was written ${written} times`);
    if (sheet.textContent.includes('@keyframes dash{to{stroke-dashoffset:0;}}#')) {
      throw new Error('the animation was left inside a sheet rather than lifted out of it');
    }
  });

  // Every rule in there paints the theme it was drawn in, so a reader trying six themes would otherwise end with six sets of rules in the page and five of them dead. The animations stay — they carry no color — and a drawing restored out of the picture memo can still put its own sheet back, which is what a theme left and come back to needs.
  check('the page-level sheet is emptied when the theme changes', () => {
    // Its own page for the same reason as the check above: what a theme change leaves behind is the animations, and a page already holding them cannot show that they were kept.
    const page = runShell(source);
    const { shareMermaidSheet, forgetMermaidSheets, ensureMermaidSheets } = page;
    forgetMermaidSheets();
    const drawing = standInDrawing('mermaid-5', flowchartSheet('mermaid-5'));
    shareMermaidSheet(drawing);
    const cls = drawing.worn().find((name) => name.startsWith('lt-mmd-'));
    const sheet = sheetHolder(page);
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

  // The complaint this whole subject exists to answer: a diagram scrolled three screens past that comes back to an empty box makes a document of diagrams read twice a document of blanks. It stays drawn — everywhere the memos can remember it, which is at or under their cap. Past that they empty wholesale, a box put back would be redrawn from scratch, and a page holding every drawing gives up a whole second in one frame; there, and only there, the empty box stands.
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

  // ---- taking a diagram out of the page --------------------------------------
  //
  // The chip in a diagram's own corner is a reader's way to the two exports, which a shut padlock and a flowchart-only editor otherwise keep. So what is driven below is the page's own builder and the page's own menu, never the helpers under them.

  // An element that answers only for what has really been put in it. The stand-in page answers every element query with an element, which would tell the builder its row was already there — so a stage the page itself built gets this too, before it is handed back to the builder.
  const answeringForItsOwnChildren = (node) => {
    const wearing = (one, name) => String(one.className || '').split(/\s+/).includes(name);
    const findIn = (one, name) => {
      for (const child of one.children) {
        if (wearing(child, name)) return child;
        const deeper = findIn(child, name);
        if (deeper) return deeper;
      }
      return null;
    };
    node.querySelector = (selector) => findIn(node, String(selector).replace(/^\./, ''));
    node.__find = (name) => findIn(node, name);
    return node;
  };

  const drawnDiagram = (source, page = booted) => {
    const block = page.document.createElement('pre');
    block.className = 'mermaid';
    block.__mermaidSource = source;
    return answeringForItsOwnChildren(block);
  };

  // The walk up from the button, which the stand-in cannot do: the page asks the chip what block it is in and whether it is inside the full-window view. Its corner is put 2000px out, so where the menu lands says whether it was clamped.
  const exportChipOn = (block) => {
    const chip = block.__find('mermaid-export');
    if (!chip) throw new Error('the diagram carries no export button');
    chip.closest = (selector) => (String(selector) === 'pre.mermaid' ? block : null);
    chip.getBoundingClientRect = () => ({ left: 2000, top: 40, right: 2028, bottom: 68, width: 28, height: 28 });
    return chip;
  };

  const exportMenuOn = (host) => host.children.find((child) => String(child.className || '') === 'flow-menu');
  const exportRow = (host, label) => {
    const menu = exportMenuOn(host);
    if (!menu) throw new Error('no menu was opened');
    const row = menu.children.find((child) => (child.children[0] || {}).textContent === label);
    if (!row) throw new Error(`the menu has no ${label} row`);
    return row;
  };
  const press = (row) => (row.listeners.get('click') || []).forEach((handler) => handler());
  // Export asks where the file goes and draws nothing until the answer comes back, so choosing a format is answering the save window with a name that ends in it.
  const answerSaveWindow = (sent, ending) => {
    const ask = sent.filter((one) => one.command === 'pickDiagramPath').pop();
    if (!ask) throw new Error('Export asked nobody where the file goes, so no save window ever opened');
    booted.window.leafDiagramPathPicked(ask.token, '/out/diagram.' + ending);
  };
  // The press hands off to a chain of promises, so the check waits for it to reach an answer rather than for a number of turns somebody counted.
  const settle = async (answered, turns = 40) => {
    for (let at = 0; at < turns && !answered(); at += 1) await Promise.resolve();
  };

  check('a diagram on a locked page carries the export button and no editing buttons', () => {
    // The page boots locked, which is the state this whole subject exists for.
    if (booted.readerEditingAllowed()) throw new Error('the page under test was not locked');
    const block = drawnDiagram('flowchart TD\n  X1 --> X2');
    booted.addMermaidControls(block);
    const chip = block.__find('mermaid-export');
    if (!chip) throw new Error('a locked page lost the export button along with the editing pair');
    if (!String(chip.innerHTML).includes('lt-icon-export')) throw new Error('the export button wears no icon');
    if (block.__find('mermaid-tools')) throw new Error('the editing pair came through the padlock');
    const row = block.__find('mermaid-view-controls');
    if (!row) throw new Error('the top-right controls are not one row');
    // Export first: its own rounded control, left of the segmented four.
    if (row.children[0] !== chip || !String(row.children[1].className).includes('mermaid-zoom')) {
      throw new Error('the export chip is not left of the zoom group');
    }
    if (row.children[1].children.length !== 4) throw new Error('the four view buttons did not stay one group');
    // Built once, however many times the page redraws around it.
    booted.addMermaidControls(block);
    if (block.children.filter((child) => String(child.className).includes('mermaid-view-controls')).length !== 1) {
      throw new Error('a second pass built the row all over again');
    }
  });

  // Neither export reads a flowchart model — mermaid is handed a string — so the kinds that could never open in the editor at all are the ones this reaches first.
  check('a pie chart and a sequence diagram each carry the export button', () => {
    for (const source of ['pie title Pets\n  "Dogs" : 6\n  "Cats" : 4', 'sequenceDiagram\n  A->>B: hello']) {
      const block = drawnDiagram(source);
      booted.addMermaidControls(block);
      if (!block.__find('mermaid-export')) throw new Error(`a ${source.split(/\s/)[0]} diagram was left with no way out`);
    }
  });

  // The sheet a diagram is printed on. The shipped paper class does the opposite of what this needs on its own — it computes the full-window diagram to `display: none` and grows the surface to the whole document — so a print under it alone would be the note with the drawing missing. The cascade is what decides this and the stand-in page has none, so the rule is read off the stylesheet the way the other CSS checks here are.
  check('a printed diagram is the only thing left on the sheet', () => {
    if (!booted.document.getElementById('diagramPrint')) throw new Error('the page has no container to print a diagram in');
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    // Anchored at the start of a line, so a rule under a wider selector cannot answer for one keyed on the container itself.
    const rule = (selector, paint) => css.includes('\n' + selector + ' {' + '\n' + '  ' + paint + ';');
    if (!rule('.diagram-print', 'display: none')) throw new Error('the print container is not out of the layout until an export fills it');
    if (!rule('body.leaf-paper-diagram .diagram-print', 'display: block')) throw new Error('the print state does not put the container on the sheet');
    if (!rule('body.leaf-paper-diagram .app-surface > :not(.diagram-print)', 'display: none')) throw new Error('the print state leaves the rest of the app on the sheet');
  });

  check('on Windows a diagram asks where it goes and opens nothing over the page', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      const block = drawnDiagram('flowchart TD\n  K1 --> K2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      // On Windows the save window carries the three formats in its own dropdown, so a menu here would be the same question asked twice. The check below boots a Mac, where that dropdown does not exist and the menu is the only place the question is ever put.
      if (exportMenuOn(surface)) throw new Error('on Windows Export opened a menu over the page, where the save window is already asking');
      const asked = sent.filter((one) => one.command === 'pickDiagramPath');
      if (asked.length !== 1) throw new Error(`pressing Export asked ${asked.length} times where the file goes`);
      if (!(asked[0].token > 0)) throw new Error(`the ask carried no export to answer: ${JSON.stringify(asked[0])}`);
      // Nobody was asked, so the window is handed no answer and keeps every row in its dropdown.
      if ('format' in asked[0]) throw new Error(`on Windows the ask named ${asked[0].format}, which takes the other two out of the dropdown`);
      // Nothing is drawn before the answer: that is what stops two pictures nobody asked for being made.
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a diagram was encoded before anybody said where it goes');
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // The one branch nothing in this suite had ever run: every page it boots reports its platform as `test`, so the Mac half of the export was unread. A page of its own is booted rather than the shared one repointed, because the platform is read once as the page loads into a value the fragments then share.
  check('on a Mac Export asks the format first, and the answer reaches the save window', () => {
    const mac = runShell(source, {
      navigator: { userAgent: 'leaf-check', platform: 'MacIntel', clipboard: { writeText: () => {} } },
    });
    const surface = mac.document.getElementById('appSurface');
    const sent = [];
    mac.ipc.postMessage = (text) => sent.push(JSON.parse(text));

    const block = drawnDiagram('flowchart TD\n  Q1 --> Q2', mac);
    mac.addMermaidControls(block);
    mac.openMermaidExportMenu(exportChipOn(block));

    const menu = exportMenuOn(surface);
    if (!menu) throw new Error('a Mac was handed a save window with no format in it and nothing asked beforehand');
    const rows = menu.children.map((child) => (child.children[0] || {}).textContent);
    if (String(rows) !== 'Markdown,PNG,WebP,PDF,JPEG') throw new Error(`the menu offers ${rows.join(', ') || 'nothing'}`);
    // Nothing is asked and nothing is drawn until a row is pressed: a save window opened here would be the second question.
    if (sent.length) throw new Error(`opening the menu already sent ${sent.map((one) => one.command).join(', ')}`);

    press(exportRow(surface, 'PNG'));
    if (exportMenuOn(surface)) throw new Error('the menu stayed open over the page after a format was picked');
    const asked = sent.filter((one) => one.command === 'pickDiagramPath');
    if (asked.length !== 1) throw new Error(`picking a format asked ${asked.length} times where the file goes`);
    if (asked[0].format !== 'png') throw new Error(`the save window was told ${JSON.stringify(asked[0].format)} rather than the format that was picked`);
    if (!(asked[0].token > 0)) throw new Error(`the ask carried no export to answer: ${JSON.stringify(asked[0])}`);
    // Still nothing drawn: the picture is made once the path comes back, which is what stops one nobody asked for.
    if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a diagram was encoded before anybody said where it goes');

    // The flowchart sheet's own Export is the third button and the second call site, and it drops its menu on the sheet rather than on the page under it.
    vm.runInContext('flowCode.value = "flowchart TD\\n  S1 --> S2"; flowSession = { text: flowCode.value };', mac);
    const sheetExport = mac.document.getElementById('flowSheetExport');
    (sheetExport.listeners.get('click') || []).forEach((handler) => handler());
    const sheet = mac.document.getElementById('flowSheet');
    if (!exportMenuOn(sheet)) throw new Error('the flowchart sheet’s Export opened no menu on a Mac');
    if (exportMenuOn(surface)) throw new Error('the sheet’s menu was put on the page under it');
    press(exportRow(sheet, 'WebP'));
    const fromSheet = sent.filter((one) => one.command === 'pickDiagramPath').pop();
    if (fromSheet.format !== 'webp') throw new Error(`the sheet asked for ${JSON.stringify(fromSheet.format)}`);

    // The menu is a suggestion, the typed name is the answer. A reader who picks one format and then types another ending gets what they typed — the format is never read back off the ask, so no second answer exists to reconcile with the path.
    mac.window.leafDiagramPathPicked(fromSheet.token, '/out/diagram.md');
    const written = sent.filter((one) => one.command === 'exportDiagram').pop();
    if (!written || written.format !== 'md') {
      throw new Error(`picking WebP and typing a name ending in md wrote ${JSON.stringify((written || {}).format) || 'nothing'}`);
    }
    if (written.path !== '/out/diagram.md') throw new Error(`the write carried ${JSON.stringify(written.path)} rather than the name the reader typed`);
  });

  // The other window that panel opens, and the same silence: the first Save of a note that has never had a file. The formats are handed in rather than written here, which is how the page is held to keeping none of its own — the host injects them off `src/format.rs`, and a sixth row appears because the table gained one.
  check('on a Mac the first Save of a new note asks the format first, and on Windows it does not', () => {
    const readable = [
      { label: 'Markdown', ext: 'md' },
      { label: 'XML', ext: 'xml' },
      { label: 'JSON', ext: 'json' },
      { label: 'YAML', ext: 'yaml' },
      { label: 'Email', ext: 'eml' },
    ];
    const jobs = [];
    const boot = (platform, formats) => {
      const page = runShell(source, {
        navigator: { userAgent: 'leaf-check', platform, clipboard: { writeText: () => {} } },
        // The save waits a turn for whatever is being typed to commit, and the stand-in page swallows a timer by default.
        setTimeout: (fn) => {
          jobs.push(fn);
          return 0;
        },
        __leafDocumentFormats: formats,
      });
      jobs.length = 0;
      const note = { title: 'Untitled', path: 'Untitled.md', dirty: true, undoable: false, redoable: false, untitled: true };
      vm.runInContext(`currentState = { recent: [], favorites: [], tabs: [${JSON.stringify(note)}], active: 0, document: null }; dirtyByPath.set('Untitled.md', true);`, page);
      const button = page.document.getElementById('saveButton');
      button.getBoundingClientRect = () => ({ left: 240, top: 8, right: 300, bottom: 36, width: 60, height: 28 });
      return { page, button };
    };
    const drain = () => {
      while (jobs.length) jobs.shift()();
    };

    const mac = boot('MacIntel', readable);
    const macSent = [];
    mac.page.ipc.postMessage = (text) => macSent.push(JSON.parse(text));
    (mac.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    const surface = mac.page.document.getElementById('appSurface');
    const menu = exportMenuOn(surface);
    if (!menu) throw new Error('a Mac was handed the Save Document As window with no format in it and nothing asked beforehand');
    const rows = menu.children.map((child) => (child.children[0] || {}).textContent);
    if (String(rows) !== String(readable.map((one) => one.label))) throw new Error(`the menu offers ${rows.join(', ') || 'nothing'}`);
    // A note cannot become a format nobody picked: nothing is written while the question stands.
    if (macSent.length) throw new Error(`opening the menu already sent ${macSent.map((one) => one.command).join(', ')}`);

    press(exportRow(surface, 'YAML'));
    drain();
    const saved = macSent.filter((one) => one.command === 'saveDocument');
    if (saved.length !== 1) throw new Error(`picking a format saved ${saved.length} times`);
    if (saved[0].format !== 'yaml') throw new Error(`the save window was told ${JSON.stringify(saved[0].format)} rather than the format that was picked`);

    // The rows are the host's list and nothing else: a table with a sixth format in it draws six.
    const sixth = boot('MacIntel', readable.concat([{ label: 'Rich text', ext: 'rtf' }]));
    sixth.page.ipc.postMessage = () => {};
    (sixth.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    const grown = exportMenuOn(sixth.page.document.getElementById('appSurface'));
    const grownRows = grown ? grown.children.map((child) => (child.children[0] || {}).textContent) : [];
    if (String(grownRows.slice(-1)) !== 'Rich text') throw new Error(`a format added to the app's table drew ${grownRows.join(', ') || 'nothing'}`);

    // Windows asks inside the window it opens, so the press writes straight through and nothing stands over the page.
    const win = boot('Win32', readable);
    const winSent = [];
    win.page.ipc.postMessage = (text) => winSent.push(JSON.parse(text));
    (win.button.listeners.get('click') || []).forEach((handler) => handler());
    drain();
    if (exportMenuOn(win.page.document.getElementById('appSurface'))) throw new Error('on Windows Save opened a menu over the page, where the window is already asking');
    const wrote = winSent.filter((one) => one.command === 'saveDocument');
    if (wrote.length !== 1) throw new Error(`on Windows Save sent ${winSent.map((one) => one.command).join(', ') || 'nothing'}`);
    if ('format' in wrote[0]) throw new Error(`on Windows the save named ${wrote[0].format}, which takes the other four out of the dropdown`);
  });

  check('an ending the app does not write is refused, and nothing is', () => {
    const wasSend = booted.ipc.postMessage;
    const wasToast = booted.leafToast;
    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    try {
      const block = drawnDiagram('flowchart TD\n  K3 --> K4');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(sent, 'svg');
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a name ending in svg was written as some format nobody asked for');
      if (said.length !== 1) throw new Error(`it said ${said.join(' / ') || 'nothing'}`);
      // The refusal names the three it does write, so the reader knows what to type instead.
      if (!/Markdown/.test(said[0]) || !/PNG/.test(said[0]) || !/WebP/.test(said[0])) {
        throw new Error(`the refusal left the reader nowhere to go: ${said[0]}`);
      }

      // A second answer to an export already spent is ignored: the window is gone and the source with it.
      const ask = sent.filter((one) => one.command === 'pickDiagramPath').pop();
      booted.window.leafDiagramPathPicked(ask.token, '/out/diagram.md');
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('an answer to a finished export wrote a file anyway');
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.leafToast = wasToast;
    }
  });

  // Every spelling of Markdown the app opens is one this window writes: refusing `.markdown` in the sentence that offers Markdown reads as the app not knowing its own format.
  check('a name ending in any spelling of Markdown is written, not refused', () => {
    for (const ending of ['md', 'markdown', 'mdown']) {
      const wasSend = booted.ipc.postMessage;
      const wasToast = booted.leafToast;
      const sent = [];
      const said = [];
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafToast = (words) => said.push(words);
      try {
        const block = drawnDiagram('flowchart TD\n  M1 --> M2');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(sent, ending);
        if (said.length) throw new Error(`a name ending in ${ending} was refused: ${said.join(' / ')}`);
        const wrote = sent.filter((one) => one.command === 'exportDiagram');
        if (wrote.length !== 1) throw new Error(`a name ending in ${ending} wrote ${wrote.length} files`);
        // The row's own id, whichever spelling the reader typed: the host is asked one format and writes the mermaid text under it.
        if (wrote[0].format !== 'md') throw new Error(`a name ending in ${ending} sent ${JSON.stringify(wrote[0].format)} rather than md`);
        if (!String(wrote[0].data).includes('M1 --> M2')) throw new Error(`what went out under ${ending} is not the diagram: ${JSON.stringify(wrote[0].data)}`);
        if (wrote[0].path !== '/out/diagram.' + ending) throw new Error(`the file went somewhere other than the name the reader typed: ${wrote[0].path}`);
      } finally {
        booted.ipc.postMessage = wasSend;
        booted.leafToast = wasToast;
      }
    }
  });

  check('a menu given a host is clamped inside it, and the editor keeps the sheet', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasRect = surface.getBoundingClientRect;
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 });
    const rows = [{ label: 'Duplicate', run: () => {} }, { label: 'Detach', run: () => {} }];
    try {
      // Not the reader, which is the scrolling box: a menu hung inside it is cut off at its edge.
      booted.openFlowMenuWith(2000, 40, rows, surface);
      const menu = exportMenuOn(surface);
      if (!menu) throw new Error('a menu given the app surface was not put on it');
      if (menu.style.left !== '892px') throw new Error(`the menu sits at ${menu.style.left} rather than clamped inside the surface`);
      booted.closeFlowMenu();

      // The editor asks for no host and keeps the one it always had.
      booted.openFlowMenuWith(10, 10, rows);
      const sheet = booted.document.getElementById('flowSheet');
      if (!exportMenuOn(sheet)) throw new Error('the flowchart canvas’s own menu left the sheet');
      if (exportMenuOn(surface)) throw new Error('the canvas’s menu was put on the page instead');
    } finally {
      booted.closeFlowMenu();
      surface.getBoundingClientRect = wasRect;
    }
  });

  check('Markdown sends the block’s own text in a mermaid fence', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      const first = drawnDiagram('flowchart TD\n  M1 --> M2');
      booted.addMermaidControls(first);
      booted.openMermaidExportMenu(exportChipOn(first));
      answerSaveWindow(sent, 'md');
      const written = sent.filter((one) => one.command === 'exportDiagram');
      if (written.length !== 1 || written[0].format !== 'md') {
        throw new Error(`naming a file .md sent ${sent.map((one) => one.command).join(', ') || 'nothing'}`);
      }
      if (written[0].data !== '```mermaid\nflowchart TD\n  M1 --> M2\n```\n') {
        throw new Error(`the file would hold ${JSON.stringify(written[0].data)}`);
      }
      // The path the reader chose travels with the bytes, so the host opens no second window.
      if (written[0].path !== '/out/diagram.md') throw new Error(`the write carried ${JSON.stringify(written[0].path)} rather than the name the reader gave`);

      // The second diagram in the page exports its own text, not the first one's: the chip holds nothing, and the source is read off the block it was pressed on.
      const second = drawnDiagram('sequenceDiagram\n  M3->>M4: hello');
      booted.addMermaidControls(second);
      booted.openMermaidExportMenu(exportChipOn(second));
      answerSaveWindow(sent, 'md');
      const both = sent.filter((one) => one.command === 'exportDiagram');
      if (both.length !== 2 || !both[1].data.includes('M3->>M4')) {
        throw new Error('the second diagram exported the first one’s text');
      }
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // The picture checks all lend the same globals — a canvas, an `Image`, `btoa` — so they run one after another. `checkSettled` starts every body at once, and two of these interleaved leave each one reading the other's window.
  let pictureQueue = Promise.resolve();
  const checkPicture = (name, run) => {
    const mine = pictureQueue.then(run);
    // Each waits for the one before to finish either way, and still reports its own failure as its own.
    pictureQueue = mine.catch(() => {});
    checkSettled(name, () => mine);
  };

  // A window that can draw one, which is where the three picture rows part: PNG hands the host raw pixels to encode, WebP and JPEG hand it a file the canvas already wrote. The stand-in page has no canvas at all, so one is lent for the length of the check.
  const withCanvas = (answer) => {
    const original = booted.document.createElement;
    const was = { send: booted.ipc.postMessage, toast: booted.leafToast, drawing: booted.diagramDrawingSvg, image: booted.Image, btoa: booted.btoa };
    const sent = [];
    const said = [];
    // Every encode the canvas was asked for, so a row refused before it reached one is told apart from a row that encoded and threw.
    const asked = [];
    // Only the export, because a check running beside this one reports its own faults down the same pipe.
    booted.ipc.postMessage = (text) => {
      const one = JSON.parse(text);
      if (one.command === 'exportDiagram' || one.command === 'pickDiagramPath') sent.push(one);
    };
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async () => '<svg viewBox="0 0 200 100"></svg>';
    booted.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
    booted.Image = class {
      set src(unused) {
        this.naturalWidth = answer.wide || 200;
        this.naturalHeight = 100;
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };
    booted.document.createElement = (tag) => {
      const made = original.call(booted.document, tag);
      if (String(tag).toLowerCase() === 'canvas') {
        made.getContext = () => ({
          fillRect: () => {},
          drawImage: () => {},
          // Four bytes, one white pixel: what the PNG row reads off the canvas.
          getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
        });
        // A real canvas asked for a type it cannot write answers a PNG, which is the case the type check exists for. The type asked for is honored otherwise, so a row that sent the wrong one is caught here rather than in a file somebody opens.
        made.toDataURL = (type, quality) => {
          asked.push({ type: String(type), quality });
          if (answer.cannotWrite) return 'data:image/png;base64,UE5H';
          // The first bytes of a real JPEG, so what the page forwards can be read as one rather than taken on trust.
          if (String(type) === 'image/jpeg') return 'data:image/jpeg;base64,/9j/4AAQ';
          return 'data:image/webp;base64,V0VCUA==';
        };
      }
      return made;
    };
    return {
      sent,
      said,
      asked,
      done: () => {
        booted.closeFlowMenu();
        booted.document.createElement = original;
        booted.ipc.postMessage = was.send;
        booted.leafToast = was.toast;
        booted.diagramDrawingSvg = was.drawing;
        booted.Image = was.image;
        booted.btoa = was.btoa;
      },
    };
  };

  checkPicture('the ending the reader chose is the one encoded, and WebP sends a finished file where PNG sends pixels', async () => {
    const lent = withCanvas({});
    const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
    try {
      const block = drawnDiagram('flowchart TD\n  W1 --> W2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'webp');
      await settle(() => written().length || lent.said.length);
      if (lent.said.length) throw new Error(`WebP refused: ${lent.said.join(' / ')}`);
      const webp = written()[0];
      if (!webp || webp.format !== 'webp') throw new Error(`a name ending in webp sent ${JSON.stringify(webp) || 'nothing'}`);
      // The file itself, not pixels for the host to encode — which is the whole of why WebP is cheaper than PNG.
      if (webp.data !== 'V0VCUA==') throw new Error(`WebP sent ${JSON.stringify(webp.data)} rather than the canvas's own bytes`);
      if (webp.width || webp.height) throw new Error('a finished file was sent with pixel dimensions beside it');

      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'png');
      await settle(() => written().length > 1 || lent.said.length);
      const png = written()[1];
      if (!png || png.format !== 'png') throw new Error(`a name ending in png sent ${JSON.stringify(png) || 'nothing'}`);
      if (png.data !== '/////w==' || png.width !== 400 || png.height !== 200) {
        throw new Error(`PNG sent ${JSON.stringify(png.data)} at ${png.width}×${png.height} rather than pixels at twice life size`);
      }
      // One picture per export, never all three: nothing is drawn until the window has answered.
      if (written().length !== 2) throw new Error(`two exports made ${written().length} files`);
    } finally {
      lent.done();
    }
  });

  // v1.24.0 measured it: a fifty-step left-to-right flowchart is 16,872 pixels across at export size, so this is a diagram somebody draws rather than a guard against the absurd. The canvas answers an empty URL rather than throwing, so a row that did not check would save a six-byte file.
  checkPicture('a drawing too big for WebP is refused out loud, and a window that cannot write one says so instead', async () => {
    for (const [answer, expected] of [[{ wide: 9000 }, /too big/i], [{ cannotWrite: true }, /cannot write WebP/i]]) {
      const lent = withCanvas(answer);
      const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
      try {
        const block = drawnDiagram('flowchart LR\n  W3 --> W4');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(lent.sent, 'webp');
        await settle(() => written().length || lent.said.length);
        if (written().length) throw new Error('a refused WebP asked for a file anyway');
        if (lent.said.length !== 1 || !expected.test(lent.said[0])) throw new Error(`it said ${lent.said.join(' / ') || 'nothing'}`);
        // Both refusals point at the row that can still write the drawing.
        if (!/PNG/.test(lent.said[0])) throw new Error(`the refusal left the reader nowhere to go: ${lent.said[0]}`);
      } finally {
        lent.done();
      }
    }
  });

  // What has to hold is that the file really is a JPEG, at the quality the page names, and that both spellings of the ending reach it.
  checkPicture('a JPEG goes out as a finished JPEG, at the quality the page names, under either spelling of the ending', async () => {
    for (const ending of ['jpg', 'jpeg']) {
      const lent = withCanvas({});
      const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
      try {
        const block = drawnDiagram('flowchart TD\n  J1 --> J2');
        booted.addMermaidControls(block);
        booted.openMermaidExportMenu(exportChipOn(block));
        answerSaveWindow(lent.sent, ending);
        await settle(() => written().length || lent.said.length);
        if (lent.said.length) throw new Error(`a name ending in ${ending} was refused: ${lent.said.join(' / ')}`);
        const jpeg = written()[0];
        if (!jpeg || jpeg.format !== 'jpg') throw new Error(`a name ending in ${ending} sent ${JSON.stringify((jpeg || {}).format) || 'nothing'} rather than jpg`);
        // The file itself, forwarded byte for byte: the host writes what the canvas wrote, exactly as it does for WebP.
        const bytes = Buffer.from(jpeg.data, 'base64');
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error(`what went out does not start like a JPEG: ${JSON.stringify(jpeg.data)}`);
        if (jpeg.width || jpeg.height) throw new Error('a finished file was sent with pixel dimensions beside it');
        const encode = lent.asked.filter((one) => one.type === 'image/jpeg');
        if (encode.length !== 1) throw new Error(`the canvas was asked for a JPEG ${encode.length} times`);
        // Written down rather than inherited, so a web view update cannot move every exported diagram quietly.
        if (encode[0].quality !== 0.92) throw new Error(`the JPEG was asked for at ${encode[0].quality} rather than the quality the page names`);
      } finally {
        lent.done();
      }
    }
  });

  // Past 65,535 pixels a side a canvas answers an empty URL rather than throwing, which is the trap the WebP guard was written for. With no guard of its own the type check catches it and says this window cannot write JPEG, which is the wrong thing to tell a reader.
  checkPicture('a drawing too big for JPEG is refused before anything is encoded, and points at the row that can still write it', async () => {
    const lent = withCanvas({ wide: 40000 });
    const written = () => lent.sent.filter((one) => one.command === 'exportDiagram');
    try {
      const block = drawnDiagram('flowchart LR\n  J3 --> J4');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'jpg');
      await settle(() => written().length || lent.said.length);
      if (written().length) throw new Error('a refused JPEG asked for a file anyway');
      if (lent.asked.length) throw new Error('the drawing was encoded before the size was refused, which is the work the guard exists to skip');
      if (lent.said.length !== 1 || !/too big/i.test(lent.said[0])) throw new Error(`it said ${lent.said.join(' / ') || 'nothing'}`);
      if (!/PNG/.test(lent.said[0])) throw new Error(`the refusal left the reader nowhere to go: ${lent.said[0]}`);
    } finally {
      lent.done();
    }
  });

  // This window has no canvas, which is the branch the refusal is written for, so what is held is that it refuses out loud and writes nothing — a row failing quietly leaves a reader waiting on a Save dialog that never opens. The drawing step stands in: everything after it is what is under test.
  checkPicture('the picture refuses in a toast when the window cannot draw one, and sends nothing', async () => {
    const surface = booted.document.getElementById('appSurface');
    const was = {
      send: booted.ipc.postMessage,
      toast: booted.leafToast,
      drawing: booted.diagramDrawingSvg,
      image: booted.Image,
      btoa: booted.btoa,
    };
    const sent = [];
    const said = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async () => '<svg viewBox="0 0 200 100"></svg>';
    booted.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
    // The markup loads as a picture, so the refusal below is the canvas and nothing before it.
    booted.Image = class {
      set src(unused) {
        this.naturalWidth = 200;
        this.naturalHeight = 100;
        Promise.resolve().then(() => this.onload && this.onload());
      }
    };
    try {
      const block = drawnDiagram('flowchart TD\n  N1 --> N2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(sent, 'png');
      await settle(() => said.length || sent.some((one) => one.command === 'exportDiagram'));
      if (sent.some((one) => one.command === 'exportDiagram')) throw new Error('a window that cannot draw a picture asked for a file anyway');
      if (said.length !== 1 || !/picture/i.test(said[0])) throw new Error(`it said ${said.join(' / ') || 'nothing'}`);
    } finally {
      booted.ipc.postMessage = was.send;
      booted.leafToast = was.toast;
      booted.diagramDrawingSvg = was.drawing;
      booted.Image = was.image;
      booted.btoa = was.btoa;
    }
  });

  // A PDF is the one row nothing in the page encodes: the drawing goes into a box of its own, the sheet state takes the rest of the app off the page, and the host renders it. The size is the half that is easy to get wrong — measured in a running copy, a container holding a 268-wide drawing reports 1,864, which is the surface's width, and a sheet made to that comes out window-wide with the drawing stranded in white.
  const withPrintedDiagram = (drawingBox) => {
    const container = booted.document.getElementById('diagramPrint');
    if (!container) throw new Error('the page has no container to print a diagram in');
    const was = { send: booted.ipc.postMessage, toast: booted.leafToast, drawing: booted.diagramDrawingSvg, hold: booted.window.leafHoldAppearance, child: Object.getOwnPropertyDescriptor(container, 'firstElementChild') };
    const sent = [];
    const said = [];
    const held = [];
    const asked = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.leafToast = (words) => said.push(words);
    booted.diagramDrawingSvg = async (source) => {
      asked.push(source);
      return '<svg width="' + drawingBox.width + '" height="' + drawingBox.height + '"></svg>';
    };
    booted.window.leafHoldAppearance = (on) => held.push(on);
    // The container is as wide as the surface under the paper rules, which is exactly the box that must not be the one measured. The drawing inside it says its own size.
    container.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1864, bottom: 0, width: 1864, height: 0 });
    const drawn = booted.document.createElement('svg');
    drawn.getBoundingClientRect = () => ({ top: 0, left: 0, right: drawingBox.width, bottom: drawingBox.height, width: drawingBox.width, height: drawingBox.height });
    Object.defineProperty(container, 'firstElementChild', { get: () => (container.innerHTML ? drawn : null), configurable: true });
    return {
      sent,
      said,
      held,
      asked,
      container,
      printed: () => sent.filter((one) => one.command === 'printDiagramPdf'),
      wearing: () => booted.document.body.classList.contains('leaf-paper-diagram'),
      done: () => {
        booted.closeFlowMenu();
        booted.window.leafDiagramPrinted();
        booted.ipc.postMessage = was.send;
        booted.leafToast = was.toast;
        booted.diagramDrawingSvg = was.drawing;
        booted.window.leafHoldAppearance = was.hold;
        if (was.child) Object.defineProperty(container, 'firstElementChild', was.child);
      },
    };
  };

  checkPicture('a PDF prints the drawing on a sheet of its own, at the drawing’s size and not the box around it', async () => {
    const lent = withPrintedDiagram({ width: 268, height: 108 });
    try {
      const block = drawnDiagram('flowchart TD\n  P1 --> P2');
      booted.addMermaidControls(block);
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'pdf');
      await settle(() => lent.printed().length || lent.said.length);
      if (lent.said.length) throw new Error(`the PDF refused: ${lent.said.join(' / ')}`);
      const print = lent.printed()[0];
      if (!print) throw new Error('a name ending in pdf asked for no print at all');
      // Nothing the page could have made: a PDF is rendered, so the row that carries bytes must never be the one that runs.
      if (lent.sent.some((one) => one.command === 'exportDiagram')) throw new Error('a PDF went out as bytes the page made, which is a .pdf full of something else');
      if (print.path !== '/out/diagram.pdf') throw new Error(`the print carried ${JSON.stringify(print.path)} rather than the name the reader gave`);
      if (print.width !== 268 || print.height !== 108) throw new Error(`the sheet was asked for at ${print.width}×${print.height} rather than the drawing's own 268×108`);
      if (!lent.container.innerHTML) throw new Error('the drawing was never put anywhere the render could reach it');
      if (!lent.wearing()) throw new Error('the sheet state was never raised, so the print would be the whole document with a drawing on the end of it');
      if (String(lent.held) !== 'true') throw new Error(`the appearance was held ${lent.held.length} times: ${lent.held.join(', ') || 'never'}`);

      // The host has answered. The page is the reader's document again however the print went — a state left on is a window holding a bare drawing.
      booted.window.leafDiagramPrinted();
      if (lent.wearing()) throw new Error('the sheet state stayed on after the host answered');
      if (lent.container.innerHTML) throw new Error('the print container kept the drawing after the host answered');
      if (String(lent.held) !== 'true,false') throw new Error(`the appearance hold was not let go exactly once: ${lent.held.join(', ')}`);
      booted.window.leafDiagramPrinted();
      if (String(lent.held) !== 'true,false') throw new Error(`a second answer let the appearance hold go twice: ${lent.held.join(', ')}`);
    } finally {
      lent.done();
    }
  });

  // The three rows that ship all draw the diagram again on purpose, and the PDF has the most to lose by not: a zoomed diagram is absolutely placed inside a box of fixed height, so what is on screen is cropped to that box and a sheet made to it prints the piece somebody happened to be looking at.
  checkPicture('a zoomed and dragged diagram still prints the whole drawing', async () => {
    const lent = withPrintedDiagram({ width: 268, height: 108 });
    try {
      const block = drawnDiagram('flowchart TD\n  Z1 --> Z2');
      booted.addMermaidControls(block);
      // What a reader has zoomed and dragged: pinned to a box of fixed height, with the drawing translated inside it.
      block.classList.add('is-moved');
      block.getBoundingClientRect = () => ({ top: 0, left: 0, right: 900, bottom: 420, width: 900, height: 420 });
      booted.openMermaidExportMenu(exportChipOn(block));
      answerSaveWindow(lent.sent, 'pdf');
      await settle(() => lent.printed().length || lent.said.length);
      const print = lent.printed()[0];
      if (!print) throw new Error('a name ending in pdf asked for no print at all');
      if (lent.asked.length !== 1 || !lent.asked[0].includes('Z1 --> Z2')) throw new Error('the print did not draw the diagram again from its own text');
      if (print.width !== 268 || print.height !== 108) throw new Error(`the sheet took the zoomed block's ${print.width}×${print.height} rather than the fresh drawing's 268×108`);
    } finally {
      lent.done();
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
    if (!good.children.some((child) => child.className === 'mermaid-view-controls')) throw new Error('a diagram that drew fine got no toolbar');
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
      // The drawing the card just made, measured to see whether it is still wide enough to read at the size it fits. Mermaid's own, in a block mermaid drew.
      "const drawing = block.querySelector('svg');",
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

  // The same corner as the page's, minus the fourth view button — a diagram already on the whole window has nothing to expand into — and its menu belongs to the overlay rather than to the surface underneath it, which is what keeps it above the drawing.
  check('the full-window view carries the export button and no fifth view button', () => {
    const overlay = booted.document.createElement('div');
    overlay.className = 'diagram-overlay';
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
    const block = drawnDiagram('flowchart TD\n  F1 --> F2');
    overlay.__diagramBlock = block;

    const stage = drawnDiagram('flowchart TD\n  F1 --> F2');
    stage.className = 'mermaid diagram-stage';
    overlay.appendChild(stage);
    booted.addDiagramStageControls(stage);

    const row = stage.__find('mermaid-view-controls');
    if (!row) throw new Error('the full-window view has no controls row');
    const chip = row.children[0];
    if (!String(chip.className).includes('mermaid-export')) throw new Error('the export chip is not first in the row');
    const zoom = row.children[1];
    if (!String(zoom.className).includes('mermaid-zoom')) throw new Error('the zoom group did not follow the chip');
    if (zoom.children.length !== 3) throw new Error(`the full-window view carries ${zoom.children.length} view buttons`);
    // The X is the one thing further right, and it is put in first so the row lands left of it.
    if (stage.children.indexOf(row) < stage.children.indexOf(stage.__find('diagram-close'))) {
      throw new Error('the row was put in ahead of the close cross');
    }
    // Built once, so a redraw of the stage does not stack a second row on it.
    booted.addDiagramStageControls(stage);
    if (stage.children.filter((child) => String(child.className).includes('mermaid-view-controls')).length !== 1) {
      throw new Error('drawing the stage again built the row all over again');
    }

    chip.closest = (selector) => (String(selector) === '.diagram-overlay' ? overlay : null);
    chip.getBoundingClientRect = () => ({ left: 700, top: 40, right: 728, bottom: 68, width: 28, height: 28 });
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    try {
      booted.openMermaidExportMenu(chip);
      // The overlay's Export asks where the file goes like every other one, and on Windows puts nothing over the drawing it is showing.
      const asked = sent.filter((one) => one.command === 'pickDiagramPath');
      if (asked.length !== 1) throw new Error(`the full-window Export asked ${asked.length} times where the file goes`);
      const surface = booted.document.getElementById('appSurface');
      if (overlay.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('on Windows the full-window Export opened a menu over the drawing');
      }
      if (surface.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('on Windows the full-window Export opened a menu on the surface under the overlay');
      }
    } finally {
      booted.ipc.postMessage = wasSend;
    }
  });

  // Every way out is pressed on the element that carries it, over a diagram of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it. Each exit gets a fresh overlay, because the first close takes the overlay and its dim off the page.
  check('the full-window diagram opens over a diagram of its own, wears its open state, and every way out takes it back down', () => {
    const app = booted.document.getElementById('app');
    const read = (expression) => vm.runInContext(expression, booted);
    const wasQuery = app.querySelector;
    const was = {
      format: read('currentDocumentFormat'),
      unlocked: read('readingUnlocked'),
      sourceEdit: booted.startBlockSourceEdit,
      blockSheet: booted.openMermaidBlockSheet,
    };
    const held = app.children.slice();
    const opener = fakeElement('checkedDiagramOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    let current = null;
    const openOnce = () => {
      standing = null;
      const block = drawnDiagram('flowchart TD\n  V1 --> V2');
      // The place in the file the corner pair acts on. Without it the pair is not built, and neither handoff has anything to give the document back with.
      block.dataset.srcStart = '0';
      block.dataset.srcEnd = '32';
      booted.openDiagramOverlay(block, opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('diagram-overlay')) || null;
      const scrim = fresh.find((child) => wornBy(child) === 'lt-backdrop') || null;
      if (!standing || !scrim) throw new Error(`opening the full-window diagram put ${fresh.length} new things on the page`);
      const stage = answeringForItsOwnChildren(standing.children[0]);
      if (!wornBy(stage).includes('diagram-stage')) throw new Error('the overlay opened holding nothing to draw on');
      if (stage.__mermaidSource !== block.__mermaidSource) throw new Error('the stage is not a picture of the diagram it was opened from');
      // The open state rides on a frame the page asks for, so an overlay born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the overlay and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the overlay or its dim shut');
      }
      // The runtime never lands in the stand-in head, so the draw's promise stays pending and the controls that ride on it never arrive. They go in here, which is where the draw would have put them.
      booted.addDiagramStageControls(stage);
      current = { overlay: standing, scrim, stage, block };
      return current;
    };
    const press = (element, event = {}) => (element.listeners.get('click') || []).forEach((handler) => handler(event));
    // Raised on the document's own list rather than called by name: the fragment binds it at load, and a handler nothing ever registered would pass a call.
    const escape = () => {
      const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
      for (const handler of booted.document.listeners.get('keydown') || []) handler(event);
    };
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    // Where each tool button hands the document, and whether the overlay was still standing when it got there: both destinations put something over the page the overlay would otherwise be covering.
    let handedOff = null;
    const recordHandoff = (which) => (block) => {
      handedOff = { which, block, overlayStanding: !gone(current.overlay, current.scrim) };
    };
    const pressTool = (stage, which) => {
      const tools = stage.__find('mermaid-tools');
      if (!tools) throw new Error('the full-window diagram carries no pair of buttons to give the document back with');
      const button = tools.children.find((child) => child.dataset.mermaidTool === which);
      if (!button) throw new Error(`the pair has no ${which} button`);
      // The row is what is listened to, and it asks the press which button it was: a walk up the stand-in cannot do.
      button.closest = (selector) => (String(selector) === '.mermaid-tool' ? button : null);
      press(tools, { target: button, preventDefault() {}, stopPropagation() {} });
    };
    try {
      app.querySelector = (selector) => (String(selector) === '.diagram-overlay' ? standing : wasQuery.call(app, selector));
      // The two conditions the corner pair is built under, so the same open can be pressed either way.
      read('currentDocumentFormat = \'markdown\'; readingUnlocked = true;');
      booted.startBlockSourceEdit = recordHandoff('source');
      booted.openMermaidBlockSheet = recordHandoff('sheet');

      const first = openOnce();
      const cross = first.stage.__find('diagram-close');
      if (!cross) throw new Error('the drawn stage carries no close cross');
      press(cross);
      if (!gone(first.overlay, first.scrim)) throw new Error('the close cross left the overlay or its dim standing on the page');

      const second = openOnce();
      press(second.scrim);
      if (!gone(second.overlay, second.scrim)) throw new Error('a press on the overlay’s own dim left it standing on the page');

      const third = openOnce();
      escape();
      if (!gone(third.overlay, third.scrim)) throw new Error('Escape on the document left the overlay or its dim standing on the page');

      // Both buttons are one listener with two handoffs, so each is pressed on an overlay of its own and read for where it went.
      for (const which of ['source', 'sheet']) {
        const naming = which === 'source' ? 'the button for the diagram’s own text' : 'the button for the flowchart editor';
        const open = openOnce();
        handedOff = null;
        pressTool(open.stage, which);
        if (!gone(open.overlay, open.scrim)) throw new Error(`${naming} left the overlay or its dim standing on the page`);
        if (!handedOff) throw new Error(`${naming} took the overlay down and gave the document to nothing`);
        if (handedOff.which !== which) throw new Error(`${naming} gave the document to the other one`);
        if (handedOff.block !== open.block) throw new Error(`${naming} gave on the stage rather than the block it is a picture of`);
        if (handedOff.overlayStanding) throw new Error(`${naming} opened over an overlay that was still standing`);
      }
    } finally {
      app.querySelector = wasQuery;
      booted.startBlockSourceEdit = was.sourceEdit;
      booted.openMermaidBlockSheet = was.blockSheet;
      read(`currentDocumentFormat = ${JSON.stringify(was.format)}; readingUnlocked = ${JSON.stringify(was.unlocked)};`);
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
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
    // The copy takes the room the sheet has, never its content's, and only `anywhere` shrinks a column — `break-word` reads as the fix and never enters a column's smallest width.
    const sheetRule = (selector) => {
      const opened = css.indexOf(`${selector} {`);
      if (opened < 0) throw new Error(`no rule for ${selector} in the full-window table`);
      return css.slice(opened, css.indexOf('}', opened));
    };
    const copied = sheetRule('.table-sheet-grid > table');
    for (const rule of ['width: fit-content;', 'max-width: 100%;']) {
      if (!copied.includes(rule)) throw new Error(`the full-window table no longer fits the room the sheet has: ${rule}`);
    }
    if (/max-width:\s*none|width:\s*max-content/.test(copied)) {
      throw new Error('the full-window table asks for its content width again, so one long cell pushes the later columns past the right edge');
    }
    const bodyCells = css.match(/(?<!,\n)\.table-sheet-grid td \{([^}]*)\}/);
    if (!bodyCells || !/overflow-wrap:\s*anywhere;/.test(bodyCells[1])) {
      throw new Error('the full-window table body cells no longer break anywhere, so an unbreakable run still widens its column past the sheet');
    }
    // Breaking anywhere is what drops a body cell's smallest width to one character, so without the floor a column headed by a short word stops at that heading.
    if (!/min-width:\s*7ch;/.test(bodyCells[1])) {
      throw new Error('the full-window table has no floor under its narrowest column, so a three-letter cell under a three-letter heading draws on two lines');
    }
    // On a heading it lets a column fall under one word, and a "Ref" column comes out reading "R / ef".
    const everyCell = css.match(/\.table-sheet-grid th,\s*\n\.table-sheet-grid td \{([^}]*)\}/);
    if (!everyCell || /overflow-wrap/.test(everyCell[1])) {
      throw new Error('the full-window table headings break anywhere, so a short column falls under its own heading word');
    }
    if (/min-width/.test(everyCell[1])) {
      throw new Error('the floor sits on the full-window table headings too, so it widens a column that already reads correctly');
    }
    // The theme's link color and a glossary word's dotted underline are both written behind `.document-body`, so the copy reads as the web view's stock blue-purple until the grid holding it wears that class.
    const held = booted.tableSheetGrid({ cloneNode: () => ({ classList: { add() {} }, removeAttribute() {}, querySelectorAll: () => [] }) });
    const worn = String(held.className || '').split(/\s+/).filter(Boolean);
    for (const name of ['table-sheet-grid', 'document-body']) {
      if (!worn.includes(name)) throw new Error(`the full-window table's grid is not drawn as ${name}, so its links leave the theme`);
    }
    // What that class brings that the sheet is not: a document's reading measure, the negative margin hanging it off the scroll origin, and the page's text size the cells' own padding and floor are measured against.
    const gridRule = sheetRule('.table-sheet-grid');
    for (const rule of ['width: auto;', 'margin: 0;', 'font-size: inherit;', 'padding: var(--lt-space-16);', 'overflow: auto;']) {
      if (!gridRule.includes(rule)) throw new Error(`the full-window table's grid took a document's own shape: ${rule}`);
    }
    // The document hands a table its own scroll box, which would take the sideways wheel off the grid, and a gap under it the sheet's padding already gives.
    for (const rule of ['margin: 0;', 'overflow: visible;']) {
      if (!copied.includes(rule)) throw new Error(`the copied table kept a document rule the sheet cannot carry: ${rule}`);
    }
  });

  // A plan's table is mostly links, and the copy on the whole window sits beside the document rather than inside it — so a click the delegated handler does not claim is the web view's, and the re-render a finished load brings rewrites `#app` with the table in it. That made every link a trap in the one place a wide table reads.
  check('a link in the full-window table is the app’s to follow, and a term rises without taking the table down', () => {
    const { bindDocumentLinks } = booted;
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasContains = app.contains;
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    const wasIpc = booted.ipc;
    const posted = [];
    // The binding is once-per-page, so a run where a render already did it would leave nothing to raise.
    const wasBound = vm.runInContext('documentLinksBound', booted);
    vm.runInContext('documentLinksBound = false;', booted);
    const WATCHED = ['click', 'auxclick', 'mousedown'];
    const before = new Map(WATCHED.map((type) => [type, (app.listeners.get(type) || []).length]));
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    // A link in the copy: inside the overlay and inside no document body, which is the whole difference from a link in the page.
    const inCopy = (written) => {
      const link = {
        getAttribute: (name) => (name === 'href' ? written : null),
        closest: (selector) =>
          selector === '.table-sheet-overlay' ? overlay : selector === '.document-body' ? null : link,
      };
      return link;
    };
    let canceled = 0;
    const clickOn = (link, held = {}) => {
      posted.length = 0;
      removed = false;
      for (const handler of (app.listeners.get('click') || []).slice(before.get('click'))) {
        handler({
          target: link,
          button: 0,
          defaultPrevented: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          preventDefault() {
            canceled += 1;
          },
          ...held,
        });
      }
      return posted.slice();
    };
    try {
      booted.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
      app.contains = () => true;
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);
      bindDocumentLinks();

      const term = clickOn(inCopy('glossary:vault'));
      if (!canceled) throw new Error('a click in the table copy was left for the web view to follow');
      if (!term.some((one) => one.command === 'openGlossary' && one.href === 'glossary:vault')) {
        throw new Error(`a glossary word in the table copy sent ${JSON.stringify(term)}`);
      }
      if (removed) throw new Error('the term the reader asked for took the table down with it');
      booted.dismissGlossary();

      const page = clickOn(inCopy('../two.md'));
      if (!page.some((one) => one.command === 'openLink' && one.href === '../two.md')) {
        throw new Error(`a page link in the table copy sent ${JSON.stringify(page)}`);
      }
      if (!removed) throw new Error('the table stayed up over a document it no longer belongs to');

      // A jump inside this document scrolls a page nobody can see under the sheet, so it leaves too.
      const within = clickOn(inCopy('#how-it-ranks'));
      if (!within.some((one) => one.command === 'openLink')) throw new Error('a jump inside the document sent nothing');
      if (!removed) throw new Error('the table stayed up over a jump nobody could watch land');

      // Held, the reader chose to stay where they are, so the table stays with them.
      const behind = clickOn(inCopy('../two.md'), booted.isMacPlatform ? { metaKey: true } : { ctrlKey: true });
      if (!behind.some((one) => one.command === 'openLink' && one.newPage)) {
        throw new Error(`a link opened behind sent ${JSON.stringify(behind)}`);
      }
      if (removed) throw new Error('a page opened behind still took the table the reader stayed on');
    } finally {
      booted.ipc = wasIpc;
      app.contains = wasContains;
      app.querySelector = wasQuery;
      glossarySheet.hidden = wasHidden;
      for (const type of WATCHED) {
        const held = app.listeners.get(type);
        if (held) held.length = before.get(type);
      }
      vm.runInContext(`documentLinksBound = ${wasBound ? 'true' : 'false'};`, booted);
    }
  });

  // The sheet is rendered outside `#app`, so the draw pass never collects a diagram in an entry and one stays undrawn for as long as the sheet is open. The stylesheet holds it to a strip instead, and that rule keys on a `pre.mermaid` inside `.glossary-sheet-body`, which is the pair this check builds by opening the sheet on a real entry.
  check('a glossary entry carrying a drawing puts the block the strip rule keys on inside the sheet', () => {
    const sheet = booted.document.getElementById('glossarySheet');
    const body = booted.document.getElementById('glossarySheetBody');
    const wasHidden = sheet.hidden;
    const wasBody = body.innerHTML;
    // One block per element, so a clone can be that block parsed again rather than a node shared with the page it came from.
    const blocks = [
      '<h2 id="a-term">A term</h2>',
      '<p>What it means.</p>',
      '<pre class="mermaid" data-language="mermaid">flowchart TD A --&gt; B</pre>',
      '<p>And it reads on.</p>',
      '<h2 id="the-next-term">The next term</h2>',
      '<p>Not this one.</p>',
    ];
    const html = blocks.join('');
    const parsed = booted.document.createElement('div');
    parsed.innerHTML = html;
    // The stand-in page has neither of these and the entry walker uses both: it clones the heading, then every block after it until the next heading of the same rank.
    parsed.children.forEach((el, i) => {
      el.cloneNode = () => {
        const one = booted.document.createElement('div');
        one.innerHTML = blocks[i];
        return one.children[0];
      };
      el.nextElementSibling = parsed.children[i + 1] || null;
    });
    try {
      booted.__glossaryProbeRoot = parsed;
      booted.__glossaryProbeHtml = html;
      vm.runInContext('glossaryParsedRoot = __glossaryProbeRoot; glossaryParsedHtml = __glossaryProbeHtml; glossaryWaiting = true;', booted);
      booted.leafShowGlossary(html, 'a-term');

      if (!body.classList.contains('glossary-sheet-body') || !body.classList.contains('document-body')) {
        throw new Error('the sheet body no longer wears both classes the undrawn block is styled through');
      }
      const drawn = body.querySelectorAll('pre.mermaid');
      if (drawn.length !== 1) throw new Error(`the entry put ${drawn.length} diagram blocks in the sheet`);
      // The corner word is the whole of what the strip still says, so a block reaching the sheet without it is a strip with nothing in it.
      if (drawn[0].dataset.language !== 'mermaid') throw new Error('the block in the sheet carries no corner word');
      if (!body.textContent.includes('And it reads on.')) throw new Error('the entry stopped at the drawing rather than reading on past it');
      if (body.textContent.includes('Not this one.')) throw new Error('the entry ran on into the next term');
    } finally {
      vm.runInContext('glossaryParsedRoot = null; glossaryParsedHtml = null; glossaryWaiting = false;', booted);
      delete booted.__glossaryProbeRoot;
      delete booted.__glossaryProbeHtml;
      body.innerHTML = wasBody;
      sheet.hidden = wasHidden;
      sheet.classList.remove('open');
    }
  });

  // The table sheet hears Escape on the document in the capture phase and the term's own Escape waits in the bubble phase, so the key closed the table underneath and left the term standing over the bare document.
  check('Escape over the term closes the term and leaves the full-window table where it was', () => {
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    let stopped = 0;
    const escape = () => ({
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {
        stopped += 1;
      },
    });
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);

      glossarySheet.hidden = false;
      booted.onTableSheetKey(escape());
      if (removed) throw new Error('Escape closed the table under the term standing over it');
      if (stopped) throw new Error('the table sheet swallowed the key the term was waiting for');

      glossarySheet.hidden = true;
      booted.onTableSheetKey(escape());
      if (!removed) throw new Error('Escape no longer closes the full-window table on its own');
      if (!stopped) throw new Error('the table sheet stopped claiming the key it answers');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.hidden = wasHidden;
    }
  });

  // The term is the app's one sheet that can stand on another, and its scrim was painted at the layer every first scrim takes — so over the full-window table it dimmed nothing and the press that closes it landed on the table underneath.
  check('the term’s dim falls over the full-window table, and a press on it closes the term', () => {
    const scrim = layerOf('#glossaryBackdrop');
    if (!(scrim > layerOf('.table-sheet-overlay'))) {
      throw new Error('the term’s dim is painted under the full-window table, so the table stands at full brightness and a press outside the term lands on it');
    }
    if (!(layerOf('.glossary-sheet') > scrim)) throw new Error('the term sits under its own dim');

    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const glossaryBackdrop = booted.document.getElementById('glossaryBackdrop');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);
      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      const pressed = glossaryBackdrop.listeners.get('click') || [];
      if (!pressed.length) throw new Error('nothing hears a press on the term’s dim');
      for (const handler of pressed) handler({});
      if (glossarySheet.classList.contains('open')) throw new Error('a press on the term’s dim left the term standing');
      if (removed) throw new Error('a press on the term’s dim took the table down with it');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.classList.remove('open');
      glossarySheet.hidden = wasHidden;
    }
  });

  // A term is only ever raised from a word inside the table, so a table closing under it left it standing over an ordinary page with no way back to what it came from.
  check('closing the full-window table takes a raised term with it, and closing the term leaves the table', () => {
    const app = booted.document.getElementById('app');
    const glossarySheet = booted.document.getElementById('glossarySheet');
    const wasQuery = app.querySelector;
    const wasHidden = glossarySheet.hidden;
    let removed = false;
    const overlay = {
      remove: () => {
        removed = true;
      },
      __tableSheetOpener: null,
      __tableSheetScrim: null,
    };
    try {
      app.querySelector = (selector) =>
        String(selector) === '.table-sheet-overlay' ? overlay : wasQuery.call(app, selector);

      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      booted.closeTableSheet();
      if (!removed) throw new Error('the full-window table no longer closes');
      if (glossarySheet.classList.contains('open')) throw new Error('closing the table left the term standing over a page it never came from');

      // The other direction, which is what shipped: the term goes and the table it was raised from stays where it was.
      removed = false;
      glossarySheet.hidden = false;
      glossarySheet.classList.add('open');
      booted.dismissGlossary();
      if (glossarySheet.classList.contains('open')) throw new Error('the term no longer closes on its own');
      if (removed) throw new Error('closing the term took the table it was raised from down with it');
    } finally {
      app.querySelector = wasQuery;
      glossarySheet.classList.remove('open');
      glossarySheet.hidden = wasHidden;
    }

    // The key's own path, read as text: it is fired for real above, and this holds it to the one close rather than to a second copy of the removal.
    const fragment = readFileSync(join(root, 'src/assets/shell/table-sheet.js'), 'utf8');
    const key = fragment.slice(fragment.indexOf('function onTableSheetKey('));
    if (!key.includes('closeTableSheet()')) throw new Error('the key closes the full-window table by some other path than the one close');
    if (!fragment.includes('dismissGlossary();')) throw new Error('closing the full-window table says nothing about the term raised from it');
  });

  // Both ways out are pressed on the elements that carry them, over a table of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it.
  check('the full-window table opens over a table of its own, wears its open state, and both ways out take it back down', () => {
    const app = booted.document.getElementById('app');
    const wasQuery = app.querySelector;
    const held = app.children.slice();
    // Safe to open: nothing the serializer refuses, and a real header row to key the pipes off. The laid-out page it would be copied out of is the one thing the check has no version of, so the copy is a stand-in too.
    const standInTable = () => {
      const table = fakeElement('checkedTable');
      table.tagName = 'TABLE';
      table.querySelector = (selector) => (String(selector) === ':scope > thead > tr > th' ? fakeElement('checkedTableHeading') : null);
      table.cloneNode = () => fakeElement('checkedTableCopy');
      return table;
    };
    const opener = fakeElement('checkedTableOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    const openOnce = () => {
      standing = null;
      booted.openTableSheet(standInTable(), opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('table-sheet-overlay')) || null;
      return { fresh, scrim: fresh.find((child) => wornBy(child) === 'lt-backdrop') || null };
    };
    const press = (element) => (element.listeners.get('click') || []).forEach((handler) => handler({}));
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    try {
      app.querySelector = (selector) => (String(selector) === '.table-sheet-overlay' ? standing : wasQuery.call(app, selector));
      const first = openOnce();
      if (!standing || !first.scrim) throw new Error(`opening the full-window table put ${first.fresh.length} new things on the page`);
      const [head, grid] = standing.children;
      if (!wornBy(head).includes('table-sheet-head')) throw new Error('the sheet opened with no header row');
      if (!wornBy(grid).includes('table-sheet-grid')) throw new Error('the sheet opened holding no copy of the table');
      const [title, cross] = head.children;
      if (title.textContent !== 'Table') throw new Error(`the sheet is titled ${JSON.stringify(title.textContent)}`);
      if (!wornBy(cross).includes('table-sheet-close')) throw new Error('the header carries no close cross');
      // The open state rides on a frame the page asks for, so a sheet born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the sheet and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !first.scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the sheet or its dim shut');
      }
      press(cross);
      if (!gone(standing, first.scrim)) throw new Error('the close cross left the sheet or its dim standing on the page');

      const second = openOnce();
      if (!standing || !second.scrim) throw new Error('the table would not open a second time');
      booted.__frames.drain();
      press(second.scrim);
      if (!gone(standing, second.scrim)) throw new Error('a press on the sheet’s own dim left it standing on the page');
    } finally {
      app.querySelector = wasQuery;
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
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
    if (!rule.includes('var(--reader-lane-inset)')) {
      throw new Error('the lane no longer keeps the block controls their strip');
    }
    const declared = css.match(/--reader-lane-inset:\s*(\d+)px/);
    if (!declared) throw new Error('--reader-lane-inset is not declared');
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
    if (!place.includes(".closest('.table-lane, .image-lane')")) {
      throw new Error('the drag handle is anchored to the text measure, so it sits on a widened table');
    }
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWideTables();')) throw new Error('nothing calls laneWideTables on a render');
  });

  // A box that folds in the flow wears `folds` and slides to its new height, so the mark and the rule are held to each other here: only the two together make it move, and a box that loses the mark snaps open with every other check still green.
  check('both boxes that fold in place wear the mark the stylesheet slides', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    if (!css.includes('@supports (interpolate-size: allow-keywords) {') || !css.includes('  .folds {')) {
      throw new Error('the shared folding rule is gone, so the mark below moves nothing');
    }
    const shell = readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
    if (!/id="findReplaceRow"/.test(shell) || !/class="[^"]*\bfolds\b[^"]*"[^>]*id="findReplaceRow"/.test(shell)) {
      throw new Error('the find bar\'s Replace row lost the mark, so it jumps open again');
    }
    const gutter = readFileSync(join(root, 'src/assets/shell/block-controls.js'), 'utf8');
    if (!/class="block-insert-row[^"]*\bfolds\b/.test(gutter)) {
      throw new Error('the gutter\'s insert row lost the mark, so its options appear in one frame');
    }
  });

  // The picture half of the same lane, and the one thing about it that cannot be read off the stylesheet: which paragraphs get the mark. CSS counts elements and never text, so the shapes below are exactly what a `:has(> img:only-child)` selector would have got wrong.
  check('only a paragraph holding one picture and no words is widened to the lane', () => {
    const paragraph = (children, text = '') => {
      const block = fakeElement('p');
      block.tagName = 'P';
      // The text first, then the children it holds: writing text empties an element here, as it does on a real page.
      block.textContent = text;
      block.children = children;
      return block;
    };
    const picture = () => {
      const img = fakeElement('img');
      img.tagName = 'IMG';
      return img;
    };
    const opener = fakeElement('button');
    opener.tagName = 'BUTTON';
    const missing = picture();
    missing.dataset = { imageMissing: 'true' };
    const gone = paragraph([missing], '\n');
    const alone = paragraph([picture()], '\n  ');
    const sentence = paragraph([picture()], 'watch this ');
    const two = paragraph([picture(), picture()]);
    const words = paragraph([], 'an ordinary paragraph');
    // A picture already carrying the whole-window opener: the mark has to survive a second pass, or the button would un-widen the picture it sits on.
    const opened = paragraph([picture(), opener], '\n');
    const table = fakeElement('table');
    table.tagName = 'TABLE';
    const body = fakeElement('body');
    body.children = [alone, sentence, two, words, opened, gone, table];
    booted.laneWidePictures({ querySelector: (selector) => (selector === '.document-body' ? body : null) });
    for (const [name, block, expected] of [
      ['a picture alone', alone, true],
      ['a picture in a sentence', sentence, false],
      ['two pictures', two, false],
      ['a paragraph of words', words, false],
      ['a picture already carrying its opener', opened, true],
      ['a picture marked as missing', gone, false],
      ['a table', table, false],
    ]) {
      if (block.classList.contains('image-lane') !== expected) {
        throw new Error(`${name} was ${expected ? 'not ' : ''}widened to the lane`);
      }
    }
  });

  // Its width rule, read as text: none of it is reachable without a laid-out page, and every way it breaks is silent — a picture back at the text measure, a small one stretched to the lane, or one grown past the strip the block controls need.
  check('a widened picture takes the lane and a small one keeps its own size', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const opened = css.indexOf('.document-body > p.image-lane {');
    if (opened < 0) throw new Error('no rule widens a picture to the reader lane');
    const rule = css.slice(opened, css.indexOf('}', opened));
    // `max-content` is the picture's own size: a block box at `auto` would fill the measure, and a `max-width` alone can cap a width but never grant one.
    if (!/width:\s*max-content/.test(rule)) throw new Error('the paragraph no longer sizes to the picture in it');
    if (!rule.includes('max-width: max(100%, calc(100cqi - 2 * var(--reader-lane-inset)))')) {
      throw new Error('a widened picture no longer stops at the lane, less the block controls their strip');
    }
    if (!/transform:\s*translateX\(-50%\)/.test(rule) || !/left:\s*50%/.test(rule)) {
      throw new Error('the widened picture is no longer centered on its own width');
    }
    // The cap that keeps a small picture small, and a big one inside whatever the paragraph was given.
    const image = css.slice(css.indexOf('.document-body img {'), css.indexOf('}', css.indexOf('.document-body img {')));
    if (!/max-width:\s*100%/.test(image)) throw new Error('a picture is no longer capped at what holds it');
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (!render.includes('laneWidePictures();')) throw new Error('nothing calls laneWidePictures on a render');
  });

  // The one place in the app where the hover wash sits on something other than the page. It is a 16% tint over transparent, so a rule that hands it the whole background takes the control's own surface away — beside a table that reads as a tint on the page and is nearly invisible, and over a picture it is a see-through square with the picture showing through it.
  check('the pointer never takes a corner opener s surface away', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const at = css.indexOf('.table-sheet-open:hover,');
    if (at < 0) throw new Error('the two corner openers no longer share one hover rule');
    const rule = css.slice(at, css.indexOf('}', at));
    if (!rule.includes('.image-sheet-open:hover')) throw new Error('the picture opener no longer shares the table opener s hover');
    const fill = /background:\s*([^;]+);/.exec(rule);
    if (!fill) throw new Error('the corner opener paints nothing under the pointer');
    if (!fill[1].includes('var(--lt-surface-elevated)')) {
      throw new Error('the wash replaces the opener s own surface, so a picture shows through the control');
    }
    if (!fill[1].includes('var(--lt-wash-hover)')) throw new Error('the corner opener answers the pointer with something other than the one wash');
    // And the surface it is painted over is the one the button rests on, or the hover is a different color from the button.
    const rest = css.slice(css.indexOf('.table-sheet-open,\n.image-sheet-open {'), css.indexOf('.table-sheet-open .lt-icon'));
    if (!rest.includes('background: var(--lt-surface-elevated);')) {
      throw new Error('the opener no longer rests on the surface its hover is painted over');
    }
  });

  // The full-window picture is a reader and nothing else: it shows an element the page already holds, so no route from opening or closing it reaches the document buffer, and none of it needs a host.
  check('a full-window picture is safe to open and can never write', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/image-sheet.js'), 'utf8');
    for (const part of ['function bindImageSheet(', 'function openImageSheet(', 'function closeImageSheet()', 'leafFocusForKeyboard(opener)']) {
      if (!fragment.includes(part)) throw new Error(`the picture sheet lost: ${part}`);
    }
    if (/\b(?:send|sendEditCommand|ipc\.postMessage)\b/.test(fragment)) {
      throw new Error('opening or closing the picture sheet can still reach the document buffer');
    }
    // The element's live source, never a copy taken earlier: a local picture's address carries a per-render token, so a stale one shows the file as it was before it changed on disk.
    if (!fragment.includes('picture.currentSrc || picture.src')) {
      throw new Error('the full-window picture no longer reads the element it was opened from');
    }
    // No header, no title, no words on the glass — the one full-window view without a panel.
    if (/textContent\s*=/.test(fragment) || fragment.includes('createElement(\'header\')')) {
      throw new Error('the full-window picture grew words of its own');
    }
    // Opening is reading, so the padlock is never asked; a marked missing picture has nothing behind the mark to show.
    if (/readerEditingAllowed|documentLocked/.test(fragment)) {
      throw new Error('opening a picture now waits on the padlock, and opening is reading');
    }
    if ((fragment.match(/imageMissing === 'true'/g) || []).length < 2) {
      throw new Error('a marked missing picture can reach the full-window view, or still gets an opener');
    }
    const lib = readFileSync(join(root, 'src/lib.rs'), 'utf8');
    const decorate = lib.indexOf('assets/shell/decorate.js');
    const imageSheet = lib.indexOf('assets/shell/image-sheet.js');
    if (imageSheet < decorate) throw new Error('the picture sheet loads before the paragraph it hangs an opener on is marked');
    const render = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (render.indexOf('bindImageSheet();') < render.indexOf('laneWidePictures();')) {
      throw new Error('the opener is bound before the paragraphs it looks for are marked');
    }
  });

  // All four ways out are pressed on the elements that carry them, over a picture of the check's own: a binding matched as a line of text passes whether or not anything ever reaches it.
  check('the full-window picture opens over a picture of its own, wears its open state, and all four ways out take it back down', () => {
    const app = booted.document.getElementById('app');
    const wasQuery = app.querySelector;
    const held = app.children.slice();
    // The whole of what the builder reads off the element it is opened from: no missing mark, a word for the label, an address for the source.
    const standInPicture = () => Object.assign(fakeElement('checkedPicture'), { tagName: 'IMG', dataset: {}, alt: 'A checked picture', currentSrc: 'leaf-asset://checked.png' });
    const opener = fakeElement('checkedPictureOpener');
    const wornBy = (child) => String((child && child.className) || '');
    // The page's class list holds only what the shipped markup declares, so an overlay the open just built is not in it — the one query that finds it is pointed at what landed on the page, the way the checks above point it.
    let standing = null;
    const openOnce = () => {
      standing = null;
      booted.openImageSheet(standInPicture(), opener);
      const fresh = app.children.filter((child) => !held.includes(child));
      standing = fresh.find((child) => wornBy(child).includes('image-sheet-overlay')) || null;
      const scrim = fresh.find((child) => wornBy(child) === 'lt-backdrop') || null;
      if (!standing || !scrim) throw new Error(`opening the full-window picture put ${fresh.length} new things on the page`);
      const [shown, corner] = standing.children;
      // The open state rides on a frame the page asks for, so a sheet born open could never be seen arriving.
      if (standing.classList.contains('open')) throw new Error('the sheet and its dim were built already open');
      booted.__frames.drain();
      if (!standing.classList.contains('open') || !scrim.classList.contains('open')) {
        throw new Error('the frame the page asked for left the sheet or its dim shut');
      }
      return { overlay: standing, scrim, shown, corner };
    };
    const press = (element, event = {}) => (element.listeners.get('click') || []).forEach((handler) => handler(event));
    // Raised on the document's own list rather than called by name: the fragment binds it at load, and a handler nothing ever registered would pass a call.
    const escape = () => {
      const event = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
      for (const handler of booted.document.listeners.get('keydown') || []) handler(event);
    };
    const gone = (...leaving) => leaving.every((one) => !app.children.includes(one));
    try {
      app.querySelector = (selector) => (String(selector) === '.image-sheet-overlay' ? standing : wasQuery.call(app, selector));
      const first = openOnce();
      if (wornBy(first.shown) !== 'image-sheet-picture') throw new Error('the sheet opened holding no picture');
      if (first.shown.src !== 'leaf-asset://checked.png') throw new Error(`the sheet shows ${JSON.stringify(first.shown.src)} rather than the address the element itself carries`);
      if (first.shown.alt !== 'A checked picture') throw new Error('the shown picture lost the word the element was labeled with');
      const cross = first.corner.children[0];
      if (!wornBy(cross).includes('image-sheet-close')) throw new Error('the corner carries no close cross');
      press(cross);
      if (!gone(first.overlay, first.scrim)) throw new Error('the close cross left the sheet or its dim standing on the page');

      const second = openOnce();
      press(second.scrim);
      if (!gone(second.overlay, second.scrim)) throw new Error('a press on the sheet’s own dim left it standing on the page');

      // The glass is the ground the scrim shows through, so the listener closes on anything whose target is not the picture — which makes the press on the picture the one that carries the claim: without it, a listener that closed on every press would pass.
      const third = openOnce();
      press(third.overlay, { target: third.shown });
      if (gone(third.overlay, third.scrim)) throw new Error('a press on the picture itself took the sheet down');
      press(third.overlay, { target: third.corner });
      if (!gone(third.overlay, third.scrim)) throw new Error('a press on the glass beside the picture left the sheet standing on the page');

      const fourth = openOnce();
      escape();
      if (!gone(fourth.overlay, fourth.scrim)) throw new Error('Escape on the document left the sheet or its dim standing on the page');
    } finally {
      app.querySelector = wasQuery;
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });

  // Which pictures get an opener, run rather than read: a marked missing one is holding our glyph over a transparent pixel, so there is nothing behind it to open.
  check('a marked missing picture gets no opener', () => {
    const paragraph = (picture) => {
      const block = fakeElement('p');
      block.tagName = 'P';
      block.querySelector = (selector) => {
        if (selector === ':scope > img') return picture;
        if (selector === ':scope > .image-sheet-open') return block.children.find((child) => child.className === 'image-sheet-open') || null;
        return null;
      };
      return block;
    };
    const real = paragraph(Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: {} }));
    const missing = paragraph(Object.assign(fakeElement('img'), { tagName: 'IMG', dataset: { imageMissing: 'true' } }));
    const empty = paragraph(null);
    booted.bindImageSheet({ querySelectorAll: () => [real, missing, empty] });
    const openers = (block) => block.children.filter((child) => child.className === 'image-sheet-open').length;
    if (openers(real) !== 1) throw new Error('a picture did not get its opener');
    if (openers(missing)) throw new Error('a marked missing picture was given an opener');
    if (openers(empty)) throw new Error('a paragraph with no picture in it was given an opener');
    // Twice over the same page must not stack a second button on every picture.
    booted.bindImageSheet({ querySelectorAll: () => [real] });
    if (openers(real) !== 1) throw new Error('a second pass stacked another opener on the same picture');
    // The fetch fails after the page is decorated, so refusing at the bind is not enough on its own: the mark has to take back the lane and the opener the render already gave, and a picture that arrives later has to get both back.
    const decorate = readFileSync(join(root, 'src/assets/shell/decorate.js'), 'utf8');
    const mark = decorate.slice(decorate.indexOf('function markMissingImage'), decorate.indexOf('function restoreMissingImage'));
    for (const wanted of ["classList.remove('image-lane')", "':scope > .image-sheet-open'"]) {
      if (!mark.includes(wanted)) throw new Error(`the missing mark no longer takes back: ${wanted}`);
    }
    const refresh = decorate.slice(decorate.indexOf('window.leafRefreshImages'));
    if (!refresh.includes('laneWidePictures();') || !refresh.includes('bindImageSheet();')) {
      throw new Error('a picture that has arrived at last never gets its lane or its opener back');
    }
  });

  // The close mark is the only thing drawn over the picture, so it waits in a corner rather than on the glass: absent until the pointer comes for it, and reachable by keyboard, because Escape and the ground are the other two ways out.
  check('the close mark is hidden until its corner is pointed at', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const ruleBody = (selector) => {
      const at = css.indexOf(selector);
      if (at < 0) throw new Error(`no rule for ${selector}`);
      return css.slice(at, css.indexOf('}', at));
    };
    const mark = ruleBody('.image-sheet-close {');
    if (!/opacity:\s*0/.test(mark) || !/pointer-events:\s*none/.test(mark)) {
      throw new Error('the close mark is drawn over the picture before the pointer asks for it');
    }
    const shown = ruleBody('.image-sheet-corner:hover .image-sheet-close,');
    if (!/opacity:\s*1/.test(shown)) throw new Error('pointing at the corner no longer reveals the close mark');
    if (!css.includes('.image-sheet-close:focus-visible {') && !css.includes('.image-sheet-close:focus-visible,')) {
      throw new Error('the close mark cannot be reached by keyboard');
    }
    const corner = ruleBody('.image-sheet-corner {');
    if (!/position:\s*absolute/.test(corner) || !/top:\s*0/.test(corner) || !/right:\s*0/.test(corner)) {
      throw new Error('the close mark waits somewhere other than the overlay top right corner');
    }
    // Fitted whole: never cropped, and never drawn past its own size.
    const picture = ruleBody('.image-sheet-picture {');
    for (const declaration of ['max-width: 100%', 'max-height: 100%', 'width: auto', 'height: auto', 'object-fit: contain']) {
      if (!picture.includes(declaration)) throw new Error(`the full-window picture no longer fits whole: ${declaration}`);
    }
    // No surface of its own: the scrim behind is the ground, which is what makes a press outside the picture read as a press on it.
    const overlay = ruleBody('.image-sheet-overlay {');
    if (/\bbackground/.test(overlay) || /\bborder/.test(overlay)) {
      throw new Error('the full-window picture grew a panel, so the app is no longer the ground behind it');
    }
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
    // Its own page, because it moves the pane and the app bar's fold with it, and the shared one is read by every check after this.
    const page = runShell(source);
    const frames = page.__frames;
    const root = page.document.documentElement;
    const minimapWidth = () => root.style.getPropertyValue('--minimap-width');
    // A code character's width, so the ruler below answers a number the arithmetic can spend. Any width does; this is a monospace face at the size Monaco measures at.
    const RULER_CHAR = 8.4;
    // The width the guard holds back is measured off a ruler the page appends, and every rectangle the stand-in answers is zero wide — so with no ruler of its own this check reads an unwritten property whether the write was dropped or made, and passes with the guard lifted out of the file altogether. A ruler as wide as what is written into it is the whole of what makes the dropped write visible.
    const madeElement = page.document.createElement;
    page.document.createElement = (tag) => {
      const made = madeElement(tag);
      made.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, height: 0, width: String(made.textContent || '').length * RULER_CHAR });
      return made;
    };
    root.style.setProperty('--code-font', 'monospace');
    root.style.setProperty('--reader-gutter', '24px');
    page.document.getElementById('libraryShell').clientWidth = VIEW_WIDTH;
    root.style.removeProperty('--minimap-width');
    frames.drain();
    // The app's own toggle, never a class name typed in here: the names the guard reads belong to library.js, and a check spelling them itself goes on passing the day that fragment spells them differently.
    page.toggleLibrary();
    if (!page.libraryPaneIsMoving()) throw new Error('the toggle never armed the pane motion');
    // Arming settles whatever was running, and that settle asks for the width — so a held-back request is already standing here.
    frames.drain();
    if (minimapWidth()) throw new Error(`the rail took its width as the pane started moving: ${minimapWidth()}`);
    page.scheduleMinimapWidthSync();
    const ran = frames.drain();
    if (ran !== 1) throw new Error(`one request for the rail's width ran ${ran} frames`);
    if (minimapWidth()) throw new Error(`the rail took its width mid-motion: ${minimapWidth()}`);
    page.endLibraryMotion();
    // The frames the end asks for are the width and the bar's own refit beside it, and what proves the held-back write was taken is the width landing.
    if (!frames.drain()) throw new Error('the pane finishing its motion never asked for the width it held back');
    if (!/^[\d.]+px$/.test(minimapWidth())) throw new Error(`the pane stopped and the rail was left at ${minimapWidth() || 'nothing'}`);
  });
}

// ---- 3a2. the pane opens no narrower than the bar's left zone ---------------
//
// That zone is sized to the pane so the tab strip begins at the pane's edge, and floored at the buttons standing in it — so a pane that opens inside the floor leaves the tabs over the page with nothing pressed. That is where a Mac starts: the window's own three dots stand in the zone and take it past the 240px a pane opens at. Opening only, which is the whole shape of the fix: flooring the drag as well takes the narrow pane away from Windows, where nothing was ever wrong, so the drag's own range is checked here beside it.

/** The bar's left zone on each platform, read off the running app: the leaf, the library toggle and the two history arrows, plus a Mac's three window dots and the gap before them. */
const WINDOWS_LEAD = 187.33;
const MAC_LEAD = 247.33;

/** A booted page with the bar's left zone at `leadWidth` and a window with room for both a pane and a reader. */
function bootWithLead(leadWidth, settings = {}) {
  const context = runShell(source, { __leafLeadWidth: leadWidth, __leafSettings: settings });
  context.document.getElementById('libraryShell').clientWidth = VIEW_WIDTH;
  return context;
}

/** What the page last wrote as the pane's width: one var moves the pane, the tabs and the divider together. */
const railWidth = (context) => context.document.documentElement.style.getPropertyValue('--library-rail-width');

check('a pane opens on the edge of the bar left zone wherever that zone is the wider', () => {
  const mac = bootWithLead(MAC_LEAD);
  // Shut, then open: the width a toggle opens at is the one a reader meets after using the button.
  mac.toggleLibrary();
  mac.toggleLibrary();
  if (railWidth(mac) !== `${MAC_LEAD}px`) throw new Error(`a Mac opened its pane at ${railWidth(mac)}, inside its own window dots`);
  const windows = bootWithLead(WINDOWS_LEAD);
  windows.toggleLibrary();
  windows.toggleLibrary();
  if (railWidth(windows) !== '240px') throw new Error(`Windows opened its pane at ${railWidth(windows)} rather than the 240px it has always opened at`);
});

check('a pane left at the width it opens at is raised on the way back in, and a dragged one is not', () => {
  // A Mac that has been run before has 240 written down, so a rule that only moved the default would leave every existing Mac exactly where it was, with nothing to migrate it.
  const mac = bootWithLead(MAC_LEAD, { libraryWidth: 240 });
  mac.applyPaneLayout();
  if (railWidth(mac) !== `${MAC_LEAD}px`) throw new Error(`a saved width came back at ${railWidth(mac)}`);
  // A width a reader dragged to is theirs at any size, on either platform: raising it takes the narrow pane away one restart later.
  for (const [lead, platform] of [[WINDOWS_LEAD, 'Windows'], [MAC_LEAD, 'a Mac']]) {
    const context = bootWithLead(lead, { libraryWidth: 96 });
    context.applyPaneLayout();
    if (railWidth(context) !== '96px') throw new Error(`a 96px pane came back at ${railWidth(context)} on ${platform}`);
  }
});

check('a drag still reaches every width it reached before, and still snaps shut, and never takes the zone under its own buttons', () => {
  // Flooring the pane at the zone instead slams it shut while it is still a fifth of the window wide, so the drag's own range is held here. The zone underneath it is the other half: dragged inside the zone's own width, the zone holds at its buttons rather than following the pane down — which a Mac does not do on its own, drawing the tab strip over the leaf, the library button and both arrows instead.
  for (const [leadWidth, platform] of [[WINDOWS_LEAD, 'Windows'], [MAC_LEAD, 'a Mac']]) {
    const context = bootWithLead(leadWidth);
    const lead = context.document.querySelector('.app-bar-lead');
    const divider = context.document.getElementById('libraryDivider');
    const shell = context.document.getElementById('libraryShell');
    shell.getBoundingClientRect = () => ({ left: 0, top: 0, right: VIEW_WIDTH, bottom: VIEW_HEIGHT, width: VIEW_WIDTH, height: VIEW_HEIGHT });
    const pointer = (extra) => ({ pointerId: 7, button: 0, buttons: 1, clientY: 300, target: divider, preventDefault() {}, stopPropagation() {}, ...extra });
    // Every handler the page registered, in the order it registered them — the same walk the real page makes, so a drag here is a drag there.
    const raise = (type, event) => {
      for (const handler of [...(context.document.listeners.get(type) || [])]) handler(event);
    };
    for (const handler of [...(divider.listeners.get('pointerdown') || [])]) handler(pointer({ clientX: 247 }));
    raise('pointermove', pointer({ clientX: 96 }));
    context.__frames.drain();
    if (railWidth(context) !== '96px') throw new Error(`on ${platform} a pane dragged to 96px came to rest at ${railWidth(context)}`);
    // A number, never `fit-content`: the keyword is the one thing in the rule the two web views do not answer alike, and it is why a Mac gives the zone up.
    if (lead.style.minWidth !== `${leadWidth}px`) {
      throw new Error(`on ${platform} a pane dragged to 96px left the zone floored at ${lead.style.minWidth || 'nothing'} rather than its own ${leadWidth}px`);
    }
    // Past the snap: the pane closes, exactly as a drag to 40px always did.
    raise('pointermove', pointer({ clientX: 20 }));
    context.__frames.drain();
    if (railWidth(context) !== '0px') throw new Error(`on ${platform} a drag past the snap left the pane at ${railWidth(context)}`);
  }
});

check('the zone floor follows the buttons out of the bar and back in', () => {
  // One write is only enough because the floor is rewritten wherever the measurement behind it is thrown away. A fold takes two arrows out of the zone and the floor has to come down with them, or a narrow window keeps holding space for buttons that are in the chevron menu.
  const context = bootWithLead(MAC_LEAD, { libraryClosed: true });
  const lead = context.document.querySelector('.app-bar-lead');
  const bar = context.document.getElementById('appBar');
  const tabBar = context.document.getElementById('tabBar');
  const panel = context.document.getElementById('appOverflowPanel');
  // The fold leaves an open pane's zone whole, since folding out of a zone pinned to the rail frees nothing — so this is the closed bar, which is the only one that folds out of it.
  context.applyPaneLayout();
  const whole = lead.style.minWidth;
  if (whole !== `${MAC_LEAD}px`) throw new Error(`the zone booted floored at ${whole || 'nothing'} rather than its own ${MAC_LEAD}px`);
  // A bar that cannot fit, so the fold reaches past the trailing actions and into the zone's own arrows.
  tabBar.scrollWidth = 900;
  tabBar.clientWidth = 100;
  bar.scrollWidth = 900;
  bar.clientWidth = 100;
  context.refitAppBar();
  const folded = panel.children.map((el) => el.id);
  if (!folded.includes('backButton')) throw new Error(`the fold never reached the zone: it folded ${folded.join(',') || 'nothing'}`);
  if (!lead.style.minWidth || parseFloat(lead.style.minWidth) >= MAC_LEAD) {
    throw new Error(`two arrows folded out and the zone stayed floored at ${lead.style.minWidth || 'nothing'}`);
  }
  // And back: a widening window puts them where they were standing, and the floor with them.
  tabBar.scrollWidth = 0;
  tabBar.clientWidth = 900;
  bar.scrollWidth = 0;
  bar.clientWidth = 900;
  context.refitAppBar();
  if (lead.style.minWidth !== whole) throw new Error(`the arrows came back and the zone stayed floored at ${lead.style.minWidth || 'nothing'}`);
});

check('the open leaves the zone unmeasured, so the tab strip travels with the pane', () => {
  // The zone's own width is read by putting `width: auto` on it for one layout pass, and a width transition cannot start from `auto`. So the strip landed on its resting place on the very first frame while the page eased out and overshot past it, and the open tab's lower-left curve hung over the pane with daylight under it — the one motion a reader triggers by hand breaking at its most visible moment.
  const context = bootWithLead(MAC_LEAD, { libraryClosed: true });
  const lead = context.document.querySelector('.app-bar-lead');
  // Every width the zone is written, with whether the pane was moving when it was written — the claim is what the page did, not which branch it took.
  const written = [];
  let held = lead.style.width;
  Object.defineProperty(lead.style, 'width', {
    get: () => held,
    set: (value) => {
      held = value;
      written.push({ value, moving: context.libraryPaneIsMoving() });
    },
    configurable: true,
  });
  const measuredWhileMoving = () => written.filter((one) => one.value === 'auto' && one.moving).length;
  const measured = () => written.filter((one) => one.value === 'auto').length;
  context.applyPaneLayout();
  written.length = 0;
  context.toggleLibrary();
  if (!context.libraryPaneIsMoving()) throw new Error('the open never armed its motion');
  // Exactly one read arms the open — the layout pass before the classes land. A second one settling the motion lands between the flush and the class going up, which snapped the strip left on the first frame and left the page easing out on its own.
  if (measured() !== 1) throw new Error(`the open armed its motion on ${measured()} measurements of the zone rather than one`);
  // The read the open takes before it arms the motion must stay: it runs with no class up, so it starts no transition, and it is what leaves the floor fresh for the frames where the rail is still inside it.
  if (!written.some((one) => one.value === 'auto' && !one.moving)) {
    throw new Error('the open armed its motion on a floor nobody had measured');
  }
  if (measuredWhileMoving()) throw new Error('the zone was measured mid-open, so its width transition never started');
  // Held on the motion rather than on the toggle: a document finishing its render, the code view and the update bell all refit too, and any of them landing inside the open would kill the travel the same way.
  context.refitAppBar();
  if (measuredWhileMoving()) throw new Error('a refit inside the open measured the zone');
  // The close arms the same way, and it traveled correctly before any of this — a read settling it kills its travel outright.
  written.length = 0;
  context.toggleLibrary();
  if (measured() !== 0) throw new Error(`the close armed its motion on ${measured()} measurements of the zone rather than none`);
  if (measuredWhileMoving()) throw new Error('the zone was measured mid-close');
  // Deferred, never dropped: the motion ending is the one place the read is taken, and the floor comes back at the zone's own number.
  written.length = 0;
  context.endLibraryMotion();
  if (!written.some((one) => one.value === 'auto' && !one.moving)) {
    throw new Error('the motion ended and the held-back measurement was never taken');
  }
  if (lead.style.minWidth !== `${MAC_LEAD}px`) {
    throw new Error(`the pane stopped and the zone was left floored at ${lead.style.minWidth || 'nothing'} rather than its own ${MAC_LEAD}px`);
  }
});

check('a shut pane leaves the zone sized by its own buttons', () => {
  // The claim the change must not break: with no pane to match, the zone takes its width from what is standing in it and the stylesheet's own `width: auto` is the whole of that. So the floor is the same number and nothing pins a width over it.
  const context = bootWithLead(WINDOWS_LEAD, { libraryClosed: true });
  const lead = context.document.querySelector('.app-bar-lead');
  context.applyPaneLayout();
  context.refitAppBar();
  if (lead.style.width) throw new Error(`a shut pane left the zone pinned to ${lead.style.width}`);
  if (lead.style.minWidth !== `${WINDOWS_LEAD}px`) {
    throw new Error(`a shut pane left the zone floored at ${lead.style.minWidth || 'nothing'} rather than its own ${WINDOWS_LEAD}px`);
  }
});

// ---- 3b. copying what is highlighted in the reading view --------------------
//
// Neither gesture can be read off the source: the menu is drawn from a list filtered at the moment it opens, and what reaches the clipboard is whatever was saved before the focus moved. Held here because a Copy that quietly writes the wrong words, or an item that appears over a selection nobody made, both look right in the file.

if (booted) {
  const readingApp = booted.document.getElementById('app');

  /** A selection of `text`, inside the reading document unless `outside`, over a document body that is on screen unless `hidden`. */
  function highlight({ text, outside = false, hidden = false } = {}) {
    const body = {
      offsetParent: hidden ? null : {},
      contains: (node) => !!node && node.inReadingBody === true,
    };
    readingApp.querySelector = (selector) => (String(selector) === '.document-body' ? body : null);
    booted.getSelection = () => {
      if (text === null) return null;
      return {
        isCollapsed: text === '',
        rangeCount: text === '' ? 0 : 1,
        getRangeAt: () => ({ commonAncestorContainer: { inReadingBody: !outside } }),
        toString: () => text,
      };
    };
  }

  function contextMenuElement() {
    const surface = booted.document.getElementById('appSurface');
    const menu = surface.children.find((child) => String(child.className || '') === 'context-menu');
    if (!menu) throw new Error('the right-click menu is not on the app surface');
    return menu;
  }

  /** Open the page menu at the pointer. Nothing is dropped first: the menu empties itself as it draws, so the checks calling this twice are the proof that two opens leave one menu. */
  function openPageMenu() {
    booted.showContextMenu(120, 300, NOTE, 'page');
  }

  /** The rows of the menu that opened, in the order they are drawn, with a separator as a dash. */
  function menuRows() {
    const menu = contextMenuElement();
    if (menu.hidden) return [];
    return menu.children.map((row) => (String(row.className || '').includes('separator') ? '—' : String(row.textContent)));
  }

  /** Take `label` off the menu that is open and answer what it put on the clipboard. */
  function pickRow(label) {
    const row = contextMenuElement().children.find((one) => String(one.textContent) === label);
    if (!row) throw new Error(`the menu has no ${label}`);
    const written = [];
    const wasClipboard = booted.navigator.clipboard;
    booted.navigator.clipboard = { writeText: (text) => { written.push(text); return Promise.resolve(); } };
    try {
      for (const handler of row.listeners.get('click') || []) handler();
    } finally {
      booted.navigator.clipboard = wasClipboard;
    }
    return written;
  }

  const NOTE = 'C:\\notes\\one.md';
  // What the menu holds today, so a reader who has highlighted nothing meets exactly the menu they always have.
  const FILE_ROWS = ['Favorite', '—', 'Copy path', 'Reveal file', 'Properties', '—', 'Delete'];

  check('the page menu offers Copy over a highlighted sentence and copies those words', () => {
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    try {
      highlight({ text: 'a sentence  worth keeping' });
      openPageMenu();
      const rows = menuRows();
      if (rows[0] !== 'Copy') throw new Error(`the menu opened with ${JSON.stringify(rows[0])} rather than Copy`);
      if (rows.indexOf('Copy') > rows.indexOf('Favorite')) throw new Error('Copy sits below Favorite');
      if (rows[1] !== '—') throw new Error('Copy is not divided from the items about the file');
      // Exactly what was highlighted, spacing and all: the reader is copying what is on screen, not a tidied version of it.
      const written = pickRow('Copy');
      if (written.length !== 1 || written[0] !== 'a sentence  worth keeping') {
        throw new Error(`Copy wrote ${JSON.stringify(written)}`);
      }
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      booted.hideContextMenu();
    }
  });

  check('a menu over a document with nothing highlighted is the one that opens today', () => {
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    try {
      const same = (what) => {
        openPageMenu();
        const rows = menuRows();
        if (rows.join(' ') !== FILE_ROWS.join(' ')) throw new Error(`${what}: the menu became ${rows.join(' ')}`);
        booted.hideContextMenu();
      };
      highlight({ text: '' });
      same('a caret with nothing selected');
      highlight({ text: null });
      same('a page with no selection at all');
      highlight({ text: 'words in the pane', outside: true });
      same('a selection outside the document');
      highlight({ text: 'words behind the graph', hidden: true });
      same('a document body standing behind another view');
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      booted.hideContextMenu();
    }
  });

  check('the words are saved when the menu opens, not read when Copy runs', () => {
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    try {
      highlight({ text: 'the words that were highlighted' });
      openPageMenu();
      // Opening a menu for the keyboard takes the focus, which collapses the selection before the item runs.
      highlight({ text: '' });
      const written = pickRow('Copy');
      if (written[0] !== 'the words that were highlighted') throw new Error(`Copy wrote ${JSON.stringify(written)}`);
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      booted.hideContextMenu();
    }
  });

  check('a right-click in a field or a block being typed in keeps its own menu', () => {
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    try {
      highlight({ text: 'typed words' });
      let prevented = false;
      const target = Object.assign(new FakeElement(), {
        // A field, or a block that has been clicked into: the only selector it answers is the editable one, so every other branch of the handler passes over it.
        closest: (selector) => (String(selector).includes('contenteditable') ? target : null),
      });
      for (const handler of booted.document.listeners.get('contextmenu') || []) {
        handler({ target, clientX: 10, clientY: 10, preventDefault: () => { prevented = true; } });
      }
      if (prevented) throw new Error('a right-click in a field lost the menu the web view gives it');
      if (menuRows().length) throw new Error('a right-click in a field opened the page menu');
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      booted.hideContextMenu();
    }
  });

  // A file that names no title of its own is headed with its own name, drawn exactly like a heading the document owns. The renderer marks that one; pressing it is the only way to rename the file without leaving the page, and what is typed is the real file name rather than the word on screen — the heading says `Sitemap` and the box has to say `sitemap.xml`.
  check('pressing the heading a file lent renames the file', () => {
    const path = 'C:\\Notes\\sitemap.xml';
    const wasQuery = readingApp.querySelector;
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    const heading = fakeElement('h1');
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      booted.leafSetState({ recent: [], favorites: [], tabs: [{ path, title: 'Sitemap' }], active: 0, document: null });
      readingApp.querySelector = (selector) => (String(selector).includes('data-borrowed-title') ? heading : wasQuery(selector));
      booted.bindBorrowedTitleRename();
      if (heading.title !== 'Rename file') throw new Error(`the borrowed heading says ${heading.title || 'nothing'} rather than what pressing it does`);
      const press = (heading.listeners.get('click') || [])[0];
      if (!press) throw new Error('the heading the file lent takes no press');
      press({});

      const box = vm.runInContext('renameBox', booted);
      const input = vm.runInContext('renameInput', booted);
      if (box.hidden) throw new Error('the press opened no rename box');
      if (input.value !== 'sitemap.xml') throw new Error(`the box holds ${input.value} rather than the file's real name`);
      if (input.selectionStart !== 0 || input.selectionEnd !== 7) throw new Error(`the box preselected ${input.selectionStart}..${input.selectionEnd} rather than the stem alone`);

      input.value = 'pages.xml';
      for (const handler of input.listeners.get('keydown') || []) handler({ key: 'Enter', preventDefault: () => {} });
      const rename = sent.find((message) => message.command === 'renameFile');
      if (!rename) throw new Error(`Enter sent ${sent.map((one) => one.command).join(', ') || 'nothing'}`);
      if (rename.path !== path || rename.newName !== 'pages.xml') throw new Error(`the rename asks for ${rename.path} -> ${rename.newName}`);
      if (!box.hidden) throw new Error('the box stayed open over the document after it committed');
    } finally {
      readingApp.querySelector = wasQuery;
      booted.ipc.postMessage = wasSend;
    }
  });

  // Both gestures write through one clipboard pair, so the old path has to answer both — the reader who lost the highlight was on the key, and the menu's Copy would have lost it the same way.
  check('both gestures land the words through the old clipboard path and keep the highlight', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    const wasClipboard = booted.navigator.clipboard;
    const wasExec = booted.document.execCommand;
    const WORDS = 'a sentence to keep';

    const body = { offsetParent: {}, contains: (node) => !!node && node.inReadingBody === true };
    const range = { commonAncestorContainer: { inReadingBody: true }, cloneRange() { return this; } };
    let restored = 0;
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: () => {},
      addRange: () => { restored += 1; },
      toString: () => WORDS,
    };

    try {
      readingApp.querySelector = (selector) => (String(selector) === '.document-body' ? body : null);
      booted.getSelection = () => selection;
      booted.navigator.clipboard = null;
      let copiedText = null;
      booted.document.execCommand = () => { copiedText = surface.children.map((child) => child.value).find(Boolean) || null; return true; };
      const target = Object.assign(new FakeElement(), { closest: () => null });

      for (const gesture of ['key', 'menu']) {
        copiedText = null;
        restored = 0;
        if (gesture === 'key') {
          for (const handler of booted.__windowListeners.get('keydown') || []) {
            handler({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'c', target, preventDefault: () => {} });
          }
        } else {
          openPageMenu();
          const row = contextMenuElement().children.find((one) => String(one.textContent) === 'Copy');
          if (!row) throw new Error('the menu has no Copy over a highlighted sentence');
          for (const handler of row.listeners.get('click') || []) handler();
        }
        if (copiedText !== WORDS) throw new Error(`the ${gesture} copied ${JSON.stringify(copiedText)} through the old path`);
        if (!restored) throw new Error(`the ${gesture} left the highlight taken`);
        if (surface.children.some((child) => String(child.value || '') === WORDS)) {
          throw new Error(`the ${gesture} left the hidden box standing on the page`);
        }
      }
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      booted.navigator.clipboard = wasClipboard;
      booted.document.execCommand = wasExec;
      booted.hideContextMenu();
      for (const child of [...surface.children]) if (String(child.value || '') === WORDS) child.remove();
    }
  });

  // A Mac's web view refuses the modern clipboard call, so a copy there goes down the old path — which reads whatever is selected, and so has to take the reader's highlight for one call. Held here because losing it is invisible in the code and the first thing anybody notices in the window.
  check('a copy through the old clipboard path leaves the highlight exactly where it was', () => {
    const surface = booted.document.getElementById('appSurface');
    const wasSelection = booted.getSelection;
    const wasClipboard = booted.navigator.clipboard;
    const wasExec = booted.document.execCommand;
    const standing = () => surface.children.filter((child) => String(child.value || '') === 'two paragraphs of it').length;

    // Two ranges, which is what selecting across blocks leaves, so a restore that only puts the first one back fails here.
    const ranges = ['first', 'second'].map((name) => ({ name, cloneRange() { return this; } }));
    const added = [];
    let cleared = 0;
    const selection = {
      isCollapsed: false,
      get rangeCount() { return added.length ? added.length : ranges.length; },
      getRangeAt: (index) => (added.length ? added[index] : ranges[index]),
      removeAllRanges: () => { cleared += 1; added.length = 0; },
      addRange: (range) => added.push(range),
      toString: () => 'two paragraphs of it',
    };

    try {
      booted.getSelection = () => selection;
      // A web view that refuses the modern call is the only way the old path runs at all.
      booted.navigator.clipboard = null;
      let copiedText = null;
      booted.document.execCommand = () => { copiedText = surface.children.map((child) => child.value).find(Boolean) || null; return true; };

      if (booted.legacyCopy('two paragraphs of it') !== true) throw new Error('the old path reported no copy');
      if (copiedText !== 'two paragraphs of it') throw new Error(`the old path copied ${JSON.stringify(copiedText)}`);
      if (!cleared) throw new Error('the highlight was never put back, only taken');
      if (added.length !== 2) throw new Error(`${added.length} of the two highlighted ranges came back`);
      if (added[0].name !== 'first' || added[1].name !== 'second') throw new Error('the ranges came back in the wrong order');
      if (standing()) throw new Error('the hidden box was left standing on the page');
    } finally {
      booted.getSelection = wasSelection;
      booted.navigator.clipboard = wasClipboard;
      booted.document.execCommand = wasExec;
      for (const child of [...surface.children]) if (String(child.value || '') === 'two paragraphs of it') child.remove();
    }
  });

  check('the copy key writes a reading-view selection and leaves every other surface alone', () => {
    const wasSelection = booted.getSelection;
    const wasQuery = readingApp.querySelector;
    const somewhere = Object.assign(new FakeElement(), { closest: () => null });
    // A field, or a block that has been clicked into, which is an editing host with the browser's own copy.
    const typing = Object.assign(new FakeElement(), { closest: () => typing });

    /** Hold the copy key over `target` and answer whether the page claimed it and what it wrote. */
    const press = ({ target = somewhere, mac = false } = {}) => {
      let prevented = false;
      const written = [];
      const wasClipboard = booted.navigator.clipboard;
      booted.navigator.clipboard = { writeText: (text) => { written.push(text); return Promise.resolve(); } };
      try {
        for (const handler of booted.__windowListeners.get('keydown') || []) {
          handler({ ctrlKey: !mac, metaKey: mac, altKey: false, shiftKey: false, key: 'c', target, preventDefault: () => { prevented = true; } });
        }
      } finally {
        booted.navigator.clipboard = wasClipboard;
      }
      return { prevented, written };
    };

    try {
      highlight({ text: 'words on the page' });
      // Both spellings of the gesture: Cmd on a Mac, Ctrl everywhere else.
      for (const mac of [false, true]) {
        const { prevented, written } = press({ mac });
        if (!prevented) throw new Error(`the ${mac ? 'Mac' : 'Windows'} copy key was left to the web view`);
        if (written.length !== 1 || written[0] !== 'words on the page') {
          throw new Error(`the ${mac ? 'Mac' : 'Windows'} copy key wrote ${JSON.stringify(written)}`);
        }
      }

      // The source view is an editor with its own copy.
      vm.runInContext('codeViewActive = true;', booted);
      if (press().prevented) throw new Error('the source view lost the editor’s own copy');
      vm.runInContext('codeViewActive = false;', booted);

      // So is a field, and so is a block that has been clicked into.
      if (press({ target: typing }).prevented) throw new Error('a field being typed in lost the copy it already has');

      // Nothing qualifying highlighted: the key is left exactly as it arrived.
      for (const nothing of [{ text: '' }, { text: null }, { text: 'words in the pane', outside: true }, { text: 'words behind the graph', hidden: true }]) {
        highlight(nothing);
        const { prevented, written } = press();
        if (prevented) throw new Error('the copy key was claimed with nothing in the document highlighted');
        if (written.length) throw new Error(`the copy key wrote ${JSON.stringify(written)} with nothing highlighted`);
      }
    } finally {
      booted.getSelection = wasSelection;
      readingApp.querySelector = wasQuery;
      vm.runInContext('codeViewActive = false;', booted);
    }
  });
}

// ---- 3c. the menu a right-click asks for reads ------------------------------
//
// A rest on a link raises the card and a right-click on that same link moves no pointer, so nothing takes the card down on its own. Two things hold it: the card is painted under every menu, and the menu takes it down as it opens. Neither is readable off one file — the layers are a rule and a token apart, and the dismissal only shows in the order two fragments run.

check('a card a rest raises is painted under every menu and over every sheet', () => {
  const menu = layerOf('.context-menu');
  const card = layerOf('.link-hover-tip');
  if (!(card < menu)) throw new Error(`the hover card is painted at ${card} against the menu's ${menu}, so it covers the menu the reader asked for`);
  // A rest on a link inside the term sheet raises a card, so the card cannot simply drop under the sheets.
  const sheet = layerOf('.glossary-sheet');
  if (!(card > sheet)) throw new Error(`the hover card is painted at ${card} against the term sheet's ${sheet}, so a card raised on a link inside that sheet is drawn behind it`);
});

check('a message is painted over everything that covers its corner and under every menu', () => {
  const menu = layerOf('.context-menu');
  const message = layerOf('.app-toast');
  // The strip takes presses and can carry an Undo button, and a menu can open across the corner it sits in, so a message over a menu could take a press meant for a menu row.
  if (!(message < menu)) throw new Error(`a message is painted at ${message} against the menu's ${menu}, so it stands over a menu opened under it`);
  // Every sheet, full-window view and dim is walked rather than named: a failure is only worth raising if the reader can read it, and each of these covers the corner it lands in.
  for (const rule of layersPainted()) {
    if (rule.selector === '.app-toast' || rule.layer >= menu) continue;
    if (rule.layer >= message) throw new Error(`${rule.selector} is painted at ${rule.layer} against a message's ${message}, so a message raised while it is open is drawn behind it`);
  }
});

check('the first-run bubble is painted under every menu', () => {
  const menu = layerOf('.context-menu');
  const bubble = layerOf('.hint-bubble');
  // It points at the pane's folder switch, and a right-click on a folder row below opens a menu into the same space before the pointer has ever reached the switch.
  if (!(bubble < menu)) throw new Error(`the first-run bubble is painted at ${bubble} against the menu's ${menu}, so it stands over a menu opened under it`);
});

if (booted) {
  const LINK_HREF = 'notes/first.md';
  const hoverLink = () => {
    const item = {
      href: LINK_HREF,
      getAttribute: (name) => (name === 'href' ? LINK_HREF : null),
      getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
    };
    item.closest = () => item;
    return item;
  };
  /** Raise the card on `link` the way a rest does, and answer the card element. */
  function raiseCard(link) {
    booted.__menuHoverEvent = { target: link, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
    vm.runInContext('startLinkHover(__menuHoverEvent);', booted);
    booted.__frames.drain();
    const tip = vm.runInContext('linkHoverTip', booted);
    if (tip.hidden || !tip.classList.contains('shown')) throw new Error('the card never came up, so there was nothing for the menu to be covered by');
    return tip;
  }
  const clearCard = () => {
    vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
    delete booted.__menuHoverEvent;
  };

  check('a right-click on the link the card is up on leaves the menu alone on screen', () => {
    const menu = vm.runInContext('contextMenu', booted);
    try {
      const link = hoverLink();
      const tip = raiseCard(link);
      booted.showContextMenu(240, 210, LINK_HREF, 'link', link);
      if (menu.hidden || !menu.children.length) throw new Error('the right-click opened no menu at all');
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('the card is still up over the menu the reader just asked for');
    } finally {
      booted.hideContextMenu();
      clearCard();
    }
  });

  check('the card does not come back while the menu it made way for is up', () => {
    try {
      const link = hoverLink();
      raiseCard(link);
      booted.showContextMenu(240, 210, LINK_HREF, 'link', link);
      const tip = vm.runInContext('linkHoverTip', booted);
      // The pointer has not left the link, so a move over it is the one thing that could raise it again.
      for (const handler of booted.document.listeners.get('pointermove') || []) {
        handler({ target: link, clientX: 242, clientY: 212 });
      }
      booted.__frames.drain();
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('a pointer twitch put the card back over the open menu');
    } finally {
      booted.hideContextMenu();
      clearCard();
    }
  });

  check('a right-click that opens no menu leaves the card standing', () => {
    const menu = vm.runInContext('contextMenu', booted);
    try {
      const link = hoverLink();
      const tip = raiseCard(link);
      // The library's own top: no path, so `showContextMenu` returns before it draws anything.
      booted.showContextMenu(240, 210, '', 'folder');
      if (!menu.hidden && menu.children.length) throw new Error('an empty path drew a menu');
      if (tip.hidden || !tip.classList.contains('shown')) throw new Error('a right-click that opened nothing took the card down with it');
    } finally {
      booted.hideContextMenu();
      clearCard();
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
    // Taken out of wherever it was standing, not just written into this list: a move that leaves the node in its old container as well hands the next check a strip holding the same button three times.
    const move = (child) => {
      detachChild(child);
      child.parentElement = panel;
      return child;
    };
    Object.assign(panel, {
      children: inside,
      prepend: (child) => inside.unshift(move(child)),
      appendChild: (child) => inside.push(move(child)) && child,
    });
    Object.defineProperty(panel, 'childElementCount', { get: () => inside.length, configurable: true });
    // A rendered document, because Export stands only where there is a page to print — and where it does not stand, the menu it folds into is one item short.
    booted.renderReaderToolbar(true);
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
      const expected = ['backButton', 'forwardButton', 'themeSheetOpen', 'openButton', 'newButton', 'exportPdfButton', 'windowControls'];
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

      // Widening the window puts every one of them back where it was standing. The fold has to read their container rather than be told one: told one, the Mac's dots stay in the menu until the app is quit, because the container it was told is not the one holding them.
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
    // The bar is measured with every button it can carry, so both of these come first — while the bar is unmeasured and the refit each of them fires folds nothing. The window's own three are priced into the model below and the fold skips a hidden button, so a hidden set is a bar measured wider than the one being folded; Export stands only where there is a page to print, and it is a candidate the fold reaches.
    booted.document.getElementById('windowControls').hidden = false;
    booted.renderReaderToolbar(true);
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
      if (onePass.length !== 3) {
        throw new Error(`a single pass folded ${onePass.join(',') || 'nothing'}, expected three`);
      }
      if (bar.bar.scrollWidth <= BAR_WIDTH) {
        throw new Error('the chevron cost the bar nothing, so this proves nothing about a second pass');
      }

      // The refit, from the chevron down: the second pass measures a bar the chevron is on and folds the one more that takes.
      vm.runInContext('overflowChevronUp = false;', booted);
      booted.refitAppBar();
      const settled = bar.folded();
      if (settled.length !== 4) {
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

  check('the strip the arrows leave behind holds no element, and holds both again once the bar widens', () => {
    // The condition the stylesheet keys on: `.history-actions:not(:has(> *:not([hidden])))` stops the strip being drawn, so the lead's 16px gap has nothing to land against. Nothing here lays anything out, so what is proved is that the fold reaches that state and comes back out of it.
    const bar = measuredAppBar();
    const strip = booted.document.querySelector('.history-actions');
    try {
      // Narrow past every candidate, so both arrows are certainly in the menu rather than only the one the bar's own width happened to buy.
      bar.bar.clientWidth = 0;
      booted.refitAppBar();
      if (strip.children.length) {
        throw new Error(`the emptied strip still holds ${strip.children.map((el) => el.id).join(',')}`);
      }

      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      const back = strip.children.map((el) => el.id);
      if (back.join(',') !== 'backButton,forwardButton') {
        throw new Error(`a wide bar put the strip back as ${back.join(',') || 'empty'}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the group the actions leave behind holds only the hidden update bell, and holds all five again once the bar widens', () => {
    // The condition the stylesheet keys on: `.app-actions-items:not(:has(> *:not([hidden])))` stops the group being drawn, so the trailing zone's 16px gap has nothing to land against beside the window buttons. The bell never folds, so what has to be proved is that the group is left holding it alone and hidden — which is the state a bare `:has()` cannot tell from a full group.
    const bar = measuredAppBar();
    const group = booted.document.querySelector('.app-actions-items');
    // A rendered document, or Export is hidden and the group it is meant to leave is one button short of empty.
    booted.renderReaderToolbar(true);
    try {
      // Narrow past every candidate, so all four actions are certainly in the menu rather than only the one the bar's own width happened to buy.
      bar.bar.clientWidth = 0;
      booted.refitAppBar();
      const left = group.children.map((el) => el.id);
      if (left.join(',') !== 'updateMenu') {
        throw new Error(`the emptied group holds ${left.join(',') || 'nothing'}, expected the bell alone`);
      }
      if (!group.children[0].hidden) {
        throw new Error('the bell left in the group was drawn, so the group is not the emptied case at all');
      }

      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      const backOn = group.children.map((el) => el.id);
      if (backOn.join(',') !== 'updateMenu,themeSheetOpen,openButton,newButton,exportPdfButton') {
        throw new Error(`a wide bar put the group back as ${backOn.join(',') || 'empty'}`);
      }
    } finally {
      bar.done();
    }
  });

  check('a menu draws whatever it holds, one row or many', () => {
    const surface = booted.document.getElementById('appSurface');
    const menuOn = () => surface.children.find((child) => String(child.className || '') === 'flow-menu');
    const run = [];
    try {
      // No export opens a menu, so nothing here may quietly run a row on the reader's behalf: this is the flowchart canvas's own right-click menu, and a list that comes down to one row is still a list.
      booted.openFlowMenuWith(10, 10, [{ label: 'Detach', run: () => run.push('Detach') }], surface);
      const one = menuOn();
      if (!one) throw new Error('a menu of one row drew nothing, so a right-click acted without being pressed');
      if (run.length) throw new Error(`opening a menu ran one of its rows: ${run.join(',')}`);
      booted.closeFlowMenu();

      booted.openFlowMenuWith(10, 10, [{ label: 'Duplicate', run: () => run.push('Duplicate') }, { label: 'Detach', run: () => run.push('Detach') }], surface);
      const menu = menuOn();
      if (!menu) throw new Error('a menu of two rows opened nothing');
      const rows = menu.children.filter((child) => child.className === 'flow-menu-item');
      if (rows.length !== 2) throw new Error(`the menu drew ${rows.length} rows rather than both`);
      if (run.length) throw new Error(`opening a menu ran one of its rows: ${run.join(',')}`);
    } finally {
      booted.closeFlowMenu();
    }
  });

  check('Export asks for the file straight away and sends the page size with the format', () => {
    const sent = [];
    const ipc = booted.window.ipc;
    booted.window.ipc = { postMessage: (message) => sent.push(JSON.parse(message)) };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      const surface = booted.document.getElementById('appSurface');
      // Windows draws the formats as a dropdown inside the save window, so the window is the whole question and nothing opens over the page. The menu is a Mac panel's answer, where no label survives at all.
      if (surface.children.some((child) => String(child.className || '') === 'flow-menu')) {
        throw new Error('pressing Export opened a menu over the page where the save window asks the format itself');
      }
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`pressing Export sent ${asked.length} exports`);
      // Only the page knows how tall the document is, and that height is the whole of what makes the file one continuous page instead of a document chopped across sheets.
      if (asked[0].format !== '') throw new Error(`Export named ${asked[0].format} rather than leaving the save window every row to offer`);
      if (!(asked[0].height > 0) || !(asked[0].width > 0)) throw new Error(`the export carried no page size: ${JSON.stringify(asked[0])}`);
    } finally {
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  // A rendered document with each of the app's own controls inside it, a diagram already drawn, and the correction the rail parks on the live body. The parts are the copy: what is removed leaves the markup, which is what makes this a reading of the written page rather than of the selector. `cloneNode` builds a fresh one, so the live element and the copy the export works on are two things, the way they are on the page.
  const drawnDocument = () => {
    const parts = [
      { html: '<h1>Release notes</h1>' },
      { html: '<pre class="mermaid" data-processed="true"><svg class="flowchart lt-mmd-0"></svg></pre>' },
      // A style of the document's own, one element down: mermaid writes the drawn box's height there, so a copy that shed its whole attribute must still shed only its own.
      { html: '<div class="mermaid-view" style="height: 420px"></div>' },
      { classes: ['code-copy'], html: '<button class="code-copy"></button>' },
      { classes: ['image-sheet-open'], html: '<button class="image-sheet-open"></button>' },
      { classes: ['mermaid-tools'], html: '<div class="mermaid-tools"></div>' },
      { classes: ['mermaid-zoom'], html: '<div class="mermaid-zoom"></div>' },
    ];
    let style = '--reader-scroll-origin: 16px';
    return {
      get outerHTML() {
        return `<div class="document-body"${style ? ` style="${style}"` : ''}>${parts.map((part) => part.html).join('')}</div>`;
      },
      get styleAttribute() {
        return style;
      },
      removeAttribute: (name) => {
        if (String(name) === 'style') style = null;
      },
      cloneNode: () => drawnDocument(),
      querySelectorAll: (selector) => {
        const wants = String(selector).split(',').map((one) => one.trim().replace(/^\./, ''));
        return parts
          .filter((part) => (part.classes || []).some((name) => wants.includes(name)))
          .map((part) => ({ dataset: {}, remove: () => parts.splice(parts.indexOf(part), 1) }));
      },
    };
  };

  // Stand the drawn document in front of the reader element, and hand back whatever the export made of it. A caller that wants to read the live element afterwards passes its own.
  const exportedMarkup = (live) => {
    const reader = vm.runInContext('app', booted);
    const wasQuery = reader.querySelector;
    const drawn = live || drawnDocument();
    reader.querySelector = (selector) =>
      String(selector) === '.document-body' ? drawn : wasQuery.call(reader, selector);
    try {
      return vm.runInContext('pageExportMarkup', booted)();
    } finally {
      reader.querySelector = wasQuery;
    }
  };

  check('The web page export hands over the document and none of the app that was drawn inside it', () => {
    const markup = exportedMarkup();
    // Nothing is drawn, fetched or run for the export: the diagram is already an SVG sitting in the document.
    if (!markup.includes('<svg class="flowchart lt-mmd-0">')) {
      throw new Error(`the drawn diagram did not travel with the document: ${markup}`);
    }
    if (!markup.includes('<h1>Release notes</h1>')) throw new Error(`the document itself did not travel: ${markup}`);
    // Four kinds of control, every one of which does nothing on somebody else's machine. The copy button is one per fenced block, which is the one an earlier reading missed.
    for (const control of ['code-copy', 'image-sheet-open', 'mermaid-tools', 'mermaid-zoom']) {
      if (markup.includes(control)) throw new Error(`the export carried the app's own ${control}: ${markup}`);
    }
  });

  check('The exported wrapper chain reserves no column for a rail it has not got', () => {
    const markup = exportedMarkup();
    // Every rule in the stylesheet is keyed on this chain, so a body without it renders unstyled.
    if (!markup.startsWith('<div class="app-surface"><main class="reader-shell has-document"><div class="reader-layout reader-layout-no-minimap">')) {
      throw new Error(`the exported document was not wrapped in the ancestors the stylesheet is keyed on: ${markup}`);
    }
    if (!markup.endsWith('</div></main></div>')) throw new Error(`the wrapper chain was left open: ${markup}`);
    // `has-minimap` is what sets the rail's column and the grid is what spends it, so a copy carrying it lays the document out beside an empty rail.
    if (markup.includes('has-minimap')) {
      throw new Error(`the export said it has a minimap it does not carry: ${markup}`);
    }
  });

  check('The exported page starts where the document starts, not where the app bar was', () => {
    const live = drawnDocument();
    const markup = exportedMarkup(live);
    // The rail writes this on the live body as a negative top margin, so the reader's scroll starts at the words rather than at the top of the box. An exported page has no bar, no card inset and no rail, so a copy wearing it opens with the title against the window's edge — or with as much of the document as the correction is wide scrolled off above it and no way back.
    if (markup.includes('--reader-scroll-origin')) {
      throw new Error(`the export carried the app's scroll-origin correction: ${markup}`);
    }
    // The whole attribute, because the renderer writes this element bare and the next correction parked there would be this fault over again.
    if (/<div class="document-body" style=/.test(markup)) {
      throw new Error(`the exported document body kept a style attribute: ${markup}`);
    }
    // Only the copy sheds it: the reader still needs the value, and everything inside the copy keeps its own.
    if (!live.styleAttribute) throw new Error('the export took the correction off the live document');
    if (!markup.includes('style="height: 420px"')) {
      throw new Error(`the export stripped a style from inside the document: ${markup}`);
    }
  });

  check('The page sends the paper the document needs and not the room its own controls take', () => {
    const sent = [];
    const ipc = booted.window.ipc;
    const surface = booted.document.getElementById('appSurface');
    const wasRect = surface.getBoundingClientRect;
    booted.window.ipc = { postMessage: (message) => sent.push(JSON.parse(message)) };
    // The sheet is the app surface's own box while the page is wearing the paper rules, and nothing else: three rounds of subtracting the reader's own measurements from a screen layout each left blank paper under the last line. So the surface answers one box while the class is on and a window-shaped one while it is off, and only the first may be sent.
    const paper = { width: 1277, height: 28207, top: 0, left: 0, right: 1277, bottom: 28207 };
    const screen = { width: 1611, height: 1281, top: 0, left: 0, right: 1611, bottom: 1281 };
    // The hold lives in the theme bootstrap, an inline script this harness never boots, so it stands in here doing the one thing the page depends on: the class.
    const wasHold = booted.window.leafHoldAppearance;
    let holding = 0;
    booted.window.leafHoldAppearance = (held) => {
      holding = Math.max(0, holding + (held ? 1 : -1));
      booted.document.body.classList.toggle('leaf-paper', holding > 0);
    };
    let heldWhenMeasured = null;
    surface.getBoundingClientRect = () => {
      const held = booted.document.body.classList.contains('leaf-paper');
      heldWhenMeasured = held;
      return held ? paper : screen;
    };
    try {
      booted.renderReaderToolbar(true);
      const button = booted.document.getElementById('exportPdfButton');
      (button.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
      const asked = sent.filter((one) => one.command === 'exportPdf');
      if (asked.length !== 1) throw new Error(`pressing Export sent ${asked.length} exports`);
      if (heldWhenMeasured !== true) throw new Error('the page measured itself before it was wearing the paper rules, which is the screen layout and not the sheet');
      if (asked[0].height !== paper.height || asked[0].width !== paper.width) {
        throw new Error(`the sheet was asked for at ${asked[0].width} x ${asked[0].height} rather than the ${paper.width} x ${paper.height} the paper rules lay out`);
      }
      // The rules stay on until the host answers, so the render is laid out under the ones that were measured.
      if (!booted.document.body.classList.contains('leaf-paper')) {
        throw new Error('the paper rules came off before the render, so the sheet is sized for a layout the render will not use');
      }
    } finally {
      booted.window.leafHoldAppearance(false);
      booted.window.leafHoldAppearance = wasHold;
      surface.getBoundingClientRect = wasRect;
      booted.window.ipc = ipc;
      booted.renderReaderToolbar(false);
    }
  });

  check('Export stands only where there is a rendered page to print', () => {
    const button = booted.document.getElementById('exportPdfButton');
    const set = (source) => vm.runInContext(source, booted);
    try {
      // The home screen. The three views are three ways of showing one document, and here there is no document, so there is nothing to hand a print panel.
      booted.renderReaderToolbar(false);
      if (!button.hidden) throw new Error('the export action stood on the home screen, where there is no page to print');

      booted.renderReaderToolbar(true);
      if (button.hidden) throw new Error('a rendered document left the export action hidden');

      // The source view. Monaco realizes the lines it is drawing and nothing else, so what a print would give is whatever happened to be on screen rather than the file.
      set('codeViewActive = true;');
      booted.renderReaderToolbar(true);
      if (!button.hidden) throw new Error('the export action stood in the source view, where a print gives only the realized lines');

      // The map, which the print rules take down with the rest of the app's own controls, so a print there is a blank sheet.
      set('codeViewActive = false; graphViewOpen = true;');
      booted.renderReaderToolbar(true);
      if (!button.hidden) throw new Error('the export action stood on the map, which the print rules hide');
    } finally {
      set('codeViewActive = false; graphViewOpen = false;');
      booted.renderReaderToolbar(false);
    }
  });

  check('The saved growl opens the file it names', () => {
    // Its own boot: the growl slot replaces itself, so a shared page carries whatever an earlier check left in it.
    const sent = [];
    const page = runShell(source, { ipc: { postMessage: (message) => sent.push(JSON.parse(message)) } });
    const written = 'C:\\Users\\reader\\Documents\\quarterly review.pdf';
    page.window.leafFileWritten(written);
    const surface = page.document.getElementById('appSurface');
    const growl = surface.children.filter((child) => String(child.className || '').includes('app-toast')).pop();
    if (!growl) throw new Error('a file was written and nothing was said');
    // The path itself takes the press, not a button beside it: it is what the reader reaches for.
    const pressable = (growl.children || []).find((child) => String(child.className || '') === 'app-toast-link');
    if (!pressable) throw new Error(`the path was drawn as plain words, so there is nothing to press: ${(growl.children || []).map((child) => child.className).join(',') || growl.textContent}`);
    if (String(pressable.textContent) !== written) throw new Error(`the press carried ${pressable.textContent} rather than the file`);
    (pressable.listeners.get('click') || []).forEach((handler) => handler({ type: 'click' }));
    const asked = sent.filter((one) => one.command === 'openExternal');
    if (asked.length !== 1) throw new Error(`pressing the path sent ${asked.length} opens`);
    if (asked[0].url !== written) throw new Error(`the open asked for ${asked[0].url} rather than the file just written`);
    // Gone as it is pressed: the file has been handed to another program, so a second press on the same offer is not left standing.
    if (surface.children.includes(growl)) throw new Error('the growl stayed up after its path was pressed');
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

check('a published site draws no Back, no Forward, no Open, no New document, no window buttons and no first-run bubble', () => {
  const site = siteBoot(true);
  // The folder and the plus go with the pair: a static site has no file dialog and nowhere to save, so both commands are refused forever rather than not yet.
  for (const id of ['backButton', 'forwardButton', 'openButton', 'newButton']) {
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
  for (const id of ['backButton', 'forwardButton', 'openButton', 'newButton']) {
    if (!desktop.context.document.getElementById(id)) throw new Error(`the desktop lost ${id}`);
  }
  if (desktop.bubbles.length !== 1) throw new Error(`a desktop first launch drew ${desktop.bubbles.length} first-run bubbles`);

  // The same three window buttons, revealed the moment there is a native frame to draw them for — the mechanism the site flag copies.
  const framed = runShell(source, { __leafFrameless: true });
  if (framed.document.getElementById('windowControls').hidden !== false) {
    throw new Error('a frameless window did not reveal its own three buttons');
  }
});

// Where the platform's title bar is gone the app bar is it, so a press on the bare part of the bar hands the window to the host's own move loop and a press on anything standing on it belongs to that control. Both halves come off one listener, which is why one check asks for both. Booted frameless because that is the only build where the bar is a title bar at all.
check('a press on the app bar asks for a window drag, and a press on a control asks for nothing', () => {
  const framed = runShell(source, { __leafFrameless: true });
  const sent = [];
  framed.ipc.postMessage = (text) => sent.push(JSON.parse(text));
  const bar = framed.document.getElementById('appBar');
  const pressed = (target) => {
    sent.length = 0;
    for (const handler of [...(bar.listeners.get('mousedown') || [])]) {
      handler({ button: 0, detail: 1, target });
    }
    return sent.map((message) => message.command);
  };

  const onTheBar = pressed({ closest: () => null });
  if (onTheBar.join() !== 'windowDrag') {
    throw new Error(`a press on the app bar sent ${JSON.stringify(onTheBar)} rather than a window drag`);
  }

  // Whatever the press landed on answers for itself: a tab switches, a button runs its command, and neither is a gesture to move the window.
  for (const control of ['a tab', 'a button']) {
    const onAControl = pressed({ closest: () => ({ id: control }) });
    if (onAControl.length) {
      throw new Error(`a press on ${control} sent ${JSON.stringify(onAControl)} instead of leaving the press to it`);
    }
  }

  // The right-hand button never drags: that press is the context menu's.
  sent.length = 0;
  for (const handler of [...(bar.listeners.get('mousedown') || [])]) {
    handler({ button: 2, detail: 1, target: { closest: () => null } });
  }
  if (sent.length) {
    throw new Error(`a right-hand press on the app bar sent ${JSON.stringify(sent)}`);
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

// ---- 4c. the reading view's own render ---------------------------------------
//
// Every file a reader opens comes through this render. What the checks below drive is the end of it: the guard that drops a landing armed on another document, and the three landings after it — the reader's own pixel, the block holding a source line, and the reset that catches what neither of those answered.
//
// Geometry is each check's own, never the stand-in element's. Every pixel a landing writes goes through the clamp, which measures the surface, the body and the body's first block, so a check standing none of them in reads every landing back as zero and passes on numbers nobody chose.

/** Hand a page one document and stand in the geometry the landing chain measures. `blocks` are the source offsets the rendered blocks carry and the pixel each one sits at down the document; the rects follow `app.scrollTop` the way a browser's do, or the second measurement of a landing reads back whatever the first one just wrote. */
function renderReadingDocument(context, options = {}) {
  const { path = 'C:\\Notes\\one.md', blocks = [], height = 10000, viewport = 1000, tall = 100 } = options;
  const app = context.document.getElementById('app');
  const title = String(path).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const html = `<div class="document-body">${blocks.map((block, at) => `<p data-src-start="${block.srcStart}">block ${at}</p>`).join('')}</div>`;
  app.scrollHeight = height;
  app.clientHeight = viewport;
  context.window.leafSetState({
    recent: [],
    favorites: [],
    tabs: [{ title, path }],
    active: 0,
    document: { title, path, html, minimap: { lines: [], headings: [] }, format: 'Markdown', blocks: [], tasks: [], source: '' },
  });
  const body = app.querySelector('.document-body');
  app.getBoundingClientRect = () => ({ left: 0, top: 0, right: VIEW_WIDTH, bottom: viewport, width: VIEW_WIDTH, height: viewport });
  const rectAt = (top, deep) => () => ({ left: 0, top: top - app.scrollTop, right: VIEW_WIDTH, bottom: top - app.scrollTop + deep, width: VIEW_WIDTH, height: deep });
  if (body) {
    body.scrollHeight = height;
    body.getBoundingClientRect = rectAt(0, height);
    body.children.forEach((child, at) => {
      child.getBoundingClientRect = rectAt(blocks[at] && Number.isFinite(blocks[at].top) ? blocks[at].top : at * tall, tall);
    });
  }
  return { app, body };
}

/** A page of its own with one document open on it, so a render never leaves the shared page holding a document the next check would read as its own. */
function bootReading(options) {
  const context = runShell(source);
  const page = renderReadingDocument(context, options);
  return { context, ...page };
}

check('a document handed to the page is rendered into the reading view', () => {
  const { context, app, body } = bootReading({ path: 'C:\\Notes\\opened.md', blocks: [{ srcStart: 0 }, { srcStart: 40 }] });
  if (!String(app.className).includes('has-document')) throw new Error(`the surface reads ${JSON.stringify(String(app.className))} rather than one holding a document`);
  const layout = app.firstElementChild;
  if (!layout || !String(layout.className).includes('reader-layout')) throw new Error('the surface is not holding a reading layout');
  if (!body || body.parentElement !== layout) throw new Error("the document's own body is not standing under the layout");
  if (body.children.length !== 2) throw new Error(`the body holds ${body.children.length} blocks rather than the two the document declared`);
  // Drawn hidden and revealed once every pass over it has run, which is the last thing the render does before it lands.
  if (layout.style.getPropertyValue('display') === 'none') throw new Error('the finished document was left hidden');
  // The page took the document's own name as the window's, which is the cheapest proof the render read the document rather than the tab.
  if (!String(context.document.title).startsWith('opened')) throw new Error(`the window is titled ${JSON.stringify(context.document.title)}`);
});

check("a document opened with the reader's own pixel armed comes to rest on it", () => {
  const path = 'C:\\Notes\\exact.md';
  const context = runShell(source);
  // Everything one press of the source button leaves behind when the code view never moved: the pixel the reading view was on, and the arm that says it may simply be handed back.
  vm.runInContext(`viewHandoff = { path: ${JSON.stringify(path)}, readerScrollTop: 321, codeScrollTop: 0, readerLanded: 321, codeLanded: 0, restoreExact: true };`, context);
  const { app } = renderReadingDocument(context, { path, blocks: [{ srcStart: 0 }, { srcStart: 40 }, { srcStart: 90 }] });
  context.__frames.drain();
  if (app.scrollTop !== 321) throw new Error(`the reader came to rest at ${app.scrollTop} rather than the pixel it was on`);
  // One landing per toggle: a second render of the same document must not spend it again.
  if (vm.runInContext('viewHandoff.restoreExact', context) !== false) throw new Error('the pixel was left armed for the next render as well');
  // And it is the landing that ran, not the reset underneath it.
  if (vm.runInContext('resetReaderScrollOnNextRender', context) !== false) throw new Error('the reset was left armed under the landing that beat it');
});

check('a document opened with a source line armed comes to rest on the block holding it', () => {
  const path = 'C:\\Notes\\line.md';
  const blocks = [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 900 }, { srcStart: 90, top: 1800 }];
  const arm = (context, offset) =>
    vm.runInContext(`pendingViewLandingPath = ${JSON.stringify(path)}; pendingReadingSrcOffset = ${offset}; pendingViewScrollFraction = 0.5; pendingViewAtTop = false;`, context);
  const first = runShell(source);
  arm(first, 60);
  const landed = renderReadingDocument(first, { path, blocks });
  first.__frames.drain();
  // 60 falls inside the second block, which starts at 40 — so the block holding that line is the one the reader lands on.
  if (landed.app.scrollTop !== 900) throw new Error(`the reader came to rest at ${landed.app.scrollTop} rather than on the block holding the line`);
  if (vm.runInContext('pendingReadingSrcOffset', first) !== null) throw new Error('the source line was left armed for the next render as well');

  // A document whose blocks carry no source range at all: the landing has nothing to aim at, so the render falls back to the fraction the toggle carried across, which is half way down 9,000px of range.
  const bare = runShell(source);
  arm(bare, 60);
  const empty = renderReadingDocument(bare, { path, blocks: [] });
  empty.app.scrollTop = 4000;
  bare.__frames.drain();
  if (empty.app.scrollTop !== 4500) throw new Error(`a document with no block to land on came to rest at ${empty.app.scrollTop} rather than at the fraction the toggle carried`);

  // And with no fraction either, the content start — never wherever the last document left the reader.
  const plain = runShell(source);
  vm.runInContext(`pendingViewLandingPath = ${JSON.stringify(path)}; pendingReadingSrcOffset = 60; pendingViewScrollFraction = null; pendingViewAtTop = false;`, plain);
  const start = renderReadingDocument(plain, { path, blocks: [] });
  start.app.scrollTop = 4000;
  plain.__frames.drain();
  if (start.app.scrollTop !== 0) throw new Error(`a document with nothing to land on came to rest at ${start.app.scrollTop} rather than at its content start`);
});

check('the source button writes down where the reader is, whose document it is, and the block at the top', () => {
  const path = 'C:\\Notes\\toggled.md';
  const { context, app } = bootReading({
    path,
    blocks: [{ srcStart: 0, top: 0 }, { srcStart: 40, top: 100 }, { srcStart: 90, top: 200 }, { srcStart: 150, top: 300 }],
  });
  context.__frames.drain();
  const sent = [];
  context.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
  // Part way down, with the third block at the top edge.
  app.scrollTop = 250;
  context.toggleCodeView();
  const read = (name) => vm.runInContext(name, context);
  if (read('pendingViewLandingPath') !== path) throw new Error(`the landing was stamped with ${JSON.stringify(read('pendingViewLandingPath'))} rather than the document it was taken from`);
  if (read('viewHandoff.readerScrollTop') !== 250) throw new Error(`the reader's pixel was written down as ${read('viewHandoff.readerScrollTop')}`);
  if (read('pendingViewAtTop') !== false) throw new Error('a reader part way down a document was recorded as sitting at the top');
  if (read('pendingCodeViewSrcOffset') !== 90) throw new Error(`the source view was sent to ${read('pendingCodeViewSrcOffset')} rather than the block at the top of the reading view`);
  if (!sent.some((one) => one.command === 'enterCodeView')) throw new Error(`the press asked the host for nothing: ${JSON.stringify(sent)}`);

  // From the very top there is no block to align on, so the other view is told to land flush at its own top.
  app.scrollTop = 0;
  vm.runInContext('pendingViewAtTop = false;', context);
  context.toggleCodeView();
  if (read('pendingViewAtTop') !== true) throw new Error('a reader at the top of the document was not recorded as being there');
  if (read('pendingCodeViewSrcOffset') !== 0) throw new Error(`the top of the document took the offset ${read('pendingCodeViewSrcOffset')}`);
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

  // The page's own record of what is unsaved is empty at every launch, so a restored tab's dot and its one undo step can only come from the tab's own payload — and the page may believe it, never disbelieve it, since typing since the last pause has not reached the host yet.
  check('a tab the host says is unsaved comes back with its dot and its Undo', () => {
    const path = 'C:\\Notes\\restored.md';
    vm.runInContext('dirtyByPath.clear(); undoableByPath.clear();', booted);
    booted.leafSetState({ tabs: [{ path, dirty: true, undoable: true }], active: 0, recent: [], favorites: [], document: null });
    if (!booted.document.getElementById('tabBar').innerHTML.includes('tab-modified')) {
      throw new Error('a restored unsaved tab drew no dot');
    }
    if (vm.runInContext(`dirtyByPath.get(${JSON.stringify(path)})`, booted) !== true) {
      throw new Error("the page did not take the host's word for what is unsaved");
    }
    if (vm.runInContext(`undoableByPath.get(${JSON.stringify(path)})`, booted) !== true) {
      throw new Error('the one step a restored tab holds is unreachable, because the page will not ask for an undo it does not believe in');
    }

    // A clean answer never takes a dot away: the page is the one that is ahead between typing and the pause that reaches the host.
    booted.leafSetState({ tabs: [{ path, dirty: false, undoable: false }], active: 0, recent: [], favorites: [], document: null });
    if (vm.runInContext(`dirtyByPath.get(${JSON.stringify(path)})`, booted) !== true) {
      throw new Error('a payload that had not caught up yet cleared words the reader had just typed');
    }
    vm.runInContext('dirtyByPath.clear(); undoableByPath.clear();', booted);
  });

  check('the strip a tab drag redraws leaves an open source editor exactly where it was', () => {
    // The whole of what a tab drag now sends. A full render would take the source tab off the reading path, throw the editor away and build a new one at the top of the file — so what has to be true is that this call never reaches the editor at all.
    const first = 'C:\\Notes\\one.md';
    const second = 'C:\\Notes\\two.md';
    let disposed = 0;
    const editor = {
      __scrollTop: 4200,
      getScrollTop() { return this.__scrollTop; },
      setScrollTop(next) { this.__scrollTop = next; },
      dispose() { disposed += 1; },
      focus() {},
      updateOptions() {},
    };
    booted.__fakeMonaco = editor;
    try {
      vm.runInContext('monacoEditor = __fakeMonaco; codeViewActive = true;', booted);
      const strip = () => booted.document.getElementById('tabBar').innerHTML;
      const order = () => [...strip().matchAll(/data-tab-path="([^"]*)"/g)].map((one) => one[1]);
      const reorder = (tabs) =>
        booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs, active: tabs.findIndex((t) => t.path === second) });
      reorder([{ path: first }, { path: second }]);
      if (order().join('|') !== `${first}|${second}`) {
        throw new Error(`the strip did not draw the order the host sent: ${JSON.stringify(order())}`);
      }

      // Drag the other tab past the one being read: the strip comes back in the new order and the editor is untouched.
      reorder([{ path: second }, { path: first }]);
      if (order().join('|') !== `${second}|${first}`) {
        throw new Error(`the strip did not redraw the new order: ${JSON.stringify(order())}`);
      }
      if (vm.runInContext('monacoEditor', booted) !== editor) {
        throw new Error('the reorder replaced the editor, so every keystroke of undo in it has gone');
      }
      if (disposed) throw new Error('the reorder threw the editor away');
      if (editor.getScrollTop() !== 4200) {
        throw new Error(`the reader was moved to ${editor.getScrollTop()} instead of being left where they were`);
      }
      if (vm.runInContext('codeViewActive', booted) !== true) {
        throw new Error('the reorder took the source view down');
      }
    } finally {
      vm.runInContext('monacoEditor = null; codeViewActive = false;', booted);
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [], active: null });
    }
  });

  // A source view has two ways of being told where the reader left off, and both of them are decided here rather than by Monaco: the host sends a fraction for a tab coming back or a launch, and sends none on purpose for an in-place rebuild, where the only thing that still knows is the editor about to be thrown away. Monaco cannot load offline, so the decision and the landing are driven straight against a stand-in editor — 10,000px of source in a 1,000px window, so 9,000px of range makes every fraction a round pixel.
  check('a source view comes back where it was left, from the host or from the editor it replaces', () => {
    const path = 'C:\\Notes\\long.md';
    const other = 'C:\\Notes\\other.md';
    const fakeEditor = (scrollTop) => ({
      __scrollTop: scrollTop,
      __revealed: null,
      getScrollTop() { return this.__scrollTop; },
      setScrollTop(next) { this.__scrollTop = next; },
      getScrollHeight: () => 10000,
      getLayoutInfo: () => ({ height: 1000 }),
      revealLineNearTop(line) { this.__revealed = line; },
    });
    const front = (which) =>
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [{ path: which }], active: 0 });
    // Build the replacement editor, hand it a landing, and say where it ended up. It starts at the top the way a real new editor does, unless a case needs to see it move off somewhere else.
    const land = (fraction, srcOffset, text, from = 0) => {
      booted.__fakeMonaco = fakeEditor(from);
      vm.runInContext('monacoEditor = __fakeMonaco;', booted);
      vm.runInContext(
        `pendingCodeViewFraction = ${fraction === null ? 'null' : fraction}; pendingCodeViewSrcOffset = ${srcOffset === null ? 'null' : srcOffset}; pendingViewAtTop = false;`,
        booted
      );
      booted.landNewCodeEditor(text || '');
      return booted.__fakeMonaco;
    };
    try {
      front(path);
      vm.runInContext('codeViewActive = true; viewHandoff = null;', booted);

      // The host's answer, and the one route that is broken today: nothing on the page reads it.
      vm.runInContext('monacoEditor = null; monacoEditorPath = null;', booted);
      if (booted.codeViewLandingFraction({ scrollFraction: 0.5 }) !== 0.5) {
        throw new Error('the page threw away the place the host saved for a returning tab');
      }
      const halfway = land(0.5, null, '').getScrollTop();
      if (halfway !== 4500) throw new Error(`a returning tab landed at ${halfway} instead of halfway down`);

      // `0` is a place and no answer is not: a saved top goes to the top, and a first source view is left alone.
      if (booted.codeViewLandingFraction({ scrollFraction: 0 }) !== 0) {
        throw new Error('a saved place at the top was read as no place at all');
      }
      if (land(0, null, '', 3000).getScrollTop() !== 0) {
        throw new Error('a source view saved at the top did not go back to the top');
      }
      vm.runInContext('monacoEditor = null; monacoEditorPath = null;', booted);
      if (booted.codeViewLandingFraction({}) !== null) {
        throw new Error('a first source view was given a place to land');
      }
      if (land(null, null, '', 3000).getScrollTop() !== 3000) {
        throw new Error('no answer at all still moved the editor');
      }

      // No host answer and the same document: the editor being replaced is what knows. 2,700 of 9,000 is three tenths down.
      booted.__fakeMonaco = fakeEditor(2700);
      vm.runInContext('monacoEditor = __fakeMonaco; monacoEditorPath = __landPath;', Object.assign(booted, { __landPath: path }));
      if (booted.codeViewLandingFraction({}) !== 0.3) {
        throw new Error('a rebuilt source view did not ask the editor it was replacing');
      }
      if (land(0.3, null, '').getScrollTop() !== 2700) {
        throw new Error('a rebuilt source view did not come back to the same place');
      }

      // And a switch to a source tab nobody has ever scrolled takes nothing from the file it came from.
      booted.__fakeMonaco = fakeEditor(2700);
      vm.runInContext('monacoEditor = __fakeMonaco;', booted);
      front(other);
      if (booted.codeViewLandingFraction({}) !== null) {
        throw new Error('an unscrolled tab opened at the place in the file before it');
      }
      front(path);

      // A rename is the one in-place rebuild the host names a place for, because it is the one that moves the path the capture above is keyed on: the live editor still holds the old name, so its own answer is refused, and the host's fraction is taken before that guard is even reached.
      booted.__fakeMonaco = fakeEditor(2700);
      vm.runInContext('monacoEditor = __fakeMonaco; monacoEditorPath = __oldPath;', Object.assign(booted, { __oldPath: other }));
      if (booted.codeViewLandingFraction({}) !== null) {
        throw new Error('a renamed document spent a place captured under its old name');
      }
      if (booted.codeViewLandingFraction({ scrollFraction: 0.61 }) !== 0.61) {
        throw new Error('a rename threw away the place its own tab was holding');
      }
      if (land(0.61, null, '').getScrollTop() !== 5490) {
        throw new Error('a renamed source view did not come back where it was');
      }

      // Neither answer takes the toggle's, which is the more exact of the three: the pixel it saved when nothing moved under it.
      vm.runInContext(
        'viewHandoff = { path: __landPath, readerScrollTop: 100, codeScrollTop: 777, readerLanded: null, codeLanded: null, restoreExact: true };',
        booted
      );
      if (land(0.5, null, '').getScrollTop() !== 777) {
        throw new Error('a fraction overrode the exact pixel the toggle saved');
      }

      // Nor the line the toggle was reading, which is scrolled to rather than placed.
      vm.runInContext('viewHandoff = null;', booted);
      const revealed = land(0.5, 12, 'line one\nline two\nline three');
      if (revealed.__revealed !== 2) {
        throw new Error(`the toggle's own line was not the landing: ${revealed.__revealed}`);
      }
      if (revealed.getScrollTop() !== 0) {
        throw new Error('a fraction moved an editor the toggle had already placed by line');
      }
    } finally {
      vm.runInContext(
        'monacoEditor = null; monacoEditorPath = null; codeViewActive = false; viewHandoff = null; pendingCodeViewFraction = null; pendingCodeViewSrcOffset = null;',
        booted
      );
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [], active: null });
    }
  });

  // One gesture writes down four landings before the host is asked for anything, and four things can then abandon the source-view entry without rendering -- so the landings stand and the next document opened spends them. Neither the fetch nor Monaco can be driven here, so the landing is armed by hand the way the tests above arm one, and the three places it is spent are driven against the wrong document. Same 10,000px of source in a 1,000px window, so 9,000px of range makes every fraction a round pixel.
  check('a landing armed on one document is not spent on the next one', () => {
    const armed = 'C:\Notes\armed.md';
    const next = 'C:\Notes\next.md';
    const front = (which) =>
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [{ path: which }], active: 0 });
    // Everything one press of the source button writes down, stamped with the document it was taken from -- see toggleCodeView.
    const arm = (which) =>
      vm.runInContext(
        `pendingViewLandingPath = ${JSON.stringify(which)}; pendingViewScrollFraction = 0.5; pendingViewAtTop = false; pendingCodeViewSrcOffset = 30; pendingReadingSrcOffset = 30;`,
        booted
      );
    const landings = () =>
      vm.runInContext(
        'JSON.stringify([pendingViewLandingPath, pendingViewScrollFraction, pendingViewAtTop, pendingCodeViewSrcOffset, pendingReadingSrcOffset])',
        booted
      );
    const sourceText = 'aaaa\n'.repeat(40);
    const fakeEditor = (scrollTop) => ({
      __scrollTop: scrollTop,
      __revealed: null,
      getScrollTop() { return this.__scrollTop; },
      setScrollTop(next2) { this.__scrollTop = next2; },
      getScrollHeight: () => 10000,
      getLayoutInfo: () => ({ height: 1000 }),
      revealLineNearTop(line) { this.__revealed = line; },
    });
    const buildEditor = (from) => {
      booted.__fakeMonaco = fakeEditor(from);
      vm.runInContext('monacoEditor = __fakeMonaco;', booted);
      return booted.__fakeMonaco;
    };
    try {
      vm.runInContext('viewHandoff = null; currentState = Object.assign({}, currentState, { document: null }); app.scrollHeight = 10000; app.clientHeight = 1000; app.scrollTop = 0;', booted);

      // The source view: a line armed on one document is not the line the next document's source opens on, and the place the host sent for the document actually open is what it lands on instead.
      arm(armed);
      front(next);
      vm.runInContext('pendingCodeViewFraction = 0.4;', booted);
      const opened = buildEditor(0);
      booted.landNewCodeEditor(sourceText);
      if (opened.__revealed !== null) {
        throw new Error(`a source line armed on another document was revealed at line ${opened.__revealed}`);
      }
      if (opened.getScrollTop() !== 3600) {
        throw new Error(`the source view landed at ${opened.getScrollTop()} instead of the place the host sent for it`);
      }

      // Dropped, not held: nobody is coming for a landing whose render never happened, so going back to the document that armed it finds nothing to spend.
      if (landings() !== '[null,null,false,null,null]') {
        throw new Error(`a refused landing was held rather than dropped: ${landings()}`);
      }
      front(armed);
      vm.runInContext('pendingCodeViewFraction = null;', booted);
      const revisited = buildEditor(2200);
      booted.landNewCodeEditor(sourceText);
      if (revisited.__revealed !== null || revisited.getScrollTop() !== 2200) {
        throw new Error('the document that armed the landing spent it on a later visit');
      }

      // The reading view, through the render itself rather than by calling the reset by hand: the guard sits at the head of the render, so a document arriving with another document's landing armed drops it before any of the four landings below can spend it. The second block holds the armed source offset, so an unguarded render would open a file 900px down. On a page of its own, because a document left standing on the shared page is what the next check reads as its own.
      const openedOn = (whose) => {
        const page = runShell(source);
        vm.runInContext(
          `pendingViewLandingPath = ${JSON.stringify(whose)}; pendingViewScrollFraction = 0.5; pendingViewAtTop = false; pendingCodeViewSrcOffset = 30; pendingReadingSrcOffset = 30;`,
          page
        );
        const rendered = renderReadingDocument(page, { path: next, blocks: [{ srcStart: 0, top: 0 }, { srcStart: 30, top: 900 }] });
        page.__frames.drain();
        return { page, ...rendered };
      };
      const wrong = openedOn(armed);
      if (
        vm.runInContext(
          'JSON.stringify([pendingViewLandingPath, pendingViewScrollFraction, pendingViewAtTop, pendingCodeViewSrcOffset, pendingReadingSrcOffset])',
          wrong.page
        ) !== '[null,null,false,null,null]'
      ) {
        throw new Error("the render spent another document's landing rather than dropping it");
      }
      if (wrong.app.scrollTop !== 0) {
        throw new Error(`a fresh document opened ${wrong.app.scrollTop}px down at another document's landing`);
      }

      // And the same document's own landing still lands, or the guard would have taken the toggle with it.
      const right = openedOn(next);
      if (right.app.scrollTop !== 900) {
        throw new Error(`the toggle's own landing no longer lands: ${right.app.scrollTop}`);
      }
    } finally {
      vm.runInContext(
        'monacoEditor = null; monacoEditorPath = null; codeViewActive = false; viewHandoff = null; pendingCodeViewFraction = null; pendingCodeViewSrcOffset = null; pendingReadingSrcOffset = null; pendingViewScrollFraction = null; pendingViewAtTop = false; pendingViewLandingPath = null; app.scrollHeight = 0; app.clientHeight = 0; app.scrollTop = 0;',
        booted
      );
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [], active: null });
    }
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

  check('leaving the window closes a list of vaults and leaves a vault settings panel standing', () => {
    // Another program's window coming forward, which is all a blur is.
    const leaveTheWindow = () => {
      for (const handler of [...(booted.window.__windowListeners.get('blur') || [])]) handler({});
    };
    const button = fakeElement('libraryVaultSwitch');
    button.classList.add('library-vault-switch');
    booted.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    const event = { button: 0, stopPropagation() {}, preventDefault() {} };
    booted.leafSetVaults({ vaults: VAULTS, active: 1 });

    press(event);
    if (vm.runInContext('crumbMenu.hidden', booted)) throw new Error('the switcher did not open its list of vaults');
    leaveTheWindow();
    // A list is a menu: one press from coming back, and leaving it hanging over a window nobody is in is the odd behavior.
    if (!vm.runInContext('crumbMenu.hidden', booted)) throw new Error('a list of vaults outlived the window it hangs in');

    press(event);
    const row = vm.runInContext('vaultMenuItems()', booted).find((one) => one && one.edit);
    if (!row) throw new Error('no vault row offers its own settings');
    row.edit();
    if (vm.runInContext('crumbMenu.hidden', booted) || !vm.runInContext('crumbMenuVault', booted)) {
      throw new Error("the settings button did not open that vault's settings panel");
    }
    leaveTheWindow();
    // The panel is a place work is done, and its own rows send the reader to a browser and then ask them to paste what it gives them back in here -- so closing it on the way out takes away the field they were sent to fill.
    if (vm.runInContext('crumbMenu.hidden', booted)) {
      throw new Error('a vault settings panel shut itself when the window lost focus, with nobody pressing anything');
    }

    vm.runInContext('hideCrumbMenu()', booted);
    booted.leafSetVaults({ vaults: [], active: 0 });
  });

  check('the home vault switcher keeps the regular marks and leaves room before its name', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const switcher = (css.split('\n.library-vault-switch {\n')[1] || '').split('}')[0];
    const edge = /\n {2}padding: 0 (var\(--lt-space-\d+\));\n/.exec(switcher);
    if (!edge) throw new Error('the vault switcher no longer pays one token either side');
    // Read against the switcher's own padding rather than spelled out here: the start screen's copy cancels it, and a value written twice drifts.
    const home = css.split('.home-vault-switch {')[1];
    if (!home || !home.startsWith(`\n  margin-left: calc(-1 * ${edge[1]});\n  gap: var(--lt-space-4);`)) {
      throw new Error(`the home switcher does not cancel the switcher's own ${edge[1]} of padding, or does not leave room between its icon and name`);
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

  /** The three lines the start screen rotates, read back off the screen it drew. */
  function messageOnScreen(markup) {
    const slot = (pattern) => (markup.match(pattern) || [])[1];
    return {
      hero: slot(/<h1>([^<]*)</),
      subtitle: slot(/<p class="empty-subtitle">([^<]*)</),
      description: slot(/<p class="empty-description">([^<]*)</),
    };
  }

  /** Walk back onto the start screen, so the page picks a message the way a reader arriving does. */
  function anotherHomeVisit() {
    booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
    booted.__frames.drain();
    return messageOnScreen(homeElement.innerHTML);
  }

  check('a vault switch keeps the whole message under the kicker', () => {
    onTheStartScreen(KEPT, (screen) => {
      const before = messageOnScreen(screen());
      if (!before.hero || !before.subtitle || !before.description) {
        throw new Error(`the start screen drew an incomplete message: ${JSON.stringify(before)}`);
      }
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      const after = messageOnScreen(screen());
      for (const slot of ['hero', 'subtitle', 'description']) {
        if (after[slot] !== before[slot]) {
          throw new Error(`the ${slot} was reshuffled by a vault switch: ${before[slot]} became ${after[slot]}`);
        }
      }
    });
  });

  check('every visit to the start screen draws one family whole', () => {
    // A headline from one family over a sentence from another is the failure this is here for: the three lines are one voice, so they are read back together and matched to the family that owns the headline.
    const families = vm.runInContext('HOME_MESSAGE_FAMILIES', booted);
    const seen = new Set();
    let previous = null;
    try {
      for (let visit = 0; visit < 200; visit += 1) {
        const shown = anotherHomeVisit();
        const family = families.find((one) => one.hero === shown.hero);
        if (!family) throw new Error(`the headline belongs to no family: ${JSON.stringify(shown)}`);
        if (shown.subtitle !== family.subtitle) {
          throw new Error(`${family.name} drew another family's subtitle: ${shown.subtitle}`);
        }
        if (!family.descriptions.includes(shown.description)) {
          throw new Error(`${family.name} drew a sentence out of another pool: ${shown.description}`);
        }
        if (family.name === previous) throw new Error(`two visits in a row showed ${family.name}`);
        previous = family.name;
        seen.add(family.name);
      }
    } finally {
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
    if (seen.size !== families.length) {
      throw new Error(`only ${seen.size} of ${families.length} families came up over 200 visits`);
    }
  });

  check('the rotating message is escaped on its way onto the screen', () => {
    // The copy is ours, so this is not about hostile input — it is that all three slots go through the same escape the sentence always did, and a later line carrying an ampersand or an angle bracket must not reach the page as markup.
    const families = vm.runInContext('HOME_MESSAGE_FAMILIES', booted);
    const wasHero = families[0].hero;
    try {
      vm.runInContext("HOME_MESSAGE_FAMILIES[0].hero = 'Leaves & <b>ink</b>'; lastHomeFamilyName = null;", booted);
      let markup = '';
      for (let visit = 0; visit < 50 && !markup.includes('Leaves'); visit += 1) {
        anotherHomeVisit();
        markup = homeElement.innerHTML;
      }
      if (!markup.includes('Leaves')) throw new Error('that family never came up over 50 visits');
      if (!markup.includes('Leaves &amp; &lt;b&gt;ink&lt;/b&gt;')) {
        throw new Error(`the headline reached the page unescaped: ${markup.slice(0, 400)}`);
      }
    } finally {
      vm.runInContext(`HOME_MESSAGE_FAMILIES[0].hero = ${JSON.stringify(wasHero)}; lastHomeFamilyName = null;`, booted);
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('the fixed half of the start screen never moves with the family', () => {
    // Everything a reader presses, plus the kicker, the lists and the version line, is functional copy outside the registry. Rotating one of them by accident is a control that renames itself between visits.
    const fixed = (markup) =>
      markup.replace(/<h1>[^<]*<\/h1>/, '').replace(/<p class="empty-(?:subtitle|description)">[^<]*<\/p>/g, '');
    anotherHomeVisit();
    const first = fixed(homeElement.innerHTML);
    for (let visit = 0; visit < 60; visit += 1) {
      anotherHomeVisit();
      if (fixed(homeElement.innerHTML) !== first) {
        throw new Error(`the rest of the start screen changed with the family: ${fixed(homeElement.innerHTML)}`);
      }
    }
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

  // All four bottom sheets close through one helper, and the only thing they say about how is whether a hand did it. A drag has already supplied the wind-up, so repeating it would pull the sheet back up out from under the finger that just threw it away.
  check('a dragged sheet says so, and skips the wind-up the other dismissals make', () => {
    const sheet = fakeElement('draggedSheet');
    const grip = fakeElement('draggedGrip');
    sheet.getBoundingClientRect = () => ({ top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300 });
    sheet.classList.add('open');
    const asked = [];
    booted.makeSheetDraggable(sheet, grip, (options) => asked.push(options));
    const press = grip.listeners.get('pointerdown')[0];
    const move = grip.listeners.get('pointermove')[0];
    const up = grip.listeners.get('pointerup')[0];
    press({ button: 0, pointerId: 1, clientY: 0, timeStamp: 0, preventDefault() {} });
    // Most of the way down a 300px sheet, which is past the fraction the helper dismisses at.
    move({ pointerId: 1, clientY: 250, timeStamp: 100 });
    up({ pointerId: 1, timeStamp: 120 });
    if (asked.length !== 1) throw new Error(`the drag asked to close ${asked.length} times`);
    if (!asked[0] || asked[0].dragged !== true) throw new Error(`a drag off did not say so: ${JSON.stringify(asked[0])}`);

    // Which exit a close draws, read at the moment it registers the fallback timer behind its animation. Nothing here ever tells the sheet its animation ended, so the fallback alone has to take it away: an end event that goes missing must not leave a dismissed sheet standing on the window.
    const exitOf = (options) => {
      const seen = [];
      const moving = fakeElement('closingSheet');
      const scrim = fakeElement('closingScrim');
      moving.classList.add('open');
      scrim.classList.add('open');
      const wasTimeout = booted.setTimeout;
      booted.setTimeout = (fn) => {
        for (const name of ['is-leaving', 'is-boosting']) {
          if (moving.classList.contains(name)) seen.push(name);
        }
        // The scrim waits out the wind-up so the two leave together, and only a dismissal that has one takes the wait.
        if (scrim.classList.contains('is-held')) seen.push('scrim held');
        fn();
        return 0;
      };
      try {
        booted.closeSheet(moving, scrim, options);
      } finally {
        booted.setTimeout = wasTimeout;
      }
      // The hide waits for the whole animation, never for whichever end arrives first: with a wind-up in front of the exit that takes the sheet away half-way up, which is how three of these once went.
      if (!moving.hidden || !scrim.hidden) throw new Error('the close ended with the sheet still showing');
      if (moving.classList.contains('is-leaving') || moving.classList.contains('is-boosting')) {
        throw new Error('the sheet kept its exit class after it had gone');
      }
      if (scrim.classList.contains('is-held')) throw new Error('the scrim kept its wait after the sheet had gone');
      return seen.join();
    };
    const pressed = exitOf();
    if (pressed !== 'is-leaving,scrim held') throw new Error(`a button, scrim or Escape dismissal drew ${pressed || 'nothing'}`);
    const flung = exitOf({ dragged: true });
    if (flung !== 'is-boosting') throw new Error(`a drag off drew ${flung || 'nothing'}`);

    // Reduce Motion zeroes every duration in the stylesheet, and a zeroed animation fires no end event at all. So a dismissed sheet goes at once instead of sitting out the fallback, which with motion off held one on the window for a measured 440ms.
    const still = fakeElement('stillSheet');
    still.classList.add('open');
    still.style.setProperty('animation-duration', '0s');
    let waits = 0;
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      waits += 1;
      fn();
      return 0;
    };
    try {
      booted.closeSheet(still, null, null);
    } finally {
      booted.setTimeout = wasTimeout;
    }
    if (waits !== 0) throw new Error(`a close with motion off waited on ${waits} timer(s)`);
    if (!still.hidden) throw new Error('a close with motion off left the sheet showing');
  });

  // The entrance takes the same one-animation path as the exit, and for a reason of its own: a sheet coming off `display: none` has no before-change style for a transition to move from, so a rise written as one does not draw at all and the sheet appears already raised.
  check('a sheet lands on one animation, and is never left holding its landing', () => {
    const sheet = fakeElement('landingSheet');
    const scrim = fakeElement('landingScrim');
    sheet.hidden = true;
    scrim.hidden = true;
    // Left on the scrim by a dismissal this very open interrupted. Carried into the entrance it would hold the dimming back for a wind-up nobody is making.
    scrim.classList.add('is-held');
    let waits = 0;
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = () => {
      waits += 1;
      return 0;
    };
    try {
      booted.openSheet(sheet, scrim);
    } finally {
      booted.setTimeout = wasTimeout;
    }
    if (sheet.hidden || scrim.hidden) throw new Error('the open left the sheet or its scrim hidden');
    if (!sheet.classList.contains('open') || !sheet.classList.contains('is-landing')) {
      throw new Error(`the open drew ${sheet.className || 'nothing'}`);
    }
    if (scrim.classList.contains('is-held')) throw new Error('the scrim carried a dismissal wait into an entrance');
    if (waits !== 1) throw new Error(`the entrance registered ${waits} fallback timers rather than one`);
    // The animation ends and the class goes, so nothing is left holding the sheet off its seat.
    (sheet.listeners.get('animationend') || []).slice().forEach((handler) => handler({ target: sheet }));
    if (sheet.classList.contains('is-landing')) throw new Error('the sheet kept its landing class after it had landed');
    if (!sheet.classList.contains('open')) throw new Error('the landing took the sheet out of its open state');

    // And where that end never arrives, the fallback clears it just the same.
    const slow = fakeElement('slowSheet');
    slow.hidden = true;
    const wasSlowTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      booted.openSheet(slow, null);
    } finally {
      booted.setTimeout = wasSlowTimeout;
    }
    if (slow.classList.contains('is-landing')) throw new Error('a landing whose end never arrived was left on the sheet');
    if (!slow.classList.contains('open')) throw new Error('a landing on the fallback did not leave the sheet open');
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
    // The wearer class is in the same store the stamps go into, because the box answers the page's own list by what it wears rather than by being told yes.
    const classes = new Set(['leaf-scroll']);
    const box = Object.assign(fakeElement('gutter'), {
      clientWidth: 286,
      clientHeight: 400,
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
    const other = Object.assign(fakeElement('plain'), { clientWidth: 0, clientHeight: 0 });
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

  // The one refusal in the wearer list, and the one child step in it. Neither is a class a box can simply wear, so a matcher reading only a class leaves the pointer check handing itself the answer.
  check('the wearer list refuses a reading surface with a minimap and takes a table only inside its lane', () => {
    const gutter = (box) => {
      booted.leafMarkPointing({ target: box, offsetX: box.clientWidth + 4, offsetY: 20 });
      const raised = box.classList.contains('is-pointing');
      booted.leafMarkPointing(null);
      return raised;
    };
    const sized = (box) => Object.assign(box, { clientWidth: 200, clientHeight: 300 });

    const readers = fakeElement('reader-pair');
    readers.innerHTML = '<section class="reader-shell">plain</section><section class="reader-shell has-minimap">mapped</section>';
    if (!gutter(sized(readers.children[0]))) throw new Error('a reading surface with no minimap was refused by the entry that names it');
    if (gutter(sized(readers.children[1]))) throw new Error('a reading surface with a minimap raised a bar the list refuses it');

    const lane = fakeElement('table-pair');
    lane.innerHTML = '<div class="table-lane"><table>inside</table></div><table>outside</table>';
    if (!gutter(sized(lane.children[0].children[0]))) throw new Error('a table inside its lane was refused by the child step that names it');
    if (gutter(sized(lane.children[1]))) throw new Error('a table with no lane above it answered a child step');

    // The descendant step, and the entry inside it that names what is inside a code block rather than the block's own holder.
    const doc = fakeElement('document-pair');
    doc.innerHTML = '<div class="document-body"><pre>fenced<code>inner</code></pre></div><pre>loose</pre>';
    const fenced = doc.children[0].children[0];
    if (!gutter(sized(fenced))) throw new Error('a code block inside the document body was refused by the descendant step that names it');
    if (gutter(sized(doc.children[1]))) throw new Error('a code block with no document body above it answered a descendant step');
    if (!gutter(sized(fenced.children[0]))) throw new Error('the code inside a fenced block was refused by the entry that names it');
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

  // A vault that quietly read three quarters of itself is worse than one that read all of it slowly, so the line above the rows says what the walk did not go into — and says nothing where it went into everything.
  check('the count line says how many folders of generated files went unread', () => {
    showingLibrarySearch();
    booted.leafSetSearchResults({
      query: 'draft',
      hits: [searchHit('A note')],
      truncated: false,
      skipped: ['app/target', 'site/node_modules'],
    });
    // The count line alone: the rows under it carry titles of their own.
    const countLine = () => (searchPane().innerHTML.match(/<p class="library-results-count"[^>]*>.*?<\/p>/) || [''])[0];
    const drawn = countLine();
    if (!drawn.includes('2 folders of generated files not read')) {
      throw new Error(`the count line did not say what was left out: ${drawn}`);
    }
    // The names ride on the element's own title rather than on a control of their own.
    if (!drawn.includes('app/target, site/node_modules')) {
      throw new Error('the count line did not carry the folder names');
    }
    if (!drawn.includes('1 results')) throw new Error('the clause replaced the count instead of joining it');

    // One folder reads as one, not as "1 folders".
    booted.leafSetSearchResults({
      query: 'draft',
      hits: [searchHit('A note')],
      truncated: false,
      skipped: ['app/target'],
    });
    if (!searchPane().innerHTML.includes('1 folder of generated files not read')) {
      throw new Error('one folder was counted in the plural');
    }

    // And a vault with nothing left out says nothing at all.
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });
    const clean = countLine();
    if (clean.includes('generated files')) throw new Error('a vault that was read whole still said something was left out');
    if (clean.includes('title=')) throw new Error('a vault with nothing left out still carried a title');
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
    // Kept rather than deleted afterwards: the page's own markup property is the element's own, so deleting this one leaves the pane with a plain field that builds no children, and every later check reads a pane the page never drew into.
    const wasMarkup = Object.getOwnPropertyDescriptor(tree, 'innerHTML');
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

      // What `git status` writing inside `.git` arrives as, 6.4 times a second: the same folder, the same files.
      booted.leafSetLibraryFolder(folder(two.map((entry) => ({ ...entry }))));
      if (writes !== drawn) throw new Error('a read describing what is already drawn rewrote the rows anyway');

      // A real change still redraws, or the pane would go deaf to the thing it exists for.
      booted.leafSetLibraryFolder(folder(two.concat([{ kind: 'file', name: 'PLAN.md', path: 'C:\\Vaults\\Work\\PLAN.md' }])));
      if (writes === drawn) throw new Error('a file appearing in the folder on screen never reached the pane');
    } finally {
      Object.defineProperty(tree, 'innerHTML', wasMarkup);
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
    // The button the page drew, taken off the pane the way the page takes it.
    const introAction = () => libraryTreeElement.querySelector('.library-intro-action');
    const metNames = () => {
      const saves = sent.filter((one) => one.command === 'setHintState');
      return saves.length ? saves[saves.length - 1].seen : [];
    };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));

      // Its own button: the command the pane's menu already sends, and the box gone for good.
      paneWith({});
      const introButton = introAction();
      if (!introButton) throw new Error('the box drew no button to press');
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

// The request half of the CORS pair: a script fetched without anonymous mode has every throw inside it masked as `Script error.` with no place, whatever the response allows. The response half — the asset handler's allow-origin header — is held by src/tests/theme_registry.rs, and the page's own tag by src/tests/app_shell_chrome.rs.
check('every constructed script tag asks for its errors unmasked', () => {
  const constructors = [...source.matchAll(/document\.createElement\('script'\)/g)];
  if (constructors.length < 3) {
    throw new Error(`expected the Mermaid, KaTeX, and shared lazy-script constructors, found ${constructors.length}`);
  }
  for (const match of constructors) {
    const appended = source.indexOf('appendChild', match.index);
    const constructor = source.slice(match.index, appended === -1 ? match.index + 400 : appended);
    if (!constructor.includes(".crossOrigin = 'anonymous'")) {
      throw new Error(`a constructed script tag loads without anonymous mode: ${constructor.slice(0, 200)}`);
    }
  }
});

// ---- 6a. a source view that will not open says so and gives the document back ----
//
// Both ways into the source view can give up, and each has to draw something: the editor's own load fails after the reader has already been emptied into its container, and the staged payload fails before that. Drawing nothing leaves the reader a blank page the app is calling the source view, or a press that did nothing. Driven rather than read, because what is being held is a growl on the surface and a command on the wire.

/** A booted page with one document open, its ipc recording, and the reader's own scroll position remembered the way the toggle remembers it. */
function bootEnteringSource(extras = {}) {
  const context = runShell(source, extras);
  const posted = [];
  context.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
  vm.runInContext("currentState = { recent: [], tabs: [{ path: 'notes.md' }], active: 0, document: {} };", context);
  vm.runInContext("viewHandoff = { path: 'notes.md', readerScrollTop: 940, codeScrollTop: null, readerLanded: 940, codeLanded: null, restoreExact: false };", context);
  const surface = context.document.getElementById('appSurface');
  return {
    context,
    posted,
    growls: () => surface.children.filter((child) => String(child.className || '').includes('app-toast')),
  };
}

/** Everything the two paths owe a reader, read off the page and the wire. */
function saidAndWentBack(page, what) {
  const growls = page.growls();
  if (growls.length !== 1) throw new Error(`${what}: expected one growl, got ${growls.length}`);
  const said = String(growls[0].textContent);
  if (!said.includes('source view could not be opened')) throw new Error(`${what}: the growl said "${said}"`);
  if (!growls[0].className.includes('is-error')) throw new Error(`${what}: a failure drew the quiet growl`);
  if (!page.posted.some((one) => one.command === 'exitCodeView')) {
    throw new Error(`${what}: the tab was left marked as being in source view — sent ${JSON.stringify(page.posted)}`);
  }
  // The reader was part way down a page, so the reading render owes them that pixel rather than the top the host's reset intent asks for.
  if (vm.runInContext('viewHandoff.restoreExact', page.context) !== true) {
    throw new Error(`${what}: going back was not armed to land where the reader was`);
  }
}

checkSettled('the source editor refusing to load says so and gives the document back', async () => {
  const page = bootEnteringSource();
  // The vendored bundle is fetched as a script tag the stand-in page never resolves, so the refusal is put where a missing or broken asset puts it.
  vm.runInContext("loadScriptOnce = () => Promise.reject(new Error('the bundle would not load'));", page.context);
  vm.runInContext("codeViewActive = true; renderCodeView({ text: 'a line of source', language: 'markdown' });", page.context);
  await new Promise((resolve) => setImmediate(resolve));
  page.context.__frames.drain();
  await new Promise((resolve) => setImmediate(resolve));
  saidAndWentBack(page, 'the editor giving up');
  // The state this check is about: the reader has been emptied into the editor's container and there is nothing in it. If that stops being true the check is passing on a different failure and says so.
  if (!vm.runInContext("app.className.includes('code-view-monaco-shell') && app.textContent === ''", page.context)) {
    throw new Error('the editor path no longer leaves the reader emptied, so this check is holding something else');
  }
});

checkSettled('the staged source payload refusing to arrive says so too', async () => {
  const page = bootEnteringSource({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  page.context.window.leafLoadCodeView('leaf-source://1');
  await new Promise((resolve) => setImmediate(resolve));
  page.context.__frames.drain();
  await new Promise((resolve) => setImmediate(resolve));
  saidAndWentBack(page, 'the payload giving up');
  // This path fails before the reader is replaced, so what it must not do is disturb the document that is still on screen.
  if (vm.runInContext('codeViewActive', page.context) !== false) {
    throw new Error('the page thinks it entered the source view on a payload that never arrived');
  }
});

checkSettled('a refused source editor is not the answer to the next press', async () => {
  const page = bootEnteringSource();
  let attempts = 0;
  vm.runInContext("loadScriptOnce = () => { __attempt(); return Promise.reject(new Error('the bundle would not load')); };", page.context);
  page.context.__attempt = () => {
    attempts += 1;
  };
  const settle = () => vm.runInContext("loadMonacoOnce().then(() => 'loaded', (error) => 'refused: ' + error.message)", page.context);
  const first = await settle();
  if (first !== 'refused: the bundle would not load') throw new Error(`the first press settled as ${first}`);
  // The whole point: the second press builds its own attempt rather than being handed the one that already failed.
  if (vm.runInContext('monacoLoadPromise', page.context) !== null) {
    throw new Error('the refusal is still held, so every later press gets it back');
  }
  const second = await settle();
  if (second !== 'refused: the bundle would not load') throw new Error(`the second press settled as ${second}`);
  if (attempts !== 2) throw new Error(`two presses made ${attempts} attempts at the bundle`);
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
      leaf_set_image_base: (pointer, length) => {
        asked.push({ call: 'setImageBase', base: take(pointer, length) });
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
async function bootWebHost({ pending = [], documents = SERVED_DOCUMENTS, name = '', kept = {} } = {}) {
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

  // The browser's own store, and the file the published page reads it back with — run here the way the page runs it, above the host, because the host seeds itself out of what it finds there.
  const store = new Map(Object.entries(kept));
  context.window.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  // The line the module's own boot script writes: the state the page starts from, with neither list in it.
  context.window.__leafInitialState = { recent: [], favorites: [], tabs: [], active: null, document: null };
  new vm.Script(readFileSync(join(root, 'web/preview/settings.js'), 'utf8'), { filename: 'settings.js' }).runInContext(context);

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
  new vm.Script(host.replace(/^export /gm, '') + '\nglobalThis.__startLeaftext = startLeaftext;\nglobalThis.__COMMANDS = COMMANDS;\nglobalThis.__answers = answers;\nglobalThis.__LATER = LATER;\nglobalThis.__landingPath = landingPath;', {
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
    // What the browser would still be holding after a reload.
    stored: () => JSON.parse(store.get('leaftext.settings') || '{}'),
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

// A site's front door. The listing is ordered shallowest first and then by name, so a root GLOSSARY.md beats the README beside it — which is how a published site came to open on whatever sorted first rather than on the page its author would call its front.
checkSettled('a site opens its own front page, and the leaf comes back to it', async () => {
  // The same landing, opened the way the published boot opens it: the rule, handed to openAddress as the fallback.
  const land = async (documents) => {
    const booted = await bootWebHost({ documents });
    await booted.leaf.openAddress(booted.context.__landingPath(documents));
    const opened = booted.asked.filter((one) => one.call === 'documentScript');
    return Object.assign(booted, { landed: opened.length ? opened[opened.length - 1].path : null });
  };
  const at = (booted) => {
    const opened = booted.asked.filter((one) => one.call === 'documentScript');
    return opened.length ? opened[opened.length - 1].path : null;
  };

  const readme = await land([{ path: 'GLOSSARY.md' }, { path: 'README.md' }, { path: 'index.md' }, { path: 'notes/one.md' }]);
  if (readme.landed !== 'README.md') throw new Error(`a site with a README at the top of it opened ${JSON.stringify(readme.landed)}`);

  const index = await land([{ path: 'GLOSSARY.md' }, { path: 'index.html.md' }, { path: 'notes/one.md' }]);
  if (index.landed !== 'index.html.md') throw new Error(`a site with an index and no README opened ${JSON.stringify(index.landed)}`);

  // Neither name at the top: the first document the listing serves, which is the order the Previous/Next strip walks.
  const neither = await land([{ path: 'GLOSSARY.md' }, { path: 'notes/README.md' }]);
  if (neither.landed !== 'GLOSSARY.md') throw new Error(`a site with neither name at its top opened ${JSON.stringify(neither.landed)}`);

  // The spelling is the author's, so the test is not.
  const lower = await land([{ path: 'aaa.md' }, { path: 'readme.md' }]);
  if (lower.landed !== 'readme.md') throw new Error(`a lower-case readme did not land: ${JSON.stringify(lower.landed)}`);

  // A document named in the bar is the reader asking for that one; the landing is only ever the fallback.
  const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];
  const asked_ = await bootWebHost({ documents });
  asked_.context.__address.history.replaceState(null, '', '#notes/two.md');
  await asked_.leaf.openAddress(asked_.context.__landingPath(documents));
  if (at(asked_) !== 'notes/two.md') throw new Error(`an address naming a document opened ${JSON.stringify(at(asked_))}`);

  // The leaf: the same function's answer, so the way back cannot disagree with the way in.
  asked_.send({ command: 'goHome' });
  await settle();
  if (at(asked_) !== 'README.md') throw new Error(`the leaf went to ${JSON.stringify(at(asked_))} instead of the site's front page`);
});

/** The published boot itself, run the way the page runs it: its own file, its one import answered by the host already evaluated in this context, and every fetch answered by the check. A module's body runs inside a call, which is what the wrapper is for — the file has a top-level await and a script may not. */
async function runSiteBoot(answer) {
  const module_ = standInModule();
  const context = runShell(source, {
    __leafPending: [],
    fetch: async (url) => answer(String(url)),
    WebAssembly: {
      Memory: WebAssembly.Memory,
      instantiate: async () => ({ instance: { exports: module_.exports } }),
    },
  });
  context.window.ipc = { postMessage: noopPost };
  // Recorded rather than run, the way the host boot beside this one does it: the state call renders a whole document, and nothing is rendered on this page for it to render into.
  const state = [];
  context.window.leafSetState = (payload) => state.push(payload);
  const host = readFileSync(join(root, 'web/preview/host.js'), 'utf8');
  new vm.Script(host.replace(/^export /gm, ''), { filename: 'host.js' }).runInContext(context);
  const boot = readFileSync(join(root, 'web/preview/boot.js'), 'utf8');
  await new vm.Script(`(async () => {\n${boot.replace(/^import .*$/gm, '')}\n})()`, { filename: 'boot.js' }).runInContext(context);
  return { context, state, asked: module_.asked };
}

/** Every file a healthy site is served, answered from one listing. */
const servedFiles = (documents) => async (url) => {
  if (url.endsWith('.wasm')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), url };
  if (url === 'documents.json') return { ok: true, json: async () => ({ name: 'site', documents }), url };
  if (url.startsWith('source/')) return { ok: true, text: async () => `# ${url}\n\nWords.\n`, url };
  return { ok: false, status: 404, url };
};

// A site opened straight off a folder on the disk fetches nothing at all, and a publish that went out short fetches most of it. Neither may kill the boot silently and leave the reader at the empty start screen, reading it as a site with no documents in it.
checkSettled('a file that did not arrive is named on the page instead of killing the boot quietly', async () => {
  const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }];

  const healthy = await runSiteBoot(servedFiles(documents));
  const drawn = String(healthy.context.document.getElementById('app').innerHTML || '');
  if (drawn.includes('did not arrive')) throw new Error(`a site whose files all arrived said one had not: ${drawn.slice(0, 400)}`);
  // And it landed on the site's own front page, which is the whole boot walked end to end.
  const landed = healthy.state[healthy.state.length - 1];
  if (!landed || !landed.document || landed.document.path !== 'README.md') {
    throw new Error(`the published boot landed on ${JSON.stringify(landed && landed.document && landed.document.path)}`);
  }

  // The listing itself, which is what a folder opened off the disk fails at first.
  const noListing = await runSiteBoot(async () => {
    throw new TypeError('Failed to fetch');
  });
  const said = String(noListing.context.document.getElementById('app').innerHTML || '');
  if (!said.includes('did not arrive')) throw new Error(`a site with no listing said nothing: ${said.slice(0, 300)}`);
  if (!said.includes('documents.json')) throw new Error(`the message did not name the file that did not arrive: ${said.slice(0, 300)}`);

  // One document short: published, listed, and not in the folder.
  const served = servedFiles(documents);
  const shortOne = await runSiteBoot(async (url) => (url === 'source/README.md' ? { ok: false, status: 404, url } : served(url)));
  const missing = String(shortOne.context.document.getElementById('app').innerHTML || '');
  if (!missing.includes('source/README.md')) throw new Error(`a missing document was not named: ${missing.slice(0, 300)}`);
});

// A published site's page sits at the top and its documents sit under `source/`, so a picture beside a document is only reachable through that folder. Told rather than guessed: the module resolves the address, and without this call it resolves it against the top of the site and every picture comes back as the broken mark.
checkSettled('the published boot tells the module where its pictures are served from', async () => {
  const booted = await runSiteBoot(servedFiles([{ path: 'README.md' }, { path: 'notes/one.md' }]));
  const told = booted.asked.filter((one) => one.call === 'setImageBase');
  if (!told.length) throw new Error('the boot never told the module where the documents are served from, so every picture asks the top of the site');
  if (told[0].base !== 'source') throw new Error(`the boot handed over ${JSON.stringify(told[0].base)} instead of the folder it fetches every document from`);
  // Before the first document is rendered, or the page it lands on asks the wrong address for its pictures.
  const rendered = booted.asked.findIndex((one) => one.call === 'documentScript');
  if (rendered !== -1 && booted.asked.indexOf(told[0]) > rendered) {
    throw new Error('the first document was rendered before the module was told, so its pictures were resolved against the top of the site');
  }
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

// A great many of a site's cross-references name a heading, and the heading must not be thrown away one line before the document opens — thrown away, the reader arrives at the top of a document long enough to have headings worth linking. Both shapes a click arrives in are here: the address the browser worked out, where the heading would otherwise go the way of the path, and the href as written, which is what a diagram's box sends.
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
    // The mark, kept in the browser's own store the way the reader's other choices are.
    'toggleFavorite',
    'checkFavorites',
    'moveFavorite',
    // The leaf, which on a site is the way back to its own front page.
    'goHome',
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
    // The page as it stands, through the browser's own print — the same call wry makes on Windows, over the same print rules.
    'exportPdf',
  ];
  if (answered.join(',') !== expected.join(',')) {
    throw new Error(`the table says these are answered: ${answered.join(',')}`);
  }
  for (const name of answered) {
    send({ command: name, path: 'README.md', href: 'README.md' });
  }
  await settle();
  if (leaf.refused.length !== 1) throw new Error(`an arm the table calls answered was refused: ${JSON.stringify(leaf.refused)}`);
  // Export PDF is the one arm above whose whole job is a call out to the browser, so an arm that quietly did nothing would pass the sweep. The page's own print is what a site has instead of a print panel the host opens.
  if (!context.window.__printed) throw new Error('the site host answered exportPdf and never reached the browser print it is written as');
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

// The marks are the one kept thing that is state rather than a setting, so they come back over the state the page was handed rather than over its settings — and three commands share the one key, because they are three edits of one list.
checkSettled('a site keeps the marks a reader made, and says which of them has left the export', async () => {
  const documents = [{ path: 'README.md' }, { path: 'notes/one.md' }, { path: 'notes/two.md' }];
  const held = {
    'leaftext.settings': JSON.stringify({
      favorites: [
        { vaultId: null, path: 'notes/two.md', kind: 'document' },
        { vaultId: null, path: 'gone.md', kind: 'document' },
      ],
    }),
  };
  const { context, send, stored } = await bootWebHost({ documents, kept: held });

  // Back over the state the page starts from, before the first render, the way a kept theme comes back over its settings.
  const landed = (context.window.__leafInitialState || {}).favorites || [];
  if (landed.map((one) => one.path).join(',') !== 'notes/two.md,gone.md') {
    throw new Error(`the kept marks did not reach the page's boot state: ${JSON.stringify(landed)}`);
  }

  const marks = () => (stored().favorites || []).map((one) => one.path).join(',');

  send({ command: 'toggleFavorite', path: 'README.md', kind: 'document' });
  await settle();
  if (marks() !== 'notes/two.md,gone.md,README.md') throw new Error(`a mark made was kept as ${marks()}`);

  // Paths rather than places: the row before it is the one the reader dropped it above.
  send({ command: 'moveFavorite', path: 'README.md', before: 'gone.md' });
  await settle();
  if (marks() !== 'notes/two.md,README.md,gone.md') throw new Error(`a reordered mark was kept as ${marks()}`);

  // No row named: last.
  send({ command: 'moveFavorite', path: 'notes/two.md', before: null });
  await settle();
  if (marks() !== 'README.md,gone.md,notes/two.md') throw new Error(`a mark dropped at the foot was kept as ${marks()}`);

  // A mark whose document left the export, reported the way the desktop reports a moved file.
  const answers_ = [];
  context.window.leafSetFavoritesMissing = (answer) => answers_.push(answer);
  send({ command: 'checkFavorites' });
  await settle();
  const answer = answers_[answers_.length - 1];
  if (!answer || answer.paths.join(',') !== 'gone.md') throw new Error(`the missing marks came back as ${JSON.stringify(answer)}`);

  send({ command: 'toggleFavorite', path: 'README.md', kind: 'document' });
  await settle();
  if (marks() !== 'gone.md,notes/two.md') throw new Error(`a mark taken off was kept as ${marks()}`);
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
  [{ command: 'redoEdit' }, { edit: 'redo' }],
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

checkSettled('a pause in the typing moves an embedded buffer and leaves the document standing', async () => {
  const { send, asked, seen } = await bootEmbedHost({ save: async () => {} });
  // A redraw is the host handing the page a whole document again, which is the thing a live splice must not do.
  const drawn = () => seen.state.length;
  const before = drawn();
  // Still typing in the block: the box on screen is already the picture, so a redraw would take the words out from under the caret. And every splice of the run after its first records no undo point, or one sentence would take four presses to take back.
  send({ command: 'editBlock', start: 0, end: 7, text: '# Retitled', live: true, continuing: true });
  await settle();
  const made = asked.filter((one) => one.call === 'edit').map((one) => one.edit);
  const found = made.find((edit) => edit.edit === 'block');
  if (!found) throw new Error(`a live splice reached the buffer as ${JSON.stringify(made)}`);
  if (found.undo !== false) throw new Error('a splice continuing a typing run started a second undo step');
  if (drawn() !== before) throw new Error('a live splice redrew the document the reader was typing in');

  // The commit that ends the run is the one that redraws, and it is still the same buffer underneath.
  send({ command: 'editBlock', start: 0, end: 10, text: '# Retitled again', continuing: true });
  await settle();
  if (drawn() === before) throw new Error('the commit that ends a run never redrew the document');
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
