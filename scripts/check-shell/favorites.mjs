// Favorites: a row taken back, a file that is not there, and a row dragged into a new place.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  check,
  fakeElement,
  homeStand,
  names,
  record,
  root,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { homeListsMarkup } = booted;
  const { withVaults, VAULTS, KEPT, drawnColumn, answerMissing } = homeStand(booted);

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
    /** An item in a list, with the classes it is wearing and any transform written on it. The row inside it is a real element, so what the carried copy is handed is the row's own markup rather than a string written here. */
    function listItem(path) {
      const classes = new Set();
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
      const row = fakeElement('');
      row.tagName = 'SPAN';
      row.className = 'home-row';
      row.dataset.homeFavorite = path;
      row.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 20, bottom: 20 });
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
    // What the ghost was really handed, read back off it: the row's own markup, not a string written up here. A copy carrying something else is a row that vanishes under the pointer.
    const copy = carried[0].querySelector('.home-row');
    if (!copy) throw new Error(`the carried copy holds no row at all: ${JSON.stringify(carried[0].innerHTML)}`);
    if (copy.getAttribute('data-home-favorite') !== 'first.md') throw new Error('the carried copy does not name the file it was lifted off');
    // The copy is taken before the row is marked, so what is carried is the row as it looked unheld.
    if (copy.classList.contains('is-dragging')) throw new Error('the carried copy wears the mark that says the row is being dragged');
    if (carried[0].getAttribute('aria-hidden') !== 'true') throw new Error('the carried copy is read out to a screen reader as a second row');
    if (!dragged.row.classList.contains('is-dragging')) throw new Error('the row is drawn twice, in place and carried');
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
}
