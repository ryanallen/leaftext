// The app's own box, not the window's.

import {
  check,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- the app's own box, not the window's ------------------------------------

  check('a menu opened hard against the edge lands inside the app, not inside the window', () => {
    const win = booted.window;
    const surface = win.document.getElementById('appSurface');
    if (!surface) throw new Error('the page has no app surface to place anything inside');
    // The app, inset from a 1080x820 window the way the shadow band insets it: 20px at the sides, 13px above, 10px below.
    const room = { left: 20, top: 13, right: 1060, bottom: 810, width: 1040, height: 797 };
    const was = surface.getBoundingClientRect;
    surface.getBoundingClientRect = () => room;
    const place = (x, y) => {
      const box = { hidden: true, offsetWidth: 200, offsetHeight: 120, style: {} };
      win.leafPlaceFloating(box, x, y);
      return box.style;
    };
    try {
      // Asked for past the app's own right and bottom edges: held inside it, with the 8px margin, in the app's own coordinates.
      const corner = place(1075, 805);
      if (corner.left !== '832px' || corner.top !== '669px') {
        throw new Error(`a menu at the edge landed at ${corner.left},${corner.top} instead of inside the app at 832px,669px`);
      }
      // Asked for at a point well inside: the window's number crosses into the app's, so the menu opens where the pointer is rather than 20px off it.
      const inside = place(120, 213);
      if (inside.left !== '100px' || inside.top !== '200px') {
        throw new Error(`a menu inside the app opened at ${inside.left},${inside.top} rather than under the pointer at 100px,200px`);
      }
      // Asked for above and left of the app entirely: the margin, never a negative offset that would put it under the shadow.
      const before = place(0, 0);
      if (before.left !== '8px' || before.top !== '8px') {
        throw new Error(`a menu asked for outside the app opened at ${before.left},${before.top} rather than at the margin`);
      }
    } finally {
      surface.getBoundingClientRect = was;
    }
  });
}
