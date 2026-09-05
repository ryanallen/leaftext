// Filename markup wherever a document is named, and the tab strip over the reader.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  record,
  renderReadingDocument,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { buildSearchHitRow, documentNameMarkup, documentNameParts, fileRowHtml, homeListsMarkup, renderProject } = booted;

  // ---- 5. the rows on the start screen ----------------------------------------

  // A row on the start screen is one button carrying the path twice: `data-path` opens it, and `data-reveal-path` is the only thing the right-click menu finds a start-screen row by — so a rewritten row that dropped it would take Favorite and Reveal off the screen with nothing failing.


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
    // A search row is an element rather than a string, because the pane keeps it across the answers a part-read vault sends; what it says is read back off the element it built.
    const hit = buildSearchHitRow({ absPath: 'C:\\Notes\\search.json', title: 'search', alias: 'Other name' }).innerHTML;
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

  // A document is drawn far more often than the strip over it changes, and rebuilding every tab refolds the bar behind them — a fold that reads the window's layout once per action it tries, and measured about forty-five times what building the tabs costs. So the strip is compared with the string it was last drawn from: same string, same tabs, no fold.
  check('an unchanged strip keeps its tabs and reads no layout, and every real change still redraws', () => {
    const one = 'C:\\Notes\\one.md';
    const two = 'C:\\Notes\\two.md';
    const tabBar = booted.document.getElementById('tabBar');
    const held = Object.getOwnPropertyDescriptor(tabBar, 'scrollWidth');
    // The fold's first act is to measure the strip, so counting that read is what says whether the bar was refolded at all.
    let layoutReads = 0;
    Object.defineProperty(tabBar, 'scrollWidth', { configurable: true, get: () => { layoutReads += 1; return 0; } });
    const draw = (tabs, active, favorites) =>
      booted.window.leafSetWorkspace({ recent: [], favorites: favorites || [], tabs, active });
    const tabs = () => Array.from(tabBar.children);
    const strip = () => tabBar.innerHTML;
    try {
      vm.runInContext('dirtyByPath.clear(); lastTabsMarkup = null;', booted);
      draw([{ path: one }, { path: two }], 0);
      const first = tabs();
      if (first.length !== 2) throw new Error(`the strip drew ${first.length} tabs instead of two`);
      if (!layoutReads) throw new Error('the first draw of a strip never refolded the bar, so this check cannot tell a fold from no fold');

      // The same workspace again: every tab is the element that was already standing, and nothing measured the bar.
      layoutReads = 0;
      draw([{ path: one }, { path: two }], 0);
      const again = tabs();
      if (again.length !== 2 || again[0] !== first[0] || again[1] !== first[1]) {
        throw new Error('an unchanged strip threw its tabs away and built them again, so the tab under the pointer lost its close cross');
      }
      if (layoutReads !== 0) {
        throw new Error(`an unchanged strip read the window's layout ${layoutReads} times`);
      }

      // Each thing that can move the strip, one at a time, from the same resting pair: the tabs are replaced and the right strip is drawn.
      for (const [what, run, shows] of [
        ['a changed name', () => draw([{ path: one }, { path: 'C:\\Notes\\renamed.md' }], 0), (html) => html.includes('>renamed.md<')],
        ['a changed active tab', () => draw([{ path: one }, { path: two }], 1), (html) => /data-tab-path="[^"]*two[^"]*"/.test(html.split('tab-active')[1] || '')],
        ['a changed order', () => draw([{ path: two }, { path: one }], 0), (html) => html.indexOf('two.md') < html.indexOf('one.md')],
        ['a changed dirty mark', () => draw([{ path: one, dirty: true }, { path: two }], 0), (html) => html.includes('tab-modified')],
        ['a changed favorite mark', () => draw([{ path: one }, { path: two }], 0, [{ path: one, kind: 'document' }]), (html) => html.includes('lt-icon-favorite-on')],
      ]) {
        vm.runInContext('dirtyByPath.clear();', booted);
        draw([{ path: one }, { path: two }], 0);
        const before = tabs();
        layoutReads = 0;
        run();
        const after = tabs();
        if (after[0] === before[0]) throw new Error(`${what} left the old tab elements standing`);
        if (!layoutReads) throw new Error(`${what} redrew the strip without refolding the bar behind it`);
        if (!shows(strip())) throw new Error(`${what} did not reach the strip: ${strip()}`);
      }
    } finally {
      Object.defineProperty(tabBar, 'scrollWidth', held);
      vm.runInContext('dirtyByPath.clear();', booted);
      booted.window.leafSetWorkspace({ recent: [], favorites: [], tabs: [], active: null });
    }
  });

  // ---- 5a. the strip's edges under a held tab ---------------------------------
  //
  // Dragging a tab writes a transform onto the dragged tab and onto every tab it displaces, and the autoscroll that walks the strip along under the hand needs the strip's own two edges. Asked for on each move, that read sits behind those writes and makes the browser settle them before it can answer — measured at roughly 0.3ms per move in a running copy, on two numbers a drag cannot change. So the press reads them once and the drag carries them. A page of its own, because a drag left half-open on the shared page would arm the next check's pointer events.

  /** A page with two tabs drawn, each given a real box, the strip's box counted every time it is asked for, and the drag's own pointer events playable. */
  function tabDragStand() {
    const context = runShell(source);
    const tabBar = context.document.getElementById('tabBar');
    context.window.leafSetWorkspace({
      recent: [],
      favorites: [],
      tabs: [{ path: 'C:\\Notes\\one.md' }, { path: 'C:\\Notes\\two.md' }],
      active: 0,
    });
    let stripReads = 0;
    // The strip runs 200 to 900, so its 48px zones are everything left of 248 and everything right of 852.
    tabBar.getBoundingClientRect = () => {
      stripReads += 1;
      return { left: 200, top: 0, right: 900, bottom: 40, width: 700, height: 40 };
    };
    const tabs = Array.from(tabBar.querySelectorAll('.tab'));
    tabs.forEach((el, at) => {
      const left = 200 + at * 160;
      el.getBoundingClientRect = () => ({ left, top: 0, right: left + 160, bottom: 40, width: 160, height: 40 });
    });
    const pointer = (clientX) => ({ target: tabs[0], button: 0, buttons: 1, pointerId: 5, clientX, clientY: 20, preventDefault() {}, stopPropagation() {} });
    // Every handler the page registered, in the order it registered them — the same walk the real page makes, so a drag here is a drag there.
    const raise = (type, clientX) => {
      for (const handler of [...(context.document.listeners.get(type) || [])]) handler(pointer(clientX));
    };
    return {
      tabBar,
      press: (clientX) => {
        for (const handler of [...(tabBar.listeners.get('pointerdown') || [])]) handler(pointer(clientX));
      },
      move: (clientX) => raise('pointermove', clientX),
      cancel: () => raise('pointercancel', 0),
      reads: () => stripReads,
      forget: () => { stripReads = 0; },
    };
  }

  check('a walked drag reads the strip once however many moves the hand makes', () => {
    const stand = tabDragStand();
    try {
      stand.forget();
      stand.press(280);
      if (stand.reads() !== 1) throw new Error(`the press read the strip ${stand.reads()} times instead of once`);
      // Forty moves, every one of them past the four-pixel threshold that arms the drag, so each one runs the whole active path.
      for (let at = 0; at < 40; at += 1) stand.move(275 - at);
      if (stand.reads() !== 1) {
        throw new Error(`forty moves of a drag read the strip's box ${stand.reads()} times, so the browser laid the strip out again on each one`);
      }
    } finally {
      stand.cancel();
    }
  });

  check('the autoscroll still walks the strip toward either edge and leaves it alone in the middle', () => {
    for (const [where, clientX, wanted] of [
      ['the left edge', 210, 'down'],
      ['the right edge', 890, 'up'],
      ['the middle', 550, 'still'],
    ]) {
      const stand = tabDragStand();
      try {
        stand.press(280);
        stand.tabBar.scrollLeft = 200;
        stand.move(clientX);
        const moved = stand.tabBar.scrollLeft;
        const went = moved < 200 ? 'down' : moved > 200 ? 'up' : 'still';
        if (went !== wanted) {
          throw new Error(`a tab held at ${where} took the strip's scroll ${went} rather than ${wanted}: 200 became ${moved}`);
        }
      } finally {
        stand.cancel();
      }
    }
  });
}
