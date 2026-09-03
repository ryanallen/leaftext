// The helpers and stands more than one subject reaches for. A subject file never imports another subject file, so anything two of them touch lives here.
//
// Reached through `shared.mjs`, never imported by a subject file directly.

import vm from 'node:vm';
import { FakeElement, fakeElement, matchingDescendants, runShell, VIEW_WIDTH } from './page.mjs';
import { source } from './script.mjs';

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
    document: { title, path, html, has_visible_content: true, format: 'Markdown', blocks: [], tasks: [], source: '' },
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
    has_visible_content: true,
    format: 'Markdown',
    blocks: [],
    tasks: [],
    source: '',
  },
});

export const noopPost = () => {};

// The flowchart sheet, every fragment of it. The two negative guards below read the lot rather than whichever file kept the name, or a later cut quietly takes lines out of their reach.
export const SHEET_FRAGMENTS = [
  'src/assets/shell/flow-canvas.js',
  'src/assets/shell/flow-pointer.js',
  'src/assets/shell/flow-menu.js',
  'src/assets/shell/flow-rename.js',
  'src/assets/shell/flow-picker.js',
  'src/assets/shell/flow-export.js',
];



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
  // A copy takes the word it was given, the way the platform's does: asked for a shallow one it holds nothing, so a check reading what a shallow copy kept is reading its own answer rather than a deep copy wearing the name.
  el.cloneNode = (deep = false) => node(tag, { ...options, children: deep ? (options.children || []).map((child) => (typeof child === 'string' ? child : child.cloneNode(true))) : [] });
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
