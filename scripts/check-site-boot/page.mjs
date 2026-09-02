// The stand-in page `check-site-boot.mjs` boots both published readers against: markup parsed into a tree, a query over what is standing, and events that reach a listener the way it was registered.
//
// `check-shell.mjs` has one of these and it cannot be reused: it is built from the app's own markup, which declares none of the site's ids; it answers null for anything that markup does not declare, while two site files write markup with `innerHTML` and immediately query what they wrote; and it runs joined source in `node:vm`, which cannot execute a module with an `import` in it. So this one parses markup, answers a query over what is standing, and the readers are imported rather than evaluated.
//
// It is a file of its own because the entry beside it reached the tree's line ceiling. Nothing here knows what is being checked: it takes no argument from the entry and reads no file.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Their contents are text, not markup: a `<` inside a script is not the start of an element.
const RAW_TAGS = new Set(['script', 'style', 'textarea']);
const ESCAPES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

const unescapeText = (text) => text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (found) => ESCAPES[found]);
export const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollHeight = 0;
    // Nothing here lays anything out, so an element measures nothing until a check says what a browser would have given it — a picture included: it starts on its way, and the check that wants one that drew, or one the browser threw away, says so.
    this.layoutWidth = 0;
    this.complete = false;
    this.naturalWidth = 0;
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
    return { top: 0, left: 0, right: this.layoutWidth, bottom: 0, width: this.layoutWidth, height: 0, x: 0, y: 0 };
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
  addEventListener(type, handler, options) {
    addListener(this.listeners, type, handler, options);
  }
  removeEventListener(type, handler, options) {
    removeListener(this.listeners, type, handler, options);
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

export function queryAll(rootElement, selector) {
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
//
// A listener is kept beside how it was registered, because that is the whole of what a browser does with the third argument: three registrations under `site/` are wrong in a real browser the moment their third argument goes, and a page that drops it passes on all three.
//
// `capture`, `once` and the types a browser does not bubble, and nothing else. No `eventPhase`, no `stopImmediatePropagation`, no per-type `bubbles` record: nothing under `site/` reads any of them, and a stand-in modeling more of the platform than the code under it asks for is more page to keep true. `passive` is taken and ignored — it only promises a browser the handler will not cancel the event, and nothing here cancels anything.

/** The types a browser does not bubble. An event of one of these stops at the element it happened on, which is why the picture fallback and the link tooltip both capture. */
const NEVER_BUBBLES = new Set(['error', 'load', 'scroll', 'focus', 'blur']);

/** How a listener was registered, off `true` or an options object. */
const capturesWith = (options) => options === true || !!(options && options.capture);

export function addListener(map, type, handler, options) {
  if (typeof handler !== 'function') return;
  if (!map.has(type)) map.set(type, []);
  map.get(type).push({ handler, capture: capturesWith(options), once: !!(options && options.once) });
}

/** A browser matches on the handler and the capture flag together, so taking off a bubbling listener leaves a capturing one of the same handler standing. */
export function removeListener(map, type, handler, options) {
  const held = map.get(type) || [];
  const capture = capturesWith(options);
  const at = held.findIndex((one) => one.handler === handler && one.capture === capture);
  if (at >= 0) held.splice(at, 1);
}

/** The listeners on one node for one phase — `null` for the target itself, where a browser calls every one whatever it was registered as. A `once` comes off before it is called, so a handler that dispatches its own type again does not re-enter itself. */
function callListeners(node, event, wantCapture) {
  const held = node.listeners && node.listeners.get(event.type);
  if (!held || held.length === 0) return;
  event.currentTarget = node;
  for (const one of held.slice()) {
    if (wantCapture !== null && one.capture !== wantCapture) continue;
    if (one.once) {
      const at = held.indexOf(one);
      if (at >= 0) held.splice(at, 1);
    }
    one.handler.call(node, event);
    if (event.__stopped) return;
  }
}

export function dispatch(target, event) {
  const path = [];
  for (let at = target; at; at = at.parentNode) path.push(at);
  const holder = target.ownerDocument;
  if (holder && !path.includes(holder)) path.push(holder);
  if (holder && holder.defaultView) path.push(holder.defaultView);
  event.target = event.target || target;
  // Everything above the target, outermost first on the way down and innermost first on the way back up.
  const above = path.slice(1);
  for (const node of above.slice().reverse()) {
    callListeners(node, event, true);
    if (event.__stopped) return !event.defaultPrevented;
  }
  callListeners(target, event, null);
  if (event.__stopped || NEVER_BUBBLES.has(event.type)) return !event.defaultPrevented;
  for (const node of above) {
    callListeners(node, event, false);
    if (event.__stopped) return !event.defaultPrevented;
  }
  return !event.defaultPrevented;
}

/** One event, with the fields the site's handlers read off a real one. */
export function leafEvent(type, extras = {}) {
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
export function standInPage(markup, address) {
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
