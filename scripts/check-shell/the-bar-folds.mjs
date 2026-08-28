// The app bar folding into its chevron menu as the window narrows, and unfolding as it widens.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  detachChild,
  record,
  root,
  settled,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  check('a folded button goes back to the container it was actually standing in', () => {
    // Every candidate's home is read off the page, never named a second time in the list. Naming it left the Mac's three dots in the menu for good: dom.js had already moved them to the bar's left end, the list still said the trailing group, and widening the window put back only what that group remembered holding. Quitting was the only way out.
    const source = readFileSync(join(root, 'src/assets/shell/overflow.js'), 'utf8');
    const list = source.slice(source.indexOf('const overflowCandidates = ['), source.indexOf('].filter('));
    if (!list.includes('home: windowControls && windowControls.parentElement')) {
      throw new Error('the window buttons must take their home from where they are standing');
    }
    // Their home decides the other half too: folding out of the bar's left zone frees nothing while an open pane pins it to the rail's width, and that is true of the dots exactly when they are in it.
    if (!list.includes('inLead: !!windowControls && windowControls.parentElement === appBarLead')) {
      throw new Error('whether the window buttons sit in the pinned zone must be read, not assumed');
    }
  });

  check('the chevron menu is laid out in its own order, with the window buttons at the foot', () => {
    const panel = booted.document.getElementById('appOverflowPanel');
    const tabBar = booted.document.getElementById('tabBar');
    const original = { prepend: panel.prepend, appendChild: panel.appendChild, children: panel.children };
    // Real list semantics for the panel: the fold moves elements into it, and the order they come to rest in is the whole claim — a string in the stylesheet cannot say it.
    const inside = [];
    // Taken out of wherever it was standing, not just written into this list: a move that leaves the node in its old container as well hands the next check a strip holding the same button three times.
    const move = (child) => {
      detachChild(child);
      child.parentElement = panel;
      return child;
    };
    Object.assign(panel, {
      children: inside,
      prepend: (child) => inside.unshift(move(child)),
      appendChild: (child) => inside.push(move(child)) && child,
    });
    Object.defineProperty(panel, 'childElementCount', { get: () => inside.length, configurable: true });
    // A rendered document, because Export stands only where there is a page to print — and where it does not stand, the menu it folds into is one item short.
    booted.renderReaderToolbar(true);
    // A strip that can never fit, so every candidate folds.
    tabBar.scrollWidth = 900;
    tabBar.clientWidth = 100;
    // The window's own three, revealed the way a native frame reveals them: the markup ships them hidden, so the order they take in the menu is only ever a question once something has drawn them.
    const shipped = booted.document.getElementById('windowControls');
    shipped.hidden = false;
    try {
      booted.refitAppBar();
      const order = inside.map((el) => el.id);
      // Back leads because a reader opens this menu to go back a page; the window buttons are last, so close is not the first thing under the pointer. They fold last of all, which is exactly why inserting as they left put them on top.
      const expected = ['backButton', 'forwardButton', 'themeSheetOpen', 'openButton', 'newButton', 'exportPdfButton', 'windowControls'];
      if (order.join(',') !== expected.join(',')) {
        throw new Error(`the menu came out as ${order.join(',')}, not ${expected.join(',')}`);
      }

      // A hidden item is skipped by the fold, so the menu is the rest in the same order with nothing empty left at its foot. Both platforms draw these three now, so this is the update bell's case rather than the Mac's — it is only ever there when there is something to install.
      const controls = booted.document.getElementById('windowControls');
      controls.hidden = true;
      // Stand in for the unfold: the fake page's containers were empty when the fragment recorded them, so the real refit's first step has nothing to move back out. The handles come out of the page first: the page answers off what it is holding, and an element the panel has stopped listing is standing nowhere it can be reached from.
      const stranded = [controls, booted.document.getElementById('backButton'), booted.document.getElementById('forwardButton')];
      inside.length = 0;
      for (const el of stranded) el.parentElement = null;
      booted.refitAppBar();
      const withoutControls = inside.map((el) => el.id);
      controls.hidden = false;
      if (withoutControls.join(',') !== expected.slice(0, -1).join(',')) {
        throw new Error(`with the buttons hidden the menu came out as ${withoutControls.join(',')}`);
      }

      // Widening the window puts every one of them back where it was standing. The fold has to read their container rather than be told one: told one, the Mac's dots stay in the menu until the app is quit, because the container it was told is not the one holding them.
      inside.length = 0;
      tabBar.scrollWidth = 0;
      tabBar.clientWidth = 900;
      booted.refitAppBar();
      if (inside.length) {
        throw new Error(`a wide bar left ${inside.map((el) => el.id).join(',')} in the menu`);
      }
      for (const el of [controls, booted.document.getElementById('backButton')]) {
        if (!el.parentElement || el.parentElement === panel) {
          throw new Error(`${el.id} did not go back to the bar`);
        }
      }
    } finally {
      delete panel.childElementCount;
      Object.assign(panel, original);
      shipped.hidden = true;
      tabBar.scrollWidth = 0;
      tabBar.clientWidth = 0;
    }
  });

  /** A button, at the owner's window at its narrowest: every control on the bar is this wide, and the window buttons are three of them. */
  const BAR_BUTTON = 32;
  /** The page across, at the smallest window the app allows. */
  const BAR_WIDTH = 366;

  /** The bar measured the way a window measures it: scrollWidth is what is still standing on it, so a fold frees real width and the chevron costs its own — which is the whole reason a pass can measure wrong. */
  function measuredAppBar() {
    // The bar is measured with every button it can carry, so both of these come first — while the bar is unmeasured and the refit each of them fires folds nothing. The window's own three are priced into the model below and the fold skips a hidden button, so a hidden set is a bar measured wider than the one being folded; Export stands only where there is a page to print, and it is a candidate the fold reaches.
    booted.document.getElementById('windowControls').hidden = false;
    booted.renderReaderToolbar(true);
    const bar = booted.document.getElementById('appBar');
    const panel = booted.document.getElementById('appOverflowPanel');
    const tabBar = booted.document.getElementById('tabBar');
    const foldable = ['windowControls', 'backButton', 'forwardButton', 'themeSheetOpen', 'openButton', 'newButton'].map((id) => booted.document.getElementById(id));
    // What the bar keeps whatever folds — the leaf, the library button, the empty strip and its own padding. Chosen so folding two lands the bar exactly on its width, which is where a single pass stopped in the live window with close still off the edge.
    const FURNITURE = 174;
    const chevronUp = () => vm.runInContext('overflowChevronUp', booted);
    const width = (el) => (el.id === 'windowControls' ? BAR_BUTTON * 3 : BAR_BUTTON);
    const standing = () => foldable.filter((el) => el.parentElement !== panel);
    Object.defineProperty(panel, 'childElementCount', { get: () => panel.children.length, configurable: true });
    Object.defineProperty(bar, 'scrollWidth', {
      get: () => FURNITURE + standing().reduce((sum, el) => sum + width(el), 0) + (chevronUp() ? BAR_BUTTON : 0),
      configurable: true,
    });
    bar.clientWidth = BAR_WIDTH;
    // The case this is all about: nothing open, so the strip is empty — and an empty strip reports no overflow, which is why it cannot be the only thing asked.
    tabBar.scrollWidth = 24;
    tabBar.clientWidth = 24;
    // Every run starts with the chevron down, whatever an earlier check left behind.
    vm.runInContext('overflowChevronUp = false;', booted);
    const folded = () => panel.children.map((el) => el.id);
    return {
      bar,
      panel,
      folded,
      standing: () => standing().map((el) => el.id),
      done() {
        bar.clientWidth = 0;
        tabBar.scrollWidth = 0;
        tabBar.clientWidth = 0;
        delete bar.scrollWidth;
        bar.scrollWidth = 0;
        // Puts every button back on the bar before the next check reads the page.
        booted.refitAppBar();
        delete panel.childElementCount;
      },
    };
  }

  check('a bar wider than its own window folds, even with a tab strip that cannot overflow', () => {
    const bar = measuredAppBar();
    try {
      booted.refitAppBar();
      if (!bar.folded().length) {
        throw new Error('a bar 430 across a 366-wide window folded nothing');
      }
      if (bar.bar.scrollWidth > BAR_WIDTH) {
        throw new Error(`the bar was left at ${bar.bar.scrollWidth} in a ${BAR_WIDTH}-wide window`);
      }
    } finally {
      bar.done();
    }
  });

  check('a bar that fits folds nothing, so the fold cannot pass by folding always', () => {
    const bar = measuredAppBar();
    try {
      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      if (bar.folded().length) {
        throw new Error(`a bar with room to spare folded ${bar.folded().join(',')}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the refit measures again when it was the pass that raised the chevron', () => {
    const bar = measuredAppBar();
    try {
      // One pass alone stops the moment the bar fits, and it fits before the chevron it is about to raise is standing on it.
      booted.foldAppBar();
      const onePass = bar.folded();
      if (onePass.length !== 3) {
        throw new Error(`a single pass folded ${onePass.join(',') || 'nothing'}, expected three`);
      }
      if (bar.bar.scrollWidth <= BAR_WIDTH) {
        throw new Error('the chevron cost the bar nothing, so this proves nothing about a second pass');
      }

      // The refit, from the chevron down: the second pass measures a bar the chevron is on and folds the one more that takes.
      vm.runInContext('overflowChevronUp = false;', booted);
      booted.refitAppBar();
      const settled = bar.folded();
      if (settled.length !== 4) {
        throw new Error(`the refit folded ${settled.join(',')}, expected one more than a single pass`);
      }
      if (bar.bar.scrollWidth > BAR_WIDTH) {
        throw new Error(`two passes left the bar at ${bar.bar.scrollWidth}`);
      }

      // And it is two, not the start of a run: the chevron is up now, so a further refit folds exactly the same three.
      booted.refitAppBar();
      if (bar.folded().join(',') !== settled.join(',')) {
        throw new Error(`a third pass changed the fold to ${bar.folded().join(',')}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the fold runs out of work with the window buttons still on the bar', () => {
    const bar = measuredAppBar();
    try {
      booted.refitAppBar();
      // They are first in the list and the loop walks it backwards, so they are the last thing it would reach — closing the window stays one press.
      if (!bar.standing().includes('windowControls')) {
        throw new Error('the window buttons folded into the menu');
      }
    } finally {
      bar.done();
    }
  });

  check('the strip the arrows leave behind holds no element, and holds both again once the bar widens', () => {
    // The condition the stylesheet keys on: `.history-actions:not(:has(> *:not([hidden])))` stops the strip being drawn, so the lead's 16px gap has nothing to land against. Nothing here lays anything out, so what is proved is that the fold reaches that state and comes back out of it.
    const bar = measuredAppBar();
    const strip = booted.document.querySelector('.history-actions');
    try {
      // Narrow past every candidate, so both arrows are certainly in the menu rather than only the one the bar's own width happened to buy.
      bar.bar.clientWidth = 0;
      booted.refitAppBar();
      if (strip.children.length) {
        throw new Error(`the emptied strip still holds ${strip.children.map((el) => el.id).join(',')}`);
      }

      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      const back = strip.children.map((el) => el.id);
      if (back.join(',') !== 'backButton,forwardButton') {
        throw new Error(`a wide bar put the strip back as ${back.join(',') || 'empty'}`);
      }
    } finally {
      bar.done();
    }
  });

  check('the group the actions leave behind holds only the hidden update bell, and holds all five again once the bar widens', () => {
    // The condition the stylesheet keys on: `.app-actions-items:not(:has(> *:not([hidden])))` stops the group being drawn, so the trailing zone's 16px gap has nothing to land against beside the window buttons. The bell never folds, so what has to be proved is that the group is left holding it alone and hidden — which is the state a bare `:has()` cannot tell from a full group.
    const bar = measuredAppBar();
    const group = booted.document.querySelector('.app-actions-items');
    // A rendered document, or Export is hidden and the group it is meant to leave is one button short of empty.
    booted.renderReaderToolbar(true);
    try {
      // Narrow past every candidate, so all four actions are certainly in the menu rather than only the one the bar's own width happened to buy.
      bar.bar.clientWidth = 0;
      booted.refitAppBar();
      const left = group.children.map((el) => el.id);
      if (left.join(',') !== 'updateMenu') {
        throw new Error(`the emptied group holds ${left.join(',') || 'nothing'}, expected the bell alone`);
      }
      if (!group.children[0].hidden) {
        throw new Error('the bell left in the group was drawn, so the group is not the emptied case at all');
      }

      bar.bar.clientWidth = 900;
      booted.refitAppBar();
      const backOn = group.children.map((el) => el.id);
      if (backOn.join(',') !== 'updateMenu,themeSheetOpen,openButton,newButton,exportPdfButton') {
        throw new Error(`a wide bar put the group back as ${backOn.join(',') || 'empty'}`);
      }
    } finally {
      bar.done();
    }
  });

  check('a menu draws whatever it holds, one row or many', () => {
    const surface = booted.document.getElementById('appSurface');
    const menuOn = () => surface.children.find((child) => String(child.className || '') === 'flow-menu');
    const run = [];
    try {
      // No export opens a menu, so nothing here may quietly run a row on the reader's behalf: this is the flowchart canvas's own right-click menu, and a list that comes down to one row is still a list.
      booted.openFlowMenuWith(10, 10, [{ label: 'Detach', run: () => run.push('Detach') }], surface);
      const one = menuOn();
      if (!one) throw new Error('a menu of one row drew nothing, so a right-click acted without being pressed');
      if (run.length) throw new Error(`opening a menu ran one of its rows: ${run.join(',')}`);
      booted.closeFlowMenu();

      booted.openFlowMenuWith(10, 10, [{ label: 'Duplicate', run: () => run.push('Duplicate') }, { label: 'Detach', run: () => run.push('Detach') }], surface);
      const menu = menuOn();
      if (!menu) throw new Error('a menu of two rows opened nothing');
      const rows = menu.children.filter((child) => child.className === 'flow-menu-item');
      if (rows.length !== 2) throw new Error(`the menu drew ${rows.length} rows rather than both`);
      if (run.length) throw new Error(`opening a menu ran one of its rows: ${run.join(',')}`);
    } finally {
      booted.closeFlowMenu();
    }
  });
}
