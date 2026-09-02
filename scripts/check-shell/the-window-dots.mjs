// The three window buttons: what the middle one asks for on each platform, what it calls itself, and the state the host puts on the page when another app takes the window.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check, fakePage, readingCss, record, root, runShell, source } from './shared.mjs';

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


  // ---- what an inactive window quiets ----------------------------------------

  /** The selector of the one rule `body.is-window-inactive` grays, as the stylesheet spells it. */
  function inactiveSelector() {
    const css = readingCss();
    const at = css.indexOf('body.is-window-inactive ');
    if (at < 0) throw new Error('no rule in the stylesheet answers a window that went behind another app');
    const opened = css.indexOf('{', at);
    return css.slice(at, opened).trim();
  }

  /** The declarations of that same rule, as the stylesheet spells them. */
  function inactiveBody() {
    const css = readingCss();
    const at = css.indexOf('body.is-window-inactive ');
    if (at < 0) throw new Error('no rule in the stylesheet answers a window that went behind another app');
    const opened = css.indexOf('{', at);
    return css.slice(opened + 1, css.indexOf('}', opened)).replace(/\/\*[\s\S]*?\*\//g, '');
  }

  /** The declarations of the rule that quiets the minimap's clone of the document, as the stylesheet spells them. */
  function minimapInkBody() {
    const css = readingCss();
    const at = css.indexOf('body.is-window-inactive .reader-minimap');
    if (at < 0) throw new Error("nothing in the stylesheet quiets the rail's clone of the document, so it stays a bright picture beside quiet chrome");
    const opened = css.indexOf('{', at);
    return css.slice(opened + 1, css.indexOf('}', opened)).replace(/\/\*[\s\S]*?\*\//g, '');
  }

  /** Every color name a family is drawn from, out of the sections asked for, in the file that is the list of them. */
  function colorNames(wanted) {
    const page = readFileSync(join(root, 'design', 'colors.md'), 'utf8');
    const names = [];
    for (const heading of wanted) {
      const at = page.indexOf(`${heading}\n`);
      if (at < 0) throw new Error(`design/colors.md no longer has a ${heading} section, so this check is reading the wrong list`);
      const end = page.indexOf('\n## ', at + heading.length);
      const section = page.slice(at, end < 0 ? page.length : end);
      for (const line of section.split('\n')) {
        const row = /^\| ([a-z][a-z0-9-]*) +\|/.exec(line);
        if (row) names.push(row[1]);
      }
    }
    if (names.length < 2) throw new Error(`only ${names.length} color names read out of ${wanted.join(', ')} in design/colors.md, so the table shape moved under this check`);
    return names;
  }

  check('the inactive state paints nothing and only takes the color out', () => {
    const selector = inactiveSelector();
    const body = inactiveBody();

    // The whole of round 3. `opacity` composites the bar's own shade with the page behind it, so the top of the window reads as see-through and every tab edge, divider and panel seam that shade was covering comes out as a line; `filter: grayscale` takes a tinted family's shade off the bar and leaves the card beside it tinted. Neither may come back, and the general form of the rule is what holds it: a declaration here is a custom property or it is painting something.
    for (const line of body.split(';')) {
      const declaration = line.trim();
      if (!declaration) continue;
      if (!declaration.startsWith('--lt-')) {
        throw new Error(`the inactive rule paints instead of re-pointing a token, which is what made the window see-through and drew lines across it: ${declaration}`);
      }
    }

    // Nothing in the rule makes a stacking context now, so both roots are named whole and the corner arc that a stacking context on the pane used to sever is out of this rule's reach entirely.
    if (selector.includes('> *')) {
      throw new Error(`the inactive rule still reaches a root's children, which nothing here needs any more: ${selector}`);
    }
    for (const named of ['.app-bar', '.library-pane']) {
      if (!selector.includes(named)) throw new Error(`the inactive rule no longer names ${named}: ${selector}`);
    }
    if (readingCss().includes('transition: filter var(--lt-duration-120)')) {
      throw new Error('the stylesheet still times the inactive state as a filter, and the state no longer has one');
    }

    // The document is what a reader came for, and the two print boxes are what an exported or printed page is rendered out of — quieting one of those would bake an inactive window into a file somebody keeps. The scrim carries no color and its whole job is how much document shows through.
    for (const kept of ['.document-body', '.document-code', '.lt-backdrop', '.diagram-print', '.picture-print']) {
      if (selector.includes(kept)) {
        throw new Error(`the inactive rule reaches ${kept}, which must stay exactly as it was: ${selector}`);
      }
    }
  });

  check('every color a chrome family is drawn from either goes gray or is written down as staying', () => {
    const body = inactiveBody();

    // Re-pointed, because each one is a hue or the ink the frame draws with: the text and every `currentColor` icon, the leaf and the pressed tool, a matched hit, the danger button, the warning and success marks, a finished bar, a link in the interface, the ring around whatever holds the keyboard, a hovered chrome button, and the minimap's viewport box.
    const grayed = [
      'foreground', 'border-strong', 'hover-tint',
      'primary', 'accent', 'danger', 'warning', 'success', 'done', 'link', 'link-hover', 'focus-ring',
      'navigation-button-hover-background', 'minimap-viewport-border', 'minimap-viewport-background',
    ];
    // Left exactly as the family wrote it, each for its own reason: the window and its chrome surfaces, because a state that moves a background is the state the owner threw out; the ordinary hairline, because every neutral below it is a surface and a line drawn in one of those is a line gone, which changes the frame's shape rather than quieting it; the quiet-text color, because it is what everything else here is re-pointed at, and every neutral under it is unreadable as text; every `-foreground`, because it is what prints on a fill and graying both takes the contrast with them; the selection pair, because selected text stays selected; and the home screen's own rows and a disabled button's grays, which carry no hue to take.
    const kept = [
      'background', 'surface', 'surface-elevated', 'surface-muted', 'surface-sunken',
      'border', 'muted-foreground',
      'primary-foreground', 'accent-foreground', 'danger-foreground', 'success-foreground',
      'focus-selection-background', 'focus-selection-foreground',
      'navigation-button-disabled-background', 'navigation-button-disabled-foreground',
      'navigation-recent-border', 'navigation-recent-item-foreground', 'navigation-recent-item-hover-foreground',
    ];

    const undecided = colorNames(['## Core', '## Navigation', '## Minimap']).filter((name) => !grayed.includes(name) && !kept.includes(name));
    if (undecided.length) {
      throw new Error(`${undecided.join(', ')} is a color the chrome is drawn from that an inactive window neither grays nor keeps — re-point it in base.css or say here why it stays`);
    }
    const missing = grayed.filter((name) => !body.includes(`--lt-${name}:`));
    if (missing.length) {
      throw new Error(`${missing.join(', ')} still carries its hue on an inactive window`);
    }
    const wrong = kept.filter((name) => new RegExp(`--lt-${name}:`).test(body));
    if (wrong.length) {
      throw new Error(`${wrong.join(', ')} is moved by the inactive state, and moving one of those is what made the window read as see-through`);
    }
  });

  check("the rail's clone of the document goes quiet with the chrome, and its paper does not", () => {
    const body = minimapInkBody();

    // Every declaration here is a custom property too: the rail is chrome and the state paints no more of it than it paints of the bar.
    for (const line of body.split(';')) {
      const declaration = line.trim();
      if (!declaration) continue;
      if (!declaration.startsWith('--lt-')) {
        throw new Error(`the rail's rule paints instead of re-pointing a token: ${declaration}`);
      }
    }

    // Ink, all of it: the miniature is the largest block of text the frame holds, and left out it was a bright picture beside quiet chrome.
    const grayed = [
      'markdown-foreground', 'markdown-heading', 'markdown-heading-2', 'markdown-heading-3', 'markdown-heading-4',
      'markdown-heading-5', 'markdown-heading-6', 'markdown-rule', 'markdown-link', 'markdown-blockquote-border',
      'markdown-blockquote-foreground', 'markdown-alert-note', 'markdown-alert-tip', 'markdown-alert-important',
      'markdown-alert-warning', 'markdown-alert-caution', 'markdown-badge-foreground', 'markdown-table-border',
      'markdown-thematic-break', 'markdown-keyboard-border',
      'editor-inline-code-foreground', 'editor-code-foreground', 'editor-code-border',
      'syntax-foreground', 'syntax-comment', 'syntax-keyword', 'syntax-string', 'syntax-number', 'syntax-function',
      'syntax-variable', 'syntax-type', 'syntax-operator', 'syntax-punctuation',
      'syntax-inserted', 'syntax-deleted', 'syntax-changed',
    ];
    // Every paper, fill and tint the miniature is drawn on, left exactly where the family put it: moving one of those is moving a background, which is the thing this whole state is written not to do. The selection pairs stay for the same reason selected text stays selected.
    const kept = [
      'markdown-background', 'markdown-badge-background', 'markdown-table-header-background',
      'markdown-math-inline-background', 'markdown-keyboard-background',
      'editor-inline-code-background', 'editor-code-background',
      'editor-code-selection-background', 'editor-code-selection-foreground',
      'syntax-background', 'syntax-inserted-background', 'syntax-deleted-background', 'syntax-changed-background',
    ];

    const undecided = colorNames(['## Document', '## Code', '## Syntax']).filter((name) => !grayed.includes(name) && !kept.includes(name));
    if (undecided.length) {
      throw new Error(`${undecided.join(', ')} is a color the rail's miniature is drawn from that an inactive window neither grays nor keeps — re-point it in base.css or say here why it stays`);
    }
    const missing = grayed.filter((name) => !body.includes(`--lt-${name}:`));
    if (missing.length) {
      throw new Error(`${missing.join(', ')} is still drawn at full strength on the rail of an inactive window`);
    }
    const wrong = kept.filter((name) => new RegExp(`--lt-${name}:`).test(body));
    if (wrong.length) {
      throw new Error(`${wrong.join(', ')} is a background the rail's rule moves, and this state moves no background anywhere`);
    }
  });

  check('nothing the page is built with can be dropped in and quietly stay bright', () => {
    const selector = inactiveSelector();
    const { byId } = fakePage();
    const surface = byId.get('appSurface');
    if (!surface || !surface.children.length) throw new Error('the app surface holds nothing, so this check is reading the wrong element');

    // The library shell holds the pane the rule names, and every chrome descendant under it inherits the re-pointed tokens from there.
    const throughChildren = ['app-bar', 'library-shell'];
    // Out on purpose, each for its own reason: the card stands before the page is drawn at all, the scrims carry no color, and the two print boxes are what a saved page is rendered out of.
    const leftBright = ['startup-card', 'lt-backdrop', 'diagram-print', 'picture-print'];

    const missed = [];
    for (const child of surface.children) {
      const classes = String(child.className || '').split(/\s+/).filter(Boolean);
      if (!classes.length) {
        missed.push(child.id || child.tagName);
        continue;
      }
      if (classes.some((name) => throughChildren.includes(name) || leftBright.includes(name))) continue;
      if (classes.some((name) => selector.includes(`.${name}`))) continue;
      missed.push(child.id || classes.join('.'));
    }
    if (missed.length) {
      throw new Error(`${missed.join(', ')} sits over the app and neither grays with the rest of it nor is written down as staying bright — add it to the inactive rule in base.css or say here why it is out`);
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
    // The whole of round 4. On Windows the top-level window never holds the keyboard while the web view has it, so `tao` raises no focus event at all and the state did not arrive until the window had been left and come back twice. The page's own blur and focus fire from the first switch, so both platforms watch for themselves.
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
