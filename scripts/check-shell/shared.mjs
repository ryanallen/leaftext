// The collector every front-end check reports through, the fake page they all boot in, and the handful of helpers more than one subject reaches for. `scripts/check-shell.mjs` beside this folder is what runs them, in order.
//
// The fragment list and the page's elements are read from the app itself — APP_SHELL_SCRIPT_PARTS in lib.rs and the ids and classes in app-shell.html — so nothing here is a second copy of either.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { POLICY, sitePage } from '../web-page.mjs';
import { whole } from '../reading-css.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const failures = [];
export const check = (name, run) => {
  try {
    run();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
  } finally {
    if (record.restore) record.restore();
  }
};
// For a check that has to let the page's own promises settle before it can look. Its failure lands in the same list, and the report at the foot waits for every one of them.
export const settled = [];
export const checkSettled = (name, run) => {
  settled.push(
    Promise.resolve()
      .then(run)
      .catch((error) => failures.push(`${name}: ${error && error.message ? error.message : error}`)),
  );
};

// The app stylesheet the way the browser is handed it: every part of it, joined in cascade order. Read here rather than in a subject file, so a part added to the sheet reaches every check at once.
let readingSource = null;
export const readingCss = () => {
  if (readingSource === null) readingSource = whole();
  return readingSource;
};

// What layer a rule is painted on, read as the named token rather than the number in the rule: a layer written by hand is what `check-literals` refuses, so a rule that stopped naming one fails here rather than being read. Shared by every check that compares two layers, because a second copy is a second answer.
let layerSources = null;
export const layerOf = (selector) => {
  if (!layerSources) {
    layerSources = {
      css: readingCss(),
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
export const layersPainted = () => {
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

export function pageMarkup() {
  return readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
}

function elementIds() {
  return [...pageMarkup().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}

/** The page's own Element, so `target instanceof Element` answers the way it does in the app. */
export class FakeElement {}

/** Take a node out of whatever is holding it, so a move is a move rather than a second listing. */
export function detachChild(child) {
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

/** The selectors in a comma list, each trimmed and its spacing squeezed. Split only where the comma is the list's own: a comma inside `:is(...)` or a bracket separates selectors within one entry, and cutting there hands the matcher fragments that are not selectors at all. The same rule as `wearer_list` in `src/tests/app_shell_chrome_sheets.rs`, which splits the page's scrollbar-wearer list on the Rust side. */
export function selectorParts(selector) {
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
export function matchingDescendants(el, selector) {
  const wants = selectorParts(selector);
  const walk = (from) => (from.children || []).flatMap((child) => [child, ...walk(child)]);
  return walk(el).filter((child) => wants.some((one) => matchesSelector(child, one)));
}

/** What an element says: everything written inside it joined in the order it was written, each child asked the same question in turn. A guard asking a line whether it says anything reads an answer of "no, always" as itself having fired, so a panel the page really drew with a sentence in it has to come back with that sentence. */
function composedText(node) {
  return (node.contents || []).map((piece) => (typeof piece === 'string' ? piece : String(piece.textContent ?? ''))).join('');
}

// The name a `data-` attribute is spelled with on the dataset, and back again. The two stores never meet, so every crossing goes through this pair.
const datasetName = (attribute) => String(attribute).slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const datasetAttribute = (key) => 'data-' + String(key).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

/** What an element is wearing, in the order it was given it: every name the store recorded, then anything written straight onto the element afterwards. A class added by name and a `data-` written through the dataset never reach the store, so composing off the store alone would drop both. */
function attributeNames(node) {
  const names = [...(node.__stores?.attributes?.keys() ?? [])];
  const seen = new Set(names);
  const add = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  if (node.id) add('id');
  if (node.className) add('class');
  if (node.hidden) add('hidden');
  for (const key of Object.keys(node.dataset || {})) add(datasetAttribute(key));
  return names;
}

/** What an element's markup says: its tag, what it is wearing, everything written inside it asked the same question in turn, then its closing tag. A void tag closes itself, so nothing written after it is written inside it. Nothing is escaped on the way out because nothing is unescaped on the way in — the walker keeps a run of words exactly as the markup spelled it, so a round trip has to hand the same spelling back. */
function composedMarkup(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.tagName) return String(node?.textContent ?? '');
  const name = String(node.tagName).toLowerCase();
  const wearing = attributeNames(node)
    .map((key) => [key, node.getAttribute ? node.getAttribute(key) : null])
    .filter(([, value]) => value !== null)
    // A bare name is how the page's own markup spells a flag, and how the walker reads one back.
    .map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${value}"`))
    .join('');
  if (VOID_TAGS.has(name)) return `<${name}${wearing}>`;
  return `<${name}${wearing}>${(node.contents || []).map(composedMarkup).join('')}</${name}>`;
}

/** A stand-in element: enough surface to be wired up, and inert when used. */
export function fakeElement(id = '') {
  // The one place a class lives, reached by both names below. A browser has one, and two stores that never meet leave every guard asking whether an element wears a class the markup or a name write gave it answering no for ever.
  const classes = new Set();
  // Every element's, not only the ones the markup walker built: an element the page makes and then marks hidden from assistive technology drops that name silently otherwise, and the exported page's own check would read a document body wearing nothing. Names arrive here in the order they were given, which is the order the markup writes them back out in.
  const attributes = new Map();
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
    // Four names over one store, and each of the four that has a home of its own is written to that home rather than kept twice: an id, a class set both names write, the hidden flag the page spells bare, and the dataset. The store still records the name, because the order it arrived in is the order the markup says it back.
    setAttribute(key, value) {
      const name = String(key);
      attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
      else if (name === 'class') this.className = String(value);
      else if (name === 'hidden') this.hidden = true;
      else if (name.startsWith('data-')) this.dataset[datasetName(name)] = String(value);
    },
    removeAttribute(key) {
      const name = String(key);
      attributes.delete(name);
      if (name === 'id') this.id = '';
      else if (name === 'class') this.className = '';
      else if (name === 'hidden') this.hidden = false;
      else if (name.startsWith('data-')) delete this.dataset[datasetName(name)];
    },
    getAttribute(key) {
      const name = String(key);
      if (name === 'id') return this.id || null;
      if (name === 'class') return classes.size ? [...classes].join(' ') : attributes.has(name) ? '' : null;
      if (name === 'hidden') return this.hidden ? '' : null;
      if (name.startsWith('data-')) {
        const held = datasetName(name);
        return held in this.dataset ? String(this.dataset[held]) : null;
      }
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(key) {
      return this.getAttribute(key) !== null;
    },
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
    value: { classes, style: styleProperties, text: held, attributes },
    enumerable: false,
    configurable: true,
  });
  for (const name of ['textContent', 'innerHTML']) {
    Object.defineProperty(element, name, {
      // What an element says, by either name, is what it is holding — each piece asked the same question in turn — and never the string somebody last assigned. The string that was written is a picture of the moment before the page took a child out or put a class on, which is the one moment a check never asks about. It answers only while the element holds nothing, which is where an element built by assigning `children` outright lands.
      get: () => (element.contents.length ? (name === 'textContent' ? composedText(element) : element.contents.map(composedMarkup).join('')) : held[name]),
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
  // The element itself and everything it holds. Writing one puts what the markup declares where this element was standing and takes this element out of its holder, which is the whole of what the vault glyph swap does — a getter with no setter would leave that path silently dead.
  Object.defineProperty(element, 'outerHTML', {
    get: () => composedMarkup(element),
    set: (value) => {
      const holder = element.parentElement;
      const made = elementsFromMarkup(String(value ?? ''));
      if (!holder) return;
      const spot = holder.contents.indexOf(element);
      const at = holder.children.indexOf(element);
      detachChild(element);
      element.isConnected = false;
      // Two lists, each counted on its own: a run of words joins the written order alone, so one counter across both would walk the element list past its own end.
      let written = 0;
      let child = 0;
      for (const piece of made) {
        if (spot >= 0) holder.contents.splice(spot + written, 0, piece);
        else holder.contents.push(piece);
        written += 1;
        if (typeof piece === 'string') continue;
        if (at >= 0) holder.children.splice(at + child, 0, piece);
        else holder.children.push(piece);
        child += 1;
        piece.parentElement = holder;
      }
    },
    configurable: true,
    enumerable: true,
  });
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
    // Into the element's own store, the one every element has: a private map here left an element the page built afterwards dropping every name written onto it, and left the two kinds of element answering differently.
    for (const [, key, value] of attrs.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g)) node.setAttribute(key, value);
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

export function fakePage() {
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
export const VIEW_WIDTH = 1080;
export const VIEW_HEIGHT = 820;

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

export function runShell(source, extras = {}) {
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
    // Recorded rather than swallowed, for the same reason the print above is: a link the site has no document for is followed by the browser's own new tab, and a stub returning nothing would leave that arm proved only by not throwing.
    open: (url, target) => {
      sandbox.__opened.push({ url: String(url), target: String(target || '') });
      return null;
    },
    __opened: [],
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
export function topLevelNames(script) {
  const found = new Set();
  for (const line of script.split('\n')) {
    const declared = line.match(/^(?:let|var)\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*(?:=|;|$)/);
    if (declared) for (const name of declared[1].split(',')) found.add(name.trim());
  }
  return [...found];
}

/** Every one of those the page assigns after declaring and never reads. Only a bare `name =` is a write: `name += 1` and `name = name + 1` both read the value first, and so does every other mention. The declaration itself is neither, since the question is what happens to the value once it exists. */
export function writeOnlyNames(script) {
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
export function pageSnapshot(context, script) {
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

// ---- the script the whole suite is read against -----------------------------

export const { names, source } = shellSource();

// ---- what crosses a file boundary by assignment ------------------------------
//
// A module cannot assign to a name it imported, so nothing that is written from another file can be an exported `let`. Those four are properties of one record instead.

export const record = {
  // The page the boot made. Every check after it reads this one, whatever the check before it did to it.
  booted: null,
  // The hand-back `check` calls after every check: without it a check that drives the app — opens the pane, folds the bar, switches a view — leaves the next one standing in whatever it left behind, failing on something it never names.
  restore: null,
  // How many commands the browser's own host answers, counted off its own table by the check that reads it rather than written down twice.
  webAnswered: 0,
  // The same, for the embed's own host one file over.
  embedAnswered: 0,
};

// ---- the helpers more than one subject reaches for --------------------------
//
// A subject file never imports another subject file, so anything two of them touch lives here.

/** What `kind` watchers the record holds against `target`. */
export function registrationsOn(watchers, kind, target) {
  return watchers.filter((one) => one.kind === kind && one.target === target);
}

/** A boot with every command it sends captured, and the vault switch given a real rectangle — the fake page's elements have none, and a hint never points at something with no box. */
export function siteBoot(site) {
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

/** Hand a page one document and stand in the geometry the landing chain measures. `blocks` are the source offsets the rendered blocks carry and the pixel each one sits at down the document; the rects follow `app.scrollTop` the way a browser's do, or the second measurement of a landing reads back whatever the first one just wrote. */
export function renderReadingDocument(context, options = {}) {
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
export function bootReading(options) {
  const context = runShell(source);
  const page = renderReadingDocument(context, options);
  return { context, ...page };
}

/** The workspace payload the module answers a document with: the shape `workspace_state_script` builds, so the page reads it the way it reads the desktop's. */
export const standInState = (path) => ({
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

export const noopPost = () => {};



/** Let every promise the host started settle. A command is handed over and answered later, the way the page hands one over. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Typing that has not been clicked out of yet: what the format bar's subject and the undo subject both drive, over the page the boot made. */
export function typingStand(booted) {
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
  return { withPageTimers, raiseWindowEvent, pressWindowKey, saveKeyPress, typedBlock, wordsFollowMarkup, typeInto, pressUndoKey, openTyping, restTyping };
}

/** A diagram block the page drew, and an element answering only for what has really been put in it: what the export subject and the drawn-box subject both build on. */
export function diagramStand(booted) {
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
  return { answeringForItsOwnChildren, drawnDiagram };
}

// A stand-in element with enough of a node to be serialized and enough of a class list to be tested. `text` is a bare text node; anything else is an element.
export const node = (tag, options = {}) => {
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

/** The home lists both start-screen columns are drawn into: a made-up vault registry to draw against, the rows and headings a drawn column really has, and the host's answer about what is not there. What the vault subject, the start screen and favorites all reach for. */
export function homeStand(booted) {
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

  const RECENT = [
    'C:\\Vaults\\Work\\Standup.md',
    'C:\\Vaults\\Dharma\\Journal\\Today.md',
    'C:\\Users\\me\\Desktop\\Loose.md',
    'C:\\Vaults\\Work\\Notes\\Roadmap.md',
  ];

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
  return { withVaults, VAULTS, KEPT, RECENT, drawnColumn, answerMissing };
}
