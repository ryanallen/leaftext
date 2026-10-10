// shelf.js
// ---------------------------------------------------------------------------
// What moves on the Arthurian shelf once `shelf-layout.js` has laid it out: picking a book off it by pointer or keyboard, the three orders it stands in, search and the three filters, the address that holds the order and the picked book so Back and Forward bring both back, and the six tones painted from the theme in force and painted again whenever the reader changes it.
//
// `web/preview/boot.js` hands `installShelf` to the host as the shelf's motion, run on whichever laid-out page is standing; the host stops the one before. Nothing animates from here: the stylesheet moves a lifted spine, and does not under reduced motion, and the page's own `openSheet`, `closeSheet` and `makeSheetDraggable` move the sheet the picked book opens in.
// ---------------------------------------------------------------------------

import { bookMarkup, SHELF_ORDERS, SHELF_TONES, shelfMarkup, sortMarkup, reachedParts } from './shelf-layout.js';

const ORDER_KEYS = SHELF_ORDERS.map((order) => order.key);
// The app's own bottom sheet, as the glossary draws it: its shadow, its grip, its close cross and a body the open book is drawn into.
const SHEET_FRAME = [
  '<span class="sheet-shadow-face" aria-hidden="true"></span>',
  '<span class="sheet-shadow-band sheet-shadow-band-top" aria-hidden="true"></span>',
  '<span class="sheet-shadow-band sheet-shadow-band-bottom" aria-hidden="true"></span>',
  '<span class="sheet-shadow-band sheet-shadow-band-left" aria-hidden="true"></span>',
  '<span class="sheet-shadow-band sheet-shadow-band-right" aria-hidden="true"></span>',
  '<div class="leaf-sheet-grip"></div>',
  '<button type="button" class="leaf-sheet-close" aria-label="Close the book"><span class="lt-icon lt-icon-close"></span></button>',
  '<div class="shelf-sheet-body document-body leaf-scroll"></div>',
].join('');
// The shelf's part of the address: `shelf=<order>` or `shelf=<order>/<book>`, written as the anchor of the document's own entry.
const SHELF_ADDRESS = /(?:^|#)shelf=([a-z]+)(?:\/([a-z0-9-]+))?$/;

/** The order and book an address names, an order or book the shelf does not hold read as none. */
export function shelfAddress(hash, data) {
  const found = SHELF_ADDRESS.exec(decodeURIComponent(String(hash || '')));
  const order = found && ORDER_KEYS.includes(found[1]) ? found[1] : 'story';
  const picked = found && found[2] && data.books.some((book) => book.book === found[2]) ? found[2] : '';
  return { order, picked };
}

/** The address with the shelf's part replaced: kept after the document's own path where the address carries one, or as the whole fragment where it does not. The host writes the anchor percent-encoded (`shelf%3Dstory%2Fmerlin`), so it is read decoded, or a second pick would stand a second shelf part after the first. */
export function shelfHash(hash, { order, picked }) {
  let said = String(hash || '');
  try {
    said = decodeURIComponent(said);
  } catch {
    // A stray % that decodes to nothing is kept as it was written.
  }
  const kept = said.replace(/#?shelf=[^#]*$/, '');
  const part = `shelf=${order}${picked ? `/${picked}` : ''}`;
  return kept && kept !== '#' ? `${kept}#${part}` : `#${part}`;
}

/** The books the search and filters leave standing, or null where nothing narrows the shelf. */
export function shownBooks(data, { search = '', part = '', tone = '', status = '' } = {}) {
  const words = search.trim().toLowerCase();
  if (!words && part === '' && !tone && !status) return null;
  return new Set(data.books
    .filter((book) => !words || book.title.toLowerCase().includes(words) || book.author.toLowerCase().includes(words))
    .filter((book) => part === '' || reachedParts(book).has(Number(part)))
    .filter((book) => !tone || book.tone === tone)
    .filter((book) => !status || book.status === status)
    .map((book) => book.book));
}

/** The six tones of the theme in force, each with its ink, set on the shelf as the values its stylesheet paints with. */
export function paintTones(root, scale) {
  const tones = typeof scale === 'function' ? scale(SHELF_TONES.length) : [];
  SHELF_TONES.forEach(([key], at) => {
    const tone = tones[at];
    if (!tone) return;
    root.style.setProperty(`--shelf-tone-${key}`, readableFill(tone.fill, tone.ink));
    root.style.setProperty(`--shelf-ink-${key}`, tone.ink);
  });
  return tones.length;
}

// A spine's title is small text, so it needs 4.5:1. The dark scale sits at a weight where the best theme ink can fall just short, so the shelf moves its own tone away from the ink, a step at a time, until the title reads; the hue stays.
const READABLE = 4.5;

function channelsOf(color) {
  const value = String(color || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const whole = parseInt(digits, 16);
    return [(whole >> 16) & 255, (whole >> 8) & 255, whole & 255];
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*1\s*)?\)$/i.exec(value);
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}

function luminanceOf(channels) {
  const part = (byte) => {
    const share = byte / 255;
    return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * part(channels[0]) + 0.7152 * part(channels[1]) + 0.0722 * part(channels[2]);
}

function contrastOf(a, b) {
  const [x, y] = [luminanceOf(a), luminanceOf(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The tone, or the nearest shade of it toward black or white that its ink reads on at 4.5:1. A color the shelf cannot measure is left as the scale gave it. */
export function readableFill(fill, ink) {
  const tone = channelsOf(fill);
  const print = channelsOf(ink);
  if (!tone || !print || contrastOf(tone, print) >= READABLE) return fill;
  const toward = luminanceOf(print) > luminanceOf(tone) ? 0 : 255;
  let shade = tone;
  for (let step = 1; step <= 20 && contrastOf(shade, print) < READABLE; step += 1) {
    shade = tone.map((byte) => Math.round(byte + (toward - byte) * step * 0.05));
  }
  return '#' + shade.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Make a laid-out shelf move. `root` is the laid-out page; `data` is `shelf-data.json`. Answers `{ stop }`, which lets go of the theme and the address.
 *
 * `env` is the window the shelf lives in, handed in by a check; the page's own otherwise.
 */
export function installShelf(root, data, env = globalThis) {
  const view = env.window || env;
  const state = { ...shelfAddress(view.location && view.location.hash, data), search: '', part: '', tone: '', status: '' };
  const find = (selector) => root.querySelector(selector);
  const box = () => find('.shelf-case');

  const drawShelf = (focus = '') => {
    const shown = shownBooks(data, state);
    box().innerHTML = shelfMarkup(data, { order: state.order, picked: state.picked, shown });
    root.setAttribute('data-shelf-order', state.order);
    if (focus) {
      const spine = root.querySelector(`.shelf-spine[data-book="${focus}"]`);
      if (spine && typeof spine.focus === 'function') spine.focus();
    }
  };
  const drawSort = () => {
    const sort = find('.shelf-sort');
    const note = find('.shelf-sort-note');
    if (!sort) return;
    const holder = view.document.createElement('div');
    holder.innerHTML = sortMarkup(state.order);
    sort.innerHTML = holder.querySelector('.shelf-sort').innerHTML;
    if (note) note.textContent = holder.querySelector('.shelf-sort-note').textContent;
  };
  // The picked book opens in a bottom sheet where the reader is, laid on the window rather than in the page, because the rail draws a copy of the page and a fixed sheet inside it would be copied too.
  const doc = view.document;
  const backdrop = doc.createElement('div');
  backdrop.className = 'lt-backdrop';
  backdrop.hidden = true;
  const sheet = doc.createElement('aside');
  sheet.className = 'leaf-sheet shelf-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'The book');
  sheet.hidden = true;
  sheet.innerHTML = SHEET_FRAME;
  if (doc.body) {
    doc.body.appendChild(backdrop);
    doc.body.appendChild(sheet);
  }
  const sheetBody = sheet.querySelector('.shelf-sheet-body');
  const sheetClose = sheet.querySelector('.leaf-sheet-close');
  let handBack = null;
  const focusOn = (element) => {
    if (!element) return;
    if (typeof view.leafFocusForKeyboard === 'function') view.leafFocusForKeyboard(element);
    else if (typeof element.focus === 'function') element.focus();
  };
  const onSheetKey = (event) => {
    if (event.key === 'Escape') putDown();
  };
  const openBook = () => {
    if (typeof view.openSheet === 'function') view.openSheet(sheet, backdrop);
    else {
      backdrop.hidden = false;
      sheet.hidden = false;
      sheet.classList.add('open');
    }
    doc.addEventListener('keydown', onSheetKey);
    focusOn(sheetClose);
  };
  const closeBook = (options) => {
    doc.removeEventListener('keydown', onSheetKey);
    if (sheet.hidden) return;
    if (typeof view.closeSheet === 'function') view.closeSheet(sheet, backdrop, options);
    else {
      sheet.classList.remove('open');
      sheet.hidden = true;
      backdrop.hidden = true;
    }
  };
  const drawBook = () => {
    const book = data.books.find((one) => one.book === state.picked) || null;
    if (!book) {
      closeBook();
      return;
    }
    handBack = book.book;
    sheetBody.innerHTML = bookMarkup(book, data);
    sheet.setAttribute('aria-label', book.title);
    if (sheet.hidden || !sheet.classList.contains('open')) openBook();
  };
  const drawAll = (focus = '') => {
    drawSort();
    drawShelf(focus);
    drawBook();
  };
  const writeAddress = () => {
    const history = view.history;
    if (!history || !view.location) return;
    const hash = shelfHash(view.location.hash, state);
    if (hash === view.location.hash) return;
    const entry = history.state && typeof history.state === 'object' ? { ...history.state, anchor: hash.slice(hash.lastIndexOf('#') + 1) } : null;
    history.pushState(entry, '', `${view.location.pathname || ''}${view.location.search || ''}${hash}`);
  };

  const pick = (book) => {
    state.picked = state.picked === book ? '' : book;
    drawShelf(book);
    drawBook();
    writeAddress();
  };
  // The cross, Escape, the backdrop and a drag down all put the book back: the pick goes, the address says so, and the keyboard is back on the spine it came from.
  function putDown(options) {
    if (!state.picked) return;
    const was = state.picked;
    state.picked = '';
    drawShelf();
    closeBook(options);
    writeAddress();
    focusOn(root.querySelector(`.shelf-spine[data-book="${handBack || was}"]`));
  }
  sheetClose.addEventListener('click', () => putDown());
  backdrop.addEventListener('click', () => putDown());
  if (typeof view.makeSheetDraggable === 'function') view.makeSheetDraggable(sheet, sheet.querySelector('.leaf-sheet-grip'), (options) => putDown(options));
  // The sheet stands outside the reading column, whose listener hands a link to the app, so the sheet hands its own over; left to the browser, a book opens as its raw file. The address keeps the pick, so Back returns to the book in its sheet.
  sheetBody.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || typeof view.sendDocumentLink !== 'function') return;
    event.preventDefault();
    closeBook();
    view.sendDocumentLink(link, typeof view.newPageModifierHeld === 'function' && view.newPageModifierHeld(event));
  });
  const sortBy = (order) => {
    if (!ORDER_KEYS.includes(order) || order === state.order) return;
    state.order = order;
    drawAll(state.picked);
    writeAddress();
  };

  const onClick = (event) => {
    const target = event.target && typeof event.target.closest === 'function' ? event.target : null;
    if (!target) return;
    const spine = target.closest('.shelf-spine');
    if (spine) {
      event.preventDefault();
      pick(spine.getAttribute('data-book'));
      return;
    }
    const sort = target.closest('.shelf-sort-button');
    if (sort) {
      event.preventDefault();
      sortBy(sort.getAttribute('data-shelf-order'));
    }
  };
  // Left and Right walk the spines, Home and End go to either end, so the shelf is read along with the keys as it is with the pointer.
  const onKey = (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function' || !target.closest('.shelf-spine')) return;
    const spines = [...root.querySelectorAll('.shelf-spine')];
    const at = spines.indexOf(target.closest('.shelf-spine'));
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: spines.length - 1 }[event.key];
    if (next == null || !spines[next]) return;
    event.preventDefault();
    spines[next].focus();
  };
  const onInput = (event) => {
    const target = event.target;
    if (!target || typeof target.matches !== 'function') return;
    if (target.matches('.shelf-search')) state.search = target.value || '';
    else if (target.matches('.shelf-filter')) state[target.getAttribute('data-shelf-filter')] = target.value || '';
    else return;
    drawShelf();
  };
  const onAddress = () => {
    if (!root.isConnected) return;
    const asked = shelfAddress(view.location.hash, data);
    if (asked.order === state.order && asked.picked === state.picked) return;
    Object.assign(state, asked);
    drawAll();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  if (typeof view.addEventListener === 'function') {
    view.addEventListener('popstate', onAddress);
    view.addEventListener('hashchange', onAddress);
  }
  // The sheet stands outside the shelf the tones are set on, so it is painted as well.
  const paint = () => {
    paintTones(root, view.leafCategoricalScale);
    paintTones(sheet, view.leafCategoricalScale);
  };
  const unsubscribe = view.leafTheme && typeof view.leafTheme.subscribe === 'function' ? view.leafTheme.subscribe(paint) : (paint(), null);
  drawAll();

  return {
    root,
    state,
    sheet,
    stop() {
      doc.removeEventListener('keydown', onSheetKey);
      sheet.remove();
      backdrop.remove();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onInput);
      if (typeof view.removeEventListener === 'function') {
        view.removeEventListener('popstate', onAddress);
        view.removeEventListener('hashchange', onAddress);
      }
      if (typeof unsubscribe === 'function') unsubscribe();
    },
  };
}
