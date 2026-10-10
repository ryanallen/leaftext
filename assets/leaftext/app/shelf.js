// shelf.js
// ---------------------------------------------------------------------------
// What moves on the Arthurian shelf once `shelf-layout.js` has laid it out: picking a book off it by pointer or keyboard, the three orders it stands in, search and the three filters, the address that holds the order and the picked book so Back and Forward bring both back, and the six tones painted from the theme in force and painted again whenever the reader changes it.
//
// `web/preview/boot.js` hands `installShelf` to the host as the shelf's motion, run on whichever laid-out page is standing; the host stops the one before. Nothing animates from here: the stylesheet moves a lifted spine, and does not under reduced motion.
// ---------------------------------------------------------------------------

import { bookMarkup, SHELF_ORDERS, SHELF_TONES, shelfMarkup, sortMarkup, reachedParts } from './shelf-layout.js';

const ORDER_KEYS = SHELF_ORDERS.map((order) => order.key);
// The shelf's part of the address: `shelf=<order>` or `shelf=<order>/<book>`, written as the anchor of the document's own entry.
const SHELF_ADDRESS = /(?:^|#)shelf=([a-z]+)(?:\/([a-z0-9-]+))?$/;

/** The order and book an address names, an order or book the shelf does not hold read as none. */
export function shelfAddress(hash, data) {
  const found = SHELF_ADDRESS.exec(decodeURIComponent(String(hash || '')));
  const order = found && ORDER_KEYS.includes(found[1]) ? found[1] : 'story';
  const picked = found && found[2] && data.books.some((book) => book.book === found[2]) ? found[2] : '';
  return { order, picked };
}

/** The address with the shelf's part replaced: kept after the document's own path where the address carries one, or as the whole fragment where it does not. */
export function shelfHash(hash, { order, picked }) {
  const kept = String(hash || '').replace(/#?shelf=[^#]*$/, '');
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
    root.style.setProperty(`--shelf-tone-${key}`, tone.fill);
    root.style.setProperty(`--shelf-ink-${key}`, tone.ink);
  });
  return tones.length;
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
  const drawBook = () => {
    const open = find('.shelf-book');
    if (!open) return;
    const holder = view.document.createElement('div');
    holder.innerHTML = bookMarkup(data.books.find((book) => book.book === state.picked) || null, data);
    const fresh = holder.querySelector('.shelf-book');
    open.className = fresh.className;
    if (fresh.getAttribute('data-tone')) open.setAttribute('data-tone', fresh.getAttribute('data-tone'));
    else open.removeAttribute('data-tone');
    open.innerHTML = fresh.innerHTML;
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
  const paint = () => paintTones(root, view.leafCategoricalScale);
  const unsubscribe = view.leafTheme && typeof view.leafTheme.subscribe === 'function' ? view.leafTheme.subscribe(paint) : (paint(), null);
  drawAll();

  return {
    root,
    state,
    stop() {
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
