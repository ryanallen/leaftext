// The small window a launch puts up: the card the page comes up holding, the word that says the page can be sent a document, and the word that lets the host grow the window into the one the reader left.

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
      booted: () => sent.filter((message) => message.command === 'frontEndReady').length,
      // Every command in the order it went out, which is how one launch word is placed against the other.
      words: () => sent.map((message) => message.command),
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

  check('the page says it can be sent a document, once, before it draws anything', () => {
    // The two launch words are different promises and the order is the whole point. This one says every fragment has run, so a render arriving from the host lands on hooks that exist; the other says a screen a reader could use has been drawn. A launch opening a file withholds the second until that file arrives, so releasing the file on it would wait for itself.
    const boot = launch(homeState);
    if (boot.booted() !== 1) throw new Error(`the page said it had booted ${boot.booted()} times rather than once`);
    const words = boot.words();
    if (words.indexOf('startupReady') < words.indexOf('frontEndReady')) throw new Error('the page said it had drawn before it said it had booted, so the host would grow the window around a page it still could not send a document to');
    // Said on a second render? The host releases the launch's files on it, and a second release would reopen files the reader may have closed.
    boot.render(homeState);
    if (boot.booted() !== 1) throw new Error('a second render said it again, so the files a launch was asked for would be opened twice');
  });

  check('a launch opening a document says it can be sent one before the document arrives', () => {
    // The host is holding that document until this word: it is what the whole race was about. A page that only said it once the document was on screen could never be sent one.
    const opening = { recent: [], favorites: [], tabs: [{ title: 'one', path: 'C:\\Notes\\one.md' }], active: 0, document: null };
    const boot = launch(opening);
    if (boot.booted() !== 1) throw new Error('a launch opening a document never said it could be sent one, so the host would hold that document for ever');
    if (boot.said() !== 0) throw new Error('the window was grown on the home screen a launch draws before its document arrives');
  });

  check('the word goes out after the boot mark and before the state is drawn', () => {
    // The order inside one statement run, which no value the page hands back can carry: the mark is what every fragment's own guard reads, and the state drawn after it is the first render of the launch.
    const mark = source.indexOf('window.__leafBooted = true;');
    const word = source.indexOf("send({ command: 'frontEndReady' })");
    const drawn = source.indexOf('window.leafSetState(window.__leafInitialState');
    if (mark < 0 || word < 0 || drawn < 0) throw new Error('the boot mark, the word or the first render is no longer where the launch is written');
    if (!(mark < word && word < drawn)) throw new Error('the word is not between the boot mark and the first render, so the host is told either too early to draw into or too late to be the first screen');
  });

  check('a browser says it too, because the page says it once whatever is under it', () => {
    // Both browser hosts refuse the word — neither owns a native launch with a file list — and the page never waits on the answer. It is still said, because one page cannot carry two boots.
    const boot = launch(homeState, { desktop: false });
    if (boot.booted() !== 1) throw new Error('a browser never said it had booted, so the page has two boots in it');
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
