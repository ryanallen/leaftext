// The library's rows outliving the pane being redrawn.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 5b. the library's rows outlive the pane being redrawn ------------------
  //
  // The pane is rewritten whole through innerHTML whenever the host re-reads the folder, and the watcher re-reads it for any change under a recursively watched vault. A row destroyed between a press and its release has nowhere to send the click, so opening a file by clicking its name failed about half the time. Two answers, both wanted: a read that draws the same rows leaves the elements standing, and a row acts on the press.

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

  // ---- the vault's field names arriving after the first search was typed ----
  //
  // The vault is read once the first screen is drawn, so its field names can land while somebody is already typing at the box. The menu is drawn on input alone, so an answer arriving under a typed token left the reader with the three built-in names until another keystroke happened to reopen it — which is exactly the first search of a session, the one the menu exists for.
  const filterMenuLabels = () => vm.runInContext('filterMenuItems.map((item) => item.label)', booted);
  const typedInSearch = (text, focused) => {
    booted.document.activeElement = focused ? librarySearchField : null;
    librarySearchField.value = text;
    librarySearchField.selectionStart = text.length;
    vm.runInContext('closeFilterMenu()', booted);
  };

  check('the vault field names arriving redraw the token already typed', () => {
    typedInSearch('arg', true);
    // Nothing to offer yet: the vault is still being read, and no built-in name starts this way.
    if (filterMenuLabels().length) throw new Error('the menu offered something before the vault had been read');

    booted.leafSetFilterHints({ fields: [{ name: 'argument-hint', values: [] }] });
    if (!filterMenuLabels().includes('argument-hint:')) throw new Error('the vault field the read found was not offered without another keystroke');
    if (booted.document.getElementById('filterMenu').hidden) throw new Error('the menu stayed closed under the token it has a match for');
  });

  check('a late answer opens nothing under an unfocused or empty search box', () => {
    typedInSearch('arg', false);
    booted.leafSetFilterHints({ fields: [{ name: 'argument-hint', values: [] }] });
    if (filterMenuLabels().length) throw new Error('the vault read opened a menu under a box nobody was typing in');
    if (!booted.document.getElementById('filterMenu').hidden) throw new Error('the menu was drawn over a box nobody was typing in');

    typedInSearch('', true);
    booted.leafSetFilterHints({ fields: [{ name: 'argument-hint', values: [] }] });
    if (filterMenuLabels().length) throw new Error('the vault read opened a menu under an empty box');
  });

  check('the field names cleared for a vault switch leave the menu offering the new vault', () => {
    typedInSearch('arg', true);
    booted.leafSetFilterHints({ fields: [{ name: 'argument-hint', values: [] }] });
    if (!filterMenuLabels().includes('argument-hint:')) throw new Error('the vault left behind never offered its field');

    // What the host sends as the reader arrives in another vault, before its own read starts.
    booted.leafSetFilterHints({ fields: [] });
    if (filterMenuLabels().includes('argument-hint:')) throw new Error('the vault left behind is still offering its field names');
    booted.document.activeElement = null;
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
    if (!searchPane().innerHTML.includes('1 result')) throw new Error('the answer did not count its rows');
  });

  check('a search run over an older query’s rows marks them instead of leaving them silent', () => {
    showingLibrarySearch();
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });

    librarySearchField.value = 'drafts';
    vm.runInContext("runLibrarySearch('drafts')", booted);
    if (waitingMarks() !== 1) throw new Error(`a re-search over drawn rows showed ${waitingMarks()} waiting marks`);
    if (!searchPane().innerHTML.includes('library-hit')) throw new Error('a re-search threw away the rows it had');
    if (searchPane().innerHTML.includes('1 result')) throw new Error('a re-search counted the last query’s rows as this one’s answer');

    booted.leafSetSearchResults({ query: 'drafts', hits: [], truncated: false });
    if (waitingMarks() !== 0) throw new Error('an empty answer left the waiting mark turning');
    if (!searchPane().innerHTML.includes('No matches.')) throw new Error('an empty answer did not say so');
  });

  check('rows that arrive while the vault is being read keep their place under the ones before them', () => {
    showingLibrarySearch();
    // A vault read in slices answers the same query several times, each ranking everything it has read so far — so the second answer can put a better match above a row somebody is already reaching for.
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('First')], truncated: false, partial: true });
    if (waitingMarks() !== 1) throw new Error('rows still arriving cleared the waiting mark');
    if (!searchPane().innerHTML.includes('1 result so far')) throw new Error('a part-read vault counted its rows as the whole answer');

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
    if (!drawn.includes('1 result')) throw new Error('the clause replaced the count instead of joining it');

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

  // Somebody who searched a vault for a phrase only one note holds reads the line above their one row, so that line is where "1 results" would be the first thing they see.
  check('a count of one reads in the singular, and a cut list counts its files the same way', () => {
    showingLibrarySearch();
    const countLine = () => (searchPane().innerHTML.match(/<p class="library-results-count"[^>]*>.*?<\/p>/) || [''])[0];

    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: false });
    if (!countLine().includes('1 result')) throw new Error(`one hit was not counted: ${countLine()}`);
    if (countLine().includes('1 results')) throw new Error('one hit was counted in the plural');

    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note'), searchHit('Another')], truncated: false });
    if (!countLine().includes('2 results')) throw new Error(`two hits were not counted in the plural: ${countLine()}`);

    // A cut list says what it was cut to in files, and one file is one file.
    booted.leafSetSearchResults({ query: 'draft', hits: [searchHit('A note')], truncated: true });
    if (!countLine().includes('in the first 1 file')) throw new Error(`a cut list from one file was not counted: ${countLine()}`);
    if (countLine().includes('1 files')) throw new Error('a cut list from one file counted it in the plural');

    booted.leafSetSearchResults({
      query: 'draft',
      hits: [searchHit('A note'), searchHit('Another')],
      truncated: true,
    });
    if (!countLine().includes('in the first 2 files')) throw new Error(`a cut list from two files was not counted: ${countLine()}`);
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

  // ---- 5c. a folder is one list, drawn in the frame the read is answered ------
  //
  // Two lists of names overlapping cannot be read, so the rows go straight into the tree and one list is on screen at any moment, going in and coming back out alike.

  const libraryFolderPayload = (path, name, entries) => ({
    path,
    chain: [{ name, path }],
    rootName: 'Work',
    entries,
  });

  check('going into a folder and stepping back out both leave one list on screen', () => {
    const tree = booted.document.getElementById('libraryTree');
    // Every row the tree drew, whichever list it belongs to: two of these at once is the fault this check exists for.
    const rows = () => tree.querySelectorAll('[data-folder-path], [data-open-path]');
    const inWork = () => booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work', 'Work', [
      { kind: 'folder', name: 'notes', path: 'C:\Vaults\Work\notes' },
    ]));
    const inNotes = () => booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work\notes', 'notes', [
      { kind: 'file', name: 'A note.md', path: 'C:\Vaults\Work\notes\A note.md' },
    ]));

    inWork();
    if (tree.querySelector('.library-tree-stage')) throw new Error('the rows are still wrapped in a stage');
    if (tree.querySelector('.library-tree-layer')) throw new Error('the rows are still wrapped in a layer');

    // The row a reader presses, bound by the pane's own render.
    const row = tree.querySelector('[data-folder-path]');
    if (!row) throw new Error('the folder drew no row to enter it by');
    const press = (row.listeners.get('pointerdown') || [])[0];
    if (!press) throw new Error('a folder row does not listen for a press at all');
    press({ pointerType: 'mouse', button: 0 });
    inNotes();

    // One list, its own rows, nothing left over from the folder before it and nothing marked as leaving.
    const arrived = tree.querySelectorAll('[data-open-path]');
    if (arrived.length !== 1) throw new Error(`the folder that arrived drew ${arrived.length} of its own rows rather than one`);
    if (tree.querySelector('[data-folder-path]')) throw new Error('a row of the folder that was left is still on screen');
    if (tree.querySelector('.is-leaving')) throw new Error('something is still marked as the copy leaving');
    if (tree.querySelector('[aria-hidden="true"]')) throw new Error('an inert copy of the folder is still in the tree');
    if (booted.document.body.dataset.going !== undefined) throw new Error('the page is wearing a direction');

    // Stepping back out reads the same way: one list, no copy, no direction.
    const up = tree.querySelector('.library-nav-up');
    if (!up) throw new Error('a folder one level in drew no way back out');
    ((up.listeners.get('pointerdown') || [])[0])({ pointerType: 'mouse', button: 0 });
    inWork();
    if (rows().length !== 1) throw new Error(`stepping back out left ${rows().length} rows on screen rather than one`);
    if (tree.querySelector('[data-open-path]')) throw new Error('a row of the folder that was left survived the step out');
    if (tree.querySelector('.is-leaving')) throw new Error('stepping back out drew a copy');

    // And nothing is queued: a second move landing straight after the first still leaves one list, because there is no timer and no listener to end.
    ((tree.querySelector('[data-folder-path]').listeners.get('pointerdown') || [])[0])({ pointerType: 'mouse', button: 0 });
    inNotes();
    booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work\notes\older', 'older', [
      { kind: 'file', name: 'Old.md', path: 'C:\Vaults\Work\notes\older\Old.md' },
    ]));
    if (rows().length !== 1) throw new Error(`a move landing on one still running left ${rows().length} rows on screen`);
  });

  check('the row out of a folder wears the plain back arrow', () => {
    const tree = booted.document.getElementById('libraryTree');
    booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work', 'Work', [
      { kind: 'folder', name: 'notes', path: 'C:\Vaults\Work\notes' },
    ]));
    ((tree.querySelector('[data-folder-path]').listeners.get('pointerdown') || [])[0])({ pointerType: 'mouse', button: 0 });
    booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work\notes', 'notes', [
      { kind: 'file', name: 'A note.md', path: 'C:\Vaults\Work\notes\A note.md' },
    ]));

    // `back` is the full-headed arrow, `back-long` the app bar's thin-headed one. Nothing else says which of the two the pane draws here.
    const up = tree.querySelector('.library-nav-up');
    if (!up) throw new Error('a folder one level in drew no way back out');
    if (!up.querySelector('.lt-icon-back')) throw new Error('the row out of a folder does not wear the plain back arrow');
    if (up.querySelector('.lt-icon-back-long')) throw new Error('the row out of a folder wears the app bar long arrow');
  });

  check('a folder read again leaves the rows it already drew standing', () => {
    const tree = booted.document.getElementById('libraryTree');
    const same = () => booted.leafSetLibraryFolder(libraryFolderPayload('C:\Vaults\Work', 'Work', [
      { kind: 'folder', name: 'notes', path: 'C:\Vaults\Work\notes' },
    ]));

    same();
    const row = tree.querySelector('[data-folder-path]');
    // What a watcher tick, a paste, a rename and a delete all arrive as: the same folder, drawn again. The rows must be the same elements, or a rebuild between a press and its release swallows the click.
    same();
    if (tree.querySelector('[data-folder-path]') !== row) throw new Error('an unchanged re-read replaced the row under the pointer');
  });
}
