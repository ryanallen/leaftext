// The shadow band down the window's edge.

import { join } from 'node:path';
import {
  check,
  record,
  root,
  runShell,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- the shadow band is the window's edge -----------------------------------

  /** A Windows shell whose app box is inset from the window the way the band insets it, with every command it sends recorded. */
  function bandPress({ frameless = true, macFrame = false, maximized = false } = {}) {
    const sent = [];
    const context = runShell(source, {
      __leafFrameless: frameless,
      __leafMacFrame: macFrame,
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
    });
    const surface = context.document.getElementById('appSurface');
    // 20px at the sides, 13px above and 10px below a 1080x820 window — the band's own sizes. The rectangle takes in the app's own drawn line, which is the hairline the page reads back off the element.
    surface.getBoundingClientRect = () => ({ left: 20, top: 13, right: 1060, bottom: 810, width: 1040, height: 797 });
    surface.clientTop = 1;
    surface.clientLeft = 1;
    if (maximized) context.document.body.classList.contains = (name) => name === 'is-maximized';
    // Everything the page has is inside one fixed box, so the body has no height of its own and a press in the band lands on the page root above it. Raised on the document, which is where the page has to be listening for one at all.
    const raise = (type, event) => {
      const held = context.document.listeners.get(type) || [];
      if (!held.length) throw new Error(`nothing on the page is watching the document for a ${type}`);
      for (const handler of held) handler(event);
    };
    const press = (x, y) => {
      sent.length = 0;
      let prevented = false;
      raise('mousedown', { button: 0, clientX: x, clientY: y, target: context.document.documentElement, preventDefault: () => (prevented = true) });
      return { sent: [...sent], prevented };
    };
    const move = (x, y) => {
      raise('mousemove', { clientX: x, clientY: y, target: context.document.documentElement });
      return context.document.documentElement.style.cursor;
    };
    const watching = (type) => (context.document.listeners.get(type) || []).length;
    // A whole drag, the way a Mac page follows one: a press, moves, and the release. The screen point rides on every part of it, and the pointer is captured so a drag outward keeps reporting once it has left the window.
    const captured = [];
    context.document.documentElement.setPointerCapture = (id) => captured.push(id);
    const pointer = (type, x, y, screen) =>
      raise(type, {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: x,
        clientY: y,
        screenX: screen ? screen[0] : x,
        screenY: screen ? screen[1] : y,
        preventDefault: () => {},
      });
    const drag = (from, steps) => {
      sent.length = 0;
      pointer('pointerdown', from[0], from[1], from);
      for (const step of steps) pointer('pointermove', step[0], step[1], step);
      pointer('pointerup', from[0], from[1], from);
      return { sent: [...sent], captured: [...captured] };
    };
    return { context, press, move, watching, drag };
  }

  /** Only the resize asks: other fragments watch the document for a press too, and a click anywhere is allowed to close a menu. */
  const resizeAsks = (sent) => sent.filter((message) => message.command === 'windowResizeDrag');

  check('a press in the shadow band asks for the resize its own edge means', () => {
    const band = bandPress();
    const direction = (x, y) => {
      const { sent, prevented } = band.press(x, y);
      const asks = resizeAsks(sent);
      if (asks.length !== 1) throw new Error(`a press at ${x},${y} asked for ${asks.length} resizes`);
      // Without this the drag sweeps a selection across the page under the band instead of resizing.
      if (!prevented) throw new Error(`a press at ${x},${y} left the page free to start a selection`);
      return asks[0].direction;
    };
    const cases = [
      [540, 4, 'n'],
      [1070, 4, 'ne'],
      [1070, 400, 'e'],
      [1070, 815, 'se'],
      [540, 815, 's'],
      [4, 815, 'sw'],
      [4, 400, 'w'],
      [4, 4, 'nw'],
    ];
    for (const [x, y, want] of cases) {
      const got = direction(x, y);
      if (got !== want) throw new Error(`a press at ${x},${y} asked for ${got} rather than ${want}`);
    }
    // Inside the app is the document, a control or a menu — never a resize.
    const inside = band.press(540, 400);
    if (resizeAsks(inside.sent).length !== 0) throw new Error('a press inside the app asked for a resize');
    if (inside.prevented) throw new Error('a press inside the app was swallowed');
  });

  check('the pointer says the band can be grabbed before anyone presses it', () => {
    const band = bandPress();
    const shape = (x, y) => band.move(x, y) || '';
    const cases = [
      [540, 4, 'n-resize'],
      [1070, 4, 'ne-resize'],
      [1070, 400, 'e-resize'],
      [1070, 815, 'se-resize'],
      [540, 815, 's-resize'],
      [4, 815, 'sw-resize'],
      [4, 400, 'w-resize'],
      [4, 4, 'nw-resize'],
    ];
    for (const [x, y, want] of cases) {
      const got = shape(x, y);
      if (got !== want) throw new Error(`the pointer at ${x},${y} read ${got || 'the arrow'} rather than ${want}`);
    }
    // Back inside the app it is the arrow again, or the band leaves a resize pointer over the whole document.
    if (shape(540, 400) !== '') throw new Error('the resize pointer followed the pointer into the app');
  });

  check('the line the app draws round itself resizes rather than being the first dead pixel', () => {
    const band = bandPress();
    // The app box runs 20,13 to 1060,810 and its own hairline is the outermost pixel of that.
    const onTheLine = [
      [540, 13, 'n'],
      [1059, 400, 'e'],
      [540, 809, 's'],
      [20, 400, 'w'],
      [20, 13, 'nw'],
      [1059, 809, 'se'],
    ];
    for (const [x, y, want] of onTheLine) {
      const asks = resizeAsks(band.press(x, y).sent);
      if (asks.length !== 1) throw new Error(`the drawn line at ${x},${y} is still dead`);
      if (asks[0].direction !== want) throw new Error(`the drawn line at ${x},${y} asked for ${asks[0].direction} rather than ${want}`);
    }
    // Just inside it is the app: a press there is the document, a control or a menu.
    for (const [x, y] of [[540, 14], [1058, 400], [540, 808], [21, 400]]) {
      if (resizeAsks(band.press(x, y).sent).length !== 0) throw new Error(`a press inside the app at ${x},${y} asked for a resize`);
    }
  });

  check('a window filling the screen asks for no resize', () => {
    // No band to grab, and the platform refuses the resize anyway.
    const full = bandPress({ maximized: true });
    if (resizeAsks(full.press(4, 4).sent).length !== 0) throw new Error('a maximized window still asked for a resize');
  });

  check('a Mac follows the whole drag, and Windows hands the press over and hears no more', () => {
    const mac = bandPress({ frameless: false, macFrame: true });
    const { sent, captured } = mac.drag([4, 400], [[0, 400], [-30, 400]]);
    const asks = resizeAsks(sent);
    const phases = asks.map((one) => one.phase).join(' ');
    if (phases !== 'start move move end') throw new Error(`a Mac drag sent ${phases || 'nothing'}`);
    if (asks.some((one) => one.direction !== 'w')) throw new Error('a phase of the drag forgot which edge it was grabbed by');
    // The screen point is what the host works the new window rectangle out from.
    if (asks[2].x !== -30 || asks[2].y !== 400) throw new Error(`the move carried ${asks[2].x},${asks[2].y} rather than the pointer on the screen`);
    // Without the capture the moves stop at the edge the drag started from, so a window can never be dragged bigger.
    if (!captured.length) throw new Error('the pointer was never captured, so a drag outward stops at the window edge');

    // Windows hands the window to the platform's own loop on the press, which swallows everything after it.
    const windows = bandPress();
    const only = resizeAsks(windows.press(4, 400).sent);
    if (only.length !== 1 || only[0].phase !== 'start') throw new Error('a Windows press is no longer the whole of what it sends');
    // Other fragments watch the document for a moving pointer too, so it is the extra watch a Mac page takes that says which of the two is following the drag.
    if (mac.watching('pointermove') <= windows.watching('pointermove')) {
      throw new Error('a Windows page is following a drag the platform already owns, or a Mac page is not following one at all');
    }
  });
}
