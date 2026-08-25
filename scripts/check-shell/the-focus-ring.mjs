// Who the focus ring belongs to: the mark the page writes while the mouse is driving, and the stylesheet rule that reads it.

import vm from 'node:vm';
import {
  check,
  readingCss,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- the ring is the keyboard's ---------------------------------------------
  //
  // The engine counts a clicked dropdown as keyboard-driven, so the app answers the question itself. Two halves that only work together: a mark on the root written by the same two listeners that keep the page's own flag, and a rule keyed on that mark. Neither half is readable off one file, and a mark spelled one way in the script and another in the stylesheet is a fix that draws exactly the ring it was written to put out.

  const mark = () => booted.document.documentElement.dataset.pointerDriving;
  // A `let` at the top of a fragment, so it is in the shared scope rather than on the window.
  const driving = () => vm.runInContext('leafKeyboardDriving', booted);
  const raise = (type) => {
    const handlers = [...(booted.__windowListeners.get(type) || [])];
    if (!handlers.length) throw new Error(`nothing on the window is listening for ${type}, so the page never learns what is driving`);
    for (const handler of handlers) handler({ type });
  };

  check('a mouse press marks the root and a key press clears it', () => {
    const was = mark();
    try {
      raise('pointerdown');
      if (mark() !== 'true') throw new Error(`a mouse press left the root saying ${JSON.stringify(mark())} rather than 'true', so the ring stays lit on whatever was clicked`);
      raise('keydown');
      if (mark() !== 'false') throw new Error(`a key press left the root saying ${JSON.stringify(mark())} rather than 'false', so somebody tabbing through the app is given no ring at all`);
    } finally {
      booted.document.documentElement.dataset.pointerDriving = was;
    }
  });

  check('the mark and the page\'s own flag are never allowed to disagree', () => {
    const was = mark();
    try {
      // Both are written by the same two handlers on purpose: everything that hands focus about asks the flag, and the ring asks the mark, so a page where they part company gives a mouse user a ring while refusing to move focus for them.
      raise('pointerdown');
      if (driving() !== false || mark() !== 'true') throw new Error(`after a mouse press the flag says ${driving()} and the root says ${JSON.stringify(mark())}`);
      raise('keydown');
      if (driving() !== true || mark() !== 'false') throw new Error(`after a key press the flag says ${driving()} and the root says ${JSON.stringify(mark())}`);
    } finally {
      booted.document.documentElement.dataset.pointerDriving = was;
    }
  });

  check('the stylesheet puts the ring out on the mark the page actually writes', () => {
    const css = readingCss();
    // `dataset.pointerDriving` is the attribute `data-pointer-driving`, and nothing in either file says so. Renaming one half and not the other leaves both checks below green and the ring lit.
    if (!css.includes('[data-pointer-driving="true"]')) throw new Error('no rule in the stylesheet reads the mark the page writes while the mouse is driving, so a mouse press still paints the ring');
  });
}
