// The byte boundary every browser caller shares.

/** Load one Leaftext WebAssembly module and expose its typed browser surface. */
export async function loadLeaftextModule(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no Leaftext module at ${url}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const api = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const put = (value) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
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
  const readBytes = (answer) => {
    if (!answer) return null;
    const length = new DataView(api.memory.buffer).getUint32(answer, true);
    const bytes = new Uint8Array(api.memory.buffer, answer + 4, length).slice();
    api.leaf_free(answer, 4 + length);
    return bytes;
  };
  const withStrings = (call, ...values) => {
    const written = values.map(put);
    const answer = read(call(...written.flat()));
    for (const [at, length] of written) api.leaf_free(at, length);
    return answer;
  };
  const onBuffer = (call, handle, value, take = read) => {
    const [at, length] = put(value);
    const answer = take(call(handle, at, length));
    api.leaf_free(at, length);
    return answer;
  };

  const module = {
    page: () => read(api.leaf_page()),
    script: () => read(api.leaf_script()),
    styles: () => read(api.leaf_styles()),
    boot: () => read(api.leaf_boot_script()),
    embedBoot: (unlocked) => read(api.leaf_embed_boot_script(unlocked ? 1 : 0)),
    formats: () => read(api.leaf_formats()).split(' '),
    documentScript: (source, path) => withStrings(api.leaf_document_script, source, path),
    glossaryScript: (href) => withStrings(api.leaf_glossary_script, href || ''),
    setGlossary: (text) => {
      const [at, length] = put(text || '');
      api.leaf_set_glossary(at, length);
      api.leaf_free(at, length);
    },
    setImageBase: (base) => {
      const [at, length] = put(base || '');
      api.leaf_set_image_base(at, length);
      api.leaf_free(at, length);
    },
    render: (source, path) => {
      const [body, bodyLength] = put(source);
      const [name, nameLength] = put(path);
      const answer = read(api.leaf_render_bytes(body, bodyLength, name, nameLength));
      api.leaf_free(body, bodyLength);
      api.leaf_free(name, nameLength);
      return JSON.parse(answer || 'null');
    },
    memoryBytes: () => api.memory.buffer.byteLength,
  };

  if (api.leaf_buffer_open) {
    module.buffer = {
      open: (source, path) => {
        const [body, bodyLength] = put(source);
        const [name, nameLength] = put(path);
        const handle = api.leaf_buffer_open(body, bodyLength, name, nameLength);
        api.leaf_free(body, bodyLength);
        api.leaf_free(name, nameLength);
        return handle;
      },
      close: (handle) => api.leaf_buffer_close(handle),
      source: (handle) => read(api.leaf_buffer_source(handle)),
      encoded: (handle) => readBytes(api.leaf_buffer_encoded(handle)),
      state: (handle) => JSON.parse(read(api.leaf_buffer_state(handle)) || 'null'),
      render: (handle) => JSON.parse(read(api.leaf_buffer_render(handle)) || 'null'),
      documentScript: (handle) => read(api.leaf_buffer_document_script(handle)),
      codeView: (handle) => JSON.parse(read(api.leaf_buffer_code_view(handle)) || 'null'),
      edit: (handle, edit) => JSON.parse(onBuffer(api.leaf_buffer_edit, handle, JSON.stringify(edit)) || 'null'),
    };
    module.buffer.saveScript = (handle, ok, error) => {
      const [at, length] = put(error || '');
      const answer = read(api.leaf_buffer_save_script(handle, ok ? 1 : 0, at, length));
      api.leaf_free(at, length);
      return answer;
    };
  }
  return module;
}
