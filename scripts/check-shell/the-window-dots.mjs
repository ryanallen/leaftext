// The three window buttons: what the middle one asks for on each platform, and what it calls itself.

import { check, record, runShell, source } from './shared.mjs';

export function run() {
  if (!record.booted) return;

  // ---- the middle button ------------------------------------------------------

  /** A shell of one platform, with every command it sends recorded and the middle button ready to press. */
  function dots({ macFrame = false } = {}) {
    const sent = [];
    const context = runShell(source, {
      __leafFrameless: !macFrame,
      __leafMacFrame: macFrame,
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
    });
    const button = context.document.getElementById('winMaximize');
    const press = (event = {}) => {
      sent.length = 0;
      for (const handler of button.listeners.get('click') || []) handler(event);
      return sent.map((message) => message.command);
    };
    return {
      press,
      label: () => button.getAttribute('aria-label'),
      title: () => button.getAttribute('title'),
      fullscreen: (on) => context.window.leafSetFullscreen(on),
      maximized: (on) => context.window.leafSetWindowMaximized(on),
    };
  }

  check('the Mac green dot means full screen, and Option-press is the zoom it used to be', () => {
    const mac = dots({ macFrame: true });

    const plain = mac.press({});
    if (plain.join() !== 'windowToggleFullscreen') {
      throw new Error(`a plain press on the green dot sent ${plain.join() || 'nothing'} rather than full screen`);
    }

    const held = mac.press({ altKey: true });
    if (held.join() !== 'windowToggleMaximize') {
      throw new Error(`an Option-press sent ${held.join() || 'nothing'} rather than zoom`);
    }

    // The way out, and the one press that must not depend on a modifier: Option held in full screen would otherwise zoom a window that has no desktop to zoom into.
    mac.fullscreen(true);
    for (const event of [{}, { altKey: true }]) {
      const out = mac.press(event);
      if (out.join() !== 'windowToggleFullscreen') {
        throw new Error(`a press in full screen sent ${out.join() || 'nothing'} rather than the way out`);
      }
    }
  });

  check('the Windows square goes on meaning zoom, with or without the modifier', () => {
    const windows = dots();
    for (const event of [{}, { altKey: true }]) {
      const sent = windows.press(event);
      if (sent.join() !== 'windowToggleMaximize') {
        throw new Error(`a press on the Windows square sent ${sent.join() || 'nothing'} rather than zoom`);
      }
    }
  });

  check('each platform calls the middle button what it does', () => {
    const mac = dots({ macFrame: true });
    // From the first paint, not from the first toggle: the markup carries the Windows word.
    const says = (dot, want, when) => {
      if (dot.label() !== want || dot.title() !== want) {
        throw new Error(`${when} the button says ${dot.label()} rather than ${want}`);
      }
    };
    says(mac, 'Enter Full Screen', 'on a Mac at rest');
    mac.fullscreen(true);
    says(mac, 'Exit Full Screen', 'on a Mac in full screen');
    mac.fullscreen(false);
    says(mac, 'Enter Full Screen', 'on a Mac back on the desktop');
    // Zoom is what the Option-press does, and it never renames the dot: a Mac reader pressing it plainly still gets full screen.
    mac.maximized(true);
    says(mac, 'Enter Full Screen', 'on a zoomed Mac');

    const windows = dots();
    says(windows, 'Maximize', 'on Windows at rest');
    windows.maximized(true);
    says(windows, 'Restore', 'on a maximized Windows window');
    windows.maximized(false);
    says(windows, 'Maximize', 'on a restored Windows window');
  });
}
