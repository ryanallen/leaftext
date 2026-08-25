// Copying what is highlighted in the reading view.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  FakeElement,
  check,
  fakeElement,
  names,
  node,
  record,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 3b. copying what is highlighted in the reading view --------------------
  //
  // Neither gesture can be read off the source: the menu is drawn from a list filtered at the moment it opens, and what reaches the clipboard is whatever was saved before the focus moved. Held here because a Copy that quietly writes the wrong words, or an item that appears over a selection nobody made, both look right in the file.

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
