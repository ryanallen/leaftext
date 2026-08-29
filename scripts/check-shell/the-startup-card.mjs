// The small window a launch puts up: the card the page comes up holding, and the word that lets the host grow the window into the one the reader left.

import { check, pageMarkup, record, runShell, source, standInState } from './shared.mjs';

export function run() {
  if (!record.booted) return;

  // ---- the card, and when the page says it can go -----------------------------

  /** A shell booted the way a launch boots it, with every command it sends recorded and the initial state the host would have injected. A desktop window unless told otherwise, since that is the only host with a window to grow. */
  function launch(initial, { desktop = true } = {}) {
    const sent = [];
    const context = runShell(source, {
      __leafInitialState: initial,
      __leafFrameless: desktop,
      ipc: { postMessage: (message) => sent.push(JSON.parse(message)) },
    });
    return {
      context,
      said: () => sent.filter((message) => message.command === 'startupReady').length,
      card: () => context.document.getElementById('startupCard'),
      render: (state) => context.window.leafSetState(state),
    };
  }

  const homeState = { recent: [], favorites: [], tabs: [], active: null, document: null };

  check('the page comes up holding the card, before a script has run', () => {
    // Markup rather than something the script builds: the front end runs before the first paint, so a card the script inserts is a card that arrives with the app it was meant to stand in for.
    const markup = pageMarkup();
    for (const wanted of ['id="startupCard"', 'startup-card-mark', 'startup-card-spinner', 'startup-card-name']) {
      if (!markup.includes(wanted)) throw new Error(`the page comes up without ${wanted}`);
    }
    // Inside the app's one box, so it is measured and clipped the way every other overlay is.
    const surface = markup.indexOf('id="appSurface"');
    const card = markup.indexOf('id="startupCard"');
    if (surface < 0 || card < surface) throw new Error('the card is outside the app box, so it is placed against the window rather than against the app');
  });

  check('a launch with nothing open says it has drawn as soon as the home screen is up', () => {
    const boot = launch(homeState);
    if (boot.said() !== 1) throw new Error(`a launch with nothing open said it had drawn ${boot.said()} times rather than once`);
    // Said once and once only: the host grows the window on it, and by a second render the reader may have moved that window themselves.
    boot.render(homeState);
    if (boot.said() !== 1) throw new Error('a second render said it again, so the window would be resized under a reader who had moved it');
  });

  check('a launch opening a document waits for the document rather than for the home screen it draws first', () => {
    // The page boots on a state that carries the tab and no document: the host reads the file and renders it afterwards. Growing the window on that first render hands the reader a full-size window with an empty reader in it.
    const opening = { recent: [], favorites: [], tabs: [{ title: 'one', path: 'C:\Notes\one.md' }], active: 0, document: null };
    const boot = launch(opening);
    if (boot.said() !== 0) throw new Error('the window was grown on the home screen a launch draws before its document arrives');
    boot.render(standInState('C:/Notes/one.md'));
    if (boot.said() !== 1) throw new Error(`the document arrived and the page said it had drawn ${boot.said()} times rather than once`);
  });

  check('the host takes the card off, and the page never takes it off by itself', () => {
    const boot = launch(homeState);
    const card = boot.card();
    if (!card) throw new Error('the page has no startup card to take off');
    // Still up after the word: the window has not been resized yet, and the card is what covers the resize.
    if (card.hidden) throw new Error('the page dropped the card the moment it spoke, so the resize happens on a bare page');
    boot.context.window.leafStartupDone();
    if (!card.hidden) throw new Error('the host asked for the card to go and it stayed');
  });

  check('a browser takes the card off itself, because nothing is coming back to do it', () => {
    // A published site and an embedded document run this same page, and both hosts refuse the word — there is no native window to grow. So a card left waiting for the host would stand over the document for ever, which is the fault this repo already paid for once with a skeleton that spun for ever in a browser.
    const boot = launch(homeState, { desktop: false });
    if (boot.said() !== 1) throw new Error('a browser never said it had drawn');
    if (!boot.card().hidden) throw new Error('the card is still standing over a page no host will ever resize');
  });
}
