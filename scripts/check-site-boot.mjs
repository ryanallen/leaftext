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

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

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

// ---- the stand-in page ------------------------------------------------------
//
// `check-shell.mjs` has one of these and it cannot be reused: it is built from the app's own markup, which declares none of the site's ids; it answers null for anything that markup does not declare, while two site files write markup with `innerHTML` and immediately query what they wrote; and it runs joined source in `node:vm`, which cannot execute a module with an `import` in it. So this one parses markup, answers a query over what is standing, and the readers are imported rather than evaluated.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Their contents are text, not markup: a `<` inside a script is not the start of an element.
const RAW_TAGS = new Set(['script', 'style', 'textarea']);
const ESCAPES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

const unescapeText = (text) => text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (found) => ESCAPES[found]);
const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

class LeafNode {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get isConnected() {
    let at = this;
    while (at.parentNode) at = at.parentNode;
    return at.nodeType === 9;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  replaceWith(...nodes) {
    const holder = this.parentNode;
    if (!holder) return;
    const at = holder.childNodes.indexOf(this);
    holder.removeChild(this);
    let cursor = at;
    for (const node of flatten(nodes, this.ownerDocument)) holder.insertAt(node, cursor++);
  }
}

class LeafText extends LeafNode {
  constructor(text, ownerDocument) {
    super();
    this.nodeType = 3;
    this.nodeName = '#text';
    this.ownerDocument = ownerDocument;
    this.data = String(text);
  }
  get textContent() {
    return this.data;
  }
  set textContent(value) {
    this.data = String(value);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(value) {
    this.data = String(value);
  }
  get outerHTML() {
    return escapeText(this.data);
  }
  cloneNode() {
    return new LeafText(this.data, this.ownerDocument);
  }
}

/** A string, a node or a fragment, as a flat list of nodes ready to be held somewhere. */
function flatten(nodes, ownerDocument) {
  const out = [];
  for (const node of nodes) {
    if (node == null) continue;
    if (typeof node === 'string') out.push(new LeafText(node, ownerDocument));
    else if (node.nodeType === 11) out.push(...node.childNodes.slice());
    else out.push(node);
  }
  return out;
}

/** A custom property is how a layout is changed without a class, so these are kept rather than swallowed: the minimap writes the thumbnail's scale into one and reads nothing back that a stub could answer with ''. */
function styleFor() {
  const held = new Map();
  return new Proxy(
    {
      setProperty: (name, value) => held.set(name, String(value)),
      removeProperty: (name) => held.delete(name),
      getPropertyValue: (name) => held.get(name) ?? '',
    },
    {
      get: (target, key) => (key in target ? target[key] : typeof key === 'string' ? held.get(key) ?? '' : undefined),
      set: (target, key, value) => {
        held.set(key, String(value));
        return true;
      },
    },
  );
}

/** `dataset` over the real attributes, so a `data-` written by one file is read by another and by a query for `[data-…]`. */
function datasetFor(element) {
  const attribute = (key) => 'data-' + String(key).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
  return new Proxy(
    {},
    {
      get: (_, key) => (typeof key === 'string' ? element.attributes.get(attribute(key)) : undefined),
      set: (_, key, value) => {
        element.attributes.set(attribute(key), String(value));
        return true;
      },
      has: (_, key) => element.attributes.has(attribute(key)),
      deleteProperty: (_, key) => {
        element.attributes.delete(attribute(key));
        return true;
      },
      ownKeys: () => [...element.attributes.keys()].filter((name) => name.startsWith('data-')).map((name) => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );
}

class LeafElement extends LeafNode {
  constructor(tag, ownerDocument) {
    super();
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = styleFor();
    this.dataset = datasetFor(this);
    // Not attributes: a select's value and a checkbox's state are the live control, and `<details open>` is what the settings menu toggles.
    this.value = '';
    this.checked = false;
    this.open = false;
    this.complete = true;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollHeight = 0;
  }

  // ---- attributes ----
  getAttribute(name) {
    const held = this.attributes.get(String(name).toLowerCase());
    return held === undefined ? null : held;
  }
  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(String(name).toLowerCase());
  }
  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set id(value) {
    this.setAttribute('id', value);
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  set className(value) {
    this.setAttribute('class', value);
  }
  get href() {
    return this.getAttribute('href') || '';
  }
  set href(value) {
    this.setAttribute('href', value);
  }
  get src() {
    return this.getAttribute('src') || '';
  }
  set src(value) {
    this.setAttribute('src', value);
  }
  get title() {
    return this.getAttribute('title') || '';
  }
  set title(value) {
    this.setAttribute('title', value);
  }
  get type() {
    return this.getAttribute('type') || '';
  }
  set type(value) {
    this.setAttribute('type', value);
  }
  get hidden() {
    return this.hasAttribute('hidden');
  }
  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }
  get classList() {
    const names = () => (this.className ? this.className.split(/\s+/).filter(Boolean) : []);
    const write = (list) => (this.className = list.join(' '));
    return {
      add: (...added) => write([...new Set([...names(), ...added])]),
      remove: (...gone) => write(names().filter((name) => !gone.includes(name))),
      toggle: (name, on) => {
        const has = names().includes(name);
        const wanted = on === undefined ? !has : Boolean(on);
        if (wanted) write([...new Set([...names(), name])]);
        else write(names().filter((one) => one !== name));
        return wanted;
      },
      contains: (name) => names().includes(name),
    };
  }
  get baseURI() {
    return this.ownerDocument ? this.ownerDocument.baseURI : '';
  }

  // ---- the tree ----
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    const held = this.children;
    return held[held.length - 1] || null;
  }
  get nextElementSibling() {
    return this.sibling(1);
  }
  get previousElementSibling() {
    return this.sibling(-1);
  }
  sibling(step) {
    if (!this.parentNode) return null;
    const held = this.parentNode.children;
    const at = held.indexOf(this);
    return at < 0 ? null : held[at + step] || null;
  }
  insertAt(node, at) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.splice(at, 0, node);
    return node;
  }
  appendChild(node) {
    for (const one of flatten([node], this.ownerDocument)) this.insertAt(one, this.childNodes.length);
    return node;
  }
  append(...nodes) {
    for (const one of flatten(nodes, this.ownerDocument)) this.insertAt(one, this.childNodes.length);
  }
  insertBefore(node, reference) {
    const at = reference ? this.childNodes.indexOf(reference) : this.childNodes.length;
    let cursor = at < 0 ? this.childNodes.length : at;
    for (const one of flatten([node], this.ownerDocument)) this.insertAt(one, cursor++);
    return node;
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) {
      this.childNodes.splice(at, 1);
      node.parentNode = null;
    }
    return node;
  }
  replaceChild(fresh, stale) {
    const at = this.childNodes.indexOf(stale);
    if (at < 0) return stale;
    this.removeChild(stale);
    let cursor = at;
    for (const one of flatten([fresh], this.ownerDocument)) this.insertAt(one, cursor++);
    return stale;
  }
  replaceChildren(...nodes) {
    for (const held of this.childNodes.slice()) this.removeChild(held);
    this.append(...nodes);
  }
  insertAdjacentElement(where, node) {
    if (!this.parentNode) return null;
    const at = this.parentNode.childNodes.indexOf(this);
    if (where === 'afterend') this.parentNode.insertAt(node, at + 1);
    else if (where === 'beforebegin') this.parentNode.insertAt(node, at);
    else if (where === 'afterbegin') this.insertAt(node, 0);
    else this.appendChild(node);
    return node;
  }
  cloneNode(deep) {
    const copy = new LeafElement(this.localName, this.ownerDocument);
    for (const [name, value] of this.attributes) copy.attributes.set(name, value);
    copy.value = this.value;
    copy.checked = this.checked;
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  // ---- text and markup ----
  get textContent() {
    return this.childNodes.map((node) => (node.nodeType === 3 ? node.data : node.textContent)).join('');
  }
  set textContent(value) {
    for (const held of this.childNodes.slice()) this.removeChild(held);
    if (value !== '' && value != null) this.appendChild(new LeafText(value, this.ownerDocument));
  }
  get innerHTML() {
    return this.childNodes.map(serialize).join('');
  }
  set innerHTML(markup) {
    for (const held of this.childNodes.slice()) this.removeChild(held);
    for (const node of parseMarkup(String(markup), this.ownerDocument)) this.appendChild(node);
  }
  get outerHTML() {
    return serialize(this);
  }

  // ---- what a browser answers and nothing here can measure ----
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  getClientRects() {
    return [];
  }
  scrollIntoView() {}
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {}
  select() {}
  setPointerCapture() {}
  releasePointerCapture() {}

  // ---- events ----
  addEventListener(type, handler) {
    if (typeof handler !== 'function') return;
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const held = this.listeners.get(type) || [];
    const at = held.indexOf(handler);
    if (at >= 0) held.splice(at, 1);
  }
  dispatchEvent(event) {
    return dispatch(this, event);
  }

  // ---- queries ----
  querySelector(selector) {
    return queryAll(this, selector)[0] || null;
  }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
  matches(selector) {
    return parseSelector(selector).some((one) => matchComplex(this, one, null));
  }
  closest(selector) {
    for (let at = this; at && at.nodeType === 1; at = at.parentNode) if (at.matches(selector)) return at;
    return null;
  }
}

class LeafFragment extends LeafElement {
  constructor(ownerDocument) {
    super('#fragment', ownerDocument);
    this.nodeType = 11;
    this.nodeName = '#document-fragment';
  }
}

function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  const attributes = [...node.attributes].map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`)).join('');
  if (VOID_TAGS.has(node.localName)) return `<${node.localName}${attributes}>`;
  const inside = RAW_TAGS.has(node.localName) ? node.childNodes.map((child) => (child.nodeType === 3 ? child.data : serialize(child))).join('') : node.childNodes.map(serialize).join('');
  return `<${node.localName}${attributes}>${inside}</${node.localName}>`;
}

/** Markup in, a list of nodes out. Comments are dropped, a void element never opens, and the contents of a script or a style are text. */
function parseMarkup(markup, ownerDocument) {
  const out = [];
  const open = [];
  const holder = () => (open.length ? open[open.length - 1] : null);
  const add = (node) => {
    const held = holder();
    if (held) held.appendChild(node);
    else out.push(node);
  };
  const text = (raw) => {
    if (!raw) return;
    add(new LeafText(unescapeText(raw), ownerDocument));
  };
  let at = 0;
  while (at < markup.length) {
    const next = markup.indexOf('<', at);
    if (next < 0) {
      text(markup.slice(at));
      break;
    }
    text(markup.slice(at, next));
    if (markup.startsWith('<!--', next)) {
      const end = markup.indexOf('-->', next + 4);
      at = end < 0 ? markup.length : end + 3;
      continue;
    }
    if (markup.startsWith('<!', next)) {
      const end = markup.indexOf('>', next);
      at = end < 0 ? markup.length : end + 1;
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/.exec(markup.slice(next));
    if (!tag) {
      text('<');
      at = next + 1;
      continue;
    }
    const [whole, closing, rawName, rawAttributes] = tag;
    const name = rawName.toLowerCase();
    at = next + whole.length;
    if (closing) {
      const found = open.map((one) => one.localName).lastIndexOf(name);
      if (found >= 0) open.length = found;
      continue;
    }
    const element = new LeafElement(name, ownerDocument);
    for (const attribute of rawAttributes.matchAll(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      element.setAttribute(attribute[1], unescapeText(value));
    }
    // A control arrives from markup already set: the settings menu writes `<input checked>` and reads the box back a line later.
    if (element.hasAttribute('value')) element.value = element.getAttribute('value');
    if (element.hasAttribute('checked')) element.checked = true;
    if (element.hasAttribute('open')) element.open = true;
    add(element);
    if (VOID_TAGS.has(name) || /\/\s*$/.test(rawAttributes)) continue;
    if (RAW_TAGS.has(name)) {
      const close = markup.toLowerCase().indexOf(`</${name}`, at);
      const end = close < 0 ? markup.length : close;
      if (end > at) element.appendChild(new LeafText(markup.slice(at, end), ownerDocument));
      const after = markup.indexOf('>', end);
      at = close < 0 ? markup.length : after < 0 ? markup.length : after + 1;
      continue;
    }
    open.push(element);
  }
  return out;
}

// ---- selectors --------------------------------------------------------------
//
// The grammar the site's own files use and no more: a comma list, descendant and child steps, a tag, a class, an id, an attribute with or without a value, `:scope`, and `:not(…)` over one of those.

const selectorCache = new Map();

function parseSelector(selector) {
  const text = String(selector).trim();
  if (selectorCache.has(text)) return selectorCache.get(text);
  const parsed = splitTop(text, ',').map((one) => parseComplex(one.trim()));
  selectorCache.set(text, parsed);
  return parsed;
}

/** Split on a separator that is not inside brackets or parentheses. */
function splitTop(text, separator) {
  const out = [];
  let depth = 0;
  let quote = '';
  let held = '';
  for (const letter of text) {
    if (quote) {
      held += letter;
      if (letter === quote) quote = '';
      continue;
    }
    if (letter === '"' || letter === "'") quote = letter;
    if (letter === '(' || letter === '[') depth += 1;
    if (letter === ')' || letter === ']') depth -= 1;
    if (letter === separator && depth === 0) {
      out.push(held);
      held = '';
      continue;
    }
    held += letter;
  }
  out.push(held);
  return out;
}

function parseComplex(text) {
  const steps = [];
  let combinator = null;
  for (const piece of text.split(/\s+/).filter(Boolean)) {
    if (piece === '>' || piece === '+' || piece === '~') {
      combinator = piece;
      continue;
    }
    // A child step written tight, with no spaces around the `>`: the site spaces its own, and both spellings mean the same selector.
    const parts = piece.split('>');
    parts.forEach((part, index) => {
      if (!part) return;
      steps.push({ combinator: index === 0 ? combinator : '>', compound: parseCompound(part) });
      combinator = null;
    });
    if (parts.length > 1 && parts[parts.length - 1] === '') combinator = '>';
  }
  return steps;
}

function parseCompound(text) {
  const compound = { tag: null, id: null, classes: [], attributes: [], nots: [], scope: false };
  const pattern = /([.#]?[\w*-]+)|(\[[^\]]*\])|(:not\([^)]*\))|(:scope)|(::?[\w-]+(?:\([^)]*\))?)/g;
  let found;
  while ((found = pattern.exec(text))) {
    const [, simple, attribute, not, scope, other] = found;
    if (scope) compound.scope = true;
    else if (not) compound.nots.push(parseCompound(not.slice(5, -1)));
    else if (attribute) {
      const parsed = /^\[\s*([\w:.-]+)\s*(?:([~^$*|]?=)\s*"?([^"\]]*)"?\s*)?\]$/.exec(attribute);
      if (!parsed) throw new Error(`the site uses an attribute selector this check cannot read: ${attribute}`);
      compound.attributes.push({ name: parsed[1].toLowerCase(), operator: parsed[2] || null, value: parsed[3] ?? '' });
    } else if (simple) {
      if (simple.startsWith('.')) compound.classes.push(simple.slice(1));
      else if (simple.startsWith('#')) compound.id = simple.slice(1);
      else compound.tag = simple.toLowerCase();
    } else if (other) {
      throw new Error(`the site uses a pseudo-class this check cannot read: ${other}`);
    }
  }
  return compound;
}

function matchCompound(element, compound, scope) {
  if (element.nodeType !== 1) return false;
  if (compound.scope && element !== scope) return false;
  if (compound.tag && compound.tag !== '*' && element.localName !== compound.tag) return false;
  if (compound.id && element.id !== compound.id) return false;
  for (const name of compound.classes) if (!element.classList.contains(name)) return false;
  for (const attribute of compound.attributes) {
    const held = element.getAttribute(attribute.name);
    if (held === null) return false;
    if (!attribute.operator) continue;
    if (attribute.operator === '=' && held !== attribute.value) return false;
    if (attribute.operator === '*=' && !held.includes(attribute.value)) return false;
    if (attribute.operator === '^=' && !held.startsWith(attribute.value)) return false;
    if (attribute.operator === '$=' && !held.endsWith(attribute.value)) return false;
  }
  for (const not of compound.nots) if (matchCompound(element, not, scope)) return false;
  return true;
}

function matchComplex(element, steps, scope) {
  if (!steps.length) return false;
  const last = steps[steps.length - 1];
  if (!matchCompound(element, last.compound, scope)) return false;
  let at = element;
  for (let index = steps.length - 2; index >= 0; index -= 1) {
    const step = steps[index];
    const combinator = steps[index + 1].combinator;
    if (combinator === '>') {
      at = at.parentNode;
      if (!at || !matchCompound(at, step.compound, scope)) return false;
      continue;
    }
    // A descendant step: walk up until one answers.
    let walked = at.parentNode;
    while (walked && walked.nodeType === 1 && !matchCompound(walked, step.compound, scope)) walked = walked.parentNode;
    if (!walked || walked.nodeType !== 1) return false;
    at = walked;
  }
  return true;
}

function queryAll(rootElement, selector) {
  const parsed = parseSelector(selector);
  const found = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (parsed.some((one) => matchComplex(child, one, rootElement))) found.push(child);
      walk(child);
    }
  };
  walk(rootElement);
  return found;
}

// ---- events -----------------------------------------------------------------

function dispatch(target, event) {
  const path = [];
  for (let at = target; at; at = at.parentNode) path.push(at);
  const holder = target.ownerDocument;
  if (holder && !path.includes(holder)) path.push(holder);
  if (holder && holder.defaultView) path.push(holder.defaultView);
  event.target = event.target || target;
  for (const node of path) {
    const held = node.listeners && node.listeners.get(event.type);
    if (!held) continue;
    event.currentTarget = node;
    for (const handler of held.slice()) handler.call(node, event);
    if (event.__stopped) break;
  }
  return !event.defaultPrevented;
}

/** One event, with the fields the site's handlers read off a real one. */
function leafEvent(type, extras = {}) {
  const event = {
    type,
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    clientX: 0,
    clientY: 0,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.__stopped = true;
    },
    ...extras,
  };
  return event;
}

// ---- the document -----------------------------------------------------------

class LeafDocument extends LeafElement {
  constructor(baseURI) {
    super('#document', null);
    this.nodeType = 9;
    this.nodeName = '#document';
    this.ownerDocument = this;
    // Its own, not the element accessors above: a document's base address and its tab title are values, not attributes on a tag.
    Object.defineProperty(this, 'baseURI', { value: baseURI, writable: true });
    Object.defineProperty(this, 'title', { value: '', writable: true });
    this.activeElement = null;
    this.hidden = false;
    this.visibilityState = 'visible';
    this.defaultView = null;
    this.documentElement = new LeafElement('html', this);
    this.head = new LeafElement('head', this);
    this.body = new LeafElement('body', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.scrollingElement = this.documentElement;
  }
  createElement(tag) {
    return new LeafElement(tag, this);
  }
  createTextNode(text) {
    return new LeafText(text, this);
  }
  createDocumentFragment() {
    return new LeafFragment(this);
  }
  getElementById(id) {
    return queryAll(this, `[id="${String(id).replace(/"/g, '\\"')}"]`)[0] || null;
  }
  /** Text nodes only, snapshotted when the walker is made — every caller here collects the list before it edits, which is what the walk is for. */
  createTreeWalker(walkRoot, _show, filter) {
    const accept = typeof filter === 'function' ? filter : filter && filter.acceptNode ? filter.acceptNode.bind(filter) : () => 1;
    const held = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          if (accept(child) === 1) held.push(child);
          continue;
        }
        walk(child);
      }
    };
    walk(walkRoot);
    let at = 0;
    return { nextNode: () => (at < held.length ? held[at++] : null) };
  }
  createRange() {
    return { setStart() {}, setEnd() {}, selectNodeContents() {}, collapse() {}, cloneRange() { return this; }, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }), getClientRects: () => [] };
  }
  execCommand() {
    return false;
  }
}

/** A page as its own markup declares it, so the ids a reader asks for are the ids that page really carries. */
function standInPage(markup, address) {
  const document = new LeafDocument(address);
  const nodes = parseMarkup(markup, document);
  const html = nodes.find((node) => node.nodeType === 1 && node.localName === 'html');
  const top = html ? html.childNodes.slice() : nodes;
  for (const node of top) {
    if (node.nodeType === 1 && node.localName === 'head') {
      for (const child of node.childNodes.slice()) document.head.appendChild(child);
    } else if (node.nodeType === 1 && node.localName === 'body') {
      for (const child of node.childNodes.slice()) document.body.appendChild(child);
    } else if (node.nodeType === 1) {
      document.body.appendChild(node);
    }
  }
  // A page's `<title>` is the tab's text, and the docs reader derives the whole site's identity from it.
  const title = queryAll(document.head, 'title')[0];
  document.title = title ? title.textContent.trim() : '';
  return document;
}

// ---- the stand-in module ----------------------------------------------------
//
// A real `WebAssembly.Memory` with a bump allocator behind it, so the length-prefixed byte protocol in `site/leaftext-core.js` is exercised rather than mocked away. The four arms are the loader's own — `leaf_alloc`, `leaf_free`, `leaf_render`, `leaf_formats` — which is why `check-shell.mjs`'s stand-in module cannot stand in here: it exports the browser host's.

/** Every extension the app reads, off `src/format.rs` — the one table, never a second list written out here. */
function appExtensions() {
  const source = read('src/format.rs');
  const arms = /fn extensions\(self\)[\s\S]*?match self \{([\s\S]*?)\n\s{8}\}/.exec(source);
  if (!arms) throw new Error('could not find the extension table in src/format.rs');
  const found = [...arms[1].matchAll(/"([\w-]+)"/g)].map((one) => one[1]);
  if (found.length < 5) throw new Error(`expected the whole extension table, got ${found.length}`);
  return found;
}

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
    leaf_render: (sourceAt, sourceLength, pathAt, pathLength) => {
      renders += 1;
      return answer(JSON.stringify(drawnDocument(borrow(sourceAt, sourceLength), borrow(pathAt, pathLength))));
    },
    leaf_formats: () => answer(appExtensions().join(' ')),
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
    addEventListener(type, handler) {
      if (typeof handler !== 'function') return;
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const held = listeners.get(type) || [];
      const at = held.indexOf(handler);
      if (at >= 0) held.splice(at, 1);
    },
    dispatchEvent: () => true,
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
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
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
  const extensions = appExtensions();
  want(leaf.formats.join(' ') === extensions.join(' '), `the loader answered ${leaf.formats.join(' ')}, not the app's own table`);
  for (const extension of extensions) want(leaf.opens(`a/document.${extension}`), `the loader says it cannot open a .${extension}, which its own format list names`);
  want(leaf.opens('README.MD'), 'an extension in capitals was refused, and a real folder holds those');
  want(leaf.opens('page.md#a-heading') && leaf.opens('page.md?v=2'), 'an anchor or a query stopped a document being a document');
  want(!leaf.opens('notes.txt') && !leaf.opens('mdown'), 'the loader opens a file the app cannot read');
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

// ---- phase 2: both entry readers --------------------------------------------
//
// The documents below are fixtures, not the site's own pages: what is under test is the code between the module and a reader, and a fixture is the only way to say what the finished page should hold. Every address one of them asks for is served here, so a reader that reached anywhere else fails rather than quietly falling back.

const SITE_README = [
  '# Leaftext',
  'A reader for your own documents. The source is at https://github.com/leaftext/leaftext, and the guide starts at [the introduction](docs/01-introduction.md).',
  'A [vault](docs/GLOSSARY.md#vault) is a folder you pointed the app at.',
  '<blockquote><p>One line<br>and the next</p></blockquote>',
  '<pre class="highlight" data-language="rust"><code class="language-rust">fn main() {}</code></pre>',
  '## Reading a document',
  'The document is drawn first and edited in place.',
].join('\n\n');

const DOCS_README = ['# Documentation', 'Every page of the guide, starting with [the introduction](01-introduction.md).', '## What is here', 'The list is built from the folder itself, so a page appears by existing.'].join('\n\n');

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
async function bootReader(file, page, address, files, { wrap = null, markup = null } = {}) {
  const document = standInPage(markup || read(page), address);
  const window = standInWindow(document, standInAddress(address));
  const fetch = wrap ? wrap(standInFetch(address, files), address) : standInFetch(address, files);
  const module_ = standInModule();
  installGlobals({ document, window, fetch, wasm: standInWebAssembly(module_) });
  boots += 1;
  await import(pathToFileURL(join(root, file)).href + `?boot=${boots}`);
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

// ---- the report -------------------------------------------------------------

if (problems.length) {
  console.error('the code that draws the published sites does not boot:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('a reader of either site sees this as a blank page, or as a status line over a half-drawn document.');
  process.exit(1);
}
console.log(`site boot: ${files.size} files booted offline across ${boots} boots against a stand-in page, fetch and module, plus the inline module in the front page's foot — every boot read for its finished page rather than for the absence of a throw`);
