// The fake page every front-end check boots the app's script in: the app's own markup read off disk, a stand-in element answering the parts of a browser the page actually reaches for, the selector matcher those elements are asked with, and the boot and snapshot that run the assembled script over them.
//
// The elements are read from the app itself — the ids and classes in app-shell.html — so nothing here is a second copy of them.
//
// Reached through `shared.mjs`, never imported by a subject file directly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { root } from './script.mjs';

export function pageMarkup() {
  return readFileSync(join(root, 'src/assets/app-shell.html'), 'utf8');
}

function elementIds() {
  return [...pageMarkup().matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}

/** The page's own Element, so `target instanceof Element` answers the way it does in the app. */
export class FakeElement {}

/** A run of words, spelled the way a browser spells one and the way the checks' own `node` helper already spells one: it says it is text, it answers its value, and it answers its words. One maker, because a bare string cannot travel — handed to a move it lands in the element list and then throws assigning a holder onto a primitive, and the tag fold's `while (el.firstChild)` loop never ends. */
export const textNode = (words) => ({ nodeType: 3, nodeValue: String(words), textContent: String(words), parentElement: null });

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

/** Put nodes into a holder at one place, in the order they were handed over. The place is the written order's; where it sits in the element list beside it is counted rather than looked up, because a reference that is a run of words has no place of its own there and a lookup would answer "not there", which puts the node on the end. A place of -1 means the end of both. */
function insertNodesAt(holder, spot, nodes) {
  let at = spot < 0 ? -1 : holder.contents.slice(0, spot).filter((node) => node.nodeType !== 3).length;
  let written = 0;
  let child = 0;
  for (const node of nodes) {
    if (spot >= 0) holder.contents.splice(spot + written, 0, node);
    else holder.contents.push(node);
    written += 1;
    // Two counters, each on its own list: a run of words joins the written order alone, so one counter across both would walk the element list past its own end.
    if (node.nodeType !== 3) {
      if (at >= 0) holder.children.splice(at + child, 0, node);
      else holder.children.push(node);
      child += 1;
    }
    node.parentElement = holder;
  }
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

/** One compound selector's own parts — a tag, an id, a class, an attribute, a pseudo-class — each kept whole, so a bracket or the brackets of an `:is(...)` are never cut in half. */
function compoundPieces(one) {
  const pieces = [];
  let depth = 0;
  let current = '';
  for (const ch of one) {
    if (depth === 0 && current && (ch === '.' || ch === '#' || ch === '[' || ch === ':')) {
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

/** The name and optional value inside one attribute bracket, with either quote style taken off the value. */
function attributeParts(piece, selector) {
  const inside = piece.slice(1, piece.endsWith(']') ? -1 : undefined).trim();
  const split = inside.indexOf('=');
  if (split === -1) return { name: inside, value: null };
  const before = inside.slice(0, split).trimEnd();
  if ('~|^$*'.includes(before.slice(-1))) throw new Error(`unsupported selector operator in "${selector}"`);
  const name = before.trim();
  let value = inside.slice(split + 1).trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  return { name, value };
}

/** Whether one node answers one piece of a compound. An id is asked of the element's own id, an attribute by name alone or compared with the value it carries. A tag is the whole piece, since everything that is not one has already been split off: comparing a tag to everything before the first space called a `pre` a `pre > code`. */
function matchesPiece(node, piece, selector, scope) {
  if (piece.startsWith('.')) return !!(node.classList && node.classList.contains(piece.slice(1)));
  if (piece.startsWith('#')) return !!node.id && String(node.id) === piece.slice(1);
  if (piece.startsWith('[')) {
    const { name, value } = attributeParts(piece, selector);
    if (!name.startsWith('data-')) {
      if (value !== null) return !!node.getAttribute && node.getAttribute(name) === value;
      return !!(node.hasAttribute && node.hasAttribute(name));
    }
    const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!node.dataset || node.dataset[key] === undefined) return false;
    return value === null || String(node.dataset[key]) === value;
  }
  if (piece.startsWith(':')) {
    const open = piece.indexOf('(');
    if (open === -1) return piece === ':scope' && node === scope;
    const inside = selectorParts(piece.slice(open + 1, piece.endsWith(')') ? -1 : undefined));
    const name = piece.slice(1, open);
    if (name === 'not') return inside.every((want) => !matchesSelector(node, want, scope));
    if (name === 'is' || name === 'where') return inside.some((want) => matchesSelector(node, want, scope));
    return false;
  }
  if (piece === '*') return true;
  return String(node.tagName || '').toLowerCase() === piece.toLowerCase();
}

/** Whether one node answers one whole compound: every piece of it, on the same node. */
function matchesCompound(node, one, selector, scope) {
  const pieces = compoundPieces(one);
  return pieces.length > 0 && pieces.every((piece) => matchesPiece(node, piece, selector, scope));
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
function matchesAbove(node, steps, combinator, selector, scope) {
  if (!steps.length) return true;
  const step = steps[steps.length - 1];
  const rest = steps.slice(0, -1);
  if (combinator === '>') {
    const holder = node.parentElement;
    return !!holder && matchesCompound(holder, step.compound, selector, scope) && matchesAbove(holder, rest, step.combinator, selector, scope);
  }
  for (let holder = node.parentElement; holder; holder = holder.parentElement) {
    if (matchesCompound(holder, step.compound, selector, scope) && matchesAbove(holder, rest, step.combinator, selector, scope)) return true;
  }
  return false;
}

/** Whether one node answers one selector, the holders above it included. Asked walking down a subtree, walking up from a node, and by an element about itself, so a query, a `closest` and a `matches` cannot disagree about what a selector means. */
function matchesSelector(node, one, scope) {
  const selector = String(one).trim().replace(/\s+/g, ' ');
  if (!selector) return false;
  const steps = selectorSteps(selector);
  const last = steps[steps.length - 1];
  if (!last || !matchesCompound(node, last.compound, selector, scope)) return false;
  return matchesAbove(node, steps.slice(0, -1), last.combinator, selector, scope);
}

/** What an element's own subtree answers a query with, in document order: a comma list of tags, classes and attributes. One matcher behind every stand-in element, so nothing is ever told it is holding something it has not got — a guard asking a line whether it carries a picture reads an answer of "yes, always" as itself having fired. */
export function matchingDescendants(el, selector) {
  const wants = selectorParts(selector);
  const walk = (from) => (from.children || []).flatMap((child) => [child, ...walk(child)]);
  return walk(el).filter((child) => wants.some((one) => matchesSelector(child, one, el)));
}

/** What an element says: everything written inside it joined in the order it was written, each child asked the same question in turn. A guard asking a line whether it says anything reads an answer of "no, always" as itself having fired, so a panel the page really drew with a sentence in it has to come back with that sentence. */
function composedText(node) {
  return (node.contents || []).map((piece) => String(piece.textContent ?? '')).join('');
}

// The name a `data-` attribute is spelled with on the dataset, and back again. The two stores never meet, so every crossing goes through this pair.
const datasetName = (attribute) => String(attribute).slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const datasetAttribute = (key) => 'data-' + String(key).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

// A style property's name on the element and in a declaration, and back again. The two spellings never meet, so every crossing goes through this pair.
const styleProperty = (name) => String(name).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());

/** Every declaration an element's style carries, in the order it was given them: what was set by property name first, then anything assigned straight onto the style by its own spelling. Both, because the page writes both — a custom property goes through `setProperty` and `style.maxWidth = 'none'` is a plain assignment — and markup that said only one of them would leave whichever the page used unsaid. */
function styleDeclarations(node) {
  const declared = new Map(node.__stores?.style ?? []);
  for (const [name, value] of Object.entries(node.style || {})) {
    if (typeof value === 'function') continue;
    declared.set(styleProperty(name), String(value));
  }
  return [...declared].filter(([, value]) => value !== '');
}

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
  // A browser says an element's declarations back as a `style` attribute, and the diagram export's own drawing rides out on one: it widens the view and then tells the drawing not to scale itself back down.
  if (node.__stores && styleDeclarations(node).length) add('style');
  return names;
}

// The eight spellings a run of words or an attribute value can arrive in, and what each of them says. Seven are a browser's; the eighth is the front end's own — `escapeAttr` in `minimap.js` writes a backtick as `&#96;` in every attribute it composes, so a file path holding one would read back wrong without it. The hard space reads as the character it names and never as a plain space, or a check over a name holding one loses the character silently.
const ESCAPE_SPELLINGS = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': '\u00a0', '&#96;': '`' };
const readEscapes = (text) => String(text).replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#96);/g, (found) => ESCAPE_SPELLINGS[found]);
// The browser's own two sets, and no more. A run of words takes the ampersand, both angle brackets and the hard space; an attribute value takes the ampersand, the double quote and the hard space, because an angle bracket standing inside a value needs no escape and a browser leaves one alone. Both sides name the same set or the round trip every check in this file makes is not one.
const RUN_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\u00a0': '&nbsp;' };
const VALUE_ESCAPES = { '&': '&amp;', '"': '&quot;', '\u00a0': '&nbsp;' };
const escapeRun = (text) => String(text).replace(/[&<>\u00a0]/g, (char) => RUN_ESCAPES[char]);
const escapeValue = (text) => String(text).replace(/[&"\u00a0]/g, (char) => VALUE_ESCAPES[char]);

/** What an element's markup says: its tag, what it is wearing, everything written inside it asked the same question in turn, then its closing tag. A void tag closes itself, so nothing written after it is written inside it. A run of words and an attribute value are each escaped on the way out the way a browser escapes them, and the walker reads the same spellings back in — so a round trip hands the same markup back, and a reader’s own words survive both crossings whatever characters are in them. */
function composedMarkup(node) {
  if (node && node.nodeType === 3) return escapeRun(node.nodeValue);
  if (!node || !node.tagName) return String(node?.textContent ?? '');
  // A browser writes an HTML tag back lowercase and an XML one exactly as it was written. An element belongs to a parsed XML document only if something named that document as its owner, which is what tells the two apart here.
  const name = node.ownerDocument ? String(node.tagName) : String(node.tagName).toLowerCase();
  const wearing = attributeNames(node)
    .map((key) => [key, node.getAttribute ? node.getAttribute(key) : null])
    .filter(([, value]) => value !== null)
    // A bare name is how the page's own markup spells a flag, and how the walker reads one back.
    .map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${escapeValue(value)}"`))
    .join('');
  if (VOID_TAGS.has(name)) return `<${name}${wearing}>`;
  return `<${name}${wearing}>${(node.contents || []).map(composedMarkup).join('')}</${name}>`;
}

/** A stand-in element: enough surface to be wired up, and inert when used. */
export function fakeElement(id = '') {
  // The one node list, reached by both names below. `childNodes` is this array itself rather than a second one kept in step, so the ends below cannot drift from what the moves write.
  const contents = [];
  // The one place a class lives, reached by both names below. A browser has one, and two stores that never meet leave every guard asking whether an element wears a class the markup or a name write gave it answering no for ever.
  const classes = new Set();
  // Every element's, not only the ones the markup walker built: an element the page makes and then marks hidden from assistive technology drops that name silently otherwise, and the exported page's own check would read a document body wearing nothing. Names arrive here in the order they were given, which is the order the markup writes them back out in.
  const attributes = new Map();
  // Declared out here so the snapshot below can copy it whole. Reading the names out of the fragment sources instead would miss a property whose name the source never spells.
  const styleProperties = new Map();
  const element = Object.assign(new FakeElement(), {
    id,
    tagName: 'DIV',
    // What this node is, because a walk over the node list branches on exactly that — a list holding nodes that answer nothing about themselves is still half a list.
    nodeType: 1,
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
    contents,
    // The list's other name, and the one the page itself uses. The same array, held as a plain property: eight checks rebind this name to hand-made text for a line being typed on, and a rebind has to replace that one name on that one element without touching what the moves write.
    childNodes: contents,
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
      // Everything joins the node list; only an element joins the element list beside it, or a run of words would come back as the first *element* a container is holding.
      if (child.nodeType !== 3) this.children.push(child);
      this.contents.push(child);
      child.parentElement = this;
      return child;
    },
    prepend(child) {
      detachChild(child);
      if (child.nodeType !== 3) this.children.unshift(child);
      this.contents.unshift(child);
      child.parentElement = this;
      return child;
    },
    // Any number of children in one call, each through the move above, and nothing answered — the platform's own append. A string arrives as the same text node createTextNode answers, so a builder mixing the two forms reads back as one list of children.
    append(...children) {
      for (const child of children) this.appendChild(typeof child === 'string' ? textNode(child) : child);
    },
    removeChild: (child) => {
      detachChild(child);
      return child;
    },
    // A real move to a place, because the tab drag settles a dragged tab into its slot with this one and a stub that hands the tab back reads as a drop that worked while the strip is in the order it started. The reference's place is read after the detach, so a node moved within the holder already lands where the reference is standing now.
    insertBefore(child, reference) {
      const node = typeof child === 'string' ? textNode(child) : child;
      detachChild(node);
      insertNodesAt(this, reference ? this.contents.indexOf(reference) : -1, [node]);
      return node;
    },
    // The four words over the move above, because the plus above a block and Enter under one both place the new line this way and a stand-in without the name throws before a check can read the page back. `beforebegin` and `afterend` land in the reference's holder, at its spot and one past it; `afterbegin` and `beforeend` land inside the reference. The holder's spot is read after the detach, the way insertBefore reads it, so a node moved within that holder lands where the reference is standing now.
    insertAdjacentElement(where, node) {
      const word = String(where).toLowerCase();
      if (word === 'afterbegin') {
        this.prepend(node);
        return node;
      }
      if (word === 'beforeend') return this.appendChild(node);
      // A browser throws on a fifth word, and a stand-in that placed nothing quietly would let a check pass over a placement that never happened.
      if (word !== 'beforebegin' && word !== 'afterend') {
        throw new SyntaxError(`Failed to execute 'insertAdjacentElement' on 'Element': The value provided ('${where}') is not one of 'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.`);
      }
      const holder = this.parentElement;
      // Nothing standing in a page has anything beside it, which is the answer a browser gives and the one the gutter's checks need, since they build their blocks holderless.
      if (!holder) return null;
      detachChild(node);
      const spot = holder.contents.indexOf(this);
      insertNodesAt(holder, word === 'afterend' ? spot + 1 : spot, [node]);
      return node;
    },
    // The element swapped for what is handed over, at the place it was standing. Four fragments take an element off the page this way and the selection toolbar's two unwraps spend it twice, so a stand-in without it throws on the first line of each.
    replaceWith(...nodes) {
      const holder = this.parentElement;
      if (!holder) return;
      const made = nodes.map((one) => (typeof one === 'string' ? textNode(one) : one));
      // Whatever is being put in leaves wherever it was standing first, which is usually inside this very element — so the place is read once they are gone.
      for (const node of made) detachChild(node);
      const spot = holder.contents.indexOf(this);
      detachChild(this);
      this.isConnected = false;
      insertNodesAt(holder, spot, made);
    },
    // A copy, rebuilt out of the markup this element says back. That is what a browser's clone amounts to for everything a check can ask about, and it is why the copy carries no listener and none of the properties the page wrote onto a node — which is the whole reason the front end reaches for one: the pane lays a still copy of the folder it is leaving over the one that arrived, and a copy that could be pressed would send a reader somewhere the rows no longer say.
    cloneNode(deep = false) {
      const made = elementsFromMarkup(composedMarkup(this))[0] || null;
      if (made && !deep) made.innerHTML = '';
      return made;
    },
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
      // Composed from the declarations rather than kept as a string, so what the markup says is what the element is actually wearing however it was written.
      if (name === 'style') {
        const declared = styleDeclarations(this);
        return declared.length ? declared.map(([property, value]) => `${property}: ${value}`).join('; ') : attributes.has(name) ? attributes.get(name) : null;
      }
      if (name.startsWith('data-')) {
        const held = datasetName(name);
        return held in this.dataset ? String(this.dataset[held]) : null;
      }
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(key) {
      return this.getAttribute(key) !== null;
    },
    // Adjacent runs of words become one and an empty one goes, each child asked the same thing in turn. The selection toolbar's unwrap asks the holder for this one line after it splices a wrapper's words in beside the words already standing there, so a stand-in without it throws before the selection is ever put back.
    normalize() {
      const kept = [];
      for (const node of [...this.contents]) {
        if (node.nodeType !== 3) {
          kept.push(node);
          continue;
        }
        if (!node.nodeValue) {
          node.parentElement = null;
          continue;
        }
        const before = kept[kept.length - 1];
        if (before && before.nodeType === 3) {
          before.nodeValue += node.nodeValue;
          before.textContent = before.nodeValue;
          node.parentElement = null;
          continue;
        }
        kept.push(node);
      }
      // In place, because the node list is the array `childNodes` names and swapping a new one in would leave that name on the old one.
      this.contents.length = 0;
      this.contents.push(...kept);
      for (const node of kept) if (node.nodeType !== 3 && node.normalize) node.normalize();
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
        if (wants.some((one) => matchesSelector(node, one, element))) return node;
      }
      return null;
    },
    // The one guard in the front end that asks a box what it is rather than being told: whether the pointer near an edge is on that box's own scrollbar gutter. An answer of no for ever leaves that branch unreachable.
    matches: (selector) => selectorParts(selector).some((one) => matchesSelector(element, one, element)),
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
  // The two ends of the node list, runs of words included — which is what the page means by them. The tag fold moves each child into a replacement until the first one is gone, so an end that skipped words would move the elements, leave the sentence behind, and read back as a fold that worked.
  Object.defineProperty(element, 'firstChild', {
    get: () => element.contents[0] || null,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(element, 'lastChild', {
    get: () => element.contents[element.contents.length - 1] || null,
    configurable: true,
    enumerable: true,
  });
  // The first element this one is holding, and nothing when it holds none. The reading render takes a document's layout out of the surface through this name and hands it on, so a stand-in without it throws before the first decoration pass.
  Object.defineProperty(element, 'firstElementChild', {
    get: () => element.children[0] || null,
    configurable: true,
    enumerable: true,
  });
  // The element either side of this one in its holder's element list, and nothing at each end of the run or when nothing is holding it. Getters over the same list every move already keeps, so a block put in front of another steps to it straight away. A sibling that is null for ever lets a walk pass having taken no step at all, and the entry walker, the gutter's fallback and the delete caret all read these two names.
  const siblingAt = (step) => {
    const holder = element.parentElement;
    if (!holder) return null;
    const at = holder.children.indexOf(element);
    if (at < 0) return null;
    return holder.children[at + step] || null;
  };
  Object.defineProperty(element, 'nextElementSibling', {
    get: () => siblingAt(1),
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(element, 'previousElementSibling', {
    get: () => siblingAt(-1),
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
        // Every node it was holding, words as well as elements: each leaves through the same detach a removal uses, so a whole redraw's worth of dropped children are not left naming the container that dropped them.
        for (const child of [...element.contents]) detachChild(child);
        element.contents.length = 0;
        // The safe way a fragment puts a reader's own words on the page is to set the text rather than write markup, so the element has to hold them: a title set that way used to leave the markup saying `<span></span>`, and a check asking what the page says read an empty element however well the escapes worked.
        if (name === 'textContent') {
          if (held[name]) element.appendChild(textNode(held[name]));
        }
        if (name === 'innerHTML') {
          // A redraw clears what the container said before, the way a browser's does: a container written with nothing in it answers with nothing rather than with its last text.
          held.textContent = '';
          // Runs of words with no tag around them are text in a browser too, so `innerHTML = 'a line'` leaves the container saying `a line`. One move for both kinds: it is what sorts a run of words from an element.
          for (const piece of elementsFromMarkup(held[name])) element.appendChild(piece);
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
      detachChild(element);
      element.isConnected = false;
      insertNodesAt(holder, spot, made);
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

/** Everything a piece of markup declares, in the order it declares it: an element per tag, nested the way it nests them and wearing its tag, its id, its classes and its other attributes, and the runs of words between them. The page draws whole panels as one string and then reaches straight back into what it drew — the home screen wires its two buttons out of the markup two lines above them — so a container keeping only the string could answer none of it, and one keeping only the elements says nothing for every panel it holds.
 *
 * `xml` is the one difference between the two grammars this walker is asked to read: XML keeps a tag's own spelling and has no tag that closes itself by name. The diagram export turns on the drawing being an `svg` rather than an `SVG`, so a walker that folded case would send every drawing back out unedited. */
function elementsFromMarkup(markup, xml = false) {
  const text = String(markup);
  const root = fakeElement('');
  const open = [{ name: '', node: root }];
  let after = 0;
  // The words between two tags belong to whatever tag is open around them, and the run is kept before the stack moves — so what was written before a closing tag is still inside the element it closes. What the markup spelled as an entity becomes the character it names, the way a browser reads one.
  const keepRun = (upto) => {
    const run = text.slice(after, upto);
    if (run) open[open.length - 1].node.appendChild(textNode(readEscapes(run)));
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
    node.tagName = xml ? rawName : name.toUpperCase();
    // Into the element's own store, the one every element has: a private map here left an element the page built afterwards dropping every name written onto it, and left the two kinds of element answering differently.
    for (const [, key, value] of attrs.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g)) node.setAttribute(key, readEscapes(value));
    if (/(^|\s)hidden(\s|=|$)/.test(attrs)) node.hidden = true;
    open[open.length - 1].node.appendChild(node);
    if ((xml || !VOID_TAGS.has(name)) && !/\/\s*$/.test(attrs)) open.push({ name, node });
  }
  keepRun(text.length);
  // The whole of what was parsed, runs included, so the container this is written into says the words as well as holding the elements. One line in the file parses markup, so nothing else has to read this shape.
  const built = [...root.contents];
  for (const child of built) child.parentElement = null;
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
    createTextNode: (text) => textNode(text),
    // Nothing is rendered here, so a walk over an element finds no nodes — which is what a walk over the fake page's empty elements would find.
    createTreeWalker: () => ({ nextNode: () => null }),
    createDocumentFragment: () => fakeElement('fragment'),
    createRange: () => {
      // Where a selection was put back, kept rather than swallowed: the selection toolbar's unwrap leaves the words it kept selected so a second button press lands on the same ones, and a stub that dropped the two ends would let a check watching for that pass with nothing selected at all. A place is a holder and a spot in its node list, the way a browser records one.
      const range = {
        startContainer: null,
        startOffset: 0,
        endContainer: null,
        endOffset: 0,
        setStart() {},
        setEnd() {},
        setStartBefore(node) {
          range.startContainer = node.parentElement;
          range.startOffset = node.parentElement ? node.parentElement.childNodes.indexOf(node) : 0;
        },
        setEndAfter(node) {
          range.endContainer = node.parentElement;
          range.endOffset = node.parentElement ? node.parentElement.childNodes.indexOf(node) + 1 : 0;
        },
        selectNodeContents() {},
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
        getClientRects: () => [],
        cloneRange: () => range,
        collapse() {},
      };
      return range;
    },
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
  // Which pictures this page can load, and what each one does: the exact source a check registered, against `{ width, height, loads, decodes }`. Fresh with the page that owns it and put back after every check, so one check cannot decide a URL for the next. A source nobody registered fails, because a stand-in that called every picture good would let a guard asking whether one draws pass while never having drawn anything.
  const pictures = new Map();
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
    // Node's own, under the browser's name and with the browser's contract: one character per byte in, base64 out. The diagram export encodes its drawing through this and reads it back nowhere, so a stand-in that answered anything at all would let a picture full of the wrong bytes pass.
    btoa,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    Element: FakeElement,
    // The page's own picture, answered off the map above instead of off the network. Both live paths assign their handlers before the source and neither is written for an answer arriving on its own stack, so the answer is scheduled off it the way a browser's is. Loading and decoding are separate answers because the probe reads them separately: mermaid throws on the decode, which is the failure the whole probe exists for.
    Image: class {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.__src = '';
      }
      get src() {
        return this.__src;
      }
      set src(url) {
        this.__src = String(url);
        const answer = pictures.get(this.__src);
        Promise.resolve().then(() => {
          if (!answer || answer.loads === false) {
            if (this.onerror) this.onerror();
            return;
          }
          this.naturalWidth = answer.width || 0;
          this.naturalHeight = answer.height || 0;
          if (this.onload) this.onload();
        });
      }
      decode() {
        const answer = pictures.get(this.__src);
        if (!answer || answer.loads === false || answer.decodes === false) return Promise.reject(new Error('this picture will not decode'));
        return Promise.resolve();
      }
    },
    // The answer map itself, so a check names the sources it is deciding for. Not the page's to read: nothing the app runs looks at this.
    __pictures: pictures,
    // The drawing's round trip, over the one markup walker and the one markup writer this file already has. A second grammar beside them would drift from the one every other check reads markup through, and the shape the diagram export needs is exactly the shape those two already handle: nested tags, attributes with their own spelling, and escaped text.
    DOMParser: class {
      parseFromString(text) {
        // A document of its own, so the drawing is parsed beside the page rather than into it. Whatever named it owns every element under it, which is how the export reaches a maker for the rectangle it puts behind the drawing.
        const parsed = {
          createElementNS: (_namespace, tag) => {
            const made = fakeElement('');
            made.tagName = String(tag);
            made.ownerDocument = parsed;
            return made;
          },
        };
        const built = elementsFromMarkup(String(text), true);
        const own = (node) => {
          node.ownerDocument = parsed;
          for (const child of node.children || []) own(child);
        };
        for (const node of built) if (node.nodeType !== 3) own(node);
        // The first element, the way a browser answers: text or a comment before the root is not the root.
        parsed.documentElement = built.find((node) => node.nodeType !== 3) || null;
        return parsed;
      }
    },
    XMLSerializer: class {
      serializeToString(node) {
        return composedMarkup(node);
      }
    },
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
