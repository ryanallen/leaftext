// The three window buttons: what the middle one asks for on each platform, what it calls itself, and the state the host puts on the page when another app takes the window.

import { check, fakePage, readingCss, record, runShell, source } from './shared.mjs';

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
    const key = (event = {}) => {
      sent.length = 0;
      for (const handler of context.document.listeners.get('keydown') || []) handler(event);
      return sent.map((message) => message.command);
    };
    return {
      press,
      key,
      label: () => button.getAttribute('aria-label'),
      title: () => button.getAttribute('title'),
      fullscreen: (on) => context.window.leafSetFullscreen(on),
      maximized: (on) => context.window.leafSetWindowMaximized(on),
      active: (on) => context.window.leafSetWindowActive(on),
      hasActiveHook: () => typeof context.window.leafSetWindowActive === 'function',
      windowEvent: (name) => {
        for (const handler of context.__windowListeners.get(name) || []) handler({});
      },
      asBrowser: () => {
        context.window.__leafHostAnswers = () => true;
      },
      bodyClasses: () => String(context.document.body.className || '').split(/\s+/).filter(Boolean),
    };
  }


  // ---- what an inactive window steps back by ---------------------------------

  /** The stylesheet with its comments taken out, so what follows reads rules rather than sentences about them. */
  function statedCss() {
    return readingCss().replace(/\/\*[\s\S]*?\*\//g, '');
  }

  /** The selector of the one rule an inactive window hangs off, as the stylesheet spells it. */
  function inactiveSelector() {
    const css = statedCss();
    const at = css.indexOf('body.is-window-inactive');
    if (at < 0) throw new Error('no rule in the stylesheet answers a window that went behind another app');
    return css.slice(at, css.indexOf('{', at)).trim();
  }

  /** The declarations of that same rule, one per entry, as the stylesheet spells them. */
  function inactiveBody() {
    const css = statedCss();
    const at = css.indexOf('body.is-window-inactive');
    if (at < 0) throw new Error('no rule in the stylesheet answers a window that went behind another app');
    const opened = css.indexOf('{', at);
    return css
      .slice(opened + 1, css.indexOf('}', opened))
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  check('an inactive window steps back as one thing, and one filter is the whole of it', () => {
    const css = statedCss();
    const selector = inactiveSelector();
    const declarations = inactiveBody();

    // One rule, never a treatment beside a list of hand-kept tokens. Two of those is what made the leaf and the rail read as different effects, and a list can never fade at all: a custom property is not an animatable type, so it jumps where a filter interpolates.
    const hangingOff = css.split('body.is-window-inactive').length - 1;
    if (hangingOff !== 1) {
      throw new Error(`${hangingOff} rules hang off body.is-window-inactive, and one filter over the whole window is the whole state`);
    }

    // One declaration, and its two amounts spent from the rows in design/tokens.md rather than typed in here, where nothing measures either against the floor they were chosen for.
    const wanted = 'filter: saturate(var(--lt-inactive-saturation)) contrast(var(--lt-inactive-contrast))';
    if (declarations.length !== 1 || declarations[0] !== wanted) {
      throw new Error(`the inactive rule says ${declarations.join('; ') || 'nothing'} rather than ${wanted}`);
    }

    // `opacity` composites the bar's own shade with the page behind it, so the top of the window reads as see-through and every tab edge, divider and panel seam that shade covers comes out as a line; `grayscale` takes a tinted family's shade off the bar and leaves the card beside it tinted. Neither may come back, in the selector or in the body.
    for (const refused of ['opacity', 'grayscale']) {
      if (selector.includes(refused) || declarations.join(';').includes(refused)) {
        throw new Error(`the inactive state reaches for ${refused}, which is what made the window read as see-through and drew lines across it`);
      }
    }

    // A printed or exported page is rendered out of children of this same surface, so a guard missing here bakes an inactive window into a file somebody keeps.
    for (const guard of [':not(.leaf-paper)', ':not(.leaf-paper-diagram)', ':not(.leaf-paper-picture)']) {
      if (!selector.includes(guard)) {
        throw new Error(`the inactive rule is missing ${guard}, so it reaches a page being printed or exported: ${selector}`);
      }
    }
  });

  check('the one filter is over the app itself, so nothing can be added beside it and stay vivid', () => {
    const selector = inactiveSelector();
    const { byId } = fakePage();
    const surface = byId.get('appSurface');
    if (!surface || !surface.children.length) throw new Error('the app surface holds nothing, so this check is reading the wrong element');

    // The state names one element and it is the app itself. Naming anything narrower is how the chrome, the document and the rail came to be three treatments; naming something outside it would leave a part of the window at full color with nothing saying so.
    const painted = selector.slice(selector.lastIndexOf(' ') + 1);
    if (painted !== '.app-surface') {
      throw new Error(`the inactive rule paints ${painted} rather than the app surface alone: ${selector}`);
    }

    // And everything the page is built with really is inside it, or the rule reaches all of the window only on paper.
    if (!surface.children.some((child) => String(child.className || '').split(/\s+/).includes('app-bar'))) {
      throw new Error('the app bar is not inside the app surface, so the one filter does not reach the chrome');
    }
  });

  // ---- the middle button, continued -------------------------------------------

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

  check('F11 enters full screen on Windows and stays with Show Desktop on a Mac', () => {
    let prevented = false;
    const windows = dots();
    const sent = windows.key({ key: 'F11', preventDefault: () => { prevented = true; } });
    if (sent.join() !== 'windowToggleFullscreen' || !prevented) {
      throw new Error(`F11 sent ${sent.join() || 'nothing'} and ${prevented ? 'was' : 'was not'} kept from the page`);
    }

    const mac = dots({ macFrame: true });
    if (mac.key({ key: 'F11', preventDefault: () => {} }).length) {
      throw new Error('F11 took Show Desktop away from the Mac');
    }
  });

  check('the Windows square means zoom out of full screen and becomes the way out while full screen is on', () => {
    const windows = dots();
    for (const event of [{}, { altKey: true }]) {
      const sent = windows.press(event);
      if (sent.join() !== 'windowToggleMaximize') {
        throw new Error(`a press on the Windows square out of full screen sent ${sent.join() || 'nothing'} rather than zoom`);
      }
    }
    windows.fullscreen(true);
    for (const event of [{}, { altKey: true }]) {
      const sent = windows.press(event);
      if (sent.join() !== 'windowToggleFullscreen') {
        throw new Error(`a press on the Windows square in full screen sent ${sent.join() || 'nothing'} rather than the way out`);
      }
    }
  });

  check('the host can tell either platform its window went behind another app', () => {
    // Both hosts, because the state is not a Mac decoration: Windows draws its own three buttons out of the same markup, so the hook has to be there whichever frame came up. Defined unconditionally for the browsers too, where nothing ever calls it and the page therefore stays active.
    for (const [when, dot] of [['a Mac', dots({ macFrame: true })], ['Windows', dots()]]) {
      if (!dot.hasActiveHook()) {
        throw new Error(`${when} window has no way for the host to say it lost focus`);
      }
      const atRest = dot.bodyClasses();
      if (atRest.includes('is-window-inactive')) {
        throw new Error(`${when} window came up already reading as inactive`);
      }

      dot.active(false);
      const quiet = dot.bodyClasses();
      if (!quiet.includes('is-window-inactive')) {
        throw new Error(`${when} window kept its chrome bright after the host said another app has it`);
      }
      // Only that one class: the state must not take a tab, close a panel or move the window, because the reader comes back to the window they left.
      const alsoMoved = quiet.filter((name) => name !== 'is-window-inactive' && !atRest.includes(name));
      const alsoLost = atRest.filter((name) => !quiet.includes(name));
      if (alsoMoved.length || alsoLost.length) {
        throw new Error(`losing focus on ${when} window also changed ${[...alsoMoved, ...alsoLost].join(', ')}`);
      }

      dot.active(true);
      if (dot.bodyClasses().includes('is-window-inactive')) {
        throw new Error(`${when} window stayed quiet after it came back to the front`);
      }
    }
  });

  check('the page sees the switch itself, so the first one is enough', () => {
    // On Windows the top-level window never holds the keyboard while the web view has it, so `tao` raises no focus event at all and without this the state arrives only once the window has been left and come back twice. The page's own blur and focus fire from the first switch, so both platforms watch for themselves.
    for (const [when, dot] of [['a Mac', dots({ macFrame: true })], ['Windows', dots()]]) {
      dot.windowEvent('blur');
      if (!dot.bodyClasses().includes('is-window-inactive')) {
        throw new Error(`${when} window stayed bright when the page itself lost focus, so the first switch away does nothing`);
      }
      dot.windowEvent('focus');
      if (dot.bodyClasses().includes('is-window-inactive')) {
        throw new Error(`${when} window stayed quiet when the page came back`);
      }
    }

    // A browser raises the same blur when the reader clicks another tab, and a published site must never gray its own chrome for that. Read inside the handler rather than at load, so a host that sets the marker after this script runs is still a browser.
    const browser = dots();
    browser.asBrowser();
    browser.windowEvent('blur');
    if (browser.bodyClasses().includes('is-window-inactive')) {
      throw new Error('a published site grayed its own chrome when the reader clicked another browser tab');
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
