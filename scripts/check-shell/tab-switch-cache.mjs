// The one detached reading layout exchanged when two tabs switch back and forth.

import vm from 'node:vm';
import { check, runShell, source } from './shared.mjs';

const documentState = (path, words = path, renderKey = null) => ({
  recent: [],
  favorites: [],
  tabs: [{ title: path, path }],
  active: 0,
  renderKey,
  document: {
    title: path,
    path,
    html: `<div class="document-body"><p data-src-start="0" data-src-end="${words.length}">${words}</p></div>`,
    has_visible_content: true,
    format: 'markdown',
    blocks: [],
    tasks: [],
    source: words,
  },
});

const layout = (page) => page.document.getElementById('app').querySelector('.reader-layout');
const block = (page) => page.document.getElementById('app').querySelector('[data-src-start]');

export function run() {
  check('switching A to B and back restores the same layout, listener and range while changed A is rebuilt', () => {
    const page = runShell(source);
    const a = documentState('A.md', 'alpha');
    const b = documentState('B.md', 'bravo');
    page.window.leafSetState(a);
    const firstLayout = layout(page);
    const firstBlock = block(page);
    let presses = 0;
    firstBlock.addEventListener('click', () => { presses += 1; });
    const firstRange = page.rangeOf(firstBlock, 'block');

    page.window.leafSwitchTab(b, null);
    page.window.leafSwitchTab(a, { section: null, block: 0, offsetY: 0 });
    if (layout(page) !== firstLayout) throw new Error('A came back as a new layout node');
    const restoredBlock = block(page);
    for (const listener of restoredBlock.listeners.get('click') || []) listener({});
    if (presses !== 1) throw new Error('A lost its direct listener while detached');
    const restoredRange = page.rangeOf(restoredBlock, 'block');
    if (restoredRange.start !== firstRange.start || restoredRange.end !== firstRange.end) throw new Error('A lost its drawn source range while detached');

    page.window.leafSwitchTab(b, null);
    page.window.leafSwitchTab(documentState('A.md', 'alpha changed'), null);
    if (layout(page) === firstLayout) throw new Error('changed A reused the old layout');
  });

  check('a third document evicts the older layout and restored pages reconnect the reader', () => {
    const page = runShell(source);
    const a = documentState('A.md');
    const b = documentState('B.md');
    const c = documentState('C.md');
    page.window.leafSetState(a);
    const firstLayout = layout(page);
    page.window.leafSwitchTab(b, null);
    page.window.leafSwitchTab(c, null);
    page.window.leafSwitchTab(a, null);
    if (layout(page) === firstLayout) throw new Error('A survived after C evicted it');

    page.window.leafSwitchTab(c, { section: null, block: 0, offsetY: 19 });
    if (!vm.runInContext('readerReflowObserver', page)) throw new Error('the restored page did not reconnect its reflow observer');
    if (vm.runInContext('lastRenderedDocumentPath', page) !== 'C.md') throw new Error('the restored page did not become the active reader');
    if (vm.runInContext('readerScrollAnchor.offsetY', page) !== 19) throw new Error('the restored page did not take the supplied anchor');
  });

  check('source view and non-switch redraws clear the detached layout', () => {
    const page = runShell(source);
    const a = documentState('A.md');
    const b = documentState('B.md');
    page.window.leafSetState(a);
    page.window.leafSwitchTab(b, null);
    if (!vm.runInContext('keptReaderRender', page)) throw new Error('the switch kept no outgoing layout');
    page.renderCodeView({ text: 'bravo', path: 'B.md', language: 'markdown' });
    if (vm.runInContext('keptReaderRender', page)) throw new Error('the source view kept a detached reading layout');

    page.window.leafSetState(a);
    page.window.leafSwitchTab(b, null);
    page.renderState();
    if (vm.runInContext('keptReaderRender', page)) throw new Error('a non-switch redraw kept a detached reading layout');
  });

  check('a cached switch restores by key without HTML and falls back once when the kept page is gone', () => {
    const page = runShell(source);
    const a = documentState('A.md', 'alpha', 'aaaaaaaaaaaaaaaa');
    const b = documentState('B.md', 'bravo', 'bbbbbbbbbbbbbbbb');
    page.window.leafSetState(a);
    const firstLayout = layout(page);
    page.window.leafSwitchTab(b, null);
    const cachedA = Object.assign({}, a, { document: null });
    page.window.leafSwitchTabCached(cachedA, { section: null, block: 0, offsetY: 7 }, 'aaaaaaaaaaaaaaaa');
    if (layout(page) !== firstLayout) throw new Error('the matching key did not restore the kept node');

    const sent = [];
    page.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    page.clearKeptReaderRender();
    page.beginReaderLoading();
    page.window.leafSwitchTabCached(Object.assign({}, b, { document: null }), null, 'bbbbbbbbbbbbbbbb');
    const fallback = sent.find((one) => one.command === 'switchTab');
    if (!fallback || fallback.forceFull !== true || 'renderKey' in fallback) throw new Error(`the missing page sent ${JSON.stringify(sent)}`);
    if (page.document.getElementById('readerLoading').hidden) throw new Error('the fallback cleared the wait before the full page arrived');
    page.window.leafSwitchTab(b, null);
    if (!page.document.getElementById('readerLoading').hidden) throw new Error('the full fallback answer left the reader waiting');

    sent.length = 0;
    page.window.leafSwitchTabCached(Object.assign({}, a, { document: null }), null, 'wrong-key');
    if (!sent.some((one) => one.command === 'switchTab' && one.forceFull === true)) throw new Error('a different key did not force the full fallback');
  });

  check('a cached switch does not restore another path with the same key', () => {
    const page = runShell(source);
    const a = documentState('A.md', 'same', 'aaaaaaaaaaaaaaaa');
    const b = documentState('B.md', 'bravo', 'bbbbbbbbbbbbbbbb');
    page.window.leafSetState(a);
    page.window.leafSwitchTab(b, null);
    const sent = [];
    page.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    const c = documentState('C.md', 'same', 'aaaaaaaaaaaaaaaa');
    page.window.leafSwitchTabCached(Object.assign({}, c, { document: null }), null, 'aaaaaaaaaaaaaaaa');
    if (!sent.some((one) => one.command === 'switchTab' && one.forceFull === true)) throw new Error('the same key for another path did not force the full fallback');
  });

  check('a tab click sends the kept target key only while that target is kept', () => {
    const page = runShell(source);
    const a = documentState('A.md', 'alpha', 'aaaaaaaaaaaaaaaa');
    const b = documentState('B.md', 'bravo', 'bbbbbbbbbbbbbbbb');
    a.tabs = b.tabs = [{ title: 'A', path: 'A.md' }, { title: 'B', path: 'B.md' }];
    a.active = 0;
    b.active = 1;
    page.window.leafSetState(a);
    page.window.leafSwitchTab(b, null);
    const sent = [];
    page.ipc = { postMessage: (text) => sent.push(JSON.parse(text)) };
    const click = (index) => {
      const event = { target: { closest: (selector) => (selector === '[data-tab-index]' ? { dataset: { tabIndex: String(index) } } : null) } };
      for (const listener of page.document.getElementById('tabBar').listeners.get('click') || []) listener(event);
    };
    click(0);
    if (sent[0].renderKey !== 'aaaaaaaaaaaaaaaa') throw new Error(`the kept target sent ${JSON.stringify(sent[0])}`);
    page.clearKeptReaderRender();
    click(0);
    if ('renderKey' in sent[1]) throw new Error(`the target with no kept page sent ${JSON.stringify(sent[1])}`);
  });
}
