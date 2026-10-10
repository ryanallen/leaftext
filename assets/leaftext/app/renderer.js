// The bytes between the published page's host and its three modules — the renderer, the book packer and the fence colors. Its own file because the host carries no `import`: the loader imports this and hands it over.

export async function loadRenderer(url, fetchWith = fetch) {
  const response = await fetchWith(url);
  if (!response.ok) throw new Error(`no renderer at ${url}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const api = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const put = (bytes) => {
    const at = api.leaf_alloc(bytes.length);
    new Uint8Array(api.memory.buffer).set(bytes, at);
    return [at, bytes.length];
  };
  const write = (text) => put(encoder.encode(text));
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
  // An answer that is a media type, a zero byte and the bytes.
  const typed = (call, text) => {
    const [at, length] = write(text);
    const answer = call(at, length);
    api.leaf_free(at, length);
    if (!answer) return null;
    const size = new DataView(api.memory.buffer).getUint32(answer, true);
    const whole = new Uint8Array(api.memory.buffer, answer + 4, size);
    const split = whole.indexOf(0);
    const picture = split < 0 ? null : { type: decoder.decode(whole.subarray(0, split)), bytes: whole.slice(split + 1) };
    api.leaf_free(answer, 4 + size);
    return picture;
  };

  return {
    pageFile: (request) => withStrings(api.leaf_one_file_page, JSON.stringify(request)),
    colorable: (language) => {
      if (typeof api.leaf_fence_colorable !== 'function') return false;
      const written = write(language);
      const answer = Boolean(api.leaf_fence_colorable(...written));
      api.leaf_free(...written);
      return answer;
    },
    fenceColors: (language, code) => typeof api.leaf_fence_colors === 'function'
      ? JSON.parse(withStrings((...args) => api.leaf_fence_colors(...args), language, code) || 'null') : null,
    page: () => read(api.leaf_page()),
    script: () => read(api.leaf_script()),
    boot: () => read(api.leaf_boot_script()),
    codeReturnScript: (path, key, handle) => typeof api.leaf_code_return_script === 'function'
      ? withStrings((...args) => api.leaf_code_return_script(...args, handle), path, key) : null,
    styles: () => read(api.leaf_styles()),
    // A document arrives as the file's own bytes, because a Word, Excel, PowerPoint or OpenDocument file is a zip and has no string form to hand across. A text format comes this way too and is decoded exactly as the window decodes a file off the disk. A book whose pictures this page mints is the one document the module keeps: its bytes change hands rather than being freed, so a picture can be asked for out of them later.
    documentScript: (body, path) => {
      const [bytes, name] = [put(body), write(path)];
      const answer = read(api.leaf_document_script_bytes(...bytes, ...name));
      api.leaf_free(...name);
      if (typeof api.leaf_wants_book === 'function' && api.leaf_wants_book()) api.leaf_keep_book(...bytes);
      else api.leaf_free(...bytes);
      return answer;
    },
    linkPreview: (body, path) => {
      const [bytes, name] = [put(body), write(path)];
      const answer = read(api.leaf_link_preview(...bytes, ...name));
      api.leaf_free(...name);
      return answer ? JSON.parse(answer) : null;
    },
    linkPreviewSection: (body, path, fragment) => {
      if (typeof api.leaf_link_preview_section !== 'function') return null;
      const [bytes, name, heading] = [put(body), write(path), write(fragment)];
      const answer = read(api.leaf_link_preview_section(...bytes, ...name, ...heading));
      for (const [at, length] of [bytes, name, heading]) api.leaf_free(at, length);
      return answer ? JSON.parse(answer) : null;
    },
    // One glossary entry drawn alone. A module older than the page has no such export and answers undefined, so the card takes the ordinary route.
    glossaryEntryPreview: (text, path, slug) => typeof api.leaf_glossary_entry_preview === 'function'
      ? JSON.parse(withStrings((...args) => api.leaf_glossary_entry_preview(...args), text, path, slug) || 'null') : undefined,
    // The same, for a term of the glossary `setGlossary` already handed over, answered out of the module's own copy so the text never crosses again.
    heldGlossaryEntryPreview: (path, slug) => typeof api.leaf_held_glossary_entry_preview === 'function'
      ? JSON.parse(withStrings((...args) => api.leaf_held_glossary_entry_preview(...args), path, slug) || 'null') : undefined,
    // The site's listing, read once by the module for the map and the pane's groups. A module older than the page holds nothing, and neither is drawn.
    holdListing: (documents) => {
      if (typeof api.leaf_hold_listing !== 'function') return false;
      const listing = write(JSON.stringify(documents));
      const held = Boolean(api.leaf_hold_listing(...listing));
      api.leaf_free(...listing);
      return held;
    },
    graph: (seed, scope) => typeof api.leaf_hold_listing === 'function'
      ? JSON.parse(withStrings(api.leaf_graph, seed, scope) || 'null') : null,
    smartLinks: (path) => typeof api.leaf_smart_links === 'function' ? withStrings(api.leaf_smart_links, path) : null,
    corpusAdd: (path, bytes) => {
      if (typeof api.leaf_corpus_add !== 'function') return false;
      const name = write(path);
      const body = put(bytes);
      const added = api.leaf_corpus_add(...name, ...body);
      api.leaf_free(...name);
      api.leaf_free(...body);
      return Boolean(added);
    },
    search: (query, today, skipped, partial) => typeof api.leaf_search === 'function'
      ? withStrings((...args) => api.leaf_search(...args, partial ? 1 : 0), query, today, JSON.stringify(skipped)) : null,
    searchBegin: (query, today) => {
      const words = write(query);
      const date = write(today);
      const started = Boolean(api.leaf_search_begin(...words, ...date));
      api.leaf_free(...words);
      api.leaf_free(...date);
      return started;
    },
    searchAdd: (path, bytes) => {
      const name = write(path);
      const body = put(bytes);
      const scored = Boolean(api.leaf_search_add(...name, ...body));
      api.leaf_free(...name);
      api.leaf_free(...body);
      return scored;
    },
    searchSupplied: (skipped, partial) => withStrings((...args) => api.leaf_search_supplied(...args, partial ? 1 : 0), JSON.stringify(skipped)),
    searchCanNarrow: (previous, next, today) => {
      const strings = [previous, next, today].map(write);
      const answer = Boolean(api.leaf_search_can_narrow(...strings.flat()));
      for (const one of strings) api.leaf_free(...one);
      return answer;
    },
    searchMatched: () => {
      const paths = read(api.leaf_search_matched());
      return paths ? JSON.parse(paths) : null;
    },
    codeCompleteNotes: (token) => read(api.leaf_code_complete_notes(BigInt(token))),
    codeCompleteHeadings: (token, handle, note) => withStrings((...args) => api.leaf_code_complete_headings(BigInt(token), handle, ...args), note || ''),
    codeHoverNote: (token, note) => withStrings((...args) => api.leaf_code_hover_note(BigInt(token), ...args), note || ''),
    codeLint: (token, handle) => read(api.leaf_code_lint(BigInt(token), handle)),
    // Whether this page mints a book's pictures itself. A module older than the page has no such export, and its books keep their data addresses.
    setMintsPictures: (mints) => {
      if (typeof api.leaf_set_mints_pictures === 'function') api.leaf_set_mints_pictures(mints ? 1 : 0);
    },
    // One picture out of the kept book, as its media type and bytes, or nothing where the module refused it.
    bookPicture: (member) => typeof api.leaf_book_picture === 'function' ? typed(api.leaf_book_picture, member) : null,
    // The page's book: the ask for its drawing, the picture addresses that drawing names, and the packed book as its type and bytes.
    bookExportAsk: (path, css) => withStrings(api.leaf_book_export_ask, path, css),
    bookPictureAddresses: (markup) => JSON.parse(withStrings(api.leaf_book_picture_addresses, markup) || '[]'),
    // Every glossary entry the book's drawing links, drawn out of the glossary this module holds, for the book module that holds none.
    bookGlossaryEntries: (markup, glossaryPath) => (typeof api.leaf_book_glossary_entries === 'function' ? JSON.parse(withStrings(api.leaf_book_glossary_entries, markup, glossaryPath || '') || '{}') : {}),
    // One fetched picture's chunks written straight into the module's memory, which the module keeps for the next book rather than copying.
    bookExportPicture: (address, chunks) => {
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const at = api.leaf_alloc(length);
      const memory = new Uint8Array(api.memory.buffer);
      let offset = at;
      for (const chunk of chunks) { memory.set(chunk, offset); offset += chunk.length; }
      const [name, nameLength] = write(address);
      const kept = api.leaf_book_export_picture(name, nameLength, at, length);
      api.leaf_free(name, nameLength);
      return !!kept;
    },
    bookExport: (request) => typed(api.leaf_book_export, JSON.stringify(request)),
    glossaryScript: (href) => withStrings(api.leaf_glossary_script, href || ''),
    // Index the held glossary's entries ahead of the first card. A module older than the page has no such export, and its first card builds the index as it always did.
    indexGlossary: () => {
      if (typeof api.leaf_index_glossary === 'function') api.leaf_index_glossary();
    },
    setGlossary: (source) => {
      const [at, length] = ArrayBuffer.isView(source) && source.BYTES_PER_ELEMENT === 1 ? put(source) : write(source || '');
      api.leaf_set_glossary(at, length);
      api.leaf_free(at, length);
    },
    setImageBase: (base) => {
      const [at, length] = write(base || '');
      api.leaf_set_image_base(at, length);
      api.leaf_free(at, length);
    },
    setImageSizes: (sizes) => {
      if (typeof api.leaf_set_image_sizes !== 'function') return;
      const [at, length] = write(JSON.stringify(sizes || {}));
      api.leaf_set_image_sizes(at, length);
      api.leaf_free(at, length);
    },
    render: (source, path) => JSON.parse(withStrings(api.leaf_render, source, path) || 'null'),
    // The served pages a note's lone row links point at, and their text handed back before the render. A module older than the page has neither, and every such link stays a card.
    namedRowFiles: (source, path) => (typeof api.leaf_named_row_files === 'function' ? JSON.parse(withStrings(api.leaf_named_row_files, source, path) || '[]') : []),
    setNamedRows: (pages) => {
      if (typeof api.leaf_set_named_rows !== 'function') return;
      const [at, length] = write(JSON.stringify(pages || {}));
      api.leaf_set_named_rows(at, length);
      api.leaf_free(at, length);
    },
    // This host cannot import the buffer wrapper; the module owns the bytes after open.
    bufferOpen: (body, path) => {
      if (typeof api.leaf_buffer_open !== 'function') return 0;
      const [bytes, name] = [put(body), write(path)];
      const handle = api.leaf_buffer_open(...bytes, ...name);
      api.leaf_free(...name);
      return handle;
    },
    bufferCodeView: (handle) => JSON.parse(read(api.leaf_buffer_code_view(handle)) || 'null'),
    bufferDocumentScript: (handle) => read(api.leaf_buffer_document_script(handle)),
    bufferState: (handle) => JSON.parse(read(api.leaf_buffer_state(handle)) || 'null'),
    // The buffer's text, or nothing for a package or book, whose text is not the file.
    bufferSource: (handle) => (typeof api.leaf_buffer_source === 'function' ? read(api.leaf_buffer_source(handle)) : null),
    bufferEncoded: (handle) => {
      const answer = api.leaf_buffer_encoded(handle);
      if (!answer) return null;
      const length = new DataView(api.memory.buffer).getUint32(answer, true);
      const bytes = new Uint8Array(api.memory.buffer, answer + 4, length).slice();
      api.leaf_free(answer, 4 + length);
      return bytes;
    },
    bufferEdit: (handle, edit) => JSON.parse(withStrings((...args) => api.leaf_buffer_edit(handle, ...args), JSON.stringify(edit)) || 'null'),
    bufferSaveScript: (handle, ok, error) => {
      const [at, length] = write(error || '');
      const answer = read(api.leaf_buffer_save_script(handle, ok ? 1 : 0, at, length));
      api.leaf_free(at, length);
      return answer;
    },
    bufferClose: (handle) => api.leaf_buffer_close(handle),
    // One picture out of the open buffer's own archive, against what its last draw admitted. A module older than the page has no such export.
    bufferBookPicture: (handle, member) => {
      if (typeof api.leaf_buffer_book_picture !== 'function') return null;
      const [at, length] = write(member);
      const answer = api.leaf_buffer_book_picture(handle, at, length);
      api.leaf_free(at, length);
      if (!answer) return null;
      const size = new DataView(api.memory.buffer).getUint32(answer, true);
      const whole = new Uint8Array(api.memory.buffer, answer + 4, size);
      const split = whole.indexOf(0);
      const picture = split < 0 ? null : { type: decoder.decode(whole.subarray(0, split)), bytes: whole.slice(split + 1) };
      api.leaf_free(answer, 4 + size);
      return picture;
    },
    // Which of the listed paths one table's relations read, asked before they are fetched, and then the model over what was fetched as the line the page answers to. A module older than the page has neither, and the lens is then refused rather than left waiting.
    tableWants: (handle, snapshot, listing) => (typeof api.leaf_table_wants === 'function'
      ? JSON.parse(withStrings((...args) => api.leaf_table_wants(handle, ...args), JSON.stringify({ snapshot, listing })) || 'null') : null),
    tableModel: (handle, token, snapshot, library, truncated) => (typeof api.leaf_table_model === 'function'
      ? withStrings((...args) => api.leaf_table_model(handle, token, ...args), JSON.stringify({ snapshot, library, truncated })) : null),
    // The note a `[[wiki]]` link names and its heading's anchor, read by the renderer's own grammar. A module older than the page has none, and the link then names nothing.
    wikiLink: (inner) => (typeof api.leaf_wiki_link === 'function' ? JSON.parse(withStrings(api.leaf_wiki_link, inner) || 'null') : null),
  };
}
