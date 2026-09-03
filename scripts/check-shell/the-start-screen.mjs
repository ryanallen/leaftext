// The start screen: what it says with no document open, and the sheet its lists open into.

import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  homeStand,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { homeListsMarkup } = booted;
  const { withVaults, VAULTS, KEPT, RECENT } = homeStand(booted);

  check('the start screen switcher names a vault or Library, and no vaults leave the app name plain', () => {
    const screen = (active) =>
      withVaults(VAULTS, active, () => {
        booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        const drawn = booted.document.getElementById('app').innerHTML;
        booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
        booted.__frames.drain();
        return drawn;
      });
    const inside = screen(1);
    // The whole screen is that vault's, both lists included, so it is said once over everything — in the word that was already there.
    if (!inside.includes('<button type="button" class="kicker library-vault-switch home-vault-switch"') || !inside.includes('lt-icon-package-open') || !inside.includes('>Dharma</button>')) {
      throw new Error(`the word over the headline is not the vault switcher: ${inside.slice(0, 400)}`);
    }
    // And nowhere else: the lists are headed what they have always been headed.
    if (!inside.includes('<h2>Recent (1)</h2>') || !inside.includes('<h2>Favorites (2)</h2>')) {
      throw new Error(`a list heading is not the plain one it was: ${inside}`);
    }
    if (inside.includes('home-list-vault')) throw new Error('the vault is named twice on one screen');
    const library = screen(0);
    if (!library.includes('<button type="button" class="kicker library-vault-switch home-vault-switch"') || !library.includes('lt-icon-computer') || !library.includes('>Library</button>')) {
      throw new Error(`the Library start screen cannot open the vault switcher: ${library.slice(0, 400)}`);
    }
    const plain = withVaults([], 0, () => {
      booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
      booted.__frames.drain();
      return booted.document.getElementById('app').innerHTML;
    });
    if (!plain.includes('<p class="kicker">Leaftext</p>')) {
      throw new Error(`a start screen with no vaults is not the app's plain word: ${plain.slice(0, 400)}`);
    }
  });

  // The screen a new reader meets says vaults exist, and stops saying it the moment there is one — from then on the word over the headline is the switcher, and New vault… is one press inside it.
  check('with no vault the start screen offers a third way in, and it goes when a vault arrives', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    // A query on a stand-in element hands back a fresh stand-in every time, so the only way to reach the button the page really bound is to keep the one the page was handed.
    const appElement = booted.document.getElementById('app');
    const wasQuery = appElement.querySelector;
    let vaultButton = null;
    appElement.querySelector = (selector) => {
      const found = wasQuery.call(appElement, selector);
      if (String(selector) === '.primary-vault') vaultButton = found;
      return found;
    };
    const draw = () => {
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
      return appElement.innerHTML;
    };
    try {
      booted.leafSetVaults({ vaults: [], active: 0 });
      const fresh = draw();
      if (!fresh.includes('<button type="button" class="primary-vault">Add your notes folder</button>')) {
        throw new Error(`a reader with no vault is never told one is possible: ${fresh.slice(0, 600)}`);
      }
      if (!fresh.includes('class="empty-vault-help"')) {
        throw new Error(`the invitation never says what a folder buys: ${fresh.slice(0, 600)}`);
      }
      // Under the row of buttons, not inside it: the row is the two ways in plus this one, and the line is about the button rather than about the columns below.
      const between = fresh.slice(fresh.indexOf('primary-vault'), fresh.indexOf('empty-vault-help'));
      if (!between.includes('</div>')) throw new Error('the line about a vault is standing inside the actions row');
      // And it is the command the pane's own menu sends, so there is no second way to make a vault.
      if (!vaultButton) throw new Error('the page never went looking for the button it drew');
      for (const handler of vaultButton.listeners.get('click') || []) handler({});
      if (!sent.some((one) => one.command === 'createVault')) {
        throw new Error(`pressing it sent ${JSON.stringify(sent.map((one) => one.command))}`);
      }

      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      const owned = draw();
      if (owned.includes('primary-vault') || owned.includes('empty-vault-help')) {
        throw new Error(`the invitation outlived the first vault: ${owned.slice(0, 600)}`);
      }
      // Because this is where it went: the name over the headline opens the list New vault… is in.
      if (!owned.includes('home-vault-switch')) {
        throw new Error('the screen has neither the invitation nor the switcher that replaces it');
      }
    } finally {
      appElement.querySelector = wasQuery;
      booted.ipc.postMessage = wasSend;
      booted.leafSetVaults({ vaults: [], active: 0 });
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('the sheet is headed the list it is, counted as the screen counted it', () => {
    const title = (active) =>
      withVaults(VAULTS, active, () => {
        booted.window.leafSetState({ recent: RECENT, favorites: KEPT, tabs: [], active: null, document: null });
        booted.__frames.drain();
        booted.openHomeSheet('recent');
        const said = booted.document.getElementById('homeSheetTitle').textContent;
        booted.closeHomeSheet();
        booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
        booted.__frames.drain();
        return said;
      });
    // The list it opened over, counted the way the column behind it counted: this vault's own inside one, every vault's outside them all.
    if (title(2) !== 'Recent (2)') throw new Error(`the sheet is not this vault's list: ${title(2)}`);
    if (title(0) !== 'Recent (4)') throw new Error(`the sheet hid something outside every vault: ${title(0)}`);
  });

  // The start screen really drawn, read back off the element the page writes it into — not the markup helper, because what this is about is whether anything redraws at all.
  const homeElement = booted.document.getElementById('app');
  function onTheStartScreen(favorites, run) {
    try {
      booted.window.leafSetState({ recent: [], favorites, tabs: [], active: null, document: null });
      booted.__frames.drain();
      return run(() => homeElement.innerHTML);
    } finally {
      booted.leafSetVaults({ vaults: [], active: 0 });
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  }

  check('switching vaults changes the favorites on screen', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 1 });
      if (!screen().includes('A sutta')) throw new Error(`the vault switched to lost its own kept file: ${screen()}`);
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      const markup = screen();
      if (!markup.includes('Standup')) throw new Error(`the second vault's kept file never arrived: ${markup}`);
      if (markup.includes('A sutta') || markup.includes('Loose')) {
        throw new Error(`the vault that was left is still on the screen: ${markup}`);
      }
      if (!markup.includes('Favorites (1)')) throw new Error(`the count is not this vault's: ${markup}`);
    });
  });

  check('leaving every vault brings every favorite back, grouped and labeled', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      const markup = screen();
      const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
      if (groups.join('|') !== 'Dharma|Work|Outside a vault') {
        throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
      }
      if (!markup.includes('Favorites (4)')) throw new Error(`not every favorite came back: ${markup}`);
    });
  });

  check('a vault switch never throws away what is being read', () => {
    // A tab opened straight into source: the page's copy of the state carries no document, so "is there a document" is the wrong question and only the flag answers it.
    const wasMarkup = homeElement.innerHTML;
    try {
      homeElement.innerHTML = '<div class="code-view">the source somebody is reading</div>';
      vm.runInContext('codeViewActive = true;', booted);
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      if (!homeElement.innerHTML.includes('the source somebody is reading')) {
        throw new Error(`a vault switch drew the start screen over the source view: ${homeElement.innerHTML}`);
      }
      if (!vm.runInContext('codeViewActive', booted)) {
        throw new Error('a vault switch left the page thinking the source view had closed');
      }
    } finally {
      vm.runInContext('codeViewActive = false;', booted);
      booted.leafSetVaults({ vaults: [], active: 0 });
      homeElement.innerHTML = wasMarkup;
    }
  });

  /** The three lines the start screen rotates, read back off the screen it drew. */
  function messageOnScreen(markup) {
    const slot = (pattern) => (markup.match(pattern) || [])[1];
    return {
      hero: slot(/<h1>([^<]*)</),
      subtitle: slot(/<p class="empty-subtitle">([^<]*)</),
      description: slot(/<p class="empty-description">([^<]*)</),
    };
  }

  /** Walk back onto the start screen, so the page picks a message the way a reader arriving does. */
  function anotherHomeVisit() {
    booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
    booted.__frames.drain();
    return messageOnScreen(homeElement.innerHTML);
  }

  check('a vault switch keeps the whole message under the kicker', () => {
    onTheStartScreen(KEPT, (screen) => {
      const before = messageOnScreen(screen());
      if (!before.hero || !before.subtitle || !before.description) {
        throw new Error(`the start screen drew an incomplete message: ${JSON.stringify(before)}`);
      }
      booted.leafSetVaults({ vaults: VAULTS, active: 2 });
      const after = messageOnScreen(screen());
      for (const slot of ['hero', 'subtitle', 'description']) {
        if (after[slot] !== before[slot]) {
          throw new Error(`the ${slot} was reshuffled by a vault switch: ${before[slot]} became ${after[slot]}`);
        }
      }
    });
  });

  check('every visit to the start screen draws one family whole', () => {
    // A headline from one family over a sentence from another is the failure this is here for: the three lines are one voice, so they are read back together and matched to the family that owns the headline.
    const families = vm.runInContext('HOME_MESSAGE_FAMILIES', booted);
    const seen = new Set();
    let previous = null;
    try {
      for (let visit = 0; visit < 200; visit += 1) {
        const shown = anotherHomeVisit();
        const family = families.find((one) => one.hero === shown.hero);
        if (!family) throw new Error(`the headline belongs to no family: ${JSON.stringify(shown)}`);
        if (shown.subtitle !== family.subtitle) {
          throw new Error(`${family.name} drew another family's subtitle: ${shown.subtitle}`);
        }
        if (!family.descriptions.includes(shown.description)) {
          throw new Error(`${family.name} drew a sentence out of another pool: ${shown.description}`);
        }
        if (family.name === previous) throw new Error(`two visits in a row showed ${family.name}`);
        previous = family.name;
        seen.add(family.name);
      }
    } finally {
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
    if (seen.size !== families.length) {
      throw new Error(`only ${seen.size} of ${families.length} families came up over 200 visits`);
    }
  });

  check('the rotating message is escaped on its way onto the screen', () => {
    // The copy is ours, so this is not about hostile input — it is that all three slots go through the same escape the sentence always did, and a later line carrying an ampersand or an angle bracket must not reach the page as markup.
    const families = vm.runInContext('HOME_MESSAGE_FAMILIES', booted);
    const wasHero = families[0].hero;
    try {
      vm.runInContext("HOME_MESSAGE_FAMILIES[0].hero = 'Leaves & <b>ink</b>'; lastHomeFamilyName = null;", booted);
      let markup = '';
      for (let visit = 0; visit < 50 && !markup.includes('Leaves'); visit += 1) {
        anotherHomeVisit();
        markup = homeElement.innerHTML;
      }
      if (!markup.includes('Leaves')) throw new Error('that family never came up over 50 visits');
      if (!markup.includes('Leaves &amp; &lt;b&gt;ink&lt;/b&gt;')) {
        throw new Error(`the headline reached the page unescaped: ${markup.slice(0, 400)}`);
      }
    } finally {
      vm.runInContext(`HOME_MESSAGE_FAMILIES[0].hero = ${JSON.stringify(wasHero)}; lastHomeFamilyName = null;`, booted);
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  check('the fixed half of the start screen never moves with the family', () => {
    // Everything a reader presses, plus the kicker, the lists and the version line, is functional copy outside the registry. Rotating one of them by accident is a control that renames itself between visits.
    const fixed = (markup) =>
      markup.replace(/<h1>[^<]*<\/h1>/, '').replace(/<p class="empty-(?:subtitle|description)">[^<]*<\/p>/g, '');
    anotherHomeVisit();
    const first = fixed(homeElement.innerHTML);
    for (let visit = 0; visit < 60; visit += 1) {
      anotherHomeVisit();
      if (fixed(homeElement.innerHTML) !== first) {
        throw new Error(`the rest of the start screen changed with the family: ${fixed(homeElement.innerHTML)}`);
      }
    }
  });

  check('a removed vault takes its favorites off the start screen with it', () => {
    onTheStartScreen(KEPT, (screen) => {
      booted.leafSetVaults({ vaults: VAULTS, active: 0 });
      // The order the host sends them in: the shorter list first, then the registry without that vault. Backwards, the screen is drawn from rows naming a vault the registry no longer has, and every one of them lands in a second group with the same name as the real one.
      booted.window.leafSetWorkspace({
        recent: [],
        favorites: KEPT.filter((one) => one.vaultId !== 2),
        tabs: [],
        active: null,
      });
      booted.leafSetVaults({ vaults: VAULTS.filter((one) => one.id !== 2), active: 0 });
      const markup = screen();
      if (markup.includes('Standup')) throw new Error(`the removed vault left its favorite on screen: ${markup}`);
      const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
      if (groups.join('|') !== 'Dharma|Outside a vault') {
        throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
      }
    });
  });

  check('Show all appears only past what the folded layout holds, and names the count', () => {
    // With favorites, because a list on its own is the plain one this screen had before there was a pair — no box to fold and nothing to show all of.
    const short = homeListsMarkup({ recent: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], favorites: KEPT });
    // Five fit, so there is nothing the folded layout cannot already show.
    if (short.includes('data-home-list="recent"')) {
      throw new Error('a list the folded layout can hold whole grew a way out of itself');
    }
    const long = homeListsMarkup({
      recent: Array.from({ length: 24 }, (unused, index) => `C:\\Notes\\file-${index}.md`),
      favorites: KEPT,
    });
    if (!long.includes('data-home-list="recent"')) {
      throw new Error(`the button does not say which list it opens: ${long}`);
    }
    if (!long.includes('>Show all 24</button>')) {
      throw new Error(`the button does not name the count: ${long}`);
    }
  });

  check('the sheet opens on one list, reports itself, and closes on Escape', () => {
    const sheet = booted.document.getElementById('homeSheet');
    const scrim = booted.document.getElementById('homeSheetBackdrop');
    const body = booted.document.getElementById('homeSheetBody');
    // The sheet's hide runs off a transition end or the timer behind it, and neither happens on its own here — so the timer is what the check drives.
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      booted.window.leafSetState({ recent: [], favorites: KEPT, tabs: [], active: null, document: null });
      booted.__frames.drain();
      withVaults(VAULTS, 0, () => booted.openHomeSheet('favorites'));
      booted.__frames.drain();
      if (sheet.hidden) throw new Error('the sheet was opened and stayed shut');
      if (scrim.hidden) throw new Error('the sheet came up with no scrim behind it');
      if (booted.homeSheetShowing !== 'favorites') {
        throw new Error(`the sheet does not know which list it is showing: ${booted.homeSheetShowing}`);
      }
      // The same box as the column, so a list read here is the list read there — same bar, same fades.
      if (!body.innerHTML.includes('home-list-box') || !body.innerHTML.includes('A sutta')) {
        throw new Error(`the sheet was filled with something other than that list: ${body.innerHTML}`);
      }
      // The page's own answer about what is open. The ask pipe reads this, so a panel missing from it is one nothing outside the window can see.
      if (!booted.window.leafReaderState().panels.homeList) {
        throw new Error('the sheet does not report itself as an open panel');
      }

      // Escape, through the handler the sheet put on the document.
      booted.onHomeSheetKey({ key: 'Escape' });
      if (!sheet.hidden || !scrim.hidden) throw new Error('Escape left the sheet up');
      if (booted.window.leafReaderState().panels.homeList) {
        throw new Error('a shut sheet still reports itself open');
      }
    } finally {
      booted.setTimeout = wasTimeout;
      booted.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      booted.__frames.drain();
    }
  });

  // One sheet has room to grow and the others have none. The shape picker opens a quarter of the flowchart editor tall so the diagram stays readable, so pulling its grab bar up has somewhere to go; every other sheet opens at the ceiling they share, and pulling one of those up past flush would lift it off the window's edge and show a gap under it. So the growth is asked for by name, and the travel is one signed number: a sheet dragged taller shrinks back to its seat before it starts moving off the window.
  check('only the sheet that asked for it grows when its grab bar is pulled up', () => {
    const stand = (options) => {
      const sheet = fakeElement('grownSheet');
      const grip = fakeElement('grownGrip');
      sheet.getBoundingClientRect = () => ({ top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300 });
      sheet.classList.add('open');
      booted.makeSheetDraggable(sheet, grip, () => {}, options);
      return {
        sheet,
        press: grip.listeners.get('pointerdown')[0],
        move: grip.listeners.get('pointermove')[0],
        up: grip.listeners.get('pointerup')[0],
      };
    };
    const at = (sheet, name) => parseFloat(sheet.style.getPropertyValue(name)) || 0;

    // Pulled 80px up: taller by exactly that, and traveling nowhere.
    const grows = stand({ tallerOnPullUp: true });
    grows.press({ button: 0, pointerId: 1, clientY: 200, timeStamp: 0, preventDefault() {} });
    grows.move({ pointerId: 1, clientY: 120, timeStamp: 20 });
    if (at(grows.sheet, '--sheet-grow') !== 80) throw new Error(`a pull of 80px grew the sheet by ${at(grows.sheet, '--sheet-grow')}`);
    if (at(grows.sheet, '--sheet-drag') !== 0) throw new Error('a sheet that grew also traveled down the window');
    grows.up({ pointerId: 1, timeStamp: 40 });
    // And the height the hand left it at outlives the hand.
    if (at(grows.sheet, '--sheet-grow') !== 80) throw new Error('letting go took the height the drag gave it');

    // Pushed back down 130px from there: the 80 it had gained goes first, and only the remaining 50 moves it.
    grows.press({ button: 0, pointerId: 2, clientY: 200, timeStamp: 60, preventDefault() {} });
    grows.move({ pointerId: 2, clientY: 330, timeStamp: 80 });
    if (at(grows.sheet, '--sheet-grow') !== 0) throw new Error('a sheet pushed past its seat kept the height it had grown');
    if (at(grows.sheet, '--sheet-drag') !== 50) throw new Error(`the push moved the sheet ${at(grows.sheet, '--sheet-drag')} rather than the 50 left after its height went`);
    grows.up({ pointerId: 2, timeStamp: 100 });

    // A sheet that did not ask goes nowhere at all: up past flush is the one direction the clamp has always refused.
    const plain = stand();
    plain.press({ button: 0, pointerId: 3, clientY: 200, timeStamp: 0, preventDefault() {} });
    plain.move({ pointerId: 3, clientY: 120, timeStamp: 20 });
    if (at(plain.sheet, '--sheet-grow') !== 0) throw new Error('a sheet that never asked to grow grew anyway');
    if (at(plain.sheet, '--sheet-drag') !== 0) throw new Error('a sheet pulled up past flush lifted off the window edge');
    plain.up({ pointerId: 3, timeStamp: 40 });
  });

  // All four bottom sheets close through one helper, and the only thing they say about how is whether a hand did it. A drag has already supplied the wind-up, so repeating it would pull the sheet back up out from under the finger that just threw it away.
  check('a dragged sheet says so, and skips the wind-up the other dismissals make', () => {
    const sheet = fakeElement('draggedSheet');
    const grip = fakeElement('draggedGrip');
    sheet.getBoundingClientRect = () => ({ top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300 });
    sheet.classList.add('open');
    const asked = [];
    booted.makeSheetDraggable(sheet, grip, (options) => asked.push(options));
    const press = grip.listeners.get('pointerdown')[0];
    const move = grip.listeners.get('pointermove')[0];
    const up = grip.listeners.get('pointerup')[0];
    press({ button: 0, pointerId: 1, clientY: 0, timeStamp: 0, preventDefault() {} });
    // Most of the way down a 300px sheet, which is past the fraction the helper dismisses at.
    move({ pointerId: 1, clientY: 250, timeStamp: 100 });
    up({ pointerId: 1, timeStamp: 120 });
    if (asked.length !== 1) throw new Error(`the drag asked to close ${asked.length} times`);
    if (!asked[0] || asked[0].dragged !== true) throw new Error(`a drag off did not say so: ${JSON.stringify(asked[0])}`);

    // Which exit a close draws, read at the moment it registers the fallback timer behind its animation. Nothing here ever tells the sheet its animation ended, so the fallback alone has to take it away: an end event that goes missing must not leave a dismissed sheet standing on the window.
    const exitOf = (options) => {
      const seen = [];
      const moving = fakeElement('closingSheet');
      const scrim = fakeElement('closingScrim');
      moving.classList.add('open');
      scrim.classList.add('open');
      const wasTimeout = booted.setTimeout;
      booted.setTimeout = (fn) => {
        for (const name of ['is-leaving', 'is-boosting']) {
          if (moving.classList.contains(name)) seen.push(name);
        }
        // The scrim waits out the wind-up so the two leave together, and only a dismissal that has one takes the wait.
        if (scrim.classList.contains('is-held')) seen.push('scrim held');
        fn();
        return 0;
      };
      try {
        booted.closeSheet(moving, scrim, options);
      } finally {
        booted.setTimeout = wasTimeout;
      }
      // The hide waits for the whole animation, never for whichever end arrives first: with a wind-up in front of the exit that takes the sheet away half-way up, which is how three of these once went.
      if (!moving.hidden || !scrim.hidden) throw new Error('the close ended with the sheet still showing');
      if (moving.classList.contains('is-leaving') || moving.classList.contains('is-boosting')) {
        throw new Error('the sheet kept its exit class after it had gone');
      }
      if (scrim.classList.contains('is-held')) throw new Error('the scrim kept its wait after the sheet had gone');
      return seen.join();
    };
    const pressed = exitOf();
    if (pressed !== 'is-leaving,scrim held') throw new Error(`a button, scrim or Escape dismissal drew ${pressed || 'nothing'}`);
    const flung = exitOf({ dragged: true });
    if (flung !== 'is-boosting') throw new Error(`a drag off drew ${flung || 'nothing'}`);

    // Reduce Motion zeroes every duration in the stylesheet, and a zeroed animation fires no end event at all. So a dismissed sheet goes at once instead of sitting out the fallback, which with motion off held one on the window for a measured 440ms.
    const still = fakeElement('stillSheet');
    still.classList.add('open');
    still.style.setProperty('animation-duration', '0s');
    let waits = 0;
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      waits += 1;
      fn();
      return 0;
    };
    try {
      booted.closeSheet(still, null, null);
    } finally {
      booted.setTimeout = wasTimeout;
    }
    if (waits !== 0) throw new Error(`a close with motion off waited on ${waits} timer(s)`);
    if (!still.hidden) throw new Error('a close with motion off left the sheet showing');
  });

  // The entrance takes the same one-animation path as the exit, and for a reason of its own: a sheet coming off `display: none` has no before-change style for a transition to move from, so a rise written as one does not draw at all and the sheet appears already raised.
  check('a sheet lands on one animation, and is never left holding its landing', () => {
    const sheet = fakeElement('landingSheet');
    const scrim = fakeElement('landingScrim');
    sheet.hidden = true;
    scrim.hidden = true;
    // Left on the scrim by a dismissal this very open interrupted. Carried into the entrance it would hold the dimming back for a wind-up nobody is making.
    scrim.classList.add('is-held');
    let waits = 0;
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = () => {
      waits += 1;
      return 0;
    };
    try {
      booted.openSheet(sheet, scrim);
    } finally {
      booted.setTimeout = wasTimeout;
    }
    if (sheet.hidden || scrim.hidden) throw new Error('the open left the sheet or its scrim hidden');
    if (!sheet.classList.contains('open') || !sheet.classList.contains('is-landing')) {
      throw new Error(`the open drew ${sheet.className || 'nothing'}`);
    }
    if (scrim.classList.contains('is-held')) throw new Error('the scrim carried a dismissal wait into an entrance');
    if (waits !== 1) throw new Error(`the entrance registered ${waits} fallback timers rather than one`);
    // The animation ends and the class goes, so nothing is left holding the sheet off its seat.
    (sheet.listeners.get('animationend') || []).slice().forEach((handler) => handler({ target: sheet }));
    if (sheet.classList.contains('is-landing')) throw new Error('the sheet kept its landing class after it had landed');
    if (!sheet.classList.contains('open')) throw new Error('the landing took the sheet out of its open state');

    // And where that end never arrives, the fallback clears it just the same.
    const slow = fakeElement('slowSheet');
    slow.hidden = true;
    const wasSlowTimeout = booted.setTimeout;
    booted.setTimeout = (fn) => {
      fn();
      return 0;
    };
    try {
      booted.openSheet(slow, null);
    } finally {
      booted.setTimeout = wasSlowTimeout;
    }
    if (slow.classList.contains('is-landing')) throw new Error('a landing whose end never arrived was left on the sheet');
    if (!slow.classList.contains('open')) throw new Error('a landing on the fallback did not leave the sheet open');
  });
}
