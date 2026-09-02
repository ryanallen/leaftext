// A published site is not an install: what the page takes out of itself when it is served rather than run.

import { join } from 'node:path';
import {
  check,
  record,
  runShell,
  siteBoot,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 4b. a published site is not an install ---------------------------------
  //
  // The browser draws its own Back one row above the app's and hands the reader its own history, so a site draws neither of the app's; and a first-run bubble is a once-per-install promise, which a reader landing on one page of a site has not made. Both come out of the page rather than being hidden in it.

  check('a published site draws no Back, no Forward, no Open, no New document, no window buttons and no first-run bubble', () => {
    const site = siteBoot(true);
    // The folder and the plus go with the pair: a static site has no file dialog and nowhere to save, so both commands are refused forever rather than not yet.
    for (const id of ['backButton', 'forwardButton', 'openButton', 'newButton']) {
      if (site.context.document.getElementById(id)) throw new Error(`a site still has ${id} standing in the bar`);
    }
    if (site.context.document.querySelector('.history-actions')) throw new Error('a site still has the history strip in the bar');
    // Never drawn in a browser: the page ships them hidden and only a native window frame reveals them.
    if (site.context.document.getElementById('windowControls').hidden !== true) {
      throw new Error("a site revealed the window's own minimize, maximize and close");
    }
    if (site.context.nextHint()) throw new Error('a site registered a first-run bubble');
    if (site.bubbles.length) throw new Error(`a site drew ${site.bubbles.length} first-run bubbles`);
    if (site.sent.some((message) => message.command === 'setHintState')) {
      throw new Error('a site counted a launch of an app nobody installed');
    }

    // The desktop is untouched: both buttons, and the bubble it has always shown on a first launch.
    const desktop = siteBoot(false);
    for (const id of ['backButton', 'forwardButton', 'openButton', 'newButton']) {
      if (!desktop.context.document.getElementById(id)) throw new Error(`the desktop lost ${id}`);
    }
    if (desktop.bubbles.length !== 1) throw new Error(`a desktop first launch drew ${desktop.bubbles.length} first-run bubbles`);

    // The same three window buttons, revealed the moment there is a native frame to draw them for — the mechanism the site flag copies.
    const framed = runShell(source, { __leafFrameless: true });
    if (framed.document.getElementById('windowControls').hidden !== false) {
      throw new Error('a frameless window did not reveal its own three buttons');
    }
  });

  // Where the platform's title bar is gone the app bar is it, so a press on the bare part of the bar hands the window to the host's own move loop and a press on anything standing on it belongs to that control. Both halves come off one listener, which is why one check asks for both. Booted frameless because that is the only build where the bar is a title bar at all.
  check('a press on the app bar asks for a window drag, and a press on a control asks for nothing', () => {
    const framed = runShell(source, { __leafFrameless: true });
    const sent = [];
    framed.ipc.postMessage = (text) => sent.push(JSON.parse(text));
    const bar = framed.document.getElementById('appBar');
    const pressed = (target) => {
      sent.length = 0;
      for (const handler of [...(bar.listeners.get('mousedown') || [])]) {
        handler({ button: 0, detail: 1, target });
      }
      return sent.map((message) => message.command);
    };

    const onTheBar = pressed({ closest: () => null });
    if (onTheBar.join() !== 'windowDrag') {
      throw new Error(`a press on the app bar sent ${JSON.stringify(onTheBar)} rather than a window drag`);
    }

    // Whatever the press landed on answers for itself: a tab switches, a button runs its command, and neither is a gesture to move the window.
    for (const control of ['a tab', 'a button']) {
      const onAControl = pressed({ closest: () => ({ id: control }) });
      if (onAControl.length) {
        throw new Error(`a press on ${control} sent ${JSON.stringify(onAControl)} instead of leaving the press to it`);
      }
    }

    // The right-hand button never drags: that press is the context menu's.
    sent.length = 0;
    for (const handler of [...(bar.listeners.get('mousedown') || [])]) {
      handler({ button: 2, detail: 1, target: { closest: () => null } });
    }
    if (sent.length) {
      throw new Error(`a right-hand press on the app bar sent ${JSON.stringify(sent)}`);
    }
  });

  // A folder on a disk is not a browser's to pick, which is why both hosts refuse the command that makes a vault. Drawing the button anyway would be a control whose only possible answer is no.
  check('neither browser host invites a reader to add a folder it cannot reach', () => {
    const hosts = [
      ['a published site', siteBoot(true).context],
      ['an embed', runShell(source, { __leafEmbedded: true })],
    ];
    for (const [name, context] of hosts) {
      context.window.leafSetState({ recent: [], favorites: [], tabs: [], active: null, document: null });
      context.__frames.drain();
      const markup = context.document.getElementById('app').innerHTML;
      if (markup.includes('primary-vault') || markup.includes('empty-vault-help')) {
        throw new Error(`${name} drew a button its host refuses: ${markup.slice(0, 400)}`);
      }
      // The third one gone, not the row: what a browser can answer is still standing.
      if (!markup.includes('primary-open') || !markup.includes('primary-new')) {
        throw new Error(`${name} lost the two actions the screen has always had: ${markup.slice(0, 400)}`);
      }
    }
  });

  check("a site cancels no mouse back gesture, and the fold and the disabled pass cope with the strip gone", () => {
    const site = siteBoot(true);
    const press = (context, button) => {
      let prevented = false;
      for (const handler of [...(context.__windowListeners.get('mousedown') || [])]) {
        handler({ button, target: context.document.body, preventDefault: () => (prevented = true) });
      }
      return prevented;
    };
    // The mouse's own back and forward buttons. On a site the browser handles them itself, which it cannot do if the page cancels the event first — which is why the strip is removed rather than hidden.
    if (press(site.context, 3) || press(site.context, 4)) {
      throw new Error("a site canceled the mouse's own back gesture, which the browser would have handled itself");
    }
    if (site.sent.some((message) => message.command === 'goBack' || message.command === 'goForward')) {
      throw new Error('a site sent a history command no site host answers');
    }
    // Both of these reach for the strip. With it gone they have to run rather than throw: the fold would otherwise move two missing buttons into the chevron menu, and the disabled pass runs on every render.
    site.context.refitAppBar();
    site.context.leafSetNavigation({ canGoBack: true, canGoForward: true });

    // The desktop still answers it, because there the strip is the app's own.
    const desktop = siteBoot(false);
    if (!press(desktop.context, 3)) throw new Error("the desktop stopped taking the mouse's own back button");
    if (!desktop.sent.some((message) => message.command === 'goBack')) {
      throw new Error("the desktop's mouse back button sent nothing");
    }
  });

  /** A site or desktop boot standing on one document, so the trail and the strip can both be read. `document: null` keeps the home screen's cheap render — what is being proved is the bar, and the trail's chain comes off the active tab either way. */
  function bootedWithDocument(site, path, hostAnswers) {
    const booted = siteBoot(site);
    if (hostAnswers) booted.context.window.__leafHostAnswers = hostAnswers;
    booted.context.leafSetLibraryFolder({ path: 'docs/guide', chain: [{ name: 'docs', path: 'docs' }, { name: 'guide', path: 'docs/guide' }], rootName: 'Emptyguru', entries: [] });
    booted.context.leafSetState({ recent: [], favorites: [], tabs: [{ path, title: path }], active: 0, document: null });
    return booted;
  }

  check('a published site draws the folder trail in the bar and no tab', () => {
    const site = bootedWithDocument(true, 'docs/guide/README.md');
    const strip = site.context.document.getElementById('tabBar');
    const trail = site.context.document.getElementById('libraryCrumbTrail');
    if (!strip.children.includes(trail)) throw new Error("a site's trail is not standing in the room the tab strip holds");
    if (strip.innerHTML.includes('class="tab')) throw new Error(`a site wrote a tab into the bar: ${strip.innerHTML}`);

    // The chain is the open document's own path, not the folder the pane is showing: they part company the moment a link is followed, and the trail at the top must say where the page is.
    const chain = site.context.siteCrumbChain();
    if (chain.map((one) => one.name).join('/') !== 'docs/guide/README') {
      throw new Error(`the trail names ${chain.map((one) => one.name).join('/')} rather than the document's own path`);
    }
    if (chain[1].path !== 'docs/guide') throw new Error(`a folder crumb carries ${chain[1].path}, which is not the folder it opens`);
    // Every folder is a link back to that folder; the document itself is not one.
    const drawn = trail.innerHTML;
    for (const folder of ['docs', 'guide']) {
      if (!drawn.includes(`data-crumb-path="${folder === 'docs' ? 'docs' : 'docs/guide'}"`)) {
        throw new Error(`${folder} is not a crumb that opens its own folder: ${drawn}`);
      }
    }
    if (!/<span class="library-crumb is-current"[^>]*>README<\/span>/.test(drawn)) {
      throw new Error(`the last crumb is not the document, drawn as a place rather than a link: ${drawn}`);
    }
    if (drawn.includes('>README.md<')) throw new Error('the document crumb kept its extension, which no tab label ever showed');

    // Following a link is the case the pane's own chain would get wrong: nothing on a site reveals an opened file in the pane, so the pane stays on docs/guide while the page moves. The trail has to follow the page.
    site.context.leafSetState({ recent: [], favorites: [], tabs: [{ path: 'notes/deep/two.md' }], active: 0, document: null });
    const moved = trail.innerHTML;
    if (!/is-current"[^>]*>two</.test(moved) || !moved.includes('data-crumb-path="notes/deep"')) {
      throw new Error(`the trail did not follow the document into another folder: ${moved}`);
    }

    // The desktop is untouched: a tab in the strip, and the trail still in the pane's own band on the pane's own folder.
    const desktop = bootedWithDocument(false, 'docs/guide/README.md');
    const desktopStrip = desktop.context.document.getElementById('tabBar');
    const desktopTrail = desktop.context.document.getElementById('libraryCrumbTrail');
    if (!desktopStrip.innerHTML.includes('class="tab')) throw new Error('the desktop stopped drawing its tab');
    if (desktopStrip.children.includes(desktopTrail)) throw new Error("the desktop's trail moved into the tab strip");
    if (desktopTrail.parentElement.id !== 'libraryCrumbs') throw new Error(`the desktop's trail left the pane's band for ${desktopTrail.parentElement.id}`);
    if (!/is-current"[^>]*>guide</.test(desktopTrail.innerHTML)) {
      throw new Error(`the desktop's trail stopped ending at the folder the pane is showing: ${desktopTrail.innerHTML}`);
    }
  });

  check("a site whose host marks pages draws the heart at the trail's end", () => {
    const site = bootedWithDocument(true, 'docs/guide/README.md', (command) => command === 'toggleFavorite');
    const trail = site.context.document.getElementById('libraryCrumbTrail');
    let heart = trail.querySelector('[data-trail-favorite]');
    if (!heart || trail.children[trail.children.length - 1] !== heart) throw new Error(`the heart is not the last thing in the trail: ${trail.innerHTML}`);
    if (heart.getAttribute('aria-pressed') !== 'false' || !heart.innerHTML.includes('lt-icon-favorite-off')) {
      throw new Error(`an unmarked page drew ${heart.outerHTML}`);
    }
    const press = (heart.listeners.get('pointerdown') || [])[0];
    if (!press) throw new Error('the trail heart has no press');
    press({ button: 0, stopPropagation() {} });
    const sent = site.sent[site.sent.length - 1];
    if (!sent || sent.command !== 'toggleFavorite' || sent.path !== 'docs/guide/README.md') {
      throw new Error(`pressing the trail heart sent ${JSON.stringify(sent)}`);
    }
    heart = trail.querySelector('[data-trail-favorite]');
    if (!heart || heart.getAttribute('aria-pressed') !== 'true' || !heart.innerHTML.includes('lt-icon-favorite-on')) {
      throw new Error(`the pressed heart did not fill: ${trail.innerHTML}`);
    }

    const refused = bootedWithDocument(true, 'docs/guide/README.md', () => false);
    const refusedTrail = refused.context.document.getElementById('libraryCrumbTrail');
    if (refusedTrail.querySelector('[data-trail-favorite]')) throw new Error(`a host that does not mark pages drew a heart: ${refusedTrail.innerHTML}`);
    if (!/is-current"[^>]*>README<\/span>$/.test(refusedTrail.innerHTML)) {
      throw new Error(`a host that does not mark pages no longer ends at the document: ${refusedTrail.innerHTML}`);
    }
  });

  check('a published site draws no vault switcher, no pane trail row and no Sync button', () => {
    const site = bootedWithDocument(true, 'README.md');
    for (const id of ['libraryCrumbs', 'libraryVaultSwitch', 'librarySyncButton']) {
      if (site.context.document.getElementById(id)) throw new Error(`a site still has ${id} standing in the pane`);
    }
    // The band leaves no gap: everything under it is placed off its height, so the search row and the list come up by that one value going to zero.
    if (site.context.document.getElementById('libraryPane').style.getPropertyValue('--library-crumbs-height') !== '0px') {
      throw new Error("the pane still holds a band's worth of room open with no band in it");
    }
    // And the desktop keeps all three.
    const desktop = bootedWithDocument(false, 'README.md');
    for (const id of ['libraryCrumbs', 'libraryVaultSwitch', 'librarySyncButton']) {
      if (!desktop.context.document.getElementById(id)) throw new Error(`the desktop lost ${id}`);
    }
  });
}
