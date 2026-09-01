// The menu a right-click asks for, and what each of its rows reads.

import vm from 'node:vm';
import {
  check,
  fakeElement,
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

  // ---- the picture's own menu -------------------------------------------------
  //
  // Every branch below the link answers for the note the picture sits in, so before this a right-click aimed at a picture offered to reveal the note's folder and to bin the note. What the picture gets instead is read here by raising the real event on the document, because a list matched as text passes whether or not any click ever reaches it.

  // A rendered picture's address: the protocol the host resolves back to a file, with the token a render stamps on.
  const PICTURE_SRC = 'leaf-image://local/imgs/shot.png?leaf-epoch=3';
  const REMOTE_SRC = 'https://example.com/shot.png';

  /** A picture on the surface named, wearing the address and marks a check asks for, and answered along with the page it was hung on. */
  function pictureOn({ src = PICTURE_SRC, surface = 'reader-layout', missing = false, linked = false, lane = false } = {}) {
    const layout = fakeElement('menuPictureLayout');
    layout.classList.add(surface);
    const body = fakeElement('menuPictureBody');
    body.classList.add('document-body');
    layout.appendChild(body);
    const picture = fakeElement('menuPicture');
    picture.tagName = 'IMG';
    picture.setAttribute('src', src);
    if (missing) picture.dataset.imageMissing = 'true';
    if (lane) {
      const block = fakeElement('menuPictureLane');
      block.tagName = 'P';
      block.classList.add('image-lane');
      block.dataset.srcStart = '40';
      block.dataset.srcEnd = '80';
      body.appendChild(block);
      block.appendChild(picture);
      return picture;
    }
    if (linked) {
      const link = fakeElement('menuPictureLink');
      link.tagName = 'A';
      link.setAttribute('href', 'notes/second.md');
      body.appendChild(link);
      link.appendChild(picture);
    } else {
      body.appendChild(picture);
    }
    return picture;
  }

  /** Right-click `target` the way the web view does, and answer whether the page took the gesture. */
  function rightClick(target) {
    let taken = false;
    const event = { target, clientX: 300, clientY: 300, preventDefault: () => { taken = true; } };
    for (const handler of booted.document.listeners.get('contextmenu') || []) handler(event);
    return taken;
  }

  /** The words on the rows of the menu standing open, separators left out. */
  function openRows() {
    const menu = vm.runInContext('contextMenu', booted);
    if (menu.hidden) return [];
    return menu.children
      .filter((child) => String(child.className || '').includes('context-menu-item'))
      .map((child) => String(child.textContent || ''));
  }

  const PICTURE_ROWS = ['Open picture', 'Copy picture', 'Copy path', 'Reveal file', 'Properties'];

  check('a picture on this disk answers with its own rows rather than the note it sits in', () => {
    try {
      if (!rightClick(pictureOn())) throw new Error('the right-click on a picture was left to the web view');
      const rows = openRows();
      if (rows.join(' | ') !== PICTURE_ROWS.join(' | ')) {
        throw new Error(`a picture answered with ${JSON.stringify(rows)} rather than its own rows`);
      }
      // Why the branch exists at all: the page's own list can bin the open note off a click aimed at a picture.
      if (rows.some((row) => row.startsWith('Delete'))) throw new Error('a locked picture still offers a Delete');
    } finally {
      booted.hideContextMenu();
    }
  });

  check('a picture answers the three file rows about itself, not about the open note', () => {
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      const picture = pictureOn();
      rightClick(picture);
      const menu = vm.runInContext('contextMenu', booted);
      for (const row of menu.children.filter((child) => String(child.className || '').includes('context-menu-item'))) {
        if (String(row.textContent) === 'Open picture' || String(row.textContent) === 'Copy picture') continue;
        (row.listeners.get('click') || []).forEach((handler) => handler({}));
        rightClick(picture);
      }
      const names = sent.map((one) => one.command);
      if (names.join(' | ') !== 'copyImagePath | revealImage | showImageProperties') {
        throw new Error(`the picture rows sent ${JSON.stringify(names)}`);
      }
      // The picture's own address and nothing about the note: a command carrying a path would be the fault this branch was built to end.
      for (const one of sent) {
        if (one.src !== PICTURE_SRC) throw new Error(`${one.command} carried ${JSON.stringify(one.src)} rather than the picture's own address`);
        if ('path' in one) throw new Error(`${one.command} still names a file of the open note's`);
      }
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.hideContextMenu();
    }
  });

  check('the picture already open on the whole window keeps the read-only rows and loses Open', () => {
    try {
      rightClick(pictureOn({ surface: 'image-sheet-overlay' }));
      const rows = openRows();
      if (rows.includes('Open picture')) throw new Error('the full-window picture offers to open itself again');
      if (rows.join(' | ') !== PICTURE_ROWS.slice(1).join(' | ')) {
        throw new Error(`the full-window picture answered with ${JSON.stringify(rows)}`);
      }
    } finally {
      booted.hideContextMenu();
    }
  });

  check('a picture wrapped in a link keeps the link’s own menu', () => {
    const app = booted.document.getElementById('app');
    const wasContains = app.contains;
    try {
      // The real page's `app` holds the document; this one answers no to everything, and `documentLinkFor` asks it before it answers with a link at all.
      app.contains = () => true;
      rightClick(pictureOn({ linked: true }));
      const rows = openRows();
      if (rows.includes('Open picture')) throw new Error('a linked picture answered with the picture menu, so the link it wraps cannot be opened');
      if (!rows.includes('Copy link')) throw new Error(`a linked picture answered with ${JSON.stringify(rows)} rather than the link's own rows`);
    } finally {
      app.contains = wasContains;
      booted.hideContextMenu();
    }
  });

  check('a picture with no file behind it falls through to the page it is drawn in', () => {
    for (const [name, made] of [
      ['a picture served from the web', pictureOn({ src: REMOTE_SRC })],
      ['the mark standing in for a picture that would not load', pictureOn({ missing: true })],
    ]) {
      try {
        rightClick(made);
        const rows = openRows();
        if (rows.includes('Open picture') || rows.includes('Copy picture')) {
          throw new Error(`${name} answered with the picture menu, and every row of it wants a file`);
        }
      } finally {
        booted.hideContextMenu();
      }
    }
  });

  // Copy is the one row carrying the picture's own pixels rather than an address, and the one way it breaks quietly is by encoding whatever the page is showing instead of the picture the menu was opened on — which on a page of screenshots is a different picture every time. The encoder is asked for before the row's first await, so this reads it without ever leaving the check.
  check('Copy picture points the encoder at the picture under the pointer', () => {
    const asked = [];
    const wasCanvas = booted.pictureCanvas;
    try {
      // Never answered: what is being read is which picture the row reached for, and letting the encode finish would leave the page working after the check had gone.
      booted.pictureCanvas = (picture) => {
        asked.push(picture.getAttribute('src'));
        return new Promise(() => {});
      };
      // Two pictures in one page, so a copy of "the picture on screen" would pick the wrong one.
      const first = pictureOn();
      const second = fakeElement('menuSecondPicture');
      second.tagName = 'IMG';
      second.setAttribute('src', 'leaf-image://local/imgs/other.png?leaf-epoch=3');
      first.parentElement.appendChild(second);

      rightClick(second);
      const menu = vm.runInContext('contextMenu', booted);
      const copy = menu.children.find((child) => String(child.textContent || '') === 'Copy picture');
      if (!copy) throw new Error('the picture menu offers no Copy picture');
      (copy.listeners.get('click') || []).forEach((handler) => handler({}));
      if (String(asked) !== 'leaf-image://local/imgs/other.png?leaf-epoch=3') {
        throw new Error(`the encoder was pointed at ${JSON.stringify(asked)} rather than the picture that was right-clicked`);
      }
    } finally {
      booted.pictureCanvas = wasCanvas;
      booted.hideContextMenu();
    }
  });

  // ---- taking the picture out of the document ---------------------------------
  //
  // The one row that changes the note, so what it is offered on is the claim. Read by running, because every way it is wrong is a row a reader presses: absent where they asked for it, or standing over a picture whose only source range is the sentence around it.

  /** Run `body` with the padlock open and one document's source in the page, then put both back. */
  function whileUnlocked(source, body) {
    const was = {
      unlocked: vm.runInContext('readingUnlocked', booted),
      source: vm.runInContext('sliceSourceBytes(0, documentSourceLength())', booted),
    };
    booted.__menuSource = source;
    try {
      vm.runInContext('readingUnlocked = true; setDocumentSource(__menuSource);', booted);
      body();
    } finally {
      booted.__menuWas = was;
      vm.runInContext('readingUnlocked = __menuWas.unlocked; setDocumentSource(__menuWas.source);', booted);
      delete booted.__menuWas;
      delete booted.__menuSource;
    }
  }

  check('Delete picture is offered only on a picture of its own that the padlock has opened', () => {
    // Locked is the state a reader is in until they ask to type, and the row was what could bin the open note off a click aimed at a picture.
    try {
      rightClick(pictureOn({ lane: true }));
      if (openRows().some((row) => row.startsWith('Delete'))) throw new Error('a locked document still offers to delete');
    } finally {
      booted.hideContextMenu();
    }

    whileUnlocked('# Note\n\n![Shot](imgs/shot.png)\n\nAfter.\n', () => {
      for (const [name, made, wanted] of [
        ['a picture on a line of its own', pictureOn({ lane: true }), true],
        ['a picture written inside a sentence', pictureOn(), false],
        ['the picture already open on the whole window', pictureOn({ surface: 'image-sheet-overlay', lane: true }), false],
      ]) {
        try {
          rightClick(made);
          const has = openRows().includes('Delete picture');
          if (has !== wanted) throw new Error(`${name} was ${wanted ? 'not ' : ''}offered Delete picture`);
        } finally {
          booted.hideContextMenu();
        }
      }
    });
  });

  // ---- a right press asks, and does not edit ----------------------------------
  //
  // The press that opens a block onto its raw source answers only the left button: cancel a right press and the block swaps to its Markdown before the menu's handler runs, so the picture the gesture was aimed at is gone by then. Read by raising both events in the order the web view raises them, because the menu is only right if the block is still drawn when it arrives.

  /** A code block on a reader page, stamped with the bytes it covers and wired the way the render wires one. */
  function codeBlockOn(start, end) {
    const layout = fakeElement('menuFenceLayout');
    layout.classList.add('reader-layout');
    const body = fakeElement('menuFenceBody');
    body.classList.add('document-body');
    layout.appendChild(body);
    const block = fakeElement('menuFence');
    block.tagName = 'PRE';
    block.dataset.srcStart = String(start);
    block.dataset.srcEnd = String(end);
    block.dataset.blockKind = 'code_block';
    body.appendChild(block);
    return block;
  }

  /** Press `target` with the button named, the way the web view does, and answer whether the block opened its source. */
  function pressOn(block, target, button) {
    const press = (block.listeners.get('pointerdown') || [])[0];
    if (!press) throw new Error('the block answers a press with nothing');
    press({ target, button, preventDefault() {} });
    return block.dataset.editingSource === 'true';
  }

  const LANE_SOURCE = 'x'.repeat(40) + '![Shot](imgs/shot.png)'.padEnd(40, ' ') + '\n\nAfter.\n';
  const FENCE_SOURCE = '# Note\n\n```\ncode\n```\n';

  check('a right press on a picture leaves it a picture and answers with its own menu', () => {
    whileUnlocked(LANE_SOURCE, () => {
      const picture = pictureOn({ lane: true });
      const block = picture.parentElement;
      booted.wireSourceEditable(block);
      try {
        if (pressOn(block, picture, 2)) {
          throw new Error('a right press swapped the picture for its Markdown, so the menu opens over a line of text');
        }
        if (!rightClick(picture)) throw new Error('the right-click on a picture was left to the web view');
        const rows = openRows();
        if (rows.join(' | ') !== [...PICTURE_ROWS, 'Delete picture'].join(' | ')) {
          throw new Error(`a right-clicked picture answered with ${JSON.stringify(rows)} rather than its own rows`);
        }
      } finally {
        booted.hideContextMenu();
      }
    });
  });

  check('a right press on a code block leaves it drawn and answers with the page’s own menu', () => {
    const was = vm.runInContext('currentState', booted);
    booted.__menuState = { tabs: [{ path: 'notes/first.md' }], active: 0 };
    try {
      vm.runInContext('currentState = __menuState;', booted);
      // The fence runs from the opener to the newline closing it, which is what a render stamps a code block with.
      const block = codeBlockOn(8, 20);
      booted.wireSourceEditable(block);
      if (pressOn(block, block, 2)) throw new Error('a right press opened the code block’s source, so no menu comes up at all');
      if (!rightClick(block)) throw new Error('the right-click on a code block was left to the web view');
      const rows = openRows();
      if (rows.join(' | ') !== 'Favorite | Copy path | Reveal file | Properties | Delete') {
        throw new Error(`a right-clicked code block answered with ${JSON.stringify(rows)} rather than the page’s own rows`);
      }
    } finally {
      booted.hideContextMenu();
      booted.__menuWas = was;
      vm.runInContext('currentState = __menuWas;', booted);
      delete booted.__menuWas;
      delete booted.__menuState;
    }
  });

  check('a left press still opens either block’s source, so the guard did not take the editor with it', () => {
    whileUnlocked(LANE_SOURCE, () => {
      const picture = pictureOn({ lane: true });
      const block = picture.parentElement;
      booted.wireSourceEditable(block);
      if (!pressOn(block, picture, 0)) throw new Error('a left press on a picture no longer opens its Markdown');
    });
    whileUnlocked(FENCE_SOURCE, () => {
      const block = codeBlockOn(8, 20);
      booted.wireSourceEditable(block);
      if (!pressOn(block, block, 0)) throw new Error('a left press on a code block no longer opens its source');
    });
  });

  check('Delete picture takes the paragraph out in one splice and leaves the picture file alone', () => {
    const wasSend = booted.ipc.postMessage;
    const sent = [];
    // The paragraph the stand marks as its own runs from 40 to 80 in this source, and the blank line after it belongs to the delete.
    const source = 'x'.repeat(40) + '![Shot](imgs/shot.png)'.padEnd(40, ' ') + '\n\nAfter.\n';
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      whileUnlocked(source, () => {
        rightClick(pictureOn({ lane: true }));
        const menu = vm.runInContext('contextMenu', booted);
        const row = menu.children.find((child) => String(child.textContent || '') === 'Delete picture');
        if (!row) throw new Error('an unlocked picture on its own line offers no Delete picture');
        // The one row drawn in the danger color, because it is the only one that changes the note.
        if (!String(row.className).includes('is-danger')) throw new Error('Delete picture is drawn like every other row');
        (row.listeners.get('click') || []).forEach((handler) => handler({}));
      });
      const edits = sent.filter((one) => one.command === 'editBlock');
      if (edits.length !== 1) throw new Error(`Delete picture sent ${edits.length} edits rather than one press of undo`);
      if (edits[0].text !== '') throw new Error('Delete picture wrote something in the paragraph rather than taking it away');
      if (edits[0].start !== 40) throw new Error(`the splice started at ${edits[0].start} rather than at the paragraph`);
      // The separator after the paragraph goes with it, or the note keeps a blank line where the picture was.
      if (edits[0].end !== 82) throw new Error(`the splice ended at ${edits[0].end} rather than past the paragraph's own blank line`);
      // Nothing asks the host to remove anything: the padlock grants document editing, not file deletion.
      if (sent.some((one) => one.command === 'deleteFile')) throw new Error('Delete picture asked for a file to be deleted');
      if (sent.some((one) => one.autosave)) throw new Error('Delete picture wrote to the disk without the reader saving');
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.hideContextMenu();
    }
  });
}
