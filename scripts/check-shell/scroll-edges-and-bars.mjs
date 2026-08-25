// The edge a scrollable box draws, and the bar that rises on the box being moved.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  check,
  fakeElement,
  record,
  root,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  check('a home list draws an edge only where there is more list past it', () => {
    /** A scroll box that really has a position and a size, and the box holding it, with the classes recorded. */
    function boxAt(scrollTop, clientHeight, scrollHeight) {
      const classes = new Set();
      const scroll = Object.assign(fakeElement('scroll'), { scrollTop, clientHeight, scrollHeight });
      let onScroll = null;
      scroll.addEventListener = (name, handler) => {
        if (name === 'scroll') onScroll = handler;
      };
      const box = Object.assign(fakeElement('box'), {
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
        querySelector: () => scroll,
      });
      booted.watchHomeList(box);
      return { classes, scroll, scrolled: () => onScroll && onScroll() };
    }

    const top = boxAt(0, 400, 900);
    if (top.classes.has('has-above')) throw new Error('a list at its first row drew a soft top edge');
    if (!top.classes.has('has-below')) throw new Error('a list with more below drew no bottom edge');

    const bottom = boxAt(500, 400, 900);
    if (!bottom.classes.has('has-above')) throw new Error('a scrolled list drew no top edge');
    if (bottom.classes.has('has-below')) throw new Error('a list at its last row drew a soft bottom edge');

    const short = boxAt(0, 400, 400);
    if (short.classes.has('has-above') || short.classes.has('has-below')) {
      throw new Error('a list that fits whole drew an edge');
    }

    // The bar over these edges is not this watcher's: it belongs to the shared one below, which serves the pane, the reader and a wide table by the same route.
    top.scrolled();
    if (top.classes.has('is-scrolling')) throw new Error('a home list still raises its own bar');
  });

  // Every bar in the app answers the scroll rather than the pointer, off one watcher: the pane, the reader with no rail, a widened table and any box marked .leaf-scroll, plus the start screen's two lists.
  check('the shared watcher raises a bar on the box that moved and takes it away when that box rests', () => {
    const classes = new Set();
    const box = Object.assign(fakeElement('scroll'), {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    });
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    let armed = null;
    let cleared = [];
    booted.setTimeout = (fn) => {
      armed = fn;
      return 42;
    };
    booted.clearTimeout = (id) => cleared.push(id);
    try {
      booted.leafMarkScrolling(box);
      if (!classes.has('is-scrolling')) throw new Error('the box moved and the bar stayed away');
      if (!armed) throw new Error('nothing was set to take the bar away again');
      // A second notch restarts that box's own timer rather than stacking another one, or a bar goes while the box is still moving.
      const first = armed;
      booted.leafMarkScrolling(box);
      if (!cleared.includes(42)) throw new Error('a second notch left the first timer running');
      if (armed === first) throw new Error('a second notch never rearmed the timer');
      armed();
      if (classes.has('is-scrolling')) throw new Error('the bar never goes once the box stops');
      // Scrolling the page itself targets the document, which has no classes to stamp.
      booted.leafMarkScrolling(booted.document);
      booted.leafMarkScrolling(null);
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
    }
  });

  // The two wearers with nothing to bind to: the reader shell, replaced by every render, and a wide table, which comes out of Markdown with nowhere to carry a class. Delegation is what covers them, so a box that did not exist at boot has to be stamped like any other, and each has to rest on its own clock.
  check('a scroller made after boot is stamped, and one box resting does not take another box’s bar', () => {
    const made = () => {
      const classes = new Set();
      return {
        classes,
        el: Object.assign(fakeElement('made-later'), {
          classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
          },
        }),
      };
    };
    const reader = made();
    const table = made();
    const wasTimeout = booted.setTimeout;
    const wasClear = booted.clearTimeout;
    const armed = [];
    const cleared = [];
    booted.setTimeout = (fn) => armed.push(fn);
    booted.clearTimeout = (id) => {
      if (id !== undefined) cleared.push(id);
    };
    try {
      booted.leafMarkScrolling(reader.el);
      booted.leafMarkScrolling(table.el);
      if (!reader.classes.has('is-scrolling') || !table.classes.has('is-scrolling')) {
        throw new Error('a box created after boot was left unwatched');
      }
      if (armed.length !== 2) throw new Error('the two boxes share one clock');
      // The second box must not have reset the first one's clock, or a page with two scrollers leaves a bar up for ever.
      if (cleared.length) throw new Error('a second box moving reset the first box’s clock');
      armed[0]();
      if (reader.classes.has('is-scrolling')) throw new Error('the first box kept its bar past its rest');
      if (!table.classes.has('is-scrolling')) throw new Error('one box resting took the bar off another still moving');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.clearTimeout = wasClear;
    }
  });

  // The gutter sits outside the box's own width, so the pointer being on the bar is an offset past `clientWidth` — or past `clientHeight`, on a sideways bar. Both directions here, because the wide table wears the same rule with its bar along the bottom.
  check('the pointer in a box’s own gutter raises that box’s bar, and neither reason cancels the other', () => {
    // The wearer class is in the same store the stamps go into, because the box answers the page's own list by what it wears rather than by being told yes.
    const classes = new Set(['leaf-scroll']);
    const box = Object.assign(fakeElement('gutter'), {
      clientWidth: 286,
      clientHeight: 400,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    });
    const at = (offsetX, offsetY) => booted.leafMarkPointing({ target: box, offsetX, offsetY });
    at(290, 120);
    if (!classes.has('is-pointing')) throw new Error('the pointer on the bar’s own gutter raises nothing');
    at(120, 120);
    if (classes.has('is-pointing')) throw new Error('the bar stays raised once the pointer is back over the content');
    at(120, 404);
    if (!classes.has('is-pointing')) throw new Error('a sideways bar’s gutter along the bottom is never seen');
    // A box made after boot is covered the same way, and one it is not a wearer at all is never stamped.
    const other = Object.assign(fakeElement('plain'), { clientWidth: 0, clientHeight: 0 });
    booted.leafMarkPointing({ target: other, offsetX: 40, offsetY: 40 });
    if (classes.has('is-pointing')) throw new Error('moving off onto something else left the bar up');
    // The two reasons are independent: a wheel while the pointer is already there, then the pointer leaving, must leave the bar up until the box has been still.
    const wasTimeout = booted.setTimeout;
    booted.setTimeout = () => 1;
    try {
      at(290, 120);
      booted.leafMarkScrolling(box);
      if (!classes.has('is-pointing') || !classes.has('is-scrolling')) {
        throw new Error('one reason for the bar took the other one off');
      }
      at(120, 120);
      if (classes.has('is-pointing')) throw new Error('the pointer leaving mid-scroll left the thickening behind');
      if (!classes.has('is-scrolling')) throw new Error('the pointer leaving mid-scroll took the whole bar with it');
    } finally {
      booted.setTimeout = wasTimeout;
      classes.clear();
      booted.leafMarkPointing(null);
    }
  });

  // The one refusal in the wearer list, and the one child step in it. Neither is a class a box can simply wear, so a matcher reading only a class leaves the pointer check handing itself the answer.
  check('the wearer list refuses a reading surface with a minimap and takes a table only inside its lane', () => {
    const gutter = (box) => {
      booted.leafMarkPointing({ target: box, offsetX: box.clientWidth + 4, offsetY: 20 });
      const raised = box.classList.contains('is-pointing');
      booted.leafMarkPointing(null);
      return raised;
    };
    const sized = (box) => Object.assign(box, { clientWidth: 200, clientHeight: 300 });

    const readers = fakeElement('reader-pair');
    readers.innerHTML = '<section class="reader-shell">plain</section><section class="reader-shell has-minimap">mapped</section>';
    if (!gutter(sized(readers.children[0]))) throw new Error('a reading surface with no minimap was refused by the entry that names it');
    if (gutter(sized(readers.children[1]))) throw new Error('a reading surface with a minimap raised a bar the list refuses it');

    const lane = fakeElement('table-pair');
    lane.innerHTML = '<div class="table-lane"><table>inside</table></div><table>outside</table>';
    if (!gutter(sized(lane.children[0].children[0]))) throw new Error('a table inside its lane was refused by the child step that names it');
    if (gutter(sized(lane.children[1]))) throw new Error('a table with no lane above it answered a child step');

    // The descendant step, and the entry inside it that names what is inside a code block rather than the block's own holder.
    const doc = fakeElement('document-pair');
    doc.innerHTML = '<div class="document-body"><pre>fenced<code>inner</code></pre></div><pre>loose</pre>';
    const fenced = doc.children[0].children[0];
    if (!gutter(sized(fenced))) throw new Error('a code block inside the document body was refused by the descendant step that names it');
    if (gutter(sized(doc.children[1]))) throw new Error('a code block with no document body above it answered a descendant step');
    if (!gutter(sized(fenced.children[0]))) throw new Error('the code inside a fenced block was refused by the entry that names it');
  });

  // The stand-in page takes document listeners and drops them, so the registration cannot be reached through it. Read off the fragment instead, the way the canvas's own listeners are.
  check('one passive listener in the capture phase is what sees every scroller', () => {
    const fragment = readFileSync(join(root, 'src/assets/shell/dom.js'), 'utf8');
    const registered = /document\.addEventListener\(\s*'scroll',[^;]*\{[^}]*capture:\s*true[^}]*passive:\s*true[^}]*\}\s*\)/.test(fragment);
    if (!registered) {
      throw new Error('dom.js does not register the scroll listener on document in the capture phase, passively');
    }
    const pointing = /document\.addEventListener\(\s*'pointermove',\s*leafMarkPointing,\s*\{[^}]*capture:\s*true[^}]*passive:\s*true[^}]*\}\s*\)/.test(fragment);
    if (!pointing) {
      throw new Error('dom.js does not register the pointer watcher on document in the capture phase, passively');
    }
    // A rectangle read per mouse move is a forced layout on every move across the whole window.
    if (/getBoundingClientRect/.test(fragment.slice(fragment.indexOf('function leafMarkPointing')))) {
      throw new Error('the pointer watcher reads a rectangle on every move');
    }
    if (!/leafMarkScrolling\(event\.target\)/.test(fragment)) {
      throw new Error('the listener stamps something other than the box that scrolled');
    }
    // A per-box binding is the one way this quietly breaks: the reader is rebuilt on every render and a table has nothing to bind to.
    const others = readFileSync(join(root, 'src/assets/shell/render-document.js'), 'utf8');
    if (/is-scrolling/.test(others)) throw new Error('the start screen still stamps a bar of its own');
  });
}
