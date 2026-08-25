// The menu a right-click asks for, and what each of its rows reads.

import vm from 'node:vm';
import {
  check,
  layerOf,
  layersPainted,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 3c. the menu a right-click asks for reads ------------------------------
  //
  // A rest on a link raises the card and a right-click on that same link moves no pointer, so nothing takes the card down on its own. Two things hold it: the card is painted under every menu, and the menu takes it down as it opens. Neither is readable off one file — the layers are a rule and a token apart, and the dismissal only shows in the order two fragments run.

  check('a card a rest raises is painted under every menu and over every sheet', () => {
    const menu = layerOf('.context-menu');
    const card = layerOf('.link-hover-tip');
    if (!(card < menu)) throw new Error(`the hover card is painted at ${card} against the menu's ${menu}, so it covers the menu the reader asked for`);
    // A rest on a link inside the term sheet raises a card, so the card cannot simply drop under the sheets.
    const sheet = layerOf('.glossary-sheet');
    if (!(card > sheet)) throw new Error(`the hover card is painted at ${card} against the term sheet's ${sheet}, so a card raised on a link inside that sheet is drawn behind it`);
  });

  check('a message is painted over everything that covers its corner and under every menu', () => {
    const menu = layerOf('.context-menu');
    const message = layerOf('.app-toast');
    // The strip takes presses and can carry an Undo button, and a menu can open across the corner it sits in, so a message over a menu could take a press meant for a menu row.
    if (!(message < menu)) throw new Error(`a message is painted at ${message} against the menu's ${menu}, so it stands over a menu opened under it`);
    // Every sheet, full-window view and dim is walked rather than named: a failure is only worth raising if the reader can read it, and each of these covers the corner it lands in.
    for (const rule of layersPainted()) {
      if (rule.selector === '.app-toast' || rule.layer >= menu) continue;
      if (rule.layer >= message) throw new Error(`${rule.selector} is painted at ${rule.layer} against a message's ${message}, so a message raised while it is open is drawn behind it`);
    }
  });

  check('the first-run bubble is painted under every menu', () => {
    const menu = layerOf('.context-menu');
    const bubble = layerOf('.hint-bubble');
    // It points at the pane's folder switch, and a right-click on a folder row below opens a menu into the same space before the pointer has ever reached the switch.
    if (!(bubble < menu)) throw new Error(`the first-run bubble is painted at ${bubble} against the menu's ${menu}, so it stands over a menu opened under it`);
  });

  const LINK_HREF = 'notes/first.md';
  const hoverLink = () => {
    const item = {
      href: LINK_HREF,
      getAttribute: (name) => (name === 'href' ? LINK_HREF : null),
      getBoundingClientRect: () => ({ top: 200, left: 200, right: 300, bottom: 220, width: 100, height: 20 }),
    };
    item.closest = () => item;
    return item;
  };
  /** Raise the card on `link` the way a rest does, and answer the card element. */
  function raiseCard(link) {
    booted.__menuHoverEvent = { target: link, relatedTarget: { body: true }, clientX: 240, clientY: 210 };
    vm.runInContext('startLinkHover(__menuHoverEvent);', booted);
    booted.__frames.drain();
    const tip = vm.runInContext('linkHoverTip', booted);
    if (tip.hidden || !tip.classList.contains('shown')) throw new Error('the card never came up, so there was nothing for the menu to be covered by');
    return tip;
  }
  const clearCard = () => {
    vm.runInContext('endLinkHoverFade(); activeHoverLink = null; linkHoverPointer = null; linkHoverTip.hidden = true; linkHoverTip.classList.remove("shown"); hideLinkHoverPreview(); activeHoverToken += 1;', booted);
    delete booted.__menuHoverEvent;
  };

  check('a right-click on the link the card is up on leaves the menu alone on screen', () => {
    const menu = vm.runInContext('contextMenu', booted);
    try {
      const link = hoverLink();
      const tip = raiseCard(link);
      booted.showContextMenu(240, 210, LINK_HREF, 'link', link);
      if (menu.hidden || !menu.children.length) throw new Error('the right-click opened no menu at all');
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('the card is still up over the menu the reader just asked for');
    } finally {
      booted.hideContextMenu();
      clearCard();
    }
  });

  check('the card does not come back while the menu it made way for is up', () => {
    try {
      const link = hoverLink();
      raiseCard(link);
      booted.showContextMenu(240, 210, LINK_HREF, 'link', link);
      const tip = vm.runInContext('linkHoverTip', booted);
      // The pointer has not left the link, so a move over it is the one thing that could raise it again.
      for (const handler of booted.document.listeners.get('pointermove') || []) {
        handler({ target: link, clientX: 242, clientY: 212 });
      }
      booted.__frames.drain();
      if (!tip.hidden || tip.classList.contains('shown')) throw new Error('a pointer twitch put the card back over the open menu');
    } finally {
      booted.hideContextMenu();
      clearCard();
    }
  });

  check('a right-click that opens no menu leaves the card standing', () => {
    const menu = vm.runInContext('contextMenu', booted);
    try {
      const link = hoverLink();
      const tip = raiseCard(link);
      // The library's own top: no path, so `showContextMenu` returns before it draws anything.
      booted.showContextMenu(240, 210, '', 'folder');
      if (!menu.hidden && menu.children.length) throw new Error('an empty path drew a menu');
      if (tip.hidden || !tip.classList.contains('shown')) throw new Error('a right-click that opened nothing took the card down with it');
    } finally {
      booted.hideContextMenu();
      clearCard();
    }
  });
}
