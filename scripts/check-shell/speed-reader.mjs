// The app opens for somebody who reads with the speed reader on.
//
// Its own boot rather than the shared one, because the fault is a saved setting: the page every other subject reads was booted with none, so the launch took the speed reader's default and came up green while the app shipped as a spinner on an empty page. The fake page's tree walker does walk, and the pass splits a word on it into the anchor and its tail, so what an edit then writes back out of that block is readable here.

import { check, node, renderReadingDocument, runShell, source } from './shared.mjs';

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

  check('an edit to a walked block writes the words back, not the lead drawn around them', () => {
    // The reading aid is a view. Every path that commits an edit folds into this one walk, so a block the pass has just split has to come back out spelled the way the file holds it.
    const context = bootWithSpeedReader();
    const { body } = renderReadingDocument(context, { blocks: [{ srcStart: 0, top: 0 }] });
    const block = body.children[0];
    if (!block.querySelector('.speed-reader-anchor')) throw new Error('the render drew no anchor, so there is nothing here to write back wrong');
    const written = context.inlineDomToMarkdown(block);
    if (written !== 'block 0') throw new Error(`a walked block was written back as ${JSON.stringify(written)} rather than the words it was drawn from`);
  });

  check('a highlight press over a walked word writes the words and the mark and no span', () => {
    // The shape the press actually builds on its clone: the selection starts inside one anchor, so the extract leaves an empty one beside the mark, and the word inside the mark carries an anchor of its own.
    const context = bootWithSpeedReader();
    const anchor = (text) => node('span', { className: 'speed-reader-anchor', children: text ? [text] : [] });
    const clone = node('p', {
      children: ['A ', anchor('mar'), 'ked ', anchor(''), node('mark', { children: [anchor('pas'), 'sage'] }), ' ', anchor('he'), 're.'],
    });
    const written = context.inlineDomToMarkdown(clone);
    if (written !== 'A marked <mark>passage</mark> here.') {
      throw new Error(`the press wrote ${JSON.stringify(written)} rather than the reader's own words with the highlight they asked for`);
    }
  });

  check('a span the reader wrote themselves still round-trips', () => {
    // What is stepped over is the app's own decoration, keyed on the class it is drawn with — never the tag. A `span` carrying an id is the reader's and goes back whole.
    const context = bootWithSpeedReader();
    const own = node('p', { children: ['a ', node('span', { attributes: { id: 'x' }, children: ['own'] }), ' one'] });
    const written = context.inlineDomToMarkdown(own);
    if (written !== 'a <span id="x">own</span> one') {
      throw new Error(`a span the reader wrote was written back as ${JSON.stringify(written)}`);
    }
  });
}
