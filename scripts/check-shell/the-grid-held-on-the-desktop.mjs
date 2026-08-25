// The chrome's dot grid holding its place on the desktop while the window slides over it.

import { check, readingCss, record, runShell, source } from './shared.mjs';

export function run() {
  if (!record.booted) return;

  /** The pitch as the stylesheet writes it, which is the one place that number lives. */
  function pitchFromTheStylesheet() {
    const written = /--lt-grid-pitch:\s*([\d.]+)px/.exec(readingCss());
    if (!written) throw new Error('the stylesheet no longer writes --lt-grid-pitch, so the page has no pitch to read');
    return Number(written[1]);
  }

  /** A booted page standing at a place on the desktop, with the stylesheet's pitch where the page reads it from. */
  function pageAt(x, y, { withPitch = true } = {}) {
    const context = runShell(source, { screenX: x, screenY: y });
    if (withPitch) {
      context.document.documentElement.style.setProperty('--lt-grid-pitch', `${pitchFromTheStylesheet()}px`);
      // The pitch is re-read per gesture, so a page told about it after boot is asked again by the same call a theme change makes.
      context.window.leafWindowMoveStopped();
    }
    return context;
  }

  const offsetOf = (context) => [
    context.document.documentElement.style.getPropertyValue('--lt-grid-offset-x'),
    context.document.documentElement.style.getPropertyValue('--lt-grid-offset-y'),
  ];

  // ---- a still grid, with no note ever sent -----------------------------------

  check('a page nobody tells about a move still draws a grid in the right place', () => {
    const pitch = pitchFromTheStylesheet();
    const context = pageAt(3 * pitch + 7, 5 * pitch + 13);
    const [x, y] = offsetOf(context);
    if (x !== '-7px' || y !== '-13px') {
      throw new Error(`a page standing 7 and 13 past a whole pitch owes -7px and -13px, and wrote ${x} and ${y}`);
    }
  });

  check('a page that cannot read the pitch leaves the grid still rather than wrong', () => {
    const context = pageAt(137, 241, { withPitch: false });
    const [x, y] = offsetOf(context);
    if (x !== '' || y !== '') {
      throw new Error(`with no pitch to wrap against the page must write no offset at all, and wrote ${x} and ${y}`);
    }
  });

  // ---- the offset is never bigger than one pitch ------------------------------

  check('the grid is slid back by less than one pitch however far across the desktop the window is', () => {
    const pitch = pitchFromTheStylesheet();
    for (const place of [0, 1, pitch - 1, pitch, pitch + 1, 1917, 3840, -13, -pitch]) {
      const context = pageAt(place, place);
      const [x] = offsetOf(context);
      const slid = -Number.parseFloat(x);
      if (!(slid >= 0 && slid < pitch)) {
        throw new Error(`a window at ${place} slid the lattice ${slid}, which is not inside one ${pitch}px pitch`);
      }
      if ((place - slid) % pitch !== 0) {
        throw new Error(`a window at ${place} slid the lattice ${slid}, which leaves the dots off the desktop's own lattice`);
      }
    }
  });

  // ---- the frame loop runs between the host's two notes and nowhere else ------

  check('the page reads where it is only between the two notes the host sends', () => {
    const pitch = pitchFromTheStylesheet();
    const context = pageAt(0, 0);
    const frames = context.window.__frames;
    // Other parts of the page queue frames of their own at boot, so what is counted here is the queue growing and shrinking rather than its size. One frame is run at a time: this loop puts itself straight back on the queue, so draining would only ever hit the cap.
    const others = frames.waiting();
    const gridFrames = () => frames.waiting() - others;
    const lastQueued = () => {
      const held = [...frames.queue.entries()];
      return held[held.length - 1];
    };
    const runTheGridsFrame = () => {
      const [id, fn] = lastQueued();
      frames.queue.delete(id);
      fn(0);
    };

    // Nothing of the grid's is queued before the host says a move started, which is what keeps a reader that sits open all day off a frame callback.
    if (gridFrames()) throw new Error('the page queued a frame of the grid with no move under way');

    context.window.leafWindowMoveStarted();
    if (gridFrames() !== 1) throw new Error('the note that a move started did not put the page on the frame queue');

    // Each frame reads the window's place again — straight, never a guess at where it is going next — and puts itself back on the queue.
    for (const place of [pitch + 4, 2 * pitch + 9]) {
      context.window.screenX = place;
      context.window.screenY = place;
      runTheGridsFrame();
      const [x, y] = offsetOf(context);
      if (x !== `-${place % pitch}px` || y !== `-${place % pitch}px`) {
        throw new Error(`a window that moved to ${place} mid-gesture owes -${place % pitch}px, and the page wrote ${x} and ${y}`);
      }
      if (gridFrames() !== 1) throw new Error('a frame of a move did not put the next one on the queue');
    }

    // A second note that a move started is not a second loop: two of them would read the window twice a frame for ever after.
    context.window.leafWindowMoveStarted();
    if (gridFrames() !== 1) throw new Error('a second start note put a second frame loop on the queue');

    context.window.screenX = 3 * pitch + 6;
    context.window.leafWindowMoveStopped();
    if (gridFrames()) throw new Error('the note that the move stopped left the page on the frame queue');
    const [restX] = offsetOf(context);
    if (restX !== '-6px') {
      throw new Error(`the last read is the place the window came to rest at, which is -6px, and the page wrote ${restX}`);
    }
  });
}
