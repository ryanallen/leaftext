// The first-run bubble: what it points at, when it shows, and what meeting it settles for good.

import { join } from 'node:path';
import {
  check,
  fakeElement,
  names,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 4. the first-run bubble ------------------------------------------------

  // Two things nothing else can catch: a hint that keeps coming back after it was met (the fatigue the whole thing exists to avoid), and a bubble placed off the window. Both are arithmetic and flags, so both are reachable here.

  /** A recording page: every element the bubble builds keeps its classes, styles and listeners, and every command it sends is captured. */
  function hintHarness() {
    const sent = [];
    const built = [];
    const original = {
      createElement: booted.document.createElement,
      appendChild: booted.document.body.appendChild,
      postMessage: booted.ipc.postMessage,
    };
    booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    booted.document.createElement = (tag) => {
      const element = fakeElement(tag);
      const classes = new Set();
      const listeners = new Map();
      Object.assign(element, {
        classes,
        listeners,
        classList: {
          add: (...names) => names.forEach((name) => classes.add(name)),
          remove: (...names) => names.forEach((name) => classes.delete(name)),
          toggle() {},
          contains: (name) => classes.has(name),
        },
        style: { left: '', top: '', properties: {}, setProperty(name, value) { this.properties[name] = value; }, removeProperty() {}, getPropertyValue: () => '' },
        addEventListener: (name, handler) => listeners.set(name, handler),
        appendChild(child) {
          // Elements and nothing else, the way the page's own list is: setting the text on a box puts a run of words inside it, and words among an element's children are walked as elements the moment the box is taken off the window.
          if (child && child.nodeType !== 3) this.children.push(child);
          return child;
        },
      });
      // One set behind both ways of naming a class, because the page uses both: the bubble is built with `className` and then placed with `classList`.
      Object.defineProperty(element, 'className', {
        get: () => [...classes].join(' '),
        set: (value) => {
          classes.clear();
          String(value).split(/\s+/).forEach((name) => name && classes.add(name));
        },
      });
      built.push(element);
      return element;
    };
    booted.document.body.appendChild = (child) => child;
    return { sent, built, restore: () => {
      booted.document.createElement = original.createElement;
      booted.document.body.appendChild = original.appendChild;
      booted.ipc.postMessage = original.postMessage;
    } };
  }

  /** The bubbles among what was built, newest last. The text span and the chevron are built too. */
  const bubbles = (built) => built.filter((element) => element.classes && element.classes.has('hint-bubble'));
  const hintStates = (sent) => sent.filter((message) => message.command === 'setHintState');

  check('the vault hint shows once, and being met is permanent', () => {
    const { sent, built, restore } = hintHarness();
    try {
      booted.leafResetHints();
      // library.js registers it as it loads, so this is the real hint against the real button — with a rectangle, which the fake page's elements otherwise lack.
      const button = booted.document.getElementById('libraryVaultSwitch');
      if (!button) throw new Error('the page has no vault switch to point at');
      button.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
      // The real page's element takes no listeners, so record the pointer watch the bubble puts on it.
      const watches = new Map();
      button.addEventListener = (name, handler) => watches.set(name, handler);
      button.removeEventListener = (name) => watches.delete(name);

      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error(`the first launch drew ${bubbles(built).length} bubbles`);
      const bubble = bubbles(built)[0];
      const words = bubble.children.map((child) => child.textContent).join('');
      if (!words.includes('folder the list below shows')) throw new Error(`the bubble said "${words}"`);
      // The button sits low on the left, so the only side with room is to its right.
      if (!bubble.classes.has('is-right')) throw new Error(`placed ${[...bubble.classes].join(' ')}`);
      let state = hintStates(sent).pop();
      if (!state) throw new Error('the launch was not reported to the host');
      if (state.launches !== 1 || state.lastLaunch !== 1) throw new Error(`counted ${state.launches}/${state.lastLaunch}`);
      if (state.seen.length !== 0) throw new Error('showing a hint is not meeting it');

      // Crossing the bubble is not noticing the control, and the words must not be taken away mid-sentence — so the box itself watches nothing.
      if (bubble.listeners.size !== 0) throw new Error(`the bubble listens for ${[...bubble.listeners.keys()].join(',')}`);

      // The pointer reaching the control is the reader noticing, and it is met right then rather than when the pointer leaves — a launch that ends with the pointer on the button has still spent the hint.
      const enter = watches.get('pointerenter');
      if (typeof enter !== 'function') throw new Error('nothing watches the pointer reaching the control');
      enter();
      state = hintStates(sent).pop();
      if (!state.seen.includes('libraryVault')) throw new Error(`met hints were ${JSON.stringify(state.seen)}`);
      if (watches.has('pointerenter')) throw new Error('the pointer watch outlived the bubble');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('a met hint came back on the next launch');

      // The other way of meeting it: the button was pressed, which is what library.js calls.
      booted.leafResetHints();
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the reset did not put the hint back');
      booted.retireHint('libraryVault');
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('using the control did not retire the hint');

      // Nothing to point at draws nothing, and does not spend the launch: the next launch with the pane open gets it instead.
      booted.leafResetHints();
      button.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('a bubble pointed at something off screen');
      if (hintStates(sent).length !== 0) throw new Error('a launch with nothing to point at was spent');
    } finally {
      booted.leafResetHints();
      restore();
    }
  });

  // Only one hint ships, so a pacing check with nothing to pace against passes by having no second hint to hold back — green, and proving nothing. This registers its own.
  check('the view-tools hint retires when its tray starts to open', () => {
    const { sent, built, restore } = hintHarness();
    try {
      booted.leafResetHints();
      booted.retireHint('libraryVault');
      const tray = booted.document.getElementById('readerToolTray');
      const button = booted.document.getElementById('viewReadingButton');
      if (!tray || !button) throw new Error('the view-tools hint has no tray or view button');
      tray.hidden = false;
      tray.getBoundingClientRect = () => ({ left: 480, top: 120, right: 516, bottom: 134, width: 36, height: 14 });

      built.length = 0;
      sent.length = 0;
      booted.runHintPass();
      const bubble = bubbles(built)[0];
      if (!bubble) throw new Error('the view-tools hint drew no bubble');
      const words = bubble.children.map((child) => child.textContent).join('');
      if (!words.includes('view tools live under this edge')) throw new Error(`the bubble said "${words}"`);

      for (const handler of button.listeners.get('pointerenter') || []) handler();
      const state = hintStates(sent).pop();
      if (!state?.seen.includes('viewTools')) throw new Error(`met hints were ${JSON.stringify(state?.seen)}`);

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('the view-tools hint returned after the tray opened');
    } finally {
      booted.leafResetHints();
      restore();
    }
  });

  check('a launch rests between bubbles, and meeting one early frees nothing sooner', () => {
    const { sent, built, restore } = hintHarness();
    try {
      booted.leafResetHints();
      booted.retireHint('viewTools');
      const button = booted.document.getElementById('libraryVaultSwitch');
      button.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
      const second = fakeElement('secondTarget');
      second.getBoundingClientRect = () => ({ left: 400, top: 40, right: 440, bottom: 66, width: 40, height: 26 });
      booted.registerHint('checkPacing', () => second, 'A second hint, registered by the check.');
      const words = (element) => element.children.map((child) => child.textContent).join('');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the first launch drew no bubble');
      if (!words(bubbles(built)[0]).includes('folder the list below shows')) throw new Error('the first launch drew the wrong hint');

      // Met at once, while its own bubble is still up. The second hint is now unseen and available, and it must still wait.
      booted.retireHint('libraryVault');

      sent.length = 0;
      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 0) throw new Error('two bubbles arrived back to back');
      const rest = hintStates(sent).pop();
      if (!rest || rest.launches !== 2) throw new Error(`the rest launch was not counted: ${JSON.stringify(rest)}`);
      if (rest.lastLaunch !== 1) throw new Error('a launch that showed nothing moved the pacing mark');

      built.length = 0;
      booted.runHintPass();
      if (bubbles(built).length !== 1) throw new Error('the launch after the rest drew nothing');
      if (!words(bubbles(built)[0]).includes('registered by the check')) throw new Error('the second hint did not follow');
    } finally {
      booted.leafResetHints();
      restore();
    }
  });

  check('a sheet takes the bubble down unmet, and the last one to leave measures its target again', () => {
    const { sent, built, restore } = hintHarness();
    const wasTimeout = booted.setTimeout;
    try {
      booted.leafResetHints();
      const surface = booted.document.getElementById('appSurface');
      const button = booted.document.getElementById('libraryVaultSwitch');
      if (!surface || !button) throw new Error('the page has no surface or vault switch');
      // Low on the left, so the only side with room is to its right — and moved before the sheets go, so where the bubble comes back says whether it was measured again or put back where it was.
      let box = { left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 };
      button.getBoundingClientRect = () => box;
      const watches = new Map();
      button.addEventListener = (name, handler) => watches.set(name, handler);
      button.removeEventListener = (name) => watches.delete(name);
      // A close waits out its exit animation, and nothing here ever tells a sheet its animation ended, so the fallback runs where it stands.
      booted.setTimeout = (fn) => { fn(); return 0; };
      const onSurface = () => surface.children.filter((child) => child.classes && child.classes.has('hint-bubble'));
      const met = () => hintStates(sent).some((state) => state.seen.includes('libraryVault'));

      built.length = 0;
      sent.length = 0;
      booted.runHintPass();
      if (onSurface().length !== 1) throw new Error('the launch drew no bubble to take down');
      // Where the first one stood: ten past the right edge of the control, which is what the restored one is read against.
      const first = onSurface()[0].style.left;
      if (first !== '50px') throw new Error(`the bubble was placed at ${first}`);

      // The shared pair, which Themes, the glossary, the start-screen list and the shape picker all go through.
      booted.openThemeSheet();
      if (onSurface().length !== 0) throw new Error('the bubble stood over an open sheet');
      if (met()) throw new Error('a sheet covering the control counted as the reader meeting it');
      if (watches.has('pointerenter')) throw new Error('the pointer watch outlived the bubble');

      // A second sheet over the first: the bubble comes back for the last one to leave, not for the first.
      booted.showGlossary();
      booted.closeThemeSheet();
      if (onSurface().length !== 0) throw new Error('the bubble came back while another sheet still stood');
      // The pane the control sits in is a different width once the sheet has gone, which is the whole reason the restored bubble is measured again rather than put back where it was.
      box = { left: 600, top: 100, right: 632, bottom: 126, width: 32, height: 26 };
      booted.dismissGlossary();
      const back = onSurface();
      if (back.length !== 1) throw new Error(`the last sheet to leave put back ${back.length} bubbles`);
      // Ten past the control's new right edge: a bubble put back where it was would still be at 50.
      if (back[0].style.left !== '642px') throw new Error(`the restored bubble was placed at ${back[0].style.left}`);
      const words = back[0].children.map((child) => child.textContent).join('');
      if (!words.includes('folder the list below shows')) throw new Error(`the restored bubble said "${words}"`);

      // The flowchart editor, which shows and hides itself rather than going through that pair.
      booted.openFlowSheet({ title: 'Flowchart', text: 'flowchart LR\n  A --> B', save: () => true });
      if (onSurface().length !== 0) throw new Error('the bubble stood over the flowchart editor');
      if (met()) throw new Error('the flowchart editor counted as the reader meeting the hint');
      booted.closeFlowSheet();
      if (onSurface().length !== 1) throw new Error('the flowchart editor did not put the bubble back as it left');

      // Met while a sheet stands, by the other control the hint retires on: nothing comes back, because the promise was kept rather than held.
      booted.openThemeSheet();
      booted.retireHint('libraryVault');
      booted.closeThemeSheet();
      if (onSurface().length !== 0) throw new Error('a hint met while a sheet stood came back after it closed');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.leafResetHints();
      restore();
    }
  });

  check('each full-window view takes the bubble down unmet, and one that left the page cannot hold it down', () => {
    const app = booted.document.getElementById('app');
    const held = app.children.slice();
    // Built before the recording page goes in, so each view is opened from an element of the page's own rather than from one the harness made.
    const holder = booted.document.createElement('div');
    holder.innerHTML = '<table data-block-kind="table"><thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody></table><img src="leaf-asset://one.png" alt="One">';
    const table = holder.querySelector('table');
    const picture = holder.querySelector('img');
    const diagram = booted.document.createElement('pre');
    diagram.className = 'mermaid';
    diagram.__mermaidSource = 'flowchart TD\n  A --> B';
    const { sent, built, restore } = hintHarness();
    const wasTimeout = booted.setTimeout;
    try {
      booted.leafResetHints();
      const surface = booted.document.getElementById('appSurface');
      const button = booted.document.getElementById('libraryVaultSwitch');
      if (!surface || !button || !table || !picture) throw new Error('the page has no surface, vault switch, table or picture');
      button.getBoundingClientRect = () => ({ left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 });
      const watches = new Map();
      button.addEventListener = (name, handler) => watches.set(name, handler);
      button.removeEventListener = (name) => watches.delete(name);
      // A close waits out its exit animation, and nothing here ever tells a sheet its animation ended, so the fallback runs where it stands.
      booted.setTimeout = (fn) => { fn(); return 0; };
      const onSurface = () => surface.children.filter((child) => child.classes && child.classes.has('hint-bubble'));
      const met = () => hintStates(sent).some((state) => state.seen.includes('libraryVault'));

      built.length = 0;
      sent.length = 0;
      booted.runHintPass();
      if (onSurface().length !== 1) throw new Error('the launch drew no bubble to take down');

      // None of the three is a sheet: each builds its own overlay inside the reading view and takes it out again.
      const views = [
        ['the full-window table', () => booted.openTableSheet(table, null), () => booted.closeTableSheet()],
        ['the full-window picture', () => booted.openImageSheet(picture, null), () => booted.closeImageSheet()],
        ['the full-window diagram', () => booted.openDiagramOverlay(diagram, null), () => booted.closeDiagramOverlay()],
      ];
      for (const [naming, open, close] of views) {
        open();
        if (onSurface().length !== 0) throw new Error(`the bubble stood over ${naming}`);
        if (met()) throw new Error(`${naming} covering the control counted as the reader meeting it`);
        close();
        if (onSurface().length !== 1) throw new Error(`${naming} did not put the bubble back as it left`);
      }

      // A view taken off the window without its own close. It never says it is hidden, so a record listening for that alone holds the bubble down for the rest of the launch.
      booted.openImageSheet(picture, null);
      if (onSurface().length !== 0) throw new Error('the bubble stood over the picture it was handed to');
      app.querySelector('.image-sheet-overlay').remove();
      // A sheet coming and going beside it is what asks the record what is still standing.
      booted.openThemeSheet();
      booted.closeThemeSheet();
      if (onSurface().length !== 1) throw new Error('a view that left the page held the bubble down after it had gone');
      if (met()) throw new Error('a view that covered the control counted as the reader meeting it');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.leafResetHints();
      restore();
      for (const child of app.children.slice()) if (!held.includes(child)) child.remove();
    }
  });

  check('the control leaving takes the bubble with it, and the control coming back draws it again where it now is', () => {
    const { sent, built, restore } = hintHarness();
    const wasTimeout = booted.setTimeout;
    try {
      booted.leafResetHints();
      const surface = booted.document.getElementById('appSurface');
      const button = booted.document.getElementById('libraryVaultSwitch');
      if (!surface || !button) throw new Error('the page has no surface or vault switch');
      // Low on the left, so the only side with room is to its right — and moved before the control comes back, so where the bubble returns says whether it was measured again or put back where it stood.
      let box = { left: 8, top: 700, right: 40, bottom: 726, width: 32, height: 26 };
      button.getBoundingClientRect = () => box;
      const watches = new Map();
      button.addEventListener = (name, handler) => watches.set(name, handler);
      button.removeEventListener = (name) => watches.delete(name);
      // The takedown waits out its fade before the box leaves the page, and nothing here ever ends one, so the fallback runs where it stands.
      booted.setTimeout = (fn) => { fn(); return 0; };
      const onSurface = () => surface.children.filter((child) => child.classes && child.classes.has('hint-bubble'));
      const met = () => hintStates(sent).some((state) => state.seen.includes('libraryVault'));
      // The newest registration on the control, which is the one the bubble that is up put there.
      const watchOnControl = () => booted.__watchers.filter((one) => one.kind === 'ResizeObserver' && one.target === button).at(-1);
      // A shut pane is a control 0 by 0 and off the app, which is what `hintTarget` reads for.
      const shut = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

      built.length = 0;
      sent.length = 0;
      booted.runHintPass();
      if (onSurface().length !== 1) throw new Error('the launch drew no bubble to take down');
      if (onSurface()[0].style.left !== '50px') throw new Error(`the bubble was placed at ${onSurface()[0].style.left}`);

      const watch = watchOnControl();
      if (!watch) throw new Error('nothing watches the control the bubble points at');
      // The reader shuts the pane. The control is still on the page; it has no size and no place on the app.
      box = shut;
      watch.callback([{ target: button, contentRect: { width: 0, height: 0 } }], watch);
      if (onSurface().length !== 0) throw new Error('the bubble stood over a window the control had left');
      if (met()) throw new Error('the control going counted as the reader meeting the hint');
      if (watches.has('pointerenter')) throw new Error('the pointer watch outlived the bubble');

      // The pane comes back, at a different width than it went — which is why the box is measured again rather than put back at 50.
      box = { left: 600, top: 100, right: 632, bottom: 126, width: 32, height: 26 };
      watch.callback([{ target: button, contentRect: { width: 32, height: 26 } }], watch);
      const back = onSurface();
      if (back.length !== 1) throw new Error(`the control coming back drew ${back.length} bubbles`);
      if (back[0].style.left !== '642px') throw new Error(`the returned bubble was placed at ${back[0].style.left}`);
      const words = back[0].children.map((child) => child.textContent).join('');
      if (!words.includes('folder the list below shows')) throw new Error(`the returned bubble said "${words}"`);

      // A sheet closing while the control is still away must hold the promise rather than spend it: the sheet has gone and the pane has not come back, so there is nothing to draw against yet and the watch is what draws it.
      box = shut;
      watchOnControl().callback([{ target: button, contentRect: { width: 0, height: 0 } }], watchOnControl());
      if (onSurface().length !== 0) throw new Error('the bubble stood over a window the control had left a second time');
      booted.openThemeSheet();
      booted.closeThemeSheet();
      if (onSurface().length !== 0) throw new Error('a sheet closing drew a bubble against a control that is not there');
      box = { left: 600, top: 100, right: 632, bottom: 126, width: 32, height: 26 };
      watchOnControl().callback([{ target: button, contentRect: { width: 32, height: 26 } }], watchOnControl());
      if (onSurface().length !== 1) throw new Error('a sheet passing while the control was away spent the hint, so the control coming back drew nothing');
      if (met()) throw new Error('none of that counted as the reader meeting the hint');

      // Met for good: the watch goes with the promise, so a later report cannot put a met bubble back.
      booted.retireHint('libraryVault');
      if (onSurface().length !== 0) throw new Error('meeting the hint left its bubble up');
      const after = watchOnControl();
      after.callback([{ target: button, contentRect: { width: 32, height: 26 } }], after);
      if (onSurface().length !== 0) throw new Error('a report after the hint was met drew it again');
    } finally {
      booted.setTimeout = wasTimeout;
      booted.leafResetHints();
      restore();
    }
  });

  check('the bubble takes the first side that fits the window whole', () => {
    const view = { width: 1080, height: 820 };
    const size = { width: 260, height: 60 };
    const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
    const side = (target, at = view) => booted.hintPlacement(target, size, at).side;

    // Room on the right is the first choice, wherever else there is room too.
    if (side(box(20, 400, 32, 26)) !== 'right') throw new Error('a target with room to its right went elsewhere');
    // Against the right edge it flips rather than being clipped or squeezed.
    if (side(box(1040, 400, 32, 26)) !== 'left') throw new Error('a target at the right edge did not flip left');
    // No room either side — a full-width target — so it goes above, then below.
    if (side(box(14, 400, 1052, 26)) !== 'above') throw new Error('a wide target did not go above');
    if (side(box(14, 20, 1052, 26)) !== 'below') throw new Error('a wide target near the top did not go below');

    // The cross axis is clamped inside the margin, and the chevron then follows the target rather than the box: 19px down a 60px-tall bubble whose own center is 30.
    const high = booted.hintPlacement(box(20, 20, 32, 26), size, view);
    if (high.top !== 14) throw new Error(`the bubble was not held off the top edge: ${high.top}`);
    if (high.tail !== 19) throw new Error(`the chevron lost the target: ${high.tail}`);

    // A window too small for any side still puts the box on screen rather than off it.
    const tiny = booted.hintPlacement(box(10, 10, 40, 40), size, { width: 200, height: 120 });
    if (tiny.left < 14 || tiny.top < 14) throw new Error(`the bubble went off a small window: ${tiny.left},${tiny.top}`);
  });
}
