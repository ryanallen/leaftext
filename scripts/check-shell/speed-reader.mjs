// The app opens for somebody who reads with the speed reader on.
//
// Its own boot rather than the shared one, because the fault is a saved setting: the page every other subject reads was booted with none, so the launch took the speed reader's default and came up green while the app shipped as a spinner on an empty page. The walk is read as the mark it leaves rather than as split words — the fake page's tree walker answers nothing, and the split itself is proved against the fragment builder in `parses-and-boots.mjs`.

import { check, renderReadingDocument, runShell, source } from './shared.mjs';

export function run() {
  /** The whole front end booted with the speed reader saved on, the way an installed copy comes up for a reader who turned it on and closed the window. */
  const bootWithSpeedReader = () => runShell(source, { __leafSettings: { speedReaderEnabled: true } });

  check('the front end booted with the speed reader saved on comes up whole', () => {
    // A throw at the top level of the one assembled script ends it, and everything below the throw — the tabs, the toolbar, the library pane — never runs at all. `runShell` carries the throw out, so reaching the next line is half the claim.
    const context = bootWithSpeedReader();
    if (context.document.documentElement.dataset.speedReader !== 'true') {
      throw new Error('the launch came up without the flag the stylesheet reads');
    }
    const { body } = renderReadingDocument(context, { blocks: [{ srcStart: 0, top: 0 }] });
    if (!body) throw new Error('a document handed to the booted page drew no body');
    const tabs = context.document.getElementById('tabBar');
    if (!tabs || tabs.children.length !== 1) {
      throw new Error(`the document drew ${tabs ? tabs.children.length : 'no'} tabs rather than one`);
    }
    if (context.document.getElementById('readerToolbar').hidden) {
      throw new Error('the document arrived with the reader toolbar still hidden');
    }
  });

  check('a document arriving after that launch is still walked', () => {
    // The launch stopped walking, so the render is the only thing left that reaches the words. A page that boots and never splits one is the same setting broken a quieter way.
    const context = bootWithSpeedReader();
    const { body } = renderReadingDocument(context, { blocks: [{ srcStart: 0, top: 0 }] });
    if (body.dataset.speedReaderProcessed !== 'true') {
      throw new Error('the document that arrived after the launch was never walked');
    }
  });
}
