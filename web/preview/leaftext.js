// Loading the renderer into a page, and asking it for a document.
//
// This is the whole browser side today: a module and four calls. The friendly surface the plan names — a reader, an editor, commands, events — is later work, and it will sit on exactly these.
//
// Two modules, because the highlighter is most of the weight and most documents have no code in them. The core loads first; the second is fetched only once a document turns out to have a fence, and that document is then rendered again with colors.

import { loadLeaftextModule } from '../module.js';

const CORE = '/dist/leaftext-core.wasm';
const WITH_COLORS = '/dist/leaftext-highlight.wasm';

/** A fence the core left uncolored, which is the signal to go and fetch the colors. */
function hasPlainCode(html) {
  return html.includes('<pre class="highlight"') && !html.includes('<span class="syn-');
}

export async function createLeaftext() {
  const core = await loadLeaftextModule(CORE);
  let colors = null;

  return {
    formats: core.formats(),
    styles: core.styles(),
    /** The document, drawn, off the file's own bytes. Colors arrive on a second pass rather than holding up the first. */
    async render(source, path, onRecolor) {
      const first = core.render(source, path);
      if (!first) return null;
      if (onRecolor && hasPlainCode(first.html)) {
        colors = colors || loadLeaftextModule(WITH_COLORS);
        colors
          .then((module) => onRecolor(module.render(source, path)))
          .catch((error) => console.warn('the colors did not arrive:', error.message));
      }
      return first;
    },
  };
}
