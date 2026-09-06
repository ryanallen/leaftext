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

  /** An answer that is bytes rather than text — a document's source spelled the way its file was. */
  const readBytes = (answer) => {
    if (!answer) return null;
    const length = new DataView(api.memory.buffer).getUint32(answer, true);
    const bytes = new Uint8Array(api.memory.buffer, answer + 4, length).slice();
    api.leaf_free(answer, 4 + length);
    return bytes;
  };
  /** Bytes the module owns until they are handed back — a string is encoded, a byte array is written as it stands. */
  const writeBytes = (value) => {
    if (typeof value === 'string') return write(value);
    const at = api.leaf_alloc(value.length);
    new Uint8Array(api.memory.buffer).set(value, at);
    return [at, value.length];
  };
  /** One buffer call taking a handle and then a string, which the string helper above cannot shape. */
  const onBuffer = (call, handle, text, take = read) => {
    const [at, length] = write(text);
    const answer = take(call(handle, at, length));
    api.leaf_free(at, length);
    return answer;
  };

  return {
    page: () => read(api.leaf_page()),
    script: () => read(api.leaf_script()),
    styles: () => read(api.leaf_styles()),
    boot: () => read(api.leaf_boot_script()),
    // The same lines for a document inside somebody else's page, plus the one that says so. `unlocked` is whether the reader may type, since an embed draws no padlock to decide it with.
    embedBoot: (unlocked) => read(api.leaf_embed_boot_script(unlocked ? 1 : 0)),
    formats: () => read(api.leaf_formats()).split(' '),
    documentScript: (source, path) => withStrings(api.leaf_document_script, source, path),
    glossaryScript: (href) => withStrings(api.leaf_glossary_script, href || ''),
    setGlossary: (text) => {
      const [at, length] = write(text || '');
      api.leaf_set_glossary(at, length);
      api.leaf_free(at, length);
    },
    setImageBase: (base) => {
      const [at, length] = write(base || '');
      api.leaf_set_image_base(at, length);
      api.leaf_free(at, length);
    },
    render: (source, path) => JSON.parse(withStrings(api.leaf_render, source, path) || 'null'),
    /** The same render over a document's own bytes, which is the only way a packaged format can arrive: a Word, Excel, PowerPoint or OpenDocument file is a zip, so there is no string to hand across. `null` back means the bytes are not a document that format can read. */
    renderBytes: (bytes, path) => {
      const [at, length] = writeBytes(bytes);
      const [name, nameLength] = write(path);
      const answer = read(api.leaf_render_bytes(at, length, name, nameLength));
      api.leaf_free(at, length);
      api.leaf_free(name, nameLength);
      return JSON.parse(answer || 'null');
    },
    /** How much linear memory the module holds. Read rather than computed: a page opening and closing documents all day must not grow it. */
    memoryBytes: () => api.memory.buffer.byteLength,
    /** The document buffer an edit splices into. `0` back from `open` means the bytes were not text at all; a `null` anywhere else means the handle names nothing. */
    buffer: {
      open: (source, path) => {
        const [at, length] = writeBytes(source);
        const [name, nameLength] = write(path);
        const handle = api.leaf_buffer_open(at, length, name, nameLength);
        api.leaf_free(at, length);
        api.leaf_free(name, nameLength);
        return handle;
      },
      close: (handle) => api.leaf_buffer_close(handle),
      source: (handle) => read(api.leaf_buffer_source(handle)),
      encoded: (handle) => readBytes(api.leaf_buffer_encoded(handle)),
      state: (handle) => JSON.parse(read(api.leaf_buffer_state(handle)) || 'null'),
      render: (handle) => JSON.parse(read(api.leaf_buffer_render(handle)) || 'null'),
      // The two lines the page is sent, both built in Rust so the shape it reads has one copy: the document with its editing state, and what a save came back as.
      documentScript: (handle) => read(api.leaf_buffer_document_script(handle)),
      // What the raw-source editor is opened on: the buffer's own text, the language and label it is colored and titled by, and whether it is dirty.
      codeView: (handle) => JSON.parse(read(api.leaf_buffer_code_view(handle)) || 'null'),
      saveScript: (handle, ok, error) => {
        const [at, length] = write(error || '');
        const answer = read(api.leaf_buffer_save_script(handle, ok ? 1 : 0, at, length));
        api.leaf_free(at, length);
        return answer;
      },
      edit: (handle, edit) => JSON.parse(onBuffer(api.leaf_buffer_edit, handle, JSON.stringify(edit)) || 'null'),
    },
  };
}
