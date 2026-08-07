// Loading a browser module outside a browser, so the server and the build script can both ask it things.
//
// Strings cross as bytes: write with `leaf_alloc`, read a little-endian `u32` length off the front of an answer, free both. The page does exactly this — see `web/preview/host.js` — and keeping one copy of it here is what stops the two drifting.

import { readFileSync } from 'node:fs';

export async function instantiateCore(file) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file), {});
  const api = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

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
  const withStrings = (call, ...strings) => {
    const written = strings.map(write);
    const answer = read(call(...written.flat()));
    for (const [at, length] of written) api.leaf_free(at, length);
    return answer;
  };

  return {
    page: () => read(api.leaf_page()),
    script: () => read(api.leaf_script()),
    styles: () => read(api.leaf_styles()),
    boot: () => read(api.leaf_boot_script()),
    formats: () => read(api.leaf_formats()).split(' '),
    documentScript: (source, path) => withStrings(api.leaf_document_script, source, path),
    glossaryScript: (href) => withStrings(api.leaf_glossary_script, href || ''),
    setGlossary: (text) => {
      const [at, length] = write(text || '');
      api.leaf_set_glossary(at, length);
      api.leaf_free(at, length);
    },
    render: (source, path) => JSON.parse(withStrings(api.leaf_render, source, path) || 'null'),
  };
}
