// Loading the renderer into a page, and asking it for a document.
//
// This is the whole browser side today: a module and four calls. The friendly surface the plan names — a reader, an editor, commands, events — is later work, and it will sit on exactly these.
//
// Two modules, because the highlighter is most of the weight and most documents have no code in them. The core loads first; the second is fetched only once a document turns out to have a fence, and that document is then rendered again with colors.

const CORE = '/dist/leaftext-core.wasm';
const WITH_COLORS = '/dist/leaftext-highlight.wasm';

/** One loaded module, and the reads and writes across its memory. */
async function load(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no module at ${url} — run: just build-web`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const api = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Every string crosses as bytes the page owns until it hands them back.
  const write = (text) => {
    const bytes = encoder.encode(text);
    const at = api.leaf_alloc(bytes.length);
    new Uint8Array(api.memory.buffer).set(bytes, at);
    return [at, bytes.length];
  };
  const read = (answer) => {
    if (!answer) return null;
    const length = new DataView(api.memory.buffer).getUint32(answer, true);
    const text = decoder.decode(new Uint8Array(api.memory.buffer, answer + 4, length));
    api.leaf_free(answer, 4 + length);
    return text;
  };

  return {
    render(source, path) {
      const [text, textLen] = write(source);
      const [name, nameLen] = write(path);
      const answer = read(api.leaf_render(text, textLen, name, nameLen));
      api.leaf_free(text, textLen);
      api.leaf_free(name, nameLen);
      return answer ? JSON.parse(answer) : null;
    },
    styles: () => read(api.leaf_styles()),
    formats: () => read(api.leaf_formats()).split(' '),
  };
}

/** A fence the core left uncolored, which is the signal to go and fetch the colors. */
function hasPlainCode(html) {
  return html.includes('<pre class="highlight"') && !html.includes('<span class="syn-');
}

export async function createLeaftext() {
  const core = await load(CORE);
  let colors = null;

  return {
    formats: core.formats(),
    styles: core.styles(),
    /** The document, drawn. Colors arrive on a second pass rather than holding up the first. */
    async render(source, path, onRecolor) {
      const first = core.render(source, path);
      if (!first) return null;
      if (onRecolor && hasPlainCode(first.html)) {
        colors = colors || load(WITH_COLORS);
        colors
          .then((module) => onRecolor(module.render(source, path)))
          .catch((error) => console.warn('the colors did not arrive:', error.message));
      }
      return first;
    },
  };
}
